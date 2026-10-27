package Reporting {
    doc
    /*
     * The table-rendering convention for SysML v2 views: attach
     * @TableRendering to a view def to say which rows and columns its table
     * has. Documented in docs/table-rendering.md of Tessera.
     */

    private import ScalarValues::*;

    metadata def TableRendering {
        attribute rows : String;
        attribute columns : String[0..1];
        attribute sortBy : String[0..1];
        attribute pivot : String[0..1];
        attribute where : String[0..1];
        attribute cellLevel : String[0..1];
    }

    /*
     * A modelling convention: on a table view, says that every row the
     * view lists breaks a rule of the project. Tessera lists each one
     * under Problems, at the element it is about:
     *
     *   view requirementsWithoutOwner : RequirementsTable {
     *       @TableRendering { where = "owner == \"\""; }
     *       @Convention { rule = "Every requirement names its owner."; }
     *   }
     */
    metadata def Convention {
        attribute rule : String[0..1];
        attribute severity : ConventionSeverity[0..1];
    }

    enum def ConventionSeverity {
        enum error;
        enum warning;
        enum note;
    }

    // --- Domain-neutral views usable in any model ---------------------

    view def PortTable {
        doc /* Every port with its owner, type, and direction. */
        @TableRendering {
            rows = "kind:port";
            columns = "element; parent; type; direction";
            sortBy = "parent";
        }
    }

    view def AllocationMatrix {
        doc /* Allocation relationships, source to target. */
        @TableRendering {
            rows = "relation:allocation";
            columns = "source; target";
            sortBy = "source";
        }
    }

    view def RequirementsTraceMatrix {
        doc
        /*
         * One row per requirement with what satisfies it and what verifies
         * it — the requirements traceability matrix. An empty cell is a gap.
         */
        @TableRendering {
            rows = "trace";
            columns = "requirement; id; satisfiedBy; verifiedBy";
            sortBy = "requirement";
        }
    }

    view def ModelStats {
        doc /* Element counts by kind: the model at a glance. */
        @TableRendering {
            rows = "kindcounts";
            columns = "kind; definitions; usages";
        }
    }

    view def ConnectionTable {
        doc /* Every connection, source to target. */
        @TableRendering {
            rows = "relation:connection";
            columns = "source; target";
            sortBy = "source";
        }
    }
}
