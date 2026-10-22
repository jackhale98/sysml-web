# Table rendering

How Fairtide turns a SysML v2 view into a table. The `TableRendering`
metadata is defined in the `Reporting` library (`libraries/Reporting.sysml`
in the demo and in new projects); this page documents it for anyone writing
view definitions by hand or building another tool that reads them.

```text
The table-rendering convention for SysML v2 views.

SysML v2's view machinery (`view def`, `expose`, `filter`,
`render as`) specifies what a view includes; it does not define a
vocabulary for tabular layout. @TableRendering fills that gap so
the entire report specification lives in the model: any tool
implementing this convention renders identical tables, and users
add reports by writing view defs, never tool code.

Attach to a view def:

  view def FmeaWorksheet {
      @TableRendering {
          rows = "@Fmea";
          columns = "element; failureMode; severity; likelihood;
                     detection; rpn = Rpn(severity, likelihood,
                     detection)";
          sortBy = "-rpn";
      }
  }

Lists are `;`-separated so column expressions may contain commas.

Row providers (the `rows` value):
  "@Fmea"                 rows are annotations of a metadata type;
                          fields = element, file, line + the
                          annotation's values (an enum literal by
                          its name: `design`), and the defaults its
                          metadata def gives the fields it leaves
                          out
  "type:Hazard"           rows are usages typed by a definition or
                          any of its specializations; fields =
                          element, type, kind, parent, file, line +
                          body values (`:>> description = ...`)
  "kind:port"             rows are usages of a syntactic kind;
                          fields = element, parent, type, direction
  "relation:allocation"   allocation pairs (source, target)
  "relation:satisfy"      satisfy relationships (requirement, by)
  "relation:verify"       verify relationships (requirement, by)
  "relation:connection"   connections (source, target)
  "trace"                 requirement coverage (requirement, id,
                          satisfied, verified as yes/no, satisfiedBy,
                          verifiedBy)
  "kindcounts"            model statistics (kind, definitions,
                          usages)
  "budget:mass"           a budget of one attribute (here `mass`)
                          over the parts tree: the composition rows
                          (path, type, quantity, extended) with
                          each = the attribute's evaluated value for
                          one of the part, or the sum of its parts'
                          when it has none; total = each x extended;
                          share = total / the root's total. After a
                          root's parts come its own attributes of
                          the same quantity (`emptyMass :> mass`).
                          limit, margin, check and requirement come
                          from a requirement whose constraint
                          compares the row's value with a limit
                          (`satisfy R by drone` with R's constraint
                          `drone.takeOffMass <= 4 [kg]`).
  "checks"                every constraint check: each `satisfy`
                          claim with its requirement's constraints
                          evaluated against what satisfies it, each
                          requirement constraint nothing satisfies
                          yet, each `assert constraint` (status =
                          satisfied, violated or undecided; id,
                          requirement, by, constraint, values,
                          limit, margin, detail; checkable = 0 for a
                          requirement stated in words only). The
                          "requirements" rows have the worst verdict
                          of their claims as `check`.
  "trade"                 a trade study (an analysis typed by
                          TradeStudies::TradeStudy) compared: one
                          row per attribute of its evaluation
                          function (criterion, weight when the
                          score is a weighted sum, better =
                          higher or lower), then its score and
                          rank; the column `alternatives` stands
                          for one column per alternative of its
                          subject. The alternative its objective
                          selects (MaximizeObjective: the highest
                          score) and the one the design uses are
                          marked. A view shows the first study it
                          exposes.
  "uncertainty"           evaluated uncertainty analyses (case,
                          critical, target limits, worst-case
                          range, margin, cp, cpk, result)
  "hazards"               one row per occurrence typed by
                          HazardAnalysis::Hazard (element,
                          description, type, parent, file, line)
                          with its causal chain, followed through
                          the connections typed by Causation from
                          cause to effect: situations (the
                          HazardousSituations it leads to), harms
                          (the Harms, worst first), severity (the
                          worst harm's SeverityScale literal) and
                          severityValue (its value); controls (the
                          RiskControl requirements whose `hazard`
                          names it, as "ID title"), satisfiedBy
                          and verifiedBy (what satisfies and
                          verifies those controls), failureModes
                          (the @Fmea lines whose `hazard` names it)

Values are evaluated with their units by the tool's evaluator, as
the model binds them; a value it cannot evaluate is left empty with
the reason.

Column syntax: `name` copies a row field; `name = field` copies a
field under another heading (`part = element`); `name = expression`
computes a value from the row's fields with the standard expression
language (so derived values like RPN are never stored). Numbers are
numbers and other values compare by their name (`category ==
RiskCategory::design`). An expression may invoke a calc def of the
model by name (`Rpn(severity, likelihood, detection)`): its `in`
parameters are bound in order, its attributes with a value are its
local values, and its result expression is evaluated; an argument its
parameter's type rejects (by the type's `assert constraint`, with
`that` the value) leaves the cell empty. A result that is an enum
literal shows its name (`high`).
`where` filters rows with a boolean expression; `sortBy` orders by
a column, or by a field of the rows the table doesn't show (`-`
prefix for descending); `pivot = "rowField; colField"` renders a
count grid instead of columns. A pivot field whose type bounds its
values has every value as a row or column, in order, so empty cells
show: an enum's literals, or the whole numbers an attribute def's
asserted constraints allow (FmeaRating's `that >= 1 and that <= 10`
gives 1 to 10; numbers run down from the highest and across from the
lowest). Satisfy or verify links pivoted as `"requirement; by"` make
a traceability matrix: every requirement in scope is a row, linked or
not, so gaps show.

Values the model rejects are flagged, not hidden: a metadata value its
declared type's asserted constraints reject (`severity = 14` for an
FmeaRating), and a risk rule the libraries state (an FMEA line whose
severity is not the worst harm of its hazard) mark their cell and are
listed as problems.
```
