package DroneComponents {
    doc
    /*
     * The component catalogue. Each `part def` is a definition: it says what a kind of
     * component is - its properties and its ports - like a datasheet. A definition is not
     * part of any drone yet; DroneArchitecture uses these definitions to build one.
     */

    private import ScalarValues::Real;
    private import ISQ::*;
    private import SI::*;
    private import DroneInterfaces::*;
    private import FlightControl::FlightModes;

    abstract part def Component {
        doc /* Anything built into the drone. Every component has a mass, and those that use
             * electricity draw power, so the mass and power budgets can add them up. */
        attribute mass :> ISQ::mass;
        attribute powerDraw :> ISQ::power [0..1] {
            doc /* Electrical power the component draws while the drone hovers. */
        }
    }

    // Each definition below specializes Component (:>) and gives its mass a value (:>> redefines it).

    part def Airframe :> Component {
        doc /* Carbon-fibre body with four folding arms and the landing gear. */
        attribute :>> mass = 650 [g];
        attribute diagonal :> length = 650 [mm] { doc /* Motor-to-motor distance across the frame. */ }
    }

    part def Battery :> Component {
        doc /* Six-cell lithium-ion pack with a built-in battery management system. */
        attribute :>> mass default 1100 [g];  // defaults: another pack can have its own (see BatteryTrade)
        attribute nominalVoltage :> voltage default 21.6 [V];
        attribute capacity :> energy default 216 [W*h];
        attribute usableFraction : Real default 0.85 { doc /* Share of the capacity used in flight; the rest is the landing reserve. */ }
        attribute usableEnergy :> energy = capacity * usableFraction;
        attribute price : Real default 420.0 { doc /* Purchase price per pack, in euros. */ }
        port powerOut : PowerPort;
    }

    part def PowerDistributionBoard :> Component {
        doc /* Splits battery power between the rotors and the avionics. */
        attribute :>> mass = 40 [g];
        attribute :>> powerDraw = 2 [W] { doc /* Heat lost in the board and the wiring. */ }
        port powerIn : ~PowerPort;
        port rotorPower : PowerPort;
        port avionicsPower : PowerPort;
    }

    part def Rotor :> Component {
        doc /* One propulsion unit: speed controller, motor and propeller, replaced as one unit.
             * Its mass and its power draw add up those of its own parts. */
        attribute :>> mass = esc.mass + motor.mass + propeller.mass;
        attribute :>> powerDraw = esc.powerDraw + motor.powerDraw;
        attribute spin : RotorSpin;
        port powerIn : ~PowerPort;
        port control : ~MotorControlPort;

        part esc : SpeedController;
        part motor : Motor;
        part propeller : Propeller;

        bind powerIn = esc.powerIn;     // the rotor's ports are the speed controller's ports
        bind control = esc.control;
        connect esc to motor;           // three motor phase wires
        connect motor to propeller;     // shaft and hub
    }

    enum def RotorSpin {
        doc /* Which way a rotor turns, seen from above. Opposite spins cancel each other's torque. */
        clockwise;
        counterClockwise;
    }

    part def SpeedController :> Component {
        doc /* Turns battery power into motor current at the commanded speed. */
        attribute :>> mass = 35 [g];
        attribute :>> powerDraw = 3 [W] { doc /* Switching losses at hover throttle. */ }
        port powerIn : ~PowerPort;
        port control : ~MotorControlPort;
    }

    part def Motor :> Component {
        doc /* Brushless outrunner motor. */
        attribute :>> mass = 120 [g];
        attribute :>> powerDraw = 92 [W] { doc /* At hover thrust with the full take-off mass. */ }
        attribute maxPower :> power = 450 [W];
    }

    part def Propeller :> Component {
        doc /* Two-blade carbon-fibre propeller with a low-noise tip. */
        attribute :>> mass = 25 [g];
        attribute diameter :> length = 380 [mm];
    }

    part def FlightController :> Component {
        doc /* The drone's computer: keeps it stable, navigates, and decides when to return home
             * or land. It also powers the small avionics (receiver, radio, camera, latch). */
        attribute :>> mass = 40 [g];
        attribute :>> powerDraw = 6 [W];
        port powerIn : ~PowerPort;
        port motorControl : MotorControlPort;
        port navigation : ~NavigationPort;
        port commandLink : ~CommandLinkPort;
        port imageIn : ~ImagePort;
        port releaseControl : ReleaseControlPort;

        exhibit state flightModes : FlightModes;
    }

    part def GnssReceiver :> Component {
        doc /* Satellite navigation receiver (GPS and Galileo) with a compass. */
        attribute :>> mass = 30 [g];
        attribute :>> powerDraw = 1 [W];
        port navigation : NavigationPort;
    }

    part def TelemetryRadio :> Component {
        doc /* Radio modem: passes commands from the ground station to the flight controller,
             * and telemetry back. */
        attribute :>> mass = 30 [g];
        attribute :>> powerDraw = 4 [W] { doc /* Transmitting telemetry once a second. */ }
        attribute range :> distance = 8 [km];
        port airLink : ~CommandLinkPort;        // towards the ground station
        port controllerLink : CommandLinkPort;  // towards the flight controller
    }

    part def Camera :> Component {
        doc /* Downward-looking camera used to check that the drop zone is clear. */
        attribute :>> mass = 60 [g];
        attribute :>> powerDraw = 3 [W];
        port imageOut : ImagePort;
    }

    part def PayloadRelease :> Component {
        doc /* Motorised latch under the body that holds the parcel and lets it go on command. */
        attribute :>> mass = 100 [g];
        attribute :>> powerDraw = 1 [W] { doc /* Holding the latch closed. */ }
        port releaseControl : ~ReleaseControlPort;
        item parcel : Parcel[0..1];  // empty on the way home
    }
}
