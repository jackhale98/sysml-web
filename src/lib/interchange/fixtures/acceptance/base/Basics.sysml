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
        enum off;
        enum standby;
        enum active;
    }

    metadata def Safety {
        attribute level : Integer;
    }

    abstract part def Component {
        attribute mass :> ISQ::mass;
        attribute cost : Real;
        attribute serial : String [0..1];
    }

    port def PowerPort {
        out item power : Power;
    }

    port def CommandPort {
        in item command : Command [0..*] ordered nonunique;
    }

    constraint def MassBudget {
        in total : MassValue;
        in limit : MassValue;
        total <= limit
    }

    calc def Sum2 {
        in a : MassValue;
        in b : MassValue;
        return : MassValue = a + b;
    }

    public alias Kilogram for SI::kg;
}
