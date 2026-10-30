/**
 * Parts whose state machines run together (`MachineSystem[]`, what
 * `sim/system.ts` runs), read from the toolkit's model, in the worker.
 *
 * A context is a part, or a part definition, with at least two parts (at
 * any depth) that exhibit a state machine: `exhibit state s : M;` with `M`
 * a machine, or `exhibit state s { … }` with states of its own, written in
 * the part, its definition or the definition's supertypes. For the context
 * it gives:
 * - those parts, by their path from the context (`drone.flightController`),
 *   each with its machine and its ports (its own and its definitions');
 * - every part, with a machine or not, so a signal that reaches one without
 *   a machine can say so;
 * - the connections and interfaces between ports, and the bindings that
 *   make two names one port (`bind commandLink = radio.airLink`), written in
 *   the context or in any part inside it, with their ends as paths from the
 *   context (`station.commandLink`).
 *
 * Reads the extracted records only (types, specializations, connector ends
 * as written), no toolkit call.
 */
import type { MachineSystem, StateMachine } from '../types';
import { connectionEnds, isReference, type ElementRecord, type ExtractedModel } from './model';

/** Parts nested deeper than this are not looked into. */
const DEPTH = 6;

const isPart = (r: ElementRecord) =>
	r.metaclass === 'PartUsage' && !!r.name && r.membership === 'FeatureMembership';
const nameOf = (r: ElementRecord) => r.written ?? r.name ?? '';
const squash = (s: string) => s.replace(/\s+/g, '').replace(/^self\./, '');

export function extractSystems(
	extracted: ExtractedModel,
	machines: StateMachine[]
): MachineSystem[] {
	const { elements, byId } = extracted;
	const children = new Map<string, ElementRecord[]>();
	for (const record of elements) {
		if (!record.ownerId) continue;
		const list = children.get(record.ownerId) ?? [];
		list.push(record);
		children.set(record.ownerId, list);
	}
	const byName = new Map(machines.map((m) => [m.qualifiedName ?? m.name, m]));

	/** The members of a part: its own, then those of its types and what it specializes (not redefined). */
	const membersCache = new Map<string, ElementRecord[]>();
	const membersOf = (record: ElementRecord, seen: Set<string> = new Set()): ElementRecord[] => {
		const cached = membersCache.get(record.id);
		if (cached) return cached;
		if (seen.has(record.id)) return [];
		seen.add(record.id);
		const out = [...(children.get(record.id) ?? [])];
		const named = new Set(out.map((m) => m.name).filter(Boolean));
		for (const id of [...record.typeIds, ...record.generalIds]) {
			const general = byId.get(id);
			if (!general) continue;
			for (const m of membersOf(general, seen)) {
				if (m.name && named.has(m.name)) continue;
				if (m.name) named.add(m.name);
				out.push(m);
			}
		}
		membersCache.set(record.id, out);
		return out;
	};

	/** The machine an `exhibit state` runs: its own states, or the state definition it is typed by. */
	const machineOf = (exhibit: ElementRecord): StateMachine | undefined => {
		const own = exhibit.qualifiedName ? byName.get(exhibit.qualifiedName) : undefined;
		if (own) return own;
		for (const id of exhibit.typeIds) {
			const type = byId.get(id);
			const found = type?.qualifiedName ? byName.get(type.qualifiedName) : undefined;
			if (found) return found;
		}
		return undefined;
	};

	const systems: MachineSystem[] = [];
	const contexts = elements.filter(
		(r) =>
			(r.metaclass === 'PartUsage' || r.metaclass === 'PartDefinition') &&
			!!r.name &&
			!isReference(r)
	);
	for (const context of contexts) {
		const parts: MachineSystem['parts'] = [];
		const allParts: string[] = [];
		const links: MachineSystem['links'] = [];
		const ports = new Map<string, string[]>();
		const warnings: string[] = [];
		const walk = (record: ElementRecord, path: string, depth: number, line: Set<string>) => {
			const at = (name: string) => (path ? `${path}.${name}` : name);
			const members = membersOf(record);
			const own: string[] = [];
			const exhibits = members.filter((m) => m.metaclass === 'ExhibitStateUsage');
			for (const m of members) {
				if (m.metaclass === 'PortUsage' && m.name) own.push(nameOf(m));
				else if (/^(Interface|Connection)Usage$/.test(m.metaclass)) {
					const ends = connectionEnds(m.header);
					if (ends) {
						links.push({
							kind: 'connection',
							ends: [at(squash(ends[0])), at(squash(ends[1]))],
							...(m.name ? { name: nameOf(m) } : {})
						});
					}
				} else if (/^BindingConnector/.test(m.metaclass)) {
					const bind = /\bbind\s+([^=]+?)\s*=\s*(.+)$/.exec(m.header);
					if (bind)
						links.push({ kind: 'binding', ends: [at(squash(bind[1]!)), at(squash(bind[2]!))] });
				}
			}
			ports.set(path, own);
			if (path) {
				const machine = exhibits.map(machineOf).find((x) => !!x);
				if (machine) {
					parts.push({ path, machine, ports: own });
					if (exhibits.length > 1)
						warnings.push(
							`\`${path}\` exhibits ${exhibits.length} state machines; only \`${machine.name}\` runs`
						);
				}
			}
			if (depth >= DEPTH) return;
			for (const m of members) {
				if (!isPart(m) || isReference(m) || line.has(m.id)) continue;
				const sub = at(nameOf(m));
				allParts.push(sub);
				walk(m, sub, depth + 1, new Set([...line, m.id]));
			}
		};
		walk(context, '', 0, new Set([context.id]));
		if (parts.length < 2) continue;
		systems.push({
			name: nameOf(context),
			qualifiedName: context.qualifiedName ?? nameOf(context),
			file: context.path,
			line: context.span.start_row,
			...(context.docs.length ? { doc: context.docs.join('\n\n') } : {}),
			parts,
			allParts,
			ports: [...(ports.get('') ?? [])],
			links,
			...(warnings.length ? { warnings } : {})
		});
	}
	return systems;
}
