package DroneFmea {
    doc /* Design FMEA of the delivery drone: how components can fail, what that does to people and property, and what mitigates it. */

    private import DroneStructure::*;
    private import HazardAnalysis::*;
    private import RiskAnalysis::*;

    // Hazard analysis: from hazard to harm

    occurrence batteryFire : Hazard {
        :>> description = "Fire or explosion of the battery pack in flight or on the ground.";
    }

    occurrence uncontrolledDescent : Hazard {
        :>> description = "Loss of thrust or attitude control causing the UAV to fall.";
    }

    occurrence flyAway : Hazard {
        :>> description = "Loss of position knowledge or command link causing the UAV to leave its approved area.";
    }

    occurrence burnInjury : Harm {
        :>> description = "Burns to people and fire damage to property.";
        :>> severity = SeverityScale::critical;
    }

    occurrence impactInjury : Harm {
        :>> description = "Injury to a person on the ground struck by the falling UAV.";
        :>> severity = SeverityScale::critical;
    }

    occurrence thirdPartyDamage : Harm {
        :>> description = "Collision with property or other airspace users outside the approved area.";
        :>> severity = SeverityScale::serious;
    }

    connection batteryFireToBurns : Causation connect batteryFire to burnInjury;
    connection descentToImpact : Causation connect uncontrolledDescent to impactInjury;
    connection flyAwayToDamage : Causation connect flyAway to thirdPartyDamage;

    // Risk controls: what the design must do about each hazard

    requirement <'RC-001'> 'Battery thermal protection' : RiskControl {
        doc /* The battery management system shall disconnect the pack and raise an alarm
            before any cell reaches its thermal limit. */
        :>> hierarchy = ControlHierarchy::protectiveMeasure;
        :>> rationale = "Stops a developing thermal event before it can propagate to neighbouring cells.";
        ref :>> hazard = batteryFire;
    }

    requirement <'RC-002'> 'Rotor health monitoring' : RiskControl {
        doc /* The flight controller shall monitor the speed and current of every rotor and
            start an immediate controlled landing when one deviates from its command. */
        :>> hierarchy = ControlHierarchy::protectiveMeasure;
        :>> rationale = "A quadcopter cannot hold altitude after losing a rotor, so the earliest possible detection limits the fall.";
        ref :>> hazard = uncontrolledDescent;
    }

    requirement <'RC-003'> 'Navigation integrity monitoring' : RiskControl {
        doc /* The flight controller shall compare GNSS position with inertial estimates and
            switch to the return-to-home failsafe when they disagree by more than 10 m. */
        :>> hierarchy = ControlHierarchy::protectiveMeasure;
        :>> rationale = "Detects jamming and spoofing, which a GNSS receiver cannot always flag itself.";
        ref :>> hazard = flyAway;
    }

    // Mitigation actions: the work items that implement the risk controls

    action batteryManagementSystem : Mitigation {
        doc /* Integrate a battery management system with cell monitoring and a power cut-off in the pack. */
        :>> kind = MitigationKind::prevention;
        :>> status = MitigationStatus::completed;
        :>> owner = "L. Moreau";
    }

    action rotorHealthMonitor : Mitigation {
        doc /* Add rotor speed and current checks to the flight controller software. */
        :>> kind = MitigationKind::detection;
        :>> status = MitigationStatus::inProgress;
        :>> owner = "R. Tanaka";
    }

    action navigationIntegrityMonitor : Mitigation {
        doc /* Add a GNSS-versus-inertial consistency check to the navigation filter. */
        :>> kind = MitigationKind::detection;
        :>> status = MitigationStatus::proposed;
        :>> owner = "R. Tanaka";
    }

    satisfy 'Battery thermal protection' by batteryManagementSystem;
    satisfy 'Rotor health monitoring' by rotorHealthMonitor;
    satisfy 'Navigation integrity monitoring' by navigationIntegrityMonitor;

    // FMEA worksheet lines

    @Fmea about droneSystem.battery {
        failureMode = "Thermal runaway";
        cause = "Internal cell short, overcharge or mechanical damage in a crash";
        effect = "Fire in the airframe; loss of the UAV; burns to bystanders";
        category = RiskCategory::design;
        severity = 8; likelihood = 3; detection = 6;
        initialSeverity = 8; initialLikelihood = 5; initialDetection = 8;
        hazard = batteryFire;
    }

    @Fmea about droneSystem.propulsionUnits.motor {
        failureMode = "Motor stops or loses torque";
        cause = "Bearing seizure, winding short or connector failure";
        effect = "Loss of thrust on one rotor; the UAV cannot hold altitude and falls";
        category = RiskCategory::design;
        severity = 8; likelihood = 4; detection = 3;
        hazard = uncontrolledDescent;
    }

    @Fmea about droneSystem.propulsionUnits.propeller {
        failureMode = "Blade fracture or detachment";
        cause = "Impact with an obstacle, fatigue or an incorrectly tightened hub";
        effect = "Thrust imbalance and vibration; the UAV falls";
        category = RiskCategory::design;
        severity = 8; likelihood = 3; detection = 4;
        hazard = uncontrolledDescent;
    }

    @Fmea about droneSystem.gnssReceiver {
        failureMode = "Loss or corruption of the GNSS fix";
        cause = "Signal blockage between buildings, jamming or spoofing";
        effect = "Position drift; the UAV may leave the approved area";
        category = RiskCategory::design;
        severity = 6; likelihood = 4; detection = 3;
        hazard = flyAway;
    }

    @Fmea about droneSystem.telemetryRadio {
        failureMode = "Command link lost";
        cause = "Out of range, interference or antenna damage";
        effect = "The operator cannot command the UAV; it relies on its failsafe to return home";
        category = RiskCategory::design;
        severity = 6; likelihood = 5; detection = 2;
        hazard = flyAway;
    }

    @Fmea about droneSystem.flightController {
        failureMode = "Software lock-up";
        cause = "Unhandled fault or timing overrun in the control loop";
        effect = "Loss of attitude control; the UAV falls";
        category = RiskCategory::software;
        severity = 8; likelihood = 2; detection = 5;
        hazard = uncontrolledDescent;
    }
}
