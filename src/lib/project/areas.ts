import {
	Boxes,
	Cable,
	Code,
	FlaskConical,
	LayoutDashboard,
	ListChecks,
	Network,
	ShieldAlert,
	Workflow
} from '@lucide/svelte';
import type { Component } from 'svelte';

/** A top-level area of a project (PLAN.md §7.2). */
export interface Area {
	/** URL segment under /p/[project]; '' is the overview. */
	slug: string;
	label: string;
	icon: Component;
	/** Shown in the secondary group at the bottom of the navigation. */
	secondary?: boolean;
	/** For areas not built yet: what they will offer, and the plan phase. */
	planned?: { phase: number; summary: string; points: string[] };
}

export const AREAS: Area[] = [
	{ slug: '', label: 'Overview', icon: LayoutDashboard },
	{ slug: 'requirements', label: 'Requirements', icon: ListChecks },
	{
		slug: 'system',
		label: 'System',
		icon: Boxes,
		planned: {
			phase: 3,
			summary:
				'The parts your system is made of — as a catalog of component types and the assembled structure.',
			points: [
				'Catalog of component types with their attributes and interfaces',
				'Structure tree and bill of materials with quantities',
				'Allocate requirements to components by picking or dragging',
				'Component pages showing everything linked to a part'
			]
		}
	},
	{
		slug: 'interfaces',
		label: 'Interfaces',
		icon: Cable,
		planned: {
			phase: 3,
			summary: 'How components connect: ports, interfaces and the flows between them.',
			points: [
				'Interface table with ports, directions and item flows',
				'N² connection matrix',
				'Interface control document export'
			]
		}
	},
	{
		slug: 'behaviour',
		label: 'Behaviour',
		icon: Workflow,
		planned: {
			phase: 6,
			summary: 'What the system does: functions, sequences and states.',
			points: [
				'Function list and function flow diagrams',
				'State machines with transitions',
				'Simulation of state machines and action flows'
			]
		}
	},
	{
		slug: 'verification',
		label: 'Verification',
		icon: FlaskConical,
		planned: {
			phase: 5,
			summary: 'How you prove the requirements are met.',
			points: [
				'Test cases with objectives, methods and verified requirements',
				'Verification matrix and coverage',
				'Plain-language gaps: “SYS-007 has no test yet”'
			]
		}
	},
	{
		slug: 'risk',
		label: 'Risk',
		icon: ShieldAlert,
		planned: {
			phase: 5,
			summary: 'Failure modes, hazards and the mitigations that address them.',
			points: [
				'Design and process FMEA worksheets with computed RPN',
				'Risk matrix and hazard log',
				'Mitigations traced to requirements and verification'
			]
		}
	},
	{
		slug: 'diagrams',
		label: 'Diagrams',
		icon: Network,
		secondary: true,
		planned: {
			phase: 3,
			summary: 'The SysML v2 standard views, saved in the model so other tools see them.',
			points: [
				'General and Interconnection views with automatic layout',
				'Create and connect elements visually',
				'Action Flow, State Transition and Sequence views later'
			]
		}
	},
	{ slug: 'model', label: 'Model', icon: Code, secondary: true }
];

export function areaFor(slug: string): Area | undefined {
	return AREAS.find((a) => a.slug === slug);
}
