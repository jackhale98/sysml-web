library package DependencyMatrices {
    doc
    /*
     * Dependency matrices over any SysML v2 model: design structure matrices
     * (DSM) and N² charts. The elements a view exposes are listed down the
     * side and across the top in the same order, each on the diagonal, and
     * the cell in row A, column B says how A leads to B: what A connects to,
     * passes to or is needed by in B. Read across a row for what an element
     * affects, down a column for what it depends on. The matrix is read from
     * the model, so it never drifts from it.
     *
     * Each matrix is an ordinary `view def` that specializes the standard
     * GridView (a relationship matrix) and says with @MatrixRendering which
     * elements are its rows and which relationships count, so a tool renders
     * it without knowing anything about it. Type a view by one of these defs
     * and expose what to compare:
     *
     *   view droneN2 : InterfaceN2 {
     *       expose DroneArchitecture::drone::*;
     *   }
     *
     * `expose X::*` lists X's parts; `expose X::**` their parts too, as deep
     * as `levels` says. A view's own @MatrixRendering changes what its def
     * says, setting by setting:
     *
     *   view powerAndSignals : DependencyMatrix {
     *       expose DroneArchitecture::drone::*;
     *       @MatrixRendering { dependencies = "connection; flow; allocation"; order = "clustered"; }
     *   }
     *
     * Documented in docs/dsm.md of Fairtide.
     */

    private import ScalarValues::*;

    metadata def MatrixRendering {
        doc
        /*
         * How a view is shown as a dependency matrix.
         *   elements      what the rows and columns are, among what the view
         *                 exposes: "parts", "actions" or "requirements"
         *   dependencies  which relationships count, `;`-separated, each
         *                 read from the row's element to the column's:
         *                 connection  a connection or interface (both ways)
         *                 flow        a flow, from its source to its target
         *                 binding     a binding (both ways)
         *                 allocation  `allocate A to B`, from A to B
         *                 typing      B's definition types a feature of A,
         *                             from B to A (A uses what B is)
         *                 satisfy     `satisfy R by A`, from A to R
         *                 succession  `first A then B`, from A to B, through
         *                             forks, joins, decisions and merges
         *                 derivation  from the original requirement to the
         *                             one derived from it
         *                 refinement  from the refined element to the one
         *                             that refines it
         *   order         "model" (as declared) or "clustered" (reordered so
         *                 that elements linked to each other sit together,
         *                 suggesting modules)
         *   cells         "marks" (a mark per kind of link) or "names" (what
         *                 is exchanged: the interfaces and the items)
         *   levels        with `expose X::**`, how many levels of parts below
         *                 X to list (all when left out)
         */
        attribute elements : String;
        attribute dependencies : String;
        attribute order : String[0..1];
        attribute cells : String[0..1];
        attribute levels : Natural[0..1];
    }

    view def DependencyMatrix :> StandardViewDefinitions::GridView {
        doc /* Parts against each other: how each one connects to, passes items to or is bound to the others. */
        @MatrixRendering {
            elements = "parts";
            dependencies = "connection; flow; binding";
            order = "model";
            cells = "marks";
        }
    }

    view def InterfaceN2 :> DependencyMatrix {
        doc /* An N² chart: the parts on the diagonal, and in each cell the interfaces and items that pass from the row's part to the column's. */
        @MatrixRendering {
            dependencies = "connection; flow";
            cells = "names";
        }
    }

    view def FunctionalDsm :> StandardViewDefinitions::GridView {
        doc /* The steps of a process against each other: which step comes after which, and which passes items to which. */
        @MatrixRendering {
            elements = "actions";
            dependencies = "succession; flow";
            order = "model";
            cells = "marks";
        }
    }

    view def RequirementDsm :> StandardViewDefinitions::GridView {
        doc /* Requirements against each other: which are derived from or refine which, so a change to one shows what else to revisit. */
        @MatrixRendering {
            elements = "requirements";
            dependencies = "derivation; refinement";
            order = "model";
            cells = "marks";
        }
    }
}
