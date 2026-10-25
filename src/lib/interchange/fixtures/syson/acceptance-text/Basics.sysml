/* Shared definitions: quantities with units, ports, enumerations and
 * metadata used by the other files (cross-file references). */
package Basics {
	private import ScalarValues::*;
	private import ISQ::*;
	private import SI::*;
	doc /* Common building blocks for the acceptance model. */
	item def Power;
	item def Command {
		attribute code : Integer;
	}
	enum def Mode {
		off;
		standby;
		active;
	}
	metadata def Safety {
		attribute level : Integer;
	}
	abstract part def Component {
		attribute mass :> ISQBase::mass;
		attribute cost : Real;
		attribute serial : String [0..1];
	}
	port def PowerPort {
		out item power : Power;
	}
	port def CommandPort {
		in item command : Command [0..*];
	}
	constraint def MassBudget {
		in total : MassValue;
		in limit : MassValue;
	}
}