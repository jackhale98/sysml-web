<script lang="ts">
	import type { Engine } from '#lib/engine/client.ts';
	import type { DeclarationSet, ElementDetails } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import TypePicker from './TypePicker.svelte';

	/**
	 * The editable parts of an element's declaration — ID, type,
	 * specialization, multiplicity, value, direction, abstract and doc — as a
	 * form. Each change becomes one minimal edit of the SysML text, with Undo.
	 */
	let {
		element,
		workspace,
		engine
	}: { element: ModelElement; workspace: Workspace; engine: Engine } = $props();

	let details = $state<ElementDetails | null>(null);
	let error = $state<string | null>(null);
	let generation = 0;

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
				element: element.name,
				line: element.span.start_row,
				set: { type: name }
			});
			if (typed) return typed;
			return workspace.edit(element.file, {
				op: 'insertMember',
				path: element.file,
				source: workspace.text(element.file) ?? source,
				parent: pkg.name,
				text: `${kind} def ${name} {\n}`
			});
		});
		if (error) toasts.show(error, { tone: 'error' });
		else if (workspace.undoStack.length > before)
			toasts.show(label, {
				tone: 'success',
				action: { label: 'Undo', run: () => workspace.undo() }
			});
	}

	async function apply(set: DeclarationSet, label: string) {
		const source = workspace.text(element.file);
		if (source === undefined) return;
		const before = workspace.undoStack.length;
		const result = await workspace.transact(label, () =>
			workspace.edit(element.file, {
				op: 'setDeclaration',
				path: element.file,
				source,
				element: element.name,
				line: element.span.start_row,
				set
			})
		);
		if (result) {
			toasts.show(result, { tone: 'error' });
		} else if (workspace.undoStack.length > before) {
			toasts.show(label, {
				tone: 'success',
				action: { label: 'Undo', run: () => workspace.undo() }
			});
		}
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
					>Type <small>({kind === 'attribute' ? 'a value type' : `a ${kind} def`})</small></label
				>
				<TypePicker
					id="{uid}-type"
					value={details.type ?? ''}
					{kind}
					file={fileText}
					{workspace}
					{engine}
					placeholder="Choose or type a definition"
					create={owningPackage
						? {
								label: (name) => `New ${kind} def ${name}`,
								run: (name) => void createType(name)
							}
						: undefined}
					oncommit={(next) => commit('type', next, details?.type, 'the type')}
				/>
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
						onblur={(e) => commit('value', e.currentTarget.value, details?.value, 'the value')}
						{onkeydown}
					/>
				</label>
			{/if}
		{:else if isDef}
			<div class="field">
				<span class="label">Specializes</span>
				<div class="chips">
					{#each details.specializes as general (general)}
						<span class="chip">
							{general}
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
							{engine}
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
			<span>Description</span>
			<textarea
				rows="3"
				value={details.doc ?? ''}
				placeholder="What is this, in plain words?"
				onblur={(e) => commit('doc', e.currentTarget.value, details?.doc, 'the description')}
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
