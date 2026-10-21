package DroneVerification {
    doc /* Test, analysis and demonstration cases that show the system requirements and risk controls are met. */

    private import DroneFmea::*;
    private import DroneStructure::*;
    private import SystemRequirements::*;
    private import VerificationCases::*;

    verification <'VC-001'> 'Endurance flight test' {
        doc /* Hover and cruise the UAV with a 1 kg payload on a fully charged battery until the
            return-to-home reserve is reached, at sea level and 15 °C, and record the flight time. */
        subject drone :> droneSystem;
        objective { verify 'Flight endurance'; }
        @VerificationMethod { kind = VerificationMethodKind::test; }
    }

    verification <'VC-002'> 'Mass and payload check' {
        doc /* Weigh the UAV with the maximum payload loaded and confirm that the payload bay accepts
            the reference parcel of 250 mm x 200 mm x 150 mm. */
        subject drone :> droneSystem;
        objective {
            verify 'Payload capacity';
            verify 'Maximum take-off mass';
        }
        @VerificationMethod { kind = (VerificationMethodKind::test, VerificationMethodKind::inspect); }
    }

    verification <'VC-003'> 'Wind station-keeping test' {
        doc /* Hold position for 5 minutes in steady wind of 10 m/s with gusts of 14 m/s, and compare
            the logged position error against the 2 m limit. Supported by a simulation of the control loop. */
        subject drone :> droneSystem;
        objective { verify 'Wind tolerance'; }
        @VerificationMethod { kind = (VerificationMethodKind::test, VerificationMethodKind::analyze); }
    }

    verification <'VC-004'> 'Failsafe flight test' {
        doc /* Fly a route that crosses the geofence boundary, then switch off the ground station radio.
            The UAV shall stop at the boundary and, after the link-loss timeout, return home and land. */
        subject drone :> droneSystem;
        objective {
            verify 'Geofencing';
            verify 'Return to home';
        }
        @VerificationMethod { kind = VerificationMethodKind::test; }
    }

    verification <'VC-005'> 'Battery abuse test' {
        doc /* Apply over-current, over-temperature and deep-discharge conditions to the battery on a
            bench and confirm that the output is disconnected within 1 s in every case
            and that no cell reaches its thermal limit. */
        subject drone :> droneSystem;
        objective {
            verify 'Battery protection';
            verify 'Battery thermal protection';
        }
        @VerificationMethod { kind = (VerificationMethodKind::test, VerificationMethodKind::analyze); }
    }

    verification <'VC-006'> 'Link range test' {
        doc /* Measure signal strength and round-trip latency between the ground station and the UAV
            over a 5 km line-of-sight path. */
        subject drone :> droneSystem;
        objective { verify 'Telemetry link'; }
        @VerificationMethod { kind = VerificationMethodKind::test; }
    }
}
