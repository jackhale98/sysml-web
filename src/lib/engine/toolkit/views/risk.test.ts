/**
 * What the tables and checks read from the risk libraries, in Node against
 * the real toolkit: the library's calcs as columns (the app's evaluation of
 * `ActionPriority` against the toolkit's own, for every rating), the
 * worksheets of each kind of FMEA, a risk matrix of every rating, values
 * a type's asserted constraint rejects, and a severity that disagrees with
 * the hazard's harms.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceFile } from '../../protocol';
import type { RenderedTable } from '../../types';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
});

const demo = demoFiles();
const libraries = demo.filter((f) => f.path.startsWith('libraries/'));
const col = (t: RenderedTable, name: string) => {
	const i = t.columns.indexOf(name);
	if (i < 0) throw new Error(`no column ${name} in ${t.columns.join(', ')}`);
	return t.rows.map((r) => r[i]!);
};

/** A project with the libraries and a model of a pump. */
function project(model: string): SourceFile[] {
	return [...libraries, { path: 'model/Pump.sysml', text: model }];
}

const PUMP = `package Pump {
    private import RiskAnalysis::*;
    private import HazardAnalysis::*;

    part def Motor;
    part pump {
        part motor : Motor;
        part seal;
    }
    action fill {
        action connectHose;
        action startPump;
    }
    use case operate;

    occurrence leak : Hazard { :>> description = "Hot water escapes"; }
    occurrence sprayed : HazardousSituation { :>> description = "Someone stands next to the pump"; }
    occurrence scald : Harm { :>> severity = SeverityScale::serious; }
    occurrence slip : Harm { :>> severity = SeverityScale::minor; }
    connection : Causation connect leak to sprayed;
    connection : Causation connect sprayed to scald;
    connection : Causation connect leak to slip;

    requirement <'RC-001'> 'Seal check' : RiskControl {
        doc /* The pump shall stop when the seal leaks. */
        :>> hierarchy = ControlHierarchy::protectiveMeasure;
        ref :>> hazard = leak;
    }
    satisfy 'Seal check' by pump::seal;

    @Fmea about pump::seal {
        failureMode = "Seal wears out";
        effect = "Water leaks";
        cause = "Old age";
        severity = 6; likelihood = 4; detection = 7;
        hazard = leak;
    }
    @Fmea about pump::motor {
        failureMode = "Motor overheats";
        severity = 14; likelihood = 2; detection = 2;
    }
    @Fmea about fill::connectHose {
        failureMode = "Hose not tight";
        category = RiskCategory::process;
        severity = 4; likelihood = 6; detection = 3;
        hazard = leak;
    }
    @Fmea about operate {
        failureMode = "Opens the lid while running";
        category = RiskCategory::'use';
        severity = 6; likelihood = 3; detection = 9;
    }

    view design : DesignFmeaWorksheet { expose Pump::*; }
    view process : ProcessFmeaWorksheet { expose Pump::*; }
    view usage : UseFmeaWorksheet { expose Pump::*; }
    view matrix : RiskMatrix { expose Pump::*; }
    view log : HazardLog;
}
`;

describe('the risk libraries', { timeout: 60_000 }, () => {
	it('check clean', () => {
		const analyses = host.analyzeProject(demo);
		const problems = analyses.flatMap((a) => [...a.diagnostics, ...a.model.syntax_errors]);
		expect(problems).toEqual([]);
		const pump = host.analyzeProject(project(PUMP));
		expect(pump.flatMap((a) => [...a.diagnostics, ...a.model.syntax_errors])).toEqual([]);
	});

	it('the action priority the tables work out is the toolkit’s, for every rating', () => {
		// One line per likelihood, one column per severity; one model per detection.
		const model = (d: number) =>
			project(`package T {
    private import RiskAnalysis::*;
${Array.from({ length: 10 }, (_, o) => `    part p${o + 1} { @Fmea { failureMode = "x"; severity = 1; likelihood = ${o + 1}; detection = ${d}; } }`).join('\n')}
    view def Grid {
        @Reporting::TableRendering {
            rows = "@Fmea";
            columns = "${Array.from({ length: 10 }, (_, s) => `s${s + 1} = ActionPriority(${s + 1}, likelihood, detection)`).join('; ')}";
        }
    }
}`);
		const { session } = host.session(model(1));
		const toolkit: string[] = [];
		for (let d = 1; d <= 10; d++)
			for (let o = 1; o <= 10; o++)
				for (let s = 1; s <= 10; s++) {
					const answer = JSON.parse(
						session!.query(`RiskAnalysis::ActionPriority(${s}, ${o}, ${d})`)
					) as { qualifiedName: string };
					toolkit.push(answer.qualifiedName.split('::').pop()!);
				}
		const app: string[] = [];
		for (let d = 1; d <= 10; d++) app.push(...host.renderView(model(d), 'Grid').rows.flat());
		expect(app).toEqual(toolkit);
		// The AIAG-VDA table's corners and edges.
		const at = (s: number, o: number, d: number) => app[((d - 1) * 10 + o - 1) * 10 + s - 1];
		expect(at(10, 10, 10)).toBe('high');
		expect(at(9, 4, 1)).toBe('medium');
		expect(at(9, 2, 4)).toBe('low');
		expect(at(7, 6, 2)).toBe('high');
		expect(at(5, 8, 5)).toBe('high');
		expect(at(3, 8, 5)).toBe('medium');
		expect(at(1, 10, 10)).toBe('low');
	});

	it('each kind of worksheet shows its own lines, with its own headings', () => {
		const files = project(PUMP);
		const design = host.renderView(files, 'design');
		// A line without a category is a design line (the metadata def's default).
		expect(design.columns.slice(0, 2)).toEqual(['part', 'failureMode']);
		expect(col(design, 'part')).toEqual(['pump::seal', 'pump::motor']);
		expect(col(design, 'rpn')).toEqual(['168', '']);
		expect(col(design, 'actionPriority')).toEqual(['medium', '']);
		const process = host.renderView(files, 'process');
		expect(process.columns[0]).toBe('processStep');
		expect(col(process, 'processStep')).toEqual(['fill::connectHose']);
		const usage = host.renderView(files, 'usage');
		expect(usage.columns.slice(0, 2)).toEqual(['task', 'useError']);
		expect(col(usage, 'useError')).toEqual(['Opens the lid while running']);
		expect(usage.editable?.[1]).toEqual({ field: 'metadata:Fmea.failureMode', kind: 'text' });
	});

	it('flags a rating its type rejects, from the library’s own constraint', () => {
		const files = project(PUMP);
		const design = host.renderView(files, 'design');
		const motor = design.rows.findIndex((r) => r[0] === 'pump::motor');
		const severity = design.columns.indexOf('severity');
		expect(design.rows[motor]![severity]).toBe('14');
		expect(design.rowInfo?.[motor]?.problems).toEqual({
			[severity]: 'Severity is 14, outside the scale of 1 to 10.'
		});
		// A calc whose argument isn't an FmeaRating has no result: RPN and priority stay empty.
		expect(design.rows[motor]!.slice(-2)).toEqual(['', '']);
		const violated = host.checks(files).checks.filter((c) => c.status === 'violated');
		expect(violated.map((c) => c.problem)).toContain(
			'Severity is 14, outside the scale of 1 to 10 (@Fmea about pump::motor).'
		);
		const check = violated.find((c) => c.by === 'pump::motor')!;
		expect(check).toMatchObject({ kind: 'assert', constraint: 'that >= 1 and that <= 10' });
		// At the value, where the editor and Problems take you.
		expect(files[files.length - 1]!.text.split('\n')[check.span.start_row - 1]).toContain(
			'severity = 14'
		);
	});

	it('flags a severity that is not the worst harm of the line’s hazard', () => {
		const files = project(PUMP);
		const process = host.renderView(files, 'process');
		// The leak leads to a scald (serious, 6) through a hazardous situation, and a slip (minor, 4).
		expect(process.rowInfo?.[0]?.problems).toEqual({
			2: 'Severity is 4, but its hazard leak can lead to scald, which is serious (6).'
		});
		const design = host.renderView(files, 'design');
		expect(design.rowInfo?.[0]?.problems).toBeUndefined();
		const problems = host
			.checks(files)
			.checks.filter((c) => c.status === 'violated')
			.map((c) => c.problem);
		expect(problems).toContain(
			'Severity is 4, but its hazard leak can lead to scald, which is serious (6) (@Fmea about fill::connectHose).'
		);
		// The demo's lines agree with their hazards.
		expect(host.checks(demo).checks.filter((c) => c.status === 'violated')).toEqual([]);
	});

	it('a risk matrix has every rating, and shows a rating outside the scale', () => {
		const matrix = host.renderView(project(PUMP), 'matrix');
		expect(matrix.counts).toEqual({ rows: 'severity', columns: 'likelihood' });
		expect(matrix.rows.map((r) => r[0])).toEqual([
			'14',
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
		expect(matrix.columns.length).toBe(11);
		const six = matrix.rows.find((r) => r[0] === '6')!;
		expect(six[3]).toBe('1');
		expect(six[4]).toBe('1');
	});

	it('the hazard log follows the causal chain to the harms and the controls', () => {
		const log = host.renderView(project(PUMP), 'log');
		expect(log.rows).toEqual([
			['leak', 'Hot water escapes', 'scald, slip', 'serious', 'RC-001 Seal check', 'pump.seal', '']
		]);
		expect(log.availableFields).toEqual(
			expect.arrayContaining(['situations', 'failureModes', 'severityValue'])
		);
	});

	it('a pivot over an enum has every literal, in the order declared', () => {
		const files = project(`package T {
    private import RiskAnalysis::*;
    part p {
        @Fmea { failureMode = "a"; category = RiskCategory::process; severity = 3; likelihood = 2; detection = 1; }
    }
    view def ByKind { @Reporting::TableRendering { rows = "@Fmea"; pivot = "category; severity"; } }
}`);
		const t = host.renderView(files, 'ByKind');
		expect(t.rows.map((r) => r[0])).toEqual(['design', 'process', 'use', 'software']);
		// Severity is a scale, the category is not: no grid of counts.
		expect(t.counts).toBeUndefined();
		expect(t.columns.length).toBe(11);
	});

	it('a column can invoke any calc of the model, with its own values and calcs', () => {
		const files = project(`package T {
    private import ScalarValues::*;
    calc def Twice { in x : Integer; return : Integer = x * 2; }
    calc def Score {
        in a : Integer;
        in b : Integer;
        attribute total : Integer = a + b;
        return : Integer = Twice(total) + 1;
    }
    metadata def M { attribute a : Integer; attribute b : Integer; attribute note : String; }
    part p { @M { a = 2; b = 3; note = "x"; } }
    part q { @M { a = 1; b = 1; note = "y"; } }
    view def V {
        @Reporting::TableRendering { rows = "@M"; columns = "note; score = Score(a, b)"; sortBy = "-b"; }
    }
}`);
		const t = host.renderView(files, 'V');
		// Sorted by a field the table doesn't show.
		expect(t.rows).toEqual([
			['x', '11'],
			['y', '5']
		]);
		expect(t.warnings).toEqual([]);
	});
});
