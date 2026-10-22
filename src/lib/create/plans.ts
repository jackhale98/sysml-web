/**
 * What each form writes, worked out from its choices: the generators'
 * text, where it goes and the imports it needs, as a `Write` (`apply.ts`)
 * with a preview of the SysML and the label of its undoable step.
 */
import type { Engine } from '#lib/engine/client.ts';
import type { ElementFeatures, FeatureInfo } from '#lib/engine/types.ts';
import type { ModelElement, TreeNode } from '#lib/project/elements.ts';
import { packageName as projectPackageName } from '#lib/project/sources.ts';
import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
import type { WriteStep } from '#lib/workbench/actions.ts';
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
import { fmeaLineText, fmeaPackageText, listWords, packageViewText, type FmeaKind } from './fmea';
import {
	controlText,
	hazardMembers,
	hazardPackageText,
	type ControlSpec,
	type HazardSpec
} from './hazard';
import {
	comparisons,
	nextRequirementId,
	requireConstraints,
	requirementText,
	satisfyText,
	type Limit
} from './limit';
import { enclosingPackage, flatten, pathTo, qualifiedName } from './model';
import { mitigationText, referenceValue, withLineField, type MitigationSpec } from './riskControls';
import { missingRiskLibraries } from './riskLibraries';
import { rollupExpression, rollupMember, rollupPlan, type RollupPlan } from './rollup';
import {
	References,
	camelName,
	docComment,
	name as sysmlName,
	pascalName,
	stringLiteral,
	uniqueName,
	withImports
} from './sysml';
import { tradeStudyText, tradeViewText, type CriterionSpec, type TradeSpec } from './trade';
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

// --- Risk: FMEA and hazards ------------------------------------------------------------

/**
 * The libraries a first FMEA or hazard needs, as a write: the risk
 * libraries, and the view libraries they use, when the project lacks them.
 */
export async function riskLibrariesWrite(workspace: Workspace, engine: Engine): Promise<Write> {
	const view = await missingLibraries(workspace, engine);
	const files = [...view, ...missingRiskLibraries(workspace)];
	return files.length ? { files } : {};
}

/** An element a form chose, as the tree gives it. */
export interface Chosen {
	qualifiedName: string;
	label: string;
}

/**
 * What a package imports to refer to an element, and how it spells it
 * then: the element's outermost owner that is not a package is imported
 * (`DroneArchitecture::drone`), the rest is its path (`drone::battery`).
 */
export function spellFrom(
	tree: readonly TreeNode[],
	refs: References,
	qualified: string
): string | null {
	const node = flatten(tree).find((n) => n.qualifiedName === qualified);
	if (!node) return null;
	const path = pathTo(tree, node.node.element.key);
	const head = path.findIndex((n) => n.element.kind !== 'package');
	if (head < 0) return refs.name(qualified);
	const imported = path
		.slice(0, head + 1)
		.map((n) => n.element.name)
		.join('::');
	const rest = path.slice(head + 1).map((n) => n.element.name);
	return [refs.name(imported), ...rest].join('::');
}

export interface FmeaInput {
	kind: FmeaKind;
	title: string;
	/** The parts, process or tasks it covers. */
	covers: Chosen[];
}

export function planFmea(
	workspace: Workspace,
	input: FmeaInput,
	libraries: Write = {}
): Plan & { name: string; packageName: string } {
	const packageName = uniqueName(pascalName(input.title, 'Fmea'), takenNames(workspace));
	const refs = new References(packageName);
	refs.library('RiskAnalysis::*');
	for (const c of input.covers) spellFrom(workspace.tree, refs, c.qualifiedName);
	const text = fmeaPackageText({
		kind: input.kind,
		packageName,
		covers: input.covers.map((c) => c.label),
		imports: refs.imports
	});
	const path = freePath(workspace, `risk/${packageName}.sysml`);
	const name = uniqueName(camelName(input.title, 'fmea'), viewNames(workspace));
	const covers = input.covers.length ? ` of ${listWords(input.covers.map((c) => c.label))}` : '';
	const view = viewWrite(workspace, (spell) => [
		packageViewText(
			name,
			spell(`RiskAnalysis::${input.kind.worksheet}`),
			packageName,
			`The ${input.kind.suffix}${covers}, highest risk first.`
		)
	]);
	const write = merge(libraries, { files: [{ path, text }] }, view);
	return {
		write,
		name,
		packageName,
		preview: previewOf(merge({ files: [{ path, text }] }, view)),
		label: `Created the ${input.kind.suffix} ${viewTitle(name)}`,
		open: { name, title: viewTitle(name) }
	};
}

export interface FmeaLineInput {
	/** The package that holds the sheet's lines. */
	pkg: ModelElement;
	kind: FmeaKind;
	element: Chosen;
	failureMode: string;
	effect: string;
	cause: string;
	severity: number;
	likelihood: number;
	detection: number;
	hazard?: Chosen | null;
	preventionControls?: string;
	detectionControls?: string;
}

export function planFmeaLine(workspace: Workspace, input: FmeaLineInput): Plan {
	const refs = new References(qualifiedName(workspace.tree, input.pkg.key));
	refs.library('RiskAnalysis::*');
	const about = spellFrom(workspace.tree, refs, input.element.qualifiedName);
	if (!about) return { write: {}, preview: '', label: '' };
	const hazard = input.hazard ? spellFrom(workspace.tree, refs, input.hazard.qualifiedName) : null;
	const text = fmeaLineText({
		about,
		failureMode: input.failureMode,
		effect: input.effect,
		cause: input.cause,
		category: input.kind.literal,
		severity: input.severity,
		likelihood: input.likelihood,
		detection: input.detection,
		hazard,
		...(input.preventionControls ? { preventionControls: input.preventionControls } : {}),
		...(input.detectionControls ? { detectionControls: input.detectionControls } : {})
	});
	const write: Write = {
		imports: importsFor(workspace, input.pkg, refs.imports),
		members: [{ parent: input.pkg, text: `\n${text}` }]
	};
	return {
		write,
		preview: previewOf(write),
		label: `Added “${input.failureMode.trim()}” of ${input.element.label} to ${input.pkg.label}`
	};
}

/** A risk matrix of a sheet's lines (`RiskAnalysis::RiskMatrix`, exposing its package). */
export function planRiskMatrix(
	workspace: Workspace,
	sheet: { packageName: string; title: string }
): Plan & { name: string } {
	const simple = sheet.packageName.split('::').pop()!.replace(/^'|'$/g, '');
	const name = uniqueName(`${camelName(simple, 'fmea')}Matrix`, viewNames(workspace));
	const view = viewWrite(workspace, (spell) => [
		packageViewText(
			name,
			spell('RiskAnalysis::RiskMatrix'),
			sheet.packageName,
			`The lines of ${sheet.title} by severity and likelihood.`
		)
	]);
	return {
		write: view,
		name,
		preview: previewOf(view),
		label: `Created the risk matrix ${viewTitle(name)}`,
		open: { name, title: viewTitle(name) }
	};
}

/** The package most of the project's hazards are in (where a new one goes). */
export function hazardsPackage(workspace: Workspace): ModelElement | null {
	const counts = new Map<string, number>();
	for (const e of workspace.elements) {
		if (isLibraryFile(e.file) || e.isDefinition) continue;
		if (!/(^|::)(Hazard|Harm)$/.test(e.typeRef ?? '')) continue;
		const pkg = enclosingPackage(workspace.tree, e.key);
		if (pkg) counts.set(pkg.key, (counts.get(pkg.key) ?? 0) + 1);
	}
	const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
	return best ? (workspace.elements.find((e) => e.key === best) ?? null) : null;
}

/** The project's saved hazard log, if it has one. */
export function hazardLogView(workspace: Workspace): string | null {
	const saved = workspace.views.find(
		(v) =>
			v.isUsage &&
			!v.builtin &&
			!isLibraryFile(v.file) &&
			(v.definition ?? '').split('::').pop() === 'HazardLog'
	);
	return saved?.name ?? null;
}

/** The next risk control ID: `RC-004` after `RC-003`. */
export function nextControlId(ids: readonly (string | null)[]): string {
	const own = ids.filter((id): id is string => !!id && /^RC-?\d+$/.test(id));
	return own.length ? nextRequirementId(own) : 'RC-001';
}

export interface HazardInput {
	spec: HazardSpec;
	/** Harms of the model the hazard leads to too. */
	existingHarms: Chosen[];
}

export function planHazard(
	workspace: Workspace,
	input: HazardInput,
	libraries: Write = {}
): Plan & { view: string } {
	const pkg = hazardsPackage(workspace);
	const pkgName = pkg
		? qualifiedName(workspace.tree, pkg.key)
		: uniqueName(
				`${projectPackageName(workspace.info?.name ?? 'Model').replace(/'/g, '')}Hazards`,
				takenNames(workspace)
			);
	const refs = new References(pkgName);
	refs.library('HazardAnalysis::*');
	const existingHarms = input.existingHarms
		.map((h) => spellFrom(workspace.tree, refs, h.qualifiedName))
		.filter((s): s is string => !!s);
	const members = hazardMembers({ ...input.spec, existingHarms });
	const writes: Write[] = [];
	if (pkg)
		writes.push({
			imports: importsFor(workspace, pkg, refs.imports),
			members: members.map((text) => ({ parent: pkg, text: `\n${text}` }))
		});
	else
		writes.push({
			files: [
				{
					path: freePath(workspace, 'risk/Hazards.sysml'),
					text: hazardPackageText(pkgName, workspace.info?.name ?? 'the system', members)
				}
			]
		});
	let view = hazardLogView(workspace);
	if (!view) {
		view = uniqueName('hazardLog', viewNames(workspace));
		writes.push(
			viewWrite(workspace, (spell) => [
				[
					`view ${view} : ${spell('HazardAnalysis::HazardLog')} {`,
					`    ${docComment('Each hazard with the harms it can cause, how severe they are, and the controls on it.')}`,
					'}'
				].join('\n')
			])
		);
	}
	const shown = merge(...writes);
	return {
		write: merge(libraries, ...writes),
		view,
		preview: previewOf(shown),
		label: `Created the hazard ${input.spec.name.trim()}`,
		open: { name: view, title: viewTitle(view) }
	};
}

// --- Risk: a line's controls, a saved review, the risk policy ------------------------------

/** An element a form links, with its short name (a control's `RC-001`) when it has one. */
export interface Linked extends Chosen {
	shortName?: string | null;
}

export interface LineLinksInput {
	/** Where the line's `@Fmea` is written (its first line, 1-based). */
	file: string;
	line: number;
	/** The package it is in: what it imports, and where new controls and mitigations go. */
	pkg: ModelElement;
	/** Every risk control and mitigation the line should name, after the change. */
	controls: Linked[];
	mitigations: Linked[];
	/** A new risk control on the line's hazard (written as `hazard` is in the line). */
	newControl?: ControlSpec & { hazard: string | null };
	newMitigation?: MitigationSpec;
	label: string;
}

/** The plan as one patch of the line's file, for `applySteps`. */
export interface PatchPlan {
	steps: WriteStep[];
	preview: string;
	label: string;
}

/**
 * Link an FMEA line to its risk controls and mitigations: its
 * `riskControls` and `mitigations` set to the names (a control by its ID,
 * `'RC-001'`), the imports its package needs for them, and a new control or
 * mitigation in its package. One patch of the file, so it is one step.
 */
export function planLineLinks(workspace: Workspace, input: LineLinksInput): PatchPlan | string {
	const before = workspace.text(input.file);
	if (before === undefined) return `${input.file} is not in the project.`;
	const pkgName = qualifiedName(workspace.tree, input.pkg.key);
	const refs = new References(pkgName);
	const spellLinked = (l: Linked) => {
		const at = l.qualifiedName.lastIndexOf('::');
		const owner = at < 0 ? '' : l.qualifiedName.slice(0, at);
		if (l.shortName)
			return refs.name(owner ? `${owner}::${sysmlName(l.shortName)}` : sysmlName(l.shortName));
		return spellFrom(workspace.tree, refs, l.qualifiedName) ?? refs.name(l.qualifiedName);
	};
	const controls = input.controls.map(spellLinked);
	const mitigations = input.mitigations.map(spellLinked);
	const members: string[] = [];
	if (input.newControl) {
		controls.push(sysmlName(input.newControl.id.trim()));
		const lines = controlText(input.newControl, input.newControl.hazard ?? '').split('\n');
		members.push(
			(input.newControl.hazard ? lines : lines.filter((l) => !l.includes('ref :>> hazard'))).join(
				'\n'
			)
		);
		refs.library('HazardAnalysis::*');
	}
	if (input.newMitigation) {
		mitigations.push(sysmlName(input.newMitigation.name.trim()));
		members.push(mitigationText(input.newMitigation));
		refs.library('RiskAnalysis::*');
	}
	let after = withLineField(before, input.line, 'riskControls', controls);
	if (after === null) return 'This line could not be found in the text.';
	after = withLineField(after, input.line, 'mitigations', mitigations)!;
	let to = (input.pkg.span.to ?? before.length) + (after.length - before.length);
	if (members.length) {
		const close = after.lastIndexOf('}', to - 1);
		const lineStart = after.lastIndexOf('\n', close - 1) + 1;
		const indent = `${/^[ \t]*/.exec(after.slice(after.lastIndexOf('\n', (input.pkg.span.from ?? 0) - 1) + 1))![0]}    `;
		const text = members.map((m) => `\n${m.replace(/^(?=.)/gm, indent)}\n`).join('');
		const inline = after.slice(lineStart, close).trim() !== '';
		const at = inline ? close : lineStart;
		after = after.slice(0, at) + text + (inline ? '\n' : '') + after.slice(at);
		to += text.length + (inline ? 1 : 0);
	}
	after = withImports(
		after,
		{ qualifiedName: pkgName, from: input.pkg.span.from ?? 0, to },
		refs.imports
	);
	const added = [
		...members,
		...(controls.length ? [`riskControls = ${referenceValue(controls)};`] : []),
		...(mitigations.length ? [`mitigations = ${referenceValue(mitigations)};`] : [])
	];
	return {
		steps: [{ kind: 'patch', path: input.file, before, after }],
		preview: added.join('\n\n'),
		label: input.label
	};
}

export interface SavedReviewInput {
	title: string;
	/** The view def it is typed by (qualified). */
	definition: string;
	/** What the view it comes from exposes, as written there. */
	exposes: string[];
	/** The condition: the view's own, and the filters'. */
	where: string;
	doc: string;
}

/** A filtered review saved as a view: a usage of the worksheet's view def with a `where`. */
export function planSavedReview(
	workspace: Workspace,
	input: SavedReviewInput
): Plan & { name: string } {
	const name = uniqueName(viewNameOf(input.title), viewNames(workspace));
	const view = viewWrite(workspace, (spell) => [
		[
			`view ${sysmlName(name)} : ${spell(input.definition)} {`,
			`    ${docComment(input.doc)}`,
			...input.exposes.map((e) => `    expose ${e};`),
			`    @${spell('Reporting::TableRendering')} { where = ${stringLiteral(input.where)}; }`,
			'}'
		].join('\n')
	]);
	return {
		write: view,
		name,
		preview: previewOf(view),
		label: `Saved the view ${viewTitle(name)}`,
		open: { name, title: viewTitle(name) }
	};
}
