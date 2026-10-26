import { describe, expect, it } from 'vitest';
import {
	derivationCycleProblems,
	derivationCycles,
	derivationLinks,
	readDerivations
} from './derivations';
import type { RequirementRow } from './requirements';

const row = (id: string, title: string, file = 'r.sysml'): RequirementRow =>
	({ key: `${file}@${id}`, id, title, file }) as RequirementRow;

const text = `package R {
    #derivation connection { end #original ::> A; end #derive ::> B; }
    #derivation connection { end #original ::> B; end #derive ::> C; end #derive ::> 'Dee'; }
    #derivation connection { end #original ::> C; end #derive ::> A; }
    #derivation connection { end #original ::> X; end #derive ::> R::Y; }
}`;
const rows = [
	row('A', 'Aa'),
	row('B', 'Bb'),
	row('C', 'Cc'),
	row('D', 'Dee'),
	row('X', 'Xx'),
	row('Y', 'Yy')
];

describe('derivations', () => {
	it('resolves each end to a requirement by ID or title, qualified or not', () => {
		const links = derivationLinks(rows, readDerivations('r.sysml', text));
		expect(links.map((l) => `${l.original.id}>${l.derived.id}`)).toEqual([
			'A>B',
			'B>C',
			'B>D',
			'C>A',
			'X>Y'
		]);
	});

	it('finds each circle once, from the requirement written first', () => {
		const links = derivationLinks(rows, readDerivations('r.sysml', text));
		expect(derivationCycles(links).map((c) => c.map((l) => l.original.id).join(' '))).toEqual([
			'A B C'
		]);
	});

	it('reports a circle at its first derivation, naming every requirement in it', () => {
		const links = derivationLinks(rows, readDerivations('r.sysml', text));
		const [problem, ...rest] = derivationCycleProblems(links, () => text);
		expect(rest).toEqual([]);
		expect(problem).toMatchObject({
			file: 'r.sysml',
			severity: 'warning',
			code: 'derivation-cycle',
			message:
				'Circular derivation: A Aa → B Bb → C Cc → A Aa. A requirement can’t be derived, through others, from itself.',
			span: { start_row: 2, start_col: 5 }
		});
	});

	it('a requirement derived from itself directly is not a link at all', () => {
		const self = `package R { #derivation connection { end #original ::> A; end #derive ::> A; } }`;
		expect(derivationLinks(rows, readDerivations('r.sysml', self))).toEqual([]);
	});
});

describe('reading derivations from long texts', () => {
	it('takes time in proportion to the text, however long its blank runs', () => {
		// Comments are blanked to spaces before reading, so a library's long doc
		// comment is a long run of them; reading must not rescan it from each space.
		const blank = ' '.repeat(200_000);
		const text = `package P {\n/* ${'x'.repeat(200_000)} */\n${blank}\n#derivation connection { end #original ::> A; end #derive ::> B; }\n}`;
		const start = performance.now();
		const found = readDerivations('p.sysml', text);
		expect(performance.now() - start).toBeLessThan(1000);
		expect(found.map((d) => [d.original, d.derived])).toEqual([['A', ['B']]]);
	});
});
