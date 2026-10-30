/**
 * The risk libraries a project gets when it first makes an FMEA or a
 * hazard: `RiskAnalysis` (FMEA lines, ratings, worksheets),
 * `HazardAnalysis` (hazards, harms, controls, the hazard log), and with
 * them `Reliability` (failure rates, the reliability budget) and
 * `FaultTreeAnalysis` (fault trees of the hazards). The text is
 * the demo's own copy, so there is one source to change; like the view
 * libraries they go in the project's `libraries/` folder, where they can
 * be read and changed like any SysML.
 */
import type { ProjectFile, Workspace } from '#lib/project/workspace.svelte.ts';
import hazardAnalysis from '/src/demo/drone/libraries/HazardAnalysis.sysml?raw';
import faultTreeAnalysis from '/src/demo/drone/libraries/FaultTreeAnalysis.sysml?raw';
import reliability from '/src/demo/drone/libraries/Reliability.sysml?raw';
import riskAnalysis from '/src/demo/drone/libraries/RiskAnalysis.sysml?raw';

export const RISK_LIBRARIES: readonly (ProjectFile & { package: string })[] = [
	{ path: 'libraries/RiskAnalysis.sysml', package: 'RiskAnalysis', text: riskAnalysis },
	{ path: 'libraries/HazardAnalysis.sysml', package: 'HazardAnalysis', text: hazardAnalysis },
	{ path: 'libraries/Reliability.sysml', package: 'Reliability', text: reliability },
	{
		path: 'libraries/FaultTreeAnalysis.sysml',
		package: 'FaultTreeAnalysis',
		text: faultTreeAnalysis
	}
];

/** The risk libraries whose package the project doesn't have yet (and whose path is free). */
export function missingRiskLibraries(workspace: Workspace): ProjectFile[] {
	const has = (name: string) =>
		workspace.elements.some((e) => e.kind === 'package' && e.name === name && !e.isDefinition);
	return RISK_LIBRARIES.filter(
		(lib) => !has(lib.package) && workspace.text(lib.path) === undefined
	).map(({ path, text }) => ({ path, text }));
}
