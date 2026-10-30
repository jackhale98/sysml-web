/**
 * Actions that can be run as flows (`ActionFlow[]`, what `sim/flow-run.ts`
 * runs), read from the toolkit's model, in the worker.
 *
 * Every named action definition and usage is listed (a `perform` or an
 * action's type may name any of them), with the statements of its body as
 * written, comments removed; use cases count as actions (a use case is a
 * kind of action). The ones declared in a package with steps to run are
 * `runnable`: the app offers to run them.
 */
import { allSteps, parseAction } from '../../sim/actions';
import { bodyText, findAction } from '../../sim/flow-run';
import type { ActionFlow, StateMachine } from '../types';
import { clean, writtenType } from './machines';
import type { ElementRecord, ExtractedModel, UnitInfo } from './model';

const KEYWORDS: Record<string, string> = {
	ActionDefinition: 'action def',
	ActionUsage: 'action',
	PerformActionUsage: 'perform action',
	UseCaseDefinition: 'use case def',
	UseCaseUsage: 'use case'
};

const PACKAGES = new Set(['Package', 'LibraryPackage']);

/** Steps that make an action worth running (not just its parameters). */
const RUNS = new Set(['feature', 'declaration']);

export function extractFlows(
	extracted: ExtractedModel,
	units: Map<string, UnitInfo>
): ActionFlow[] {
	const { elements, byId } = extracted;
	const children = new Map<string, ElementRecord[]>();
	const definitions = new Map<string, ElementRecord[]>();
	for (const record of elements) {
		if (record.ownerId) {
			const list = children.get(record.ownerId) ?? [];
			list.push(record);
			children.set(record.ownerId, list);
		}
		if (record.isDefinition && record.name) {
			const list = definitions.get(record.name) ?? [];
			list.push(record);
			definitions.set(record.name, list);
		}
	}
	const text = (record: ElementRecord): string => {
		const unit = units.get(record.path);
		const { from, to } = record.span;
		return unit && from !== undefined && to !== undefined ? unit.original.text.slice(from, to) : '';
	};
	const signal = (name: string) => {
		const simple = name
			.split('::')
			.pop()!
			.replace(/^'(.*)'$/, '$1');
		const found = definitions.get(simple) ?? [];
		const def = name.includes('::')
			? found.find((d) => d.qualifiedName?.endsWith(name.replace(/\s+/g, '')))
			: found[0];
		if (!def) return [];
		return (children.get(def.id) ?? [])
			.filter((a) => a.metaclass === 'AttributeUsage' && a.name)
			.map((a) => {
				const type = a.type ?? writtenType(a.header);
				return {
					name: a.written ?? a.name!,
					...(type ? { type } : {}),
					...(a.value !== null ? { value: a.value } : {})
				};
			});
	};

	const flows: ActionFlow[] = [];
	for (const record of elements) {
		const keyword = KEYWORDS[record.metaclass];
		if (!keyword || !record.name) continue;
		const body = bodyOf(text(record));
		const steps = parseAction(body);
		const owner = record.ownerId ? byId.get(record.ownerId) : undefined;
		const type = record.typeIds.map((id) => byId.get(id)?.qualifiedName).find(Boolean);
		const signals: NonNullable<ActionFlow['signals']> = {};
		for (const s of allSteps(steps)) {
			const name = s.kind === 'send' ? s.signal : s.kind === 'accept' ? s.trigger : null;
			if (!name || /^(when|after|at)\b/.test(name) || signals[name]) continue;
			const attributes = signal(name);
			if (attributes.length) signals[name] = attributes;
		}
		flows.push({
			name: record.written ?? record.name,
			...(record.qualifiedName?.includes('::') ? { qualifiedName: record.qualifiedName } : {}),
			file: record.path,
			line: record.span.start_row,
			...(record.docs.length ? { doc: record.docs.join('\n\n') } : {}),
			keyword,
			body,
			...(type ? { type } : {}),
			runnable: (!owner || PACKAGES.has(owner.metaclass)) && steps.some((s) => !RUNS.has(s.kind)),
			...(Object.keys(signals).length ? { signals } : {})
		});
	}
	return flows;
}

/** The statements inside a declaration's `{ … }`, with its docs and comments removed. */
export function bodyOf(declaration: string): string {
	// `doc /* … */` and `comment … /* … */` go whole, so their keywords do not join the next statement.
	const text = clean(declaration.replace(/\b(?:doc|comment)\b[^;{}/]*\/\*[\s\S]*?\*\//g, ' '));
	let depth = 0;
	let open = -1;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"' || c === "'") {
			const end = text.indexOf(c, i + 1);
			i = end < 0 ? text.length : end;
		} else if (c === '(' || c === '[') depth++;
		else if (c === ')' || c === ']') depth--;
		else if (c === '{' && depth === 0) {
			open = i;
			break;
		} else if (c === ';' && depth === 0) return '';
	}
	if (open < 0) return '';
	const close = text.lastIndexOf('}');
	return close > open ? text.slice(open + 1, close).trim() : '';
}

/**
 * Give each machine the actions its actions `perform` (by the name they
 * are performed by, with their steps), so the emulator runs them; the
 * notes that said they are not run go.
 */
export function withPerformed(machines: StateMachine[], read: () => ActionFlow[]): StateMachine[] {
	let flows: ActionFlow[] | null = null;
	return machines.map((machine) => {
		const texts = [
			...machine.states.flatMap((s) => [s.entry, s.do, s.exit]),
			...machine.transitions.map((t) => t.effect)
		];
		// The project's actions are read only for a machine that performs one.
		if (!texts.some((t) => t && /\bperform\b|\baction\s+[\w$']+\s*:/.test(t))) return machine;
		flows ??= read();
		const actions: Record<string, string> = {};
		const pending = [...texts];
		while (pending.length) {
			const text = pending.shift();
			if (!text) continue;
			for (const step of allSteps(parseAction(text))) {
				const target =
					step.kind === 'perform' ? step.target : step.kind === 'action' ? step.type : null;
				if (!target || target in actions) continue;
				const found = findAction(flows, target);
				if (!found) continue;
				actions[target] = bodyText(flows, found);
				pending.push(actions[target]);
			}
		}
		if (!Object.keys(actions).length) return machine;
		const performed = Object.keys(actions);
		const warnings = machine.warnings?.filter(
			(w) => !performed.some((t) => w.includes('`perform') && w.includes(t))
		);
		return {
			...machine,
			actions,
			...(warnings?.length ? { warnings } : { warnings: undefined })
		};
	});
}
