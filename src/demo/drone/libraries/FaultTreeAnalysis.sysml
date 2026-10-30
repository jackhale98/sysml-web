package FaultTreeAnalysis {
    doc
    /*
     * Fault tree analysis (FTA) for SysML v2, in the terms of IEC 61025 and
     * the NUREG-0492 Fault Tree Handbook, built on HazardAnalysis.
     *
     * A fault tree says how an undesired event, the top event, can come
     * about: from which combinations of basic events (a part failing, an
     * error, a condition). Each event above the basic ones has a gate that
     * says how its causes combine:
     *   'and'   - it occurs when all of its causes occur;
     *   'or'    - when any one of them occurs;
     *   atLeast - when at least k of its n causes occur (k out of n, a
     *             voting gate: two of three sensors);
     *   inhibit - when its cause occurs while its condition holds (a
     *             ConditioningEvent among its causes): an 'and' whose
     *             condition is drawn apart.
     *
     * In SysML v2 the events are occurrences and the tree is Causation
     * connections from each cause to its effect, the same links that run
     * from a hazard to its hazardous situations and harms:
     *
     *   occurrence lossOfLift : TopEvent {
     *       :>> gate = GateKind::'or';
     *       ref :>> hazard = uncontrolledDescent;
     *   }
     *   occurrence rotorFails : IntermediateEvent { :>> gate = GateKind::'or'; }
     *   occurrence motorStops : BasicEvent {
     *       :>> failureRate = 1500 [FIT];
     *       ref :>> component = drone.frontLeft.motor;
     *       :>> failureMode = "Motor stops or loses torque";
     *   }
     *   connection : Causation connect rotorFails to lossOfLift;
     *   connection : Causation connect motorStops to rotorFails;
     *
     * Why this shape. A gate is a property of the event above it, not an
     * element of its own: every event above the basic ones has exactly one
     * gate, so `gate` is an attribute of that event, and the tree is the
     * ordinary causal graph the hazard analysis already has, with no gate
     * elements or ports in between. Read in any SysML v2 tool, the events
     * are occurrence usages, each with a value saying how its causes
     * combine, and the tree is connections typed by Causation (cause ->
     * effect); nothing in it is notation only one tool understands. An
     * event that appears under several gates (a repeated event, a common
     * cause) is one occurrence with several connections, so the analysis
     * knows it is the same event. A top event names the hazard it is about
     * (`hazard`), as an FMEA line does, and a basic event the part that
     * fails (`component`) and the failure mode (`failureMode`, as the FMEA
     * line about that part names it), so the fault tree, the FMEA and the
     * hazard log meet.
     *
     * How likely each basic event is over the time it is exposed: its
     * `probability`, or a constant `failureRate` (lambda) and an
     * `exposureTime` (t), from which p = 1 - e^(-lambda t). A basic event
     * without either takes its component's failure rate, and one without an
     * exposure time its top event's (the mission). A top event's
     * probability is worked out from its minimal cut sets (the smallest
     * combinations of basic events that cause it), exactly where it can be;
     * it may be no more than its `tolerableProbability`, else the most the
     * policy (TolerableProbability) allows for the worst harm its hazard
     * leads to.
     */

    private import ScalarValues::*;
    private import ISQ::*;
    private import HazardAnalysis::*;
    private import Reliability::*;
    private import Reporting::*;

    enum def GateKind {
        doc /* How the causes of an event combine (see the package's doc). */
        enum 'and';
        enum 'or';
        enum atLeast;
        enum inhibit;
    }

    abstract occurrence def FaultEvent :> RiskEvent {
        doc /* An event of a fault tree. Causation connects it to the events it causes. */
        attribute description : String[0..1];
    }

    abstract occurrence def GateEvent :> FaultEvent {
        doc
        /*
         * An event that comes about from its causes, as its gate says. For
         * an atLeast gate, k is how many of its causes must occur.
         */
        attribute gate : GateKind default GateKind::'or';
        attribute k : Natural[0..1];
    }

    occurrence def TopEvent :> GateEvent {
        doc
        /*
         * The undesired event a fault tree is about, usually a hazard. Its
         * probability is over its exposureTime (a mission, a year of
         * service), which is also that of its basic events that state none.
         */
        ref hazard : Hazard[0..1] {
            doc /* The HazardAnalysis::Hazard this top event is. */
        }
        attribute tolerableProbability : ProbabilityLevel[0..1] {
            doc /* The most probability the top event may have; without it, TolerableProbability of its hazard's worst harm. */
        }
        attribute exposureTime :> duration [0..1];
    }

    occurrence def IntermediateEvent :> GateEvent {
        doc /* An event between the top event and the basic events. */
    }

    occurrence def BasicEvent :> FaultEvent {
        doc
        /*
         * An event the tree goes no further below: a failure, an error, a
         * condition. Give it a probability, or a failure rate (else its
         * component's) and an exposure time (else its top event's).
         */
        attribute probability : ProbabilityLevel[0..1];
        attribute failureRate : FailureRateValue[0..1];
        attribute exposureTime :> duration [0..1];
        ref component[0..1] {
            doc /* The part whose failure this is (a part usage: `drone.frontLeft.motor`). */
        }
        attribute failureMode : String[0..1] {
            doc /* The failure mode, as the FMEA line about the component names it. */
        }
    }

    occurrence def UndevelopedEvent :> BasicEvent {
        doc /* An event not developed further, for lack of information or need (drawn as a diamond). */
    }

    occurrence def ConditioningEvent :> BasicEvent {
        doc /* The condition of an inhibit gate: its probability is that the condition holds (drawn as an oval). */
    }

    calc def TolerableProbability {
        doc
        /*
         * The policy: the most probability a top event may have, by the
         * worst severity of the harms its hazard leads to (a SeverityScale
         * value), over the top event's exposure time. It is the
         * organisation's choice, like the risk policy; by default:
         *   catastrophic (10): 1E-6;  critical (8): 1E-5;  serious (6): 1E-4;
         *   minor (4): 1E-3;  negligible (2): 1E-2.
         */
        in severity : Integer;
        return : Real =
            if severity >= 10 ? 1E-6
            else if severity >= 8 ? 1E-5
            else if severity >= 6 ? 1E-4
            else if severity >= 4 ? 1E-3
            else 1E-2;
    }

    // --- Views ----------------------------------------------------------------

    view def FaultTreeDiagram {
        doc
        /*
         * The fault tree of each top event it exposes (or of every top
         * event in a package it exposes), top-down: events as boxes, gates
         * as their symbols, basic events as circles, each with its
         * probability.
         */
        render Views::asTreeDiagram;
    }

    view def FaultTreeSummary {
        doc
        /*
         * One row per top event: its hazard, its probability (exact, from
         * the minimal cut sets), the upper bound the cut sets give, the
         * most it may be, and the margin.
         */
        @TableRendering {
            rows = "faultTrees";
            columns = "topEvent = element; hazard; probability; upperBound; tolerable; margin; check; cutSets; smallestCutSet";
        }
    }

    view def MinimalCutSets {
        doc
        /*
         * The minimal cut sets of each top event: the smallest combinations
         * of basic events that cause it, most likely first, with each
         * one's probability and share of the top event's.
         */
        @TableRendering {
            rows = "cutSets";
            columns = "topEvent; rank; order; events; probability; share; components";
            sortBy = "topEvent; rank";
        }
    }

    view def BasicEventImportance {
        doc
        /*
         * How much each basic event matters to its top event:
         * Fussell-Vesely (the share of the top event's probability from cut
         * sets that contain it) and Birnbaum (how much the top event's
         * probability changes between the event certain and impossible).
         */
        @TableRendering {
            rows = "basicEvents";
            columns = "topEvent; event = element; component; failureMode; probability; fussellVesely; birnbaum; inFmea";
            sortBy = "topEvent; rank";
        }
    }
}
