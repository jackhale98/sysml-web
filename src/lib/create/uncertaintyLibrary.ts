/**
 * The uncertainty library a project gets when it first gives a value a
 * distribution (`docs/uncertainty.md`), and the SysML that does it. The
 * text is the demo's own copy, so there is one source to change; like the
 * risk libraries it goes in the project's `libraries/` folder, where it can
 * be read and changed like any SysML, and other SysML v2 tools read it too.
 */
import type { ProjectFile, Workspace } from '#lib/project/workspace.svelte.ts';
import uncertainty from '/src/demo/drone/libraries/Uncertainty.sysml?raw';

export const UNCERTAINTY_LIBRARY: ProjectFile & { package: string } = {
	path: 'libraries/Uncertainty.sysml',
	package: 'Uncertainty',
	text: uncertainty
};

/** The library, when the project doesn't have its package yet (and its path is free). */
export function missingUncertaintyLibrary(workspace: Workspace): ProjectFile[] {
	const has = workspace.elements.some(
		(e) => e.kind === 'package' && e.name === UNCERTAINTY_LIBRARY.package && !e.isDefinition
	);
	if (has || workspace.text(UNCERTAINTY_LIBRARY.path) !== undefined) return [];
	return [{ path: UNCERTAINTY_LIBRARY.path, text: UNCERTAINTY_LIBRARY.text }];
}

/**
 * How a value varies, with its numbers as SysML writes them (`60 [g]`,
 * `0.8`): a tolerance band, a normal distribution, a uniform or a
 * triangular one. What is left out takes the library's default.
 */
export type DistributionSpec =
	| {
			kind: 'tolerance';
			plus: string;
			minus?: string;
			reading?: 'normal' | 'uniform' | 'triangular';
			sigmas?: string;
	  }
	| { kind: 'normal'; standardDeviation: string; mean?: string }
	| { kind: 'uniform'; min: string; max: string }
	| { kind: 'triangular'; min: string; max: string; mode?: string };

/**
 * The attribute that gives a value its distribution, to write inside the
 * value's body: `attribute tolerance : Uncertainty::Tolerance { :>> plus =
 * 60 [g]; }`. `spell` writes a library name as the file refers to it.
 */
export function distributionText(
	spec: DistributionSpec,
	spell: (name: string) => string = (name) => `Uncertainty::${name}`
): string {
	const fields: [string, string | undefined][] =
		spec.kind === 'tolerance'
			? [
					['plus', spec.plus],
					['minus', spec.minus],
					['reading', spec.reading && `${spell('ToleranceReading')}::${spec.reading}`],
					['sigmas', spec.sigmas]
				]
			: spec.kind === 'normal'
				? [
						['mean', spec.mean],
						['standardDeviation', spec.standardDeviation]
					]
				: spec.kind === 'uniform'
					? [
							['min', spec.min],
							['max', spec.max]
						]
					: [
							['min', spec.min],
							['mode', spec.mode],
							['max', spec.max]
						];
	const type = {
		tolerance: 'Tolerance',
		normal: 'Normal',
		uniform: 'Uniform',
		triangular: 'Triangular'
	}[spec.kind];
	const name = spec.kind === 'tolerance' ? 'tolerance' : 'uncertainty';
	const body = fields
		.filter(([, v]) => v !== undefined && v.trim() !== '')
		.map(([f, v]) => `:>> ${f} = ${v!.trim()};`)
		.join(' ');
	return `attribute ${name} : ${spell(type)} { ${body} }`;
}
