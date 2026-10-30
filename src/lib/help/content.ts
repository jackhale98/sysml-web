/**
 * The help guide, in plain words: getting started, the ideas of SysML, how
 * to do the common things, keyboard shortcuts and where the data is kept.
 * Bundled (it works offline) and loaded only when the help is opened. The
 * ideas reuse the inspector's own explanations (`#lib/learn/concepts.ts`),
 * so each is written once. `docs/user-guide.md` is made from this too.
 *
 * Text is plain, with `**bold**` and `` `code` `` inline.
 */
import { CONCEPTS, RELATIONSHIPS } from '#lib/learn/concepts.ts';
import type { GuideAction } from '#lib/workbench/guide.ts';

export type Block =
	/** A paragraph. */
	| string
	| { list: string[] }
	| { steps: string[] }
	| { code: string }
	/** Keyboard shortcuts: keys, and what they do. */
	| { keys: [keys: string, does: string][] }
	/** What the inspector says about an idea, from `#lib/learn/concepts.ts`. */
	| { concept: string; label: string; summary: string; analogy?: string };

export interface HelpTopic {
	/** Unique across the guide (a link or a search goes to it). */
	id: string;
	title: string;
	/** Extra words that find it. */
	keywords?: string;
	blocks: Block[];
	/** Something the workbench can do for the person. */
	action?: { action: GuideAction; label: string };
}

export interface HelpSection {
	id: string;
	title: string;
	intro: string;
	topics: HelpTopic[];
}

/** An idea as the inspector explains it. */
function concept(key: string): Block {
	const c = CONCEPTS[key];
	if (c) return { concept: key, label: c.title, summary: c.summary, analogy: c.analogy };
	const r = RELATIONSHIPS[key];
	if (r) return { concept: key, label: r.title, summary: r.summary };
	throw new Error(`No concept ${key}`);
}

const exampleOf = (key: string) => ({
	code: CONCEPTS[key]?.example ?? RELATIONSHIPS[key]!.example
});

export const HELP: HelpSection[] = [
	{
		id: 'getting-started',
		title: 'Getting started',
		intro: 'What a project is, what is in it, and the three ways of looking at it.',
		topics: [
			{
				id: 'project',
				title: 'A project',
				keywords: 'new create template start blank flashlight requirements first',
				blocks: [
					'A project is one system model: the text files that describe it, the views saved with it and a short tour. Make one from **Your projects**: give it a name and choose where to start.',
					{
						list: [
							'**Blank**: a first requirement, the system part and three views. Build it your way.',
							'**Requirements first**: for moving a requirements spreadsheet. The usual columns, a trace and a report.',
							'**Small system**: a flashlight with parts, a wire between them, a mass budget and its on/off states. Good for learning.',
							'**From GitHub**: open the models in a repository you already have.'
						]
					},
					'A new project opens on its **Overview**, with **Next steps** that tick themselves as you do them, and **Start the tour** for a walk through what is there.'
				],
				action: { action: 'new-project', label: 'New project' }
			},
			{
				id: 'files',
				title: 'Its files',
				keywords:
					'sysml folder model views libraries tour readme layout new file rename move delete',
				blocks: [
					'A project is a folder of plain text files, the same as any SysML v2 tool reads:',
					{
						list: [
							'`.sysml` files (in `model/`, or in folders such as `requirements/` and `design/`): the model itself: requirements, parts, how they connect, what they do.',
							'`views/Views.sysml`: the saved views: tables, diagrams, budgets and reports.',
							'`libraries/`: the definitions the tables and reports use. You rarely need to open these.',
							'`layout/diagrams.json`: where you put the boxes on each diagram, and what each one hides.',
							'`TOUR.md`: the project’s tour, in Markdown. Write your own for the next reader.'
						]
					},
					'Open **Files** in the explorer to see them all, or find any file, element or view with search (Ctrl K, or ⌘K on a Mac).',
					'**New file** (in **Files**, or from search) starts another `.sysml` file. Each file’s **⋯** button (**More actions**) can **Rename…** it, **Move to folder…** or **Delete…** it; before a delete, it says what else uses the file. Undo takes any of them back.'
				]
			},
			{
				id: 'text-diagrams-tables',
				title: 'Text, diagrams and tables',
				keywords: 'source of truth view editor split same model',
				blocks: [
					'The **text** is the model. Every **diagram** and **table** is drawn from it, so they never disagree: add a part in a diagram and the line appears in the text; change a cell in a table and the text changes too.',
					'Open a model file to see its text and its diagram side by side (**Split**), or choose **Text** or **Diagram** at the top right. On a phone, a file opens as its diagram; **Text** is one tap away, for reading: **Edit text** (bottom right) turns typing on, and **Done** puts the keyboard away.',
					'You don’t have to write SysML. **Add** in a diagram, the forms in the details panel and **New view** write it for you, and show you the text they write, so you learn it as you go.'
				]
			},
			{
				id: 'diagram-show-hide',
				title: 'Change what a diagram shows',
				keywords:
					'hide remove delete diagram view expose model add connected neighbours related duplicate copy view as type',
				blocks: [
					'Right-click a box (long-press on a phone) to see its actions. Two of them look alike but do very different things:',
					{
						list: [
							'**Remove from diagram** takes the box off this diagram only. The element stays in the model, in the text and in every other diagram and table. Undo puts it back.',
							'**Delete from model** takes the element out of the text, so it leaves every diagram and table. Before you confirm, it says what else uses it: those places show as problems until you change them.'
						]
					},
					'In a saved view, removing an element its `expose` line names removes that line (the view’s own record of what it shows). Anything else is hidden on that diagram, and the layout remembers it beside the positions.',
					'Hidden elements are listed at the foot of the diagram (“2 hidden · Show all”): open the list to show one again, or show them all. Other diagrams are not affected.',
					'**Duplicate** (Ctrl D, ⌘ D on a Mac, or in a box’s actions, an element’s menu in the explorer, the details panel and search) copies the element right after it in the text, with everything inside it, under a free name (`battery2`), and selects the copy.',
					'**Add connected elements** (in a box’s actions, on structure diagrams) puts on the diagram what the element refers to (**Outgoing**: its type, what it specializes, satisfies or is connected to), what refers to it (**Incoming**), or both, in one step. A saved view gets an `expose` line for each; its filter may still leave some out, and it says so.',
					'On an **interconnection** diagram, which draws one element’s parts and how they are wired, **Add connected elements** shows again the parts beside it that a connection, flow or binding joins it to, if you removed them from the diagram. State, action and sequence diagrams draw one machine, process or interaction, so it isn’t offered there.',
					'**View as** (in a saved view’s toolbar) shows the same view as another kind of diagram that fits what it shows: a part’s general view as its interconnection view, an action’s as its action flow, and back. Only the view’s type changes (`view v : GeneralView` becomes `view v : InterconnectionView`); its positions and hidden elements come along.'
				]
			},
			{
				id: 'overview',
				title: 'The overview and the details panel',
				keywords: 'home inspector selection problems status bar',
				blocks: [
					'The **Overview** shows the project at a glance: what the model has, how many requirements are met and tested, and any problems.',
					'Select anything (in a diagram, a table, the text or the explorer) and the **details panel** shows what it is, in plain words, with its values and links. On a phone, the details slide up from the bottom.',
					'In the explorer’s model tree, each element has a menu: its **⋯** button, a right-click, or a long press on a phone. It can **Duplicate** the element, **Rename** it (references to it follow), **Show in text**, or **Delete from model** (after saying what else uses it).',
					'Its **Related elements** say what it refers to (its type, what it specializes, satisfies or is connected to), what refers to it, and where it is. Choose one to go to it: a quick answer to “what uses this?”.',
					'Give a value with its unit, such as `2 [kg]`, here or in a table. If the package doesn’t know that unit yet, its import (`private import SI::*;`) is added with the value, and one **Undo** takes both back.',
					'**Problems** (bottom of the screen, or in **More** on a phone) lists anything the model gets wrong, such as a name that refers to nothing. Click one to go to it.'
				],
				action: { action: 'problems', label: 'Show problems' }
			}
		]
	},
	{
		id: 'concepts',
		title: 'Ideas in plain words',
		intro:
			'SysML has its own words for things engineers already know. Here they are, as the details panel explains them.',
		topics: [
			{
				id: 'definition-usage',
				title: 'Definition and usage',
				keywords: 'def type kind instance catalog part number bill of materials',
				blocks: [
					'Almost everything comes in two forms. A **definition** (written with `def`) describes a kind of thing once, like a datasheet or a catalogue entry. A **usage** is SysML’s word for one of them used in a place, in a role: the battery in this flashlight.',
					'So `part def Battery` says what every battery of that kind is like, and `part battery : Battery` puts one in the design. The `:` reads “is a”.',
					concept('part def'),
					concept('part'),
					exampleOf('part')
				]
			},
			{
				id: 'concept-part',
				title: 'Part',
				keywords: 'component assembly structure breakdown',
				blocks: [
					'A part is a piece of the system: hardware, software, a person or a facility. Parts contain parts, which makes the system’s breakdown, like a bill of materials.',
					concept('part'),
					'Give a part numbers with **attributes**: `attribute mass :> ISQ::mass = 48 [g];` says it has a mass, measured as a mass, of 48 grams.',
					concept('attribute')
				],
				action: { action: 'add-part', label: 'Add a part' }
			},
			{
				id: 'concept-port',
				title: 'Port',
				keywords: 'connector pin interface point conjugate ~',
				blocks: [
					'A port is where something goes in or out of a part: power, data, fluid, force. A **port def** is the kind of connection point, like a connector standard; `~` in front of it (`~PowerPort`) is its mirror image, for the side that receives.',
					concept('port'),
					concept('port def')
				]
			},
			{
				id: 'concept-interface',
				title: 'Interface',
				keywords: 'connection wire cable icd connect',
				blocks: [
					'An interface joins two ports and says what crosses between them. An **interface def** is the agreement, written once; each interface uses it to join two particular ports.',
					concept('interface def'),
					concept('interface'),
					exampleOf('interface')
				]
			},
			{
				id: 'concept-requirement',
				title: 'Requirement',
				keywords: 'shall statement id spec specification',
				blocks: [
					"A requirement is a “shall” statement with an ID, like a row of a requirements spreadsheet. Its statement is its `doc` text. When it can be checked by a number, a `require constraint` states the check, with units, and the app checks it against the design. The ID (`<'REQ-12'>`) stays the same when the title changes or the requirement moves: Problems warns when two requirements share one, and the editor marks a requirement without one and suggests the next free ID.",
					concept('requirement'),
					concept('requirement def'),
					exampleOf('requirement')
				],
				action: { action: 'add-requirement', label: 'Add a requirement' }
			},
			{
				id: 'satisfy-verify',
				title: 'Satisfy and verify',
				keywords: 'trace traceability meets tested coverage gap link',
				blocks: [
					'**Satisfy** says which part of the design meets a requirement. **Verify** says which test checks it. Together they make the trace: a requirement with neither is a gap. Add them from the requirement’s details: **Add what satisfies it** and **Add a test that verifies it**.',
					concept('satisfy'),
					concept('verify'),
					{ code: "satisfy 'Maximum mass' by flashlight;" }
				],
				action: { action: 'link', label: 'Link a part to a requirement' }
			},
			{
				id: 'concept-view',
				title: 'View',
				keywords: 'diagram table report saved expose',
				blocks: [
					'A view is a saved table, diagram or report. It is part of the model, so it is shared and reviewed like the rest. `expose` says which part of the model it shows; the view’s kind says how.',
					{
						list: [
							'**Diagrams**: general, interconnection, state, action flow and sequence diagrams.',
							'**Tables**: requirements, requirement gaps, bill of materials, interfaces, trace and verification matrices, budgets and design checks, and the tables of trade studies and risk.',
							'**Documents**: a specification of the requirements, and an interface control document.',
							'**Matrices**: dependency matrices and N² charts (see **See what depends on what**).'
						]
					},
					concept('view')
				],
				action: { action: 'new-view', label: 'New view' }
			},
			{
				id: 'concept-constraint',
				title: 'Constraint',
				keywords: 'rule equation limit check true false',
				blocks: [
					'A constraint is a rule that is true or false, such as “the mass is at most 150 g”. A requirement uses one as its check (`require constraint`); the app works out the values and says whether each holds.',
					'A definition can **assert** one for all its parts (`assert constraint { mass <= 60 [g] }`): it is checked for the definition’s own values, and again for each part or specialization that changes them, where the change is written. **Design checks** shows each check’s values and what they are worked out from; a check that breaks shows under **Problems**, as does one that can’t be decided (a warning for a division by zero, a note when a value or a `satisfy` is still missing).',
					concept('constraint'),
					concept('constraint def')
				],
				action: { action: 'limit', label: 'Set a limit' }
			},
			{
				id: 'concept-state-machine',
				title: 'State machine',
				keywords: 'state mode transition event trigger simulate',
				blocks: [
					'A state machine lists the modes something can be in (off, on, low battery) and what makes it switch between them. A **transition** leaves one state (`first`), on an event (`accept`), maybe only if a condition holds (`if`), for another (`then`).',
					concept('state def'),
					concept('transition'),
					'Run any state machine from **Simulations** in the explorer: send it events and watch it move. **Step** takes what happens without an event: a transition with no trigger, an `accept when …` whose condition is true, or a timer that is due; if nothing is ready, time passes to the next timer. **Wait** lets time pass by an amount, and everything due on the way happens in order.',
					'Time is simulated: the clock starts at 0 and moves only when you Step or Wait. `accept after 5 [SI::min]` fires 5 minutes after its state was entered, counting again each time the state is entered; `accept at 2 [SI::h]` fires 2 hours after the start. The **Timeline** shows when each step happened.',
					'Something that changes over time, like a battery running down, is a timed transition that changes a value: `accept after 5 [SI::min] do assign charge := charge - 0.1`. A state’s `do` action starts once the state is entered and stops when it is left.',
					'Actions run step by step, in the order written: `assign`, `if … { } else { }`, `then`, and signals a machine sends itself (`send new Ping() to self`), which the next **Step** takes. A transition to `terminate` ends the run.',
					'Before a run, the simulator lists states that no transition can reach and transitions that can never fire. The **Timeline** says why each step happened (the event, the condition, the timer) and what its guard read; save it as CSV or JSON to keep the run with your evidence.'
				],
				action: { action: 'state-machine', label: 'Draw a state machine' }
			},
			{
				id: 'concept-action-flow',
				title: 'Action flow',
				keywords: 'activity process steps function sequence then fork decide',
				blocks: [
					'An action flow is a process, step by step: `then` for the next step, `fork` and `join` for steps at the same time, `decide` and `merge` for a choice.',
					concept('action def'),
					concept('action'),
					concept('succession')
				],
				action: { action: 'action-flow', label: 'Draw an action flow' }
			},
			{
				id: 'concept-package',
				title: 'Package',
				keywords: 'folder namespace import organise',
				blocks: [concept('package')]
			}
		]
	},
	{
		id: 'how-do-i',
		title: 'How do I…',
		intro: 'Short answers to the common jobs, each with a button that starts it.',
		topics: [
			{
				id: 'add-part',
				title: 'Add a part',
				keywords: 'new component element create',
				blocks: [
					{
						steps: [
							'Open a diagram (such as **Structure**) and choose **Add**, or select a part definition and use **Add** in the details panel.',
							'Choose **Part**, give it a name (`battery`) and, if you like, a type (`Battery`).',
							'It appears in the diagram and as a line in the text.'
						]
					},
					'On a phone, use the **+** button.'
				],
				action: { action: 'add-part', label: 'Add a part' }
			},
			{
				id: 'connect-ports',
				title: 'Connect ports',
				keywords: 'interface wire link interconnection connection',
				blocks: [
					{
						steps: [
							'Give the parts ports (**Add** › **Port**).',
							'Open an **Interconnection diagram** of the part that holds them (**New view** makes one).',
							'Select a port, choose **Connect** (or press C) and pick the port at the other end.'
						]
					},
					'In text: `interface wire : Wire connect battery.powerOut to led.powerIn;`'
				],
				action: { action: 'connect-ports', label: 'New interconnection diagram' }
			},
			{
				id: 'write-requirement',
				title: 'Write a requirement',
				keywords: 'add requirement shall id statement',
				blocks: [
					{
						steps: [
							'Choose **Add** › **Requirement** (or open the requirements table).',
							'Give it an ID, a title and a “shall” statement.',
							'To make it checkable, select it and choose **Set a limit**: “mass at most 150 g”.'
						]
					}
				],
				action: { action: 'add-requirement', label: 'Add a requirement' }
			},
			{
				id: 'link-requirement',
				title: 'Link a requirement to the design',
				keywords: 'satisfy verify trace meets test link gap coverage',
				blocks: [
					{
						steps: [
							'Select the requirement (in the requirements table, a diagram or the explorer).',
							'In its details, under **Satisfied by**, choose **Add what satisfies it** and pick the part that meets it.',
							'Under **Verified by**, choose **Add a test that verifies it**: pick a test, or type a name to make a new one.'
						]
					},
					'Each pick writes a `satisfy` or `verify` line, and the requirement leaves the **Gaps** list once both are there. In a diagram, **Connect** from a part to a requirement does the same.',
					'Coverage follows one rule everywhere (the home page, the tables and reports): a requirement counts as satisfied when something in the design satisfies it, or when every requirement derived from it is satisfied; verified and tests passed count the same way. So a stakeholder need is covered once all the requirements derived from it are. A requirement derived, through others, from itself is flagged under **Problems**.'
				],
				action: { action: 'link', label: 'Link a requirement' }
			},
			{
				id: 'record-result',
				title: 'Record a test result',
				keywords:
					'verification result outcome pass fail passed failed verdict inconclusive error evidence commit revision out of date stale run test report coverage',
				blocks: [
					{
						steps: [
							'Select the verification case (the test), for example from **Verified by** in a requirement’s details.',
							'Under **Result**, choose **Record a result**.',
							'Choose the verdict (passed, failed, inconclusive or error), the date and who ran it, and say where the evidence is: a link to the test report, or where it is kept.',
							'Check the commit: it is the version of the model on GitHub the test was run against, filled in when the project is saved there. Choose **Record**.'
						]
					},
					'The result is written in the model, on the case, as SysML’s own `@VerificationResult` (the first one adds `libraries/VerificationResults.sysml` to the project), so it is reviewed, saved and shared like the rest, and other tools can read it. A new result replaces the case’s last one; the earlier ones stay in the history.',
					'The requirements table’s **Result** column, the verification matrix, a requirement’s details, the **Tests passed** ring on the home page and the specification report show how each requirement’s tests went: passed, failed, inconclusive or not run yet. A result run against an earlier version of the model is **out of date** once the model has changed since (results recorded since don’t count as changes). In a project not connected to GitHub the commit can’t be compared, and the result says **commit unknown**.'
				],
				action: { action: 'requirements', label: 'Open the requirements table' }
			},
			{
				id: 'check-budget',
				title: 'Check a budget',
				keywords: 'mass power cost roll-up add up sum limit margin',
				blocks: [
					{
						steps: [
							'Give the parts a value, such as `mass`.',
							'Select the part they belong to, and next to its value choose **Add up**: it sums the value over its parts and can make a budget table.',
							'Choose **Set a limit** next to the total to write a requirement that checks it. The budget shows the margin and turns red when it is over.'
						]
					}
				],
				action: { action: 'budget', label: 'New budget' }
			},
			{
				id: 'compare-options',
				title: 'Compare options',
				keywords: 'trade study alternatives weighted score decision',
				blocks: [
					'**New trade study** compares alternatives (parts, or kinds of part) on criteria you weight, such as mass, cost and power, and ranks them. The study is saved in the model, so it updates when a value changes.'
				],
				action: { action: 'trade', label: 'New trade study' }
			},
			{
				id: 'fmea',
				title: 'Analyse what can fail (FMEA)',
				keywords:
					'fmea dfmea pfmea ufmea failure mode effects analysis risk rpn band action priority severity likelihood occurrence detection worksheet use error policy acceptability acceptable unacceptable alarp filter review mitigation control',
				blocks: [
					'An FMEA lists what can go wrong, what follows and why, and rates each line from 1 to 10 for **severity** (how bad the effect is), **likelihood** (how likely the cause is) and **detection** (how likely it is to go unnoticed). **New FMEA** asks which kind you want:',
					{
						list: [
							'**Design FMEA**: how the parts of a design can fail.',
							'**Process FMEA**: how the steps of a process (making, assembling, servicing) can go wrong.',
							'**Use FMEA**: the mistakes a user can make in each task, or foreseeable misuse.'
						]
					},
					'It opens as a worksheet. **Add a line** to choose the part, step or task, say how it fails, what follows and why, and choose the three ratings, each with what it means. Lines can link to the hazard they can lead to. Edit any cell in place; the bin at the end of a row removes the line.',
					'The **risk priority number** (severity × likelihood × detection) with its **band** (low, medium, high or critical), the **action priority** (high, medium or low, from the AIAG-VDA table) and the **acceptability** (acceptable, reduce as far as possible, or unacceptable) are calculated, never typed in. **Risk matrix** counts the lines by severity and likelihood, each cell coloured and patterned by its zone.',
					'**Risk policy** (on the risk matrix, or from the search box) is your organisation’s rule: paint which cells are acceptable, to reduce or unacceptable, say where the RPN bands start, and choose whether worksheets lead with the action priority or the RPN. Both figures stay on every worksheet.',
					'To review the high risks, use the quick reviews above a worksheet (**High priority**, **Severity ≥ 9**, **Unacceptable**, **RPN ≥ …**) or **Filter** any column: numbers by range, levels by value, text that contains words. Export takes the rows shown. **Save as a view** keeps the filters in the model, as a view anyone can open.',
					'Each line can name the **risk controls** and **mitigations** that address it: choose them when adding a line, or select the line’s part and use **Link a risk control or mitigation** in its details, which also shows whether each control is implemented and verified. The controls already in place stay as words in the line.',
					'A rating outside 1 to 10 or not a whole number, a severity that is not the worst harm of the line’s hazard, an unacceptable risk, or a high-priority or unacceptable line without a verified control is flagged in its cell and under **Problems**. The rules come from the risk library in `libraries/RiskAnalysis.sysml`, which the first FMEA adds to the project.'
				],
				action: { action: 'fmea', label: 'New FMEA' }
			},
			{
				id: 'hazards',
				title: 'Log hazards and their controls',
				keywords:
					'hazard harm severity hazardous situation risk control mitigation hazard log iso 14971 safety',
				blocks: [
					'**New hazard** records a source of harm, when people are exposed to it (optional), the harms it can cause with how severe each is, and the **risk controls** that lower the risk. Each control is a requirement, so what implements it and the test that proves it are linked as for any requirement.',
					{
						steps: [
							'Name the hazard and describe it.',
							'Add the harms it can cause, and choose how severe each is.',
							'Add the risk controls, each a “shall” statement.',
							'In the **hazard log** that opens, choose a control, then **Add what satisfies it** and **Add a test that verifies it** in its details.'
						]
					},
					'The hazard log lists each hazard with its harms, the worst severity and its controls, with gaps left empty. The words come from `libraries/HazardAnalysis.sysml`.'
				],
				action: { action: 'hazard', label: 'New hazard' }
			},
			{
				id: 'dsm',
				title: 'See what depends on what (DSM)',
				keywords:
					'dsm design structure matrix dependency n2 n-squared interface chart modules clustering coupling change impact functional requirement derivation',
				blocks: [
					'A **dependency matrix** (DSM) lists the same parts down the side and across the top. The cell in a part’s row and another’s column shows how the first leads to the second: a connection, an item passed along a flow, a binding. Read across a row for what a part affects, down a column for what it depends on. An **N² chart** is the same grid with the interfaces and items named in the cells. It is read from the model, so it is always up to date.',
					{
						steps: [
							'**New DSM** (in **Make something new**, **New view** or the search box): choose a part DSM, an N² chart, a functional DSM (the steps of a process) or a requirement DSM (which requirements are derived from which).',
							'Choose whose parts to compare, such as the drone, and whether to include the parts inside them too.',
							'Choose what counts as a link and the order, then a name.'
						]
					},
					'On the matrix, **Counts** switches kinds of link on and off: connections, flows, bindings, allocations, uses and satisfies for parts. **Suggested modules** reorders the parts so the ones linked to each other sit together and outlines the groups with more links inside than between them; it is a suggestion from the links alone. Both are saved in the view, and Undo takes them back.',
					'Point at or select a cell for its links, with **Show in SysML**. Select an empty cell between two parts to **Connect them**. The lightning button beside a part shows what a change to it may affect, directly and through others, with how many. A part with no links of the kinds counted (to the others or to anything outside the matrix), and a connection with no interface definition, are flagged for review.',
					'On a phone each part is a card that opens to what it is connected with, leads to and comes from, with **What a change affects** and **Add a connection**; **Grid** shows the matrix, scrolling sideways.'
				],
				action: { action: 'dsm', label: 'New DSM' }
			},
			{
				id: 'conventions',
				title: 'Check modelling conventions',
				keywords:
					'convention rule style guide naming check lint enforce problems where filter owner verification method',
				blocks: [
					'A project’s own rules, such as “every requirement names its owner”, are saved views: a table whose rows are what breaks the rule, marked `@Convention`. Every row it lists shows under **Problems**, at the element it is about, with the rule’s words.',
					{
						code: 'view requirementsWithoutOwner : RequirementsTable {\n    @TableRendering { where = "owner == \\"\\""; }\n    @Convention { rule = "Every requirement names its owner."; }\n}'
					},
					'Make the table first (**Filter** a table and **Save as a view** writes the `where`), then add the `@Convention` line in its text. `severity = ConventionSeverity::error` (or `note`) changes how much it matters; a warning otherwise. The marker comes from the `Reporting` library.'
				],
				action: { action: 'problems', label: 'Show problems' }
			},
			{
				id: 'draw-state-machine',
				title: 'Draw a state machine',
				keywords: 'state diagram modes transitions',
				blocks: [
					{
						steps: [
							'Choose **Add** › **State definition** in a package and give it a name.',
							'Open its state diagram (right-click it, or **New view** › **State diagram**).',
							'Add states with **Add**, and draw transitions with **Transition** (or press C).',
							'Run it from **Simulations** in the explorer.'
						]
					}
				],
				action: { action: 'state-machine', label: 'New state diagram' }
			},
			{
				id: 'make-report',
				title: 'Make a report',
				keywords: 'document specification icd print export pdf word',
				blocks: [
					'**New view** › **Specification** makes a document of the requirements with their trace, test results and gaps; **Interface control document** does the same for interfaces. **Print / PDF** prints it or saves it as a PDF; it also downloads as one HTML file or as Markdown. Tables export to Excel or CSV from their **Export** menu, and diagrams to SVG or PNG (or copy to the clipboard) from theirs.',
					'A report names the version of the model it was made from: the commit on GitHub (with “changes not committed” when the model has changed since), or **Not committed** for a project that isn’t on GitHub. To make a report for review or audit, save to GitHub first.'
				],
				action: { action: 'report', label: 'New report' }
			},
			{
				id: 'import-excel',
				title: 'Import from Excel',
				keywords: 'spreadsheet xlsx csv paste requirements upload',
				blocks: [
					{
						steps: [
							'Choose **Import requirements…** in the project menu (or **Import** above the requirements table).',
							'Pick an Excel or CSV file, or paste cells copied from a spreadsheet.',
							'Match its columns to ID, title, statement and the rest, check the preview, and import. A row whose ID is already here updates that requirement.'
						]
					}
				],
				action: { action: 'import-requirements', label: 'Import requirements' }
			},
			{
				id: 'save-github',
				title: 'Save to GitHub',
				keywords:
					'git commit push share team branch pull request backup review changes diff compare get latest',
				blocks: [
					'**Save to GitHub…** in the project menu connects the project to a repository and saves your changes there, with a note of what changed. Others can then open it from GitHub, and you can start a branch or propose changes for review. No git know-how needed.',
					'Once a project is on GitHub, the project menu also has **Get latest** (bring in what others saved; where you both changed a file, choose whose to keep), **Propose changes…** (a pull request) and **Open on GitHub**. Sign in with GitHub, or connect with an access token; **Settings** › **Accounts** can hold more than one account. For a GitHub Enterprise Server, enter its address under **Settings** › **Accounts** first, then connect with an access token made on that server: the token goes only there.',
					'**Review changes** in the project menu says what changed in the model, in plain words: requirements, design, behaviour, verification and risk, with the checks and budgets the change affects first. A changed or removed requirement or risk control names what relies on it: what satisfies it, its mitigations, the tests that verify it, the requirements derived from it and the FMEA lines that name it. Compare with what is not on GitHub yet, a branch, an earlier version or a proposal; diagrams and tables mark what changed. In a project kept only in this browser, **Mark as reviewed** sets the version later changes are compared with.'
				],
				action: { action: 'save-github', label: 'Save to GitHub' }
			},
			{
				id: 'baselines',
				title: 'Mark a baseline (PDR, CDR…)',
				keywords:
					'baseline freeze design review srr pdr cdr milestone tag version snapshot since changed compare release',
				blocks: [
					'A baseline freezes the model under a name at a design review, such as SRR, PDR or CDR, so everything afterwards can be judged against it. Open **Source control** (the branch button at the top) and find **Baselines**.',
					{
						steps: [
							'Under **Mark a baseline**, give it a name and the date it stands for, and a description if you like, then choose **Mark baseline**.',
							'Later, **Changes since PDR** beside it opens **Review changes** against it: what changed in the model since, requirements first. **Go to** › **Requirements** jumps to the requirements that changed.',
							'**Remove** takes a baseline away, after asking.'
						]
					},
					'On a project saved to GitHub, a baseline is a tag on the version saved there (`baseline/PDR`), so your whole team sees it; save your changes first. Removing it deletes the tag on GitHub, for everyone; the version itself stays. On a project kept only in this browser, or opened from a folder, a baseline is a copy of the files kept with the project in this browser (nothing is written to the folder): to share baselines, save the project to GitHub.',
					'A report made when the model is exactly a baseline says **Baseline: CDR**; once the model has changed, it says which baseline it has changed since.'
				],
				action: { action: 'save-github', label: 'Open baselines' }
			},
			{
				id: 'exchange-models',
				title: 'Exchange models with other tools',
				keywords:
					'json interchange kerml export import api server syson pilot omg rest cors kpar other tool standard library open save merge conflict keep mine theirs',
				blocks: [
					'Other SysML v2 tools read and write models in three ways, and Tessera does all three. Your SysML text stays the source of truth: what comes in is written as text, and what goes out is made from it.',
					{
						list: [
							'**A .kpar file**: the project’s SysML text in one archive. **Download as .kpar** in the project menu writes one; **Import** on **Your projects** opens one. Everything comes across exactly as written. If your project uses the built-in `ModelViews` or `Reporting` library without holding it, the archive includes it, so other tools can read the archive too. On import, a file whose path leads outside the project, a file the archive holds twice or one that fails the archive’s own check is named; an archive that would unpack to more than 256 MB isn’t opened.',
							'**SysML v2 JSON**: the standard file of model elements, each with an id and a type, that API servers and many tools exchange. **Download as SysML v2 JSON…** in the project menu writes it: only your model (it refers to the standard library by its standard ids, which every tool knows), or with the standard library too, so the file stands on its own. **Import** on **Your projects** reads one and writes it as SysML text.',
							'**A SysML v2 API server**, such as the OMG pilot server or SysON (its address ends in `/api/rest`): **Connect to a SysML v2 API server…** in the project menu.'
						]
					},
					'An import says what came across and what didn’t, in a few lines; **Download the full list** gives all of it as a text file. JSON holds no comments, blank lines or layout, so a model that went through JSON reads the way Tessera writes SysML, and element ids are not kept in the text (they come from file names here). What a file from another tool writes out that the text implies anyway (a calculation’s `result`, derived values) doesn’t count as lost; a file in which two elements share an id isn’t opened.',
					{
						steps: [
							'**Open from server**: choose the project, its branch and a version (the latest, or an earlier commit). It opens as a new project on this device.',
							'**Save to server**: Tessera reads the branch’s latest version, matches your elements to the server’s and saves only what differs, as one commit. What the server has and your project doesn’t is removed in that commit; earlier commits keep it. Then it reads the branch back: if the server didn’t keep something, it says what, instead of “Saved”. SysON keeps changes to elements it has but not new elements: with SysON, removals go only once the new elements are seen kept, so nothing is lost there.'
						]
					},
					'If someone else saved to the branch since you opened the project from the server (or last saved it there), saving merges first. Their changes come into your project, as one step you can undo, and yours go to the server on top of theirs. Where you both changed the same element differently, or one of you removed something the other changed, both versions are shown in plain words: choose **Keep mine** or **Keep theirs** for each (or **Keep all mine**, **Keep all theirs**). Nothing is written until you save, and the result says what came in and what was sent.',
					'The merge works on the model, not on your text: your files keep their notes and layout, and a new element of theirs is added where it belongs. An element they changed is written again the way the formatter writes it, so `//` notes and layout inside it don’t come through; the review names those elements first.',
					'The browser talks to the server directly (there is no Tessera server in between), so the server must allow this page. It answers `OPTIONS` requests and sends `Access-Control-Allow-Origin` with this page’s address (or `*`), `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Allow-Methods: GET, POST` and `Access-Control-Expose-Headers: Link` (for long lists). If it doesn’t, Tessera says so: ask whoever runs it. A token stays on this device and goes only to its server.'
				],
				action: { action: 'export-json', label: 'Download as SysML v2 JSON' }
			},
			{
				id: 'install',
				title: 'Install it on my phone',
				keywords: 'app home screen offline pwa android iphone ipad desktop',
				blocks: [
					'Tessera can live on your Home Screen, Dock or app list and works offline. Choose **Install app** in the project menu or in **Settings** › **About**. On an iPhone or iPad, use **Share** › **Add to Home Screen** in Safari.'
				],
				action: { action: 'install', label: 'Install app' }
			},
			{
				id: 'switch-projects',
				title: 'Switch projects',
				keywords: 'open another project list recent',
				blocks: [
					'Open the project menu (the project’s name at the top left): your recent projects are listed there, with **All projects…** for the rest. You are asked first if changes here are not saved to GitHub or the folder yet.'
				],
				action: { action: 'switch-project', label: 'All projects' }
			}
		]
	},
	{
		id: 'shortcuts',
		title: 'Keyboard shortcuts',
		intro: 'On a Mac, use ⌘ where it says Ctrl.',
		topics: [
			{
				id: 'shortcuts-everywhere',
				title: 'Everywhere',
				keywords: 'keys hotkeys',
				blocks: [
					{
						keys: [
							['Ctrl K', 'Search the model, views and commands'],
							['?', 'Open this help'],
							['Ctrl S', 'Save to the folder (projects opened from a folder)'],
							['Ctrl D', 'Duplicate the selected element (not in the text)'],
							['Ctrl ,', 'Settings'],
							['Tab', 'First: skip to the model, or to the open view'],
							['↑ ↓ Home End', 'Move through the project menu (↓ on its button opens it)'],
							['Esc', 'Close a dialog or menu']
						]
					}
				]
			},
			{
				id: 'shortcuts-text',
				title: 'In the text',
				keywords: 'editor keys',
				blocks: [
					{
						keys: [
							['Ctrl Space', 'Suggest what to type'],
							['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
							['Ctrl F', 'Find and replace'],
							['F12 or Ctrl click', 'Go to where a name is defined'],
							['Shift F12', 'Find where a name is used'],
							['F2', 'Rename everywhere'],
							['Ctrl .', 'Quick fix'],
							['Shift Alt F', 'Tidy the layout of the text']
						]
					}
				]
			},
			{
				id: 'shortcuts-diagrams',
				title: 'In diagrams',
				keywords: 'canvas keys',
				blocks: [
					{
						keys: [
							['C', 'Connect from the selected element'],
							['F2', 'Rename'],
							['H', 'Remove from this diagram (it stays in the model)'],
							['Ctrl D', 'Duplicate, beside it'],
							['Delete or Backspace', 'Delete from the model'],
							['Arrow keys', 'Move the selected boxes'],
							['Shift F10', 'The element’s menu'],
							['+ / − / 0', 'Zoom in, out, fit (sequence diagrams and the simulator)']
						]
					}
				]
			},
			{
				id: 'shortcuts-tree',
				title: 'In the model tree',
				keywords: 'explorer keys',
				blocks: [
					{
						keys: [
							['Shift F10', 'The element’s menu'],
							['F2', 'Rename'],
							['Ctrl D', 'Duplicate the selected element']
						]
					}
				]
			},
			{
				id: 'shortcuts-simulator',
				title: 'In the simulator',
				keywords: 'emulator state machine keys',
				blocks: [
					{
						keys: [
							['1 to 9', 'Send that event'],
							['S', 'Step'],
							['W', 'Wait (let time pass)'],
							['B', 'Back a step'],
							['P', 'Play or pause']
						]
					}
				]
			}
		]
	},
	{
		id: 'data',
		title: 'Where’s my data?',
		intro: 'Plainly: on your device, unless you choose to put it somewhere else.',
		topics: [
			{
				id: 'where-data',
				title: 'In this browser',
				keywords: 'storage privacy local offline indexeddb backup lost',
				blocks: [
					'Your projects are kept in this browser, on this device, as you work. Nothing is sent to a Tessera server: there isn’t one. They are there next time you open Tessera here, even offline.',
					'They are not on your other devices, and clearing this browser’s site data deletes them. So keep a copy of anything that matters:'
				]
			},
			{
				id: 'keep-copy',
				title: 'Keeping a copy',
				keywords: 'download kpar export github folder backup share',
				blocks: [
					{
						list: [
							'**GitHub**: **Save to GitHub…** keeps every version, with who changed what, and lets your team work on it too. Only GitHub sees the files.',
							'**A folder**: open a folder (in Chrome or Edge on a computer), and **Save to folder** writes your changes back to the files there. A file another program changed there meanwhile is brought in; one changed there and here too isn’t overwritten: you choose which version to keep. Files keep their line endings (Windows or Unix); a file that isn’t UTF-8 text isn’t opened, and you’re told which.',
							'**A file**: **Download as .kpar** in the project menu saves the whole project as one file, which any SysML v2 tool can read. Import it again from **Your projects**.',
							'**Another tool or a server**: **Download as SysML v2 JSON…** and **Connect to a SysML v2 API server…** (see **Exchange models with other tools**).'
						]
					},
					'**Settings** › **Projects & storage** shows how much space is used and can ask the browser to keep your projects.'
				],
				action: { action: 'download', label: 'Download as .kpar' }
			}
		]
	}
];

export const ALL_TOPICS: HelpTopic[] = HELP.flatMap((s) => s.topics);

export function topicById(id: string): HelpTopic | undefined {
	return ALL_TOPICS.find((t) => t.id === id);
}

/** The words of a block, for search. */
export function blockText(block: Block): string {
	if (typeof block === 'string') return block;
	if ('list' in block) return block.list.join(' ');
	if ('steps' in block) return block.steps.join(' ');
	if ('code' in block) return block.code;
	if ('keys' in block) return block.keys.map((k) => k.join(' ')).join(' ');
	return `${block.label} ${block.summary} ${block.analogy ?? ''}`;
}

/** A topic's searchable text: its title, words and body, without markup. */
export function topicText(topic: HelpTopic): string {
	return [topic.title, topic.keywords ?? '', ...topic.blocks.map(blockText)]
		.join(' ')
		.replace(/\*\*|`/g, '');
}

/** The inline pieces of a line of help text: plain, **bold** and `code`. */
export function inlineParts(text: string): { text: string; kind: 'plain' | 'bold' | 'code' }[] {
	const out: { text: string; kind: 'plain' | 'bold' | 'code' }[] = [];
	const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
	let at = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > at) out.push({ text: text.slice(at, match.index), kind: 'plain' });
		if (match[1] !== undefined) out.push({ text: match[1], kind: 'bold' });
		else out.push({ text: match[2]!, kind: 'code' });
		at = match.index + match[0].length;
	}
	if (at < text.length) out.push({ text: text.slice(at), kind: 'plain' });
	return out;
}

/** Topics matching a query, best first: every word must appear; title hits count most. */
export function searchHelp(query: string): HelpTopic[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return ALL_TOPICS;
	const scored: { topic: HelpTopic; score: number }[] = [];
	for (const topic of ALL_TOPICS) {
		const title = topic.title.toLowerCase();
		const keywords = (topic.keywords ?? '').toLowerCase();
		const body = topicText(topic).toLowerCase();
		let score = 0;
		for (const w of words) {
			if (title.includes(w)) score += title.startsWith(w) ? 6 : 4;
			else if (keywords.includes(w)) score += 3;
			else if (body.includes(w)) score += 1;
			else {
				score = 0;
				break;
			}
		}
		if (score > 0) scored.push({ topic, score });
	}
	return scored.sort((a, b) => b.score - a.score).map((s) => s.topic);
}
