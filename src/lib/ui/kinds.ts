/**
 * Element families: how the app colours and pictures SysML element kinds,
 * consistently across explorer, diagrams, inspector and tables.
 */
import {
	Activity,
	Box,
	Boxes,
	Cable,
	Calculator,
	CircleDot,
	Eye,
	FileText,
	FlaskConical,
	GitBranch,
	ListChecks,
	Package,
	Puzzle,
	Shapes,
	SlidersHorizontal,
	Target,
	Users,
	Workflow
} from '@lucide/svelte';
import type { Component } from 'svelte';

export type Family =
	'structure' | 'interface' | 'behavior' | 'requirement' | 'analysis' | 'package' | 'view';

const FAMILY: Record<string, Family> = {
	part: 'structure',
	item: 'structure',
	occurrence: 'structure',
	attribute: 'structure',
	enum: 'structure',
	metadata: 'structure',
	individual: 'structure',
	port: 'interface',
	interface: 'interface',
	connection: 'interface',
	flow: 'interface',
	binding: 'interface',
	allocation: 'interface',
	action: 'behavior',
	state: 'behavior',
	transition: 'behavior',
	succession: 'behavior',
	perform: 'behavior',
	exhibit: 'behavior',
	use_case: 'behavior',
	'use case': 'behavior',
	requirement: 'requirement',
	concern: 'requirement',
	verification: 'requirement',
	satisfy: 'requirement',
	verify: 'requirement',
	calc: 'analysis',
	constraint: 'analysis',
	analysis: 'analysis',
	package: 'package',
	namespace: 'package',
	view: 'view',
	viewpoint: 'view',
	rendering: 'view'
};

export function familyOf(kind: string): Family {
	return FAMILY[kind] ?? (kind.includes('state') ? 'behavior' : 'structure');
}

/** CSS custom property holding the family colour. */
export function familyColor(kind: string): string {
	return `var(--kind-${familyOf(kind)})`;
}

const ICON: Record<string, Component> = {
	part: Boxes,
	item: Shapes,
	occurrence: Box,
	attribute: SlidersHorizontal,
	enum: SlidersHorizontal,
	metadata: FileText,
	port: CircleDot,
	interface: Cable,
	connection: Cable,
	flow: GitBranch,
	allocation: GitBranch,
	action: Workflow,
	state: Activity,
	transition: Activity,
	use_case: Users,
	'use case': Users,
	requirement: ListChecks,
	concern: Target,
	verification: FlaskConical,
	calc: Calculator,
	constraint: Calculator,
	analysis: Calculator,
	package: Package,
	view: Eye,
	viewpoint: Eye
};

export function iconOf(kind: string): Component {
	return ICON[kind] ?? Puzzle;
}

/** "part def", "port", "use case def", … as SysML writes it. */
export function keywordOf(kind: string, isDefinition: boolean): string {
	const word = kind.replace(/_/g, ' ');
	return isDefinition && kind !== 'package' ? `${word} def` : word;
}
