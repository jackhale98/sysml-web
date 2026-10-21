package DroneAllocation {
    doc /* Which component satisfies which system requirement. */

    private import DroneStructure::*;
    private import SystemRequirements::*;

    satisfy 'Flight endurance' by droneSystem.battery;
    satisfy 'Payload capacity' by droneSystem.airframe;
    satisfy 'Maximum take-off mass' by droneSystem;
    satisfy 'Wind tolerance' by droneSystem.flightController;
    satisfy 'Geofencing' by droneSystem.flightController;
    satisfy 'Geofencing' by droneSystem.gnssReceiver;
    satisfy 'Return to home' by droneSystem.flightController;
    satisfy 'Battery protection' by droneSystem.battery;
    satisfy 'Telemetry link' by droneSystem.telemetryRadio;
    satisfy 'Payload release' by droneSystem.payloadRelease;

    // Deliberately not allocated yet: 'Ingress protection', 'Acoustic noise' and 'Class C2 conformity'.
}
