<script lang="ts">
	/**
	 * The FMEA lines about the selected element, in its details: each line's
	 * figures now and before risk reduction, its risk controls with what
	 * implements and verifies them, its mitigations with their status, and
	 * why it needs review. "Link a risk control or mitigation" names an
	 * existing one in the line, or makes a new one, as one undoable step.
	 */
	import { Check, CircleAlert, X } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { FmeaLineInfo } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { flatten } from '#lib/create/model.ts';
	import { nextControlId, planLineLinks, type Linked } from '#lib/create/plans.ts';
	import { annotationAt } from '#lib/create/riskControls.ts';
	import { applySteps } from './actions.ts';
	import { ZONE_WORDS, levelTone } from './risk.ts';
	import RiskLinkAdd, { type RiskLink } from './RiskLinkAdd.svelte';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import { viewTitle } from './views.ts';

	let {
		element,
		workspace,
		ui,
		engine
	}: { element: ModelElement; workspace: Workspace; ui: WorkbenchUi; engine: Engine } = $props();

	let lines = $state.raw<FmeaLineInfo[]>([]);
	let generation = 0;
	$effect(() => {
		const id = element.id;
		void workspace.files;
		const current = ++generation;
		if (!id) {
			lines = [];
			return;
		}
		void engine
			.fmeaLines(workspace.sourceFiles(), id)
			.then((found) => {
				if (current === generation) lines = found;
			})
			.catch(() => {
				if (current === generation) lines = [];
			});
	});

	const nodes = $derived(flatten(workspace.tree));
	const byQualified = $derived(new Map(nodes.map((n) => [n.qualifiedName, n.node.element])));
	/** The project's risk controls and mitigations, as a line names them. */
	const links = $derived(
		nodes.flatMap((n): RiskLink[] => {
			const e = n.node.element;
			if (e.isDefinition || isLibraryFile(e.file)) return [];
			const type = e.typeRef?.split('::').pop();
			if (e.kind === 'requirement' && type === 'RiskControl')
				return [
					{
						kind: 'control',
						element: e,
						qualifiedName: n.qualifiedName,
						label: e.shortName ? `${e.shortName} ${e.label}` : e.label
					}
				];
			if (e.kind === 'action' && type === 'Mitigation')
				return [{ kind: 'mitigation', element: e, qualifiedName: n.qualifiedName, label: e.label }];
			return [];
		})
	);
	const linkedOf = (link: { qualifiedName: string; label: string }): Linked => ({
		qualifiedName: link.qualifiedName,
		label: link.label,
		shortName: byQualified.get(link.qualifiedName)?.shortName ?? null
	});

	let picking = $state<number | null>(null);
	let busy = $state(false);

	/** The package a line is written in: the innermost one around its line. */
	function packageOf(line: FmeaLineInfo): ModelElement | undefined {
		return workspace.elements
			.filter(
				(e) =>
					e.kind === 'package' &&
					!e.isDefinition &&
					e.file === line.file &&
					e.span.start_row <= line.line &&
					e.span.end_row >= line.line
			)
			.sort((a, b) => b.span.start_row - a.span.start_row)[0];
	}

	/** The hazard as the line writes it, for a new control on it. */
	function hazardWritten(line: FmeaLineInfo): string | null {
		const text = workspace.text(line.file) ?? '';
		const at = annotationAt(text, line.line);
		const own = at ? text.slice(at.from, at.to) : '';
		return /\bhazard\s*=\s*([^;]+);/.exec(own)?.[1]?.trim() ?? null;
	}

	async function change(
		line: FmeaLineInfo,
		next: {
			controls: Linked[];
			mitigations: Linked[];
			newControl?: string;
			newMitigation?: string;
		},
		label: string
	) {
		const pkg = packageOf(line);
		if (!pkg) {
			toasts.show('This line is not in a package, so it can’t be changed from here.', {
				tone: 'error'
			});
			return;
		}
		const ids = workspace.elements.map((e) => e.shortName);
		const plan = planLineLinks(workspace, {
			file: line.file,
			line: line.line,
			pkg,
			controls: next.controls,
			mitigations: next.mitigations,
			...(next.newControl
				? {
						newControl: {
							id: nextControlId(ids),
							title: next.newControl,
							statement: '',
							hierarchy: 'protectiveMeasure',
							hazard: hazardWritten(line)
						}
					}
				: {}),
			...(next.newMitigation
				? {
						newMitigation: {
							name: next.newMitigation,
							description: '',
							kind: 'prevention' as const,
							owner: ''
						}
					}
				: {}),
			label
		});
		if (typeof plan === 'string') {
			toasts.show(plan, { tone: 'error' });
			return;
		}
		busy = true;
		const error = await applySteps(workspace, plan.label, plan.steps);
		busy = false;
		if (error) toasts.show(error, { tone: 'error' });
		else picking = null;
	}

	const current = (line: FmeaLineInfo) => ({
		controls: line.controls.map((c) => linkedOf({ qualifiedName: c.element, label: c.label })),
		mitigations: line.mitigations
			.filter((m) => m.named)
			.map((m) => linkedOf({ qualifiedName: m.element, label: m.name }))
	});

	function pick(line: FmeaLineInfo, link: RiskLink) {
		const now = current(line);
		const linked = linkedOf(link);
		void change(
			line,
			link.kind === 'control'
				? { ...now, controls: [...now.controls, linked] }
				: { ...now, mitigations: [...now.mitigations, linked] },
			`Linked ${link.label} to “${line.failureMode}”`
		);
	}

	function create(line: FmeaLineInfo, kind: 'control' | 'mitigation', name: string) {
		void change(
			line,
			{
				...current(line),
				...(kind === 'control' ? { newControl: name } : { newMitigation: name })
			},
			`Added the ${kind === 'control' ? 'risk control' : 'mitigation'} ${name} to “${line.failureMode}”`
		);
	}

	function unlink(
		line: FmeaLineInfo,
		kind: 'control' | 'mitigation',
		qualifiedName: string,
		label: string
	) {
		const now = current(line);
		void change(
			line,
			kind === 'control'
				? { ...now, controls: now.controls.filter((c) => c.qualifiedName !== qualifiedName) }
				: { ...now, mitigations: now.mitigations.filter((m) => m.qualifiedName !== qualifiedName) },
			`Unlinked ${label} from “${line.failureMode}”`
		);
	}

	function select(qualifiedName: string) {
		const target = byQualified.get(qualifiedName);
		if (target) ui.select(target.key, 'inspector');
	}

	const chip = (column: string, value: string) => levelTone(column, value) ?? 'plain';
	const word = (value: string) => viewTitle(value).toLowerCase();
	const ratings = (r: { severity: string; likelihood: string; detection: string }) =>
		`S ${r.severity} · L ${r.likelihood} · D ${r.detection}`;
</script>

{#if lines.length}
	<section aria-labelledby="fmea-lines-heading">
		<h3 id="fmea-lines-heading">FMEA lines</h3>
		{#each lines as line, i (`${line.file}:${line.line}`)}
			<article class="line" aria-label="FMEA line {line.failureMode}">
				<h4>{line.failureMode}</h4>
				<p class="figures">
					{#if line.actionPriority}<span class="chip {chip('actionPriority', line.actionPriority)}"
							>{word(line.actionPriority)} priority</span
						>{/if}
					{#if line.acceptability}<span class="chip {chip('acceptability', line.acceptability)}"
							>{ZONE_WORDS[line.acceptability]?.label ?? word(line.acceptability)}</span
						>{/if}
					{#if line.rpn}<span class="rpn"
							>RPN {line.rpn}{#if line.rpnBand}
								({word(line.rpnBand)}){/if}</span
						>{/if}
				</p>
				<dl class="scores">
					<dt>Now</dt>
					<dd>{ratings(line)}</dd>
					{#if line.before}
						<dt>Before</dt>
						<dd>
							{ratings(line.before)}{#if line.acceptabilityBefore}, {(
									ZONE_WORDS[line.acceptabilityBefore]?.label ?? word(line.acceptabilityBefore)
								).toLowerCase()}{/if}
						</dd>
					{/if}
				</dl>
				{#if line.review}
					<p class="review"><CircleAlert size={14} aria-hidden="true" /> {line.review}</p>
				{/if}
				<h5>Risk controls</h5>
				{#if line.controls.length}
					<ul class="links">
						{#each line.controls as control (control.element)}
							<li>
								<div class="name">
									<button type="button" class="link" onclick={() => select(control.element)}
										>{control.label}</button
									>
									<button
										type="button"
										class="unlink"
										aria-label="Unlink {control.label} from this line"
										disabled={busy}
										onclick={() => unlink(line, 'control', control.element, control.label)}
										><X size={14} aria-hidden="true" /></button
									>
								</div>
								<p class="trace">
									{#if control.satisfiedBy.length}<span class="ok"
											><Check size={12} aria-hidden="true" /> Implemented by {control.satisfiedBy.join(
												', '
											)}</span
										>{:else}<span class="gap">Not implemented yet</span>{/if}
									{#if control.verifiedBy.length}<span class="ok"
											><Check size={12} aria-hidden="true" /> Verified by {control.verifiedBy.join(
												', '
											)}</span
										>{:else}<span class="gap">Not verified yet</span>{/if}
								</p>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="none">No risk control addresses this line yet.</p>
				{/if}
				{#if line.mitigations.length}
					<h5>Mitigations</h5>
					<ul class="links">
						{#each line.mitigations as m (m.element)}
							<li>
								<div class="name">
									<button type="button" class="link" onclick={() => select(m.element)}
										>{m.name}</button
									>
									{#if m.status}<span class="chip {chip('mitigationStatus', m.status)}"
											>{word(m.status)}</span
										>{/if}
									{#if m.named}
										<button
											type="button"
											class="unlink"
											aria-label="Unlink {m.name} from this line"
											disabled={busy}
											onclick={() => unlink(line, 'mitigation', m.element, m.name)}
											><X size={14} aria-hidden="true" /></button
										>
									{:else}
										<span class="via">implements a control</span>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				<RiskLinkAdd
					candidates={links.filter(
						(l) =>
							!line.controls.some((c) => c.element === l.qualifiedName) &&
							!line.mitigations.some((m) => m.named && m.element === l.qualifiedName)
					)}
					about={line.failureMode}
					{busy}
					bind:open={() => picking === i, (v) => (picking = v ? i : null)}
					onpick={(link) => pick(line, link)}
					oncreate={(kind, name) => create(line, kind, name)}
				/>
			</article>
		{/each}
	</section>
{/if}

<style>
	h3 {
		margin-bottom: var(--space-2);
	}
	.line {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border);
	}
	.line:first-of-type {
		border-top: 0;
		padding-top: 0;
	}
	h4 {
		font-size: var(--text-md);
		font-weight: 650;
	}
	h5 {
		margin-top: var(--space-1);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.figures {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.chip {
		display: inline-block;
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.chip::first-letter {
		text-transform: uppercase;
	}
	.chip.ok {
		background: color-mix(in oklab, var(--ok) 16%, var(--surface));
	}
	.chip.warn {
		background: color-mix(in oklab, var(--warn) 20%, var(--surface));
	}
	.chip.bad {
		background: color-mix(in oklab, var(--danger) 16%, var(--surface));
	}
	.rpn {
		color: var(--text-2);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.scores {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	dt {
		color: var(--text-2);
	}
	dd {
		margin: 0;
	}
	.review {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--warn) 14%, var(--surface));
		font-size: var(--text-sm);
	}
	.review :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--warn);
	}
	.links {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
	.unlink {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-left: auto;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.unlink:hover,
	.unlink:focus-visible {
		background: var(--surface-hover);
		color: var(--text);
	}
	.trace {
		display: flex;
		flex-wrap: wrap;
		gap: 2px var(--space-3);
		font-size: var(--text-xs);
	}
	.trace .ok {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--text-2);
	}
	.trace .ok :global(svg) {
		color: var(--ok);
	}
	.gap {
		padding: 0 6px;
		border-radius: var(--radius-pill);
		background: var(--warn-weak);
		color: var(--warn);
		font-weight: 600;
	}
	.via,
	.none {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.none {
		font-size: var(--text-sm);
	}
	@media (max-width: 760px) {
		.link,
		.unlink {
			min-height: 2.75rem;
		}
		.unlink {
			width: 2.75rem;
		}
	}
</style>
