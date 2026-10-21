import { describe, expect, it } from 'vitest';
import {
	connectionEnds,
	declarationHeader,
	kindOf,
	multiplicityOf,
	viewFilters,
	writtenSpecializations
} from './model';

describe('declaration text', () => {
	it('cuts a declaration at its body or end, past brackets, strings and comments', () => {
		expect(declarationHeader('part rotors : Rotor[4];')).toBe('part rotors : Rotor[4]');
		expect(declarationHeader("part def 'a{b' :> C { part x; }")).toBe("part def 'a{b' :> C");
		expect(declarationHeader('attribute a = f(1; 2) /* { */ ;')).toBe(
			'attribute a = f(1; 2) /* { */'
		);
	});

	it('reads the multiplicity, not a unit', () => {
		expect(multiplicityOf('part rotors : Rotor[4]')).toBe('4');
		expect(multiplicityOf('part p[0..*] : P')).toBe('0..*');
		expect(multiplicityOf('attribute :>> mass = 650 [g]')).toBeNull();
		expect(multiplicityOf("part 'a[1]' : P")).toBeNull();
	});

	it('reads specializations as written', () => {
		expect(writtenSpecializations('attribute emptyMass :> mass')).toEqual(['mass']);
		expect(writtenSpecializations('part def A :> B, Pkg::C')).toEqual(['B', 'Pkg::C']);
		expect(writtenSpecializations('attribute x :> ISQ::mass = 3 [kg]')).toEqual(['ISQ::mass']);
		expect(writtenSpecializations('attribute :>> mass = 1')).toEqual([]);
		expect(writtenSpecializations('part p subsets q : T')).toEqual(['q']);
	});

	it('reads the ends of `connect`', () => {
		expect(connectionEnds('interface i : I connect a.b to c.d')).toEqual(['a.b', 'c.d']);
		expect(connectionEnds('connection connect (x, y.z)')).toEqual(['x', 'y.z']);
		expect(connectionEnds('#derivation connection')).toBeNull();
	});

	it("reads a view's own filters, not its nested views'", () => {
		const view = `view v : GeneralView {
			doc /* filter this; */
			filter @SysML::PartUsage;
			view inner { filter @SysML::PortUsage; }
		}`;
		expect(viewFilters(view)).toEqual(['@SysML::PartUsage']);
	});
});

describe('kindOf', () => {
	it('names metaclasses as the app does', () => {
		expect(kindOf('PartDefinition')).toBe('part');
		expect(kindOf('UseCaseDefinition')).toBe('use_case');
		expect(kindOf('UseCaseUsage')).toBe('use case');
		expect(kindOf('LibraryPackage')).toBe('package');
		expect(kindOf('EnumerationUsage')).toBe('enum');
		expect(kindOf('SomethingNewUsage')).toBe('somethingNew');
	});

	it('uses the membership and what a reference redefines', () => {
		expect(kindOf('ReferenceUsage', 'SubjectMembership')).toBe('subject');
		expect(kindOf('PartUsage', 'ActorMembership')).toBe('actor');
		expect(kindOf('ReferenceUsage', 'FeatureMembership', 'AttributeUsage')).toBe('attribute');
		expect(kindOf('ReferenceUsage')).toBe('ref');
	});
});
