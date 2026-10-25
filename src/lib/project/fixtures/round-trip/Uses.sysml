package Uses {
	// KEEP-20 a second file that refers to the first
	private import Hostile::*;

	part fleet : Vehicle [2..*] {
		attribute :>> rpmLimit = 7000.0;   // KEEP-21 a redefinition
		attribute payload :> ISQ::mass;
	}

	verification def MassCheck {
		subject v : Vehicle;
		objective { verify 'Mass limit'; }
	}

	allocation def EngineToTank;
	allocate fleet.engine to fleet.tank;
}
