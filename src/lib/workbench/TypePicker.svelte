<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { librarySearch } from '#lib/library/library.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { segments } from './palette.ts';
	import {
		commonValueTypes,
		definitionKinds,
		librarySuggestions,
		projectSuggestions,
		type TypeSuggestion
	} from './typeSuggestions.ts';

	/**
	 * A text field for a type (or a more general definition) that suggests
	 * what already exists while you type: the project's definitions first,
	 * then the standard library, and, when nothing fits, a new definition.
	 * The suggestions open in the flow below the field, so they fit a phone's
	 * details sheet as well as the inspector.
	 */
	let {
		id,
		value,
		kind,
		file,
		workspace,
		placeholder = '',
		label,
		exclude = [],
		clearOnCommit = false,
		create,
		oncommit
	}: {
		id: string;
		/** The current value as written in the model. */
		value: string;
		/** Kind of the element being typed (`part`, `attribute`, …). */
		kind: string;
		/** Text of the element's file, to know what it imports. */
		file: string;
		workspace: Workspace;
		placeholder?: string;
		/** Accessible name, when no visible `<label for>` names the field. */
		label?: string;
		exclude?: string[];
		/** Empty the field after each choice (adding to a list). */
		clearOnCommit?: boolean;
		/** Offer to create a definition with the typed name. */
		create?: { label: (name: string) => string; run: (name: string) => void };
		oncommit: (text: string) => void;
	} = $props();

	let text = $state('');
	let open = $state(false);
	let active = $state(-1);
	let focused = false;
	let library = $state<TypeSuggestion[]>([]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let request = 0;

	// Show the model's value whenever the field isn't being edited.
	$effect(() => {
		const v = clearOnCommit ? '' : value;
		if (!focused) text = v;
	});

	const kinds = $derived(definitionKinds(kind));
	const query = $derived(text.trim() === value.trim() && !clearOnCommit ? '' : text.trim());
	const project = $derived(
		// Everything defined when nothing is typed; the best few matches otherwise.
		projectSuggestions(workspace.elements, kinds.project, query, exclude).slice(0, query ? 8 : 60)
	);

	// Library matches arrive from the library worker shortly after typing pauses.
	$effect(() => {
		const q = query;
		const wanted = kinds.library;
		const source = file;
		const current = ++request;
		clearTimeout(timer);
		if (q.length < 2) {
			library = kind === 'attribute' && !q ? commonValueTypes(source) : [];
			return;
		}
		timer = setTimeout(() => {
			void librarySearch(q, 60)
				.then((hits) => {
					if (current === request)
						library = librarySuggestions(hits, wanted, q, source).slice(0, 8);
				})
				.catch(() => {
					if (current === request) library = [];
				});
		}, 120);
		return () => clearTimeout(timer);
	});

	const canCreate = $derived.by(() => {
		if (!create) return false;
		const name = text.trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name === value.trim()) return false;
		return ![...project, ...library].some((s) => s.label === name || s.insert === name);
	});
	type Option =
		{ type: 'suggestion'; suggestion: TypeSuggestion } | { type: 'create'; name: string };
	// An empty attribute type starts with the common value types; otherwise the project leads.
	const commonFirst = $derived(kind === 'attribute' && !query);
	const options = $derived<Option[]>([
		...(commonFirst ? [...library, ...project] : [...project, ...library]).map((suggestion) => ({
			type: 'suggestion' as const,
			suggestion
		})),
		...(canCreate ? [{ type: 'create' as const, name: text.trim() }] : [])
	]);
	const listId = $derived(`${id}-suggestions`);
	const optionId = (i: number) => `${id}-option-${i}`;

	function commit(next: string) {
		open = false;
		active = -1;
		if (next.trim() !== (clearOnCommit ? '' : value.trim())) oncommit(next.trim());
		text = clearOnCommit ? '' : next.trim();
	}

	function choose(option: Option) {
		if (option.type === 'create') {
			open = false;
			text = clearOnCommit ? '' : option.name;
			create?.run(option.name);
			return;
		}
		commit(option.suggestion.insert);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.isComposing) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) open = true;
			const count = options.length;
			if (!count) return;
			active = event.key === 'ArrowDown' ? (active + 1) % count : (active - 1 + count) % count;
			document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const option = open && active >= 0 ? options[active] : undefined;
			if (option) choose(option);
			else commit(text);
		} else if (event.key === 'Escape' && open) {
			event.preventDefault();
			event.stopPropagation();
			open = false;
			active = -1;
			text = clearOnCommit ? '' : value;
		}
	}
</script>

<div class="picker">
	<input
		{id}
		type="text"
		role="combobox"
		autocomplete="off"
		autocapitalize="off"
		spellcheck="false"
		aria-label={label}
		aria-autocomplete="list"
		aria-expanded={open && options.length > 0}
		aria-controls={listId}
		aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
		{placeholder}
		bind:value={text}
		onfocus={() => {
			focused = true;
			open = true;
		}}
		onblur={() => {
			focused = false;
			open = false;
			active = -1;
			// Leaving the field keeps a name only when it is one of the suggestions;
			// anything else (half typed) is put back. Enter keeps what was typed.
			const typed = text.trim();
			const known = options.find(
				(o) =>
					o.type === 'suggestion' && (o.suggestion.insert === typed || o.suggestion.label === typed)
			);
			if (!clearOnCommit && known?.type === 'suggestion') commit(known.suggestion.insert);
			else text = clearOnCommit ? '' : value;
		}}
		oninput={() => {
			open = true;
			active = -1;
		}}
		{onkeydown}
	/>
	{#if open && options.length}
		<ul class="options" id={listId} role="listbox" aria-label="Suggestions">
			{#each options as option, i (option.type === 'create' ? 'create' : option.suggestion.id)}
				{@const first =
					option.type === 'suggestion' &&
					(i === 0 ||
						options[i - 1]?.type !== 'suggestion' ||
						(options[i - 1] as { suggestion: TypeSuggestion }).suggestion.source !==
							option.suggestion.source)}
				{#if first && option.type === 'suggestion'}
					<li class="heading" role="presentation">
						{option.suggestion.source === 'project'
							? 'In this project'
							: commonFirst
								? 'Common value types'
								: 'Standard library'}
					</li>
				{/if}
				<!-- Keys reach the options through the field (aria-activedescendant), as a combobox should. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={optionId(i)}
					role="option"
					aria-selected={i === active}
					class:active={i === active}
					onpointerdown={(e) => e.preventDefault()}
					onclick={() => choose(option)}
				>
					{#if option.type === 'create'}
						<span class="new" aria-hidden="true"><Plus size={14} /></span>
						<span class="text">
							<span class="name">{create?.label(option.name)}</span>
						</span>
					{:else}
						{@const s = option.suggestion}
						<KindGlyph kind={s.kind} isDefinition={true} size={20} />
						<span class="text">
							<span class="name"
								>{#each segments(s.label, s.ranges) as seg, k (k)}{#if seg.hit}<mark
											>{seg.text}</mark
										>{:else}{seg.text}{/if}{/each}</span
							>
							<span class="description"
								>{#if s.description}<span>{s.description}</span>{/if}<span class="detail"
									>{s.detail}</span
								></span
							>
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.picker {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	input {
		width: 100%;
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-family: var(--font-mono);
		font-size: max(var(--text-sm), 16px);
	}
	@media (pointer: fine) {
		input {
			font-size: var(--text-sm);
		}
	}
	input:focus {
		outline: 2px solid var(--focus);
		outline-offset: 0;
	}
	.options {
		display: grid;
		max-height: 18rem;
		margin: 0;
		padding: 4px;
		overflow-y: auto;
		overscroll-behavior: contain;
		list-style: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		box-shadow: var(--shadow-md);
	}
	.heading {
		padding: 6px 8px 2px;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	[role='option'] {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.25rem;
		padding: 4px 8px;
		border-radius: calc(var(--radius-sm) - 2px);
		color: var(--text);
		cursor: pointer;
	}
	[role='option']:hover,
	.active {
		background: var(--surface-2);
	}
	.active {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.text {
		display: grid;
		flex: 1;
		min-width: 0;
	}
	.name {
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	mark {
		background: transparent;
		color: var(--accent);
		font-weight: 700;
	}
	.description {
		overflow: hidden;
		color: var(--text-2);
		font-size: var(--text-xs);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.detail {
		color: var(--text-3);
	}
	.description > span + .detail::before {
		margin: 0 0.35em;
		content: '·';
	}
	.new {
		display: inline-grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 5px;
		background: var(--accent-weak);
		color: var(--accent);
	}
	@media (pointer: coarse) {
		[role='option'] {
			min-height: 2.75rem;
		}
	}
</style>
