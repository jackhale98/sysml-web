package StakeholderRequirements {
    doc /* What the people who operate, regulate and live near the delivery drone need from it. */

    private import EngineeringBasics::*;
    private import ModelingMetadata::*;

    requirement <'STK-001'> 'Parcel delivery' : EngineeringRequirement {
        doc /* The operator shall be able to deliver parcels of up to 1 kg to customers
            within 3 km of the depot and return to the depot in a single flight. */
        :>> kind = RequirementKind::functional;
        :>> priority = Priority::high;
        :>> verificationMethod = VerificationMethod::demonstration;
        @StatusInfo { status = StatusKind::done; owner = "M. Okafor"; originator = "Operations"; }
    }

    requirement <'STK-002'> 'Safe operation' : EngineeringRequirement {
        doc /* The drone shall not endanger people on the ground, other airspace users
            or property, including when a failure occurs in flight. */
        :>> kind = RequirementKind::safety;
        :>> priority = Priority::high;
        :>> verificationMethod = (VerificationMethod::analysis, VerificationMethod::test);
        @StatusInfo { status = StatusKind::open; owner = "S. Lindqvist"; originator = "Safety Office"; }
        @Rationale { text = "Flights over populated areas are only approved when the residual risk is acceptable to the authority."; }
    }

    requirement <'STK-003'> 'Operation in typical weather' : EngineeringRequirement {
        doc /* The operator shall be able to fly deliveries in light rain and moderate wind
            so that most scheduled delivery days are flyable. */
        :>> kind = RequirementKind::environmental;
        :>> priority = Priority::medium;
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::tbr; owner = "M. Okafor"; originator = "Operations"; }
        @Issue { text = "The target share of flyable days has not yet been agreed with Operations."; }
    }

    requirement <'STK-004'> 'Regulatory compliance' : EngineeringRequirement {
        doc /* The drone shall meet the European product requirements for a class C2 unmanned aircraft
            so that the operator can obtain operational approval for delivery flights. */
        :>> kind = RequirementKind::regulatory;
        :>> priority = Priority::high;
        :>> verificationMethod = (VerificationMethod::inspection, VerificationMethod::analysis);
        @StatusInfo { status = StatusKind::done; owner = "A. Brandt"; originator = "Compliance"; }
    }

    requirement <'STK-005'> 'Low community noise' : EngineeringRequirement {
        doc /* The drone shall not cause noise complaints from residents along the delivery routes. */
        :>> kind = RequirementKind::environmental;
        :>> priority = Priority::low;
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::open; owner = "A. Brandt"; originator = "Community Relations"; }
        @Rationale { text = "Community acceptance is a condition of the pilot-site agreement."; }
    }
}
