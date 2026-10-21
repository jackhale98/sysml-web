import { describe, expect, it } from 'vitest';
import { cleanDoc, numberSections, type Section } from './document.ts';
import { toMarkdown } from './markdown.ts';
import { parseExpose, pathInScope, splitName, typeName } from './model.ts';
import { pageCss } from './print.ts';
import { readDerivations, readInterfaceBody } from './text.ts';

describe('scope', () => {
	it('reads expose targets', () => {
		expect(parseExpose("P::'my part'::**")).toEqual({ path: ['P', 'my part'], mode: 'all' });
		expect(parseExpose('A::b::*')).toEqual({ path: ['A', 'b'], mode: 'members' });
		expect(parseExpose('A')).toEqual({ path: ['A'], mode: 'self' });
	});

	it('matches members, everything inside, or the element and its contents', () => {
		const members = [parseExpose('A::b::*')];
		expect(pathInScope(['A', 'b', 'c'], members)).toBe(true);
		expect(pathInScope(['A', 'b', 'c', 'd'], members)).toBe(false);
		expect(pathInScope(['A', 'b'], members)).toBe(false);
		const all = [parseExpose('A::**')];
		expect(pathInScope(['A', 'b', 'c', 'd'], all)).toBe(true);
		expect(pathInScope(['A'], all)).toBe(false);
		const self = [parseExpose('A::b')];
		expect(pathInScope(['A', 'b'], self)).toBe(true);
		expect(pathInScope(['A', 'b', 'c'], self)).toBe(true);
		// Relative to an import: the end of the path matches.
		expect(pathInScope(['Pkg', 'drone', 'battery'], [parseExpose('drone::*')])).toBe(true);
	});

	it('splits names, keeping quoted ones whole', () => {
		expect(splitName("A::'b::c'.d", true)).toEqual(['A', 'b::c', 'd']);
		expect(typeName('~Pkg::PowerPort[2]')).toBe('PowerPort');
		expect(typeName(':>> mass')).toBeNull();
	});
});

describe('text the engine does not model yet', () => {
	it('reads derivation connections, ignoring comments', () => {
		const text = `package R {
    // #derivation connection { end #original ::> Old; end #derive ::> Gone; }
    #derivation connection {
        end #original ::> Needs::'Parcel delivery';
        end #derive ::> 'Flight endurance';
        end #derive ::> Range;
    }
}`;
		expect(readDerivations('r.sysml', text)).toEqual([
			{
				original: "Needs::'Parcel delivery'",
				derived: ["'Flight endurance'", 'Range'],
				file: 'r.sysml'
			}
		]);
	});

	it("reads an interface def's ends and flows", () => {
		const body = `interface def CommandLink {
        doc /* end fake : Nothing; */
        end commander : CommandLinkPort;
        end port commanded : ~ CommandLinkPort;
        flow of FlightCommand from commander.command to commanded.command;
        flow from commanded.telemetry to commander.telemetry;
    }`;
		expect(readInterfaceBody(body)).toEqual({
			ends: [
				{ name: 'commander', type: 'CommandLinkPort' },
				{ name: 'commanded', type: '~CommandLinkPort' }
			],
			flows: [
				{ item: 'FlightCommand', from: 'commander.command', to: 'commanded.command' },
				{ item: null, from: 'commanded.telemetry', to: 'commander.telemetry' }
			]
		});
	});
});

describe('documents', () => {
	const section = (title: string, sections: Section[] = []): Section => ({
		id: '',
		number: '',
		title,
		blocks: [],
		sections
	});

	it('numbers sections and keeps anchors unique', () => {
		const [a, b] = numberSections([section('Scope', [section('Notes')]), section('Notes')]);
		expect([a!.number, a!.sections[0]!.number, b!.number]).toEqual(['1', '1.1', '2']);
		expect(a!.sections[0]!.id).toBe('notes');
		expect(b!.id).toBe('notes-2');
	});

	it('reads doc comments as paragraphs', () => {
		expect(cleanDoc('First line\n     * continues here.\n     *\n     * Second.')).toEqual([
			'First line continues here.',
			'Second.'
		]);
	});

	it('escapes what would break Markdown or the page set-up', () => {
		const doc = {
			kind: 'document' as const,
			view: 'v',
			title: 'A | B </style> "quoted"',
			kindLabel: 'Report',
			project: 'P',
			description: null,
			number: null,
			version: null,
			status: null,
			author: null,
			date: '21 October 2026',
			scope: [],
			summary: [],
			sections: numberSections([
				{
					...section('Table'),
					blocks: [{ type: 'table', columns: ['a|b'], rows: [[[{ text: 'x | *y*' }]]] }]
				}
			])
		};
		const md = toMarkdown(doc);
		expect(md).toContain('| a\\|b |');
		expect(md).toContain('| x \\| \\*y\\* |');
		const css = pageCss(doc);
		expect(css).not.toContain('</style>');
		expect(css).toContain('"A | B \\3C /style> \\"quoted\\""');
	});
});
