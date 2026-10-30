library package ModelViews {
    doc
    /*
     * Standard tables over any SysML v2 model: requirements, coverage gaps,
     * traceability, interfaces, the bill of materials, budgets (mass and
     * power), constraint checks, trade studies and product variants.
     *
     * Each table is an ordinary `view def` whose @TableRendering (from the
     * Reporting library) says which rows to collect and which columns to
     * show, so a tool renders it without knowing anything about it. To
     * look at only part of a model, type a view usage by one of these defs
     * and narrow it with `expose`:
     *
     *   view safetyRequirements : RequirementsTable {
     *       expose SafetyRequirements::*;
     *   }
     *
     * `expose P::*` keeps the members of P, `expose P::**` everything
     * nested in P, and `filter @SysML::PartUsage` keeps one kind of
     * element. A view without `expose` shows the whole model.
     *
     * Reports (SpecificationDocument, InterfaceControlDocument) are views
     * too: rendered `asDocument`, each subview becomes a chapter, and the
     * report's `expose` decides what the chapters cover.
     */

    private import Reporting::*;

    view def RequirementsTable {
        doc /* Every requirement with its ID, statement, classification, status, trace links, whether the design meets it and how its verification went. */
        @TableRendering {
            rows = "requirements";
            columns = "id; title; text; kind; priority; verificationMethod; status; owner; satisfiedBy; check; verifiedBy; result";
            sortBy = "id";
        }
    }

    view def RequirementGaps {
        doc /* Requirements that nothing in the design satisfies yet, or that no verification case checks. */
        @TableRendering {
            rows = "requirements";
            columns = "id; title; satisfied; verified; satisfiedBy; verifiedBy; status; owner";
            where = "satisfied == 0 or verified == 0";
            sortBy = "id";
        }
    }

    view def TraceMatrix {
        doc /* Requirements down the side, the design elements that satisfy them across the top. */
        @TableRendering {
            rows = "relation:satisfy";
            pivot = "requirement; by";
            sortBy = "requirement";
        }
    }

    view def VerificationMatrix {
        doc /* Requirements down the side, the verification cases that check them across the top. */
        @TableRendering {
            rows = "relation:verify";
            pivot = "requirement; by";
            sortBy = "requirement";
        }
    }

    view def InterfaceTable {
        doc /* Every port: which part owns it, what flows through it, and what it is connected to. */
        @TableRendering {
            rows = "kind:port";
            columns = "owner; element; type; direction; connectedTo; via";
            sortBy = "owner";
        }
    }

    view def BillOfMaterials {
        doc /* What the system is made of: each part with how many are used, per assembly and in total. */
        @TableRendering {
            rows = "composition";
            columns = "path; type; quantity; extended; description = doc";
            sortBy = "path";
        }
    }

    view def MassBudget {
        doc /* What each part weighs, how many there are, and what each assembly and the whole add up to. */
        @TableRendering {
            rows = "budget:mass";
            columns = "path; type; quantity; each; total; share; limit; margin; check";
        }
    }

    view def PowerBudget {
        doc /* The electrical power each part draws, how many there are, and what each assembly and the whole draw. */
        @TableRendering {
            rows = "budget:powerDraw";
            columns = "path; type; quantity; each; total; share; limit; margin; check";
        }
    }

    view def ConstraintChecks {
        doc
        /*
         * Does the design meet its requirements? Every requirement constraint,
         * evaluated against the values of the design element that satisfies
         * it (`satisfy R by x`), and every `assert constraint` (a definition's
         * for each part and type that changes its values): satisfied,
         * violated, or undecided with the reason, and what each value is
         * worked out from. Requirements stated only in words are left out:
         * they have nothing to evaluate.
         */
        @TableRendering {
            rows = "checks";
            columns = "status; id; requirement; by; margin; detail; inputs";
            where = "checkable == 1";
            sortBy = "-status";
        }
    }

    view def TradeStudyTable {
        doc
        /*
         * A trade study's alternatives side by side: what each gives on every
         * criterion, its score and its rank, with the alternative the study's
         * objective selects marked. Expose the trade study to show:
         *
         *   view batteryTrade : TradeStudyTable {
         *       expose BatteryTrade::batteryTradeStudy;
         *   }
         */
        @TableRendering {
            rows = "trade";
            columns = "criterion; weight; alternatives";
        }
    }

    view def VariabilityMatrix {
        doc
        /*
         * The product's configurations down the side, its variation points
         * across the top, and in each cell the variant the configuration
         * chooses. A choice left open, made twice, or of something that isn't
         * one of the point's variants is marked. Expose the configurations
         * to show (a view without `expose` shows them all):
         *
         *   view droneVariants : VariabilityMatrix {
         *       expose DroneConfigurations::*;
         *   }
         */
        @TableRendering {
            rows = "variability";
            columns = "configuration; variationPoints; description = doc";
        }
    }

    // --- Reports: documents to read and send for review ------------------
    // A report is a view rendered `asDocument`: a title page and contents,
    // then a chapter per subview. Names are qualified so this section can
    // be copied into another project's ModelViews as it is.

    metadata def DocumentInfo {
        doc /* Title-page details of a report. Values left out come from the project. */
        attribute title : ScalarValues::String[0..1];
        attribute number : ScalarValues::String[0..1];
        attribute version : ScalarValues::String[0..1];
        attribute status : ScalarValues::String[0..1];
        attribute author : ScalarValues::String[0..1];
    }

    rendering def DocumentRendering :> Views::TextualRendering {
        doc
        /*
         * Renders a view as a document: a title page and contents, then one
         * chapter per subview, in order, each covering what the document's
         * `expose` includes.
         */
    }

    rendering asDocument : DocumentRendering[1] :> Views::renderings;

    view def SpecificationDocument {
        doc
        /*
         * A requirements specification: each requirement with its statement,
         * attributes and rationale, what satisfies and verifies it, then the
         * coverage and the gaps. Expose the requirement packages to include:
         *
         *   view systemSpecification : SpecificationDocument {
         *       @DocumentInfo { title = "System specification"; version = "1.0"; }
         *       expose SystemRequirements::*;
         *   }
         */
        view requirementsChapter : RequirementsTable {
            doc /* The requirements, by package, each with its attributes and trace. */
        }
        view traceabilityChapter : TraceMatrix {
            doc /* What satisfies and what verifies each requirement, at a glance. */
        }
        view coverageChapter : RequirementsTraceMatrix {
            doc /* How many requirements are satisfied and verified. */
        }
        view gapsChapter : RequirementGaps {
            doc /* Requirements not yet satisfied or not yet verified. */
        }
        render asDocument;
    }

    view def InterfaceControlDocument {
        doc
        /*
         * An interface control document: how the parts in scope connect, the
         * interfaces and ports they connect through, and the items that flow.
         * Expose the parts and the interface packages to include:
         *
         *   view droneIcd : InterfaceControlDocument {
         *       expose DroneArchitecture::drone::*;
         *       expose DroneInterfaces::*;
         *   }
         */
        view interconnectionChapter : StandardViewDefinitions::InterconnectionView {
            doc /* The parts and the connections between them. */
        }
        view connectionsChapter : ConnectionTable {
            doc /* Every connection: which ports it joins and through which interface. */
        }
        view interfacesChapter : StandardViewDefinitions::GeneralView {
            doc /* The interface definitions: their ends and what flows between them. */
            filter @SysML::InterfaceDefinition;
        }
        view portsChapter : StandardViewDefinitions::GeneralView {
            doc /* The port definitions: what goes in and what comes out. */
            filter @SysML::PortDefinition;
        }
        view itemsChapter : StandardViewDefinitions::GeneralView {
            doc /* The items that flow through the ports. */
            filter @SysML::ItemDefinition;
        }
        view portUsageChapter : InterfaceTable {
            doc /* Each part's ports, and what they are connected to. */
        }
        render asDocument;
    }
}
