/**
 * Idiomatic SysML snippets for the "Add" actions in diagrams, the explorer
 * and the inspector. The engine places and indents them; these only decide
 * what to write.
 */

export type AddKind =
	| 'package'
	| 'part def'
	| 'part'
	| 'port def'
	| 'port'
	| 'item def'
	| 'attribute'
	| 'requirement'
	| 'action def'
	| 'action'
	| 'state def';

export interface AddOption {
	kind: AddKind;
	label: string;
	/** Whether the element is usually typed (`name : Type`). */
	typed: boolean;
	placeholder: string;
}

export const ADD_OPTIONS: AddOption[] = [
	{ kind: 'part def', label: 'Part definition', typed: false, placeholder: 'Battery' },
	{ kind: 'part', label: 'Part', typed: true, placeholder: 'battery' },
	{ kind: 'port def', label: 'Port definition', typed: false, placeholder: 'PowerPort' },
	{ kind: 'port', label: 'Port', typed: true, placeholder: 'powerIn' },
	{ kind: 'attribute', label: 'Attribute', typed: true, placeholder: 'mass' },
	{ kind: 'item def', label: 'Item definition', typed: false, placeholder: 'Parcel' },
	{ kind: 'requirement', label: 'Requirement', typed: false, placeholder: 'maxMass' },
	{ kind: 'action def', label: 'Action definition', typed: false, placeholder: 'DeliverParcel' },
	{ kind: 'action', label: 'Action', typed: true, placeholder: 'takeOff' },
	{ kind: 'state def', label: 'State definition', typed: false, placeholder: 'FlightModes' },
	{ kind: 'package', label: 'Package', typed: false, placeholder: 'Structure' }
];

/** Kinds that can own the members above (they have a `{ … }` body). */
export function canOwnMembers(kind: string, isDefinition: boolean): boolean {
	return kind === 'package' || (isDefinition && kind !== 'enum' && kind !== 'attribute');
}

/** A KerML name: as-is when basic, otherwise quoted with escapes. */
export function formatName(raw: string): string {
	const name = raw.trim();
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
	return `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Text for a new element; `type` is used only for typed kinds. */
export function elementText(kind: AddKind, name: string, type = ''): string {
	const n = formatName(name);
	const typing = type.trim() ? ` : ${type.trim()}` : '';
	switch (kind) {
		case 'package':
		case 'part def':
		case 'port def':
		case 'item def':
		case 'action def':
		case 'state def':
			return `${kind} ${n} {\n}`;
		case 'part':
		case 'port':
		case 'attribute':
		case 'action':
			return `${kind} ${n}${typing};`;
		case 'requirement':
			return `requirement ${n} {\n    doc /* Describe what shall be true. */\n}`;
	}
}
