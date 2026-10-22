<script lang="ts">
	import type { Engine } from '#lib/engine/client.ts';
	import type { Evaluated } from '#lib/engine/types.ts';
	import { valueText } from '#lib/project/checks.ts';
	import FeatureValues from './FeatureValues.svelte';
	import PropertyForm from './PropertyForm.svelte';
	import TradeSummary from './TradeSummary.svelte';
	import TraceAdd from './TraceAdd.svelte';
	import TransitionDetails from '#lib/diagram/TransitionDetails.svelte';
	import {
		BookOpen,
		CircleAlert,
		Code,
		CopyPlus,
		FileCode,
		Gauge,
		Link2,
		Plus,
		Trash2,
		X
	} from '@lucide/svelte';
	import { conceptFor } from '#lib/learn/concepts.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { familyColor } from '#lib/ui/kinds.ts';
	import type { ModelElement, TreeNode } from '#lib/project/elements.ts';
	import { displayReference } from '#lib/project/names.ts';
	import { humanize, statusLabel } from '#lib/project/status.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import Pill from '#lib/ui/Pill.svelte';
	import {
		addElement,
		applySteps,
		deleteElement,
		deleteImpact,
		duplicateElement,
		renameElement
	} from './actions.ts';
	import { ownersOf } from '#lib/diagram/model.ts';
	import { planLinkRemoval } from '#lib/diagram/relationships.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import AddForm from './AddForm.svelte';
	import { canOwnMembers } from './templates.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';

	let { workspace, ui, engine }: { workspace: Workspace; ui: WorkbenchUi; engine?: Engine } =
		$props();

	const element: ModelElement | undefined = $derived(
		workspace.elements.find((e) => e.key === ui.selection?.key)
	);
	const concept = $derived(element ? conceptFor(element.kind, element.isDefinition) : undefined);
	const requirement = $derived(
		element ? workspace.requirements.find((r) => r.key === element.key) : undefined
	);
	const children = $derived.by(() => {
		if (!element) return [];
		const find = (nodes: TreeNode[]): TreeNode | undefined => {
			for (const n of nodes) {
				if (n.element.key === element.key) return n;
				const inner = find(n.children);
				if (inner) return inner;
			}
		};
		const all = find(workspace.tree)?.children.map((c) => c.element) ?? [];
		// A usage's attributes are under Values, with their values.
		return engine && !element.isDefinition ? all.filter((c) => c.kind !== 'attribute') : all;
	});
	let valueCount = $state(0);
	/** The element a `satisfy … by` or verification names: by its resolved id, else by its name. */
	function traceTarget(by: string): ModelElement | undefined {
		const id = requirement?.linkIds[by];
		if (id) {
			const found = workspace.elements.find((e) => e.id === id);
			if (found) return found;
		}
		const name = by.split('.').pop() ?? by;
		return workspace.elements.find((e) => e.label === name && !e.isDefinition);
	}

	/** Take a satisfy or verify statement out of the model (one undoable step, with a toast). */
	async function unlink(kind: 'satisfy' | 'verify', by: string) {
		if (!element) return;
		const plan = planLinkRemoval(kind, element, by, {
			elements: workspace.elements,
			owners: ownersOf(workspace.tree),
			textOf: (path) => workspace.text(path),
			analyses: Object.values(workspace.analyses)
		});
		const error =
			typeof plan === 'string' ? plan : await applySteps(workspace, plan.label, plan.steps);
		if (error) toasts.show(error, { tone: 'error' });
	}

	/** Requirements this element satisfies (matched by name in `satisfy … by`). */
	const satisfies = $derived(
		element && !element.isDefinition
			? workspace.requirements.filter((r) =>
					r.satisfiedBy.some((by) => by.split('.').pop() === element.label)
				)
			: []
	);

	/**
	 * Evaluated values of the element and of the attributes it contains, in one
	 * call (the engine caches them per analysis, so selecting stays instant).
	 */
	let values = $state.raw<Record<string, Evaluated>>({});
	let valuesGeneration = 0;
	$effect(() => {
		const current = ++valuesGeneration;
		const ids = [element, ...children]
			.filter((e) => e && e.kind === 'attribute' && e.value !== null && e.id)
			.map((e) => e!.id!);
		void workspace.files;
		if (!engine || !ids.length) {
			values = {};
			return;
		}
		void engine
			.evaluate(workspace.sourceFiles(), ids)
			.then((result) => {
				if (current === valuesGeneration) values = result;
			})
			.catch(() => {
				if (current === valuesGeneration) values = {};
			});
	});
	const valueOf = (e: ModelElement) => (e.id ? values[e.id] : undefined);

	let name = $state('');
	let adding = $state(false);
	let confirmDelete = $state(false);
	/** What else deleting it affects, once known. */
	let impact = $state<string | null>(null);
	let message = $state<string | null>(null);
	let learnMore = $state(false);

	$effect(() => {
		name = element?.label ?? '';
		adding = false;
		confirmDelete = false;
		impact = null;
		message = null;
	});

	function askDelete() {
		if (!element) return;
		const asked = element;
		confirmDelete = true;
		impact = 'Checking what uses it…';
		void deleteImpact(workspace, asked).then((line) => {
			if (confirmDelete && element?.key === asked.key) impact = line;
		});
	}

	async function rename() {
		if (!element || name.trim() === element.label) return;
		message = await renameElement(workspace, element, name);
	}

	function showInText(e: ModelElement) {
		if (ui.phone) {
			// Select first: opening the text then lowers the sheet to show it.
			ui.select(e.key, 'inspector');
			ui.showText(e.file);
			return;
		}
		ui.open({ kind: 'file', path: e.file });
		ui.select(e.key, 'inspector');
	}

	/** `a` or `an` before a concept's name (`an attribute usage`, `a part`). */
	const article = (word: string) => (/^[aeio]/i.test(word) ? 'an' : 'a');
</script>

<!-- What satisfies or verifies the requirement, as a link to it when the model resolved it. -->
{#snippet traced(by: string, kind: 'satisfy' | 'verify')}
	{@const target = traceTarget(by)}
	{#if target}
		<button type="button" class="link" onclick={() => ui.select(target.key, 'inspector')}>
			<Link2 size={13} aria-hidden="true" />
			{by}
		</button>
	{:else}
		<Link2 size={13} aria-hidden="true" /> {by}
	{/if}
	{#if engine && element}
		<button
			type="button"
			class="unlink"
			aria-label={kind === 'satisfy'
				? `${by} no longer satisfies it: remove the link`
				: `${by} no longer verifies it: remove the link`}
			title="Remove this link"
			onclick={() => void unlink(kind, by)}
		>
			<X size={14} aria-hidden="true" />
		</button>
	{/if}
{/snippet}

<aside class="inspector" class:phone={ui.phone} aria-label="Inspector">
	{#if !element}
		<div class="empty">
			<BookOpen size={22} />
			<p>
				Select an element in the text, a diagram or the explorer to see what it is and change it.
			</p>
			<button type="button" class="help-link" onclick={() => ui.showHelp('definition-usage')}>
				New here? The ideas in plain words
			</button>
		</div>
	{:else}
		<header style:--fam={familyColor(element.kind)} data-sheet-drag data-sheet-peek>
			<span class="kind">
				<KindGlyph kind={element.kind} isDefinition={element.isDefinition} size={20} />
				{concept?.title ??
					humanize(element.isDefinition ? `${element.kind} definition` : element.kind)}
				<code class="keyword"
					>{element.isDefinition && element.kind !== 'package'
						? `${element.kind.replace(/_/g, ' ')} def`
						: element.kind.replace(/_/g, ' ')}</code
				>
			</span>
			<h2>
				{#if element.shortName}<span class="id">{element.shortName}</span>{/if}
				{element.label}
			</h2>
		</header>

		{#if concept}
			<section class="concept">
				<p>{concept.summary}</p>
				<button
					type="button"
					class="link"
					aria-expanded={learnMore}
					onclick={() => (learnMore = !learnMore)}
				>
					{learnMore ? 'Less' : `What is ${article(concept.title)} ${concept.title.toLowerCase()}?`}
				</button>
				{#if learnMore}
					<p class="explanation">{concept.explanation}</p>
					{#if concept.analogy}<p class="analogy">{concept.analogy}</p>{/if}
					<pre aria-label="Example">{concept.example}</pre>
				{/if}
			</section>
		{/if}

		<section>
			<h3>Properties</h3>
			<form
				class="field"
				onsubmit={(e) => {
					e.preventDefault();
					void rename();
				}}
			>
				<label for="inspector-name">Name</label>
				<div class="inline">
					<input id="inspector-name" bind:value={name} onblur={rename} />
				</div>
			</form>
			{#if engine}
				{#key element.key}
					<PropertyForm {element} {workspace} {engine} {ui} computed={valueOf(element)} />
				{/key}
			{/if}
			<dl>
				{#if !engine && element.typeRef}
					<dt>{element.isDefinition ? 'Specializes' : 'Type'}</dt>
					<dd class="mono">{displayReference(element.typeRef)}</dd>
				{/if}
				<dt>Defined in</dt>
				<dd>
					<button type="button" class="link" onclick={() => showInText(element)}>
						<FileCode size={13} />
						{element.file}:{element.span.start_row}
					</button>
				</dd>
			</dl>
			{#if !engine && element.doc}<p class="doc">{element.doc}</p>{/if}
		</section>

		{#if engine && element.kind === 'analysis'}
			<TradeSummary {element} {workspace} {ui} {engine} />
		{/if}

		{#if engine && element.kind === 'transition'}
			<TransitionDetails {element} {workspace} {engine} />
		{/if}

		{#if engine && !element.isDefinition}
			<section aria-labelledby="values-heading" hidden={!valueCount}>
				<h3 id="values-heading">Values</h3>
				{#key element.key}
					<FeatureValues {element} {workspace} {engine} {ui} oncount={(n) => (valueCount = n)} />
				{/key}
			</section>
		{/if}

		{#if requirement}
			<section>
				<h3>Requirement</h3>
				<p class="status">
					<Pill tone={statusLabel(requirement.status).tone}
						>{statusLabel(requirement.status).label}</Pill
					>
					{#if requirement.priority}<span>{humanize(requirement.priority)} priority</span>{/if}
				</p>
				{#if requirement.rationale}<p class="doc">
						<strong>Rationale:</strong>
						{requirement.rationale}
					</p>{/if}
				{#each requirement.issues as issue, i (i)}
					<p class="issue"><CircleAlert size={14} /> {issue}</p>
				{/each}
				<button
					type="button"
					class="button limit"
					onclick={() => (ui.create = { kind: 'limit', element: element.key })}
				>
					<Gauge size={15} aria-hidden="true" /> Set a limit
				</button>
				<h4>Satisfied by</h4>
				{#if requirement.satisfiedBy.length}
					<ul class="links">
						{#each requirement.satisfiedBy as by (by)}<li>
								{@render traced(by, 'satisfy')}
							</li>{/each}
					</ul>
				{:else}
					<p class="gap">Nothing in the design satisfies this yet.</p>
				{/if}
				{#if engine}
					<TraceAdd
						requirement={element}
						kind="satisfy"
						linked={requirement.satisfiedBy.map(traceTarget)}
						{workspace}
						{engine}
					/>
				{/if}
				<h4>Verified by</h4>
				{#if requirement.verifiedBy.length}
					<ul class="links">
						{#each requirement.verifiedBy as by (by)}<li>{@render traced(by, 'verify')}</li>{/each}
					</ul>
				{:else}
					<p class="gap">No test verifies this yet.</p>
				{/if}
				{#if engine}
					<TraceAdd
						requirement={element}
						kind="verify"
						linked={requirement.verifiedBy.map(traceTarget)}
						{workspace}
						{engine}
					/>
				{/if}
			</section>
		{/if}

		{#if satisfies.length}
			<section>
				<h3>Satisfies</h3>
				<ul class="links">
					{#each satisfies as r (r.key)}
						<li>
							<button type="button" class="link" onclick={() => ui.select(r.key, 'inspector')}>
								{r.id ?? ''}
								{r.title}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if children.length}
			<section>
				<h3>Contains</h3>
				<ul class="links">
					{#each children as child (child.key)}
						<li>
							<button
								type="button"
								class="link member"
								onclick={() => ui.select(child.key, 'inspector')}
							>
								<span class="child-kind"
									>{child.isDefinition ? `${child.kind} def` : child.kind}</span
								>
								{child.label}
								{#if valueOf(child)}
									{@const v = valueOf(child)!}
									{@const shown =
										v.kind === 'number'
											? valueText(v)
											: v.kind === 'text'
												? v.text
												: v.kind === 'undecided'
													? '?'
													: null}
									{#if shown && v.kind === 'undecided'}
										<span class="child-value undecided" title={v.reason}
											>?<span class="visually-hidden">: not computed, {v.reason}</span></span
										>
									{:else if shown}
										<span class="child-value">{shown}</span>
									{/if}
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="actions">
			{#if ui.phone}
				<button type="button" class="button" onclick={() => showInText(element)}>
					<Code size={15} /> Show SysML
				</button>
			{/if}
			{#if canOwnMembers(element.kind, element.isDefinition)}
				{#if adding}
					<AddForm
						ownerLabel={element.label}
						kinds={element.kind === 'package'
							? [
									'part def',
									'port def',
									'item def',
									'requirement',
									'action def',
									'state def',
									'package'
								]
							: ['part', 'port', 'attribute', 'action', 'requirement']}
						onadd={async (kind, n, type) => {
							const error = await addElement(workspace, element, kind, n, type);
							if (!error) adding = false;
							return error;
						}}
						oncancel={() => (adding = false)}
					/>
				{:else}
					<button type="button" class="button" onclick={() => (adding = true)}>
						<Plus size={15} /> Add to {element.label}
					</button>
				{/if}
			{/if}
			{#if !isLibraryFile(element.file)}
				<button
					type="button"
					class="button"
					title="Copy it under a new name, right after it (Ctrl+D or ⌘D)"
					onclick={async () => {
						const { error, copy } = await duplicateElement(workspace, element);
						if (error) message = error;
						else if (copy) ui.select(copy.key, 'inspector');
					}}
				>
					<CopyPlus size={15} /> Duplicate
				</button>
			{/if}
			{#if confirmDelete}
				<div class="confirm" role="alert">
					<p>
						Delete <strong>{element.label}</strong> from the model? Its text is removed, so it leaves
						every diagram and table.
					</p>
					{#if impact}<p class="impact" role="status">{impact}</p>{/if}
					<button
						type="button"
						class="button danger"
						onclick={async () => (message = await deleteElement(workspace, element))}
					>
						Delete
					</button>
					<button type="button" class="button" onclick={() => (confirmDelete = false)}>Keep</button>
				</div>
			{:else}
				<button type="button" class="button quiet" onclick={askDelete}>
					<Trash2 size={15} /> Delete from model
				</button>
			{/if}
			{#if message}<p class="error" role="alert">{message}</p>{/if}
		</section>
	{/if}
</aside>

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		height: 100%;
		overflow-y: auto;
		padding: var(--space-4);
		font-size: var(--text-sm);
	}
	.help-link {
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.help-link:hover {
		background: var(--accent-weak);
	}
	.empty {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
		margin-top: 20vh;
		text-align: center;
		color: var(--text-3);
	}
	header {
		margin: calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) 0;
		padding: var(--space-4) var(--space-4) var(--space-3);
		border-top: 3px solid var(--fam);
		background: linear-gradient(
			to bottom,
			color-mix(in oklab, var(--fam) 9%, var(--surface)),
			var(--surface)
		);
	}
	.kind {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.keyword {
		margin-left: auto;
		padding: 1px 6px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--syntax-keyword);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
	}
	h2 {
		margin-top: 2px;
		font-size: var(--text-lg);
		word-break: break-word;
	}
	.id {
		margin-right: var(--space-1);
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 500;
	}
	h3 {
		margin-bottom: var(--space-2);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	h4 {
		margin: var(--space-3) 0 var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.concept {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--accent-weak);
		color: var(--text);
	}
	.explanation,
	.analogy {
		margin-top: var(--space-2);
		color: var(--text-2);
	}
	.analogy {
		font-style: italic;
	}
	pre {
		margin: var(--space-2) 0 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-size: 12px;
		white-space: pre-wrap;
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		text-align: left;
		cursor: pointer;
	}
	.field {
		display: grid;
		gap: var(--space-1);
		margin-bottom: var(--space-3);
	}
	.field label {
		color: var(--text-3);
	}
	.field input {
		width: 100%;
		height: 2.125rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-weight: 560;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-2) var(--space-3);
		margin: 0;
	}
	dt {
		color: var(--text-3);
	}
	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.doc {
		margin-top: var(--space-3);
		color: var(--text-2);
		line-height: 1.55;
	}
	.status {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
	}
	.issue,
	.gap {
		color: var(--warn);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.unlink {
		display: inline-grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-left: auto;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}
	.unlink:hover,
	.unlink:focus-visible {
		background: var(--surface-hover);
		color: var(--danger);
	}
	.phone .unlink {
		width: 2.75rem;
		height: 2.75rem;
	}
	.links li {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--text-2);
	}
	.child-kind {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.member {
		display: flex;
		width: 100%;
	}
	/* An attribute's value, as the engine evaluated it. */
	.child-value {
		margin-left: auto;
		padding-left: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.child-value.undecided {
		color: var(--text-3);
	}
	.actions {
		display: grid;
		gap: var(--space-2);
		margin-top: auto;
		padding-top: var(--space-3);
		border-top: 1px solid var(--border);
	}
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-weight: 550;
		cursor: pointer;
	}
	.button:hover {
		border-color: var(--border-strong);
	}
	.button.limit {
		margin-top: var(--space-2);
	}
	.quiet {
		color: var(--text-2);
	}
	.danger {
		border-color: var(--danger);
		background: var(--danger);
		color: #fff;
	}
	.confirm {
		display: grid;
		gap: var(--space-2);
	}
	.impact {
		color: var(--text-2);
	}
	.error {
		color: var(--danger);
	}

	/* In the phone's details sheet: the header is the sheet's handle and
	   stays in view; actions are thumb-sized. */
	.inspector.phone {
		padding-top: 0;
		padding-bottom: calc(var(--space-5) + var(--sheet-hidden, 0px) + env(safe-area-inset-bottom));
		overscroll-behavior: contain;
		font-size: var(--text-md);
	}
	.phone header {
		position: sticky;
		top: 0;
		z-index: 1;
		margin-top: 0;
		padding-top: var(--space-1);
		border-top: 0;
		background: var(--surface);
		box-shadow: 0 1px 0 var(--border);
		touch-action: none;
		cursor: grab;
	}
	.phone h2 {
		font-size: var(--text-xl);
	}
	.phone .empty {
		margin-top: var(--space-6);
	}
	.phone .field input {
		height: 3rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
	}
	.phone .links {
		gap: 0;
	}
	.phone .links .link {
		min-height: 2.75rem;
	}
	.phone .actions {
		margin-top: var(--space-2);
	}
	.phone .button {
		height: 3rem;
		border-radius: var(--radius-md);
	}
	.phone .concept button.link {
		min-height: 2.75rem;
	}
</style>
