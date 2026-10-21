package DroneCatalog {
    doc /* Component types of the delivery drone: the parts library the structure is built from. */

    private import ISQ::*;
    private import SI::*;
    private import ScalarValues::*;

    // Ports and interfaces

    port def PowerPort {
        doc /* A DC power connection between two components. */
        attribute nominalVoltage :> voltage;
        attribute maxCurrent :> electricCurrent;
    }

    port def DataPort {
        doc /* A digital data connection such as a serial or CAN bus. */
        attribute protocol : String;
    }

    port def MotorDrivePort {
        doc /* Three-phase drive output of an ESC, connected to the motor windings. */
    }

    port def ShaftPort {
        doc /* Mechanical shaft coupling between a motor and a propeller. */
    }

    port def RadioPort {
        doc /* Antenna connection for the radio link to the ground station. */
    }

    interface def PowerInterface {
        doc /* Power supplied from one component to another. */
        end supplier : PowerPort;
        end consumer : PowerPort;
    }

    interface def DataInterface {
        doc /* Data exchanged between two components. */
        end source : DataPort;
        end target : DataPort;
    }

    // Components

    part def Drone {
        doc /* The complete delivery UAV: a quadcopter with a release mechanism for parcels. */
        attribute maxTakeoffMass :> ISQ::mass = 3900 [g];
        attribute payloadCapacity :> ISQ::mass = 1000 [g];
    }

    part def Airframe {
        doc /* Carbon-fibre frame with four arms, the payload bay and the landing gear. */
        attribute mass :> ISQ::mass = 600 [g];
        attribute wheelbase :> length = 550 [mm];
    }

    part def Battery {
        doc /* Six-cell lithium-polymer pack with an integrated battery management system. */
        attribute mass :> ISQ::mass = 1200 [g];
        attribute nominalVoltage :> voltage = 22.2 [V];
        attribute storedEnergy :> energy = 800 [kJ];
        port powerOut : PowerPort;
    }

    part def Motor {
        doc /* Brushless outrunner motor driving one propeller. */
        attribute mass :> ISQ::mass = 115 [g];
        attribute maxPower :> power = 450 [W];
        port drive : MotorDrivePort;
        port shaft : ShaftPort;
    }

    part def Propeller {
        doc /* Two-blade carbon-fibre propeller with low-noise tip profile. */
        attribute mass :> ISQ::mass = 15 [g];
        attribute diameter :> length = 380 [mm];
        port hub : ShaftPort;
    }

    part def ESC {
        doc /* Electronic speed controller converting battery power into motor drive current. */
        attribute mass :> ISQ::mass = 30 [g];
        attribute maxCurrent :> electricCurrent = 40 [A];
        port powerIn : PowerPort;
        port control : DataPort;
        port motorOut : MotorDrivePort;
    }

    part def FlightController {
        doc /* Flight computer running attitude control, navigation and failsafe logic. */
        attribute mass :> ISQ::mass = 45 [g];
        port powerIn : PowerPort;
        port escBus : DataPort;
        port gnssBus : DataPort;
        port radioBus : DataPort;
        port payloadBus : DataPort;
    }

    part def GNSSReceiver {
        doc /* Multi-constellation satellite navigation receiver with compass. */
        attribute mass :> ISQ::mass = 30 [g];
        port dataOut : DataPort;
    }

    part def Camera {
        doc /* Gimbal-less camera used for landing-zone verification. */
        attribute mass :> ISQ::mass = 90 [g];
        port dataOut : DataPort;
    }

    part def PayloadRelease {
        doc /* Servo-driven latch that holds the parcel and releases it on command. */
        attribute mass :> ISQ::mass = 150 [g];
        port control : DataPort;
    }

    part def TelemetryRadio {
        doc /* Long-range radio modem for the command and telemetry link. */
        attribute mass :> ISQ::mass = 40 [g];
        attribute outputPower :> power = 1 [W];
        port dataBus : DataPort;
        port antenna : RadioPort;
    }

    part def PropulsionUnit {
        doc /* One rotor: electronic speed controller, motor and propeller. */
        part esc : ESC;
        part motor : Motor;
        part propeller : Propeller;

        connect esc.motorOut to motor.drive;
        connect motor.shaft to propeller.hub;
    }
}
