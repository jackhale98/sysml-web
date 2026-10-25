// KEEP-01 a line comment before the package
/* KEEP-02 a block comment before the package */
package Hostile {
	doc /* KEEP-03 package doc with tabs	and unicode: µ Ω ✓ — “quotes” */

	private import ScalarValues::*;
	private import ISQ::*;
	private import SI::*;

	metadata def Review {
		attribute reviewer : String;
		attribute approved : Boolean;
	}

	/* KEEP-04 a block comment before a definition */
	abstract part def Base {   // KEEP-05 trailing comment on a header
		attribute mass :> ISQ::mass;
	}

	part def  Engine  :>  Base   {     // KEEP-06 odd spacing
		@Review { reviewer = "A. N. Other"; approved = true; }
		attribute :>> mass = 120 [kg];
		attribute rpm : Real = 3000.0;
		port fuelIn : ~FuelPort;


		// KEEP-07 two blank lines above, a comment inside a body
	}

	part def Tank :> Base{attribute :>> mass=40[kg];port fuelOut:FuelPort;} // KEEP-08 compact

	port def FuelPort { out item fuel : Fuel; }
	item def Fuel;

	#Review part def Gearbox :> Base { attribute :>> mass = 30 [kg]; }

	part def Vehicle {
		part engine : Engine;
		part tank : Tank;
		part gearbox : Gearbox [0..1];
		part wheels : Base [4] ordered nonunique;
		connect tank.fuelOut to engine.fuelIn;   /* KEEP-09 after a connection */
		attribute totalMass :> ISQ::mass = engine.mass + tank.mass;
		attribute rpmLimit : Real default 6000.0;
	}

	comment noteAboutEngine about Engine /* KEEP-10 a named comment about Engine */
	comment /* KEEP-11 an unattached comment */

	alias Motor for Engine;

	variation part def EngineChoice :> Engine {
		variant part petrol : Engine;
		variant part diesel : Engine;
	}

	individual part def TestCar :> Vehicle;

	enum def Colour {
		enum red;
		enum green;
	}

	constraint def MassLimit {
		in m : MassValue;
		m <= 2000 [kg]
	}

	calc def Double {
		in x : Real;
		return : Real = x * 2;
	}

	requirement <'R-1'> 'Mass limit' {
		doc /* KEEP-12 The vehicle shall weigh at most 2 t. */
		subject v : Vehicle;
		require constraint { v.totalMass <= 2000 [kg] }
	}

	requirement <'R-3'> 'Rev limit' {
		subject v : Vehicle;
	}

	part car : Vehicle {
		attribute colour : Colour = Colour::red;
	}
	satisfy 'Mass limit' by car;

	action def Drive {
		action ignite;
		action cruise;
		first ignite then cruise;
	}

	item def Go;
	state def Power {
		entry; then off;
		state off;
		state on;
		transition off_on first off accept Go then on;
	}

	dependency from Tank to Engine;

	part def 'Ünïcödé part';

	part def Annotated {
		attribute x : Real;
		rep inOcl language "ocl" /* KEEP-13 self.x > 0 */
	}
}
// KEEP-14 a trailing comment after the package
