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
  Two gaps are filled from the model: a connector the toolkit cannot place
  (a binding to the scope's own inherited port) is drawn from its ends as
  written, and a decision's branches (`if c then a; else b;`, transitions
  the action graph leaves out) take the node declared before them as
  source. A change trigger's label (`accept when …`) is read from the text.
- **requirements**, **trace**, **packages** (`trace.ts`) — from the records
  and the satisfy/verify ends the adapter resolved (`ExtractedModel.traces`).

Node ids are names as written, because `layout/diagrams.json` keys positions
by them: a definition `Battery`, a usage its path `drone.battery`, a state or
action its path in the machine, `__initial__`/`__final__`, unnamed control
nodes `fork#1`, `decide#1`; a clash takes the qualified name. Each node also
carries `element` (file and declaration byte), which the canvas uses to find
the element instead of matching names. A general view is opened with the
view usage's qualified name as scope (`workbench/views.ts`), so its layout key
is `general:Views::name`.

Cost on the demo in Node, after analysis: 0.4–16 ms per view. The one
expensive read (a connector's resolved ends, a whole-model pass of ~300 ms
the first time) is only made when an end's name matches nothing drawn.

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
  analysis; a violated check is a warning (`code: 'check'`) at its claim in
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
  being edited is opened in it (later texts arrive as `didChange`). URIs are
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
