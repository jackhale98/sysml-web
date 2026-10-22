package RiskAnalysis {
    doc
    /*
     * FMEA (failure mode and effects analysis) for SysML v2. Each way
     * something can fail is one @Fmea line, attached to the element that
     * fails, with its effect, its cause and three ratings.
     *
     * One line serves three kinds of FMEA, told apart by its `category`:
     *   design   (DFMEA) - a part can fail: the line is about a part or a
     *                      part def;
     *   process  (PFMEA) - a process step can go wrong: about an action;
     *   'use'    (uFMEA) - a user can make a use error, or misuse the
     *                      product in a foreseeable way (IEC 62366): about
     *                      a user task (an action) or a use case;
     *   software          - a software item can fail (a design FMEA of
     *                      software).
     * DesignFmeaWorksheet, ProcessFmeaWorksheet and UseFmeaWorksheet show
     * one kind each; FmeaWorksheet shows every line.
     *
     * The ratings follow the AIAG-VDA FMEA handbook (2019), each 1 to 10:
     *   severity   (S): how bad the effect is - 1 no noticeable effect,
     *                   10 affects safety or breaks a regulation;
     *   likelihood (O, "occurrence"): how likely the cause is - 1 extremely
     *                   unlikely, 10 almost certain;
     *   detection  (D): how likely the failure is to go unnoticed before it
     *                   reaches the user - 1 always caught, 10 cannot be
     *                   detected.
     * Figures are calculated from them, never typed in:
     *   Rpn            - severity x likelihood x detection (1 to 1000);
     *   RpnBand        - low, medium, high or critical: where the RPN falls
     *                    among the thresholds the calc states;
     *   ActionPriority - high, medium or low: the AIAG-VDA table, which
     *                    weighs severity first;
     *   Acceptability  - acceptable, reduce or unacceptable: the
     *                    organisation's risk policy (ISO 14971), by
     *                    severity and likelihood, which colours the risk
     *                    matrix.
     * The worksheets show the RPN and the action priority both; their
     * `sortBy` says which one they lead with.
     * severity, likelihood and detection are the assessment now, with the
     * controls in place; initialSeverity, initialLikelihood and
     * initialDetection keep the assessment before risk reduction, so the
     * reduction shows (FmeaRiskReduction).
     *
     * Hazard analysis (HazardAnalysis) drives severity: a line's `hazard`
     * names the hazard its failure can lead to, the harms at the end of
     * that hazard's Causation chain carry a SeverityScale class, and a line
     * whose severity is not the worst of those harms' values is flagged.
     *
     * Risk controls are requirements (HazardAnalysis::RiskControl); what
     * implements one `satisfy`s it and a verification case `verify`s it, so
     * ordinary traceability shows which risks lack a verified control. A
     * line names the controls that address it (`riskControls`) and the
     * Mitigation actions that lower it (`mitigations`); a line of high
     * action priority, or of unacceptable risk, without a verified control
     * is flagged for review.
     */

    private import ScalarValues::*;
    private import HazardAnalysis::*;
    private import Reporting::*;

    attribute def FmeaRating :> Integer {
        doc /* A rating on the AIAG-VDA scale of 1 to 10. A value outside it is flagged. */
        assert constraint inRange { that >= 1 and that <= 10 }
    }

    calc def Rpn {
        doc
        /*
         * Risk priority number: severity x likelihood x detection, from 1
         * to 1000. Thresholds on it are a company's choice (RpnBand);
         * AIAG-VDA recommends ActionPriority instead.
         */
        in severity : FmeaRating;
        in likelihood : FmeaRating;
        in detection : FmeaRating;
        return : Integer = severity * likelihood * detection;
    }

    enum def RpnBandLevel {
        doc /* Where a risk priority number falls, lowest first. */
        enum low;
        enum medium;
        enum high;
        enum critical;
    }

    calc def RpnBand {
        doc
        /*
         * The band of a risk priority number: each band starts at its
         * threshold below (by default 1-50 low, 51-150 medium, 151-400
         * high, 401 and above critical). The thresholds are the
         * organisation's choice: change the numbers here, or with the
         * app's Risk policy form.
         */
        in rpn : Integer;
        attribute mediumFrom : Integer = 51;
        attribute highFrom : Integer = 151;
        attribute criticalFrom : Integer = 401;
        return : RpnBandLevel =
            if rpn >= criticalFrom ? RpnBandLevel::critical
            else if rpn >= highFrom ? RpnBandLevel::high
            else if rpn >= mediumFrom ? RpnBandLevel::medium
            else RpnBandLevel::low;
    }

    enum def ActionPriorityLevel {
        doc
        /*
         * How urgently a line needs action (AIAG-VDA): high - act to lower
         * the risk, or justify why not; medium - act, or justify; low -
         * act if it is cheap to.
         */
        enum low;
        enum medium;
        enum high;
    }

    calc def ActionPriority {
        doc
        /*
         * The AIAG-VDA action priority table (2019) for design and process
         * FMEA, as bands of severity, then likelihood, then detection.
         * Severity 1 is always low.
         */
        in severity : FmeaRating;
        in likelihood : FmeaRating;
        in detection : FmeaRating;
        return : ActionPriorityLevel =
            if severity >= 9 ?
                (if likelihood >= 6 ? ActionPriorityLevel::high
                 else if likelihood >= 4 ? (if detection >= 2 ? ActionPriorityLevel::high else ActionPriorityLevel::medium)
                 else if likelihood >= 2 ? (if detection >= 7 ? ActionPriorityLevel::high
                                            else if detection >= 5 ? ActionPriorityLevel::medium
                                            else ActionPriorityLevel::low)
                 else ActionPriorityLevel::low)
            else if severity >= 7 ?
                (if likelihood >= 8 ? ActionPriorityLevel::high
                 else if likelihood >= 6 ? (if detection >= 2 ? ActionPriorityLevel::high else ActionPriorityLevel::medium)
                 else if likelihood >= 4 ? (if detection >= 7 ? ActionPriorityLevel::high else ActionPriorityLevel::medium)
                 else if likelihood >= 2 ? (if detection >= 5 ? ActionPriorityLevel::medium else ActionPriorityLevel::low)
                 else ActionPriorityLevel::low)
            else if severity >= 4 ?
                (if likelihood >= 8 ? (if detection >= 5 ? ActionPriorityLevel::high else ActionPriorityLevel::medium)
                 else if likelihood >= 6 ? (if detection >= 2 ? ActionPriorityLevel::medium else ActionPriorityLevel::low)
                 else if likelihood >= 4 ? (if detection >= 7 ? ActionPriorityLevel::medium else ActionPriorityLevel::low)
                 else ActionPriorityLevel::low)
            else if severity >= 2 ?
                (if likelihood >= 8 and detection >= 5 ? ActionPriorityLevel::medium else ActionPriorityLevel::low)
            else ActionPriorityLevel::low;
    }

    // --- Risk policy: which risks are acceptable --------------------------------

    enum def RiskAcceptability {
        doc
        /*
         * How acceptable a risk is (ISO 14971), lowest first:
         *   acceptable   - no further reduction needed;
         *   reduce       - reduce it as far as possible, then weigh what
         *                  remains against the benefit;
         *   unacceptable - reduce it before release.
         */
        enum acceptable;
        enum reduce;
        enum unacceptable;
    }

    calc def Acceptability {
        doc
        /*
         * The risk policy: how acceptable a risk is, by its severity and
         * its likelihood (the zones of the risk matrix). It is the
         * organisation's choice; change it here or with the app's Risk
         * policy form. In plain words:
         *   severity 9 to 10: unacceptable at likelihood 4 to 10, reduce at 2 to 3, acceptable at 1;
         *   severity 7 to 8: unacceptable at likelihood 6 to 10, reduce at 3 to 5, acceptable at 1 to 2;
         *   severity 4 to 6: unacceptable at likelihood 8 to 10, reduce at 5 to 7, acceptable at 1 to 4;
         *   severity 2 to 3: reduce at likelihood 8 to 10, acceptable at 1 to 7;
         *   severity 1: acceptable.
         */
        in severity : FmeaRating;
        in likelihood : FmeaRating;
        return : RiskAcceptability =
            if severity >= 9 ?
                (if likelihood >= 4 ? RiskAcceptability::unacceptable
                 else if likelihood >= 2 ? RiskAcceptability::reduce
                 else RiskAcceptability::acceptable)
            else if severity >= 7 ?
                (if likelihood >= 6 ? RiskAcceptability::unacceptable
                 else if likelihood >= 3 ? RiskAcceptability::reduce
                 else RiskAcceptability::acceptable)
            else if severity >= 4 ?
                (if likelihood >= 8 ? RiskAcceptability::unacceptable
                 else if likelihood >= 5 ? RiskAcceptability::reduce
                 else RiskAcceptability::acceptable)
            else if severity >= 2 ?
                (if likelihood >= 8 ? RiskAcceptability::reduce
                 else RiskAcceptability::acceptable)
            else RiskAcceptability::acceptable;
    }

    enum def RiskCategory {
        doc /* The kind of FMEA a line belongs to: what fails (see the package's doc). */
        enum design;
        enum process;
        enum 'use';
        enum software;
    }

    enum def MitigationKind {
        doc
        /*
         * prevention makes the cause less likely; detection makes the
         * failure more likely to be caught before it causes harm.
         */
        enum prevention;
        enum detection;
    }

    enum def MitigationStatus {
        doc /* Where a mitigation action stands. */
        enum proposed;
        enum inProgress;
        enum completed;
        enum verified;
    }

    metadata def Fmea {
        doc
        /*
         * One FMEA worksheet line, attached to the element whose failure
         * it analyses:
         *
         *   @Fmea about drone::battery {
         *       failureMode = "Thermal runaway";
         *       effect = "Fire; loss of the drone";
         *       cause = "Internal short from dendrite growth";
         *       category = RiskCategory::design;
         *       severity = 8; likelihood = 3; detection = 4;
         *   }
         *
         * For a use FMEA, failureMode is the use error and the element the
         * user task. The ratings are FmeaRatings (1 to 10); Rpn, RpnBand,
         * ActionPriority and Acceptability are calculated from them.
         */
        attribute failureMode : String;
        attribute effect : String[0..1];
        attribute cause : String[0..1];
        attribute category : RiskCategory default RiskCategory::design;
        attribute severity : FmeaRating;
        attribute likelihood : FmeaRating;
        attribute detection : FmeaRating;
        attribute preventionControls : String[0..1] {
            doc /* What is in place to stop the cause (it justifies the likelihood rating). */
        }
        attribute detectionControls : String[0..1] {
            doc /* What is in place to catch the failure (it justifies the detection rating). */
        }
        attribute initialSeverity : FmeaRating[0..1];
        attribute initialLikelihood : FmeaRating[0..1];
        attribute initialDetection : FmeaRating[0..1];
        ref hazard : Hazard[0..1] {
            doc
            /*
             * The HazardAnalysis::Hazard this failure can lead to - a model
             * reference, so a hazard's failure modes are found by collecting
             * these. The worst harm the hazard leads to (through Causation)
             * sets the severity this line should have.
             */
        }
        ref riskControls : RiskControl[0..*] {
            doc
            /*
             * The risk controls (requirements) that address this line:
             * `riskControls = 'RC-001';` or `riskControls = ('RC-001', 'RC-002');`.
             * Whether each is satisfied and verified comes from ordinary
             * `satisfy` and `verify` traceability. The free-text
             * preventionControls and detectionControls stay the controls
             * in place, as AIAG-VDA writes them.
             */
        }
        ref mitigations : Mitigation[0..*] {
            doc /* The Mitigation actions that lower this line's risk, with their status. */
        }
    }

    occurrence def FailureMode :> RiskEvent {
        doc
        /*
         * A way an element can fail, as an element of its own rather than
         * an @Fmea line: use it when the failure itself takes part in a
         * causal chain (Causation from a failure mode to a hazard).
         */
        attribute cause : String[0..1];
        attribute effect : String[0..1];
        attribute severity : FmeaRating[0..1];
        attribute likelihood : FmeaRating[0..1];
        attribute detection : FmeaRating[0..1];
    }

    action def Mitigation {
        doc
        /*
         * The work that lowers a risk: it implements a
         * HazardAnalysis::RiskControl. Connect it to the control with
         * `satisfy`, and to the evidence that it works with `verify`.
         */
        attribute kind : MitigationKind;
        attribute status : MitigationStatus default MitigationStatus::proposed;
        attribute owner : String[0..1];
    }

    // --- Worksheets: views of the @Fmea lines -------------------------------
    // The figures come right after the failure, so they stay in view on a
    // narrow screen; the effect and the cause follow.

    view def FmeaWorksheet {
        doc /* Every FMEA line, of every kind, highest risk first. */
        @TableRendering {
            rows = "@Fmea";
            columns = "element; failureMode; severity; likelihood; detection; rpn = Rpn(severity, likelihood, detection); rpnBand = RpnBand(Rpn(severity, likelihood, detection)); actionPriority = ActionPriority(severity, likelihood, detection); acceptability = Acceptability(severity, likelihood); riskControls; effect; cause; category";
            sortBy = "-rpn";
        }
    }

    view def DesignFmeaWorksheet :> FmeaWorksheet {
        doc /* A design FMEA: how the parts can fail. */
        @TableRendering {
            rows = "@Fmea";
            columns = "part = element; failureMode; severity; likelihood; detection; rpn = Rpn(severity, likelihood, detection); rpnBand = RpnBand(Rpn(severity, likelihood, detection)); actionPriority = ActionPriority(severity, likelihood, detection); acceptability = Acceptability(severity, likelihood); riskControls; effect; cause";
            where = "category == RiskCategory::design or category == RiskCategory::software";
            sortBy = "-rpn";
        }
    }

    view def ProcessFmeaWorksheet :> FmeaWorksheet {
        doc /* A process FMEA: how the steps of a process can go wrong. */
        @TableRendering {
            rows = "@Fmea";
            columns = "processStep = element; failureMode; severity; likelihood; detection; rpn = Rpn(severity, likelihood, detection); rpnBand = RpnBand(Rpn(severity, likelihood, detection)); actionPriority = ActionPriority(severity, likelihood, detection); acceptability = Acceptability(severity, likelihood); riskControls; effect; cause";
            where = "category == RiskCategory::process";
            sortBy = "-rpn";
        }
    }

    view def UseFmeaWorksheet :> FmeaWorksheet {
        doc /* A use FMEA: the use errors a user can make in each task, and what follows. */
        @TableRendering {
            rows = "@Fmea";
            columns = "task = element; useError = failureMode; severity; likelihood; detection; rpn = Rpn(severity, likelihood, detection); rpnBand = RpnBand(Rpn(severity, likelihood, detection)); actionPriority = ActionPriority(severity, likelihood, detection); acceptability = Acceptability(severity, likelihood); riskControls; effect; cause";
            where = "category == RiskCategory::'use'";
            sortBy = "-rpn";
        }
    }

    view def FmeaRiskReduction {
        doc
        /*
         * The lines assessed before risk reduction too: their priority and
         * acceptability then and now, and the controls and mitigations that
         * made the difference.
         */
        @TableRendering {
            rows = "@Fmea";
            columns = "element; failureMode; rpnBefore = Rpn(initialSeverity, initialLikelihood, initialDetection); rpn = Rpn(severity, likelihood, detection); priorityBefore = ActionPriority(initialSeverity, initialLikelihood, initialDetection); actionPriority = ActionPriority(severity, likelihood, detection); acceptabilityBefore = Acceptability(initialSeverity, initialLikelihood); acceptability = Acceptability(severity, likelihood); riskControls; controlStatus; mitigations; mitigationStatus";
            where = "initialSeverity >= 1";
            sortBy = "-rpn";
        }
    }

    view def RiskMatrix {
        doc
        /*
         * How many FMEA lines fall in each cell of severity (down) by
         * likelihood (across). Every rating of the scale is a row or a
         * column, so the empty cells show too, and each cell has the zone
         * the risk policy (Acceptability) gives it.
         */
        @TableRendering {
            rows = "@Fmea";
            pivot = "severity; likelihood";
            cellLevel = "Acceptability(severity, likelihood)";
        }
    }
}
