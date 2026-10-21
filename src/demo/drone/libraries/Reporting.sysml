package Reporting {
    doc
    /*
     * The table-rendering convention for SysML v2 views.
     *
     * SysML v2's view machinery (`view def`, `expose`, `filter`,
     * `render as`) specifies what a view includes; it does not define a
     * vocabulary for tabular layout. @TableRendering fills that gap so
     * the entire report specification lives in the model: any tool
     * implementing this convention renders identical tables, and users
     * add reports by writing view defs, never tool code.
     *
     * Attach to a view def:
     *
     *   view def FmeaWorksheet {
     *       @TableRendering {
     *           rows = "@Fmea";
     *           columns = "element; failureMode; severity; likelihood;
     *                      detection; rpn = severity*likelihood*detection";
     *           sortBy = "-rpn";
     *       }
     *   }
     *
     * Lists are `;`-separated so column expressions may contain commas.
     *
     * Row providers (the `rows` value):
     *   "@Fmea"                 rows are annotations of a metadata type;
     *                           fields = element, file, line + the
     *                           annotation's values
     *   "type:Hazard"           rows are usages typed by a definition or
     *                           any of its specializations; fields =
     *                           element, type, kind, parent, file, line +
     *                           body values (`:>> description = ...`)
     *   "kind:port"             rows are usages of a syntactic kind;
     *                           fields = element, parent, type, direction
     *   "relation:allocation"   allocation pairs (source, target)
     *   "relation:satisfy"      satisfy relationships (requirement, by)
     *   "relation:verify"       verify relationships (requirement, by)
     *   "relation:connection"   connections (source, target)
     *   "trace"                 requirement coverage (requirement, id,
     *                           satisfied, verified)
     *   "kindcounts"            model statistics (kind, definitions,
     *                           usages)
     *   "budget:mass"           a budget of one attribute (here `mass`)
     *                           over the parts tree: the composition rows
     *                           (path, type, quantity, extended) with
     *                           each = the attribute's evaluated value for
     *                           one of the part, or the sum of its parts'
     *                           when it has none; total = each x extended;
     *                           share = total / the root's total. After a
     *                           root's parts come its own attributes of
     *                           the same quantity (`emptyMass :> mass`).
     *                           limit, margin, check and requirement come
     *                           from a requirement whose constraint
     *                           compares the row's value with a limit
     *                           (`satisfy R by drone` with R's constraint
     *                           `drone.takeOffMass <= 4 [kg]`).
     *   "checks"                every constraint check: each `satisfy`
     *                           claim with its requirement's constraints
     *                           evaluated against what satisfies it, each
     *                           requirement constraint nothing satisfies
     *                           yet, each `assert constraint` (status =
     *                           satisfied, violated or undecided; id,
     *                           requirement, by, constraint, values,
     *                           limit, margin, detail; checkable = 0 for a
     *                           requirement stated in words only). The
     *                           "requirements" rows have the worst verdict
     *                           of their claims as `check`.
     *   "uncertainty"           evaluated uncertainty analyses (case,
     *                           critical, target limits, worst-case
     *                           range, margin, cp, cpk, result)
     *
     * Values are evaluated with their units by the tool's evaluator, as
     * the model binds them; a value it cannot evaluate is left empty with
     * the reason.
     *
     * Column syntax: `name` copies a row field; `name = expression`
     * computes a value from the row's numeric fields with the standard
     * expression language (so derived values like RPN are never stored).
     * `where` filters rows with a boolean expression; `sortBy` orders by
     * a column (`-` prefix for descending); `pivot = "rowField; colField"`
     * renders a count grid instead of columns.
     */

    private import ScalarValues::*;

    metadata def TableRendering {
        attribute rows : String;
        attribute columns : String[0..1];
        attribute sortBy : String[0..1];
        attribute pivot : String[0..1];
        attribute where : String[0..1];
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
         * One row per requirement definition with satisfy/verify status —
         * the requirements traceability matrix.
         */
        @TableRendering {
            rows = "trace";
            columns = "requirement; id; satisfied; verified";
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
