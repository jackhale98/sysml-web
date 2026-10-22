<script lang="ts">
	import type { Engine } from '#lib/engine/client.ts';
	import type { DeclarationSet, ElementDetails, Evaluated } from '#lib/engine/types.ts';
	import { CornerDownRight, Gauge, Sigma } from '@lucide/svelte';
	import { ownerOf } from '#lib/create/model.ts';
	import { computedText } from '#lib/project/checks.ts';
	import { elementAt, utf16ToByte, type ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { parentOf, withImported } from './actions.ts';
	import TypePicker from './TypePicker.svelte';
	import type { WorkbenchUi } from './ui.svelte.ts';

	/**
	 * The editable parts of an element's declaration — ID, type,
	 * specialization, multiplicity, value, direction, abstract and doc — as a
	 * form. Each change becomes one minimal edit of the SysML text, with Undo.
	 */
	let {
		element,
		workspace,
		engine,
		computed,
		ui
	}: {
		element: ModelElement;
		workspace: Workspace;
		engine: Engine;
		/** For going to a type's or a supertype's definition. */
		ui?: WorkbenchUi;
		/** The value as the engine evaluated it, when it is an expression. */
		computed?: Evaluated;
	} = $props();

	let details = $state<ElementDetails | null>(null);
	let error = $state<string | null>(null);
	let generation = 0;

	/** `= 27.54 min` beside an expression; nothing beside a plain number. */
	const result = $derived(computed ? computedText(computed, details?.value ?? null) : null);
	let why = $state(false);

	$effect(() => {
		const current = ++generation;
		const { file, span, name } = element;
		void workspace.files;
		void engine
			.elementDetails(workspace.sourceFiles(), file, span.start_row, name)
			.then((d) => {
				if (current === generation) {
					details = d;
					error = null;
				}
			})
			.catch((e) => {
				if (current === generation) error = e instanceof Error ? e.message : String(e);
			});
	});

	const kind = $derived(details?.kind.replace(/ def$/, '') ?? element.kind);
	const isDef = $derived(details?.isDefinition ?? element.isDefinition);
	const isPackage = $derived(kind === 'package');
	const typed = $derived(!isDef && !isPackage);
	const hasDirection = $derived(
		typed && ['port', 'attribute', 'item', 'part', 'ref'].includes(kind)
	);
	const hasValue = $derived(typed && ['attribute', 'ref', 'part', 'item'].includes(kind));
	/** The part (or part def) an attribute belongs to: it can add the value up or limit it. */
	const valueOwner = $derived.by(() => {
		if (kind !== 'attribute' || isDef) return null;
		const owner = ownerOf(workspace.tree, element.key);
		return owner?.kind === 'part' ? owner : null;
	});

	const uid = $props.id();
	const fileText = $derived(workspace.text(element.file) ?? '');

	/** The package an element sits in: where a new definition for it goes. */
	const owningPackage = $derived(
		workspace.elements
			.filter(
				(e) =>
					e.kind === 'package' &&
					e.file === element.file &&
					e.span.start_byte <= element.span.start_byte &&
					e.span.end_byte >= element.span.end_byte
			)
			.sort((a, b) => b.span.start_byte - a.span.start_byte)[0]
	);

	/** Type the element by a new definition, created in its package: one undoable change. */
	async function createType(name: string) {
		const pkg = owningPackage;
		if (!pkg) {
			toasts.show('Add a package to this file to hold the new definition.', { tone: 'error' });
			return;
		}
		const label = `Added ${kind} def ${name} and typed ${element.label} by it`;
		const before = workspace.undoStack.length;
		const error = await workspace.transact(label, async () => {
			const source = workspace.text(element.file);
			if (source === undefined) return `${element.file} is not open.`;
			const typed = await workspace.edit(element.file, {
				op: 'setDeclaration',
				path: element.file,
				source,
				...address(element),
				set: { type: name }
			});
			if (typed) return typed;
			return workspace.edit(element.file, {
				op: 'insertMember',
				path: element.file,
				source: workspace.text(element.file) ?? source,
				...parentOf(pkg),
				text: `${kind} def ${name} {\n}`
			});
		});
		if (error || workspace.undoStack.length > before) done(error, label);
	}

	/** How an edit names the element: its id, with its name and line for when the id is stale. */
	function address(e: ModelElement) {
		return { element: e.name, line: e.span.start_row, ...(e.id ? { id: e.id } : {}) };
	}

	/** The toast after an edit: the error, or what changed with Undo (and what it left unresolved). */
	function done(error: string | null, label: string) {
		if (error) {
			toasts.show(error, { tone: 'error' });
			return;
		}
		const warning = workspace.warnings.join(' ');
		toasts.show(warning ? `${label}. ${warning}` : label, {
			tone: warning ? 'info' : 'success',
			...(warning ? { duration: 12_000 } : {}),
			action: { label: 'Undo', run: () => workspace.undo() }
		});
	}

	async function apply(set: DeclarationSet, label: string) {
		const source = workspace.text(element.file);
		if (source === undefined) return;
		const before = workspace.undoStack.length;
		let imported: string[] = [];
		const result = await workspace.transact(
			() => withImported(label, imported),
			async () => {
				const error = await workspace.edit(element.file, {
					op: 'setDeclaration',
					path: element.file,
					source,
					...address(element),
					set
				});
				// A unit the package can't resolve (`[kg]` without SI) is imported with it.
				if (!error && set.value?.includes('['))
					imported = await workspace.importUnits(element.file, source);
				return error;
			}
		);
		if (result || workspace.undoStack.length > before) done(result, withImported(label, imported));
	}

	function commit(
		field: keyof DeclarationSet,
		value: string,
		current: string | undefined,
		what: string
	) {
		const next = value.trim();
		if (next === (current ?? '')) return;
		void apply(
			{ [field]: next || null } as DeclarationSet,
			next ? `Set ${what} of ${element.label} to ${next}` : `Cleared ${what} of ${element.label}`
		);
	}

	/**
	 * Go to the definition a reference in the declaration names (`Operator` in
	 * `stakeholder operator : Operator`), resolved as go-to-definition in the
	 * text resolves it: a project definition is selected, a library one opens.
	 */
	async function goTo(reference: string) {
		const text = workspace.text(element.file);
		const { from, to } = element.span;
		if (!ui || text === undefined || from === undefined || to === undefined) return;
		const name = reference.replace(/^~/, '');
		const header = text.slice(from, to);
		const at = header.search(new RegExp(`[:>~,\\s]${escapeRegExp(name)}(?![\\w'])`));
		if (at < 0) return;
		// On the last segment of a qualified name: `DroneComponents::Battery` goes to Battery.
		const last = name.lastIndexOf('::');
		const offset = from + at + 1 + (last >= 0 ? last + 2 : 0);
		const target = await engine.definition(workspace.sourceFiles(), element.file, offset);
		if (!target) {
			toasts.show(`${name} is not defined anywhere the project can see.`);
			return;
		}
		if ('library' in target) {
			ui.open({ kind: 'library', path: target.library.path, line: target.library.line });
			return;
		}
		const file = workspace.text(target.path) ?? '';
		const found = elementAt(workspace.elements, target.path, utf16ToByte(file, target.from));
		if (found) ui.select(found.key, 'inspector');
	}

	const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !(event.currentTarget instanceof HTMLTextAreaElement)) {
			(event.currentTarget as HTMLInputElement).blur();
		}
	}
</script>

{#if error}
	<p class="error">{error}</p>
{:else if details}
	<div class="form">
		{#if !isPackage}
			<label>
				<span>ID</span>
				<input
					value={details.shortName ?? ''}
					placeholder="e.g. SYS-012"
					onblur={(e) => commit('shortName', e.currentTarget.value, details?.shortName, 'the ID')}
					{onkeydown}
				/>
			</label>
		{/if}

		{#if typed}
			<div class="field">
				<label class="label" for="{uid}-type"
					>Type <small
						>({kind === 'attribute'
							? 'a value type'
							: `${/^[aeio]/.test(kind) ? 'an' : 'a'} ${kind} def`})</small
					></label
				>
				<TypePicker
					id="{uid}-type"
					value={details.type ?? ''}
					{kind}
					file={fileText}
					{workspace}
					placeholder="Choose or type a definition"
					create={owningPackage
						? {
								label: (name) => `New ${kind} def ${name}`,
								run: (name) => void createType(name)
							}
						: undefined}
					oncommit={(next) => commit('type', next, details?.type, 'the type')}
				/>
				{#if ui && details.type}
					<button type="button" class="goto" onclick={() => void goTo(details!.type!)}>
						<CornerDownRight size={14} aria-hidden="true" /> Go to {details.type.replace(/^~/, '')}
					</button>
				{/if}
			</div>
			<div class="row">
				<label>
					<span>How many</span>
					<input
						value={(details.multiplicity ?? '').replace(/^\[|\]$/g, '')}
						placeholder="1"
						inputmode="numeric"
						onblur={(e) =>
							commit(
								'multiplicity',
								e.currentTarget.value,
								(details?.multiplicity ?? '').replace(/^\[|\]$/g, ''),
								'the multiplicity'
							)}
						{onkeydown}
					/>
				</label>
				{#if hasDirection}
					<label>
						<span>Direction</span>
						<select
							value={details.direction ?? ''}
							onchange={(e) =>
								void apply(
									{ direction: (e.currentTarget.value || null) as DeclarationSet['direction'] },
									`Set the direction of ${element.label}`
								)}
						>
							<option value="">—</option>
							<option value="in">in</option>
							<option value="out">out</option>
							<option value="inout">inout</option>
						</select>
					</label>
				{/if}
			</div>
			{#if hasValue}
				<label>
					<span>Value <small>(a number with units, or an expression)</small></span>
					<input
						class="mono"
						value={details.value ?? ''}
						placeholder="e.g. 1.2 [kg]"
						aria-describedby={result ? `${uid}-computed` : undefined}
						onblur={(e) => commit('value', e.currentTarget.value, details?.value, 'the value')}
						{onkeydown}
					/>
				</label>
				{#if result && computed}
					<div class="computed" id="{uid}-computed" aria-live="polite">
						{#if computed.kind === 'undecided'}
							<span class="result undecided">= ?</span>
							<span class="note">Not computed.</span>
							<button type="button" class="why" aria-expanded={why} onclick={() => (why = !why)}
								>Why?</button
							>
							{#if why}<p class="reason">{computed.reason}.</p>{/if}
						{:else}
							<span class="result"><span class="visually-hidden">Comes to </span>= {result}</span>
						{/if}
					</div>
				{/if}
				{#if ui && valueOwner}
					<div class="value-actions">
						<button
							type="button"
							onclick={() =>
								(ui.create = { kind: 'rollup', element: valueOwner.key, attribute: element.name })}
						>
							<Sigma size={14} aria-hidden="true" /> Add up over its parts
						</button>
						<button
							type="button"
							onclick={() =>
								(ui.create = { kind: 'limit', element: valueOwner.key, attribute: element.name })}
						>
							<Gauge size={14} aria-hidden="true" /> Set a limit
						</button>
					</div>
				{/if}
			{/if}
		{:else if isDef}
			<div class="field">
				<span class="label">Specializes</span>
				<div class="chips">
					{#each details.specializes as general (general)}
						<span class="chip">
							{#if ui}
								<button
									type="button"
									class="chip-name"
									title="Go to {general}"
									onclick={() => void goTo(general)}>{general}</button
								>
							{:else}
								{general}
							{/if}
							<button
								type="button"
								aria-label="Remove {general}"
								onclick={() =>
									void apply(
										{ specializes: details!.specializes.filter((s) => s !== general) },
										`${element.label} no longer specializes ${general}`
									)}>×</button
							>
						</span>
					{/each}
					<div class="add-super">
						<TypePicker
							id="{uid}-specializes"
							value=""
							{kind}
							file={fileText}
							{workspace}
							label="Add a more general definition"
							placeholder="Add a more general definition"
							exclude={[element.name, ...details.specializes]}
							clearOnCommit
							oncommit={(general) =>
								void apply(
									{ specializes: [...details!.specializes, general] },
									`${element.label} now specializes ${general}`
								)}
						/>
					</div>
				</div>
			</div>
			<label class="check">
				<input
					type="checkbox"
					checked={!!details.abstract}
					onchange={(e) =>
						void apply(
							{ abstract: e.currentTarget.checked },
							e.currentTarget.checked
								? `${element.label} is now abstract`
								: `${element.label} is no longer abstract`
						)}
				/>
				<span>Abstract <small>(only used through more specific definitions)</small></span>
			</label>
		{/if}

		<label>
			<span>Documentation <small>(its doc comment)</small></span>
			<textarea
				rows="3"
				value={details.doc ?? ''}
				placeholder="What is this, in plain words?"
				onblur={(e) => commit('doc', e.currentTarget.value, details?.doc, 'the documentation')}
			></textarea>
		</label>
	</div>
{/if}

<style>
	.form {
		display: grid;
		gap: var(--space-3);
	}
	label,
	.field {
		display: grid;
		gap: 4px;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	small {
		color: var(--text-3);
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	input:not([type='checkbox']),
	select,
	textarea {
		width: 100%;
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: max(var(--text-sm), 16px);
	}
	@media (pointer: fine) {
		input:not([type='checkbox']),
		select,
		textarea {
			font-size: var(--text-sm);
		}
	}
	textarea {
		padding: var(--space-2) var(--space-3);
		resize: vertical;
	}
	.mono {
		font-family: var(--font-mono);
	}
	/* What the value's expression comes to: quiet, under the field it explains. */
	.value-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.value-actions button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text-2);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.value-actions button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	@media (pointer: coarse) {
		.value-actions button {
			min-height: 2.75rem;
		}
	}
	.computed {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px var(--space-2);
		margin-top: calc(-1 * var(--space-2));
		padding-left: var(--space-3);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.result {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.result.undecided {
		color: var(--text-3);
	}
	.note {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.why {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-xs);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.reason {
		flex-basis: 100%;
		margin: 2px 0 0;
		color: var(--text-2);
		font-size: var(--text-xs);
		line-height: 1.45;
	}
	input:focus,
	select:focus,
	textarea:focus {
		outline: 2px solid var(--focus);
		outline-offset: 0;
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px 4px 2px 8px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.chip button {
		width: 1.5rem;
		height: 1.5rem;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.chip button.chip-name {
		width: auto;
		height: auto;
		padding: 0;
		border-radius: 0;
		color: var(--accent);
		font: inherit;
	}
	.chip button.chip-name:hover {
		text-decoration: underline;
	}
	.goto {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		justify-self: start;
		min-height: 2rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.goto:hover {
		text-decoration: underline;
	}
	.add-super {
		flex: 1 1 100%;
		min-width: 0;
	}
	.label {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.error {
		color: var(--danger);
		font-size: var(--text-sm);
	}
</style>
