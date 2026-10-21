import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Analysis, ViewInfo } from '#lib/engine/types.ts';
import { buildTree, collectElements } from '#lib/project/elements.ts';
import { collectRequirements } from '#lib/project/requirements.ts';
import { isLibraryFile } from '#lib/project/workspace.svelte.ts';
import { buildReport, chapterKind } from './build.ts';
import type { ReportContext } from './context.ts';
import { flatten, plain, type Block, type ReportDocument, type Section } from './document.ts';
import { prepareReport, type ReportSource } from './gather.ts';
import { icdModel } from './icd.ts';
import { reportEntries, reportKindOf } from './kinds.ts';
import { toMarkdown } from './markdown.ts';
import { defaultExposes, reportLibrary } from './save.ts';

const ROOT = join(import.meta.dirname, '../../demo/drone');
const ENGINE = join(import.meta.dirname, '../../../static/engine');

interface Wasm {
	initSync(options: { module: Buffer }): void;
	analyzeProject(files: string): string;
	listViews(files: string): string;
}

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
	);
}

let wasm: Wasm;
let demo: Record<string, string>;
const DATE = new Date('2026-10-21T12:00:00Z');

function sourceFor(texts: Record<string, string>): ReportSource {
	const list = Object.entries(texts).map(([path, text]) => ({ path, text }));
	const analyses = JSON.parse(wasm.analyzeProject(JSON.stringify(list))) as Analysis[];
	const views = JSON.parse(wasm.listViews(JSON.stringify(list))) as ViewInfo[];
	return {
		views,
		analyses,
		texts,
		tree: buildTree(collectElements(analyses)),
		requirements: collectRequirements(analyses),
		project: { name: 'Drone UAV', description: 'A parcel-delivery drone.', version: '0.2.0' },
		isLibrary: isLibraryFile
	};
}

function report(name: string, texts = demo): { ctx: ReportContext; doc: ReportDocument } {
	const ctx = prepareReport(name, sourceFor(texts), DATE);
	return { ctx, doc: buildReport(ctx) };
}

const section = (doc: ReportDocument, title: string): Section => {
	const found = flatten(doc.sections).find((s) => s.title === title);
	if (!found) throw new Error(`no section ${title}`);
	return found;
};
const blocks = (s: Section, type: Block['type']) => s.blocks.filter((b) => b.type === type);
const facts = (s: Section) =>
	Object.fromEntries(
		s.blocks.flatMap((b) =>
			b.type === 'facts' ? b.facts.map((f) => [f.label, plain(f.value)]) : []
		)
	);

beforeAll(async () => {
	wasm = (await import(/* @vite-ignore */ join(ENGINE, 'sysml_wasm.js'))) as Wasm;
	wasm.initSync({ module: readFileSync(join(ENGINE, 'sysml_wasm_bg.wasm')) });
	demo = Object.fromEntries(
		walk(ROOT)
			.filter((f) => f.endsWith('.sysml'))
			.map((f) => [relative(ROOT, f), readFileSync(f, 'utf8')])
	);
});

describe('report views', () => {
	it('recognises reports by their view def', () => {
		const { views } = sourceFor(demo);
		const spec = views.find((v) => v.name === 'droneSpecification')!;
		expect(reportKindOf(spec)).toBe('specification');
		expect(reportKindOf(views.find((v) => v.name === 'droneInterfaceControl')!)).toBe('icd');
		expect(reportKindOf(views.find((v) => v.name === 'systemRequirements')!)).toBeNull();
		const entries = reportEntries(views, isLibraryFile);
		expect(entries.map((e) => [e.name, e.saved])).toEqual([
			['droneSpecification', true],
			['droneInterfaceControl', true],
			['SpecificationDocument', false],
			['InterfaceControlDocument', false]
		]);
	});

	it('takes its chapters from the subviews of the report def', () => {
		const { ctx } = report('droneSpecification');
		expect(ctx.chapters.map((c) => chapterKind(c))).toEqual([
			'requirements',
			'traceability',
			'coverage',
			'gaps'
		]);
		const icd = report('droneInterfaceControl').ctx;
		expect(icd.chapters.map((c) => chapterKind(c))).toEqual([
			'interconnection',
			'connections',
			'interfaces',
			'portDefinitions',
			'items',
			'portUsage'
		]);
	});
});

describe('specification', () => {
	it('has a title page from @DocumentInfo and the project', () => {
		const { doc } = report('droneSpecification');
		expect(doc.title).toBe('Delivery drone requirements specification');
		expect(doc.number).toBe('DRN-SPEC-001');
		expect(doc.status).toBe('Draft for review');
		expect(doc.version).toBe('0.2.0');
		expect(doc.date).toBe('21 October 2026');
		expect(doc.scope).toEqual(['StakeholderNeeds::*', 'SystemRequirements::*']);
		expect(doc.sections.map((s) => `${s.number} ${s.title}`)).toEqual([
			'1 Introduction',
			'2 Requirements',
			'3 Traceability',
			'4 Coverage',
			'5 Gaps'
		]);
	});

	it('lists requirements by package with their attributes and trace', () => {
		const { doc } = report('droneSpecification');
		const requirements = section(doc, 'Requirements');
		expect(requirements.sections.map((s) => s.title)).toEqual([
			'Stakeholder needs',
			'System requirements',
			'Derivation'
		]);
		const sys1 = section(doc, 'Flight endurance');
		expect(sys1.tag).toBe('SYS-001');
		expect(sys1.number).toBe('2.2.1');
		expect(sys1.badge).toEqual({ text: 'Done', tone: 'ok' });
		expect(
			plain((blocks(sys1, 'statement')[0] as Extract<Block, { type: 'statement' }>).text)
		).toMatch(
			/^The drone shall fly for at least 25 minutes with a 1 kg payload in still air before/
		);
		expect(facts(sys1)).toMatchObject({
			Kind: 'Performance',
			Priority: 'High',
			Verification: 'Analysis, test',
			Owner: 'J. Hale',
			'Derived from': 'STK-001 Parcel delivery',
			'Satisfied by': 'drone',
			'Verified by': 'enduranceFlightTest'
		});
		const rationale = sys1.blocks.find((b) => b.type === 'note');
		expect(rationale && plain(rationale.text)).toMatch(/^A 3 km delivery/);
		// Trace names link to their elements.
		const satisfied = (blocks(sys1, 'facts')[0] as Extract<Block, { type: 'facts' }>).facts.find(
			(f) => f.label === 'Satisfied by'
		)!;
		expect(satisfied.value[0]!.ref).toMatch(/^system\/DroneArchitecture\.sysml@/);
		expect(facts(section(doc, 'Parcel delivery'))['Derived into']).toBe(
			'SYS-001 Flight endurance, SYS-002 Payload capacity, SYS-010 Command and telemetry link'
		);
	});

	it('shows the derivation tree when derivation links exist', () => {
		const { doc } = report('droneSpecification');
		const tree = blocks(section(doc, 'Derivation'), 'tree')[0] as Extract<Block, { type: 'tree' }>;
		expect(plain(tree.items[0]!.text)).toBe('STK-001 Parcel delivery');
		expect(tree.items[0]!.children.map((c) => plain(c.text))).toEqual([
			'SYS-001 Flight endurance',
			'SYS-002 Payload capacity',
			'SYS-010 Command and telemetry link'
		]);
	});

	it('counts coverage and lists the gaps of the scope', () => {
		const { doc } = report('droneSpecification');
		expect(doc.summary).toEqual([
			{ label: 'Requirements', value: '17' },
			{ label: 'Satisfied', value: '76 %' },
			{ label: 'Verified', value: '65 %' },
			{ label: 'Gaps', value: '6' }
		]);
		const gaps = blocks(section(doc, 'Gaps'), 'table')[0] as Extract<Block, { type: 'table' }>;
		const ids = gaps.rows.map((r) => plain(r[0]!));
		expect(ids).toContain('SYS-005');
		expect(ids).toContain('SYS-006');
		expect(ids).not.toContain('SYS-001');
		// A need is covered through the requirements derived from it, when all of them are.
		expect(ids).not.toContain('STK-001');
		expect(ids).toContain('STK-003');
		expect(facts(section(doc, 'Parcel delivery'))['Satisfied by']).toBe(
			'Through the requirements derived from it'
		);
	});

	it('narrows to what the view exposes', () => {
		const texts = {
			...demo,
			'views/Views.sysml': demo['views/Views.sysml']!.replace(
				/(droneSpecification[\s\S]*?)expose StakeholderNeeds::\*;/,
				'$1'
			)
		};
		const { doc } = report('droneSpecification', texts);
		expect(doc.summary[0]).toEqual({ label: 'Requirements', value: '11' });
		// One package: the requirements sit directly in the chapter, no derivation tree.
		expect(section(doc, 'Flight endurance').number).toBe('2.1');
		expect(flatten(doc.sections).some((s) => s.title === 'Derivation')).toBe(false);
	});

	it('works as a standard report over the whole model without the report defs', () => {
		const texts = { ...demo };
		texts['libraries/ModelViews.sysml'] = texts['libraries/ModelViews.sysml']!.replace(
			reportLibrary(texts['libraries/ModelViews.sysml']),
			''
		);
		const { ctx, doc } = report('SpecificationDocument', texts);
		expect(ctx.chapters).toHaveLength(4);
		expect(doc.title).toBe('Drone UAV requirements specification');
		expect(doc.scope).toEqual([]);
		// Every requirement in the model, risk controls included.
		expect(Number(doc.summary[0]!.value)).toBeGreaterThan(17);
		expect(defaultExposes(ctx)).toContain('SystemRequirements::*');
	});

	it('exports Markdown', () => {
		const md = toMarkdown(report('droneSpecification').doc);
		expect(md).toMatch(/^# Delivery drone requirements specification\n/);
		expect(md).toContain('#### 2.2.1 SYS-001 Flight endurance (Done)');
		expect(md).toContain('> The drone shall fly for at least 25 minutes');
		expect(md).toContain('- **Satisfied by:** drone');
		expect(md).toMatch(/\| ID \| Requirement \| Derived from \| Satisfied by \| Verified by \|/);
	});
});

describe('interface control document', () => {
	it('collects the connections, interfaces, ports and items of its scope', () => {
		const { ctx } = report('droneInterfaceControl');
		const model = icdModel(ctx);
		expect(model.connections.map((c) => c.name)).toEqual([
			'batteryPower',
			'rotorPower',
			'avionicsPower',
			'radioCable'
		]);
		expect(model.interfaces.map((i) => i.element.label)).toEqual(['PowerSupply', 'CommandLink']);
		const power = model.interfaces[0]!;
		expect(power.ends.map((e) => `${e.name} : ${e.type}`)).toEqual([
			'supply : PowerPort',
			'load : ~PowerPort'
		]);
		expect(power.flows).toMatchObject([
			{ item: 'ElectricPower', from: 'supply.power', to: 'load.power' }
		]);
		expect(power.usedBy).toHaveLength(3);
		expect(model.portDefinitions.map((p) => p.element.label)).toContain('CommandLinkPort');
		const link = model.portDefinitions.find((p) => p.element.label === 'CommandLinkPort')!;
		expect(link.features.map((f) => `${f.direction} ${f.element.label}`)).toEqual([
			'out command',
			'in telemetry'
		]);
		const battery = model.parts.find((p) => p.element.label === 'battery')!;
		expect(
			battery.ports.map((p) => [p.element.label, p.direction, p.connections[0]?.other])
		).toEqual([['powerOut', 'out', 'powerDistribution.powerIn']]);
		const fc = model.parts.find((p) => p.element.label === 'flightController')!;
		const powerIn = fc.ports.find((p) => p.element.label === 'powerIn')!;
		expect([powerIn.conjugated, powerIn.direction]).toEqual([true, 'in']);
		expect(model.items.map((i) => i.label)).toContain('ElectricPower');
	});

	it('is a document with a chapter per subview', () => {
		const { doc } = report('droneInterfaceControl');
		expect(doc.title).toBe('Delivery drone interface control document');
		expect(doc.sections.map((s) => s.title)).toEqual([
			'Introduction',
			'Interconnection',
			'Connections',
			'Interfaces',
			'Port definitions',
			'Items',
			'Ports by part'
		]);
		const connections = blocks(section(doc, 'Connections'), 'table')[0] as Extract<
			Block,
			{ type: 'table' }
		>;
		expect(connections.rows[0]!.map(plain)).toEqual([
			'batteryPower',
			'PowerSupply',
			'battery.powerOut',
			'powerDistribution.powerIn',
			expect.any(String)
		]);
		expect(doc.summary).toEqual([
			{ label: 'Connections', value: '4' },
			{ label: 'Interfaces', value: '2' },
			{ label: 'Port definitions', value: '6' },
			{ label: 'Items', value: expect.any(String) }
		]);
	});
});
