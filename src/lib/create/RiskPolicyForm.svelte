<script lang="ts">
	/**
	 * The organisation's risk policy, in the project's risk library: which
	 * cells of severity by likelihood are acceptable, to be reduced as far as
	 * possible, or unacceptable (painted on the grid, as the risk matrix
	 * shows them), where the RPN bands start, and whether the worksheets lead
	 * with the action priority or the RPN. Saving rewrites the library's
	 * `Acceptability` calc, `RpnBand`'s thresholds and the worksheets' order,
	 * as one undoable step.
	 */
	import { untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { RiskPolicy } from '#lib/engine/types.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { applySteps } from '#lib/workbench/actions.ts';
	import { ZONE_WORDS, zoneTone } from '#lib/workbench/risk.ts';
	import { viewTitle } from '#lib/workbench/views.ts';
	import CreateDialog, { type Step } from './CreateDialog.svelte';
	import { RATINGS } from './fmea';
	import { riskLibrariesWrite } from './plans';
	import {
		DEFAULT_BANDS,
		DEFAULT_ZONES,
		ZONE_LEVELS,
		acceptabilityText,
		withPolicy,
		zoneWords,
		type Lead,
		type Zones
	} from './riskPolicy';

	let {
		open = $bindable(false),
		workspace,
		engine
	}: { open?: boolean; workspace: Workspace; engine: Engine } = $props();

	const uid = $props.id();
	let step = $state(0);
	let policy = $state.raw<RiskPolicy | null>(null);
	let zones = $state<Zones>(DEFAULT_ZONES.map((r) => [...r]));
	let bands = $state(
		DEFAULT_BANDS.map((b) => ({ ...b, level: b.name.replace(/From$/, ''), text: String(b.value) }))
	);
	let lead = $state<Lead>('rpn');
	let brush = $state('unacceptable');

	$effect(() => {
		const files = untrack(() => workspace.sourceFiles());
		void engine.riskPolicy(files).then((p) => {
			policy = p;
			if (p.zones && p.zones.every((r) => r.every((z) => z))) zones = p.zones.map((r) => [...r]);
			if (p.bands.length) bands = p.bands.map((b) => ({ ...b, text: String(b.value) }));
			if (p.lead) lead = p.lead;
		});
	});

	const levels = $derived(policy?.zoneLevels.length ? policy.zoneLevels : [...ZONE_LEVELS]);
	/** The project's risk library, if it has one. */
	const library = $derived(
		workspace.elements.find(
			(e) => e.kind === 'package' && e.name === 'RiskAnalysis' && !e.isDefinition
		)?.file
	);
	const zoneLabel = (z: string) => ZONE_WORDS[z]?.label ?? viewTitle(z);
	const meaning = (field: 'severity' | 'likelihood', value: number) =>
		RATINGS.find((r) => r.field === field)?.meanings[value - 1] ?? '';

	// Painting: press on a cell and move across others, with a finger or the mouse.
	let painting = false;
	function paint(s: number, l: number) {
		if (zones[s - 1]![l - 1] !== brush) zones[s - 1]![l - 1] = brush;
	}
	function cellAt(event: PointerEvent): [number, number] | null {
		const target = document.elementFromPoint(event.clientX, event.clientY);
		const cell = target instanceof Element ? target.closest<HTMLElement>('[data-cell]') : null;
		if (!cell) return null;
		const [s, l] = cell.dataset.cell!.split(',').map(Number);
		return [s!, l!];
	}
	function onpointerdown(event: PointerEvent) {
		const at = cellAt(event);
		if (!at) return;
		painting = true;
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		paint(at[0], at[1]);
	}
	function onpointermove(event: PointerEvent) {
		if (!painting) return;
		const at = cellAt(event);
		if (at) paint(at[0], at[1]);
	}
	function stop() {
		painting = false;
	}

	const numbers = $derived(bands.map((b) => Number(b.text)));
	const bandProblem = $derived.by(() => {
		for (const [i, n] of numbers.entries()) {
			if (!Number.isInteger(n) || n < 2 || n > 1000)
				return `Give ${viewTitle(bands[i]!.level).toLowerCase()} a whole number from 2 to 1000.`;
			if (i > 0 && n <= numbers[i - 1]!)
				return `${viewTitle(bands[i]!.level)} must start above ${viewTitle(bands[i - 1]!.level).toLowerCase()}.`;
		}
		return null;
	});
	/** `low: 1 to 50`, …: the ranges the thresholds make. */
	const ranges = $derived(
		['low', ...bands.map((b) => b.level)].map((level, i) => {
			const from = i === 0 ? 1 : numbers[i - 1]!;
			const to = i < numbers.length ? numbers[i]! - 1 : 1000;
			return {
				level,
				words: Number.isFinite(from) && Number.isFinite(to) ? `${from} to ${to}` : ''
			};
		})
	);

	const change = $derived({
		zones,
		bands: bands.map((b, i) => ({ name: b.name, value: numbers[i]! })),
		lead
	});
	const preview = $derived(
		[
			acceptabilityText(zones, ''),
			bands.map((b, i) => `attribute ${b.name} : Integer = ${numbers[i]};`).join('\n'),
			`sortBy = "${lead === 'actionPriority' ? '-actionPriority; -rpn' : '-rpn'}";`
		].join('\n\n')
	);

	const steps: Step[] = [
		{ id: 'zones', label: 'Zones', question: 'Which risks are acceptable?' },
		{ id: 'bands', label: 'RPN bands', question: 'Where do the RPN bands start?' },
		{ id: 'lead', label: 'Worksheets', question: 'What should worksheets lead with?' }
	];

	function check(index: number): string | null {
		if (steps[index]?.id === 'bands') return bandProblem;
		return null;
	}

	async function finish(): Promise<string | null> {
		if (bandProblem) return bandProblem;
		const label = 'Changed the risk policy';
		if (!library) {
			// No risk library yet: it comes with the policy in it.
			const libraries = await riskLibrariesWrite(workspace, engine);
			const files = (libraries.files ?? []).map((f) =>
				f.path.endsWith('RiskAnalysis.sysml') ? { ...f, text: withPolicy(f.text, change) } : f
			);
			const error = await applySteps(
				workspace,
				label,
				files.map((f) => ({ kind: 'file', path: f.path, text: f.text }))
			);
			if (error) return error;
			open = false;
			return null;
		}
		const before = workspace.text(library);
		if (before === undefined) return 'The risk library is not in the project.';
		const after = withPolicy(before, change);
		if (after === before) {
			open = false;
			toasts.show('The risk policy is as it was.');
			return null;
		}
		const error = await applySteps(workspace, label, [
			{ kind: 'patch', path: library, before, after }
		]);
		if (error) return error;
		open = false;
		return null;
	}
</script>

<CreateDialog
	bind:open
	title="Risk policy"
	{steps}
	bind:step
	{preview}
	{check}
	finishLabel="Save policy"
	onfinish={finish}
>
	{#if steps[step]?.id === 'zones'}
		<p class="hint">
			Your organisation decides which risks it accepts (ISO 14971). Choose a zone, then tap or drag
			across the cells it covers. The risk matrix and the worksheets' Acceptability column follow.
			{#if policy && !policy.zones}Your risk library has no policy yet: saving adds it.{/if}
		</p>
		<div class="segmented brushes" role="radiogroup" aria-label="Zone to paint">
			{#each levels as zone (zone)}
				<label>
					<input type="radio" name="{uid}-brush" value={zone} bind:group={brush} />
					<span
						><i class="swatch zone-{zoneTone(zone, levels)}" aria-hidden="true"></i>{zoneLabel(
							zone
						)}</span
					>
				</label>
			{/each}
		</div>
		<!-- Each cell is a button: tap to paint it; pressing and moving paints the cells passed over. -->
		<div
			class="paint"
			role="group"
			aria-label="Severity down, likelihood across"
			{onpointerdown}
			{onpointermove}
			onpointerup={stop}
			onpointercancel={stop}
		>
			<table>
				<thead>
					<tr>
						<th scope="col" class="corner"
							><span aria-hidden="true">S ↓ L →</span><span class="visually-hidden">Severity</span
							></th
						>
						{#each Array.from({ length: 10 }, (_, i) => i + 1) as l (l)}<th
								scope="col"
								title="Likelihood {l}: {meaning('likelihood', l)}">{l}</th
							>{/each}
					</tr>
				</thead>
				<tbody>
					{#each Array.from({ length: 10 }, (_, i) => 10 - i) as s (s)}
						<tr>
							<th scope="row" title="Severity {s}: {meaning('severity', s)}">{s}</th>
							{#each Array.from({ length: 10 }, (_, i) => i + 1) as l (l)}
								{@const zone = zones[s - 1]![l - 1]!}
								<td>
									<button
										type="button"
										class="cell zone-{zoneTone(zone, levels)}"
										data-cell="{s},{l}"
										aria-label="Severity {s}, likelihood {l}: {zoneLabel(zone).toLowerCase()}"
										onclick={() => paint(s, l)}
										><span aria-hidden="true">{zoneLabel(zone)[0]}</span></button
									>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="row-buttons">
			<button type="button" class="plain" onclick={() => (zones = DEFAULT_ZONES.map((r) => [...r]))}
				>Start from the library’s default</button
			>
		</div>
		<details class="words">
			<summary>The policy in words</summary>
			<ul>
				{#each zoneWords(zones) as line (line)}<li>{line}</li>{/each}
			</ul>
		</details>
	{:else if steps[step]?.id === 'bands'}
		<p class="hint">
			The risk priority number (severity × likelihood × detection, 1 to 1000) falls in a band. Each
			band starts where you say; the worksheets show it beside the RPN.
		</p>
		<div class="bands">
			{#each bands as band (band.name)}
				<label class="field">
					<span class="name">{viewTitle(band.level)} from</span>
					<input type="number" inputmode="numeric" min="2" max="1000" bind:value={band.text} />
				</label>
			{/each}
		</div>
		<ul class="ranges" aria-label="The bands">
			{#each ranges as r (r.level)}
				<li>
					<span
						class="chip zone-{zoneTone(
							r.level,
							ranges.map((x) => x.level)
						)}">{viewTitle(r.level)}</span
					>
					{r.words}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="hint">
			Both figures stay on every worksheet; this says which comes first and how the lines are
			sorted.
		</p>
		<div class="cards" role="radiogroup" aria-label="Lead with">
			<label class="card">
				<input type="radio" name="{uid}-lead" value="actionPriority" bind:group={lead} />
				<span>
					<strong>Action priority</strong>
					<small
						>High, medium or low from the AIAG-VDA table, which weighs severity first. Lines sort by
						it, then by RPN. Recommended by AIAG-VDA.</small
					>
				</span>
			</label>
			<label class="card">
				<input type="radio" name="{uid}-lead" value="rpn" bind:group={lead} />
				<span>
					<strong>Risk priority number (RPN)</strong>
					<small
						>Severity × likelihood × detection, with its band. Lines sort by it, highest first.</small
					>
				</span>
			</label>
		</div>
	{/if}
</CreateDialog>

<style>
	.brushes span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		display: inline-block;
		width: 0.9rem;
		height: 0.9rem;
		border: 1px solid color-mix(in oklab, var(--text) 25%, transparent);
		border-radius: 3px;
	}
	.paint {
		max-width: 100%;
		overflow-x: auto;
		touch-action: none;
		user-select: none;
	}
	table {
		border-collapse: separate;
		border-spacing: 2px;
		margin-inline: auto;
	}
	th {
		padding: 0 2px;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		text-align: center;
	}
	.corner {
		white-space: nowrap;
	}
	td {
		padding: 0;
	}
	.cell {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.75rem;
		padding: 0;
		border: 1px solid color-mix(in oklab, var(--text) 18%, transparent);
		border-radius: var(--radius-sm);
		color: var(--text);
		font-size: var(--text-xs);
		font-weight: 700;
		cursor: crosshair;
	}
	.cell:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	/* The zones as the risk matrix shows them: a colour and a pattern (plain, dotted, hatched). */
	.zone-ok {
		background: color-mix(in oklab, var(--ok) 22%, var(--surface));
	}
	.zone-warn {
		background:
			radial-gradient(
					circle at 2px 2px,
					color-mix(in oklab, var(--text) 30%, transparent) 1px,
					transparent 1.5px
				)
				0 0 / 6px 6px,
			color-mix(in oklab, var(--warn) 30%, var(--surface));
	}
	.zone-bad {
		background:
			repeating-linear-gradient(
				135deg,
				color-mix(in oklab, var(--text) 22%, transparent) 0 1.5px,
				transparent 1.5px 6px
			),
			color-mix(in oklab, var(--danger) 30%, var(--surface));
	}
	.zone-plain {
		background: var(--surface-2);
	}
	.cell span {
		text-shadow:
			0 0 3px var(--surface),
			0 0 3px var(--surface);
	}
	.row-buttons {
		display: flex;
		justify-content: flex-end;
	}
	.words summary {
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		color: var(--text-2);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.words ul {
		margin: 0;
		padding-left: 1.25rem;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.bands {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: var(--space-3);
	}
	.ranges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.chip {
		display: inline-block;
		margin-right: 4px;
		padding: 1px 8px;
		border-radius: 999px;
		font-size: var(--text-xs);
		font-weight: 600;
	}
	@media (max-width: 760px) {
		.cell {
			width: 1.95rem;
		}
	}
</style>
