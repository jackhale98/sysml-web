import { describe, expect, it } from 'vitest';
import { cleanDoc, nameSegment, scanDeclarations, topLevelNames } from './declarations';

const brief = (text: string) =>
	scanDeclarations(text).map((d) => `${d.line} ${d.kind} ${d.qualifiedName}`);

describe('scanDeclarations', () => {
	it('reads definitions, usages and packages with their nesting', () => {
		const text = `standard library package Ports {
    doc
    /*
     * Ports and their parts.
     */
    private import Objects::Object;

    abstract port def Port :> Object {
        ref self: Port :>> Object::self;
        port subports: Port [0..*] :> ports {
            doc /* The subports. */
        }
        ref :>> outgoingTransfers {
            end ref source;
        }
        attribute :>> mass = 2 [kg];
    }
    abstract port ports : Port[0..*] nonunique;
}`;
		expect(brief(text)).toEqual([
			'1 package Ports',
			'8 port def Ports::Port',
			'9 ref Ports::Port::self',
			'10 port Ports::Port::subports',
			'14 ref Ports::Port::outgoingTransfers::source',
			'18 port Ports::ports'
		]);
		const [ports, port, , subports] = scanDeclarations(text);
		expect(ports!.doc).toBe('Ports and their parts.');
		expect(port).toMatchObject({ isDefinition: true, depth: 1 });
		expect(port!.doc).toBeUndefined();
		expect(subports).toMatchObject({ isDefinition: false, doc: 'The subports.' });
	});

	it('reads KerML classifiers and features', () => {
		const text = `package ScalarValues {
	private import Base::DataValue;
	abstract datatype ScalarValue specializes DataValue;
	datatype Real specializes Complex;
	abstract function ToReal { in x : Natural; return : Real; }
	assoc struct Link { end feature a; end b : B; }
	portion feature all portions: Occurrence[1..*];
}`;
		expect(scanDeclarations(text).map((d) => [d.kind, d.qualifiedName, d.isDefinition])).toEqual([
			['package', 'ScalarValues', true],
			['datatype', 'ScalarValues::ScalarValue', true],
			['datatype', 'ScalarValues::Real', true],
			['function', 'ScalarValues::ToReal', true],
			['in', 'ScalarValues::ToReal::x', false],
			['assoc struct', 'ScalarValues::Link', true],
			['feature', 'ScalarValues::Link::a', false],
			['end', 'ScalarValues::Link::b', false],
			['feature', 'ScalarValues::portions', false]
		]);
	});

	it('reads short names, quoted names and enumeration literals', () => {
		const text = `standard library package <USCU> USCustomaryUnits {
	attribute <kg> kilogram : MassUnit;
	attribute 'acre (based on US survey foot)' : AreaUnit { :>> unitConversion { :>> factor = 4; } }
	enum def Level { low; medium = 0.5; enum high; }
}`;
		const decls = scanDeclarations(text);
		expect(decls.map((d) => [d.kind, d.qualifiedName, d.shortName])).toEqual([
			['package', 'USCustomaryUnits', 'USCU'],
			['attribute', 'USCustomaryUnits::kilogram', 'kg'],
			['attribute', "USCustomaryUnits::'acre (based on US survey foot)'", undefined],
			['enum def', 'USCustomaryUnits::Level', undefined],
			['enum', 'USCustomaryUnits::Level::low', undefined],
			['enum', 'USCustomaryUnits::Level::medium', undefined],
			['enum', 'USCustomaryUnits::Level::high', undefined]
		]);
		expect(decls[2]!.name).toBe('acre (based on US survey foot)');
	});

	it('reads SysML usages with prefixes, and skips anonymous elements and comments', () => {
		const text = `package P {
	// part def NotThis;
	/* part def NorThis; */
	//* part def NorThat; */
	#derivation connection def Derive { end #original ref part a; }
	perform action launch;
	then action climb { in speed : Real; }
	exhibit state modes;
	use case def Deliver;
	include use case deliver : Deliver;
	part : Engine;
	satisfy R by system;
	comment Note /* part def NotEvenThis; */
	individual part def Unit1;
	attribute x = "string with ; and { brace";
	requirement <'R-1'> 'Max mass' { doc /* At most 2 kg. */ }
}`;
		expect(brief(text)).toEqual([
			'1 package P',
			'5 connection def P::Derive',
			'5 part P::Derive::a',
			'6 action P::launch',
			'7 action P::climb',
			'7 in P::climb::speed',
			'8 state P::modes',
			'9 use case def P::Deliver',
			'10 use case P::deliver',
			'14 part def P::Unit1',
			'15 attribute P::x',
			"16 requirement P::'Max mass'"
		]);
		expect(scanDeclarations(text).at(-1)).toMatchObject({ shortName: 'R-1', doc: 'At most 2 kg.' });
	});

	it('lists a file’s top-level names and short names', () => {
		expect(topLevelNames('package A { part def B; }\npackage <c> C;\npart def D;')).toEqual([
			'A',
			'C',
			'c',
			'D'
		]);
	});

	it('cleans doc comments', () => {
		expect(cleanDoc('\n     * First line.\n     * Second line.\n     ')).toBe(
			'First line.\nSecond line.'
		);
		expect(cleanDoc(' Inline. ')).toBe('Inline.');
	});

	it('quotes names that are not identifiers', () => {
		expect(nameSegment('Real')).toBe('Real');
		expect(nameSegment('acre foot')).toBe("'acre foot'");
		expect(nameSegment("it's")).toBe("'it\\'s'");
	});
});
