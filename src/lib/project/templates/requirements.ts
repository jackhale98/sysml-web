/**
 * Requirements first: for people moving a requirements spreadsheet. A
 * requirement kind with the columns such a sheet has (priority, verification
 * method, status and owner), a few examples, a product to trace them to, and
 * the requirements table, gaps, trace matrix and specification over them.
 */
import { packageName, relatedPackage } from '../sources.ts';
import type { ProjectFile, ProjectInfo } from '../workspace.svelte.ts';
import { docText } from './blank.ts';

export function requirementsProject(
	name: string,
	description: string,
	viewLibraries: ProjectFile[]
): { info: ProjectInfo; files: ProjectFile[] } {
	const pkg = packageName(name);
	const reqs = relatedPackage(pkg, 'Requirements');
	const views = relatedPackage(pkg, 'Views');
	const about = description.trim() || `The requirements of ${name}.`;

	const requirements = `package ${reqs} {
    doc /* ${docText(about)} */

    private import ModelingMetadata::*;

    // --- The columns of a requirements spreadsheet ----------------------
    // ID, title and statement are part of every requirement. Priority and
    // verification method are attributes of ProductRequirement below;
    // status and owner go in @StatusInfo, from the standard library.

    enum def Priority {
        doc /* How much the requirement matters. */
        enum high;
        enum medium;
        enum low;
    }

    enum def VerificationMethod {
        doc /* How we will show that the requirement is met. */
        enum test;
        enum 'analysis';
        enum inspection;
        enum demonstration;
    }

    requirement def ProductRequirement {
        doc /* A requirement with the usual spreadsheet columns. Status (open, tbd,
             * tbr, tbc, done or closed) and owner are written as @StatusInfo. */
        attribute priority : Priority[0..1];
        attribute verificationMethod : VerificationMethod[0..*];
    }

    // --- The requirements: replace these with yours ---------------------
    // Import a spreadsheet to add many at once, or add rows in the table.

    requirement <'REQ-001'> 'Operating temperature' : ProductRequirement {
        doc /* The product shall work at ambient temperatures from -10 °C to +45 °C. */
        :>> priority = Priority::high;
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::open; owner = "Systems"; }
    }

    requirement <'REQ-002'> 'Battery life' : ProductRequirement {
        doc /* The product shall run for at least 8 hours on a full charge. */
        :>> priority = Priority::high;
        :>> verificationMethod = (VerificationMethod::'analysis', VerificationMethod::test);
        @StatusInfo { status = StatusKind::tbd; owner = "Electronics"; }
    }

    requirement <'REQ-003'> 'Drop resistance' : ProductRequirement {
        doc /* The product shall still work after a drop of 1 m onto concrete. */
        :>> priority = Priority::medium;
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::open; owner = "Mechanical"; }
    }

    requirement <'REQ-004'> 'Labelling' : ProductRequirement {
        doc /* The product shall carry its model name and serial number where they can be read. */
        :>> priority = Priority::low;
        :>> verificationMethod = VerificationMethod::inspection;
        @StatusInfo { status = StatusKind::done; owner = "Quality"; }
    }
}
`;

	const design = `package ${pkg} {
    doc /* The product the requirements are about, so each one can be traced to
         * what meets it and to the test that checks it. Add parts as the design grows. */

    private import VerificationCases::*;
    private import ${reqs}::*;

    part def Product {
        doc /* The product being specified. */
    }

    part product : Product;

    // --- Traceability: what meets each requirement ----------------------
    // The Gaps table lists the requirements without one yet.
    satisfy 'Operating temperature' by product;
    satisfy 'Labelling' by product;

    // --- Verification: the test that checks a requirement ---------------
    verification <'VC-001'> climateTest {
        doc /* Run the product for an hour at -10 °C and at +45 °C in a climate chamber. */
        subject unit :> product;
        objective { verify 'Operating temperature'; }
    }

    verification <'VC-002'> labelInspection {
        doc /* Check that the label is present and readable on a production unit. */
        subject unit :> product;
        objective { verify 'Labelling'; }
    }
}
`;

	const viewsText = `package ${views} {
    doc /* Saved views: tables, matrices and a report that are part of the model. */

    private import StandardViewDefinitions::*;
    private import ModelViews::*;
    private import Reporting::*;

    view requirements : RequirementsTable {
        doc /* Every requirement, with the columns of a requirements spreadsheet. */
        @TableRendering { columns = "id; title; text; priority; verificationMethod; status; owner; satisfiedBy; verifiedBy"; }
        expose ${reqs}::*;
    }

    view gaps : RequirementGaps {
        doc /* Requirements that nothing meets or tests yet. */
        expose ${reqs}::*;
    }

    view traceMatrix : TraceMatrix {
        doc /* Requirements down the side, what meets them across the top. */
    }

    view verificationMatrix : VerificationMatrix {
        doc /* Requirements down the side, the tests that check them across the top. */
    }

    view specification : SpecificationDocument {
        doc /* The requirements as a document to send for review. */
        expose ${reqs}::*;
    }
}
`;

	const tour = `# Start here: ${name}

${about}

This project is set up for requirements: each one has an ID, a title, a
statement, a priority, a verification method, a status and an owner, like the
columns of a spreadsheet. They are kept as SysML v2 text, so a requirement can
also be traced to the part of the design that meets it and the test that checks it.

## Bring in your spreadsheet

[Import from a spreadsheet](#do:import-requirements) reads an Excel (.xlsx) or
CSV file, or cells pasted from one. Match its columns to ID, title, statement,
priority, verification method, status and owner, check the preview, and import.
Rows whose ID is already here update that requirement instead of adding a copy.

The four example requirements (\`'Operating temperature'\` and the rest) show
what an imported one looks like. Delete them when yours are in.

## The views

- \`requirements\`: every requirement. Click a cell to change it.
- \`gaps\`: the requirements nothing meets or tests yet.
- \`traceMatrix\` and \`verificationMatrix\`: requirements against what meets
  them and what tests them. Click a cell to add or remove a link.
- \`specification\`: the requirements as a document to print or send.

## Next steps

1. **Trace a requirement.** \`product\` stands for your product; add its parts
   and say which part meets which requirement in the trace matrix.
2. **Plan a test.** \`climateTest\` verifies \`'Operating temperature'\`: copy it
   for the others, and \`gaps\` gets shorter.
3. **Share it.** [Save to GitHub](#do:save-github) keeps every change with who
   made it, or export the table to Excel from its **Export** menu.

[Open the help](#do:help) for what each idea means, in plain words.
`;

	return {
		info: { name, description: about, version: '0.1.0' },
		files: [
			{ path: 'requirements/Requirements.sysml', text: requirements },
			{ path: 'design/Design.sysml', text: design },
			{ path: 'views/Views.sysml', text: viewsText },
			...viewLibraries,
			{ path: 'TOUR.md', text: tour }
		]
	};
}
