/**
 * The blank starting point: a model with a first requirement and the system
 * part, saved table and diagram views over it, the view libraries those use,
 * and a short tour of what to do next.
 */
import { fileStem, packageName, relatedPackage } from '../sources.ts';
import type { ProjectFile, ProjectInfo } from '../workspace.svelte.ts';

/** Text for inside a `doc /* … *\/` comment. */
export const docText = (text: string) => text.replace(/\*\//g, '* /');

export function starterProject(
	name: string,
	description: string,
	viewLibraries: ProjectFile[]
): { info: ProjectInfo; files: ProjectFile[] } {
	const pkg = packageName(name);
	const views = relatedPackage(pkg, 'Views');
	const about = description.trim() || `The ${name} system model.`;
	const modelPath = `model/${fileStem(pkg)}.sysml`;
	const model = `package ${pkg} {
    doc /* ${docText(about)} */

    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;

    // --- Requirements: what the system must do -------------------------
    // Each has an ID in <'...'>, a title and a "shall" statement. Add more
    // here or from the Requirements table (or import a spreadsheet).

    requirement def SystemRequirement {
        doc /* A requirement on the system. */
        subject system : System;
    }

    requirement <'REQ-001'> 'First requirement' : SystemRequirement {
        doc /* The system shall ... */
    }

    // --- Structure: what the system is made of -------------------------
    // A part def is a kind of thing (like a datasheet); a part is one used
    // in a design. Draw them in the diagram or type them here.

    part def System {
        doc /* The system being designed. */
        attribute mass :> ISQ::mass;
    }

    part system : System;

    // --- Traceability: which part of the design meets which requirement --
    satisfy 'First requirement' by system;
}
`;
	const viewsText = `package ${views} {
    doc /* Saved views: tables and diagrams that are part of the model. */

    private import StandardViewDefinitions::*;
    private import ModelViews::*;

    view requirements : RequirementsTable {
        doc /* Every requirement with its status and trace links. */
        expose ${pkg}::*;
    }

    view gaps : RequirementGaps {
        doc /* Requirements that nothing satisfies or verifies yet. */
        expose ${pkg}::*;
    }

    view structure : GeneralView {
        doc /* The system and what it is made of. */
        expose ${pkg}::*;
    }
}
`;
	const tour = `# Start here: ${name}

${about}

This project is a small SysML v2 model, kept as text. The diagrams and tables
are views of that text: change one and the others follow.

## What is in it

- \`${modelPath}\`: the model. It has one requirement, \`'First requirement'\`,
  the system it is about, \`System\`, and a line saying the system meets it.
- \`views/Views.sysml\`: three saved views. \`requirements\` is a table of
  every requirement, \`gaps\` lists the ones nothing meets or tests yet, and
  \`structure\` is a diagram of the model.
- \`libraries/\`: the table and report definitions the views use. Leave them be.

## Next steps

1. **Write a requirement.** Open \`requirements\` and add a row, or
   [import a spreadsheet](#do:import-requirements) of the requirements you have.
2. **Add a part.** Open \`structure\` and choose **Add**, or type
   \`part battery : Battery;\` inside \`System\`.
3. **Link them.** Select a requirement and say which part meets it; in text,
   \`satisfy 'First requirement' by system;\`.
4. **Make a view.** [New view](#do:new-view) makes a table, diagram, budget
   or report and saves it in the model.
5. **Check a number.** On a value in the details panel, **Add up** sums it over
   a part's parts, and **Set a limit** writes a requirement that checks it.
6. **Keep a copy.** [Save it to GitHub](#do:save-github) to share it, or
   download a \`.kpar\` from the project menu.

Stuck? [Open the help](#do:help) for plain-words explanations of every idea here.
`;
	return {
		info: { name, description: about, version: '0.1.0' },
		files: [
			{ path: modelPath, text: model },
			{ path: 'views/Views.sysml', text: viewsText },
			...viewLibraries,
			{ path: 'TOUR.md', text: tour }
		]
	};
}
