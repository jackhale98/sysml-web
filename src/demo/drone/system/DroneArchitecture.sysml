package DroneArchitecture {
    doc
    /*
     * Our delivery drone design.
     *   DeliveryDrone (a definition) says what any delivery drone offers: the properties
     *   the requirements talk about and the mission it performs.
     *   drone (a usage of DeliveryDrone) is our actual design: which catalogue components
     *   it is built from, how many of each, and how they are connected.
     */

    private import ISQ::*;
    private import SI::*;
    private import NumericalFunctions::sum;
    private import ControlFunctions::collect;
    private import DroneComponents::*;
    private import DroneInterfaces::*;
    private import DeliveryMission::DeliveryFlight;
    private import DronePerformance::HoverEndurance;

    part def DeliveryDrone {
        doc /* Any drone that can do our delivery job. */
        attribute emptyMass :> mass;
        attribute payloadCapacity :> mass;
        attribute takeOffMass :> mass = emptyMass + payloadCapacity;
        attribute hoverPower :> power;
        attribute endurance :> duration;

        port commandLink : ~CommandLinkPort;
        perform action deliveryFlight : DeliveryFlight;
    }

    part drone : DeliveryDrone {
        doc /* Our design: a quadcopter built from catalogue components. */

        // The parts.
        part airframe : Airframe;
        part battery : Battery;
        part powerDistribution : PowerDistributionBoard;
        // Four rotors, named by where they sit; diagonal pairs spin the same way.
        part frontLeft : Rotor { attribute :>> spin = RotorSpin::clockwise; }
        part frontRight : Rotor { attribute :>> spin = RotorSpin::counterClockwise; }
        part rearLeft : Rotor { attribute :>> spin = RotorSpin::counterClockwise; }
        part rearRight : Rotor { attribute :>> spin = RotorSpin::clockwise; }
        // All four as one. [4] is a multiplicity: there are exactly four.
        ref part rotors : Rotor[4] = (frontLeft, frontRight, rearLeft, rearRight);
        part flightController : FlightController;
        part gnss : GnssReceiver;
        part radio : TelemetryRadio;
        part camera : Camera;
        part payloadRelease : PayloadRelease;

        // Power: battery -> distribution board -> each rotor and the flight controller.
        interface batteryPower : PowerSupply connect battery.powerOut to powerDistribution.powerIn;
        interface frontLeftPower : PowerSupply connect powerDistribution.rotorPower to frontLeft.powerIn;
        interface frontRightPower : PowerSupply connect powerDistribution.rotorPower to frontRight.powerIn;
        interface rearLeftPower : PowerSupply connect powerDistribution.rotorPower to rearLeft.powerIn;
        interface rearRightPower : PowerSupply connect powerDistribution.rotorPower to rearRight.powerIn;
        interface avionicsPower : PowerSupply connect powerDistribution.avionicsPower to flightController.powerIn;

        // Commands and telemetry: the drone's link port is the radio's antenna side.
        bind commandLink = radio.airLink;
        interface radioCable : CommandLink connect radio.controllerLink to flightController.commandLink;

        // Sensor and actuator signals.
        flow of MotorCommand from flightController.motorControl.setPoint to frontLeft.control.setPoint;
        flow of MotorCommand from flightController.motorControl.setPoint to frontRight.control.setPoint;
        flow of MotorCommand from flightController.motorControl.setPoint to rearLeft.control.setPoint;
        flow of MotorCommand from flightController.motorControl.setPoint to rearRight.control.setPoint;
        flow of PositionFix from gnss.navigation.fix to flightController.navigation.fix;
        flow of Image from camera.imageOut.image to flightController.imageIn.image;
        flow of ReleaseCommand from flightController.releaseControl.release to payloadRelease.releaseControl.release;

        // Design values. The empty mass is a roll-up of the component masses.
        attribute :>> payloadCapacity = 1 [kg];
        attribute :>> emptyMass = airframe.mass + battery.mass + powerDistribution.mass
            + sum(rotors->collect { in r : Rotor; r.mass }) // each rotor's mass, added up
            + flightController.mass + gnss.mass + radio.mass + camera.mass + payloadRelease.mass;
        attribute :>> hoverPower = 400 [W] {
            doc /* Measured on the thrust stand at full take-off mass. The power budget
                 * (DroneViews::dronePowerBudget) adds up 397 W from the components. */
        }
        attribute :>> endurance = HoverEndurance(battery.usableEnergy, hoverPower);
    }
}
