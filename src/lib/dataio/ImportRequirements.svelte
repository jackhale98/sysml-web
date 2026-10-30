<script lang="ts">
	/**
	 * Import requirements from a spreadsheet: choose an .xlsx or .csv file (or
	 * paste cells copied from Excel or Google Sheets), say what each column
	 * holds, see the requirements it will make, and add them to the model as
	 * SysML in one undoable change. A ReqIF file (.reqif, .reqifz) from DOORS,
	 * Polarion, Jama and other requirements tools goes the same way: say what
	 * each attribute, object type and relation type is, see what it adds and
	 * changes, apply. A full-screen sheet on phones.
	 */
	import {
		ArrowLeft,
		ClipboardPaste,
		FileSpreadsheet,
		FileText,
		LoaderCircle,
		TriangleAlert,
		Upload,
		X
	} from '@lucide/svelte';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { undoAction } from '#lib/workbench/actions.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { decodeText, parseDelimited } from './csv.ts';
	import { applyImport } from './import-apply.ts';
	import {
		attributeLabel,
		buildContext,
		defaultDef,
		detectHeaderRow,
		detectTargets,
		freshTarget,
		planImport,
		targetOptions,
		type ImportContext,
		type ImportOptions,
		type ImportPlan,
		type RequirementDefInfo,
		type Target
	} from './import-plan.ts';
	import { problemList, readReqif, type ReqifDocument } from './reqif.ts';
	import {
		columnKind,
		defaultObjectRole,
		defaultRelationRole,
		detectReqifTargets,
		OBJECT_ROLES,
		planReqif,
		readRefinements,
		RELATION_ROLES,
		reqifColumns,
		reqifHasWork,
		reqifTarget,
		reqifTargetOptions,
		type ObjectRole,
		type ReqifOptions,
		type ReqifPlan,
		type RelationRole
	} from './reqif-plan.ts';
	import { requirementText } from './sysml-text.ts';

	let {
		workspace,
		ui,
		open = $bindable(false)
	}: { workspace: Workspace; ui: WorkbenchUi; open?: boolean } = $props();

	interface Source {
		name: string;
		sheets: { name: string; rows: string[][] }[];
	}

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let source = $state.raw<Source | null>(null);
	let sheetIndex = $state(0);
	let headerRow = $state(0);
	let targets = $state<Target[]>([]);
	/** The requirement definition's name, or '' for a plain `requirement`. */
	let defName = $state('');
	/** `new`, or the qualified name of an existing package. */
	let destinationKey = $state('new');
	let existing = $state<'skip' | 'update'>('skip');
	let error = $state<string | null>(null);
	let busy = $state(false);
	let reading = $state(false);
	let pasted = $state('');
	let dragging = $state(false);
	/** A ReqIF file, read: its attributes are matched instead of a sheet's columns. */
	let reqif = $state.raw<ReqifDocument | null>(null);
	let reqifTargets = $state<Target[]>([]);
	let objectRoles = $state<Record<string, ObjectRole>>({});
	let relationRoles = $state<Record<string, RelationRole>>({});

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function reset() {
		source = null;
		reqif = null;
		pasted = '';
		error = null;
		busy = false;
		destinationKey = 'new';
		existing = 'skip';
	}

	const context = $derived(
		open
			? buildContext(Object.values(workspace.analyses), workspace.files, workspace.requirements)
			: null
	);
	const def: RequirementDefInfo | null = $derived(
		context?.defs.find((d) => d.name === defName) ?? null
	);
	const rows = $derived(source?.sheets[sheetIndex]?.rows ?? []);
	const headers = $derived(rows[headerRow] ?? []);
	const dataRows = $derived(rows.slice(headerRow + 1));
	const columnCount = $derived(Math.max(headers.length, ...dataRows.map((r) => r.length), 0));
	const options = $derived(targetOptions(def));
	const fresh = $derived(context ? freshTarget(context) : null);

	const importOptions: ImportOptions | null = $derived.by(() => {
		if (!context || !fresh) return null;
		const pkg = context.packages.find((p) => p.qualifiedName === destinationKey);
		return {
			targets,
			def,
			destination: pkg
				? { kind: 'package', package: pkg }
				: { kind: 'new', path: fresh.path, name: fresh.name },
			existing
		};
	});

	const sheetPlan = $derived(
		importOptions && context && source
			? planImport(dataRows, headerRow + 2, importOptions, context)
			: null
	);

	// A ReqIF file: its attributes, object and relation types, and the plan for them.
	const columns = $derived(reqif ? reqifColumns(reqif) : []);
	const objectTypes = $derived(
		reqif ? [...reqif.types.values()].filter((t) => t.kind === 'object') : []
	);
	const relationTypes = $derived(
		reqif
			? [...reqif.types.values()].filter(
					(t) => t.kind === 'relation' && reqif!.relations.some((r) => r.type === t.id)
				)
			: []
	);
	const reqifFresh = $derived(reqif && context ? reqifTarget(reqif, context) : null);
	const reqifOptions: ReqifOptions | null = $derived.by(() => {
		if (!context || !reqifFresh) return null;
		const pkg = context.packages.find((p) => p.qualifiedName === destinationKey);
		return {
			targets: reqifTargets,
			objectRoles,
			relationRoles,
			def,
			destination: pkg
				? { kind: 'package', package: pkg }
				: { kind: 'new', path: reqifFresh.path, name: reqifFresh.name },
			existing
		};
	});
	const refinements = $derived(reqif ? readRefinements(workspace.files) : new Set<string>());
	const reqifPlan: ReqifPlan | null = $derived(
		reqif && reqifOptions && context ? planReqif(reqif, reqifOptions, context, refinements) : null
	);
	const plan: ImportPlan | ReqifPlan | null = $derived(reqif ? reqifPlan : sheetPlan);

	/** Rows (or ReqIF objects) whose ID is already in the model, however they are handled. */
	const known = $derived.by(() => {
		if (reqifPlan)
			return (
				reqifPlan.update.length +
				reqifPlan.unchanged +
				reqifPlan.skipped.filter((s) => s.reason.endsWith('already in the model')).length
			);
		return targets.includes('id')
			? dataRows.filter((r) => {
					const id = (r[targets.indexOf('id')] ?? '').trim();
					return id && context?.byId.has(id);
				}).length
			: 0;
	});

	/** Columns mapped to an attribute the chosen definition does not have. */
	const missingAttributes = $derived(
		(reqif ? reqifTargets : targets)
			.filter((t) => t.startsWith('attr:') && !def?.attributes.some((a) => `attr:${a.name}` === t))
			.map((t) => t.slice(5))
	);

	const canImport = $derived(
		reqifPlan
			? reqifHasWork(reqifPlan)
			: !!plan &&
					(targets.includes('id') || targets.includes('name') || targets.includes('doc')) &&
					plan.create.length + plan.update.length > 0
	);

	/** What the preview says about the ReqIF file itself: its problems, the attachments left out. */
	const fileNotes = $derived.by(() => {
		if (!reqif) return [];
		const notes = problemList(reqif).map((p) => `In the file: ${p}`);
		if (reqif.attachments.length)
			notes.push(
				`Attachments (images, embedded files) are not imported; the text names each one: ${reqif.attachments
					.slice(0, 3)
					.map((a) => `‘${a.split('/').pop()}’`)
					.join(
						', '
					)}${reqif.attachments.length > 3 ? ` and ${reqif.attachments.length - 3} more` : ''}.`
			);
		return notes;
	});

	/** How the preview names a row of the sheet, or an object of the ReqIF file. */
	function lineLabel(line: number): string {
		return reqifPlan ? `‘${reqifPlan.labels.get(line) ?? line}’` : `Row ${line}`;
	}

	/** Two values an attribute has in the file, to recognise it by. */
	function reqifSamples(index: number): string {
		const column = columns[index];
		if (!reqif || !column) return '';
		const values: string[] = [];
		for (const o of reqif.objects.values()) {
			for (const id of column.ids) {
				const v = o.values.get(id)?.replace(/\s+/g, ' ').trim();
				if (v && !values.includes(v)) values.push(v.length > 60 ? `${v.slice(0, 60)}…` : v);
			}
			if (values.length >= 2) break;
		}
		return values.join(' · ');
	}

	function objectCount(typeId: string): number {
		let n = 0;
		for (const o of reqif?.objects.values() ?? []) if (o.type === typeId) n++;
		return n;
	}

	/** Work out what each ReqIF attribute holds; keep choices people made unless they no longer apply. */
	function detectReqif(keepChoices: boolean) {
		const detected = detectReqifTargets(columns, def);
		const next = columns.map((_, c) => {
			const current = keepChoices ? reqifTargets[c] : undefined;
			const valid =
				current !== undefined &&
				current !== '' &&
				(!current.startsWith('attr:') || def?.attributes.some((a) => `attr:${a.name}` === current));
			return valid ? current : (detected[c] ?? '');
		});
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local bookkeeping
		const seen = new Set<Target>();
		reqifTargets = next.map((t) => {
			if (!t || seen.has(t)) return '';
			seen.add(t);
			return t;
		});
	}

	function setReqifTarget(column: number, value: Target) {
		reqifTargets = reqifTargets.map((t, c) =>
			c === column ? value : value && t === value ? '' : t
		);
	}

	function loadReqif(doc: ReqifDocument) {
		if (!doc.objects.size) {
			error = `There is nothing to import in ${doc.name}: it has no spec objects.`;
			return;
		}
		error = null;
		reqif = doc;
		existing = 'update';
		if (context && !defName) defName = defaultDef(context)?.name ?? '';
		objectRoles = Object.fromEntries(
			[...doc.types.values()]
				.filter((t) => t.kind === 'object')
				.map((t) => [t.id, defaultObjectRole(t)])
		);
		relationRoles = Object.fromEntries(
			[...doc.types.values()]
				.filter((t) => t.kind === 'relation')
				.map((t) => [t.id, defaultRelationRole(t)])
		);
		detectReqif(false);
	}

	function samples(column: number): string {
		const values = dataRows
			.map((r) => (r[column] ?? '').replace(/\s+/g, ' ').trim())
			.filter(Boolean);
		return [...new Set(values)].slice(0, 2).join(' · ');
	}

	function plural(n: number, word: string): string {
		return `${n} ${word}${n === 1 ? '' : 's'}`;
	}

	/** Spreadsheet column letters, as people see them in Excel. */
	function letter(index: number): string {
		let name = '';
		for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
			name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
		}
		return name;
	}

	/** Work out what each column holds; keep choices people made unless they no longer apply. */
	function detect(keepChoices: boolean) {
		const detected = detectTargets(headers, def);
		const next = Array.from({ length: columnCount }, (_, c) => {
			const current = keepChoices ? targets[c] : undefined;
			const valid =
				current !== undefined &&
				current !== '' &&
				(!current.startsWith('attr:') || def?.attributes.some((a) => `attr:${a.name}` === current));
			return valid ? current : (detected[c] ?? '');
		});
		// A target detected for a new column may already be chosen for another.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local bookkeeping
		const seen = new Set<Target>();
		targets = next.map((t) => {
			if (!t || seen.has(t)) return '';
			seen.add(t);
			return t;
		});
	}

	function chooseSheet(index: number) {
		sheetIndex = index;
		headerRow = detectHeaderRow(source?.sheets[index]?.rows ?? []);
		detect(false);
	}

	function load(next: Source) {
		if (!next.sheets.some((s) => s.rows.some((r) => r.some((c) => c.trim())))) {
			error = 'There is nothing to import in that: no rows with text in them.';
			return;
		}
		error = null;
		source = next;
		if (context && !defName) defName = defaultDef(context)?.name ?? '';
		const first = next.sheets.findIndex((s) => s.rows.length > 1);
		chooseSheet(Math.max(0, first));
	}

	async function readFile(file: File | undefined) {
		if (!file) return;
		error = null;
		reading = true;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
			if (/\.reqifz?$/i.test(file.name) || isReqifXml(bytes)) {
				loadReqif(await readReqif(bytes, file.name));
				return;
			}
			const oldExcel = bytes[0] === 0xd0 && bytes[1] === 0xcf;
			if (zipped || oldExcel || /\.xls[xm]?$/i.test(file.name)) {
				const { readXlsx } = await import('./xlsx-read.ts');
				load({ name: file.name, sheets: await readXlsx(bytes) });
			} else {
				load({
					name: file.name,
					sheets: [{ name: file.name, rows: parseDelimited(decodeText(bytes)).rows }]
				});
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			reading = false;
		}
	}

	/** An XML file whose root is `<REQ-IF>`, whatever its name. */
	function isReqifXml(bytes: Uint8Array): boolean {
		const head = new TextDecoder().decode(bytes.subarray(0, 2048));
		return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(\w+:)?REQ-IF[\s>]/.test(
			head.replace(/^\uFEFF/, '')
		);
	}

	function usePasted(text = pasted) {
		if (!text.trim()) return;
		load({ name: 'pasted cells', sheets: [{ name: 'Pasted', rows: parseDelimited(text).rows }] });
	}

	function onpaste(event: ClipboardEvent) {
		const text = event.clipboardData?.getData('text/plain') ?? '';
		// Cells copied from a spreadsheet: go straight on to the columns.
		if (text.includes('\t')) {
			event.preventDefault();
			pasted = text;
			usePasted(text);
		}
	}

	function setTarget(column: number, value: Target) {
		targets = targets.map((t, c) => (c === column ? value : value && t === value ? '' : t));
	}

	async function runImport() {
		const name = reqif?.name ?? source?.name;
		if (!plan || !name) return;
		if (reqif ? !reqifOptions : !importOptions) return;
		busy = true;
		error = null;
		const today = new Date().toISOString().slice(0, 10);
		const tool = reqif?.tool ? `, exported from ${reqif.tool},` : '';
		const doc = `Requirements imported from ${name}${tool} on ${today}.`;
		const created = plan.create.length;
		const updated = plan.update.length;
		const skipped = plan.skipped.length;
		const label =
			created > 0
				? `Imported ${plural(created, 'requirement')} from ${name}`
				: updated > 0
					? `Updated ${plural(updated, 'requirement')} from ${name}`
					: `Imported ${name}`;
		const before = workspace.lastEdit;
		let result: { created: number; updated: number } | null = null;
		const currentPlan = plan;
		const currentOptions = importOptions;
		const currentReqif =
			reqifPlan && reqifOptions ? { plan: reqifPlan, options: reqifOptions } : null;
		const failure = await workspace.transact(label, async () => {
			let outcome;
			if (currentReqif) {
				const { applyReqif } = await import('./reqif-apply.ts');
				outcome = await applyReqif(workspace, currentReqif.plan, currentReqif.options, doc);
			} else outcome = await applyImport(workspace, currentPlan, currentOptions!, doc);
			if (typeof outcome === 'string') return outcome;
			result = outcome;
			return null;
		});
		busy = false;
		if (failure || !result) {
			// Put back whatever part of the import was written.
			if (workspace.lastEdit !== before) workspace.undo();
			error = failure ?? 'The import did not finish.';
			return;
		}
		open = false;
		const parts = [
			created ? `Imported ${plural(created, 'requirement')}` : '',
			updated ? `${created ? 'updated' : 'Updated'} ${updated}` : ''
		].filter(Boolean);
		if (!parts.length) parts.push(`Imported ${name}`);
		const edit = workspace.lastEdit;
		toasts.show(`${parts.join(' and ')}${skipped ? ` (${skipped} skipped)` : ''}`, {
			tone: 'success',
			...(edit !== undefined ? { action: undoAction(workspace, edit) } : {})
		});
		ui.open({ kind: 'requirements' });
	}

	function onbackdrop(event: MouseEvent) {
		if (event.target === dialog && !busy) open = false;
	}

	function ondrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		void readFile(event.dataTransfer?.files[0]);
	}
</script>

{#snippet settings(context: ImportContext)}
	<section aria-labelledby="{uid}-where">
		<h3 id="{uid}-where">How they are added</h3>
		<div class="settings">
			<label class="field">
				<span>Each one is a</span>
				<select bind:value={defName} onchange={() => (reqif ? detectReqif(true) : detect(true))}>
					<option value="">requirement (no definition)</option>
					{#each context.defs as d (d.file + d.name)}
						<option value={d.name}
							>{d.label}{d.attributes.length
								? ` · ${d.attributes.map((a) => attributeLabel(a.name).toLowerCase()).join(', ')}`
								: ''}</option
						>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Put them in</span>
				<select bind:value={destinationKey}>
					<option value="new">A new file, {(reqif ? reqifFresh : fresh)?.path}</option>
					{#each context.packages as p (p.file + p.qualifiedName)}
						<option value={p.qualifiedName}>{p.qualifiedName} ({p.file})</option>
					{/each}
				</select>
			</label>
		</div>
		{#if missingAttributes.length}
			<p class="warning">
				<TriangleAlert size={14} aria-hidden="true" />
				<span>
					{def ? def.label : 'A plain requirement'} has no {missingAttributes
						.map((a) => attributeLabel(a).toLowerCase())
						.join(' or ')}, so those {reqif ? 'attributes are' : 'columns are'} left out. Choose a definition
					that has them
					{#if context.defs.some( (d) => missingAttributes.every( (m) => d.attributes.some((a) => a.name === m) ) )}(such
						as
						{context.defs.find((d) =>
							missingAttributes.every((m) => d.attributes.some((a) => a.name === m))
						)?.label}){/if}.
				</span>
			</p>
		{/if}
		{#if known}
			<fieldset class="existing">
				<legend>{plural(known, 'ID')} already in the model</legend>
				<label>
					<input type="radio" bind:group={existing} value="skip" /> Skip {reqif
						? 'them'
						: 'those rows'}
				</label>
				<label>
					<input type="radio" bind:group={existing} value="update" /> Update what differs
				</label>
			</fieldset>
		{/if}
	</section>
{/snippet}

{#snippet preview(plan: ImportPlan | ReqifPlan)}
	<section aria-labelledby="{uid}-preview">
		<h3 id="{uid}-preview">Preview</h3>
		<p class="summary" role="status">
			<strong>{plural(plan.create.length, 'new requirement')}</strong>
			{#if plan.update.length}· {plural(plan.update.length, 'update')}{/if}
			{#if plan.unchanged}· {plan.unchanged} unchanged{/if}
			{#if plan.skipped.length}· {plan.skipped.length} skipped{/if}
			{#if 'counts' in plan}
				{#if plan.counts.packages}· {plural(plan.counts.packages, 'new package')}{/if}
				{#if plan.counts.derivations}· {plural(plan.counts.derivations, 'derivation')}{/if}
				{#if plan.counts.refinements}· {plural(plan.counts.refinements, 'refinement')}{/if}
			{/if}
		</p>
		{#if plan.notes.length || plan.skipped.length || fileNotes.length}
			<ul class="notes" aria-label="What is left out">
				{#each fileNotes as note (note)}<li>{note}</li>{/each}
				{#each plan.notes as note (note)}<li>{note}</li>{/each}
				{#each plan.skipped.slice(0, 4) as skip (skip.line)}
					<li>{lineLabel(skip.line)} skipped: {skip.reason}.</li>
				{/each}
				{#if plan.skipped.length > 4}<li>
						…and {plan.skipped.length - 4} more skipped.
					</li>{/if}
			</ul>
		{/if}
		<ul class="cards" aria-label="The first requirements to be added">
			{#each plan.create.slice(0, 4) as item (item.line)}
				{@const spec = item.spec}
				<li class="card">
					<div class="card-title">
						{#if spec.id}<code class="id">{spec.id}</code>{/if}
						<strong>{spec.name}</strong>
					</div>
					{#if spec.doc}<p class="doc">{spec.doc}</p>{/if}
					<div class="chips">
						{#each spec.attributes as a (a.name)}
							<span class="chip"
								><span class="k">{attributeLabel(a.name)}</span>
								{a.value.kind === 'enum'
									? a.value.literals.join(', ')
									: String('value' in a.value ? a.value.value : '')}</span
							>
						{/each}
						{#if spec.status}<span class="chip"><span class="k">Status</span> {spec.status}</span
							>{/if}
						{#if spec.owner}<span class="chip"><span class="k">Owner</span> {spec.owner}</span>{/if}
						{#if item.parents.length}<span class="chip"
								><span class="k">From</span> {item.parents.join(', ')}</span
							>{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if plan.create.length > 4}
			<p class="muted">…and {plural(plan.create.length - 4, 'more requirement')}.</p>
		{/if}
		{#if plan.update.length}
			<ul class="updates" aria-label="Changes to requirements already in the model">
				{#each plan.update.slice(0, 4) as u (u.line)}
					<li>
						<code class="id">{u.existing.row.id}</code>
						{u.changes
							.map((c) => `${c.label}: ${c.to.length > 40 ? `${c.to.slice(0, 40)}…` : c.to}`)
							.join(' · ')}
					</li>
				{/each}
			</ul>
		{/if}
		{#if plan.create.length}
			<details>
				<summary>Show the SysML</summary>
				<!-- Focusable so keyboard users can scroll wide code. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<pre tabindex="0"><code
						>{plan.create
							.slice(0, 3)
							.map((p) => requirementText(p.spec))
							.join('\n\n')}{plan.create.length > 3 ? '\n\n…' : ''}</code
					></pre>
			</details>
		{/if}
	</section>
{/snippet}

<!-- A backdrop click closes it; so does Escape. -->
<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	onclose={() => {
		open = false;
		reset();
	}}
	onclick={onbackdrop}
	oncancel={(e) => busy && e.preventDefault()}
>
	{#if open}
		<header>
			<span class="mark"><KindGlyph kind="requirement" isDefinition={false} size={30} /></span>
			<div class="titles">
				<h2 id="{uid}-title">Import requirements</h2>
				<p>
					{#if reqif}Step 2 of 2 · Match the attributes{:else if source}Step 2 of 2 · Match the
						columns{:else}Step 1 of 2 · Choose the file{/if}
				</p>
			</div>
			<button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>
				<X size={18} />
			</button>
		</header>

		<div class="body">
			{#if !source && !reqif}
				<p class="intro">
					Bring requirements in from Excel, Google Sheets or a CSV file, or from a ReqIF file
					exported by DOORS, Polarion, Jama or another requirements tool. Each row (or ReqIF object)
					becomes a
					<code>requirement</code> in your SysML model, with its ID, title and text; you choose what each
					column means next.
				</p>
				<label
					class="drop"
					class:dragging
					ondragover={(e) => {
						e.preventDefault();
						dragging = true;
					}}
					ondragleave={() => (dragging = false)}
					{ondrop}
				>
					<input
						type="file"
						class="visually-hidden"
						accept=".xlsx,.xlsm,.csv,.tsv,.txt,.reqif,.reqifz,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
						onchange={(e) => void readFile(e.currentTarget.files?.[0])}
					/>
					{#if reading}
						<LoaderCircle size={26} class="spin" aria-hidden="true" />
						<strong>Reading the file…</strong>
					{:else}
						<Upload size={26} aria-hidden="true" />
						<strong>Choose a file</strong>
						<span
							>Excel (.xlsx), CSV or ReqIF (.reqif, .reqifz){ui.phone
								? ''
								: ' · or drop it here'}</span
						>
					{/if}
				</label>

				<div class="or" aria-hidden="true"><span>or</span></div>

				<div class="paste">
					<label for="{uid}-paste"
						><ClipboardPaste size={15} aria-hidden="true" /> Paste cells</label
					>
					<textarea
						id="{uid}-paste"
						rows="4"
						bind:value={pasted}
						{onpaste}
						placeholder="Copy the rows in Excel or Google Sheets, with the heading row, and paste them here"
					></textarea>
					<button
						type="button"
						class="secondary"
						disabled={!pasted.trim()}
						onclick={() => usePasted()}>Use these cells</button
					>
				</div>
			{:else if reqif && plan && context}
				<div class="source-line">
					<span class="file">
						<FileText size={16} aria-hidden="true" />
						<strong>{reqif.name}</strong>
						<span class="muted"
							>· {plural(reqif.objects.size, 'object')}{reqif.tool
								? ` · from ${reqif.tool}`
								: ''}</span
						>
					</span>
				</div>

				<section aria-labelledby="{uid}-attributes">
					<h3 id="{uid}-attributes">What each attribute holds</h3>
					<ul class="columns">
						{#each columns as column, c (column.name)}
							<li class:skipped={!reqifTargets[c]}>
								<div class="column">
									<span class="name">
										<strong>{column.name}</strong>
										<small
											>{columnKind(column)}{reqifSamples(c) ? ` · ${reqifSamples(c)}` : ''}</small
										>
									</span>
								</div>
								<select
									aria-label="Attribute {column.name} becomes"
									value={reqifTargets[c] ?? ''}
									onchange={(e) => setReqifTarget(c, e.currentTarget.value as Target)}
								>
									<option value="">Leave it out</option>
									{#each reqifTargetOptions(def) as option (option.value)}
										<option value={option.value}>{option.label}</option>
									{/each}
									{#if reqifTargets[c]?.startsWith('attr:') && !reqifTargetOptions(def).some((o) => o.value === reqifTargets[c])}
										<option value={reqifTargets[c]}
											>{attributeLabel(reqifTargets[c]!.slice(5))} (not in this type)</option
										>
									{/if}
								</select>
							</li>
						{/each}
					</ul>
				</section>

				{#if objectTypes.length > 1 || relationTypes.length}
					<section aria-labelledby="{uid}-types">
						<h3 id="{uid}-types">What each type is</h3>
						<ul class="columns">
							{#each objectTypes as type (type.id)}
								<li class:skipped={objectRoles[type.id] === 'skip'}>
									<div class="column">
										<span class="name">
											<strong>{type.name}</strong>
											<small>{plural(objectCount(type.id), 'object')}</small>
										</span>
									</div>
									<select
										aria-label="Objects of type {type.name} are"
										value={objectRoles[type.id] ?? 'requirement'}
										onchange={(e) =>
											(objectRoles = {
												...objectRoles,
												[type.id]: e.currentTarget.value as ObjectRole
											})}
									>
										{#each OBJECT_ROLES as role (role.value)}
											<option value={role.value}>{role.label}</option>
										{/each}
									</select>
								</li>
							{/each}
							{#each relationTypes as type (type.id)}
								<li class:skipped={relationRoles[type.id] === 'skip'}>
									<div class="column">
										<span class="name">
											<strong>{type.name}</strong>
											<small
												>{plural(
													reqif.relations.filter((r) => r.type === type.id).length,
													'relation'
												)}</small
											>
										</span>
									</div>
									<select
										aria-label="Relations of type {type.name} are"
										value={relationRoles[type.id] ?? 'skip'}
										onchange={(e) =>
											(relationRoles = {
												...relationRoles,
												[type.id]: e.currentTarget.value as RelationRole
											})}
									>
										{#each RELATION_ROLES as role (role.value)}
											<option value={role.value}>{role.label}</option>
										{/each}
									</select>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{@render settings(context)}

				{@render preview(plan)}
			{:else if source && plan && context}
				<div class="source-line">
					<span class="file">
						<FileSpreadsheet size={16} aria-hidden="true" />
						<strong>{source.name}</strong>
						<span class="muted">· {plural(dataRows.length, 'row')}</span>
					</span>
					{#if source.sheets.length > 1}
						<label class="inline">
							<span>Sheet</span>
							<select
								value={sheetIndex}
								onchange={(e) => chooseSheet(Number(e.currentTarget.value))}
							>
								{#each source.sheets as sheet, i (i)}
									<option value={i}>{sheet.name} ({plural(sheet.rows.length, 'row')})</option>
								{/each}
							</select>
						</label>
					{/if}
					<label class="inline">
						<span>Headings in</span>
						<select
							value={headerRow}
							onchange={(e) => {
								headerRow = Number(e.currentTarget.value);
								detect(false);
							}}
						>
							{#each Array.from({ length: Math.min(rows.length, 10) }, (_, i) => i) as i (i)}
								<option value={i}>row {i + 1}</option>
							{/each}
						</select>
					</label>
				</div>

				<section aria-labelledby="{uid}-columns">
					<h3 id="{uid}-columns">What each column holds</h3>
					<ul class="columns">
						{#each Array.from({ length: columnCount }, (_, c) => c) as c (c)}
							{@const heading = (headers[c] ?? '').trim()}
							<li class:skipped={!targets[c]}>
								<div class="column">
									<span class="letter" aria-hidden="true">{letter(c)}</span>
									<span class="name">
										<strong>{heading || `Column ${letter(c)}`}</strong>
										{#if samples(c)}<small>{samples(c)}</small>{/if}
									</span>
								</div>
								<select
									aria-label="Column {letter(c)}{heading ? `, ${heading},` : ''} becomes"
									value={targets[c] ?? ''}
									onchange={(e) => setTarget(c, e.currentTarget.value as Target)}
								>
									<option value="">Skip this column</option>
									{#each options as option (option.value)}
										<option value={option.value}>{option.label}</option>
									{/each}
									{#if targets[c]?.startsWith('attr:') && !options.some((o) => o.value === targets[c])}
										<option value={targets[c]}
											>{attributeLabel(targets[c]!.slice(5))} (not in this type)</option
										>
									{/if}
								</select>
							</li>
						{/each}
					</ul>
				</section>

				{@render settings(context)}

				{@render preview(plan)}
			{/if}

			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</div>

		{#if source || reqif}
			<footer>
				<button
					type="button"
					class="secondary back"
					onclick={() => {
						source = null;
						reqif = null;
						error = null;
					}}
					disabled={busy}
				>
					<ArrowLeft size={15} /> Back
				</button>
				<span class="grow"></span>
				<button
					type="button"
					class="secondary cancel"
					onclick={() => (open = false)}
					disabled={busy}>Cancel</button
				>
				<button type="button" class="primary" onclick={runImport} disabled={!canImport || busy}>
					{#if busy}<LoaderCircle size={15} class="spin" aria-hidden="true" /> Importing…
					{:else if plan && plan.create.length}Import {plural(plan.create.length, 'requirement')}
					{:else if plan && plan.update.length}Update {plural(plan.update.length, 'requirement')}
					{:else}Import{/if}
				</button>
			</footer>
		{/if}
	{/if}
</dialog>

<style>
	dialog {
		width: min(46rem, calc(100vw - 2rem));
		max-width: none;
		max-height: min(52rem, calc(100dvh - 3rem));
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius-lg) + 2px);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
		animation: pop 180ms var(--ease);
	}
	dialog::backdrop {
		background: rgb(14 16 20 / 0.45);
		backdrop-filter: blur(6px);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-4) var(--space-3) var(--space-5);
	}
	.titles {
		flex: 1;
		min-width: 0;
	}
	h2 {
		font-size: var(--text-xl);
	}
	.titles p {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.close {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-hover);
	}
	.body {
		flex: 1;
		display: grid;
		align-content: start;
		gap: var(--space-4);
		min-height: 0;
		padding: var(--space-1) var(--space-5) var(--space-5);
		overflow: auto;
		overscroll-behavior: contain;
	}
	.intro,
	.muted {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.intro code {
		color: var(--syntax-keyword);
	}
	.drop {
		display: grid;
		justify-items: center;
		gap: var(--space-1);
		padding: var(--space-6, 2rem) var(--space-4);
		border: 1.5px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		background: var(--surface-2);
		color: var(--text-2);
		text-align: center;
		cursor: pointer;
		transition:
			border-color var(--duration) var(--ease),
			background var(--duration) var(--ease);
	}
	.drop.dragging {
		border-color: var(--accent);
		background: var(--accent-weak);
	}
	@media (hover: hover) {
		.drop:hover {
			border-color: var(--accent);
			background: var(--accent-weak);
		}
	}
	.drop:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.drop strong {
		color: var(--text);
		font-size: var(--text-lg);
	}
	.drop span {
		font-size: var(--text-sm);
	}
	.or {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--text-3);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.or::before,
	.or::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
	}
	.paste {
		display: grid;
		gap: var(--space-2);
	}
	.paste label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
	}
	textarea {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		resize: vertical;
	}
	textarea::placeholder {
		font-family: var(--font-ui);
	}
	textarea:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-weak);
		outline: none;
	}
	.paste button {
		justify-self: end;
	}
	.source-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--surface-2);
	}
	.file {
		display: flex;
		flex: 1 1 12rem;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.inline {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.inline select {
		width: auto;
		max-width: 14rem;
		height: 2.25rem;
	}
	h3 {
		margin-bottom: var(--space-2);
		font-size: var(--text-md);
		font-weight: 650;
	}
	.settings {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-3);
	}
	.field {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.field > span {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	select {
		width: 100%;
		min-width: 0;
		height: 2.5rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		text-overflow: ellipsis;
	}
	.columns {
		display: grid;
		margin: 0;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		list-style: none;
	}
	.columns li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(11rem, 15rem);
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--border);
	}
	.columns li:first-child {
		border-top: 0;
	}
	/* Dimmed, but not the samples: dimmed small text would be too faint to read. */
	.columns li.skipped .name strong {
		opacity: 0.6;
	}
	.column {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.letter {
		display: grid;
		flex: none;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.name {
		display: grid;
		min-width: 0;
	}
	.name strong,
	.name small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name small {
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.warning {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--warn-weak);
		font-size: var(--text-sm);
	}
	.warning :global(svg) {
		flex: none;
		margin-top: 3px;
		color: var(--warn);
	}
	.existing {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		margin: var(--space-3) 0 0;
		padding: var(--space-2) var(--space-3) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.existing legend {
		padding: 0 4px;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.existing label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.25rem;
	}
	.summary {
		margin-bottom: var(--space-2);
		color: var(--text-2);
	}
	.summary strong {
		color: var(--text);
	}
	.notes {
		display: grid;
		gap: 4px;
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-3) var(--space-2) var(--space-6, 2rem);
		border-radius: var(--radius-sm);
		background: var(--warn-weak);
		font-size: var(--text-sm);
	}
	.cards {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-left: 3px solid var(--kind-requirement);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.card-title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px var(--space-2);
		overflow-wrap: anywhere;
	}
	.id {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.doc {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		color: var(--text-2);
		font-size: var(--text-sm);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}
	.chip .k {
		color: var(--text-2);
	}
	.updates {
		display: grid;
		gap: 4px;
		margin: var(--space-3) 0 0;
		padding: 0;
		color: var(--text-2);
		font-size: var(--text-sm);
		list-style: none;
		overflow-wrap: anywhere;
	}
	details {
		margin-top: var(--space-3);
	}
	summary {
		min-height: 2.25rem;
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 600;
		line-height: 2.25rem;
		cursor: pointer;
	}
	pre {
		max-height: 18rem;
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		overflow: auto;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		font-size: var(--text-xs);
		line-height: 1.5;
	}
	.error {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-weak);
		font-size: var(--text-sm);
	}
	footer {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--border);
		background: var(--surface-2);
	}
	.grow {
		flex: 1;
	}
	footer button,
	.secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2.5rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-weight: 600;
		cursor: pointer;
	}
	footer .primary {
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
	}
	footer button:disabled,
	.secondary:disabled {
		opacity: 0.55;
		cursor: default;
	}
	dialog :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 760px) {
		dialog {
			width: 100vw;
			height: 100dvh;
			max-height: none;
			margin: 0;
			border: 0;
			border-radius: 0;
		}
		header {
			padding: var(--space-3) var(--space-2) var(--space-2) var(--space-4);
		}
		.body {
			padding: var(--space-1) var(--space-4) var(--space-5);
		}
		.columns li {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-2);
		}
		select,
		.inline select {
			height: 2.75rem;
		}
		footer {
			padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom));
		}
		footer button,
		.secondary {
			min-height: 2.75rem;
			padding: 0 var(--space-3);
		}
		footer .back {
			padding: 0 var(--space-2);
		}
		/* The close button does the same, and the footer is narrow. */
		footer .cancel {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog[open] {
			animation: none;
		}
	}
</style>
