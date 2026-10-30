package DroneConfigurations {
    doc
    /*
     * One design, several products. A `variation` lists the answers to a choice the
     * design leaves open, each a `variant`; a part typed by one is a variation point.
     * A configuration is a product with every choice made: it specializes the product
     * line and binds each variation point to one of its variants (`part :>> battery = ...`).
     *   droneFamily is our drone with two choices left open: the battery and the radio.
     *   standardDrone and longRangeDrone are two configurations of it.
     * Pick a configuration above the bill of materials, the budgets, the checks or the
     * drone's diagrams to see that product; the variability matrix lists every choice.
     */

    private import ISQ::*;
    private import SI::*;
    private import DroneComponents::*;
    private import DroneArchitecture::drone;
    private import BatteryTrade::batteryOptions;

    // Variation definitions: the batteries and the radios a drone can carry. A part
    // typed by one is a variation point with these variants.
    variation part def BatteryOption :> Battery {
        variant part standardPack : Battery {
            doc /* Today's six-cell lithium-ion pack. */
        }
        variant part longRangePack :> batteryOptions::semiSolidState {
            doc /* The semi-solid-state pack the battery trade study selects. */
        }
    }

    variation part def RadioOption :> TelemetryRadio {
        variant part standardRadio : TelemetryRadio {
            doc /* Today's radio modem: 8 km in line of sight. */
        }
        variant part longRangeRadio : TelemetryRadio {
            doc /* A higher-power modem with a better antenna: 30 km, for 45 g and 5 W more. */
            attribute :>> mass = 75 [g];
            attribute :>> powerDraw = 9 [W];
            attribute :>> range = 30 [km];
        }
    }

    // The product line: our drone, with its battery and its radio left open. Each point
    // redefines the drone's part under a name of its own (`part battery :>> battery`), so the
    // configurations still find it when the drone's part is renamed.
    part droneFamily :> drone {
        doc /* The delivery drone with the choices a customer can make. */
        part battery :>> battery : BatteryOption;
        part radio :>> radio : RadioOption;
    }

    // The configurations: each picks one variant for every variation point.
    part standardDrone :> droneFamily {
        doc /* The drone as it flies today. */
        part :>> battery = BatteryOption::standardPack;
        part :>> radio = RadioOption::standardRadio;
    }

    part longRangeDrone :> droneFamily {
        doc /* Further and longer: the semi-solid-state pack and the long-range radio. */
        part :>> battery = BatteryOption::longRangePack;
        part :>> radio = RadioOption::longRangeRadio;
    }
}
