import { describe, expect, it } from 'vitest';
import type { RelatedElement } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import { groupRelated } from './related.ts';

const element = (id: string, name: string, kind = 'part', isDefinition = false) =>
	({ key: `a.sysml@${id}`, id, name, label: name, kind, isDefinition }) as ModelElement;

const related = (
	kind: RelatedElement['kind'],
	direction: 'out' | 'in',
	id: string,
	name: string,
	via?: string
): RelatedElement => ({
	kind,
	direction,
	element: {
		id,
		name,
		qualifiedName: `P::${name}`,
		kind: 'part',
		isDefinition: false,
		file: 'a.sysml',
		start_byte: Number(id)
	},
	...(via ? { via } : {})
});

describe('related elements, grouped', () => {
	const elements = [
		element('1', 'Battery', 'part', true),
		element('2', 'power'),
		element('3', 'zed')
	];

	it('outgoing first, each kind in order and in plain words, rows by name', () => {
		const groups = groupRelated(
			[
				related('connects', 'out', '3', 'zed', 'cable'),
				related('connects', 'out', '2', 'power'),
				related('typed', 'out', '1', 'Battery'),
				related('satisfies', 'in', '9', 'outside')
			],
			elements
		);
		expect(groups.map((g) => [g.direction, g.title, g.rows.map((r) => r.name)])).toEqual([
			['out', 'Defined by', ['Battery']],
			['out', 'Connected to', ['power', 'zed']],
			['in', 'Satisfied by', ['outside']]
		]);
		expect(groups[1]!.rows[1]).toMatchObject({ via: 'cable', element: elements[2] });
		// Not one of the project's elements: listed, but not a link.
		expect(groups[2]!.rows[0]!.element).toBeUndefined();
	});

	it('leaves out what is shown elsewhere', () => {
		const groups = groupRelated(
			[related('satisfies', 'in', '2', 'power'), related('derives', 'out', '3', 'zed')],
			elements,
			(kind, direction) => kind === 'satisfies' && direction === 'in'
		);
		expect(groups.map((g) => g.title)).toEqual(['Derived from']);
	});
});
