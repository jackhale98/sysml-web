package DroneStructure {
    doc /* The assembled delivery drone: which components are used, how many, and how they are connected. */

    private import DroneCatalog::*;

    part droneSystem : Drone {
        doc /* The delivery UAV as flown: one airframe carrying a battery, four propulsion units and the avionics. */

        part airframe : Airframe;
        part battery : Battery;
        part propulsionUnits : PropulsionUnit[4];
        part flightController : FlightController;
        part gnssReceiver : GNSSReceiver;
        part telemetryRadio : TelemetryRadio;
        part camera : Camera;
        part payloadRelease : PayloadRelease;

        // Power distribution

        interface batteryToEscs : PowerInterface
            connect battery.powerOut to propulsionUnits.esc.powerIn;
        interface batteryToFlightController : PowerInterface
            connect battery.powerOut to flightController.powerIn;

        // Data buses

        interface flightControllerToEscs : DataInterface
            connect flightController.escBus to propulsionUnits.esc.control;
        interface gnssToFlightController : DataInterface
            connect gnssReceiver.dataOut to flightController.gnssBus;
        interface radioToFlightController : DataInterface
            connect telemetryRadio.dataBus to flightController.radioBus;
        interface flightControllerToPayloadRelease : DataInterface
            connect flightController.payloadBus to payloadRelease.control;
    }
}
