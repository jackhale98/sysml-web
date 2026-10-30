package DroneReliability {
    doc
    /*
     * How often the drone may fail, and the budget that checks it. Each component has a
     * failure rate (in FIT: failures in 10^9 hours, see DroneComponents); the reliability
     * budget adds them up the parts tree, each times how many there are. The drone fails
     * when any of its parts does (they are in series), so its failure rate is the sum, and
     * its mean time between failures (MTBF) is one over that. The budget is the view
     * droneReliabilityBudget (views/Views.sysml).
     */

    private import SI::*;
    private import ModelingMetadata::*;
    private import Reliability::*;
    private import DroneArchitecture::drone;

    requirement <'REL-001'> 'Drone reliability' : ReliabilityRequirement {
        doc /* The drone shall have a mean time between failures of at least 2000 flight hours,
             * so that an operator flying 5 hours a day sees fewer than one failure a year. */
        @StatusInfo { status = StatusKind::open; owner = "L. Moreau"; }
        :>> minimumMtbf = 2000 [h];
    }

    satisfy 'Drone reliability' by drone;
}
