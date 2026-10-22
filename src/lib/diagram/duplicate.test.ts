import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { buildTree, collectElements, type ModelElement } from '#lib/project/elements.ts';
import { freeName, planDuplicate } from './duplicate.ts';
import { ownersOf, qualifiedName } from './model.ts';
import type { ModelContext } from './relationships.ts';

let host: ToolkitHost;
let files: Record<string, string>;
let ctx: ModelContext;

function contextFor(texts: Record<string, string>): ModelContext {
	const list = Object.entries(texts).map(([path, text]) => ({ path, text }));
	const analyses = host.analyzeProject(list);
	const elements = collectElements(analyses);
	return {
		elements,
		owners: ownersOf(buildTree(elements)),
		textOf: (path) => texts[path],
		analyses
	};
}

const find = (qualified: string, c = ctx): ModelElement => {
	const found = c.elements.find((e) => qualifiedName(e, c.owners) === qualified);
	if (!found) throw new Error(`no ${qualified}`);
	return found;
};

const errors = (c: ModelContext) =>
	c.analyses.flatMap((a) => a.diagnostics.filter((d) => d.severity === 'error')).length;

/** The texts after a duplicate, and the model read from them. */
function duplicated(element: ModelElement) {
	const plan = planDuplicate(element, ctx);
	if (typeof plan === 'string') throw new Error(plan);
	const step = plan.steps[0]!;
	if (step.kind !== 'patch') throw new Error('a patch');
	expect(files[step.path]).toBe(step.before);
	const texts = { ...files, [step.path]: step.after };
	return { plan, text: step.after, after: contextFor(texts) };
}

beforeAll(async () => {
	host = await loadHost();
	files = Object.fromEntries(demoFiles().map((f) => [f.path, f.text]));
	ctx = contextFor(files);
}, 60_000);

describe('a free name', () => {
	it('adds a number, or counts on the one it ends with', () => {
		expect(freeName('battery', new Set(['battery']))).toBe('battery2');
		expect(freeName('battery', new Set(['battery', 'battery2']))).toBe('battery3');
		expect(freeName('motor2', new Set(['motor2']))).toBe('motor3');
		expect(freeName('Flight endurance', new Set())).toBe('Flight endurance 2');
		expect(freeName('Rotor 9', new Set(['Rotor 10']))).toBe('Rotor 11');
	});
});

describe('duplicating an element', () => {
	it('copies a part right after it, under a free name, with its type', () => {
		const { plan, text, after } = duplicated(find('DroneArchitecture::drone::battery'));
		expect(plan.name).toBe('battery2');
		expect(text).toContain('part battery : Battery;\n        part battery2 : Battery;\n');
		expect(errors(after)).toBe(errors(ctx));
		const copy = find('DroneArchitecture::drone::battery2', after);
		expect(copy.typeRef).toBe('Battery');
	});

	it('copies a requirement with its body, without its short name', () => {
		const { plan, text, after } = duplicated(find("SystemRequirements::'Flight endurance'"));
		expect(plan.name).toBe('Flight endurance 2');
		expect(text).toContain("requirement 'Flight endurance 2' : DroneRequirement {");
		expect(text.match(/<'SYS-001'>/g)).toHaveLength(1);
		expect(errors(after)).toBe(errors(ctx));
		const copy = find("SystemRequirements::'Flight endurance 2'", after);
		expect(copy.shortName).toBeNull();
		expect(copy.doc).toBe(find("SystemRequirements::'Flight endurance'").doc);
	});

	it('copies a definition, its features and all', () => {
		const { plan, after } = duplicated(find('DroneComponents::Battery'));
		expect(plan.name).toBe('Battery2');
		const children = (q: string) =>
			after.elements
				.filter((e) => after.owners.get(e.key) === find(q, after))
				.map((e) => e.label)
				.sort();
		expect(children('DroneComponents::Battery2')).toEqual(children('DroneComponents::Battery'));
		expect(errors(after)).toBe(errors(ctx));
	});

	it('refuses an element without a name of its own', () => {
		const text = files['system/Components.sysml']!;
		const mass = ctx.elements.find(
			(e) =>
				e.file === 'system/Components.sysml' &&
				e.name === 'mass' &&
				text.split('\n')[e.span.start_row - 1]!.includes(':>> mass')
		);
		expect(mass).toBeDefined();
		expect(planDuplicate(mass!, ctx)).toMatch(/no name of its own/);
	});
});
