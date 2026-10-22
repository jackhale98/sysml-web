package HazardAnalysis {
    doc
    /*
     * Hazard analysis for SysML v2, in the terms of ISO 14971 (and the
     * OMG RAAML Core library):
     *   Hazard             - a potential source of harm (battery fire);
     *   HazardousSituation - when people, property or the environment are
     *                        exposed to it (the drone falls over a crowd);
     *   Harm               - the injury or damage that can follow, with its
     *                        severity (SeverityScale);
     *   Causation          - a connection from a cause to its effect:
     *                        hazard -> situation -> harm;
     *   RiskControl        - a requirement that lowers the risk of a hazard;
     *                        what implements it `satisfy`s it and a
     *                        verification case `verify`s it.
     * The hazard log (HazardLog) lists each hazard with its harms, their
     * severity and its controls.
     *
     *   occurrence batteryFire : Hazard { :>> description = "..."; }
     *   occurrence burns : Harm { :>> severity = SeverityScale::critical; }
     *   connection : Causation connect batteryFire to burns;
     *   requirement <'RC-001'> 'Thermal protection' : RiskControl {
     *       :>> hierarchy = ControlHierarchy::protectiveMeasure;
     *       ref :>> hazard = batteryFire;
     *   }
     *
     * Hazard analysis is top-down and drives the bottom-up FMEA
     * (RiskAnalysis): an FMEA line names the hazard its failure can lead
     * to, and its severity comes from the worst harm of that hazard, so
     * severity is stated once, on the harm, and checked everywhere. Use
     * errors (IEC 62366) lead to hazards the same way, from a use FMEA.
     *
     * RAAML 1.0 is a SysML v1 profile; this package says its Core concepts
     * in SysML v2 (Situation is HazardousSituation, ControllingMeasure is
     * RiskControl, the causal relationship is Causation).
     */

    private import ScalarValues::*;
    private import Reporting::*;

    abstract occurrence def RiskEvent {
        doc
        /*
         * Base for everything that can appear in a causal risk chain:
         * hazards, hazardous situations, harms, and (in RiskAnalysis)
         * failure modes. Causation connects RiskEvents.
         */
    }

    enum def SeverityScale :> Integer {
        doc
        /*
         * How severe a harm is, each class with its value on the FMEA
         * severity scale (1 to 10), so hazard analysis and FMEA share one
         * scale:
         *   negligible   (2): inconvenience or temporary discomfort
         *   minor        (4): temporary injury not requiring intervention
         *   serious      (6): injury requiring professional intervention
         *   critical     (8): permanent impairment or major property loss
         *   catastrophic (10): loss of life
         * An @Fmea line whose hazard leads to harms should have the worst
         * of their values as its severity; tools flag a line that has not.
         */
        negligible = 2;
        minor = 4;
        serious = 6;
        critical = 8;
        catastrophic = 10;
    }

    attribute def ProbabilityLevel :> Real {
        doc /* A probability in the closed interval 0.0 to 1.0. */
        assert constraint unitInterval { that >= 0.0 and that <= 1.0 }
    }

    occurrence def Harm :> RiskEvent {
        doc
        /*
         * Physical injury or damage to health, property, or the
         * environment (ISO 14971). Carries the severity classification
         * that downstream analyses derive from.
         */
        attribute description : String[0..1];
        attribute severity : SeverityScale;
    }

    occurrence def Hazard :> RiskEvent {
        doc /* A potential source of harm (ISO 14971). */
        attribute description : String[0..1];
    }

    occurrence def HazardousSituation :> RiskEvent {
        doc
        /*
         * A circumstance in which people, property, or the environment
         * are exposed to one or more hazards (ISO 14971).
         *
         * p1: probability that the situation arises
         * p2: probability that the situation leads to the harm
         * Overall probability of harm = p1 * p2 (HarmProbability calc).
         */
        attribute description : String[0..1];
        attribute p1 : ProbabilityLevel[0..1];
        attribute p2 : ProbabilityLevel[0..1];
    }

    connection def Causation {
        doc
        /*
         * Directed causal link between risk events: the cause contributes
         * to bringing about the effect. Chains typically run
         *   FailureMode -> Hazard -> HazardousSituation -> Harm.
         * These links are also the substrate for future fault tree
         * analysis (an FTA is this causation graph plus gate semantics).
         */
        end cause : RiskEvent;
        end effect : RiskEvent;
    }

    calc def HarmProbability {
        doc /* Probability of harm for a hazardous situation: p1 * p2. */
        in p1 : ProbabilityLevel;
        in p2 : ProbabilityLevel;
        return : Real = p1 * p2;
    }

    enum def ControlHierarchy {
        doc
        /*
         * The ISO 14971 kinds of risk control, most effective first:
         *   inherentSafety       - safe by design: the hazard is removed or
         *                          made smaller;
         *   protectiveMeasure    - a guard, alarm or monitor in the product
         *                          (or in how it is made);
         *   informationForSafety - warnings, instructions and training.
         * Prefer the first that is possible.
         */
        enum inherentSafety;
        enum protectiveMeasure;
        enum informationForSafety;
    }

    requirement def RiskControl {
        doc
        /*
         * A risk-control obligation (RAAML: ControllingMeasure): a
         * requirement whose satisfaction reduces the probability or
         * severity of a harm. Specialize or instantiate it, `satisfy` it
         * by the design element implementing the control, and `verify` it
         * with the evidence. RiskAnalysis::Mitigation actions are the
         * work items that implement RiskControls.
         */
        attribute hierarchy : ControlHierarchy;
        attribute rationale : String[0..1];
        ref hazard : Hazard[0..1] {
            doc
            /*
             * The Hazard this control addresses - the control side of
             * the audit trail (harm carries the severity, Causation
             * carries the chain, this ref closes control -> hazard).
             * A real model reference: tools list a hazard's controls
             * by collecting these refs.
             */
        }
    }

    view def HazardLog {
        doc
        /*
         * One row per hazard, with its causal chain and its controls: the
         * hazardous situations and harms it leads to (through Causation),
         * the worst harm's severity, the risk controls whose `hazard` names
         * it, and what implements (`satisfy`) and proves (`verify`) them.
         * An empty cell is a gap.
         */
        @TableRendering {
            rows = "hazards";
            columns = "hazard = element; description; harms; severity; controls; satisfiedBy; verifiedBy";
            sortBy = "-severityValue";
        }
    }
}
