# Table rendering

How Tessera turns a SysML v2 view into a table. The `TableRendering`
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
                          out. An FMEA line (RiskAnalysis::Fmea)
                          also has riskControls (its controls as
                          "ID title"), controlStatus (none, open,
                          implemented or verified), mitigations
                          and mitigationStatus (the least done)
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
  "requirements"          one row per requirement (id, title, text,
                          type, status, owner, rationale, issues,
                          kind, priority, verificationMethod,
                          satisfiedBy, verifiedBy, check); satisfied
                          and verified as 1/0 by the coverage rule
                          (directly, or through every requirement
                          derived from it); result: how its
                          verification cases' recorded results went
                          (passed, failed, inconclusive or not run,
                          from @VerificationResult; see
                          verification.md)
  "trace"                 requirement coverage (requirement, id,
                          satisfied, verified as yes/no by the
                          coverage rule, satisfiedBy, verifiedBy)
  "kindcounts"            model statistics (kind, definitions,
                          usages)
  "budget:mass"           a budget of one attribute (here `mass`)
                          over the parts tree: the composition rows
                          (path, type, quantity, extended) with
                          each = the attribute's evaluated value for
                          one of the part, or the sum of its parts'
                          when it has none; total = each x extended;
                          share = total / the root's total. Units of
                          one quantity are converted (the standard
                          library's: SI and US customary); values
                          that don't add up (g and m, a plain number,
                          temperatures in °C or °F) give no sum, with
                          the reason, and no share. A part whose
                          number can vary ([0..1], [2..4], [*] as
                          [0..*]) counts at its least, and every
                          total that includes one says so. After a
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
                          yet, each `assert constraint` (a
                          definition's also for each part and
                          type that changes its values; status =
                          satisfied, violated or undecided; id,
                          requirement, by, constraint, values,
                          limit, margin, detail, inputs (what each
                          value is worked out from); checkable = 0
                          for a requirement stated in words only). The
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
                          exposes. Exported (CSV, Excel), the study
                          is data: its objective and score, each
                          criterion's unit, weight and direction,
                          scores, ranks, selection and the
                          alternatives' own values, every digit.
  "uncertainty"           reserved for uncertainty analyses
                          (planned: worst-case and RSS ranges over
                          tolerances, margins, cp and cpk). Not
                          worked out yet: the table is empty and
                          its warning says so.
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
  "variability"           one row per configuration of a product
                          (a usage that specializes a product line
                          and binds its variation points): field
                          configuration, productLine, product,
                          doc, file, line, and one per variation
                          point (the column `variationPoints`
                          stands for them all) holding the variant
                          it chooses; a choice left open, made
                          twice or of something that is not a
                          variant is the cell's problem
                          (docs/variants.md).
  "reliability:failureRate"
                          a budget:failureRate (a series system's
                          failure rate) with mtbf = 1 / total for
                          each row, and limit, margin, check and
                          requirement from a ReliabilityRequirement
                          the row's element satisfies
                          (maximumFailureRate, minimumMtbf)
  "faultTrees"            one row per occurrence typed by
                          FaultTreeAnalysis::TopEvent: hazard,
                          probability (exact), rareEvent and
                          upperBound (from the minimal cut sets),
                          tolerable, margin, check, cutSets,
                          smallestCutSet, exposure, basicEvents
  "cutSets"               one row per minimal cut set of each top
                          event, most likely first: topEvent, rank,
                          order, events, probability, share (of the
                          top event's), components
  "basicEvents"           one row per basic event of each top
                          event: topEvent, rank (by Fussell-Vesely),
                          element, component, failureMode,
                          probability, source, fussellVesely,
                          birnbaum, achievementWorth,
                          reductionWorth, inFmea (see fault-trees.md)

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
`where` filters rows with a boolean expression; a view's own `where`
narrows the rows of the def it is typed by (the conditions
accumulate, joined with `and`, as `filter`s do). `sortBy` orders by
a column, or by a field of the rows the table doesn't show (`-`
prefix for descending); further keys follow after `;` (`-actionPriority;
-rpn`), and a column whose values are an enum's literals (a field
declared with an enum, a calc that returns one) sorts in the order
the literals are declared. `pivot = "rowField; colField"` renders a
count grid instead of columns. A pivot field whose type bounds its
values has every value as a row or column, in order, so empty cells
show: an enum's literals, or the whole numbers an attribute def's
asserted constraints allow (FmeaRating's `that >= 1 and that <= 10`
gives 1 to 10; numbers run down from the highest and across from the
lowest). A pivot's `cellLevel` is an expression of the row and column
values evaluated for every cell (`Acceptability(severity,
likelihood)` gives the risk matrix its zones), which tools show as
the cell's colour. Satisfy or verify links pivoted as `"requirement; by"` make
a traceability matrix: every requirement in scope is a row, linked or
not, so gaps show.

Values the model rejects are flagged, not hidden: a metadata value its
declared type's asserted constraints reject (`severity = 14` for an
FmeaRating), and a risk rule the libraries state (an FMEA line whose
severity is not the worst harm of its hazard, whose risk the policy
calls unacceptable, or whose high priority has no verified control)
mark their cell and are listed as problems.
```

## Filtering in the app

The app's tables filter by column as a way of looking: numbers by range,
levels (an enum's literals, in order) by value, text that contains words.
Phones' cards and exports show the same rows. **Save as a view** writes the
number and level filters as the new view's `where`, over the columns' own
expressions (`Rpn(severity, likelihood, detection) >= 100`); text filters
are left out, since the expression language has no "contains". Why `where`
rather than a view's `filter`: see [risk-analysis.md](risk-analysis.md#reviews-saved-as-views).

## Matrices of elements against each other

A view can also be a dependency matrix (a DSM or an N² chart): the same
elements down the side and across the top, and in each cell how the row's
element leads to the column's. Those views use `@MatrixRendering` from the
`DependencyMatrices` library rather than `@TableRendering`; see
[dsm.md](dsm.md).
