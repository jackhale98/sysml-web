/**
 * A run of the simulator as a file: the Timeline as CSV (one row per step),
 * or the whole run as JSON, with the machine it ran (qualified name, file
 * and line) and, for a project kept in a repository, the commit its files
 * are based on, so a run can be filed as evidence and traced back to the
 * model it came from.
 */
import type { SimStep, StateMachine, StateSession } from '#lib/engine/types.ts';
import { writeDelimited } from '#lib/dataio/csv.ts';

/** Where the model came from. */
export interface TraceSource {
	project?: string;
	/** `owner/repo` on the host. */
	repository?: string;
	branch?: string;
	/** The commit the project's files are based on. */
	commit?: string;
	/** Files changed in this browser since that commit (0: the model is the commit's). */
	changedFiles?: number;
}

const HEADER = [
	'Step',
	'Time (s)',
	'From',
	'To',
	'Transition',
	'Trigger',
	'Why',
	'Guard',
	'Values read',
	'Stopped',
	'Exit',
	'Effect',
	'Entry',
	'Started',
	'Gave way',
	'Notes'
];

const plain = (text: string | null | undefined) => (text ?? '').replace(/`/g, '');

function values(reads: Record<string, unknown> | undefined): string {
	return Object.entries(reads ?? {})
		.map(([name, value]) => `${name} = ${typeof value === 'string' ? `"${value}"` : String(value)}`)
		.join('; ');
}

/** The Timeline as rows: a header, then one row per step. */
export function traceRows(machine: StateMachine, trace: SimStep[]): string[][] {
	const guardOf = (s: SimStep) => {
		if (s.guard_result === null) return '';
		const written = s.transition_name
			? machine.transitions.find((t) => t.name === s.transition_name)?.guard
			: machine.transitions.find(
					(t) => t.from === s.from_state && t.to === s.to_state && (t.trigger ?? null) === s.trigger
				)?.guard;
		return `${written ? `${written}: ` : ''}${s.guard_result ? 'true' : 'false'}`;
	};
	return [
		HEADER,
		...trace.map((s) => [
			String(s.step),
			String(s.time ?? 0),
			s.step === 0 ? 'start' : s.from_state,
			s.to_state,
			s.transition_name ?? '',
			s.trigger ?? (s.step > 0 ? 'completion' : ''),
			plain(s.cause),
			guardOf(s),
			values(s.reads),
			s.do_stopped ?? '',
			s.exit_action ?? '',
			s.effect ?? '',
			s.entry_action ?? '',
			s.do_action ?? '',
			(s.preempted ?? []).join('; '),
			(s.notes ?? []).map(plain).join('; ')
		])
	];
}

export function traceCsv(machine: StateMachine, trace: SimStep[]): string {
	return writeDelimited(traceRows(machine, trace));
}

/** The run as JSON: the machine, where it came from, the final state and every step. */
export function traceJson(
	machine: StateMachine,
	session: StateSession,
	source: TraceSource,
	exportedAt: Date
): string {
	return `${JSON.stringify(
		{
			machine: {
				name: machine.name,
				qualifiedName: machine.qualifiedName ?? machine.name,
				file: machine.file,
				line: machine.line
			},
			source,
			exportedAt: exportedAt.toISOString(),
			status: session.status,
			time: session.time ?? 0,
			current: session.current,
			variables: session.variables,
			trace: session.trace
		},
		null,
		2
	)}\n`;
}

/** A file name for a machine's run: `FlightModes run.csv`. */
export function traceFileName(machine: StateMachine, extension: 'csv' | 'json'): string {
	const base = machine.name.replace(/[\\/:*?"<>|'\s]+/g, ' ').trim() || 'machine';
	return `${base} run.${extension}`;
}
