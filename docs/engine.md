# The engine

The app talks to one engine interface, `EngineApi` (`src/lib/engine/protocol.ts`),
through `getEngine()` (`src/lib/engine/instance.ts`). Behind it is the
Open-MBEE **sysml-toolkit** (`@sysml/wasm`, Apache-2.0; its standard library is
EPL-2.0), WebAssembly in a Web Worker (`toolkit/toolkit.worker.ts`). Its
release is pinned in `toolkit.json` and fetched into `static/toolkit/` by
`scripts/fetch-toolkit.sh` (every workflow runs it; run it once after
cloning).

`toolkitEngine` (`src/lib/engine/client.ts`) gives the app its `Engine`:
every `EngineApi` method, made asynchronous, sent to the worker by
`startToolkit` (`toolkit/client.ts`). In the worker, `ToolkitHost`
(`toolkit/host.ts`) answers each method. The host keeps one session for the
latest project text; `this.session(files)` (or `this.build(files)`) reuses it
while the texts are unchanged. It returns the app's result types, with
positions converted (below).

## Adding a method

1. Add it to `EngineApi`, implement it on `ToolkitHost`, add a handler for it
   in `toolkit.worker.ts` and a line in `toolkitEngine` (the types make sure
   none is missing).
2. Test it in Node against the real toolkit (`testing.ts` loads it and the
   demo; see `host.test.ts`), and run the e2e suite.

The host runs in Node too (no worker globals), which is what the unit tests
use; keep it that way.

## History

Until phase 7 of the migration (`docs/PLAN.md`, decision #16) a second
engine, `sysml-cli` built to WebAssembly, served the methods not yet ported,
and a composite routed each method to one engine or the other. Some notes
and tests below still compare with what that engine did.

## Positions

The toolkit reports most positions in UTF-8 **bytes** (`check()` columns,
`declarationSite`, `memberExtent`, `lenientSources`, `edit()` splices) and
some in **UTF-16** (`references()`, the language server). The editor counts
UTF-16 code units. `TextIndex` (`toolkit/offsets.ts`) is built once per file
text and converts between byte offsets, UTF-16 offsets, 1-based line/column
(byte or UTF-16 columns) and LSP positions. Lines end at `\n` only (in `\r\n`
the `\r` belongs to its line, as the toolkit counts it). Use it for every
position the toolkit returns.

The app's `Span` carries byte offsets (`start_byte`, `end_byte`), 1-based
lines and UTF-16 columns, and UTF-16 offsets `from`/`to`, which the editor
prefers.

## The model adapter

`extractModel` (`toolkit/model.ts`) reads the session's resolved model and
builds the app's per-file `Model` (definitions, usages, satisfy/verify links,
connections, views, metadata annotations) and the `ElementDetails` the
inspector shows. It takes owners, qualified names, typings, redefinitions,
satisfy and verify ends, metadata types and `about` targets from the toolkit,
and spells references the shortest way that resolves (`minimalSpelling`).
Elements, links and annotations carry the toolkit's element ids, and the
requirements view matches links and metadata to requirements by id.

Some reads cost a derivation pass over the whole model the first time they
are made in a session (~120 ms on the demo in Node): any `ownedRelationship`
or other derived relationship property, and `derived:name` when it is read
before the satisfy/verify ends. The adapter avoids them (a handle walk with
`typings`/`redefinitionRoot`, the tree graph's specialization edges, and
`derived:name` only for unnamed redefinitions, after the other derived
reads). Check the timing in `host.test.ts`-style runs when adding reads.

Fields filled from the declaration text rather than the model:

- `multiplicity` — the text between `[` and `]` (the toolkit gives bounds
  as expressions);
- specializations of elements the tree graph doesn't draw (attributes,
  `:> mass`) — as written;
- `valueKind: 'initial'` (`:=`) — the toolkit only says whether a value is a
  default;
- `connections[].source/target` — the ends of `connect a to b` as written;
- `views[].filters` — the `filter` conditions as written (the reports read
  them to sort chapters).

## Problems in the text

A unit that doesn't parse can't be part of a session, so `ToolkitHost`
repairs it first with `lenientSources()` (the broken member is cut out, open
bodies are closed) and keeps a `RepairMap` (`toolkit/repair.ts`) to map
positions in the repaired text back to the person's text. Then
(`toolkit/diagnostics.ts`):

- parse errors become the file's syntax errors; a parse error within two
  lines after another in the same file is the parser's echo and is dropped;
- while any file has a syntax error, an "unresolved reference" whose name, or
  a name before it in its chain, is written in a broken file is hidden (an
  unclosed `{` otherwise gave 40 such warnings on the demo), and the first
  syntax error says how many were hidden.

## Views and tables

`listViews`, `renderView` and `viewLibraries` are TypeScript over the model
adapter's records, in the toolkit worker (`toolkit/views/`). A view renders
as a table when a `@TableRendering` applies to it — its own, over what it
inherits from the view def it is typed by or specializes, field by field.
That says which rows to collect (`rows`: `requirements`, `trace`,
`relation:…`, `kind:port`, `type:T`, `@Metadata`, `composition`,
`kindcounts`), which columns to show (`name = expression` computes one with
the emulator's evaluator, `src/lib/sim/expr.ts`), `where`, `sortBy` and
`pivot`. Rows come from the project's files only; everything else in the
session is resolution context.

- **The view libraries.** `Reporting` and `ModelViews` (the demo's copies in
  `src/demo/drone/libraries/`) are added to the session of a project that
  doesn't declare those packages, like a second standard library: their views
  are listed as `builtin`, they make no rows and no problems, and
  `viewLibraries()` returns them to copy into a project.
- **What the toolkit resolves.** Trace links match requirements by the
  toolkit's resolved ends (`requirement_id`), not by name; a satisfied usage
  counts for its definition and the definition's supertypes. Types,
  specializations and redefinitions are the records' resolved ids
  (`typeIds`, `generalIds`, `rootId`). A port's connections come from the
  interconnection graph (`toGraph({view:'interconnection'})`), whose ends are
  resolved through the parts' types; the far end is shown as written.
- **Traceability matrices.** A pivot of `relation:satisfy` or
  `relation:verify` rows as `"requirement; by"` (`TraceMatrix`,
  `VerificationMatrix`) has a row for every requirement in scope — the
  `requirements` rows the view's `expose` and `filter` keep, plus any a link
  in scope names — so a requirement nothing satisfies is a row of empty
  cells, not missing. Its `sources` are the requirements, and
  `RenderedTable.matrix` carries the requirements, the elements (declared
  name, the path written before it, kind, element id) and the links (where
  each `satisfy` or `verify` is written), which `TraceGrid.svelte` shows:
  readable column names, counts, gaps flagged, a card per requirement on a
  phone. Export keeps the grid. Other pivots count as before.
- **`expose`.** `X` is X, `X::*` X's members, `X::**` X and everything
  nested in it, `X::*::**` everything nested but X. Members are what a
  namespace owns and what it inherits from its types and specializations
  (less what it redefines) — not what it imports: the toolkit's own exposure
  (`viewInfo`) follows the letter of the spec, where an expose takes in a
  package's private imports too (`SystemRequirements::*` would bring in all
  of SI). Targets resolve like names: from the namespaces around the view
  (innermost first), then from the root, then by qualified-name suffix. A bill of materials row is exposed by
  its path through the tree, so `drone::**` doesn't take in the same motor in
  another assembly. A view without `expose` shows the whole model.
- **`filter`.** On a view usage that exposes something, the toolkit's
  `viewInfo` applies the filters with the language's semantics; otherwise
  `@SysML::<Metaclass>` (by metaclass conformance: a part is an item),
  `@<Metadata>` and `kind = x` terms are read, and anything else is reported
  and ignored.
- **Calcs, scales and checks of the model.** A column can invoke a calc
  def of the model (`rpn = Rpn(severity, likelihood, detection)`,
  `views/calcs.ts`): its result expression is evaluated with the
  emulator's evaluator, its `in` parameters bound in order, and an
  argument its parameter type's `assert constraint` rejects leaves the cell
  empty. What a field's type allows (`views/domains.ts`: an enum's
  literals, or the whole numbers an attribute def's asserted constraints
  allow, found by trying them) gives a pivot every value of the scale (the
  risk matrix). A metadata value its declared type rejects, and an FMEA
  line whose severity is not the worst harm of its hazard
  (`views/hazards.ts`, by the `HazardAnalysis` conventions:
  `Causation` connections from cause to effect, a `Harm`'s `SeverityScale`
  severity), are a cell's `problems` and, through
  `views/annotationChecks.ts`, violated `assert` checks that the
  evaluation adds to the toolkit's (the toolkit doesn't evaluate
  metadata). The `hazards` row provider (the `HazardLog` view) reads the
  same model. See [risk-analysis.md](risk-analysis.md).
- **Editing.** Each column says what it edits (`name`, `shortName`, `doc`,
  `feature:<f>`, `metadata:<Meta>.<f>`) and its kind and enum options, found
  through the rows' resolved types and the library's metadata defs
  (`StatusInfo`); the `edit` method takes the same field names.
- **Cost.** The index is built once per session on the first view call
  (~15 ms on the demo in Node); a table then renders in a few milliseconds.
  No derived relationship property is read (those cost a ~300 ms
  derivation pass).

## State machines

`stateMachines` (`toolkit/machines.ts`) builds the emulator's `StateMachine`s
from the adapter's element records: a machine is a `state def`, or a `state`
/ `exhibit state` usage not inside another state, with states or
transitions of its own. States, nesting, `parallel` (`isParallel`), docs and
variables (attributes of the machine, its states and, for a usage, the
element it is in) come from the model; each transition's source and target
are the toolkit's `derived:source` / `derived:target`, so `then done` is the
library's final state and a nested target is the state it names. The
expression texts come from the transition's source text (the model has no
spans for expressions), in the emulator's conventions: a trigger is the
signal, `when …` or `after …` / `at …`; an action that assigns is
`assign x := e` statements joined by `; `. Names are matched by hand only
where the toolkit can't help cheaply: the `entry; then x;` target (a
succession's `targetFeature` costs the whole-model derivation pass), a
target transition's source (`accept Go then b;` after `state a;`: the state
before it) and ends that don't resolve (a placeholder state and a warning).
It costs about 3 ms on the demo, once per analysis.

## Model edits

`edit` (`toolkit/edits.ts`) answers every `EditRequest` with the toolkit's
span-preserving transform operations: `insertMember`, `insertTopLevel`,
`remove`, `rename` (every reference, in every file: the result's
`otherFiles`), `setFeatureType`, `setFeatureValue`, `removeFeatureValue`,
`setRedefinedFeature` and `setCommentBody`. The toolkit splices at the spans
its resolver recorded, reparses, and refuses an edit that doesn't parse
(the result's `syntaxErrors`) or that would silently rebind a reference.

- **Composed edits.** What the toolkit has no operation for — modifiers
  (`abstract`, `in`/`out`, `derived`, `constant`, `end`), short names,
  multiplicities, specializations, how a value is given (`default`, `:=`),
  where a new member goes in a body, how a doc comment is laid out — is
  worked out as a text change by `toolkit/header.ts` (a declaration header
  read as tokens, in the order the notation puts its parts) and checked by
  the toolkit: the member is replaced by the changed text (`replaceMember`),
  which must parse as one member and keep every reference resolving as
  before. The change sent back is ours (minimal); the toolkit's re-indented
  text only decides whether its session still holds the result.
- **Refusals the app overrides.** Removing an element something refers to,
  and changing a type whose features are referred to, are made anyway
  (outside the toolkit); `EditResult.warning` says what no longer resolves
  and the toast shows it next to Undo.
- **Units.** A value written from the inspector or a table cell with a
  unit its file can't resolve (`[kg]` without `import SI::*`) brings the
  import the toolkit's quick fix names, made whole (`SI::kg` →
  `private import SI::*;`, as the starter projects write it), in the same
  transaction (`Workspace.importUnits`).
- **Addressing.** Requests name elements by id (`ModelElement.id`, from the
  analysis) when known, else by name as written (simple or qualified) and
  the 1-based declaration line — what table rows carry.
- **Table cells** (`setField`): `name`, `shortName`, `doc`, `feature:<x>`
  and `metadata:<Type>.<field>`, as the earlier engine named them. A field's type comes
  from the model (the feature's declaration in the element's types, its
  enum literals, its multiplicity); enum and metadata types are written the
  shortest way that resolves where they are written (`minimalSpelling`).
- **Sessions.** An edit uses the analysed session when the texts match, and
  leaves its edited session for the next analysis or edit of the edited
  texts (`ToolkitHost.pending`), so a series of edits (an import) doesn't
  rebuild the model each time. A file with a syntax error is not edited
  (the session holds its repaired text); other files are.
- Cost on the demo in Node: 40–75 ms per edit (the earlier engine: a few ms), then the
  analysis of the edited text 90–130 ms. It runs in the worker.

## Diagrams

`EngineApi.diagram(view, files, scope)` is answered in the toolkit worker by
`toolkit/diagrams/` (`buildDiagram`), over the session the analysis built:

- **general** (`general.ts`) — from the model adapter's records: a package's
  definitions, usages (as part trees, three levels) and packages, plus the
  project definitions they specialize or are built from; a definition with
  its parts as usages; a usage's part tree; a **view usage** from what it
  exposes, filters applied (`viewInfo`, kept to elements owned under an
  `expose`d name, since exposure follows `isImportAll`); no scope: every
  definition. Edges: specialization and composition, typing ("defined by")
  from usages to drawn definitions, and connections written with `end`
  features between drawn elements (a `#derivation connection` as «derive»).
- **interconnection**, **states**, **actions** (`interconnection.ts`,
  `behavior.ts`) — from the toolkit's own graphs (`toGraph`, `tkgraph.ts`),
  which resolve connector ends through feature chains, render ports a part
  inherits from its definition and its supertypes, and label transitions.
  Gaps are filled from the model: a connector the toolkit cannot place
  (a binding to the scope's own inherited port) is drawn from its ends as
  written; a decision's branches (`if c then a; else b;`, transitions
  the action graph leaves out) take the node declared before them as
  source; so does a state's target transition (`state b; accept Go then
  a;`), which the state graph leaves out. A transition's label is
  `trigger [guard] / effect` read from its text in the emulator's
  conventions (`machines.ts`), as the toolkit labels an assigning effect
  "assignment action". Every transition and succession edge carries its
  statement's extent (`DiagramEdge.element`, with `end_byte`), which the
  canvas changes and removes it by.
- **Added elements.** A general view also draws the elements a diagram
  that is not a saved view adds by qualified name (`diagram(…, added)`,
  from the layout file), with their features as rows, joined to the rest
  like any other.
- **requirements**, **trace**, **packages** (`trace.ts`) — from the records
  and the satisfy/verify ends the adapter resolved (`ExtractedModel.traces`).
- **sequence** (`sequence.ts`) — from the records. The toolkit's sequence
  emitter only writes PlantUML (`toGraph` has no `sequence` view) and labels
  a message by its name alone, so the builder reads the model the way that
  emitter does: messages are the flow-family usages under the scope
  (`message m of T from a.sent to b.received`), each end lands on the part
  before an event occurrence (`producer.publishSent`) or on the deepest
  part, item or occurrence it names, and a message without ends takes them
  from events that name it (`event m.sourceEvent;`). Ends are resolved by
  name from where the message is written (enclosing namespaces, members,
  what their types define): the toolkit's own resolved ends
  (`sourceFeature`) cost the whole-model derivation pass and are empty for
  an end written as a plain part. Order: `then` and `first a then b`
  between events on a lifeline and between messages; a message precedes
  another when any of its events precedes any of the other's;
  declaration order breaks ties. (The event `then event m.targetEvent;`
  declares has no source extent, so no record; its succession stands in
  for it.)
  Lifelines are the interaction's parts, items and occurrences plus every
  part a message reaches, in declaration order. Edges are the messages in
  time order, with their element and `SequenceMessage` (name, payload,
  doc, events). The page draws it with its own canvas
  (`diagram/SequenceCanvas.svelte`, laid out by `sequenceLayout.ts`), not
  Svelte Flow and ELK.

Node ids are names as written, because `layout/diagrams.json` keys positions
by them (and the nodes a diagram hides, its `#hidden` list; see
`diagram/positions.ts`): a definition `Battery`, a usage its path `drone.battery`, a state or
action its path in the machine, `__initial__`/`__final__`, unnamed control
nodes `fork#1`, `decide#1`; a clash takes the qualified name. Each node also
carries `element` (file and declaration byte), which the canvas uses to find
the element instead of matching names (a sequence view's messages, drawn as
edges, carry it too). A general view is opened with the
view usage's qualified name as scope (`workbench/views.ts`), so its layout key
is `general:Views::name`.

`EngineApi.related(files, id)` (`diagrams/related.ts`) says how an element
is related to others, both ways: what it specializes and is typed by, what
it satisfies and verifies (the adapter's resolved ids), what derives from
what, and what it is connected, bound, allocated or flows to. A connector's
ends are read from its declaration and resolved by name from where it is
written, as a feature chain resolves (the toolkit's resolved ends cost the
whole-model pass); an end on a port stands for the part it is on. The index
is built once per analysis. The inspector's related elements and a general
view's "Add connected elements" read it.

Cost on the demo in Node, after analysis: 0.4–16 ms per view. The one
expensive read (a connector's resolved ends, a whole-model pass of ~300 ms
the first time) is only made when an end's name matches nothing drawn.

## Drawing behaviour

State and action diagrams are edited by drawing (`src/lib/diagram/`). The
SysML is written by pure planners in `behaviorEdits.ts`, each returning one
text patch (checked for new syntax errors, applied as one undoable step):

| Gesture | Writes |
| --- | --- |
| Add a state, "Starts here" | `state off;` and `entry; then off;` (an existing `entry; then x;` is retargeted) |
| Add a state inside a state | the same, in that state's body (`state on { entry; then idle; state idle; }`) |
| Add a value | `attribute presses : Integer = 0;` |
| Draw a transition | `transition off_to_on first off accept SwitchOn if presses < 3 do action beep then on;`, in the source's region; a target in another region by its path (`on.busy`); a new signal also writes `item def SwitchOn;` in the machine's package |
| "When…" | a signal (`accept SwitchOn`), `accept when presses > 2`, `accept after 5 [s]` (`[SI::s]` without `import SI::*`), or nothing |
| "Then do…" | a name: `do action beep`; `x := e`: `do assign x := e`; several: `do action { assign a := 1; assign b := 2; }` |
| What a state does | `entry action greet;`, `do assign n := 0;`, `exit action wave;` in its body, in that order |
| Add an action / control node | `action boil;`, `decide decision1;`, `merge merge1;`, `fork fork1;`, `join join1;` with the other nodes; "Starts here" also `first start then boil;` |
| Draw a next step | `first boil then pour;` with the other successions; "Ends here": `first pour then done;` |
| Draw from a decision | `if hot then pour;` (or `else wait;` without a condition) right after the `decide`, before an `else` |
| Delete a line | its statement; `entry;` with an initial `then x;`; only the `then` of `then action b;` |
| Delete a state or step | its declaration and every line drawn to or from it (and its nested states) |

Transitions and successions are written where nothing positional can be
broken: new states go after the last state and the `accept … then` lines
that follow it, new steps after the last node and its branches, never
between a `decide` and its branches. A shorthand `accept T then b;` that is
changed is written out in full (`transition first a accept T then b;`).
Each generator is checked in `behaviorEdits.test.ts` through the toolkit
host (no problems), the diagram builder (the edges drawn) and the emulator
(the machine runs).

## Values and constraint checks

`EngineApi.checks(files)` and `EngineApi.evaluate(files, ids)` are answered
by `toolkit/evaluation.ts` (`Evaluation`, one per analysis, made on first
ask and cached with it):

- **Checks** come from the toolkit's `verify` (evaluation, then interval
  propagation). Each `satisfy R by x` claim is one `Check`: R's constraints
  evaluated with R's subject bound to x. A requirement constraint that
  nothing claims to satisfy is one (undecided: there is nothing to evaluate
  it against); an `assert constraint` is one, except a type's invariant
  (`assert constraint { that >= 1 }` in an attribute def), which is left out
  while it holds. A check has the toolkit's verdict line, a plain-language
  explanation, the feature chains its constraints name with their values
  (evaluated with the subject bound to what satisfies it, since `verify`
  gives bindings only for what it could not decide), and — for a single
  comparison with a literal, `x <= 4 [kg]` — the limit and the margin in
  the limit's unit. `verify` reports 1-based lines and byte columns; they
  are mapped like findings (through the repair, then to UTF-16).
- **Values**: `evaluate` on each element, as `Evaluated` (a number with its
  unit, text, none, or undecided with the reason). An undecided value says
  why, followed through what its expression refers to: a collection of
  parts on the way (`rotors : Rotor[4]`), or a feature without a value.
- **Sums over collections, by the app.** The toolkit doesn't evaluate a
  value over a collection of parts whose members aren't given (request 2
  below), so `Evaluation` works such a value out itself: the feature's
  expression is evaluated with `sim/expr.ts`, `sum(parts.x)` over a
  fixed-size collection (`part rotors : Rotor[4]`) counts each part's `x`
  (as the collection or its definition gives it) once per part, and every
  other value comes from the toolkit. It only fills in what the toolkit
  leaves undecided, and only when a collection was summed on the way, so it
  steps aside by itself once the toolkit evaluates these; such values carry
  `byApp` (internal, not shown to people). `evaluation.test.ts` ("adds up a
  value over a collection of parts only while the toolkit cannot") fails
  when the toolkit decides it, so the code can go. The same evaluation
  gives an attribute a usage inherits from its definition
  (`takeOffMass = emptyMass + payloadCapacity` in `DeliveryDrone`) its
  value in the usage, since `evaluate` on the definition's feature sees no
  usage values.
- **The demo writes its rotors so the toolkit decides it.** Four named
  rotors (`frontLeft`, …) and `ref part rotors : Rotor[4] = (frontLeft, …)`,
  summed as `sum(rotors->collect { in r : Rotor; r.mass })`. `collect`
  rather than `sum(rotors.mass)`, because the toolkit reads a dot chain as
  a set (request 3). Tables and diagrams treat a `ref part` as a reference:
  its parts are counted once, where they are owned.
- **The evaluation session.** The toolkit refuses the values a part
  inherits from its definition when metadata annotates the part (see
  below). Metadata takes no part in evaluating values, so `Evaluation`
  evaluates in a second session over the same texts with every annotation
  written with `@` or `metadata` blanked out with spaces (newlines kept):
  positions and element ids stay the same. `#` prefix keywords are kept
  (they can carry semantics, `#derivation`). No annotations: the analysed
  session is used.
- **Units** (`src/lib/engine/quantity.ts`): conversion between the SI units
  and the ISQ library's common others, the unit a person reads a value in
  (2770 g reads 2.77 kg, 1652.4 s reads 27.54 min), four significant
  digits. Shared by the worker and the page.
- **Where they show.** The workspace asks for the checks after each
  analysis (once "Model ready" shows; on a model whose analysis takes more
  than 2 s, after a pause in typing — `docs/performance.md`); a violated check is a warning (`code: 'check'`) at its claim in
  Problems and the editor, which jumps to the claim's range
  (`WorkbenchUi.revealText`); undecided ones are not problems. The
  `checks` and `budget:<attribute>` row providers (`toolkit/views/budget.ts`)
  and the requirements' `check` field make the `ConstraintChecks`,
  `MassBudget` and `PowerBudget` tables and the requirements table's
  verdict column. The inspector shows what an attribute's expression comes
  to (`= 27.54 min`), and the values of the attributes an element contains,
  in one `evaluate` call per selection.
- **Budgets** walk the bill of materials' composition rows: each part's
  value of the attribute where the model binds it (on the usage, else its
  type or a supertype), evaluated in its definition; a part without one
  adds up its parts; totals are quantity × value; the root's own values of
  the same quantity (`emptyMass :> mass`) follow, with the limit and margin
  a claim's constraint sets on them. An attribute declared optional
  (`powerDraw [0..1]`) leaves the parts without a value out.
- **Cost on the demo in Node**: the evaluation session ~25–30 ms, `verify`
  ~15–30 ms (once per analysis, on first ask); `evaluate` of all 171
  attributes 3 ms; a budget table 2 ms after that. All in the worker.

## Trade studies

`EngineApi.tradeStudies(files)` and the `trade` row provider are answered
by `toolkit/trade.ts` (`TradeStudies`, made once per analysis by the view
context, `ViewContext.tradeStudies()`), over the evaluation session
(`Evaluation.session`). A trade study is an analysis of the project that
conforms to the standard library's `TradeStudies::TradeStudy` (the
toolkit's `conforms`).

- **The study's parts**, from the model adapter's records: the subject
  (its value lists the alternatives), the objective (`MaximizeObjective` or
  `MinimizeObjective`, by the toolkit's `conforms`; anything else selects
  nothing, and the study says so), and the evaluation function (`calc :>>
  evaluationFunction`): its `in` parameter is the alternative, its
  attributes are the criteria, its result the score.
- **Alternatives**: the toolkit's evaluation of the subject when it gives
  the elements; otherwise each reference of the list as written, resolved
  where the study is written (`drone.battery` is `drone`'s `battery`;
  `batteryOptions::lithiumPolymer` a variant). `all X` is not supported (the
  toolkit doesn't evaluate extents) and the study says so.
- **Values.** Each criterion and the score are evaluated for each
  alternative with `sim/expr.ts`. Names are the calculation's parameter
  (bound to the alternative) and attributes, then features of the element
  an expression belongs to, then names resolved where it is written
  (`session.resolve` from the innermost namespace out, imports included).
  The toolkit decides what it can: every value an element binds
  (`evaluate`, through `Evaluation.valueAt`), every calculation of the
  model invoked with the values worked out (`query("Calc(177.6 [SI::W*SI::h], …)")`,
  which also does the unit algebra), and the score outright when it
  evaluates `study.evaluationFunction(alternative)` (alternatives nested in
  a part or a variation, request 6 below). The app combines the rest.
  Values and verdicts the app works out are marked in `TradeStudy.byApp`
  (internal, not shown).
- **Inherited values are worked out for the alternative.** `evaluate` on a
  feature an alternative inherits uses the definition's values
  (`lithiumPolymer::usableEnergy` is the definition's 216 W·h × 0.85, not
  the variant's 222 W·h × 0.8; request 9), so an inherited expression is
  evaluated with the alternative's features; an inherited literal, and a
  value the alternative binds itself, come from the toolkit.
- **Weights and directions.** When the score is a weighted sum
  (`0.5 * enduranceScore + …`), written in the result or in the
  calculation it invokes (an `if … ? 0.0 else` around it is seen through),
  each term's weight goes to the criterion it reads, with its score before
  weighting. For each criterion the score reads, the score is evaluated
  again with the criterion nudged by 0.1 %: the way it moves says whether a
  higher or a lower value is better (for a `MinimizeObjective`, lower
  scores are better), and the best value is marked. Values the score
  doesn't read directly (`hoverPower`) are shown without a verdict.
- **Selection.** The toolkit doesn't evaluate `TradeStudy::selectedAlternative`
  nor `TradeStudyObjective::best` (request 7), so the app ranks the scores
  by the objective's kind and selects the best; a tie selects nothing and
  says so. `trade.test.ts` fails when the toolkit evaluates
  `selectedAlternative`, so the selection can be taken from it.
- **The design's choice**: an alternative that is a part of the design (owned
  by a part usage that isn't a variation, `drone.battery`), or one a part of
  the design is bound to (`ref part engine : Engine = engineChoice::v6`).
- **The table.** `rows = "trade"` makes a row per criterion (fields
  `criterion`, `weight`, `better`, one per alternative), then `score` and
  `rank`; the column `alternatives` stands for one column per alternative
  (a row provider's column group, `Row.groups`). A view shows one study, the
  first it exposes (a warning names the others). The rendered table carries
  the study (`RenderedTable.trade`), which `TradeMatrix.svelte` shows as the
  comparison; CSV/XLSX export the rows as they are.
- **The demo** (`analysis/BatteryTrade.sysml`): today's battery against
  three variants of `batteryOptions`; `Battery`'s datasheet values are
  `default`s so a variant can give its own (a bound value can't be
  overridden). A variation is not part of the bill of materials.
- **Cost on the demo in Node**: about 60 ms for the study the first time in
  an analysis (the first `query` warms the toolkit up), then cached.

## Guided forms

The forms that make views, roll-ups, limits, trade studies, FMEA
worksheets and their lines, and hazards (`src/lib/create/`) write standard
SysML through the edit actions; the
engine tells them about the model with `EngineApi.elementFeatures(files,
ids)` (`toolkit/views/features.ts`):

- **What an element is one of**: its type (a usage) or itself (a
  definition), with their supertypes, from the model adapter's records
  (`ViewContext.supers`). A trade study's alternatives are compared by it.
- **How to refer to it** from another package: the outermost element a
  package owns is imported and the rest is a feature chain
  (`drone.battery`), or a membership path through a definition or a
  variation (`batteryOptions::lithiumPolymer`).
- **Its features**: its own, then those its type, specializations and
  subsetted usages give it (nearest first), each with its value as written,
  its multiplicity, whether it is a `ref` or a `variation`, where it is
  first declared, and, for an attribute, its value evaluated in the element
  (`Evaluation.valueAt`) and its value type. The value type is the toolkit's
  derived `type` of the attribute's declaration (`mass :> ISQ::mass` is a
  `MassValue`; `typings` is empty for a feature that only subsets one), which
  costs a derivation pass the first time in a session (~180 ms on the demo in
  Node); it is read only for attributes and cached per analysis.

What the forms write is tested by applying each form's plan to a new
project on the real toolkit, through the workspace as the app does
(`create/create.test.ts`): no new problems, and the values, verdicts and
rankings the views then show. Roll-ups follow the toolkit's semantics: a
fixed number of parts not given one by one is added with `sum(wheels.mass)`
(the app adds it up while the toolkit leaves it undecided, request 2); a
collection bound to named parts with `collect` (request 3); parts that are
also counted where they are owned are left out.

## Comparing versions (semantic diff)

`EngineApi.compareModels(base, current)` says what changed between two
versions of the project at model level; review mode (`src/lib/review/`)
words and shows it. The host takes a **snapshot** of each version
(`toolkit/snapshot.ts`) and diffs the two in TypeScript
(`#lib/review/semantic.ts`, pure, unit-tested with hand-made snapshots).

- **Snapshots.** From the model adapter's records of the project's own
  files: every named element with what it says about itself as people
  read it (`type`, `multiplicity`, `value`, `specializes`, `redefines`,
  `direction`, `doc`, `shortName`, `abstract`, a requirement's `require
  constraint`, and metadata values by `metadata:<Type>.<field>`: a status,
  an FMEA rating), its label (`Motor.mass`, `SYS-003`), its group
  (Requirements, Design, Behaviour, Verification, Risk, Other: from its
  kind or its owner's, and from the risk libraries' types) and its text
  without its name; the unnamed relationships (`satisfy`, `verify`,
  `allocate`, `connect`, interfaces, flows, bindings, derivations,
  successions, transitions) with their text and the elements they
  resolve to; the checks (`Evaluation.checks()`, with the value against
  its limit: `4.05 kg > 4 kg`); each budget table's total; and every
  attribute's evaluated value. An `about` that doesn't resolve is left
  out (the adapter would give the annotation to its package).
- **Two sessions.** The current version is usually the analysed one, and
  its snapshot is cached with the build. The base is analysed in a
  session of its own, opened from the analysed project's settled outcomes
  (the prepared library is shared), without `check()` (the model reads
  the same without it, in half the time); its snapshot is kept (the two
  latest) and the session freed at once. The analysed session is left
  alone.
- **The toolkit's ids** are UUIDv5s of qualified names: a named element
  keeps its id through any edit that leaves its name and owner alone
  (text moved, reformatted, others added before it), and gets a new one
  when it, or anything it is in, is renamed or moved; unnamed elements
  are numbered by position, so a `satisfy` added before another takes
  its id (`compare.test.ts` pins all three).
- **Matching elements.** By id first. Then, outermost first (so a renamed
  owner is matched before its members), each new element without a match
  against the old ones of the same kind: in the same owner with the same
  name, it only follows a renamed or moved owner; in the same owner with
  another name and a similar body (Dice coefficient of tokens ≥ 0.6),
  renamed; in another owner with the same name (≥ 0.5), moved; another
  owner and name with (nearly) the same substantial body, both. What is
  left was added or removed; members of an added or removed element fold
  into it. A file move is reported once, for the outermost element whose
  file changed.
- **Properties** are compared with renamed names substituted (after
  renaming `motor`, `esc.mass + engine.mass` is the same value), and so
  are relationships (kind, owner and resolved ends through the element
  matching, text with renames substituted) and checks (kind,
  requirement, `by`).
- **Impact.** Checks whose verdict changed (failures first), a new
  requirement that fails, margins that moved; budget totals; computed
  values that changed although their own expression didn't.
- **Cost.** On the demo in Node: the base 180–300 ms (670 ms the first
  time, with the evaluation session and `verify`), the current version's
  snapshot 20–100 ms once per analysis, the diff 2–7 ms; WebAssembly
  memory grows by 11–13 MiB once (160 → 173 MiB) and stays there over
  repeated comparisons. In the browser (desktop, in the worker): base
  0.54 s, current 20–100 ms, diff 4–11 ms. Nothing runs on the main
  thread but the wording.

## Language services

The editor's completion, hover, go to definition, references, rename,
outline and quick fixes come from the toolkit's in-wasm language server
(`LspServer`, LSP messages as strings, UTF-16 positions), through
`LanguageServices` (`toolkit/language.ts`), answered in the existing
`EngineApi` shapes so `src/lib/editor/language.ts` is unchanged:

- One server sees the project and the standard library
  (`LspServer.withPreparedLibrary`). Each call brings it up to date: the
  workspace is re-seeded when a file that isn't open changes, and the file
  being edited is opened in it (later texts arrive as `didChange`). When the
  host analyses texts the server doesn't have, the server's navigation
  sessions are dropped (`invalidateSessions`): they are rebuilt on the next
  hover anyway, and their memory is wanted for the analysis. URIs are
  `file:///project/<path>`; the library's are `sysmlv2-lib:/<path>`, which
  go to definition opens in the library browser.
- Rename, formatting and code actions answer with whole new documents or
  edits; `diffTexts` (`toolkit/diff.ts`) turns them into minimal changes, so
  the cursor and undo history stay put.
- Quick fixes are asked for with the analysis's own problems at the
  selection (the server's own diagnostics are syntax-only).
- Highlighting uses a second server without the project or library (syntax
  only, so any text — a library file — can be highlighted), its semantic
  token types mapped to the editor's names (`type` declarations as
  `type.definition`, a comment after `doc` as `comment.documentation`).
- Formatting is `formatSource` with four-space indentation; text that
  doesn't parse is left alone.
- Highlighting and formatting (`SyntaxServices`) need no library, so the
  worker answers them as soon as the module is compiled, while the library
  is still loading: text is coloured seconds before the model is ready.

## Library loading

The first visit loads the standard library from its sources (`sysml-library.json.gz`,
0.2 MB; the module is 3 MB gzipped). Once the toolkit is up and the page is
idle (and not on Save-Data or 2G), the worker downloads the prepared snapshot
(`sysml-library.prepared.gz`, 10 MB) into the `sysml-web-toolkit-snapshot`
cache, keyed by the toolkit release; later starts load the library from it,
which is about three times faster and takes a third less memory. A snapshot
the toolkit refuses (another build) is deleted and the library loads from
source. The service worker caches the toolkit's other files on first use, but
never the snapshots (`src/lib/offline/caching.ts`).

## Interchange

`exportInterchange(files, options)` and `importInterchange(json)`
(`toolkit/interchange.ts`) write the project as SysML v2 JSON (KerML 10.4
element JSON) and read such a file as project text; the Systems Modeling API
client (`src/lib/exchange/`) builds on both. The toolkit serializes
(`toCompactJson`, `toFullJson`, `canonicalizeCompact`) and lifts JSON to
text (`fromInterchangeJsonWithPreparedLibrary`, `units()`, `warnings()`,
`minimizeQualifications()`); the app adds the standard library under its
standard ids (in a second, short-lived worker: `startSpareEngine`), the
redefined properties KerML 10.4.5 asks for, file names, mending two printer
slips, and the report of what didn't carry over.

What round-trips and what doesn't, the API's paths and what a server must
allow (CORS) are in `docs/interchange.md`. In short: the demo goes to JSON
and back with no problems and the same 6,291 elements (by qualified name and
element by element); comments, layout and ids don't survive the trip
through JSON; values the text can't hold, unknown element types and
unresolved references are reported, not carried. Export of the demo takes
0.2–0.4 s in Node (the full form with derived properties 1.6–4 s), the
import about 2 s; with the standard library about 6 s in the browser (a
54 MB file, 97,826 elements) and 140 MB of WebAssembly memory, in its own
worker.

## When the toolkit fails

A toolkit defect traps the WebAssembly instance (`RuntimeError: unreachable`);
running out of memory fails a `memory.grow`. Either way the worker is useless.
`startToolkit` (`toolkit/client.ts`) then starts a new worker once and sends
the calls in flight again. If that fails too, every toolkit call fails from
then on: a toast says so once, the status bar shows "Engine error" and the
problems list says why. There is no other engine to fall back to.

## Upstream requests

Found while making the drone demo's budgets and checks (sysml-toolkit
0.10.10); each with a minimal reproduction, for the owner to file:

1. **Metadata on a part blocks evaluating its inherited values.** With
   `metadata def M;`, `part def B { attribute mass :> ISQ::mass = 50 [g]; }`,
   `part d { part b : B; attribute t :> ISQ::mass = b.mass; }` and
   `@M about d::b;` (or `@M;` in `b`'s or `B`'s body), `evaluate(d::t)`
   throws "value receiver identity is incomplete or ambiguous"; without the
   annotation it is 50 g. A value `b` binds itself still evaluates. Every
   FMEA line of the demo annotates a part this way. Worked around by the
   evaluation session (above); `evaluation.test.ts` fails when the toolkit
   is fixed, so the workaround can go.
2. **Values over a collection of parts whose members aren't given.**
   `sum(rotors.mass)` with `part rotors : Rotor[4]` (no binding; `Rotor`
   binds `mass`) is indeterminate, and so is every form over it. This is
   deliberate: the toolkit's test `unbound_collections_never_materialize_as_single_instances`
   asserts it. Each of the four has the mass `Rotor` binds, so the sum is
   arguably determined, and `part x : T[n]` with `sum(x.y)` is how the
   specification's own roll-up examples are written. A design question for
   the maintainers rather than a bug. Binding the collection to named parts
   (as the demo does) is decided today.
3. **`sum(x.mass)` reads `x.mass` as a set** (`sum(concrete.mass)` of four
   equal masses is one mass; documented in the toolkit's tests), while the
   specification's roll-up examples write `sum(subcomponents.totalMass)`.
   Also a design question; `collect` sums every value.
4. **`collect` over a collection whose members aren't given** is
   unsupported ("control function `collect`"), as in request 2.
5. **`verify` bindings for satisfied constraints** are empty; the values a
   verdict rests on are worth reporting either way (the app evaluates them
   itself).

Found while making the demo's trade study (sysml-toolkit 0.10.10):

6. **A part declared directly in a package has no values from elsewhere.**
   With `part def E { attribute cost : Real; }`, `part e4 : E { :>> cost =
   3000.0; }` in package `P`, and `calc def C { in e : E; return : Real =
   e.cost; }`: `query("P::C(P::e4)")` and `e4.cost` read from another
   element are indeterminate, while the same part nested in another part or
   a variation (`P::catalog::e4`, `P::choice::e4`) gives 3000. The
   specification's trade-study examples declare their alternatives this way
   (`part engine4cyl : Engine;`), and the demo's `drone` is one, so a study
   can't read `drone.takeOffMass`. The app evaluates these chains itself
   (`trade.ts`). Possibly a design decision (a package-level usage has no
   single owner to evaluate it in): a question for the maintainers.
7. **`TradeStudy::selectedAlternative` and `TradeStudyObjective::best` are not
   evaluated**: `studyAlternatives->selectOne { in ref a;
   tradeStudyObjective(selectedAlternative = a) }` invokes a requirement as a
   predicate with an argument, and `alternatives->maximize { in x; eval(x) }`
   calls a calculation passed as a parameter (`in calc eval =
   evaluationFunction`). Both give the feature itself. `maximize` and
   `selectOne` over a list with a calculation of the model named in the body
   work. The app selects by the objective's kind meanwhile.
8. **No way to evaluate a calculation's attribute for given arguments.**
   `query("S.evaluationFunction(a)")` gives the result; the attributes it is
   worked out from (the trade study's criteria) can only be read with the
   parameters unbound. An `evaluate` with bindings (a feature and values for
   the parameters of the calculation that owns it) would let the toolkit
   decide every criterion.
9. **An inherited feature is evaluated with the definition's values.**
   `variant part p : Battery { :>> capacity = 222 [W*h]; }` with `Battery`'s
   `usableEnergy = capacity * usableFraction`: `evaluate` on
   `…::p::usableEnergy` (it resolves to `Battery::usableEnergy`) gives the
   default 216 W·h × 0.85, not p's 222 W·h × 0.8. Passed to a calculation
   (`C(p)`), p's own value is used. `evaluate` has no receiver; one (or
   handles for inherited features in their usage) would fix it.
10. **A variant doesn't get the variation's type**: in `variation part o :
    Pack { variant part v { :>> mass = 1300 [g]; } }`, `o::v::usable` (from
    `Pack`) doesn't resolve and `C(o::v)` fails with "unresolved reference";
    `variant part v : Pack` works. The specification's 10b example redefines
    the variation's features in untyped variants. The demo types its
    variants.
11. **`all X` extents are not evaluated** ("unsupported for evaluation: `all`
    extents"); the 10b example binds a study's subject to `all engineChoice`.
    The app asks for the alternatives to be listed.

Found while making the Sequence view (sysml-toolkit 0.10.10):

- **A structured sequence graph.** `toGraph({view: 'sequence'})` fails ("no
  structured-graph emitter for view: sequence"); only `toPlantuml` draws
  it, with participant links (`linkTemplate`) but none for messages, and
  a named message's payload left out of its label. A graph with lifelines,
  messages (element ids, payload type, the events at their ends) and the
  order it already computes would replace `diagrams/sequence.ts`.
- **Message ends written as plain parts.** For `message m of T from
  operator to groundStation` (ends that are parts, not events),
  `sourceFeature`/`targetFeature` are empty and the ends have no reference
  subsetting, though the PlantUML emitter resolves them.
- **`then event m.targetEvent;`** in a lifeline (the form the
  specification's Interaction Example-2 uses): the event occurrence it
  declares has no `memberExtent`, so the model adapter, which keeps the
  elements written in the text, has no record of it; `event
  m.sourceEvent;` without `then` has one.

Found while making state machines and action flows drawable (sysml-toolkit
0.10.10):

- **Target transitions in the state graph.** `toGraph({view: 'state'})`
  leaves out a transition written without `first` (`state b; accept Go
  then a;`, whose source is the state before it), though the model has it
  (`derived:source`). The diagram builder draws it from the text.
- **A transition whose source is a feature chain.** `transition first
  on.idle accept Stop then off;` written in the machine's body (not inside
  `on`) is not in the state graph either; its `derived:source` is right.
  The app writes a transition in its source state's region instead.
- **Effect labels.** The state graph labels `do assign x := x + 1` as
  "assignment action" rather than with its text; the builder labels
  transitions from their text.
- **Guarded successions in the action graph.** `first d if hot then pour;`
  (a `GuardedSuccession`, valid and resolved) is not in the action graph.
  The app writes branches in the target form after their `decide` (`if hot
  then pour; else wait;`), which the builder draws from the text; that
  form is order-sensitive, which the planners take care of.

Found while measuring large models (`docs/performance.md`, generated
projects of 10k–100k lines, sysml-toolkit 0.10.10):

12. **Re-analysis costs the whole project, not the edit.** After a
    one-character edit in a doc comment of a 100k-line project (605 files),
    building the session, `check()` and the adapter's first reads (`rows`,
    which pay for the session's lazy work, and the tree graph) take about as
    long as opening it (tens of seconds in Node; 2.4 s at 10k lines).
    `Session.fromSourcesSettled` saved nothing measurable over a fresh build
    (20k lines: 380–550 ms either way). A session that re-resolves only the
    changed unit and what depends on it would make keystroke-to-problems
    independent of the project's size.
13. **The language server re-resolves the workspace after any change.** The
    first hover, definition or references after an edit rebuilds its
    navigation session: 0.5 s at 20k lines, 3 s at 50k, 13 s at 100k, during
    which the worker can do nothing else, and each rebuild grew the instance
    by 70–300 MB. Sharing the analysed `Session` with the server (or
    rebuilding only the changed unit) would make hover instant. The app now
    drops the stale navigation sessions (`invalidateSessions`) when it
    analyses new text, which keeps the instance about 150 MB smaller at 30k
    lines.
14. **The instance can't grow past 2 GiB** (the module declares a maximum of
    32768 pages), and a session takes about 7 KB per line (340 MB at 50k
    lines) besides the library. At 100k lines an analysed session, the
    checks' evaluation session and the language server's navigation session
    didn't fit: `RuntimeError: unreachable` (a failed `memory.grow`). The
    app frees the evaluation session after the checks once the instance
    passes 1 GiB; 100k lines then peaks at about 1.8 GiB. A 4 GiB maximum
    (wasm32's limit) and less memory per element would leave room for
    larger models; a way to return memory (or to reuse a freed session's
    pages for the next one without growing) would keep long editing
    sessions from creeping up.
15. **One worker does everything.** Highlighting, completion and hover wait
    while an analysis or the checks run (seconds on a large model). Not a
    toolkit defect, but an engine that could analyse in the background
    (yielding, or a session shareable across workers) would let the editor's
    requests through.

Found while making the guided forms (sysml-toolkit 0.10.10):

- **A feature's types through subsetting, cheaply.** `typings` of
  `attribute mass :> ISQ::mass` is empty; its types (`MassValue`) come only
  from the derived `type` property, which costs a derivation pass over the
  whole model the first time (~180 ms on the demo). The edit operations
  (`setField`) classify a value by `typings`, so before this the app wrote
  `30 [kg]` typed into such an attribute as a string; it now treats a number
  with a unit as a quantity, and a quantity-subsetting attribute as a number.
  A per-feature `types` read without the pass would let both use the model.
- **`collect` over parts that a package owns directly** (`part w : W[2] =
  (P::a, P::b)` with `a` and `b` declared in package `P`) is undecided, while
  the same parts nested in a part give the sum; another case of request 6.

Found while making model exchange (sysml-toolkit 0.10.10; `docs/interchange.md`).
Sorted by how sure we are, after re-checking each against the toolkit alone.

**Confirmed bugs** — the toolkit's own printer writes text its own checker
rejects, from a model its checker accepted (no app code in between; pinned
by `interchange.test.ts` → "the toolkit printer (upstream bugs)"):

- **A decision's `else` branch prints as `transition then X;`.** `package P {
  action def A { attribute x : ScalarValues::Boolean; first start; then
  decide; if x then b; else c; action b; action c; } }` (no findings) →
  `toCompactJson` → `fromInterchangeJson…` → `units()` has `transition then
  c;`, and checking that gives "a transition usage is not allowed in an
  action body". The model is right (a guarded succession is a
  `TransitionUsage`); the printer picks the state-machine spelling. The app
  mends it to `else c;`.
- **A `message` prints as a `flow`.** `package Q { part def T; occurrence
  def S { part a; part b; message m of T from a to b; } }` (no findings)
  prints `flow m  of : T  from a to b;`, which fails
  `validateFlowEndSubsetting`. The app mends it to `message m of T from a to
  b;` and collapses the double spaces.

**Probably a bug, possibly intended** — `canonicalizeCompact` writes some
properties as `null` (`memberElement`, `general`/`specific`,
`subsettedFeature`/`subsettingFeature`, `conjugatedPortDefinition`) that
the OMG schema requires as objects, and that KerML 10.4.5 asks to be written
under their redefining names. If the canonical form is meant for comparing
models rather than exchanging them, that is by design; for exchange the app
fills them in.

**Requests, not bugs** — the toolkit works as designed; these would save
the app work:

- Unresolved references serialize as `{"@ref": "Name"}`, a toolkit
  extension rather than KerML 10.4's `{"@id"}`. An option to omit or report
  them would do; the app leaves them out and lists them.
- No way to serialize the standard library with its ids: only user units
  serialize. The app opens the library's sources in a second session and
  maps each element by place.
- User-model ids come from the unit name, and a host can't give a base URI,
  so ids don't survive a file rename or a server round trip; the app
  matches by place.
- `toFullJsonStrict` refuses a model with incomplete derivations (the demo
  has 62,442), as its name says; the app uses `toFullJson(false)`.

**Not a toolkit issue** — `minimizeQualifications` leaves `expose $::A::…`
on four saved views. `$::` is valid KerML (the global namespace), so the
text is correct, just longer; it was the app's view reader that didn't
accept `$::`, now fixed.
