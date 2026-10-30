/**
 * Views and tables over the toolkit's model, in Node against the real
 * toolkit: the earlier engine's table tests (`view_render.rs`) ported, and
 * every standard table of the demo compared with what the earlier engine
 * rendered (row and column counts, spot cells), with the deliberate
 * differences asserted.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceFile } from '../../protocol';
import type { RenderedTable } from '../../types';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';
import { collapseWhitespace, displayValue } from './text';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
});

const one = (text: string, path = 'p.sysml'): SourceFile[] => [{ path, text }];
const render = (files: SourceFile[], name: string) => host.renderView(files, name);
const col = (t: RenderedTable, name: string) => {
	const i = t.columns.indexOf(name);
	if (i < 0) throw new Error(`no column ${name} in ${t.columns.join(', ')}`);
	return t.rows.map((r) => r[i]!);
};
const record = (t: RenderedTable, row: number) =>
	Object.fromEntries(t.columns.map((c, i) => [c, t.rows[row]![i]!]));

describe('table rendering (the earlier engine’s tests)', () => {
	const FMEA = `package P {
		metadata def Fmea {
			attribute failureMode : ScalarValues::String;
			attribute severity : ScalarValues::Integer;
			attribute likelihood : ScalarValues::Integer;
			attribute detection : ScalarValues::Integer;
		}
		metadata def TableRendering;
		view def Worksheet {
			@TableRendering {
				rows = "@Fmea";
				columns = "element; failureMode; severity; likelihood; detection; rpn = severity*likelihood*detection";
				sortBy = "-rpn";
			}
		}
		view def Matrix { @TableRendering { rows = "@Fmea"; pivot = "severity; likelihood"; } }
		view def HighRisk {
			@TableRendering {
				rows = "@Fmea";
				columns = "element; rpn = severity*likelihood*detection";
				where = "severity >= 8";
			}
		}
		part def Battery;
		part battery : Battery {
			@Fmea { failureMode = "Thermal runaway"; severity = 9; likelihood = 3; detection = 4; }
			@Fmea { failureMode = "Capacity fade"; severity = 5; likelihood = 6; detection = 3; }
		}
	}`;

	it('computes and sorts columns', () => {
		const t = render(one(FMEA), 'Worksheet');
		expect(t.columns).toEqual([
			'element',
			'failureMode',
			'severity',
			'likelihood',
			'detection',
			'rpn'
		]);
		expect(col(t, 'rpn')).toEqual(['108', '90']);
		expect(t.rows[0]![1]).toBe('Thermal runaway');
		// The row is the annotation, written on line 26, about the battery.
		expect(t.sources[0]).toMatchObject({ element: 'P::battery', file: 'p.sysml', line: 26 });
		expect(t.sources[0]!.annotation).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('filters rows with `where`', () => {
		expect(render(one(FMEA), 'HighRisk').rows).toEqual([['battery', '108']]);
	});

	it('counts a pivot grid, rows descending', () => {
		const t = render(one(FMEA), 'Matrix');
		expect(t.columns).toEqual(['severity\\likelihood', '3', '6']);
		expect(t.rows).toEqual([
			['9', '1', ''],
			['5', '', '1']
		]);
		expect(t.sources).toEqual([]);
		expect(t.editable).toEqual([null, null, null]);
	});

	it('says how columns are edited', () => {
		const src = `package P {
			private import ScalarValues::*;
			metadata def Fmea {
				attribute failureMode : String;
				attribute severity : Integer;
				ref target : Part[0..1];
			}
			metadata def TableRendering;
			occurrence def Hazard { attribute description : String[0..1]; }
			occurrence fire : Hazard { :>> description = "Fire"; }
			view def Log { @TableRendering { rows = "type:Hazard"; columns = "element; description; type; line"; } }
			view def Sheet {
				@TableRendering { rows = "@Fmea"; columns = "element; failureMode; severity; target; rpn = severity * 2"; }
			}
			part p { @Fmea { failureMode = "x"; severity = 3; } }
		}`;
		const log = render(one(src), 'Log');
		expect(log.rows).toEqual([['fire', 'Fire', 'Hazard', '10']]);
		expect(log.editable).toEqual([
			{ field: 'name', kind: 'text' },
			{ field: 'feature:description', kind: 'text' },
			null,
			null
		]);
		expect(log.availableFields).toContain('parent');
		const sheet = render(one(src), 'Sheet');
		expect(sheet.editable).toEqual([
			null,
			{ field: 'metadata:Fmea.failureMode', kind: 'text' },
			{ field: 'metadata:Fmea.severity', kind: 'number' },
			null,
			null
		]);
	});

	it('compares strings in `where` by the name a person writes', () => {
		const src = `package P {
			metadata def TableRendering;
			enum def RiskCategory { enum software; enum design; }
			metadata def Line { attribute failureMode : ScalarValues::String; attribute category : RiskCategory; }
			part w {
				@Line { failureMode = "A"; category = RiskCategory::software; }
				@Line { failureMode = "B"; category = RiskCategory::design; }
			}
			view def SW {
				@TableRendering { rows = "@Line"; columns = "failureMode; category"; where = "category == \\"software\\""; }
			}
		}`;
		const t = render(one(src), 'SW');
		// An enum value reads as its literal.
		expect(t.rows).toEqual([['A', 'software']]);
		expect(t.editable?.[1]).toEqual({
			field: 'metadata:Line.category',
			kind: 'enum',
			options: ['software', 'design']
		});
	});

	it('keeps connections of a type and its specializations', () => {
		const src = `package P {
			metadata def TableRendering;
			connection def Mate; connection def Causation; connection def Bolted :> Mate;
			part a; part b; part c; part d; part e; part f;
			connection m1 : Mate connect a to b;
			connection m2 : Bolted connect c to d;
			connection k1 : Causation connect e to f;
			view def Fits {
				@TableRendering { rows = "relation:connection:Mate"; columns = "connection; source; target"; sortBy = "connection"; }
			}
		}`;
		const t = render(one(src), 'Fits');
		expect(t.rows).toEqual([
			['m1', 'a', 'b'],
			['m2', 'c', 'd']
		]);
		expect(t.sources[0]!.element).toBe('P::m1');
	});

	it('lists successions with their names and ends', () => {
		const src = `package P {
			metadata def TableRendering;
			action def Prog {
				action a { action inner; } action b { action inner; } action c; action d;
				succession s1 first a then b;
				first b then c;
				succession s2 first c then d;
				first a.inner then b.inner;
			}
			view def Links { @TableRendering { rows = "relation:succession"; columns = "succession; source; target; parent"; } }
		}`;
		expect(render(one(src), 'Links').rows).toEqual([
			['s1', 'a', 'b', 'Prog'],
			['', 'b', 'c', 'Prog'],
			['s2', 'c', 'd', 'Prog'],
			['', 'a.inner', 'b.inner', 'Prog']
		]);
	});

	it('is a bill of materials: parts and items, quantities multiplied down the tree', () => {
		const src = `package P {
			metadata def TableRendering;
			part def Wheel;
			part def Axle { part wheel : Wheel[2]; }
			part def Car { part axle : Axle[2]; connection j connect axle to axle; }
			view def Bom { @TableRendering { rows = "composition:Car"; columns = "path; quantity; extended"; sortBy = "path"; } }
		}`;
		expect(render(one(src), 'Bom').rows).toEqual([
			['axle', '2', '2'],
			['axle.wheel', '2', '4']
		]);
	});

	it('explains a view without a table', () => {
		expect(() => render(one('package P { view def Empty; }'), 'Empty')).toThrow(/@TableRendering/);
		const src = 'package P { view def GeneralView; view v : GeneralView { expose P::*; } }';
		const v = host.listViews(one(src)).find((x) => x.name === 'v')!;
		expect(v).toMatchObject({ isUsage: true, hasTable: false, definition: 'GeneralView' });
		expect(() => render(one(src), 'v')).toThrow(/typed by `GeneralView`/);
		expect(() => render(one(src), 'Nope')).toThrow(
			/not found\. Available views: .*RequirementGaps/
		);
	});

	it('counts kinds', () => {
		const src = `package P {
			metadata def TableRendering;
			view def Stats { @TableRendering { rows = "kindcounts"; columns = "kind; definitions; usages"; } }
			part def A; part def B; part a : A;
		}`;
		const t = render(one(src), 'Stats');
		expect(t.rows.find((r) => r[0] === 'part def')).toEqual(['part def', '2', '0']);
		expect(t.rows.find((r) => r[0] === 'part')).toEqual(['part', '0', '1']);
	});

	it('reads body values of typed usages', () => {
		const src = `package P {
			metadata def TableRendering;
			occurrence def Hazard { attribute description : ScalarValues::String[0..1]; }
			occurrence def Fire :> Hazard;
			view def Log { @TableRendering { rows = "type:Hazard"; columns = "element; description"; } }
			occurrence fire : Fire { :>> description = "Lithium cell fire"; }
		}`;
		expect(render(one(src), 'Log').rows).toEqual([['fire', 'Lithium cell fire']]);
	});
});

describe('view usages: expose, filter and inherited tables', () => {
	const SCOPED = `package Lib {
		metadata def TableRendering;
		metadata def Fmea;
		view def Worksheet {
			@TableRendering { rows = "@Fmea"; columns = "element; failureMode; severity"; sortBy = "-severity"; }
		}
	}
	package Power {
		part def Battery { @Lib::Fmea { failureMode = "Thermal runaway"; severity = 9; } }
		package Cells { part def Cell { @Lib::Fmea { failureMode = "Short"; severity = 7; } } }
	}
	package Motion {
		part def Motor { @Lib::Fmea { failureMode = "Seizure"; severity = 8; } }
	}
	package Views {
		view power : Lib::Worksheet { expose Power::*; }
		view powerDeep : Lib::Worksheet { expose Power::**; }
		view highOnly : Lib::Worksheet {
			doc /* Only the worst. */
			@Lib::TableRendering { where = "severity >= 9"; }
		}
		view motorOnly : Lib::Worksheet { expose Motion::Motor; }
	}`;

	it('inherit the def’s table; `::*` keeps members, `::**` everything nested, a name the element', () => {
		const files = one(SCOPED);
		expect(render(files, 'Worksheet').rows).toHaveLength(3);
		const power = render(files, 'power');
		expect(power.view).toBe('power');
		expect(col(power, 'failureMode')).toEqual(['Thermal runaway']);
		expect(power.warnings).toEqual([]);
		expect(col(render(files, 'powerDeep'), 'failureMode')).toEqual(['Thermal runaway', 'Short']);
		expect(col(render(files, 'motorOnly'), 'failureMode')).toEqual(['Seizure']);
		expect(render(files, 'Views::power').rows).toHaveLength(1);
	});

	it('override single fields with their own @TableRendering', () => {
		const t = render(one(SCOPED), 'highOnly');
		expect(t.columns).toEqual(['element', 'failureMode', 'severity']);
		expect(col(t, 'failureMode')).toEqual(['Thermal runaway']);
	});

	it('are listed with their def, doc and qualified name', () => {
		const views = host.listViews(one(SCOPED));
		expect(views.find((v) => v.name === 'Worksheet')).toMatchObject({
			isUsage: false,
			hasTable: true,
			qualifiedName: 'Lib::Worksheet',
			builtin: false
		});
		expect(views.find((v) => v.name === 'highOnly')).toMatchObject({
			isUsage: true,
			hasTable: true,
			definition: 'Worksheet',
			doc: 'Only the worst.',
			qualifiedName: 'Views::highOnly'
		});
		expect(views.find((v) => v.name === 'power')?.exposes).toEqual(['Power::*']);
	});

	it('do not expose what a namespace only imports', () => {
		// `expose A::*` per the letter of the spec takes in A's private imports too
		// (an expose imports everything, whatever its visibility); a table lists A's own.
		const src = `package Lib {
			metadata def TableRendering;
			view def Ports { @TableRendering { rows = "kind:port"; columns = "owner; element"; } }
		}
		package B { port def P; part def Pump { port inlet : P; } }
		package A { private import B::*; part def Valve { port outlet : B::P; } }
		package Views { view a : Lib::Ports { expose A::**; } }`;
		expect(render(one(src), 'a').rows).toEqual([['Valve', 'outlet']]);
		expect(render(one(src), 'Ports').rows).toHaveLength(2);
	});

	it('expose what a usage inherits from its type', () => {
		const src = `package Lib {
			metadata def TableRendering;
			view def Ports { @TableRendering { rows = "kind:port"; columns = "owner; element"; } }
		}
		package Arch {
			port def P;
			part def Pump { port inlet : P; }
			part def Tank { port outlet : P; }
			part plant { part pump : Pump; }
			view plantPorts : Lib::Ports { expose Arch::plant::**; }
		}`;
		expect(render(one(src), 'plantPorts').rows).toEqual([['Pump', 'inlet']]);
	});

	it('expose a name written from the global scope (`$::`), as lifted JSON spells it', () => {
		const src = `package Lib {
			metadata def TableRendering;
			view def Ports { @TableRendering { rows = "kind:port"; columns = "owner; element"; } }
		}
		package Arch {
			port def P;
			part def Pump { port inlet : P; }
			part plant { part pump : Pump; }
			view plantPorts : Lib::Ports { expose $::Arch::plant::**; }
		}`;
		expect(render(one(src), 'plantPorts').rows).toEqual([['Pump', 'inlet']]);
	});

	it('walk a usage’s body and type from package roots, and narrow by path', () => {
		const src = `package Arch {
			metadata def TableRendering;
			part def Rotor { part motor : Motor; }
			part def Motor;
			part def Drone;
			part drone : Drone { part rotors : Rotor[4]; part battery : Battery; }
			part def Battery;
			part spare : Rotor;
			view def Bom { @TableRendering { rows = "composition"; columns = "path; quantity; extended"; sortBy = "path"; } }
			view rotorsOnly : Bom { expose Arch::drone::rotors::*; }
			view droneOnly : Bom { expose Arch::drone::**; }
		}`;
		expect(render(one(src), 'Bom').rows).toEqual([
			['drone', '1', '1'],
			['drone.battery', '1', '1'],
			['drone.rotors', '4', '4'],
			['drone.rotors.motor', '1', '4'],
			['spare', '1', '1'],
			['spare.motor', '1', '1']
		]);
		expect(col(render(one(src), 'rotorsOnly'), 'path')).toEqual(['drone.rotors.motor']);
		// `X::**` exposes X itself too (SysML v2 7.25.3); the other motor stays out.
		expect(col(render(one(src), 'droneOnly'), 'path')).toEqual([
			'drone',
			'drone.battery',
			'drone.rotors',
			'drone.rotors.motor'
		]);
	});

	it('filter by metaclass and by metadata', () => {
		const src = `package P {
			metadata def TableRendering;
			metadata def Critical { attribute level : ScalarValues::Integer; }
			part def Box { part a : A; item b : B; part c : A { @Critical { level = 1; } } }
			part def A; item def B;
			view def Bom { @TableRendering { rows = "composition:Box"; columns = "element"; } }
			view items : Bom { filter @SysML::ItemUsage; }
			view parts : Bom { filter @SysML::PartUsage; }
			view critical : Bom { filter @Critical; }
			view either : Bom { filter @SysML::PartUsage or @Critical; }
			view exposedParts : Bom { expose P::Box::**; filter @SysML::PartUsage; }
			view odd : Bom { filter a.b > 3; }
		}`;
		const get = (v: string) => {
			const t = render(one(src), v);
			return { rows: t.rows.map((r) => r[0]), warnings: t.warnings };
		};
		// A part is an item (PartUsage specializes ItemUsage); the earlier engine
		// compared metaclass names and kept only `b`.
		expect(get('items')).toEqual({ rows: ['a', 'b', 'c'], warnings: [] });
		expect(get('parts')).toEqual({ rows: ['a', 'c'], warnings: [] });
		expect(get('critical')).toEqual({ rows: ['c'], warnings: [] });
		expect(get('either')).toEqual({ rows: ['a', 'c'], warnings: [] });
		expect(get('exposedParts')).toEqual({ rows: ['a', 'c'], warnings: [] });
		expect(get('odd')).toEqual({
			rows: ['a', 'b', 'c'],
			warnings: ['filter `a.b > 3` is not supported for tables; ignored']
		});
	});
});

describe('requirements, trace and ports', () => {
	const REQUIREMENTS = `package Reqs {
		private import ModelingMetadata::*;
		enum def RequirementKind { enum performance; enum safety; }
		enum def VerificationMethod { enum test; enum 'analysis'; }
		requirement def Base {
			attribute kind : RequirementKind[0..1];
			attribute verificationMethod : VerificationMethod[0..*];
		}
		requirement <'R-1'> 'Flight endurance' : Base {
			doc /* The drone shall fly for 25 minutes
			     * with a 1 kg payload. */
			:>> kind = RequirementKind::performance;
			:>> verificationMethod = (VerificationMethod::'analysis', VerificationMethod::test);
			@StatusInfo { status = StatusKind::done; owner = "J. Hale"; }
			@Rationale { text = "A delivery takes 10 minutes."; }
			@Issue { text = "Headwind not modelled."; }
		}
		requirement <'R-2'> 'Geofencing' : Base {
			doc /* The drone shall stay inside the geofence. */
			:>> kind = RequirementKind::safety;
		}
		requirement <'R-3'> 'Noise' : Base { doc /* Quiet in hover. */ }
		metadata def TableRendering;
		view def Gaps {
			@TableRendering { rows = "requirements"; columns = "id; title; satisfied; verified"; where = "satisfied == 0 or verified == 0"; sortBy = "id"; }
		}
		view def All {
			@TableRendering {
				rows = "requirements";
				columns = "id; title; text; kind; verificationMethod; status; owner; rationale; issues; satisfiedBy; verifiedBy; satisfied; verified; type; line";
				sortBy = "id";
			}
		}
		view def Rtm { @TableRendering { rows = "trace"; columns = "requirement; id; satisfied; verified"; } }
		view def Tm { @TableRendering { rows = "relation:satisfy"; pivot = "requirement; by"; sortBy = "requirement"; } }
	}`;
	// Trace links resolve by the language's rules: names are imported, not matched.
	const DESIGN = `package Design {
		private import Reqs::*;
		part drone { part controller; }
		satisfy Reqs::'Flight endurance' by drone;
		satisfy 'R-2' by drone.controller;
		verification flightTest { objective { verify 'Flight endurance'; } }
	}`;
	const files = [
		{ path: 'reqs.sysml', text: REQUIREMENTS },
		{ path: 'design.sysml', text: DESIGN }
	];

	it('carry attributes, status and resolved trace links', () => {
		const t = render(files, 'All');
		expect(t.warnings).toEqual([]);
		expect(col(t, 'id')).toEqual(['R-1', 'R-2', 'R-3']);
		expect(record(t, 0)).toEqual({
			id: 'R-1',
			title: 'Flight endurance',
			text: 'The drone shall fly for 25 minutes with a 1 kg payload.',
			kind: 'performance',
			verificationMethod: 'analysis, test',
			status: 'done',
			owner: 'J. Hale',
			rationale: 'A delivery takes 10 minutes.',
			issues: 'Headwind not modelled.',
			satisfiedBy: 'drone',
			verifiedBy: 'flightTest',
			satisfied: '1',
			verified: '1',
			type: 'Base',
			line: '9'
		});
		expect(col(t, 'satisfiedBy')[1]).toBe('drone.controller');
		expect(col(t, 'kind')[2]).toBe('');
		expect(t.sources[0]).toEqual({
			element: "Reqs::'Flight endurance'",
			file: 'reqs.sysml',
			line: 9
		});
		expect(t.editable?.slice(0, 8)).toEqual([
			{ field: 'shortName', kind: 'text' },
			{ field: 'name', kind: 'text' },
			{ field: 'doc', kind: 'longText' },
			{ field: 'feature:kind', kind: 'enum', options: ['performance', 'safety'] },
			{ field: 'feature:verificationMethod', kind: 'enumList', options: ['test', 'analysis'] },
			{
				field: 'metadata:StatusInfo.status',
				kind: 'enum',
				options: ['open', 'tbd', 'tbr', 'tbc', 'done', 'closed']
			},
			{ field: 'metadata:StatusInfo.owner', kind: 'text' },
			{ field: 'metadata:Rationale.text', kind: 'longText' }
		]);
	});

	it('select gaps with `where`', () => {
		const t = render(files, 'Gaps');
		expect(col(t, 'id')).toEqual(['R-2', 'R-3']);
		expect(col(t, 'satisfied')).toEqual(['1', '0']);
		expect(col(t, 'verified')).toEqual(['0', '0']);
	});

	it('trace coverage says yes and no', () => {
		expect(render(files, 'Rtm').rows).toEqual([
			['Flight endurance', 'R-1', 'yes', 'yes'],
			['Geofencing', 'R-2', 'yes', 'no'],
			['Noise', 'R-3', 'no', 'no']
		]);
	});

	it('pivot satisfy links by requirement: a matrix of every requirement in scope', () => {
		const t = render(files, 'Tm');
		expect(t.columns).toEqual(['requirement', 'drone', 'drone.controller']);
		// R-3 has no link: it is a row all the same, so the gap shows.
		expect(t.rows).toEqual([
			['R-1 Flight endurance', '1', ''],
			['R-2 Geofencing', '', '1'],
			['R-3 Noise', '', '']
		]);
		expect(t.sources.map((s) => s.element)).toEqual([
			"Reqs::'Flight endurance'",
			'Reqs::Geofencing',
			'Reqs::Noise'
		]);
		const m = t.matrix!;
		expect(m.relation).toBe('satisfy');
		expect(m.requirements.map(({ id, title }) => [id, title])).toEqual([
			['R-1', 'Flight endurance'],
			['R-2', 'Geofencing'],
			['R-3', 'Noise']
		]);
		expect(m.requirements.every((r) => r.elementId)).toBe(true);
		expect(
			m.elements.map(({ written, name, path, qualifiedName, kind }) => ({
				written,
				name,
				path,
				qualifiedName,
				kind
			}))
		).toEqual([
			{ written: 'drone', name: 'drone', path: [], qualifiedName: 'Design::drone', kind: 'part' },
			{
				written: 'drone.controller',
				name: 'controller',
				path: ['drone'],
				qualifiedName: 'Design::drone::controller',
				kind: 'part'
			}
		]);
		expect(m.links.map(({ row, column, file, line }) => [row, column, file, line])).toEqual([
			[0, 0, 'design.sysml', 4],
			[1, 1, 'design.sysml', 5]
		]);
		const text = files[1]!.text;
		const { start, end } = m.links[1]!;
		expect(text.slice(start, end)).toMatch(/^satisfy 'R-2' by drone\.controller/);
	});

	it('a verification matrix: verify links by requirement, the rest as gaps', () => {
		const verification = [
			...files,
			{
				path: 'views.sysml',
				text: `package V { metadata def TableRendering; view def Vm { @TableRendering { rows = "relation:verify"; pivot = "requirement; by"; sortBy = "requirement"; } } }`
			}
		];
		const t = render(verification, 'Vm');
		expect(t.columns).toEqual(['requirement', 'flightTest']);
		expect(t.rows).toEqual([
			['R-1 Flight endurance', '1'],
			['R-2 Geofencing', ''],
			['R-3 Noise', '']
		]);
		expect(t.matrix?.relation).toBe('verify');
		expect(t.matrix?.elements[0]).toMatchObject({ name: 'flightTest', kind: 'verification' });
	});

	it('a matrix shows the requirements its view exposes', () => {
		const scoped = [
			...files,
			{
				path: 'views.sysml',
				text: `package V { private import Reqs::*; view tm : Reqs::Tm { expose Reqs::Geofencing; expose Reqs::Noise; } }`
			}
		];
		const t = render(scoped, 'V::tm');
		expect(t.rows).toEqual([
			['R-2 Geofencing', '1'],
			['R-3 Noise', '']
		]);
		expect(t.columns).toEqual(['requirement', 'drone.controller']);
	});

	it('don’t count a link whose requirement doesn’t resolve', () => {
		// The earlier engine matched `'R-3'` by name across packages; it isn't visible here.
		const loose = [
			files[0]!,
			{ path: 'design.sysml', text: `package Design { part d; satisfy 'R-3' by d; }` }
		];
		expect(render(loose, 'Rtm').rows[2]).toEqual(['Noise', 'R-3', 'no', 'no']);
	});

	it('ports show owner, direction from their def and what they connect to', () => {
		const src = `package P {
			metadata def TableRendering;
			item def Power;
			port def PowerPort { out item power : Power; }
			part def Battery { port powerOut : PowerPort; }
			part def Load { port powerIn : ~PowerPort; port spare : PowerPort; }
			interface def Cable { end port a : PowerPort; end port b : ~PowerPort; }
			part system {
				part battery : Battery;
				part load : Load;
				interface cable : Cable connect battery.powerOut to load.powerIn;
			}
			view def Ports { @TableRendering { rows = "kind:port"; columns = "owner; element; type; direction; connectedTo; via"; } }
		}`;
		const t = render(one(src), 'Ports');
		expect(t.rows).toEqual([
			['Battery', 'powerOut', 'PowerPort', 'out', 'load.powerIn', 'cable'],
			['Load', 'powerIn', '~PowerPort', 'in', 'battery.powerOut', 'cable'],
			['Load', 'spare', 'PowerPort', 'out', '', '']
		]);
		expect(t.editable).toEqual([null, { field: 'name', kind: 'text' }, null, null, null, null]);
	});
});

describe('text helpers', () => {
	it('read values and docs as people do', () => {
		expect(collapseWhitespace('one\n * two\n *  three')).toBe('one two three');
		expect(displayValue('(K::a, K::b)')).toBe('a, b');
		expect(displayValue('"x"')).toBe('x');
		expect(displayValue('25 [min]')).toBe('25 [min]');
		expect(displayValue("Kind::'use'")).toBe('use');
	});
});

describe('the bundled view libraries', () => {
	const project = one(
		`package Reqs { requirement <'R-1'> 'Mass' { doc /* At most 4 kg. */ }
			requirement <'R-2'> 'Range' { doc /* At least 5 km. */ }
			view massOnly : ModelViews::RequirementsTable { expose Reqs::'Mass'; } }`,
		'reqs.sysml'
	);

	it('are added to a project that lacks them, and listed as built in', () => {
		const views = host.listViews(project);
		expect(views.find((v) => v.name === 'RequirementGaps')).toMatchObject({
			builtin: true,
			hasTable: true,
			isUsage: false,
			qualifiedName: 'ModelViews::RequirementGaps',
			file: 'libraries/ModelViews.sysml'
		});
		expect(views.find((v) => v.name === 'massOnly')).toMatchObject({
			builtin: false,
			isUsage: true,
			hasTable: true,
			definition: 'RequirementsTable',
			qualifiedName: 'Reqs::massOnly',
			file: 'reqs.sysml'
		});
		// Their contents are no rows, and they make no problems in the project.
		const gaps = render(project, 'RequirementGaps');
		expect(gaps.rows.map((r) => r.slice(0, 4))).toEqual([
			['R-1', 'Mass', '0', '0'],
			['R-2', 'Range', '0', '0']
		]);
		expect(render(project, 'massOnly').rows.map((r) => r[0])).toEqual(['R-1']);
		const analyses = host.analyzeProject(project);
		expect(analyses).toHaveLength(1);
		expect(analyses[0]!.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	});

	it('give way to a project’s own copy', () => {
		const own = [
			...project,
			{
				path: 'lib/ModelViews.sysml',
				text: 'library package ModelViews { view def RequirementsTable; }'
			}
		];
		expect(host.listViews(own).some((v) => v.name === 'RequirementGaps')).toBe(false);
		expect(() => render(own, 'RequirementsTable')).toThrow(/@TableRendering/);
	});

	it('are the demo’s copies', () => {
		const libraries = host.viewLibraries();
		expect(libraries.map((l) => l.path)).toEqual([
			'libraries/Reporting.sysml',
			'libraries/ModelViews.sysml'
		]);
		const demo = demoFiles();
		for (const l of libraries) expect(l.text).toBe(demo.find((f) => f.path === l.path)?.text);
	});
});

/**
 * The demo's tables against what the earlier engine rendered (its row and
 * column counts and cells, recorded before it went), with the deliberate
 * differences asserted.
 */
describe('the demo’s tables', () => {
	const demo = demoFiles();
	const table = (name: string) => render(demo, name);
	const shape = (t: RenderedTable) => [t.rows.length, t.columns.length];

	it('lists the views the earlier engine listed', () => {
		const views = host.listViews(demo);
		// The earlier engine's 41, the budgets and checks (3 view defs, 3 usages), the
		// trade study (a view def and a usage), the sequence and saved trace and
		// verification matrices, less the design gaps (the overview lists them).
		// The risk library's worksheets for each kind of FMEA, the risk reduction and the
		// demo's risk matrix and hazard log are six more; its saved review and risk
		// reduction two more. The dependency matrices: four view defs and the demo's four.
		// The variability matrix: a view def and the demo's usage.
		expect(views).toHaveLength(69);
		expect(views.filter((v) => v.hasTable)).toHaveLength(45);
		expect(views.every((v) => !v.builtin)).toBe(true);
		expect(views.find((v) => v.name === 'droneBreakdown')).toEqual({
			name: 'droneBreakdown',
			qualifiedName: 'DroneViews::droneBreakdown',
			file: 'views/Views.sysml',
			isUsage: true,
			hasTable: false,
			definition: 'GeneralView',
			doc: 'The parts tree of our drone design: what it is made of, and how many.',
			renderAs: 'asTreeDiagram',
			exposes: ['DroneArchitecture::drone::**'],
			builtin: false
		});
		expect(views.find((v) => v.name === 'SpecificationDocument')?.renderAs).toBe('asDocument');
		expect(views.find((v) => v.name === 'droneInterfaceControl')?.exposes).toEqual([
			'DroneArchitecture::drone::*',
			'DroneInterfaces::*'
		]);
	});

	it('requirements: the same rows, cells, sources and editing', () => {
		const t = table('ModelViews::RequirementsTable');
		// The columns end with how each requirement's verification went.
		expect(shape(t)).toEqual([24, 12]);
		expect(t.columns.at(-1)).toBe('result');
		expect(col(t, 'result')[col(t, 'id').indexOf('SYS-001')]).toBe('not run');
		expect(col(t, 'result')[col(t, 'id').indexOf('SYS-005')]).toBe('');
		expect(col(t, 'id').slice(0, 8)).toEqual([
			'RC-001',
			'RC-002',
			'RC-003',
			'RC-004',
			'RC-005',
			'RC-006',
			'RC-007',
			'STK-001'
		]);
		expect(record(t, col(t, 'id').indexOf('SYS-001'))).toEqual({
			id: 'SYS-001',
			title: 'Flight endurance',
			text: 'The drone shall fly for at least 25 minutes with a 1 kg payload in still air before it reaches its landing reserve.',
			kind: 'performance',
			priority: 'high',
			verificationMethod: 'analysis, test',
			status: 'done',
			owner: 'J. Hale',
			satisfiedBy: 'drone',
			// The verdict of the claims that satisfy it (`drone.endurance >= 25 [min]`).
			check: 'satisfied',
			verifiedBy: 'enduranceFlightTest',
			// Planned, with no result recorded yet.
			result: 'not run'
		});
		expect(record(t, 0)).toMatchObject({
			satisfiedBy: 'batteryManagementSystem',
			verifiedBy: 'batteryAbuseTest'
		});
		expect(t.sources[col(t, 'id').indexOf('SYS-007')]).toEqual({
			element: 'SystemRequirements::Geofencing',
			file: 'requirements/SystemRequirements.sysml',
			line: 85
		});
		expect(t.editable?.map((e) => e?.field ?? null)).toEqual([
			'shortName',
			'name',
			'doc',
			'feature:kind',
			'feature:priority',
			'feature:verificationMethod',
			'metadata:StatusInfo.status',
			'metadata:StatusInfo.owner',
			null,
			null,
			null,
			null
		]);
		expect(t.editable?.[5]).toEqual({
			field: 'feature:verificationMethod',
			kind: 'enumList',
			options: ['test', 'analysis', 'inspection', 'demonstration']
		});
		expect(t.availableFields?.slice(-3)).toEqual(['verificationMethod', 'hierarchy', 'hazard']);
	});

	it('gaps, coverage and the trace and verification matrices', () => {
		// By the coverage rule: three stakeholder needs whose derived requirements are all
		// satisfied and verified are not gaps (STK-001, STK-002, STK-004).
		expect(shape(table('RequirementGaps'))).toEqual([8, 8]);
		expect(col(table('RequirementGaps'), 'id')).not.toContain('STK-001');
		const gaps = table('RequirementGaps');
		expect(col(gaps, 'id').filter((id) => id.startsWith('SYS'))).toEqual([
			'SYS-005',
			'SYS-006',
			'SYS-011'
		]);
		expect(gaps.rows.find((r) => r[0] === 'SYS-011')).toEqual([
			'SYS-011',
			'Controlled parcel release',
			'1',
			'0',
			'drone.payloadRelease',
			'',
			'open',
			'K. Novak'
		]);
		const coverage = table('requirementCoverage');
		expect(shape(coverage)).toEqual([24, 4]);
		// Who satisfies and verifies each requirement; an empty cell is a gap.
		expect(coverage.columns).toEqual(['requirement', 'id', 'satisfiedBy', 'verifiedBy']);
		expect(coverage.rows[0]).toEqual(['Acoustic noise', 'SYS-006', '', '']);
		expect(coverage.rows.find((r) => r[1] === 'RC-003')).toEqual([
			'Navigation integrity monitoring',
			'RC-003',
			'navigationIntegrityMonitor',
			''
		]);
		// Every requirement is a row of the matrices, linked or not.
		const trace = table('TraceMatrix');
		expect(shape(trace)).toEqual([24, 12]);
		expect(trace.columns.slice(1)).toEqual([
			'batteryManagementSystem',
			'drone',
			'drone.battery',
			'drone.flightController',
			'drone.payloadRelease',
			'drone.radio',
			'dropZoneScan',
			'fitPropellerGuards',
			'navigationIntegrityMonitor',
			'rotorHealthMonitor',
			'warningLabelsAndTone'
		]);
		const traceRow = (label: string) => trace.rows.find((r) => r[0] === label);
		expect(traceRow('SYS-002 Payload capacity')).toEqual([
			'SYS-002 Payload capacity',
			'',
			'1',
			...Array(9).fill('')
		]);
		expect(
			traceRow('SYS-005 Ingress protection')!
				.slice(1)
				.every((c) => !c)
		).toBe(true);
		expect(trace.rows.filter((r) => r.slice(1).every((c) => !c)).map((r) => r[0])).toEqual([
			'STK-001 Parcel delivery',
			'STK-002 Safe operation',
			'STK-003 Flying in typical weather',
			'STK-004 Approved for operation',
			'STK-005 Quiet neighbour',
			'STK-006 Safe hand-over',
			'SYS-005 Ingress protection',
			'SYS-006 Acoustic noise'
		]);
		expect(trace.matrix?.elements[3]).toMatchObject({
			written: 'drone.flightController',
			name: 'flightController',
			path: ['drone']
		});
		expect(trace.matrix?.links).toHaveLength(16);
		const verification = table('VerificationMatrix');
		expect(shape(verification)).toEqual([24, 11]);
		expect(verification.rows.find((r) => r[0] === 'SYS-010 Command and telemetry link')).toEqual([
			'SYS-010 Command and telemetry link',
			'',
			'',
			'',
			'',
			'1',
			'',
			'',
			'',
			'',
			''
		]);
		// Two risk controls are not verified yet, on purpose: the risk review shows the gap.
		expect(
			verification.rows
				.filter((r) => r[0]!.startsWith('RC-') && r.slice(1).every((c) => !c))
				.map((r) => r[0])
		).toEqual(['RC-003 Navigation integrity monitoring', 'RC-007 Drop-zone clearance check']);
		expect(verification.matrix?.relation).toBe('verify');
	});

	it('ports, resolved through the toolkit’s connection ends', () => {
		const t = table('InterfaceTable');
		expect(shape(t)).toEqual([21, 6]);
		expect(t.rows[2]).toEqual([
			'DeliveryDrone',
			'commandLink',
			'~CommandLinkPort',
			'inout',
			'groundStation.commandLink',
			'radioLink'
		]);
		expect(t.rows[12]).toEqual([
			'PowerDistributionBoard',
			'powerIn',
			'~PowerPort',
			'in',
			'battery.powerOut',
			'batteryPower'
		]);
		expect(shape(table('droneInterfaces'))).toEqual([19, 6]);
		expect(shape(table('PortTable'))).toEqual([21, 4]);
	});

	it('connections, allocations and the FMEA', () => {
		const connections = table('ConnectionTable');
		expect(shape(connections)).toEqual([21, 2]);
		expect(connections.rows[0]).toEqual(['battery.powerOut', 'powerDistribution.powerIn']);
		// A named connection is the element behind its row (the earlier engine gave none).
		expect(connections.sources[0]!.element).toBe('DroneArchitecture::drone::batteryPower');
		const allocations = table('AllocationMatrix');
		expect(shape(allocations)).toEqual([8, 2]);
		expect(allocations.rows[0]).toEqual(['drone.deliveryFlight.checkDropZone', 'drone.camera']);
		const fmea = table('fmeaWorksheet');
		// The figures come right after the failure, then the controls, so they stay in view in
		// a narrow pane.
		expect(fmea.columns).toEqual([
			'part',
			'failureMode',
			'severity',
			'likelihood',
			'detection',
			'rpn',
			'actionPriority',
			'riskControls',
			'rpnBand',
			'acceptability',
			'effect',
			'cause'
		]);
		expect(shape(fmea)).toEqual([9, 12]);
		expect(fmea.rows[1]).toEqual([
			'drone::battery',
			'Thermal runaway',
			'8',
			'3',
			'6',
			'144',
			'medium',
			'RC-001 Battery thermal protection',
			'medium',
			'reduce',
			'Fire in the airframe; loss of the drone; burns to bystanders',
			'Internal cell short, overcharge or crash damage'
		]);
		// RPN and action priority are the library's calcs, `Rpn(…)` and `ActionPriority(…)`.
		expect(col(fmea, 'rpn')).toEqual(['288', '144', '96', '96', '80', '72', '72', '60', '48']);
		expect(col(fmea, 'actionPriority')).toEqual([
			'high',
			'medium',
			'medium',
			'low',
			'medium',
			'low',
			'low',
			'low',
			'low'
		]);
		// The risk policy puts lines in each of its zones.
		expect(new Set(col(fmea, 'acceptability'))).toEqual(
			new Set(['unacceptable', 'reduce', 'acceptable'])
		);
		// `about drone::rotors::motor` is the motor feature of Rotor, which the rotors inherit.
		expect(fmea.sources[2]).toMatchObject({
			element: 'DroneComponents::Rotor::motor',
			file: 'risk/DesignFmea.sysml',
			line: 205
		});
		// New lines go in the package the worksheet exposes.
		expect(fmea.annotations).toEqual({ metadata: 'RiskAnalysis::Fmea', package: 'DroneFmea' });
		expect(fmea.columnSpecs?.[0]).toBe('part = element');
		expect(fmea.editable?.[2]).toEqual({ field: 'metadata:Fmea.severity', kind: 'number' });
		const all = table('FmeaWorksheet');
		// The category reads as its literal and is edited with the enum's literals.
		expect(col(all, 'category').filter((c) => c !== 'design')).toEqual(['software']);
		expect(all.editable?.[all.columns.indexOf('category')]).toEqual({
			field: 'metadata:Fmea.category',
			kind: 'enum',
			options: ['design', 'process', 'use', 'software']
		});
		// The risk matrix has every rating, 10 down to 1 by 1 to 10, so empty cells show.
		const matrix = table('riskMatrix');
		expect(matrix.counts).toMatchObject({ rows: 'severity', columns: 'likelihood' });
		expect(matrix.columns).toEqual(['severity\\likelihood', ...'12345678910'.match(/10|\d/g)!]);
		expect(matrix.rows.map((r) => r[0])).toEqual([
			'10',
			'9',
			'8',
			'7',
			'6',
			'5',
			'4',
			'3',
			'2',
			'1'
		]);
		expect(matrix.rows[2]).toEqual(['8', '', '2', '2', '1', '', '1', '', '', '', '']);
		expect(matrix.rows[4]).toEqual(['6', '', '', '1', '1', '1', '', '', '', '', '']);
		// Each hazard with its harms, the worst severity first, its controls and their links.
		const hazards = table('hazardLog');
		expect(hazards.columns).toEqual([
			'hazard',
			'description',
			'situations',
			'harms',
			'severity',
			'controls',
			'satisfiedBy',
			'verifiedBy'
		]);
		// Each hazard reaches its harm through a hazardous situation.
		expect(hazards.rows.map((r) => [r[0], r[2], r[3], r[4], r[7]])).toEqual([
			['batteryFire', 'fireNearPeople', 'burnInjury', 'critical', 'batteryAbuseTest'],
			['uncontrolledDescent', 'fallOverPeople', 'impactInjury', 'critical', 'rotorFailureTest'],
			['payloadDrop', 'parcelOverPeople', 'impactInjury', 'critical', 'releaseInterlockTest'],
			['flyAway', 'outsideApprovedArea', 'thirdPartyDamage', 'serious', ''],
			[
				'propellerContact',
				'handOverWithRotorsTurning',
				'cutInjury',
				'serious',
				'propellerGuardInspection, handOverWarningReview'
			]
		]);
		expect(hazards.editable?.slice(0, 2)).toEqual([
			{ field: 'name', kind: 'text' },
			{ field: 'feature:description', kind: 'text' }
		]);
		// A reference to a hazard (a control's `ref :>> hazard`) is not a hazard.
		expect(col(table('HazardLog'), 'hazard')).toEqual([
			'batteryFire',
			'uncontrolledDescent',
			'payloadDrop',
			'flyAway',
			'propellerContact'
		]);
	});

	it('the bill of materials follows the toolkit’s types and SysML’s `::**`', () => {
		const bom = table('BillOfMaterials');
		// The whole model: the drone in its service context, then the product line and its two
		// configurations (`DroneConfigurations`), each a drone of its own.
		expect(shape(bom)).toEqual([134, 5]);
		// `part drone :> DroneArchitecture::drone` is a DeliveryDrone (the earlier engine said `drone`).
		expect(bom.rows[1]!.slice(0, 2)).toEqual(['deliveryService.drone', 'DeliveryDrone']);
		expect(bom.rows[8]).toEqual([
			'deliveryService.drone.frontLeft.motor',
			'Motor',
			'1',
			'1',
			'Brushless outrunner motor.'
		]);
		// A row's element is the model element, not a path through the tree.
		expect(bom.sources[8]).toEqual({
			element: 'DroneComponents::Rotor::motor',
			file: 'system/Components.sysml',
			line: 62
		});
		// `ref part rotors` refers to the four rotors: they are counted once, where they are owned.
		expect(col(bom, 'path')).not.toContain('deliveryService.drone.rotors');
		// A variation lists choices (the battery trade study's), not parts.
		expect(col(bom, 'path').filter((p) => /batteryOptions|lithium/.test(p))).toEqual([]);
		const drone = table('droneBillOfMaterials');
		// `expose DroneArchitecture::drone::**` exposes the drone too.
		expect(shape(drone)).toEqual([26, 5]);
		expect(drone.rows[0]!.slice(0, 4)).toEqual(['drone', 'DeliveryDrone', '1', '1']);
		expect(col(drone, 'path')).not.toContain('deliveryService.drone.battery');
	});

	it('model stats count what the toolkit resolved', () => {
		const stats = table('ModelStats');
		expect(stats.rows.slice(0, 17).map((r) => r[0])).toEqual([
			'action def',
			'attribute def',
			'calc def',
			'connection def',
			'enum def',
			'interface def',
			'item def',
			'metadata def',
			'occurrence def',
			'package',
			'part def',
			'port def',
			'rendering def',
			'requirement def',
			'state def',
			'use case def',
			'view def'
		]);
		const row = (kind: string) => stats.rows.find((r) => r[0] === kind);
		// The drone's variation defs (`BatteryOption`, `RadioOption`) are two.
		expect(row('part def')).toEqual(['part def', '21', '0']);
		expect(row('requirement')).toEqual(['requirement', '0', '24']);
		// The dependency matrices' metadata def has five; the reporting library's convention two;
		// the long-range radio three.
		expect(row('attribute')).toEqual(['attribute', '0', '238']);
		// Enum literals count as usages (the convention severities, three), metadata annotations are anonymous.
		expect(row('enum')).toEqual(['enum', '0', '46']);
		expect(row('metadata')).toBeUndefined();
	});

	it('report chapters render from the library’s subviews', () => {
		expect(shape(table('ModelViews::SpecificationDocument::requirementsChapter'))).toEqual([
			24, 12
		]);
		expect(shape(table('ModelViews::InterfaceControlDocument::connectionsChapter'))).toEqual([
			21, 2
		]);
		expect(() => table('ModelViews::SpecificationDocument')).toThrow(/no @TableRendering/);
	});

	it('render in a few milliseconds once the model is read', () => {
		table('RequirementsTable');
		const started = performance.now();
		for (const name of ['RequirementsTable', 'BillOfMaterials', 'InterfaceTable', 'fmeaWorksheet'])
			table(name);
		expect(performance.now() - started).toBeLessThan(200);
	});
});

describe('views written by hand', () => {
	it('are drawn or tabled however the SysML says so', async () => {
		const { presentationOf } = await import('#lib/workbench/views.ts');
		const model = `package M {
    private import StandardViewDefinitions::*;
    private import ModelViews::*;
    part def Car { part engine : Engine; }
    part def Engine;
    part car : Car;
    view a : StandardViewDefinitions::GeneralView { expose M::*; }
    view def MyDiagram :> GeneralView;
    view b : MyDiagram { expose M::*; }
    view c { expose M::*; render asTreeDiagram; }
    view d { expose car; render asInterconnectionDiagram; }
    view def MyTable :> RequirementsTable;
    view e : MyTable { expose M::*; }
    view def PartList { @Reporting::TableRendering { rows = "kind:part"; columns = "element; type"; } }
    view f : PartList { expose M::*; }
}`;
		const files: SourceFile[] = [
			...host.viewLibraries().map((l) => ({ path: l.path, text: l.text })),
			{ path: 'm.sysml', text: model }
		];
		const shown = Object.fromEntries(
			host
				.listViews(files)
				.filter((v) => v.file === 'm.sysml' && v.isUsage)
				.map((v) => {
					const p = presentationOf(v);
					return [v.name, p.kind === 'diagram' ? p.view : p.kind];
				})
		);
		expect(shown).toEqual({
			a: 'general',
			b: 'general', // a view def of the project's that specializes a standard one
			c: 'general', // no view def, only `render asTreeDiagram`
			d: 'interconnection',
			e: 'table',
			f: 'table'
		});
		expect(host.diagram('general', files, 'M::b').nodes.map((n) => n.id)).toContain('car');
	});
});
