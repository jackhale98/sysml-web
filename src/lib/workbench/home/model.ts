/**
 * Pure summaries of a workspace for the project overview: element counts by
 * family, the package that best shows the architecture, and the element the
 * hero pictures as text and as a diagram.
 */
import type { Diagnostic } from '#lib/engine/types.ts';
import type { ModelElement, TreeNode } from '#lib/project/elements.ts';
import { humanize } from '#lib/project/status.ts';
import { isLibraryFile } from '#lib/project/workspace.svelte.ts';
import { familyOf, type Family } from '#lib/ui/kinds.ts';

export interface FamilyInfo {
	family: Family;
	/** Plural name, as the strip shows it. */
	label: string;
	/** A kind whose glyph stands for the family. */
	glyph: string;
	/** One sentence for people new to SysML. */
	blurb: string;
}

export const FAMILIES: FamilyInfo[] = [
	{
		family: 'structure',
		label: 'Structure',
		glyph: 'part',
		blurb: 'Parts, items and attributes: what the system is made of.'
	},
	{
		family: 'interface',
		label: 'Interfaces',
		glyph: 'port',
		blurb: 'Ports, interfaces and connections: how parts exchange power, data and things.'
	},
	{
		family: 'behavior',
		label: 'Behaviour',
		glyph: 'action',
		blurb: 'Actions, states and use cases: what the system does, and when.'
	},
	{
		family: 'requirement',
		label: 'Requirements',
		glyph: 'requirement',
		blurb: 'Requirements, concerns and verifications: what it must do, and how that is proven.'
	},
	{
		family: 'analysis',
		label: 'Analysis',
		glyph: 'calc',
		blurb: 'Calculations, constraints and analyses: the numbers behind the design.'
	},
	{
		family: 'package',
		label: 'Packages',
		glyph: 'package',
		blurb: 'Packages are folders that organise the model and keep names apart.'
	},
	{
		family: 'view',
		label: 'Views',
		glyph: 'view',
		blurb: 'Views and viewpoints: saved diagrams and tables drawn from the model.'
	}
];

export interface FamilyCount extends FamilyInfo {
	definitions: number;
	usages: number;
	total: number;
	/** Definitions first, then usages, in file order. */
	elements: ModelElement[];
}

/** The project's own elements (not its libraries), counted by family. */
export function countFamilies(elements: ModelElement[]): FamilyCount[] {
	const own = elements.filter((e) => !isLibraryFile(e.file));
	return FAMILIES.map((info) => {
		const members = own.filter((e) => familyOf(e.kind) === info.family);
		const definitions = members.filter((e) => e.isDefinition);
		const usages = members.filter((e) => !e.isDefinition);
		return {
			...info,
			definitions: definitions.length,
			usages: usages.length,
			total: members.length,
			elements: [...definitions, ...usages]
		};
	});
}

/** The top-level package to open as "the architecture". */
export function architecturePackage(tree: TreeNode[]): ModelElement | null {
	const packages = tree
		.filter((n) => n.element.kind === 'package' && !isLibraryFile(n.element.file))
		.map((n) => n.element);
	if (!packages.length) return null;
	const byName = (pattern: RegExp) => packages.find((p) => pattern.test(p.label));
	const showcase = showcaseElement(tree);
	const owner = showcase ? packages.find((p) => p.file === showcase.element.file) : undefined;
	return byName(/architecture/i) ?? owner ?? byName(/system|structure/i) ?? packages[0] ?? null;
}

/**
 * The top-level package whose doc comment can stand in for a missing project
 * description: the only one, or the one named like the project.
 */
export function describingPackage(tree: TreeNode[], projectName: string): ModelElement | null {
	const packages = tree
		.filter((n) => n.element.kind === 'package' && !isLibraryFile(n.element.file))
		.map((n) => n.element);
	if (packages.length === 1) return packages[0]!;
	const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
	const project = key(projectName);
	if (!project) return null;
	return (
		packages.find((p) => key(p.label) === project) ??
		packages.find((p) => key(p.label).startsWith(project) || project.startsWith(key(p.label))) ??
		null
	);
}

/** A doc comment as a description: its first paragraph, on one line. */
export function docSummary(doc: string): string {
	const paragraph = doc.trim().split(/\n\s*\n/)[0] ?? '';
	return paragraph.replace(/\s+/g, ' ').trim();
}

/** The part with the most nested parts: the best picture of "the system". */
export function showcaseElement(tree: TreeNode[]): TreeNode | null {
	let best: TreeNode | null = null;
	let bestScore = 0;
	const visit = (nodes: TreeNode[]) => {
		for (const node of nodes) {
			if (isLibraryFile(node.element.file)) continue;
			if (node.element.kind === 'part') {
				const score = node.children.filter((c) => c.element.kind === 'part').length;
				if (score > bestScore) {
					best = node;
					bestScore = score;
				}
			}
			visit(node.children);
		}
	};
	visit(tree);
	return best;
}

/** `4` or `[4]` → `[4]`. */
export function multiplicityText(value: string | null): string {
	if (!value) return '';
	const inner = value.replace(/^\[|\]$/g, '').trim();
	return inner ? `[${inner}]` : '';
}

export interface ProblemGroup {
	code: string;
	label: string;
	severity: Diagnostic['severity'];
	count: number;
	example: string;
}

/** Problems grouped by check, most frequent first (errors before warnings). */
export function groupProblems(problems: Diagnostic[]): ProblemGroup[] {
	const groups = new Map<string, ProblemGroup>();
	for (const p of problems) {
		if (p.severity === 'note') continue;
		const key = `${p.severity}:${p.code}`;
		const group = groups.get(key);
		if (group) group.count += 1;
		else
			groups.set(key, {
				code: p.code,
				label: problemLabel(p.message) || humanize(p.code),
				severity: p.severity,
				count: 1,
				example: p.message
			});
	}
	const rank = (s: Diagnostic['severity']) => (s === 'error' ? 0 : 1);
	return [...groups.values()].sort(
		(a, b) => rank(a.severity) - rank(b.severity) || b.count - a.count
	);
}

/** A message without its names: "port `a` (in `B`) is …" → "Port is …". */
export function problemLabel(message: string): string {
	const text = message
		.replace(/\s*\(in `[^`]*`\)/g, '')
		.replace(/\s*`[^`]*`/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "1.2 s" or "840 ms". */
export function duration(millis: number): string {
	return millis >= 1000 ? `${(millis / 1000).toFixed(1)} s` : `${Math.round(millis)} ms`;
}
