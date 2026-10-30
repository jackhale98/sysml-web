package DroneFaultTree {
    doc
    /*
     * A fault tree for the hazard "uncontrolled descent" of the hazard log (DroneFmea), using
     * the FaultTreeAnalysis library in libraries/. The top event is broken down, through gates,
     * into basic events: a part failing in a given way, or a condition. Each basic event names
     * the part it comes from and, where the design FMEA has a line for it, the failure mode,
     * so the fault tree, the FMEA and the hazard log meet.
     *   - An 'or' gate: the event occurs when any one of its causes does.
     *   - An 'and' gate: only when all of them do (here, a battery low on charge AND a
     *     low-battery return that doesn't trigger).
     *   - The power distribution board feeds both the rotors and the flight controller, so its
     *     failure appears under both: one event with two connections (a repeated event),
     *     counted once.
     * Probabilities are per delivery flight (exposureTime, 30 minutes), from each event's
     * failure rate (p = 1 - e^(-failure rate x time)) or as given. The diagram and the tables
     * are the views droneFallsTree, faultTreeSummary, droneFallsCutSets and droneFallsImportance
     * (views/Views.sysml).
     */

    private import SI::*;
    private import HazardAnalysis::*;
    private import FaultTreeAnalysis::*;
    private import Reliability::FIT;
    private import DroneArchitecture::drone;
    private import DroneFmea::uncontrolledDescent;

    occurrence droneFalls : TopEvent {
        doc /* The drone falls out of the sky during a delivery flight. */
        :>> gate = GateKind::'or';
        ref :>> hazard = uncontrolledDescent;
        :>> exposureTime = 30 [min];
    }

    occurrence lossOfThrust : IntermediateEvent {
        doc /* A rotor stops giving thrust: a quadcopter cannot fly on three. */
        :>> gate = GateKind::'or';
    }
    occurrence lossOfControl : IntermediateEvent {
        doc /* The flight controller stops commanding the rotors. */
        :>> gate = GateKind::'or';
    }
    occurrence batteryRunsFlat : IntermediateEvent {
        doc /* The battery runs out of charge before the drone has landed. */
        :>> gate = GateKind::'and';
    }

    occurrence motorStops : BasicEvent {
        doc /* Any one of the four motors stops: 2000 FIT each, a tenth of a motor's failures. */
        :>> failureRate = 8000 [FIT];
        ref :>> component = drone.rotors.motor;
        :>> failureMode = "Motor stops or loses torque";
    }
    occurrence bladeBreaks : BasicEvent {
        doc /* A blade of any of the four propellers breaks: 500 FIT each. */
        :>> failureRate = 2000 [FIT];
        ref :>> component = drone.rotors.propeller;
        :>> failureMode = "Blade breaks or comes off";
    }
    occurrence escCutsOut : BasicEvent {
        doc /* Any one of the four speed controllers stops driving its motor: 500 FIT each. */
        :>> failureRate = 2000 [FIT];
        ref :>> component = drone.rotors.esc;
    }
    occurrence boardFails : BasicEvent {
        doc /* The power distribution board fails: its whole failure rate, from the component. */
        ref :>> component = drone.powerDistribution;
    }
    occurrence controllerLockUp : BasicEvent {
        doc /* The control software locks up and the watchdog does not recover it in time. */
        :>> probability = 1E-6;
        ref :>> component = drone.flightController;
        :>> failureMode = "Software lock-up";
    }
    occurrence lowCharge : BasicEvent {
        doc /* The battery holds less charge than the flight was planned with (ageing, cold). */
        :>> probability = 0.02;
        ref :>> component = drone.battery;
    }
    occurrence returnNotTriggered : BasicEvent {
        doc /* The low-battery return to home does not trigger. */
        :>> probability = 5E-5;
        ref :>> component = drone.flightController;
    }

    connection : Causation connect lossOfThrust to droneFalls;
    connection : Causation connect lossOfControl to droneFalls;
    connection : Causation connect batteryRunsFlat to droneFalls;
    connection : Causation connect motorStops to lossOfThrust;
    connection : Causation connect bladeBreaks to lossOfThrust;
    connection : Causation connect escCutsOut to lossOfThrust;
    connection : Causation connect boardFails to lossOfThrust;
    connection : Causation connect boardFails to lossOfControl;
    connection : Causation connect controllerLockUp to lossOfControl;
    connection : Causation connect lowCharge to batteryRunsFlat;
    connection : Causation connect returnNotTriggered to batteryRunsFlat;
}
