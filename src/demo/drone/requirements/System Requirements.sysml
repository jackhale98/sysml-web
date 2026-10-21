package SystemRequirements {
    doc /* What the UAV shall do, derived from the stakeholder requirements. */

    private import EngineeringBasics::*;
    private import ModelingMetadata::*;
    private import RequirementDerivation::*;

    requirement <'SYS-001'> 'Flight endurance' : EngineeringRequirement {
        doc /* The UAV shall have a flight endurance of at least 30 minutes with a 1 kg payload,
            in still air at sea level and 15 °C. */
        :>> kind = RequirementKind::performance;
        :>> priority = Priority::high;
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::done; owner = "J. Hale"; }
        @Rationale { text = "A 3 km delivery radius needs about 15 minutes round trip; the rest is hover time at the drop point and the reserve."; }
    }

    requirement <'SYS-002'> 'Payload capacity' : EngineeringRequirement {
        doc /* The UAV shall carry a payload of up to 1 kg in a payload bay of at least
            250 mm x 200 mm x 150 mm. */
        :>> kind = RequirementKind::performance;
        :>> priority = Priority::high;
        :>> verificationMethod = (VerificationMethod::test, VerificationMethod::inspection);
        @StatusInfo { status = StatusKind::closed; owner = "J. Hale"; }
    }

    requirement <'SYS-003'> 'Maximum take-off mass' : EngineeringRequirement {
        doc /* The maximum take-off mass of the UAV, including battery and payload, shall not exceed 3.9 kg. */
        :>> kind = RequirementKind::regulatory;
        :>> priority = Priority::high;
        :>> verificationMethod = (VerificationMethod::analysis, VerificationMethod::test);
        @StatusInfo { status = StatusKind::done; owner = "J. Hale"; }
        @Rationale { text = "Class C2 limit is 4 kg; 0.1 kg is kept as margin for design growth."; }
    }

    requirement <'SYS-004'> 'Wind tolerance' : EngineeringRequirement {
        doc /* The UAV shall hold its position to within 2 m in steady wind of up to 10 m/s
            with gusts of up to 14 m/s. */
        :>> kind = RequirementKind::environmental;
        :>> priority = Priority::medium;
        :>> verificationMethod = (VerificationMethod::analysis, VerificationMethod::test);
        @StatusInfo { status = StatusKind::open; owner = "R. Tanaka"; }
    }

    requirement <'SYS-005'> 'Ingress protection' : EngineeringRequirement {
        doc /* The UAV shall provide protection against dust and splashing water of at least
            IP54 as defined in IEC 60529. */
        :>> kind = RequirementKind::environmental;
        :>> priority = Priority::medium;
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::tbc; owner = "L. Moreau"; }
        @Issue { text = "Motor cooling openings may not allow IP54; a spray test on the prototype is needed to confirm the rating."; }
    }

    requirement <'SYS-006'> 'Geofencing' : EngineeringRequirement {
        doc /* The UAV shall not leave an operator-defined geofence and shall hold its position
            at the boundary when a route would cross it. */
        :>> kind = RequirementKind::safety;
        :>> priority = Priority::high;
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::done; owner = "R. Tanaka"; }
    }

    requirement <'SYS-007'> 'Return to home' : EngineeringRequirement {
        doc /* The UAV shall automatically return to its home point and land when the command link
            is lost for more than 3 s, or when the remaining battery energy falls below the energy
            needed to return plus a 20 % reserve. */
        :>> kind = RequirementKind::safety;
        :>> priority = Priority::high;
        :>> verificationMethod = (VerificationMethod::test, VerificationMethod::demonstration);
        @StatusInfo { status = StatusKind::tbr; owner = "R. Tanaka"; }
        @Rationale { text = "A lost link must never leave the UAV flying without a defined outcome."; }
        @Issue { text = "The 3 s link-loss timeout needs confirming against link-quality measurements in urban areas."; }
    }

    requirement <'SYS-008'> 'Battery protection' : EngineeringRequirement {
        doc /* The battery pack shall monitor cell voltage, current and temperature, and shall disconnect
            its output within 1 s of an over-current, over-temperature or deep-discharge condition. */
        :>> kind = RequirementKind::safety;
        :>> priority = Priority::high;
        :>> verificationMethod = (VerificationMethod::test, VerificationMethod::analysis);
        @StatusInfo { status = StatusKind::open; owner = "L. Moreau"; }
        @Rationale { text = "Battery fire is the dominant hazard of the design; see the Design FMEA."; }
    }

    requirement <'SYS-009'> 'Acoustic noise' : EngineeringRequirement {
        doc /* The sound pressure level of the UAV in hover shall not exceed 70 dB(A) at a distance of 10 m. */
        :>> kind = RequirementKind::environmental;
        :>> priority = Priority::low;
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::tbd; owner = "A. Brandt"; }
        @Issue { text = "The limit is a first estimate; the pilot-site agreement may require a lower value."; }
    }

    requirement <'SYS-010'> 'Class C2 conformity' : EngineeringRequirement {
        doc /* The UAV shall meet the product requirements for class C2 of Delegated Regulation (EU) 2019/945,
            including the class label, direct remote identification and user information. */
        :>> kind = RequirementKind::regulatory;
        :>> priority = Priority::high;
        :>> verificationMethod = (VerificationMethod::inspection, VerificationMethod::analysis);
        @StatusInfo { status = StatusKind::open; owner = "A. Brandt"; }
    }

    requirement <'SYS-011'> 'Telemetry link' : EngineeringRequirement {
        doc /* The UAV shall maintain a bidirectional command and telemetry link with the ground station
            at distances of up to 5 km line of sight, with a round-trip latency below 200 ms. */
        :>> kind = RequirementKind::interface;
        :>> priority = Priority::high;
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::done; owner = "K. Novak"; }
    }

    requirement <'SYS-012'> 'Payload release' : EngineeringRequirement {
        doc /* The UAV shall release the payload only on an explicit operator command, and only when it is
            less than 5 m above ground level and its ground speed is below 1 m/s. */
        :>> kind = RequirementKind::functional;
        :>> priority = Priority::high;
        :>> verificationMethod = VerificationMethod::demonstration;
        @StatusInfo { status = StatusKind::open; owner = "K. Novak"; }
    }

    // Derivation: each stakeholder requirement is refined into system requirements.

    #derivation connection {
        end #original ::> StakeholderRequirements::'Parcel delivery';
        end #derive ::> 'Flight endurance';
        end #derive ::> 'Payload capacity';
        end #derive ::> 'Telemetry link';
        end #derive ::> 'Payload release';
    }

    #derivation connection {
        end #original ::> StakeholderRequirements::'Safe operation';
        end #derive ::> 'Geofencing';
        end #derive ::> 'Return to home';
        end #derive ::> 'Battery protection';
    }

    #derivation connection {
        end #original ::> StakeholderRequirements::'Operation in typical weather';
        end #derive ::> 'Wind tolerance';
        end #derive ::> 'Ingress protection';
    }

    #derivation connection {
        end #original ::> StakeholderRequirements::'Regulatory compliance';
        end #derive ::> 'Maximum take-off mass';
        end #derive ::> 'Class C2 conformity';
    }

    #derivation connection {
        end #original ::> StakeholderRequirements::'Low community noise';
        end #derive ::> 'Acoustic noise';
    }
}
