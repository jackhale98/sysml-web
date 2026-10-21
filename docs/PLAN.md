# SysML Web — Implementation Plan

A beautiful, fast, standards-conformant **web app for systems engineering on
SysML v2**, where the SysML text in a git repository is the single source of
truth. People work with requirements, components, interfaces, tests and failure
modes through spreadsheets, forms and diagrams — no SysML knowledge needed —
while MBSE experts get the full language, a text editor and the standard views
over the same files. Every change lands as a minimal, reviewable diff to
`.sysml` files that any other conformant tool can read.

Status: **Phase 0 in progress** (see [Decision log](#decision-log)).
- Engine → WebAssembly: done ([docs/spikes/wasm-engine.md](spikes/wasm-engine.md));
  `sysml-wasm` builds in `sysml-cli` CI.
- Element identity: verified against all 404,686 OMG library element ids.
- Interchange reference: [docs/reference/interchange.md](reference/interchange.md).

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
8. **Usable without knowing SysML.** Object-first screens in plain language
   for the person coming from Excel; full SysML depth one click away for the
   expert (see §7).

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
| General View | Phase 2 read · Phase 3 edit | defs (square) vs usages (rounded), `«kind»` name compartment, textual compartments, composite/referential diamonds, specialization, satisfy/verify/allocate edges |
| Interconnection View | Phase 2 read · Phase 3 edit | nested parts, ports on borders, connections, interfaces, bindings (`=`), item flows; replaces IBD & parametric |
| Grid View | Phase 6 | requirements table, trace/allocation/DSM matrices, `@TableRendering` views |
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

## 7. Experience design — object-first, SysML underneath

**Design target:** an engineer who has been managing requirements in Excel and
has never heard of SysML is productive in the first ten minutes, and never has
to see SysML unless they want to. An MBSE expert gets full-fidelity SysML text,
the standard diagrams and every metamodel concept, in the same app, over the
same files.

### 7.1 Principles

1. **Things, not notation.** People work with *requirements, components,
   interfaces, functions, tests, failure modes* — plain words, plain forms.
   SysML vocabulary (`part def`, usage, redefinition) appears only in the
   advanced views and in an opt-in "Show SysML" panel.
2. **Spreadsheets where people expect spreadsheets.** Requirements, FMEA,
   interfaces and test matrices are grids with keyboard navigation, inline
   editing, fill-down, multi-select, copy/paste to and from Excel, sorting,
   filtering, grouping and saved column layouts.
3. **Every object has a page.** One canonical page per item: its fields, its
   relationships ("Satisfied by", "Verified by", "Derived from", "Allocated
   to", "Failure modes"), its discussion of issues, its history, and where it
   appears in diagrams. Everything links.
4. **Relationships are made by picking, not typing.** Pickers search the whole
   model by ID, name and text; drag a row onto a component to link it; bulk-link
   from a grid selection.
5. **Guided creation.** "+ New" offers plain templates (Requirement, Component,
   Interface, Function, Test case, Failure mode, Hazard). Each form asks only
   what is needed and generates conformant SysML; the live preview teaches the
   notation to those who look.
6. **Plain-language feedback.** "REQ-012 has no verification yet" and "Battery
   is used but never defined", with one-click fixes — not `W004`.
7. **Nothing is lost, everything is reviewable.** Autosave locally; "Save
   version" commits; "Share" pushes; "Propose change" opens a branch/PR. History
   is shown as what changed in engineering terms.
8. **Expert depth on demand.** The Model area exposes the browser tree, text
   editor, all standard views, specialization/redefinition, raw metadata and
   validation codes. Experts and newcomers edit the same objects.

### 7.2 Information architecture

```
┌ ◆ Drone UAV ▾ ─────────── ⌘K Search or create… ─────────── ● 3 unsaved · Save version ─ ◐ ─ ☺ ┐
│ ▸ Overview          │                                                                            │
│ ▸ Requirements  128 │   Requirements  ▾ All  ▾ Group: Parent   ⚲ Filter   ⊞ Columns   ⇩ Export   │
│ ▸ System            │ ┌──────┬──────────────────────┬──────────────────┬──────┬────────┬───────┐ │
│ ▸ Interfaces        │ │ ID   │ Requirement          │ Text             │ Prio │ Status │ Verif │ │
│ ▸ Behaviour         │ ├──────┼──────────────────────┼──────────────────┼──────┼────────┼───────┤ │
│ ▸ Verification      │ │REQ-1 │ Flight time          │ The UAV shall fly│ High │ ● Appr │ Test ✓│ │
│ ▸ Risk              │ │REQ-2 │ Max take-off mass    │ The MTOW shall…  │ High │ ○ Draft│ —  ⚠  │ │
│ ─────────────────── │ │ …    │                      │                  │      │        │       │ │
│ ▸ Diagrams          │ └──────┴──────────────────────┴──────────────────┴──────┴────────┴───────┘ │
│ ▸ Model (advanced)  │                                            ┌ REQ-2 Max take-off mass ─────┐ │
│                     │                                            │ Text / Rationale / Status    │ │
│                     │                                            │ Satisfied by: + Airframe     │ │
│                     │                                            │ Verified by:  + Add test…    │ │
│                     │                                            │ ▸ Show SysML                 │ │
└─────────────────────┴────────────────────────────────────────────┴──────────────────────────────┘
```

| Area | For | What it shows | SysML underneath |
| --- | --- | --- | --- |
| **Overview** | everyone | Health: requirements coverage (satisfied/verified), open issues, risk heatmap, recent changes, quality gates | queries over the model; `QualityGate` constraints |
| **Requirements** | systems, quality | Requirements grid + tree (derivation hierarchy), object pages, Excel import/export | `requirement` usages, short-name IDs, `doc`, `@StatusInfo`, `@Rationale`, `derive`/`satisfy`/`verify` |
| **System** | systems, development | **Catalog** (component types) and **Structure** (the assembled system tree, BOM view), component pages, diagrams | `part def` = catalog entry, `part` usage = placed in structure |
| **Interfaces** | systems, development | Ports and interfaces table, connection matrix (N²), ICD export | `port def`, `interface def`, `connect`, `flow` |
| **Behaviour** | systems | Functions list, function flow, states | `action`, `state`, successions, transitions |
| **Verification** | test, quality | Test cases, verification matrix (requirement × test), coverage | `verification` cases with `verify`, method metadata |
| **Risk** | quality, safety | FMEA worksheet, risk matrix, hazard log, mitigations | `RiskAnalysis` `@Fmea`, `HazardAnalysis` occurrences, `satisfy`/`verify` for mitigations |
| **Diagrams** | everyone | Saved diagrams (General, Interconnection, Action Flow, State, Sequence, Grid) | `view` usages with `expose`/`filter` |
| **Model** | MBSE experts | Browser tree, text editor (split with diagram), all elements, validation codes, libraries | everything |

The **Catalog / Structure** split is how definition vs usage is taught without
saying it: like a CAD part library vs an assembly. Creating "Battery" adds a
catalog entry (`part def Battery`); placing it in the drone adds
`part battery : Battery` to the structure. The same pattern applies to
interfaces (types vs connections) and functions (definitions vs steps).

### 7.3 How plain objects map to SysML

House conventions keep the generated text idiomatic, readable and portable.
Standard-library metadata is used wherever it exists, so other tools understand
it; a small `EngineeringBasics` library (Apache-2.0, plain SysML, added to a
project on creation) fills the gaps, following the book's `CommonRequirement`
pattern.

```sysml
requirement <'REQ-002'> 'Max take-off mass' : EngineeringRequirement {
    doc /* The maximum take-off mass shall not exceed 2 kg. */
    :>> kind = RequirementKind::performance;
    :>> priority = Priority::high;
    :>> verificationMethod = VerificationMethod::test;
    @ModelingMetadata::StatusInfo { status = StatusKind::open; owner = "J. Hale"; }
    @ModelingMetadata::Rationale { text = "Regulatory class C1 limit."; }
}
satisfy 'Max take-off mass' by droneSystem.airframe;
```

| Field in the UI | Stored as |
| --- | --- |
| ID (`REQ-002`, auto-numbered, configurable prefix) | short name `<'REQ-002'>` |
| Title | name, quoted when it is not a plain identifier so titles survive exactly (project setting: keep titles, or derive `camelCase` identifiers) |
| Text | `doc` comment |
| Kind / priority / verification method | attributes redefined from `EngineeringRequirement` |
| Status / owner / originator | `ModelingMetadata::StatusInfo` |
| Rationale | `ModelingMetadata::Rationale` |
| Open question / issue | `ModelingMetadata::Issue` |
| Parent requirement | `#derivation connection` (`RequirementDerivation` library) |
| Satisfied by / verified by | `satisfy … by …`, `verify` in a verification case |
| Custom columns | project-defined metadata (`metadata def`) created from the UI |

The project keeps a predictable file layout managed by the app (users never
have to see it): `requirements/`, `system/`, `interfaces/`, `behaviour/`,
`verification/`, `risk/`, `views/`, `libraries/`, plus `.sysml-web/` for app
settings and diagram layout. Files written by hand or other tools anywhere in
the repository are read and edited in place.

### 7.4 Excel on-ramp

- **Start from a spreadsheet**: drop an `.xlsx`/`.csv`, pick the sheet, map
  columns to fields (auto-suggested from headers such as "ID", "Requirement",
  "Shall statement", "Priority", "Parent"), preview, import. Unmapped columns
  become custom fields. A project with real requirements exists in under a
  minute.
- **Paste** rows from Excel straight into the grid; **copy** rows back out.
- **Export** any grid (requirements, FMEA, verification matrix, BOM, ICD) to
  `.xlsx`/`.csv` with the same columns as on screen.
- **Round-trip re-import** matches rows by ID and shows a change preview before
  applying, so teams can keep using a spreadsheet during the transition.

### 7.5 Getting started

Landing → **Try the demo** (drone project, no sign-in) · **Start from a
spreadsheet** · **Open a repository** (GitHub/GitLab/Bitbucket) · **Open a
folder** · **New project** (choose a template: blank, product, safety-critical).
A three-step tour explains Requirements → System → Verification on the demo.

### 7.6 Visual language

Calm, typographic, information-dense without clutter. Inter for UI, JetBrains
Mono for IDs and SysML. A neutral palette with one accent; colour encodes
*status* (approved / draft / gap) and *kind* consistently across grids,
pages and diagrams, always paired with a shape or label (never colour alone).
Light, dark and high-contrast themes; 44 px touch targets; reduced motion
respected; every grid and diagram fully keyboard-operable; WCAG 2.1 AA checked
in CI.

## 8. Engineering workflows

Use cases the first releases must make easy, by role. Each is a set of views
over the same model; the semantics live in SysML libraries so they travel with
the model.

### Systems engineers
- Capture, refine and baseline requirements; derive child requirements and see
  the derivation tree.
- Build the system breakdown (catalog + structure), allocate requirements and
  functions to components.
- Trace: requirement ↔ component ↔ test, with gaps highlighted; impact analysis
  ("what is affected if Battery changes?").
- Interfaces: define ports/interfaces, connect components, N² matrix, ICD
  export.
- Budgets: mass/power/cost roll-ups with units; trade studies (later phase).
- Review: semantic diff between versions ("3 requirements changed, 1 component
  added") and propose changes for review.

### Quality engineers
- FMEA worksheet (design/process): item/function, failure mode, effect,
  severity, cause, occurrence, controls, detection, RPN (computed, never
  stored), actions, owner, status — with AIAG/VDA 1–10 scales and validation.
- Risk matrix (severity × likelihood) and action-priority view; hazard log with
  causal chains (failure mode → hazard → harm).
- Mitigations linked to risks (`satisfy`) and to their verification (`verify`):
  "which high-RPN risks lack a verified mitigation?" is one click.
- Requirement quality checks: missing verification method, ambiguous words
  ("should", "TBD", "as appropriate"), missing rationale, duplicates.
- Quality gates and completeness dashboard, enforceable in CI.

### Test / verification engineers
- Test cases (verification cases) with objective, method and the requirements
  they verify; verification matrix and coverage.
- Live evaluation of constraints and calculations as executable checks.
- Recording executions/verdicts is deferred with other operational records.

### Development engineers
- Component pages with interfaces, parameters, allocated requirements and
  functions; BOM export; tolerance stack-ups via the `Tolerancing` library
  (later phase).

### Deferred: operational records
Test executions and verdicts, NCRs, CAPAs and inspection results are **out of
scope for now**. The model holds definitions and plans (verification cases,
FMEA, quality gates); recording what happened against them comes later.

### Reports
Model-defined `view def` + `@TableRendering` views render as live tables and
export to CSV/XLSX/Markdown/PDF: requirements specification, verification
matrix, ICD, FMEA, BOM.

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
| OMG `sysml.library` | EPL-2.0 | Bundle unmodified as data with its licence and notice (file-level weak copyleft; compatible with an Apache/MIT app) |
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
  shell with the §7.2 areas, Overview, read-only Requirements grid with detail
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

**Phase 1 — Semantic engine core**
- Lowering, element graph, resolution, imports, implied specializations,
  prebuilt stdlib index, diagnostics, JSON export.
- _Exit_: official corpus resolves with zero errors; drone JSON matches the
  pilot on the compared properties; < 30 ms incremental re-check.

**Phase 2 — Requirements, end to end (first user-facing release)**
- Requirements grid and object pages with full editing (`EditOp`s → minimal
  text patches, unified undo, fidelity suite); `EngineeringBasics` library;
  derivation tree; plain-language checks; Excel/CSV import with column mapping,
  paste, export and round-trip re-import; open demo / local folder / download;
  ⌘K; Overview with coverage.
- _Exit_: someone with a requirements spreadsheet imports it, edits and links
  requirements, and gets clean, conformant SysML in a folder — without
  learning SysML.

**Phase 3 — System and diagrams**
- Catalog / Structure, component pages, allocation and satisfy links;
  Interfaces table and N² matrix; General + Interconnection views (read, then
  visual create/connect/rename/delete) with ELK layout and saved views as
  SysML; Model area with text editor (highlighting, diagnostics, completion,
  go-to, rename) split with diagrams.
- _Exit_: build the drone architecture without typing; experts see clean text.

**Phase 4 — Git & collaboration**
- OAuth sign-in, Save version / Share / Propose change (commit, push, branch,
  PR), conflict resolver, semantic diff and review mode.

**Phase 5 — Verification and Risk**
- Test cases, verification matrix and coverage; FMEA worksheet, risk matrix,
  hazard log, mitigations; requirement quality checks; quality gates; reports
  and XLSX exports.

**Phase 6 — Behaviour**
- Functions, Action Flow, State Transition and Sequence views (read then edit);
  state/action simulation; roll-ups and trade studies.

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
| 4 | Licence `Apache-2.0 OR MIT`; relicense own grammar/core code; OMG library bundled under EPL-2.0 | 2026-10-21 |
| 5 | SvelteKit (static SPA) + Svelte 5; reuse mycelium-web's git/auth/worker code but **not** its structure or UI | 2026-10-21 |
| 7 | Object-first UX in plain language, designed for Excel users; SysML depth on demand; Requirements is the first vertical slice | 2026-10-21 |
| 8 | Element ids use the normative KerML 9.1 scheme for library and user models alike (project URI as base) | 2026-10-21 |
| 6 | Engine built in the `sysml-cli` workspace (new `sysml-semantic`, `sysml-interchange`, `sysml-wasm` crates); this app consumes its WASM release | 2026-10-21 |

## Open questions

1. **Name and domain** for the product.
2. **Element-ID scheme**: confirm deterministic UUIDv5 + rename map after
   spike B compares against the pilot implementation.
