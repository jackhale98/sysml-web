package DroneFmea {
    doc
    /*
     * Risk management of the delivery drone (ISO 14971), using the RiskAnalysis and
     * HazardAnalysis libraries in libraries/.
     *   1. Hazards: what can cause harm; the hazardous situations in which people or
     *      property are exposed to them; the harms that can follow, each with its
     *      severity. Causation links them: hazard -> situation -> harm.
     *   2. Risk controls: requirements saying what the design must do about each hazard,
     *      most effective first: safe by design, protective measures, information for safety.
     *   3. Mitigations: the work that implements a control. What implements a control
     *      `satisfy`s it; a verification case proves it (`verify`, see DroneVerification).
     *   4. The design FMEA: one @Fmea line per failure mode, attached to the component that
     *      fails, with its hazard, the risk controls that address it (`riskControls`), and
     *      its ratings before and after the controls.
     * The risk priority number (RPN = severity x likelihood x detection), its band, the action
     * priority and the acceptability under the risk policy (libraries/RiskAnalysis.sysml) are
     * computed, never typed in.
     */

    private import DroneArchitecture::drone;
    private import HazardAnalysis::*;
    private import RiskAnalysis::*;

    // ---- 1. Hazards, hazardous situations and harms ----

    occurrence batteryFire : Hazard {
        :>> description = "Fire or explosion of the battery pack, in flight or on the ground.";
    }
    occurrence uncontrolledDescent : Hazard {
        :>> description = "Loss of thrust or control, so that the drone falls.";
    }
    occurrence flyAway : Hazard {
        :>> description = "Loss of position or command link, so that the drone leaves its approved area.";
    }
    occurrence propellerContact : Hazard {
        :>> description = "Spinning propellers within reach of a person.";
    }
    occurrence payloadDrop : Hazard {
        :>> description = "The parcel falls from height instead of being lowered at the drop zone.";
    }

    occurrence fireNearPeople : HazardousSituation {
        :>> description = "The battery burns while the drone is over people, or while it charges indoors.";
    }
    occurrence fallOverPeople : HazardousSituation {
        :>> description = "The drone falls while its route passes over people or a road.";
    }
    occurrence outsideApprovedArea : HazardousSituation {
        :>> description = "The drone flies into controlled airspace or over property it may not cross.";
    }
    occurrence handOverWithRotorsTurning : HazardousSituation {
        :>> description = "The recipient reaches for the parcel before the rotors have stopped.";
    }
    occurrence parcelOverPeople : HazardousSituation {
        :>> description = "The parcel comes loose above a person at the drop zone.";
    }

    occurrence burnInjury : Harm {
        :>> description = "Burns to people and fire damage to property.";
        :>> severity = SeverityScale::critical;
    }
    occurrence impactInjury : Harm {
        :>> description = "A person on the ground is hit by the falling drone or parcel.";
        :>> severity = SeverityScale::critical;
    }
    occurrence thirdPartyDamage : Harm {
        :>> description = "Collision with property or other airspace users outside the approved area.";
        :>> severity = SeverityScale::serious;
    }
    occurrence cutInjury : Harm {
        :>> description = "Cuts to the fingers or hand from a propeller.";
        :>> severity = SeverityScale::serious;
    }

    connection : Causation connect batteryFire to fireNearPeople;
    connection : Causation connect fireNearPeople to burnInjury;
    connection : Causation connect uncontrolledDescent to fallOverPeople;
    connection : Causation connect fallOverPeople to impactInjury;
    connection : Causation connect flyAway to outsideApprovedArea;
    connection : Causation connect outsideApprovedArea to thirdPartyDamage;
    connection : Causation connect propellerContact to handOverWithRotorsTurning;
    connection : Causation connect handOverWithRotorsTurning to cutInjury;
    connection : Causation connect payloadDrop to parcelOverPeople;
    connection : Causation connect parcelOverPeople to impactInjury;

    // ---- 2. Risk controls ----

    requirement <'RC-001'> 'Battery thermal protection' : RiskControl {
        doc /* The battery management system shall disconnect the pack and alert the operator
             * before any cell reaches its thermal limit. */
        :>> hierarchy = ControlHierarchy::protectiveMeasure;
        :>> rationale = "Stops a developing thermal event before it spreads to neighbouring cells.";
        ref :>> hazard = batteryFire;
    }

    requirement <'RC-002'> 'Rotor health monitoring' : RiskControl {
        doc /* The flight controller shall monitor the speed and current of every rotor and
             * land at once when one does not follow its command. */
        :>> hierarchy = ControlHierarchy::protectiveMeasure;
        :>> rationale = "A quadcopter cannot stay up on three rotors, so early detection limits the fall.";
        ref :>> hazard = uncontrolledDescent;
    }

    requirement <'RC-003'> 'Navigation integrity monitoring' : RiskControl {
        doc /* The flight controller shall compare the satellite position with its inertial
             * estimate and return home when they differ by more than 10 m. */
        :>> hierarchy = ControlHierarchy::protectiveMeasure;
        :>> rationale = "Detects jamming and spoofing, which the receiver cannot always detect itself.";
        ref :>> hazard = flyAway;
    }

    requirement <'RC-004'> 'Propeller guards' : RiskControl {
        doc /* Each propeller shall turn inside a guard that a finger cannot reach through. */
        :>> hierarchy = ControlHierarchy::inherentSafety;
        :>> rationale = "Removes the hazard at the hand-over instead of relying on people keeping clear.";
        ref :>> hazard = propellerContact;
    }

    requirement <'RC-005'> 'Release height interlock' : RiskControl {
        doc /* The payload hook shall stay mechanically locked while the parcel is more than
             * 2 m above the ground. */
        :>> hierarchy = ControlHierarchy::inherentSafety;
        :>> rationale = "A hook that cannot open at height cannot drop the parcel, whatever the software does.";
        ref :>> hazard = payloadDrop;
    }

    requirement <'RC-006'> 'Hand-over warnings' : RiskControl {
        doc /* The drone shall carry a warning label and sound a tone until its rotors have
             * stopped, and the operator manual shall tell recipients to wait for the tone to end. */
        :>> hierarchy = ControlHierarchy::informationForSafety;
        :>> rationale = "Guards make contact unlikely; people still need to know when it is safe to approach.";
        ref :>> hazard = propellerContact;
    }

    requirement <'RC-007'> 'Drop-zone clearance check' : RiskControl {
        doc /* Before lowering the parcel, the drone shall check with its camera that nobody is
             * within 3 m of the drop point, and hold until the area is clear. */
        :>> hierarchy = ControlHierarchy::protectiveMeasure;
        :>> rationale = "The interlock keeps the hook shut at height; this keeps the parcel away from people below.";
        ref :>> hazard = payloadDrop;
    }

    // ---- 3. Mitigations: the work that implements the controls ----

    action batteryManagementSystem : Mitigation {
        doc /* Integrate a battery management system with cell monitoring and a power cut-off. */
        :>> kind = MitigationKind::prevention;
        :>> status = MitigationStatus::verified;
        :>> owner = "L. Moreau";
    }
    action rotorHealthMonitor : Mitigation {
        doc /* Add rotor speed and current checks to the flight controller software. */
        :>> kind = MitigationKind::detection;
        :>> status = MitigationStatus::verified;
        :>> owner = "R. Tanaka";
    }
    action navigationIntegrityMonitor : Mitigation {
        doc /* Add a satellite-versus-inertial consistency check to the navigation filter. */
        :>> kind = MitigationKind::detection;
        :>> status = MitigationStatus::proposed;
        :>> owner = "R. Tanaka";
    }
    action fitPropellerGuards : Mitigation {
        doc /* Fit ducted guards to the four rotor arms. */
        :>> kind = MitigationKind::prevention;
        :>> status = MitigationStatus::verified;
        :>> owner = "S. Okafor";
    }
    action warningLabelsAndTone : Mitigation {
        doc /* Add the hand-over label, the rotors-turning tone and the recipient's section of the manual. */
        :>> kind = MitigationKind::prevention;
        :>> status = MitigationStatus::completed;
        :>> owner = "J. Hale";
    }
    action dropZoneScan : Mitigation {
        doc /* Detect people in the camera image of the drop zone, and hold the descent until it is clear. */
        :>> kind = MitigationKind::detection;
        :>> status = MitigationStatus::inProgress;
        :>> owner = "R. Tanaka";
    }

    satisfy 'Battery thermal protection' by batteryManagementSystem;
    satisfy 'Rotor health monitoring' by rotorHealthMonitor;
    satisfy 'Navigation integrity monitoring' by navigationIntegrityMonitor;
    satisfy 'Propeller guards' by fitPropellerGuards;
    satisfy 'Release height interlock' by drone.payloadRelease;
    satisfy 'Hand-over warnings' by warningLabelsAndTone;
    satisfy 'Drop-zone clearance check' by dropZoneScan;

    // ---- 4. FMEA worksheet lines ----

    @Fmea about drone::battery {
        failureMode = "Thermal runaway";
        cause = "Internal cell short, overcharge or crash damage";
        effect = "Fire in the airframe; loss of the drone; burns to bystanders";
        category = RiskCategory::design;
        severity = 8; likelihood = 3; detection = 6;
        initialSeverity = 8; initialLikelihood = 6; initialDetection = 8;
        hazard = batteryFire;
        riskControls = 'RC-001';
        mitigations = batteryManagementSystem;
    }

    @Fmea about drone::rotors::motor {
        failureMode = "Motor stops or loses torque";
        cause = "Bearing seizure, winding short or loose connector";
        effect = "One rotor loses thrust; the drone cannot hold altitude and falls";
        category = RiskCategory::design;
        severity = 8; likelihood = 4; detection = 3;
        initialSeverity = 8; initialLikelihood = 4; initialDetection = 8;
        hazard = uncontrolledDescent;
        riskControls = 'RC-002';
    }

    @Fmea about drone::rotors::propeller {
        failureMode = "Blade breaks or comes off";
        cause = "Hitting an obstacle, fatigue, or a badly tightened hub";
        effect = "Thrust imbalance and vibration; the drone falls";
        category = RiskCategory::design;
        severity = 8; likelihood = 3; detection = 4;
        hazard = uncontrolledDescent;
        riskControls = 'RC-002';
    }

    @Fmea about drone::rotors::propeller {
        failureMode = "Propeller strikes the recipient's hand";
        cause = "The recipient reaches for the parcel while the rotors still turn";
        effect = "Cuts to the fingers or hand";
        category = RiskCategory::design;
        severity = 6; likelihood = 3; detection = 4;
        initialSeverity = 6; initialLikelihood = 7; initialDetection = 8;
        preventionControls = "Rotors stop 2 s after touchdown";
        hazard = propellerContact;
        riskControls = ('RC-004', 'RC-006');
    }

    @Fmea about drone::flightController {
        failureMode = "Software lock-up";
        cause = "Unhandled fault or timing overrun in the control loop";
        effect = "Loss of attitude control; the drone falls";
        category = RiskCategory::software;
        severity = 8; likelihood = 2; detection = 5;
        preventionControls = "Hardware watchdog restarts the control loop";
        hazard = uncontrolledDescent;
    }

    @Fmea about drone::gnss {
        failureMode = "Satellite position lost or wrong";
        cause = "Signal blocked by buildings, jamming or spoofing";
        effect = "Position drifts; the drone may leave the approved area";
        category = RiskCategory::design;
        severity = 6; likelihood = 4; detection = 3;
        hazard = flyAway;
        riskControls = 'RC-003';
        mitigations = navigationIntegrityMonitor;
    }

    @Fmea about drone::radio {
        failureMode = "Command link lost";
        cause = "Out of range, interference or a damaged antenna";
        effect = "The operator cannot command the drone; it relies on return-to-home";
        category = RiskCategory::design;
        severity = 6; likelihood = 5; detection = 2;
        hazard = flyAway;
        riskControls = 'RC-003';
    }

    @Fmea about drone::payloadRelease {
        failureMode = "Hook opens in flight";
        cause = "Servo fault, or a release command sent too early";
        effect = "The parcel falls onto whoever is below";
        category = RiskCategory::design;
        severity = 8; likelihood = 2; detection = 3;
        initialSeverity = 8; initialLikelihood = 6; initialDetection = 7;
        hazard = payloadDrop;
        riskControls = 'RC-005';
    }

    @Fmea about drone::camera {
        failureMode = "A person under the drop point is not seen";
        cause = "Low light, glare, or a person under cover";
        effect = "The parcel is lowered onto someone";
        category = RiskCategory::design;
        severity = 8; likelihood = 6; detection = 6;
        initialSeverity = 8; initialLikelihood = 8; initialDetection = 8;
        hazard = payloadDrop;
        riskControls = 'RC-007';
        mitigations = dropZoneScan;
    }
}
