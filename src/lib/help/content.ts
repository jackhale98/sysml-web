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
				keywords: 'sysml folder model views libraries tour readme',
				blocks: [
					'A project is a folder of plain text files, the same as any SysML v2 tool reads:',
					{
						list: [
							'`model/…sysml`: the model itself: requirements, parts, how they connect, what they do.',
							'`views/Views.sysml`: the saved views: tables, diagrams, budgets and reports.',
							'`libraries/`: the definitions the tables and reports use. You rarely need to open these.',
							'`TOUR.md`: the project’s tour, in Markdown. Write your own for the next reader.'
						]
					},
					'Open **Files** in the explorer to see them all, or find any file, element or view with search (Ctrl K, or ⌘K on a Mac).'
				]
			},
			{
				id: 'text-diagrams-tables',
				title: 'Text, diagrams and tables',
				keywords: 'source of truth view editor split same model',
				blocks: [
					'The **text** is the model. Every **diagram** and **table** is drawn from it, so they never disagree: add a part in a diagram and the line appears in the text; change a cell in a table and the text changes too.',
					'Open a model file to see its text and its diagram side by side (**Split**), or choose **Text** or **Diagram** at the top right. On a phone, a file opens as its diagram; **Text** is one tap away.',
					'You don’t have to write SysML. **Add** in a diagram, the forms in the details panel and **New view** write it for you, and show you the text they write, so you learn it as you go.'
				]
			},
			{
				id: 'overview',
				title: 'The overview and the details panel',
				keywords: 'home inspector selection problems status bar',
				blocks: [
					'The **Overview** shows the project at a glance: what the model has, how many requirements are met and tested, and any problems.',
					'Select anything (in a diagram, a table, the text or the explorer) and the **details panel** shows what it is, in plain words, with its values and links. On a phone, the details slide up from the bottom.',
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
					'A requirement is a “shall” statement with an ID, like a row of a requirements spreadsheet. Its statement is its `doc` text. When it can be checked by a number, a `require constraint` states the check, with units, and the app checks it against the design.',
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
					'**Satisfy** says which part of the design meets a requirement. **Verify** says which test checks it. Together they make the trace: a requirement with neither is a gap.',
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
					'Run any state machine from **Simulations** in the explorer: send it events and watch it move.'
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
					'**New view** › **Specification** makes a document of the requirements with their trace and gaps; **Interface control document** does the same for interfaces. Print it, or save it as a PDF from the print dialog. Tables export to Excel or CSV from their **Export** menu, and diagrams to SVG or PNG.'
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
				keywords: 'git commit push share team branch pull request backup',
				blocks: [
					'**Save to GitHub…** in the project menu connects the project to a repository and saves your changes there, with a note of what changed. Others can then open it from GitHub, and you can start a branch or propose changes for review. No git know-how needed.'
				],
				action: { action: 'save-github', label: 'Save to GitHub' }
			},
			{
				id: 'install',
				title: 'Install it on my phone',
				keywords: 'app home screen offline pwa android iphone ipad desktop',
				blocks: [
					'Fairtide can live on your Home Screen, Dock or app list and works offline. Choose **Install app** in the project menu or in **Settings** › **About**. On an iPhone or iPad, use **Share** › **Add to Home Screen** in Safari.'
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
							['Ctrl ,', 'Settings'],
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
							['Delete', 'Delete'],
							['Arrow keys', 'Move the selected boxes'],
							['Shift F10', 'The element’s menu'],
							['+ / − / 0', 'Zoom in, out, fit (sequence diagrams)']
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
					'Your projects are kept in this browser, on this device, as you work. Nothing is sent to a Fairtide server: there isn’t one. They are there next time you open Fairtide here, even offline.',
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
							'**A folder**: open a folder (in Chrome or Edge on a computer) and Fairtide saves back to the files there.',
							'**A file**: **Download as .kpar** in the project menu saves the whole project as one file, which any SysML v2 tool can read. Import it again from **Your projects**.'
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
