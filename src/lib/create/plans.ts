/**
 * What each form writes, worked out from its choices: the generators'
 * text, where it goes and the imports it needs, as a `Write` (`apply.ts`)
 * with a preview of the SysML and the label of its undoable step.
 */
import type { Engine } from '#lib/engine/client.ts';
import type { ElementFeatures, FeatureInfo } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
import { viewTitle } from '#lib/workbench/views.ts';
import {
	freePath,
	importsFor,
	merge,
	missingLibraries,
	takenNames,
	viewWrite,
	viewsPackage,
	type Write
} from './apply';
import { comparisons, requireConstraints, requirementText, satisfyText, type Limit } from './limit';
import { enclosingPackage, qualifiedName } from './model';
import { rollupExpression, rollupMember, rollupPlan, type RollupPlan } from './rollup';
import { References, camelName, name as sysmlName, pascalName, uniqueName } from './sysml';
import {
	tradeImports,
	tradeStudyText,
	tradeViewText,
	type CriterionSpec,
	type TradeSpec
} from './trade';
import { viewText, type Target, type ViewKind } from './view';

export interface Plan {
	write: Write;
	/** The SysML that will be written, for "See the SysML". */
	preview: string;
	/** The undoable step's name, shown in the toast. */
	label: string;
	/** A view to open when done. */
	open?: { name: string; title: string };
}

/** The preview of a write: each new file whole, then the imports and members per place. */
export function previewOf(write: Write): string {
	const parts: string[] = [];
	for (const f of write.files ?? []) parts.push(`// ${f.path}\n${f.text.trimEnd()}`);
	const imports = (write.imports ?? []).flatMap((i) =>
		i.targets.map((t) => `private import ${t};`)
	);
	if (imports.length) parts.push(imports.join('\n'));
	for (const d of write.declarations ?? [])
		if (d.set.value) parts.push(`// ${d.element.label}\n= ${d.set.value};`);
	for (const m of write.members ?? []) parts.push(`// in ${m.parent.label}\n${m.text}`);
	return parts.join('\n\n');
}

// --- New view -------------------------------------------------------------------

export interface ViewInput {
	kind: ViewKind;
	title: string;
	doc: string;
	targets: Target[];
	columns?: string[];
	budgetOf?: string;
}

/** Names of the project's views, which a new view's name must not repeat. */
export function viewNames(workspace: Workspace): Set<string> {
	const names = new Set(workspace.views.filter((v) => v.isUsage).map((v) => v.name));
	const pkg = viewsPackage(workspace);
	if (pkg) for (const e of workspace.elements) if (e.file === pkg.file) names.add(e.name);
	return names;
}

/** The identifier of a view titled `title`: `Mass budget` → `massBudget`. */
export function viewNameOf(title: string): string {
	return camelName(title, 'view');
}

export function planView(workspace: Workspace, input: ViewInput, libraries: Write = {}): Plan {
	const name = viewNameOf(input.title);
	const w = viewWrite(workspace, (spell) => [
		viewText({
			kind: input.kind,
			name,
			doc: input.doc,
			targets: input.targets,
			...(input.columns ? { columns: input.columns } : {}),
			...(input.budgetOf ? { budgetOf: input.budgetOf } : {}),
			spell
		})
	]);
	const write = merge(libraries, w);
	return {
		write,
		preview: previewOf(w),
		label: `Created the view ${viewTitle(name)}`,
		open: { name, title: viewTitle(name) }
	};
}

/** The view libraries to copy in first, when the project has none (as a write). */
export async function librariesWrite(workspace: Workspace, engine: Engine): Promise<Write> {
	const files = await missingLibraries(workspace, engine);
	return files.length ? { files } : {};
}

// --- Add up this value -------------------------------------------------------------

export interface RollupInput {
	/** The part or part def whose value becomes the sum. */
	element: ModelElement;
	features: ElementFeatures;
	/** Its attribute that becomes the sum. */
	attribute: FeatureInfo;
	/** The value of each part that is added up (usually the same name). */
	each: string;
	/** Its parts, with what each has (their features). */
	parts: { feature: FeatureInfo; features: ElementFeatures | undefined }[];
	/** Also make a budget table of it. */
	budget: { title: string } | null;
}

/** The parts of an element that a roll-up adds (parts and items, not ports). */
export function partsOf(features: ElementFeatures): FeatureInfo[] {
	return features.features.filter((f) => f.kind === 'part' || f.kind === 'item');
}

/** Whether a part has a value named `each` (a number, or one not given yet). */
export function partHas(features: ElementFeatures | undefined, each: string): boolean {
	const f = features?.features.find((x) => x.name === each);
	return !!f && f.kind === 'attribute' && (f.numeric || f.evaluated?.kind !== 'text');
}

export function rollupOf(input: RollupInput, refs: References): RollupPlan {
	return rollupPlan(
		input.parts.map(({ feature, features }) => ({
			name: feature.written,
			multiplicity: feature.multiplicity,
			ref: feature.ref,
			variation: feature.variation,
			value: feature.value,
			type: feature.type ? refs.name(feature.type) : null,
			has: partHas(features, input.each)
		})),
		input.each
	);
}

export function planRollup(
	workspace: Workspace,
	input: RollupInput,
	libraries: Write = {}
): Plan & { rollup: RollupPlan } {
	const pkg = enclosingPackage(workspace.tree, input.element.key);
	const refs = new References(pkg ? qualifiedName(workspace.tree, pkg.key) : '');
	const plan = rollupOf(input, refs);
	for (const i of plan.imports) refs.library(i);
	const own = input.attribute.own
		? workspace.elements.find((e) => e.id === input.attribute.id)
		: undefined;
	const writes: Write[] = [];
	if (own)
		writes.push({
			declarations: [{ element: own, set: { value: rollupExpression(plan, Infinity) } }]
		});
	else
		writes.push({
			members: [
				{
					parent: input.element,
					text: rollupMember(input.attribute.written, rollupExpression(plan))
				}
			]
		});
	if (pkg) writes.push({ imports: importsFor(workspace, pkg, refs.imports) });
	let open: Plan['open'];
	if (input.budget && !input.element.isDefinition) {
		const name = uniqueName(viewNameOf(input.budget.title), viewNames(workspace));
		writes.push(libraries);
		writes.push(
			viewWrite(workspace, (spell) => [
				viewText({
					kind: BUDGET_KIND,
					name,
					doc: `What the parts of ${input.element.label} add up to: their ${input.each}.`,
					targets: [
						{
							qualifiedName: input.features.qualifiedName,
							kind: 'part',
							isDefinition: false
						}
					],
					budgetOf: input.each,
					spell
				})
			])
		);
		open = { name, title: viewTitle(name) };
	}
	const write = merge(...writes);
	const shown = merge(...writes.filter((w) => w !== libraries));
	return {
		write,
		rollup: plan,
		preview: own
			? `${input.attribute.written} = ${rollupExpression(plan)};${shown.members?.length || shown.files?.length ? `\n\n${previewOf({ ...shown, declarations: [] })}` : ''}`
			: previewOf(shown),
		label: `${input.element.label}’s ${input.attribute.name} now adds up its parts`,
		...(open ? { open } : {})
	};
}

const BUDGET_KIND: ViewKind = {
	id: 'budget',
	group: 'analysis',
	label: 'Budget',
	description: '',
	definition: 'MassBudget',
	library: 'ModelViews',
	covers: 'part',
	single: true,
	tree: true,
	budget: true,
	title: 'Budget'
};

// --- Set a limit --------------------------------------------------------------------

export interface LimitInput {
	/** The value's name (written) and what owns it. */
	attribute: string;
	limit: Limit;
	/** An existing requirement to add the limit to. */
	requirement?: { element: ModelElement; features: ElementFeatures };
	/** The subject the constraint reads, existing or to add. */
	subject: { name: string; type: string; subsets?: boolean; add: boolean };
	/** A part that must meet it (`satisfy … by`), when not linked yet. */
	satisfyBy?: ElementFeatures | null;
	/** A new requirement. */
	create?: { id: string; title: string; statement: string; pkg: ModelElement };
}

/** The package most of the project's requirements are in (where a new one goes). */
export function requirementsPackage(workspace: Workspace): ModelElement | null {
	const counts = new Map<string, number>();
	for (const r of workspace.requirements) {
		if (isLibraryFile(r.file)) continue;
		const element = workspace.elements.find((e) => e.key === r.key);
		const pkg = element ? enclosingPackage(workspace.tree, element.key) : null;
		if (pkg) counts.set(pkg.key, (counts.get(pkg.key) ?? 0) + 1);
	}
	let best: string | null = null;
	for (const [key, n] of counts) if (!best || n > counts.get(best)!) best = key;
	return best ? (workspace.elements.find((e) => e.key === best) ?? null) : null;
}

export function planLimit(workspace: Workspace, input: LimitInput): Plan {
	const feature = `${sysmlName(input.subject.name)}.${input.attribute}`;
	const target = input.requirement?.element ?? input.create?.pkg;
	if (!target) return { write: {}, preview: '', label: '' };
	const pkg = input.create?.pkg ?? enclosingPackage(workspace.tree, target.key);
	const pkgName = pkg ? qualifiedName(workspace.tree, pkg.key) : '';
	const refs = new References(pkgName);
	const type = input.subject.add ? refs.name(input.subject.type) : input.subject.type;
	if (input.limit.unit) refs.library('SI::*');
	const by = input.satisfyBy?.reference ? refs.reference(input.satisfyBy.reference) : null;
	const members: Write['members'] = [];
	let label: string;
	if (input.create) {
		const text = requirementText({
			id: input.create.id,
			title: input.create.title,
			statement: input.create.statement,
			subject: {
				name: input.subject.name,
				type,
				...(input.subject.subsets ? { subsets: true } : {})
			},
			feature,
			limit: input.limit
		});
		members.push({ parent: input.create.pkg, text });
		if (by) members.push({ parent: input.create.pkg, text: satisfyText(input.create.title, by) });
		label = `Created the requirement ${input.create.id} ${input.create.title}`;
	} else {
		const r = input.requirement!.element;
		if (input.subject.add)
			members.push({
				parent: r,
				text: `subject ${sysmlName(input.subject.name)} ${input.subject.subsets ? ':>' : ':'} ${type};`
			});
		for (const c of requireConstraints(feature, input.limit)) members.push({ parent: r, text: c });
		if (by && pkg) members.push({ parent: pkg, text: satisfyText(r.name, by) });
		label = `${r.shortName ? `${r.shortName} ` : ''}${r.label} now checks ${comparisons(feature, input.limit).join(' and ')}`;
	}
	const write: Write = {
		...(pkg ? { imports: importsFor(workspace, pkg, refs.imports) } : {}),
		members
	};
	return { write, preview: previewOf(write), label };
}

// --- New trade study -------------------------------------------------------------------

export interface TradeInput {
	title: string;
	question: string;
	/** The alternatives (parts or part defs), as the engine describes them. */
	alternatives: ElementFeatures[];
	/** What they all are (qualified). */
	kind: string;
	criteria: CriterionSpec[];
}

/** The most specific definition every alternative is one of. */
export function commonKind(alternatives: readonly ElementFeatures[]): string | null {
	const [first, ...rest] = alternatives;
	if (!first) return null;
	return first.kinds.find((k) => rest.every((a) => a.kinds.includes(k))) ?? null;
}

/** The attributes every alternative has that hold numbers, in the first's order. */
export function sharedCriteria(alternatives: readonly ElementFeatures[]): FeatureInfo[] {
	const [first, ...rest] = alternatives;
	if (!first) return [];
	return first.features.filter(
		(f) =>
			f.kind === 'attribute' &&
			f.numeric &&
			rest.every((a) =>
				a.features.some((g) => g.name === f.name && g.kind === 'attribute' && g.numeric)
			)
	);
}

export function planTrade(
	workspace: Workspace,
	input: TradeInput,
	libraries: Write = {}
): Plan & { name: string } {
	const taken = takenNames(workspace);
	const packageName = uniqueName(pascalName(input.title, 'TradeStudy'), taken);
	const base = camelName(input.title, 'tradeStudy');
	const study = `${base}Study`;
	const kindSimple = input.kind.split('::').pop()!.replace(/^'|'$/g, '');
	const criteriaNames = new Set(input.criteria.map((c) => c.attribute));
	const definitions = input.alternatives.filter((a) => a.isDefinition);
	const variationName = definitions.length ? `${camelName(kindSimple)}Options` : null;
	const refs = new References(packageName, variationName ? [variationName] : []);
	const kind = refs.name(input.kind);
	const variantNames = new Set<string>();
	const variants = definitions.map((d) => {
		const n = uniqueName(camelName(d.name), variantNames);
		variantNames.add(n);
		return { name: n, type: refs.name(d.qualifiedName), id: d.id };
	});
	const alternatives = input.alternatives.map((a) => {
		if (a.isDefinition) return `${variationName}::${variants.find((v) => v.id === a.id)!.name}`;
		return a.reference ? refs.reference(a.reference) : a.qualifiedName;
	});
	let parameter = camelName(kindSimple, 'option');
	if (criteriaNames.has(parameter)) parameter = 'option';
	const spec: TradeSpec = {
		packageName,
		study,
		question: input.question,
		kind,
		alternatives,
		variation: variationName
			? { name: variationName, variants: variants.map(({ name, type }) => ({ name, type })) }
			: null,
		parameter,
		criteria: input.criteria,
		imports: refs.imports
	};
	void tradeImports;
	const text = tradeStudyText(spec);
	const path = freePath(workspace, `analysis/${packageName}.sysml`);
	const viewName = uniqueName(base, viewNames(workspace));
	const view = viewWrite(workspace, (spell) => [
		tradeViewText(
			viewName,
			spell('ModelViews::TradeStudyTable'),
			`${packageName}::${study}`,
			input.question
		)
	]);
	const write = merge(libraries, { files: [{ path, text }] }, view);
	return {
		write,
		name: viewName,
		preview: previewOf(merge({ files: [{ path, text }] }, view)),
		label: `Created the trade study ${viewTitle(base)}`,
		open: { name: viewName, title: viewTitle(viewName) }
	};
}
