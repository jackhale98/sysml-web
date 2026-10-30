package Reliability {
    doc
    /*
     * Failure rates and the reliability budget, for SysML v2.
     *
     * A part's failureRate (lambda) is how often it fails while it is in
     * service, as a constant rate: failures per hour (`[h^-1]`), or in FIT
     * (failures in time), failures per 10^9 hours, the unit electronics
     * datasheets and handbooks give (1000 FIT is one failure in a million
     * hours):
     *
     *   part def Motor :> Component {
     *       attribute :>> failureRate = 1500 [FIT];
     *   }
     *
     * The reliability budget (ReliabilityBudget) adds the failure rates up
     * the parts tree, as a mass budget adds masses, each part's times how
     * many there are. That is the failure rate of a series system: one that
     * fails when any of its parts fails, each failing independently at a
     * constant rate. Its mean time between failures is MTBF = 1 / (the sum
     * of the rates). Parts that back each other up are not in series: their
     * failure is a fault tree's AND gate (FaultTreeAnalysis), not a sum.
     *
     * What the system may come to is a ReliabilityRequirement that it
     * `satisfy`s: a most failure rate or a least MTBF, as values, so a
     * person reads them and the budget compares its total with them.
     */

    private import ScalarValues::*;
    private import Quantities::*;
    private import MeasurementReferences::ConversionByConvention;
    private import ISQ::*;
    private import SI::*;
    private import Reporting::*;

    attribute def FailureRateValue :> FrequencyValue {
        doc
        /*
         * How often something fails, per unit of time in service (lambda):
         * a frequency, whose unit is an inverse time (`h^-1`, `FIT`).
         */
    }

    attribute failureRate : FailureRateValue[*] nonunique :> scalarQuantities {
        doc
        /*
         * A failure rate. A part's own: `attribute failureRate :> Reliability::failureRate [0..1];`
         * in its definition, given a value in each kind of part.
         */
    }

    attribute <FIT> failuresInTime : FrequencyUnit {
        doc /* One failure in 10^9 hours of service: 1 FIT = 10^-9 h^-1. */
        :>> unitConversion : ConversionByConvention {
            :>> referenceUnit = Hz;
            :>> conversionFactor = 1E-9 / 3600;
        }
    }

    requirement def ReliabilityRequirement {
        doc
        /*
         * How often the system that satisfies it may fail at most: a
         * failure rate it may not exceed, or a mean time between failures
         * it must reach, or both. The system's failure rate is the sum of
         * its parts' (the reliability budget's total for it), so `satisfy`
         * this by the system and the budget compares the two:
         *
         *   requirement <'SYS-020'> 'Drone reliability' : ReliabilityRequirement {
         *       :>> minimumMtbf = 2000 [h];
         *   }
         *   satisfy 'Drone reliability' by drone;
         *
         * It is an allocation as much as a requirement: satisfied by a
         * subsystem, it is that subsystem's share.
         */
        attribute maximumFailureRate : FailureRateValue[0..1];
        attribute minimumMtbf :> duration [0..1];
    }

    view def ReliabilityBudget {
        doc
        /*
         * How often each part fails (its failure rate), how many there are,
         * and what each assembly and the whole come to in series: the sum
         * of the rates and the mean time between failures, against the
         * reliability requirement each satisfies.
         */
        @TableRendering {
            rows = "reliability:failureRate";
            columns = "path; type; quantity; each; total; share; mtbf; limit; margin; check";
        }
    }
}
