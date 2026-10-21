# SysML Web — Implementation Plan

A beautiful, fast, standards-conformant **web workbench for SysML v2** that
makes the language approachable. Build models in **text or diagrams** — both
edit the same SysML, live — with guidance and plain-language explanations that
let engineers new to MBSE work productively, and the depth experts expect. The
SysML text in a git repository is the single source of truth; every change is a
minimal, reviewable diff that any other conformant tool can read. It runs well
on desktop and mobile.

Status (2026-10-21): **Phases 2–4 largely built; the app runs on the
Open-MBEE sysml-toolkit engine (decision #16, migration done).**
- Built: workbench with text and diagram editing, language features,
  property form with type suggestions, unified undo; tables as SysML views,
  editable in place; requirements, trace and verification matrices;
  generated specification and ICD reports; spreadsheet import and table
  export; projects in the browser, folders, `.kpar`/zip; GitHub source
  control; state machine emulator; library browser; settings; offline and
  installable; touch-first phone layout. Lighthouse ≥ 0.9 performance and
  1.0 accessibility on mobile and desktop, enforced in CI.
- Not yet started: semantic diff and review mode, Sequence view, FMEA and
  hazard views, Systems Modeling API client, conformance dashboard.

### Engine migration (decision #16)

Why: our own engine (`sysml-cli`, tree-sitter) resolved names
approximately — 48 of its 78 findings on the demo were false, it accepted
invalid SysML, and it had no standard JSON interchange. The toolkit
resolves 99.96 % of the official corpus's references, agrees with the
release XMI on 99.90 % of library relationships, rejects 440 of 462
invalid fixtures (ours: 63) and exports schema-valid JSON. Measured in the
browser on a throttled phone it re-analyses as fast as ours and never
blocks the main thread; its costs are start-up (library model: 5–7 s on a
phone first visit, 2.6 s on return with the prepared snapshot) and memory
(105–160 MB vs 24 MB). Reports: `scratchpad/engine-evaluation.md`,
`scratchpad/toolkit-browser-measurements.md` (in the session record).

How: one engine interface (`EngineApi`) stays the app's only contract. The
toolkit was the default engine from phase 1; methods not yet ported were
routed to our own engine as a temporary convenience, and each phase
deleted its routes until phase 7 deleted that engine. Nobody uses
the app yet, so there is no setting, no dual-engine testing and no
fallback: a crashed toolkit worker restarts once, then shows an error.
Pieces the toolkit doesn't provide are written in TypeScript over its model
(tables, diagrams, emulator, `.kpar`, library browser); those that don't
need a model run in parallel with the foundation.

1. ✅ **Foundation** (done; see `docs/engine.md`) — toolkit worker and client as the default engine;
   release pinned in `toolkit.json` and fetched in every workflow; byte ↔
   UTF-16 offsets; start-up without a snapshot, prepared snapshot fetched
   in the background for later visits; analysis and the model adapter
   (explorer, tree, inspector details, requirements, overview, problems);
   worker restart on crash.
2. ✅ **Editor** (done; see `docs/engine.md`) — completion, hover, definition, references, rename,
   format, code actions and highlighting from the toolkit's language
   server.
3. ✅ **Views and tables** (done; see `docs/engine.md`) — view listing and
   table rendering in TypeScript over the toolkit's model in its worker
   (`expose` by ownership and inheritance, `@TableRendering`, editable
   columns); the view libraries are bundled into sessions that lack them;
   reports render their table chapters from it.
4. ✅ **Edits** (done; see `docs/engine.md`) — every inspector, table,
   explorer, diagram, import and report edit through the toolkit's
   transform operations (rename, set value/type/redefinition/comment,
   insert, remove), composed with `replaceMember` where it has no single
   operation; a removal or type change that breaks references is made
   anyway and the toast says what no longer resolves.
5. ✅ **Diagrams** (done; see `docs/engine.md`) — the seven diagram graphs in TypeScript over
   the model, in the toolkit worker: interconnection views with inherited
   ports, flows and bindings; general views with usages, typing and
   specialization, and view usages drawn from what they expose; every
   transition and decision branch.
6. **The rest** — state machine emulator, `.kpar` read/write, library
   browser. *Done:* the emulator (`src/lib/sim/emulator.ts` runs any
   `StateMachine` in TypeScript; `sim/semantics.test.ts` runs it on the
   machines the toolkit extracts and pins where it follows the SysML/UML
   semantics, which the old `stateStep` did not)
   and the machines it runs, read from the toolkit's model
   (`engine/toolkit/machines.ts`, see `docs/engine.md`). `.kpar`/ZIP read and
   write are TypeScript (`src/lib/interchange/kpar.ts`, over
   `dataio/zip.ts`, round-trip tested against our earlier engine's output
   both ways while it was here, and against an archive it wrote), and the library browser and search read the toolkit's library
   bundle (`static/toolkit/stdlib/sysml-library.json.gz`) in a worker with a
   TypeScript declaration scanner (`src/lib/library/`), the same library
   release the toolkit's go-to-definition points into.
7. ✅ **Remove the current engine** (done) — `sysml-cli`'s WebAssembly
   build, its build scripts and CI steps, the routing composite and the
   `?toolkit` test build are gone; the app's `EngineApi` talks straight to
   the toolkit worker. On a real iPhone the toolkit
   held 154–160 MB with no growth over 20 edits and no tab kill (library
   build 3.2 s, analysis 0.3 s). Upstream requests (lighter build,
   on-demand library packages, declaration-header edit, semantic
   diagnostics in its language server, consistent offsets) are drafted for
   the owner to file.

---

## 1. Why this, and why now

- SysML v2, KerML 1.0 and the Systems Modeling API & Services 1.0 were formally
  adopted by OMG in 2025 (published September 2025); v2.1 is expected in 2027.
  Interchangeability is now a real, testable target rather than a moving one.
- The closest open-source competitor, Eclipse **SysON** (Obeo/CEA, built on Sirius
  Web), is diagram/form-first with only a subset of the textual notation for
  direct editing. Commercial tools (Cameo, etc.) are heavyweight and
  repository-centric. There is room for a tool that is **text-first, git-native,
  diagram-capable, and pleasant to use**, with engineering workflows on top.
- The existing toolset (`tree-sitter-sysml`, `sysml-cli`/`sysml-core`,
  `sysml-lsp`, `sysml2-mode`, `sysml-studio`) already solves most of the hard
  parts in isolation. This project is the place they converge and reach people
  who will never install Emacs or a CLI.

### Product principles

1. **The text is the model.** `.sysml`/`.kerml` files in git are the only source
   of truth. Everything else — semantic graph, diagrams, tables, indexes — is
   derived and disposable.
2. **Every edit is a minimal text patch.** Visual edits, form edits and refactors
   compile to `{from, to, insert}` changes against the exact bytes loaded (the
   Mycelium invariant). Formatting, comments and unknown syntax survive.
3. **Conformance is a feature, measured in CI.** Parse, resolve, validate and
   interchange are tested against the official OMG corpus and the pilot
   implementation on every commit.
4. **Semantics in the model, not the app.** Requirements status, FMEA, BOMs,
   reports and quality gates are expressed in SysML (metadata, views,
   constraints, calcs, domain libraries). The app renders and evaluates them; it
   does not hard-code engineering domains. (Lesson carried from sysml-studio's
   audit.)
5. **One engine.** The web app, CLI and LSP share one semantic engine so numbers
   never disagree (the sysml-studio audit's #1 lesson).
6. **Your data stays yours.** No backend stores models. Static app + git
   provider + an optional stateless proxy, exactly like my-celium.org.
7. **Beautiful by default, keyboard-first, accessible.** WCAG 2.1 AA in CI.
8. **SysML made approachable, not hidden.** Text and diagrams are equal ways
   to build the model; the language explains itself in context so newcomers
   learn by doing (see §7).
9. **Fast everywhere.** Mobile and desktop are both first-class; Lighthouse
   ≥ 90 in every category is enforced in CI.

---

## 2. What we reuse

| Source | Reuse | How |
| --- | --- | --- |
| `tree-sitter-sysml` | Grammar (251/251 official corpus files parse; tree shape declared stable), `highlights/locals/folds/tags` queries | Compiled into the engine (WASM). Highlight query drives editor semantic tokens. |
| `sysml-core` (Rust) | Expression evaluator, units, rollups, uncertainty/Monte Carlo, state-machine + action simulators, analysis/trade study, `@TableRendering` view interpreter, 17 lint checks, formatter, `codegen::edit` byte-accurate edits, `DiagramGraph` builders | Ported into the new engine workspace on top of the new semantic graph (see §4). Same author/licence. |
| `sysml-lsp` | Completion, hover, references, rename, symbols, inlay hints, code actions logic | Re-expressed as engine queries called from CodeMirror over worker RPC (no LSP transport needed in the browser). |
| `mycelium-web` | isomorphic-git workspace in OPFS, provider adapters, OAuth + PKCE, stateless Cloudflare Worker (git proxy + token exchange), merge/conflict resolver | Git/auth/worker code ported when Phase 4 starts. Its structure and UI are **not** reused. |
| `sysml-studio` | Conformant SysML emitter (`source-editor.ts`, 553 lines of tests), create-element form schema for ~50 kinds, filter engine, kind colours/labels, per-kind SVG shapes (actor, compartments, states), audit lessons | Ported as TS modules / reference. React components are not reused directly. |
| `sysml2-mode` | Diagram notation conventions, requirement status colouring, traceability + impact matrices, report sections, W-code lint catalogue, SYNTAX-REFERENCE house style, API client endpoints, FMI/SSP ideas | Specs for features; no code reuse (elisp). |
| `sysml-cli/libraries` + `sysml-domain-libraries` | `RiskAnalysis` (FMEA), `HazardAnalysis`, `Tolerancing`, `Uncertainty`, `Reporting`, `ModelQuality` | Shipped as optional **library packs** that light up engineering workspaces. |
| *The SysML v2 Book* (Weilkiens & Molnár, 2026-05) | Notation rules for the 8 standard views, conformance dimensions, ~150 example models | Notation reference; example models become test fixtures (drone `SimpleExample-*` is the canonical multi-file demo). |

---

## 3. Architecture

```
┌──────────────────────────────── Browser (static origin, PWA) ─────────────────────────────────┐
│                                                                                                │
│  Svelte 5 UI                                                                                    │
│   ├─ Workbench shell: Explorer · Editor tabs · Canvas · Inspector · Panels · ⌘K palette          │
│   ├─ Text editor ── CodeMirror 6 (semantic tokens, diagnostics, completion, hover, rename)       │
│   ├─ Diagram canvas ── Svelte Flow (@xyflow/svelte) + custom SysML node/edge renderers           │
│   └─ Tables/worksheets ── virtualized grid (requirements, trace, FMEA, BOM, allocation)          │
│                 │  typed RPC (postMessage, transferable buffers)                                │
│                 ▼                                                                               │
│  Engine Worker ── sysml-engine.wasm (Rust)                                                       │
│   ├─ syntax:   tree-sitter-sysml → CST (incremental, per file)                                   │
│   ├─ lower:    CST → AST with byte spans                                                          │
│   ├─ semantic: AST → KerML/SysML element graph (metaclass-typed, stable element IDs)             │
│   ├─ resolve:  namespaces, imports, visibility, redefinition/subsetting, implied relationships    │
│   ├─ validate: OCL "validate" constraints + house lint (W-codes)                                 │
│   ├─ query:    trace, coverage, impact, views (expose/filter/render), diagram graphs             │
│   ├─ evaluate: expressions, units, rollups, constraints, state/action simulation, trade studies  │
│   ├─ edit:     semantic EditOps → minimal TextEdits (+ formatter)                                 │
│   └─ interchange: JSON (KerML Clause 10 / API schema), .kpar, text pretty-printer                │
│  Layout Worker ── elkjs (layered / orthogonal routing)                                           │
│                                                                                                │
│  Storage: OPFS (git working tree + .git) · IndexedDB (library index, caches, tokens, prefs)     │
└──────────────┬──────────────────────────────────────────┬──────────────────────────────────────┘
               │ git smart-HTTP                            │ REST (optional)
               ▼                                           ▼
   Cloudflare Worker (stateless, self-hostable)     Systems Modeling API servers
     /git/<host>/…   /auth/<provider>/token           (OMG pilot, SysON, vendor repos)
               │
               ▼
   GitHub · GitLab · Bitbucket · any HTTPS git
```

**Why a worker-hosted WASM engine:** the semantic work (resolution across the
~94-file standard library plus the user's model) must never block the UI, must
be identical in the CLI/LSP, and must run offline. The UI only ever sees
immutable snapshots (`ModelSnapshot` with a revision number) and sends intents
(`EditOp`s, queries).

**Alternative considered:** a TypeScript engine on `web-tree-sitter`. Simpler
build, but it forks the engine from the CLI/LSP again — exactly the failure mode
sysml-studio's audit documented. Rejected; the WASM spike proved the Rust route:
tree-sitter 0.27 targets `wasm32-unknown-unknown` natively, the full grammar
ships at **~285 KB brotli**, and a 73 KB model parses in **~10 ms**.

---

## 4. The engine — the heart of conformance

`sysml-core`'s current model is flat and string-keyed (one `super_type` per
definition, simple-name indexes, no element identity). That is fine for a CLI
but cannot support interchange, true redefinition/subsetting semantics, or
graphical editing. We build a proper semantic layer and port the valuable
`sysml-core` modules onto it.

### 4.1 Layers

1. **Syntax** — tree-sitter CST, incrementally reparsed per file on each edit.
2. **Lowering** — CST → typed AST (`Package`, `Definition{kind}`, `Usage{kind}`,
   `Relationship{kind}`, `Expression`, …) with exact byte spans for every token
   that an edit may need to touch (name, short name, type list, multiplicity,
   body braces).
3. **Semantic graph** — an arena of `Element`s whose `type` is a KerML/SysML
   metaclass (`PartDefinition`, `PartUsage`, `FeatureTyping`, `Subsetting`,
   `Redefinition`, `OwningMembership`, `FeatureMembership`, …) mirroring the
   abstract syntax, so serialization to the standard JSON is a projection, not
   a translation.
4. **Resolution** — scoped name resolution per the KerML rules (owned members →
   inherited members → imports incl. recursive/filtered → enclosing namespaces →
   global `$`), visibility, aliases, short names, feature chains.
5. **Implied relationships** — the OCL `check` constraints: implicit
   specializations (`PartDefinition` ⟶ `Parts::Part`, part usages ⟶
   `Parts::parts`, etc.), implicit typing, implied redefinitions of parameters.
   This is what makes inheritance, rollups and library semantics correct.
6. **Validation** — OCL `validate` constraints as errors/warnings, plus the
   house W-code catalogue (unsatisfied/unverified requirements, port direction
   mismatches, naming conventions…), each with stable codes and quick-fixes.
7. **Derived queries** — membership closure, specialization closure, feature
   inheritance, trace/coverage, view content.

Incrementality: files are the unit of invalidation. A keystroke reparses one
file (tree-sitter incremental), re-lowers it, and re-resolves only dependents
(reverse-import index). Target: < 30 ms to updated diagnostics for a 2k-line
file in a 50k-line project.

### 4.2 Element identity

Textual notation carries no element IDs, but the JSON interchange and the API
require stable `elementId`s (UUIDs).

- **Normative library scheme, reused for user models** (KerML 9.1):
  a top-level element gets `uuid5(NameSpace_URL, baseUri + name)`; everything
  inside it gets `uuid5(topLevelId, path())`, where `path()` is the qualified
  name or, for unnamed elements, the owner's path plus 1-based positions in
  `ownedRelationship`/`ownedRelatedElement`. For the standard library,
  `baseUri` is `https://www.omg.org/spec/KerML/` or `…/SysML/`; for a project it
  is the project URI (from `.sysml-web/project.json`, defaulting to the git
  remote URL). Verified: `sysml-semantic` reproduces all 404,686 library ids.
- **Ids depend on implied relationships and SysML naming rules**: unnamed
  features are named through implied redefinitions (an unnamed return parameter
  is `result`), and conjugated ports, perform/exhibit/include, requirement
  constraints and variants have naming overrides. Phase 1 must compute these
  before ids are assigned.
- **Rename stability**: renames done in-app (and by `sysml rename`) record
  `oldPath → id` in `.sysml-web/ids.json` so IDs survive refactors. Files edited
  elsewhere just get fresh IDs for genuinely changed paths — acceptable because
  the text remains authoritative.

### 4.3 Standard library

The 94 `sysml.library` files are parsed and resolved **at build time** into a
compact pre-resolved binary index shipped as a static, cacheable asset (and
cached in IndexedDB). Startup never reparses the library. Library version is
pinned and shown in the UI; projects may override it.

### 4.4 Editing API

All mutations go through `EditOp`s:

```
AddMember{owner, kind, name, typedBy?, multiplicity?, …}
SetName / SetShortName / SetTyping / AddSpecialization / RemoveRelationship
Connect{owner, from: featureChain, to: featureChain, kind: connection|interface|flow|binding|succession}
AddTransition{from, to, trigger?, guard?, effect?}
SetMetadata{element, metadataDef, fields}
Delete{element} · Move{element, newOwner} · Rename{element, newName}  (rename updates references)
```

The engine returns `TextEdit[]` produced by `codegen::edit` + the formatter
(house style from SYNTAX-REFERENCE: PascalCase defs, camelCase usages,
4-space indent), re-parses the result **before** returning it, and refuses edits
that introduce syntax errors. The UI applies the edits as a single CodeMirror
transaction, so text and visual edits share **one undo stack**.

---

## 5. Diagrams and views

### 5.1 Diagrams are SysML views

A saved diagram is a **SysML `view` usage in the model**, typed by the standard
view definition and selecting content with `expose`/`filter`:

```sysml
view droneStructure : StandardViewDefinitions::GeneralView {
    expose DroneArchitecture::**;
    filter @SysML::PartUsage or @SysML::PartDefinition;
}
```

Other conformant tools therefore see *which* diagrams exist and *what* they
show. Only coordinates are tool-specific, because diagram interchange/layout is
not standardised until SysML v2.1.

- **Layout sidecar**: `.sysml-web/layout/<view-qualified-name>.json` keyed by
  element ID (positions, sizes, collapsed compartments, routed bend points).
  Missing or stale entries fall back to automatic ELK layout, so a diagram always
  renders and merges cleanly. When v2.1 standardises layout we migrate.
- **Ad-hoc diagrams** (right-click → "Show in General View") need no model
  change until the user pins/saves them.

### 5.2 The eight standard views

| View | Delivery | Notes |
| --- | --- | --- |
| Browser View | Phase 2 | Explorer tree; membership, filters, library toggle |
| General View | Phase 2 (read and visual editing) | defs (square) vs usages (rounded), `«kind»` name compartment, textual compartments, composite/referential diamonds, specialization, satisfy/verify/allocate edges |
| Interconnection View | Phase 2 (read and visual editing) | nested parts, ports on borders, connections, interfaces, bindings (`=`), item flows; replaces IBD & parametric |
| Grid View | Phase 3 | requirements table, trace/allocation/DSM matrices, `@TableRendering` views |
| Action Flow View | Phase 5 | start/done, decide/merge diamonds, fork/join bars, successions, flows, pins, send/accept, swimlanes via allocation |
| State Transition View | Phase 5 | states, regions, `trigger [guard] / effect`, entry/do/exit compartments |
| Sequence View | Phase 5 | lifelines, messages, event occurrences |
| Geometry View | Later (stretch) | no known tool implements it; 3D via three.js once the rest is solid |

Rendering: Svelte Flow for interaction (selection, drag, connect handles,
minimap, viewport) with hand-built SVG node components faithful to the book's
notation; elkjs in a worker for layered layout and orthogonal edge routing.
Export to SVG/PNG/PDF with resolved theme colours (sysml-studio's PNG bug).

### 5.3 Visual editing

Palette → drop to create; drag from a port to connect; inline rename;
inspector forms for typing, multiplicity, redefinition, doc; delete with impact
preview. Each gesture becomes an `EditOp` → `TextEdit[]`. The split view shows
the text diff highlighting as you draw.

---

## 6. Interchange and conformance

KerML defines four conformance points: **abstract syntax** and **model
interchange** (both required), plus **concrete syntax** and **semantic**. We
target all four, with partial semantic conformance explicitly scoped.

| Format | Direction | Phase |
| --- | --- | --- |
| Textual notation `.sysml`/`.kerml` | read/write (source of truth) | 1 |
| JSON (KerML Clause 10 / Systems Modeling API JSON schema) | export 1, import 7 | 1 / 7 |
| Project interchange `.kpar` (zip of model files + project/meta JSON) | import/export | 7 |
| Systems Modeling API (REST: projects, branches, commits, elements, queries) | push/pull a commit to/from any API server | 7 |
| XMI | export (import if demand) | later |

Importing JSON or API models with no source text uses the engine's
**pretty-printer** to generate canonical text, which then becomes the source of
truth.

### Conformance test strategy (CI, every PR)

1. **Parse**: all OMG `SysML-v2-Release` examples, training and validation files
   plus the stdlib — zero errors (the grammar's existing sweep).
2. **Resolve**: same corpus — zero unresolved references, zero spurious
   diagnostics.
3. **Differential**: export JSON for the corpus and diff against the OMG pilot
   implementation's JSON for the same files (element types, owned relationships,
   resolved targets, and library element IDs). Pilot outputs are generated once
   per library version and committed as golden files.
4. **Round-trip**: text → JSON → text → JSON is a fixed point; text → edit ops →
   text preserves untouched bytes exactly (fidelity suite).
5. **Validation**: pass/fail model pairs per OCL constraint; adopt the
   Conformance Working Group suites when published.
6. **Book fixtures**: the ~150 example models from *The SysML v2 Book*,
   including the multi-file drone example.

A public **conformance dashboard** page (generated from CI) is a feature: it is
how we earn trust as an interchangeable tool.

---

## 7. Experience design — SysML, made approachable

**Design target.** SysML v2 is the product, not an implementation detail. The
app brings engineers who today keep requirements in documents, interfaces in
spreadsheets and architecture in slide decks into real model-based work — by
making the language itself easy to read, write and draw, rather than hiding it
behind forms. Someone new to MBSE should build a small, correct model in their
first session and understand what they built; an MBSE expert should find a
fast, standards-faithful workbench that never gets in the way.

### 7.1 Principles

1. **Two equal ways to build a model: text and diagrams.** Write SysML in the
   editor or draw it on a diagram; both edit the same text and update each
   other live. Neither is a second-class view of the other.
2. **The language is visible and explained.** Every keyword, element and
   relationship can explain itself in plain words (hover, inspector, "What is
   this?"), with a short example. Newcomers learn SysML by using it, not by
   reading the specification first.
3. **Guidance in the flow of work.** Context-aware "add" actions (in text,
   on diagrams and in the explorer) offer the elements that make sense where
   you are — a port on a part, a transition from a state, `satisfy` on a
   requirement — and write idiomatic SysML for you. Templates and starter
   models show good structure.
4. **Problems explained, with a fix.** "`Battery` is used here but never
   defined — create it?" rather than an error code; one click applies the fix.
5. **Standard views, not bespoke screens.** Requirements lists, trace
   matrices, interface tables and FMEA worksheets are SysML Grid views over the
   model (§5), useful for reading and reviewing; authoring happens in text,
   diagrams and the inspector.
6. **Modern tooling for everyday practice.** Documents become model views and
   generated reports; spreadsheets become typed, linked elements; email review
   becomes branches, diffs and comments; "which version is current?" disappears
   because the model lives in git.
7. **Works everywhere.** Full authoring on desktop; reading, reviewing,
   navigating and light editing on phones and tablets. Fast first load,
   installable, offline-capable; Lighthouse ≥ 90 on every category, mobile and
   desktop (§7.6).

### 7.2 The workbench

```
┌ ◆ Drone UAV ▾  main ▾ ● 2 unsaved ──────── ⌘K  Search, go to or create… ──────────── ◐  ☺ ┐
├──────────────┬───────────────────────────────────────────┬────────────────────────────────┤
│ EXPLORER     │ Structure.sysml ×  ◇ Drone structure ×    │ INSPECTOR                      │
│ ▾ Drone      │┌─────────────────────┬───────────────────┐│ «part» airframe : Airframe     │
│  ▾ Structure ││ part def Drone {    │  ┌─────────────┐  ││ A part is one component used   │
│    ◇ Drone   ││   part airframe :   │  │ «part def»  │  ││ in the system. ▸ Learn more    │
│    ◇ Battery ││     Airframe;       │  │   Drone     │  ││ ─────────────────────────────  │
│  ▸ Behaviour ││   part battery :    │  ├─────────────┤  ││ Name      airframe             │
│  ▸ Require…  ││     Battery;        │  │ airframe    │  ││ Type      Airframe ▾           │
│ VIEWS        ││   …                 │  │ battery     │  ││ Multiplicity  1                │
│  ◇ Structure ││                     │  └──────┬──────┘  ││ Satisfies  SYS-003 ✓           │
│  ◇ Delivery  ││  + Add part  port … │      ◆──┴──◆      ││ + Add attribute · port · …     │
│  ▦ Reqs      │└─────────────────────┴───────────────────┘│                                │
├──────────────┴───────────────────────────────────────────┴────────────────────────────────┤
│ PROBLEMS 2 · `Battery` has no `mass` attribute — add one?                     REFERENCES   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Explorer** — the model as a tree (packages, definitions, usages) with an
  optional *Files* mode; **Views** lists the model's saved views plus built-in
  ones. Every node has "Add…" for the elements that fit there.
- **Editor area** — tabs for SysML files and diagrams; any tab can split
  side by side. *Text + diagram split* is the signature layout: selecting in one
  selects in the other; typing redraws the diagram; drawing writes the text.
- **Inspector** — the selected element's kind explained in one sentence, its
  properties as an editable form (name, type, multiplicity, value, doc,
  metadata), its relationships (specializes, satisfies, verified by, allocated
  to, connected to) with "Add relationship…", and where it appears.
- **Problems / References** panel; **⌘K** command palette for go to, create
  anything, run a view, switch project.
- **Mobile** — one pane at a time with a bottom bar (Explorer · Text · Diagram ·
  Inspector); diagrams pan and pinch-zoom; the inspector becomes a bottom sheet.
  Optimised for reading, reviewing and small edits.

### 7.3 Building in text

CodeMirror 6 driven by the engine (Web Worker):
- Highlighting from the grammar's `highlights.scm`; folding; outline.
- Completion for keywords, names in scope and standard-library types
  (`ISQ::mass`, `SI::kg`), with snippets that teach structure
  (`part def … { }`, `requirement … { doc /* */ subject …; }`).
- Hover: what the element is, its definition, its doc, and a plain-language
  explanation of the keyword.
- Go to definition, find references, rename everywhere, code actions for
  quick fixes, format document.
- "Add…" lenses above definitions (add port, add attribute, add requirement).

### 7.4 Building in diagrams

Svelte Flow canvas with SysML notation (§5.2), laid out by ELK:
- **Palette** filtered to the view type (General: part def, part, port,
  requirement, connection, satisfy…; Interconnection: part, port, connection,
  flow, interface; later Action Flow and State).
- Drop to create; drag between ports to connect; double-click to rename; edit
  multiplicity and type inline; delete with an impact preview.
- Every gesture is an engine `EditOp` that becomes a minimal text patch, shown
  as a highlighted change in the split text view — so drawing teaches the text.
- Views are saved as SysML `view` usages; positions in a layout sidecar (§5.1).

### 7.5 Learning SysML in the app

- **Guided tour** of the demo model (stops defined in the demo's `TOUR.md`).
- **Concept cards**: one-sentence explanations and minimal examples for every
  element kind, shown in hover, inspector and the "+ Add" menus.
- **Starter templates**: blank, product architecture, requirements-first,
  safety-critical; each a small, well-structured model.
- **"Show me in SysML"** wherever a table or diagram shows something, so
  nothing is magic.

### 7.6 Quality bar: fast, accessible, everywhere

- Lighthouse CI on landing and workbench pages, mobile and desktop presets:
  performance ≥ 0.9, accessibility = 1.0, best practices ≥ 0.95, SEO ≥ 0.9.
- Engine (WASM) and editor load lazily after first paint; diagrams and
  CodeMirror are code-split; fonts self-hosted and subset.
- WCAG 2.1 AA (axe in e2e); keyboard-operable diagrams; touch targets ≥ 44 px.
- Responsive from 360 px phones to wide desktops; installable PWA, offline.
- Offline (`src/service-worker`, rules in `src/lib/offline/caching.ts`): the
  worker registers after load and precaches the shell (prerendered pages, the
  `404.html` SPA fallback that opens stored `/p/<id>` links, hashed JS/CSS/fonts,
  icons), served cache-first. The ~10 MB engine is never precached: it is cached
  on first use (cache-first after), and the page asks the worker to fill in
  missing engine files when idle after the engine starts. Caches are named by
  build version and old ones deleted on activate; an unchanged engine (same
  `engine/build.json`) carries over. Other origins (GitHub) and non-GET requests
  go to the network, uncached. A new version waits for "Reload" in a toast,
  which saves pending edits first; there is no automatic `skipWaiting`.

### 7.7 Visual language

Calm, typographic and dense without clutter. Inter for UI, JetBrains Mono for
SysML. A neutral palette with one accent; colour encodes element kind and
status consistently across text, diagrams and inspector, always paired with a
label or shape. Light, dark and high-contrast themes; reduced motion respected.

Element families — structure, interface, behaviour, requirement, analysis,
package, view — each have a colour token (`--kind-*`) used for diagram node
headers, explorer and inspector glyphs. Glyph corners repeat the SysML
definition/usage distinction (square vs round). Delight comes from craft:
live text ⇄ diagram sync, every edit revealed in the text, undo on every
gesture, ⌘K to reach anything, and motion that is quick and optional.

## 8. Engineering practice on the model

The app supports the practices systems and quality engineers already have by
expressing them in SysML and providing views over the model. Semantics live in
SysML libraries so they travel with the model to other tools.

| Practice today | In the model | Views and tools |
| --- | --- | --- |
| Requirements documents | `requirement` elements with IDs, text, rationale, status (`ModelingMetadata`), derivation (`RequirementDerivation`) | requirements Grid view, derivation tree, "Generate specification" report |
| Traceability spreadsheets | `satisfy`, `verify`, `allocate`, derivation connections | trace matrix, coverage, gaps with fixes, impact analysis |
| Block diagrams and ICDs in slides | parts, ports, interfaces, items, connections | General and Interconnection views, interface Grid view, ICD report |
| Functional flows | actions, successions, flows, `perform`, allocation | Action Flow view (Phase 5) |
| Modes and states | state machines | State Transition view, simulation (Phase 5) |
| Test plans | verification cases with objectives and `verify` | verification matrix, coverage |
| FMEA and hazard logs | `RiskAnalysis` / `HazardAnalysis` libraries | FMEA and risk-matrix Grid views (`@TableRendering`), RPN calc |
| Budgets (mass, power) | attributes with units, calcs, constraints | roll-ups, constraint checks |
| Design reviews | git branches, commits | semantic diff, review mode (Phase 4) |

On-ramps for existing material (later phases): import a requirements
spreadsheet or document outline into `requirement` elements with a preview of
the generated SysML; export any Grid view to CSV/XLSX and reports to
Markdown/PDF for people outside the tool.

### 8.1 Perspectives: one model, two ways to read it

Some people think in models and diagrams; others think in documents — a
requirements specification, an ICD, a test plan. Rather than two products,
the workbench offers **perspectives** over the same SysML:

- **Model** (default): explorer, text, diagrams and inspector, as today.
- **Document** (later phase): the model read as a living specification.
  Chapters are SysML views (`view` usages with `expose` and
  `@TableRendering`/`render`), so the document's outline is itself part of
  the model and travels to other tools. Paragraphs are element `doc`s and
  requirement texts; tables are the same engine-rendered views; editing a
  sentence or a cell writes SysML through the same minimal-patch edits. A
  toggle switches perspective without changing the selection.

Nothing in the document perspective is stored outside the model, so it
cannot drift from it, and anyone using the model perspective sees the same
changes as SysML.

### Deferred: operational records
Test executions and verdicts, NCRs, CAPAs and inspection results are out of
scope for now.

---

## 9. Git and collaboration

Reuse mycelium-web's proven stack: isomorphic-git in OPFS; GitHub App /
GitLab / Bitbucket OAuth with PKCE via a stateless Worker; PAT fallback; local
commits on save; explicit **Sync**; three-way merge; side-by-side conflict
resolver; branch switching. SysML-specific additions:

- **Semantic diff & merge assist**: show element-level changes; for textual
  conflicts, offer resolution per element.
- **Review mode**: open a PR/MR branch, see semantic diff + changed diagrams.
- **Multi-file projects**: `.project.json`-style project config (aligned with
  the `.kpar` metadata) declaring source roots, library packs, stdlib version.
- **Local folder** mode (File System Access API) for engineers who also use
  Emacs/CLI on the same checkout.

Real-time co-editing is out of scope for v1 (git-based async collaboration
fits engineering review culture); the architecture (text patches, worker
engine) leaves room for a CRDT layer later.

---

## 10. Technology decisions

| Area | Decision |
| --- | --- |
| App shell | SvelteKit 3 static SPA (adapter-static) + Svelte 5 |
| Engine | Rust → `wasm32-unknown-unknown` via wasm-bindgen, in a Web Worker; tree-sitter-sysml compiled in (spike passed) |
| Text editor | CodeMirror 6; semantic tokens, diagnostics, completion, hover, go-to, rename, folding, code actions from the engine |
| Diagrams | `@xyflow/svelte` + custom SVG nodes; `elkjs` in a worker |
| Tables | Virtualized grid (TanStack Table core + own Svelte rendering) |
| Git | isomorphic-git + OPFS (lightning-fs fallback) |
| Auth/proxy | Cloudflare Worker (stateless, no logs, origin/host/path allowlists), self-hostable |
| Storage | IndexedDB (Dexie) for caches/library index/prefs |
| Search | MiniSearch over names, short names, docs, requirement text |
| Testing | Rust unit + corpus tests; Vitest; Playwright + axe e2e; fidelity and conformance suites |
| Hosting | GitHub Pages (or Cloudflare Pages); PWA, offline-capable |
| Licence | `Apache-2.0 OR MIT` (see §11a) |

---

## 11. Repository layout (target)

```
/
├─ src/                       SvelteKit app
│  ├─ app/                    workbench, views, components
│  ├─ lib/engine/             worker client, typed RPC, snapshot store
│  ├─ lib/editor/             CodeMirror SysML integration
│  ├─ lib/diagram/            Svelte Flow nodes/edges, ELK worker, notation
│  ├─ lib/git/ lib/auth/      (from mycelium-web)
│  └─ demo/                   drone demo project
├─ libraries/                 bundled library packs (domain libraries)
├─ worker/                    Cloudflare Worker (from mycelium-web)
├─ docs/
└─ .github/workflows/         ci, conformance, deploy
```

### The engine lives in `jackhale98/sysml-cli`

*Superseded by decision #16: the app runs on the Open-MBEE sysml-toolkit
(`docs/engine.md`). This section records the earlier plan.*

The engine is built in place in the `sysml-cli` Rust workspace rather than
copied here, so the CLI, LSP and web app share one engine from the start.

```
sysml-cli/crates/
├─ sysml-core/          existing; migrated module by module onto the crates below
├─ sysml-semantic/      NEW element graph, element IDs, resolution, implied rels, validation
├─ sysml-interchange/   NEW JSON (API schema), .kpar, pretty-printer, (XMI)
├─ sysml-wasm/          NEW wasm-bindgen API + worker protocol types
├─ sysml-cli/           gains `export/import --format json|kpar`, `conformance`
└─ sysml-lsp/           moves onto sysml-semantic (fixes simple-name index collisions)
```

Changes in `sysml-cli`:

1. Relicense to `Apache-2.0 OR MIT`.
2. Gate `std::fs` code (`resolver::Project::from_directory`, `config`, `project`)
   behind a `fs` feature; add a `wasm32-unknown-unknown` CI build (spike recipe).
3. Build `sysml-semantic` beside `sysml-core`; keep `sysml-core`'s public API
   working through an adapter while checks, queries, `view_render`, sims and
   codegen move over one at a time, so the CLI never breaks.
4. Prebuilt standard-library index generated at build time.
5. Conformance suite in CI: OMG corpus parse + resolve, pilot JSON diff,
   round-trip fidelity.
6. Releases publish the `sysml-wasm` package (npm + GitHub Release asset); this
   app pins a version and upgrades deliberately.

`tree-sitter-sysml` needs its licence metadata fixed (and relicensed) and the
`satisfy … by` GLR ambiguity resolved (`prec.dynamic`), ideally in the same pass.

---

## 11a. Licensing

The app, engine and worker are dual-licensed **`Apache-2.0 OR MIT`** (the Rust
ecosystem convention) to maximise adoption and integration.

| Component | Current licence | Action |
| --- | --- | --- |
| `tree-sitter-sysml` | GPL-3.0-or-later (`package.json`) but MIT (`Cargo.toml`) — inconsistent | Relicense to `Apache-2.0 OR MIT` and make the metadata consistent (sole author) |
| `sysml-cli` workspace (engine) | GPL-3.0-or-later | Relicense to `Apache-2.0 OR MIT` (sole author) |
| `mycelium-web` code (git, auth, shell) | GPL-3.0 because of uniorg; our own code otherwise | Reuse own code under the new licence; uniorg is not needed here |
| `mycelium-web` worker | Apache-2.0 | Compatible |
| OMG `sysml.library` | EPL-2.0 (SysML v2 Release 2026-05 and later) | Served unmodified from the sysml-toolkit's bundle (`static/toolkit/stdlib/`, with the toolkit's `LICENSE-EPL-2.0` and `THIRD-PARTY-NOTICES.md` next to it); its licence and notice are shown in the app's standard-library browser and in Settings → About |
| `sysml-domain-libraries` packs | per that repo | Confirm before bundling |
| Third-party npm/crates | various | Allowlist permissive licences in CI (`cargo deny`, `license-checker`) |

---

## 12. Phases

Each phase ends in something usable and demoable; vertical slices over breadth.

**Phase 0 — Foundations & spikes**
- ~~Spike A: tree-sitter + grammar + Rust → WASM~~ — **passed** (5.1 MB raw,
  285 KB brotli; 3–10 ms parses; recipe in `docs/spikes/wasm-engine.md`).
- ~~Spike B: element-ID scheme~~ — **settled and verified** against all
  404,686 library ids (`sysml-cli` `sysml-semantic`). JSON element shape is
  pinned in Phase 1 against the library XMI and the pilot.
- ~~Engine crates~~ (`sysml-semantic`, `sysml-interchange`, `sysml-wasm`),
  relicensing, wasm CI — `sysml-cli` PR #1; grammar PR #1.
- ~~SvelteKit app scaffold~~, CI, Pages deploy. ~~Design system, app shell and
  engine worker integration with the demo project~~ — landing page, project
  shell (first iteration, since replaced by the §7.2 workbench), Overview, read-only Requirements grid with detail
  panel ("Show SysML"), Model browser; engine built from the pinned
  `sysml-cli` revision (`engine.json`, `scripts/build-engine.sh`) and run in a
  Web Worker; e2e + axe tests pass with zero violations.
- ~~_Exit_: the demo project opens in the browser, analysed by the WASM engine,
  inside the real app shell.~~ **Met.**

Found in Phase 0, to address in Phases 1–2:
- The engine analyses files one at a time, so cross-file references produce
  false warnings (W004 unresolved types, W016 unbound ports). Phase 1's
  project-level semantic model removes them.
- Coverage ignores `#derivation` links, so stakeholder needs appear as gaps
  even when their derived requirements are covered; requirement checks also
  fire on library `requirement def`s.
- W013 (camelCase) flags quoted titles; it should respect the project's name
  style (§7.3).

Engine gaps found while authoring the demo (inputs to Phase 1):
- Name resolution does not follow features of imported usages' types
  (`drone.deliveryFlight.takeOff`, W005); W016 port checks are single-file;
  W001 ignores references through calc calls, `perform`, `exhibit`, `accept`.
- Requirement checks fire on library `requirement def`s whose usages are
  traced; W013 flags quoted titles; trace ignores `#derivation`.
- The guarded `then decide; if … then a; else b;` form is mis-parsed as an
  if-action, so flows after the merge are dropped.
- Interconnection diagrams omit flows, bindings and inherited ports; General
  View shows only definitions and compositions; view usages are not rendered.
- `analyze`/`rollup` cannot evaluate subject attributes or usages.

**Phase 1 — Semantic engine core and editor services**
- Lowering, element graph, resolution, imports, implied relationships,
  prebuilt stdlib index, project-wide diagnostics, JSON export.
- Editor services from the engine: highlight tokens, outline, hover (with
  concept explanations), completion, go to definition, references, rename,
  quick fixes, formatting; diagram graphs for General and Interconnection
  views; `EditOp`s → minimal text edits.
- _Exit_: official corpus resolves with zero errors; drone JSON matches the
  pilot on the compared properties; < 30 ms incremental re-check.

**Phase 2 — Build a model two ways (first user-facing release)**
- Workbench (§7.2): explorer, CodeMirror editor with full language support,
  live General and Interconnection diagrams, linked selection, inspector with
  editable properties, problems with fixes, ⌘K, unified undo; visual editing
  on both diagram types (create from palette, connect ports, rename, retype,
  delete); saved views as SysML with layout sidecar; open demo / local folder /
  download; mobile layout; guided tour of the demo; Lighthouse budgets met.
- _Exit_: someone new to MBSE follows the tour, then builds a small system —
  requirements, parts, ports, connections, satisfy links — by drawing and by
  typing, and the result is clean, conformant SysML.

**Phase 3 — Requirements, traceability and views**
- Requirement concept cards and templates, derivation tree, Grid views
  (requirements, trace matrix, interfaces) defined as SysML views, coverage and
  impact analysis, generated reports (specification, ICD).

**Phase 4 — Git & collaboration**
- OAuth sign-in, Save version / Share / Propose change (commit, push, branch,
  PR), conflict resolver, semantic diff and review mode.

**Phase 5 — Behaviour**
- Action Flow, State Transition and Sequence views (read, then visual
  editing); state/action simulation; roll-ups and trade studies.

**Phase 6 — Verification, risk and on-ramps**
- Verification cases and matrix; FMEA and hazard views over the risk
  libraries; requirement quality checks; quality gates; spreadsheet/document
  import to `requirement` elements; CSV/XLSX/PDF exports.

**Phase 7 — Interchange**
- JSON import, `.kpar` import/export, Systems Modeling API client (push/pull
  commits), conformance dashboard page; XMI export if demanded.

**Phase 8 — Polish**
- Performance at 100k lines, offline/PWA, accessibility audit, user guide,
  self-hosting docs, CLI/LSP migration onto the shared engine.

---

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| KerML semantics are deep; partial resolution produces false errors | Differential testing against the pilot from Phase 1; scope semantic conformance explicitly; never block editing on semantic errors |
| WASM bundle size (38 MB generated `parser.c`) | Measured: 285 KB brotli for the parser; budget ≤ 1.5 MB brotli for the full engine; lazy-load after first paint; prebuilt stdlib index as a separate cached asset |
| Diagram layout not standardised until v2.1 | Views as SysML now, coordinates in a sidecar keyed by element ID; migrate when v2.1 lands |
| Element ID stability across external edits | Deterministic IDs + rename map; text stays authoritative |
| Scope (this is a lot) | Vertical slices, every phase shippable; engineering features expressed as library packs rather than bespoke UIs |
| Adoption | Zero-install demo, beautiful defaults, conformance dashboard, GitHub Action, interop with SysON/pilot via JSON/API |

---

## Decision log

| # | Decision | Date |
| --- | --- | --- |
| 1 | One shared Rust semantic engine compiled to WebAssembly (web, CLI, LSP) | 2026-10-21 |
| 2 | Operational records (test runs, NCR, CAPA, inspections) deferred | 2026-10-21 |
| 3 | Static app + git only; no backend holds data; stateless proxy worker; optional Systems Modeling API client | 2026-10-21 |
| 4 | Licence `Apache-2.0 OR MIT`; relicense own grammar/core code; OMG library bundled under its own licence (EPL-2.0, the 2026-05+ release the toolkit bundles) | 2026-10-21 |
| 5 | SvelteKit (static SPA) + Svelte 5; reuse mycelium-web's git/auth/worker code but **not** its structure or UI | 2026-10-21 |
| 7 | ~~Object-first, spreadsheet-like UX~~ — superseded by #9 | 2026-10-21 |
| 9 | SysML is the product: a workbench where text and diagrams are equal ways to build the model, made approachable through in-context explanation and guidance; tables are SysML views, not the editing paradigm | 2026-10-21 |
| 10 | Mobile and desktop are both first-class; Lighthouse ≥ 0.9 (a11y 1.0) enforced in CI | 2026-10-21 |
| 11 | The demo model is authored and reviewed with the highest-capability model; it is the primary onboarding surface | 2026-10-21 |
| 12 | Every table is a SysML view rendered by the engine (`renderView`); standard tables ship as `ModelViews.sysml`, so tables are reproducible in any conformant tool | 2026-10-21 |
| 13 | Diagrams follow SysML v2 graphical notation strictly (definitions square, usages rounded, standard edge adornments, diagram frames); element families add colour, never replace shape | 2026-10-21 |
| 14 | A document-centric reading of the model is offered as a *perspective* over SysML views, not as a separate data model | 2026-10-21 |
| 16 | Move the app onto the Open-MBEE sysml-toolkit engine (one core, maintained by an organisation) in place of our own `sysml-cli` engine; features the toolkit lacks are written in TypeScript over its model; the app switches to it directly (no users yet), porting piece by piece behind one engine interface | 2026-10-21 |
| 15 | Spreadsheets in and out without a spreadsheet library: hand-written OOXML and a small ZIP over the browser's `CompressionStream`; imported requirements become SysML written the way the engine's own edits write it (one `insertMember` per import, checked against the engine in tests), in one undoable change | 2026-10-21 |
| 8 | Element ids use the normative KerML 9.1 scheme for library and user models alike (project URI as base) | 2026-10-21 |
| 6 | Engine built in the `sysml-cli` workspace (new `sysml-semantic`, `sysml-interchange`, `sysml-wasm` crates); this app consumes its WASM release | 2026-10-21 |

## Open questions

1. **Name and domain** for the product.
2. **Element-ID scheme**: confirm deterministic UUIDv5 + rename map after
   spike B compares against the pilot implementation.
