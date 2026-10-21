# SysML Web — Implementation Plan

A beautiful, fast, standards-conformant **web workbench for SysML v2** where the
SysML text in a git repository is the single source of truth. Systems, test,
quality and development engineers edit the same model through a text editor,
the standard diagrams, and purpose-built tables and worksheets — and every
change lands as a minimal, reviewable diff to `.sysml` files that any other
conformant tool can read.

Status: **planning — core decisions confirmed** (see [Decision log](#decision-log)).
Phase 0 spike A (engine → WebAssembly) has passed; see
[docs/spikes/wasm-engine.md](spikes/wasm-engine.md).

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

---

## 2. What we reuse

| Source | Reuse | How |
| --- | --- | --- |
| `tree-sitter-sysml` | Grammar (251/251 official corpus files parse; tree shape declared stable), `highlights/locals/folds/tags` queries | Compiled into the engine (WASM). Highlight query drives editor semantic tokens. |
| `sysml-core` (Rust) | Expression evaluator, units, rollups, uncertainty/Monte Carlo, state-machine + action simulators, analysis/trade study, `@TableRendering` view interpreter, 17 lint checks, formatter, `codegen::edit` byte-accurate edits, `DiagramGraph` builders | Ported into the new engine workspace on top of the new semantic graph (see §4). Same author/licence. |
| `sysml-lsp` | Completion, hover, references, rename, symbols, inlay hints, code actions logic | Re-expressed as engine queries called from CodeMirror over worker RPC (no LSP transport needed in the browser). |
| `mycelium-web` | Astro + Svelte 5 shell, design system/themes, isomorphic-git workspace in OPFS, provider adapters, OAuth + PKCE, stateless Cloudflare Worker (git proxy + token exchange), merge/conflict resolver, CI with axe + Playwright, PWA | Lifted largely as-is (`src/lib/git`, `src/lib/auth`, `worker/`, styles, app shell). |
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

- **Deterministic IDs** _(proposed)_: `UUIDv5(projectNamespace, canonical path)`
  where the canonical path is the qualified name plus, for anonymous elements
  (relationships, anonymous usages), the owning element's ID and member ordinal
  and kind. The same approach the pilot uses for library elements, so standard
  library IDs match other tools exactly.
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

## 7. Experience design

### 7.1 Workbench layout

```
┌ ⌘K ─ project ▾ ─ branch ▾ ─ ● 3 unsynced ─────────────── view: Systems ▾ ─ ◐ ─ avatar ┐
├────────┬─────────────────────────────────────────────────────┬──────────────────────┤
│Explorer│  [drone.sysml]  [◇ droneStructure]  [▦ Requirements] │ Inspector            │
│ model  │                                                     │  «part def» Battery  │
│ views  │        editor / canvas / table (split ⇆)            │  specializes …       │
│ libs   │                                                     │  attributes …        │
│ files  │                                                     │  traces: satisfies 2 │
├────────┴─────────────────────────────────────────────────────┴──────────────────────┤
│ Problems · Trace · References · Simulation · Git                                      │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- **Linked selection** everywhere: select in text ⇄ diagram ⇄ table ⇄ explorer.
- **Split text + diagram** is the signature mode: type and watch the diagram
  update; drag and watch the text update.
- **Role-based workspaces** (Systems / Test / Quality / Development) re-arrange
  panels and default views; they never fork the data.
- **⌘K** for everything: go to element, create element, run check, open view.
- Calm, typographic design: Inter + JetBrains Mono, restrained colour used to
  encode kind and status, light/dark/system themes, motion only for spatial
  continuity, 44 px touch targets; tablet-friendly read/review mode.

### 7.2 Getting started

Landing → "Try the drone demo" (no sign-in) / "Open a repository" / "Open a
local folder" / "New project" (scaffolds the house layout: `Definitions`,
`Usages`, `Requirements`, `Verification`, `Views` packages, `.sysml-web/`
config, CI workflow running `sysml check`).

---

## 8. Engineering workspaces

Each workspace is a set of views over the same model, mostly backed by SysML
domain libraries so the semantics travel with the model.

### Systems engineers
- Requirements table editor (ID/short name, text, rationale, priority, status,
  verification method, owner) writing back `requirement` usages + metadata.
- Derive/refine/satisfy/verify trace graph and matrices; requirement status
  colouring (satisfied+verified / unverified / unsatisfied / gap).
- Allocation matrix (function → logical → physical), impact analysis
  (upstream/downstream), variants/configurations and a configuration picker.
- Rollups (mass/power/cost) with units; trade studies and analysis cases.
- Semantic **model diff** between branches/commits (added/removed/changed
  elements, not lines) — the review experience for model PRs.

### Test / verification engineers
- Verification case authoring (subject, objective, `verify`, method metadata).
- Verification coverage dashboard and test plan views.
- Constraint/calc evaluation and state-machine/action simulation as executable
  checks whose verdicts are shown live (not stored).

### Quality engineers
- FMEA worksheet (`RiskAnalysis` library: `@Fmea`, RPN calc, mitigations),
  risk matrix, hazard analysis chains (`HazardAnalysis`, ISO 14971 style).
- Quality gates (`QualityGate`/`TraceGate` constraints) shown as PASS/FAIL and
  enforceable in CI via the CLI.
- Model quality dashboard (lint, completeness score).

### Development engineers (HW/SW/design)
- Interface control: port/interface tables, ICD export, connection matrix.
- BOM with extended quantities; parameters and tolerance stack-ups
  (`Tolerancing`, `Uncertainty`: worst-case, RSS, Monte Carlo).
- Exports: Modelica stubs, FMI interface checks, SSP; later code/interface
  generation.
- CI integration: a GitHub Action running the same engine (`sysml check`,
  gates, report generation) on every model PR, with a link back into the app.

### Deferred: operational records
Test executions and verdicts, NCRs, CAPAs and inspection results are **out of
scope for now**. The model holds definitions and plans (verification cases,
FMEA, quality gates); recording what happened against them comes later. Nothing
in the architecture precludes either SysML-native records or sidecar files.

### Reports
`view def` + `@TableRendering` (Reporting library) rendered as live tables and
exported to CSV/Markdown/PDF; document generation (requirements spec, ICD,
verification matrix) from model-defined views.

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
| App shell | Astro (static) + Svelte 5 SPA island — shared with mycelium-web |
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
├─ engine/                    Rust workspace
│  ├─ crates/sysml-syntax/    tree-sitter binding, CST → AST lowering
│  ├─ crates/sysml-semantic/  element graph, resolution, implied rels, validation
│  ├─ crates/sysml-eval/      expressions, units, rollups, sim (ported from sysml-core)
│  ├─ crates/sysml-edit/      EditOps → TextEdits, formatter, pretty-printer
│  ├─ crates/sysml-interchange/ JSON, .kpar, (XMI)
│  ├─ crates/sysml-wasm/      wasm-bindgen API + worker protocol types
│  └─ tests/corpus/           OMG corpus, book fixtures, pilot golden JSON
├─ src/                       Astro + Svelte app
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

Long-term, `sysml-cli` and `sysml-lsp` move onto `engine/` crates (published or
consumed via git) so all tools share one engine.

---

## 11a. Licensing

The app, engine and worker are dual-licensed **`Apache-2.0 OR MIT`** (the Rust
ecosystem convention) to maximise adoption and integration.

| Component | Current licence | Action |
| --- | --- | --- |
| `tree-sitter-sysml` | GPL-3.0-or-later (`package.json`) but MIT (`Cargo.toml`) — inconsistent | Relicense to `Apache-2.0 OR MIT` and make the metadata consistent (sole author) |
| `sysml-core` code ported into `engine/` | GPL-3.0-or-later | Relicense the ported modules (sole author) before copying |
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
- Spike B: map the drone example to Systems Modeling API JSON and diff against
  the pilot implementation; settle the element-ID scheme.
- Scaffold Astro/Svelte app, design tokens/themes, CI, Pages deploy, conformance
  workflow skeleton.
- _Exit_: drone example parsed in the browser worker; ID/JSON scheme decided.

**Phase 1 — Semantic engine core**
- Lowering, element graph, resolution, imports, implied specializations,
  prebuilt stdlib index, diagnostics, JSON export.
- _Exit_: official corpus resolves with zero errors; drone JSON matches the
  pilot on the compared properties; < 30 ms incremental re-check.

**Phase 2 — Read-only workbench**
- Open demo / local folder / git clone (PAT); Explorer (Browser View); CodeMirror
  with highlighting, diagnostics, go-to-definition, hover, references;
  General + Interconnection views with ELK auto-layout; linked selection; ⌘K.
- _Exit_: an engineer can explore any official example model beautifully.

**Phase 3 — Editing (text + visual)**
- Completion, rename, quick-fixes, formatter; inspector forms; `EditOp`s; visual
  create/connect/rename/delete on General + Interconnection views; saved views
  as SysML + layout sidecar; unified undo; fidelity suite.
- _Exit_: build the drone architecture from scratch without typing, and the
  text is clean, conformant SysML.

**Phase 4 — Git & collaboration**
- OAuth sign-in, commit/pull/push/branch, conflict resolver, semantic diff,
  review mode.

**Phase 5 — Behaviour**
- Action Flow, State Transition and Sequence views (read then edit); state/action
  simulation panels.

**Phase 6 — Engineering workspaces**
- Requirements table, trace/allocation/DSM grids, verification coverage and
  results, FMEA/risk/hazard worksheets, BOM/rollups/tolerances, reports and
  quality gates, library packs.

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
| 5 | Astro + Svelte 5 shell reusing mycelium-web's git/auth/worker/design system | 2026-10-21 |

## Open questions

1. **Name and domain** for the product.
2. **Engine home**: build `engine/` in this repo and later move `sysml-cli`/
   `sysml-lsp` onto it (proposed), or restructure `sysml-cli`'s workspace first
   and consume it here?
3. **Element-ID scheme**: confirm deterministic UUIDv5 + rename map after
   spike B compares against the pilot implementation.
