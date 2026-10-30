# Tessera — Plan

A beautiful, fast, standards-conformant **web workbench for SysML v2** that
makes the language approachable. Build models in **text or diagrams** (both
edit the same SysML, live) with guidance and plain-language explanations that
let engineers new to MBSE work productively, and the depth experts expect. The
SysML text in a git repository is the single source of truth; every change is a
minimal, reviewable diff that any other conformant tool can read. It runs well
on desktop and mobile.

(The product was called "SysML Web" until it was named Tessera; the
repository and the site's path keep the old name.)

## Status (2026-10-23)

The app runs on the Open-MBEE sysml-toolkit (decision #16; the migration is
done, `docs/engine.md`). Phases 0–5 are built, and most of 6–8; what is left
is under **Next** and **Not doing, or later** below.

### Built

- **Workbench.** Explorer (the model tree with an element menu, the project's
  files with new, rename, move and delete, saved views grouped by kind,
  simulations, the standard library); a text editor with completion, hover
  explanations, go to definition, references, rename, formatting and quick
  fixes; text and diagram side by side with a draggable divider; the inspector
  (each element explained, values editable in place with units that bring
  their import, related elements both ways, satisfy and verify pickers);
  problems; search and commands (Ctrl K); one undo for every kind of edit;
  settings; the help, which is also `docs/user-guide.md`.
- **Diagrams.** General, interconnection, state, action flow, sequence and use
  case views drawn from the model in SysML v2 notation, laid out by ELK (use
  case diagrams in a column of their own). On the
  canvas: add elements, connect ports, draw states, transitions, steps and
  successions, rename, remove from the diagram (hidden elements are listed)
  or delete from the model, add connected elements, duplicate, show a saved
  view as another kind of diagram (View as). Positions are kept in
  `layout/diagrams.json`. Export as SVG or PNG, or to the clipboard. Sequence
  diagrams are read-only.
- **Tables and reports.** Every table is a SysML view (`@TableRendering`,
  `docs/table-rendering.md`), editable in place, with column filters, quick
  reviews and **Save as a view**; requirements tables, gaps, bill of
  materials, interfaces, trace and verification matrices; a specification and
  an interface control document (print or PDF, HTML, Markdown) that names the
  commit it was made from; Excel and CSV export; requirements imported from
  Excel, CSV or pasted cells. One coverage rule (through derived
  requirements) for the home page, tables and reports; verification results
  recorded on cases (`@VerificationResult`, out of date once the model
  changes since their commit); circular derivations and a project's own
  conventions (`@Convention` views) under Problems (`docs/verification.md`).
- **Guided forms** that write the SysML and show it: new view, add up a value,
  set a limit, trade study, FMEA, FMEA line, hazard, risk policy, dependency
  matrix, saved review; drawing state machines and action flows.
- **Analysis.** Constraint checks of every `satisfy` claim and `assert`, with
  violations as problems and evaluated values in the inspector; budgets
  (roll-ups) over the parts tree; trade studies compared in a table and
  summed up in the inspector; a state machine simulator with a simulated
  clock, time triggers and `do` actions (`docs/simulator.md`); risk analysis:
  design, process and use FMEAs, hazards and a hazard log, risk controls
  linked to lines, RPN with bands, action priority, an acceptability policy
  and a risk matrix coloured by it (`docs/risk-analysis.md`); dependency
  matrices: part DSM, N² chart, functional and requirement DSMs, suggested
  modules and change impact (`docs/dsm.md`).
- **Review.** "Review changes" compares the model with another version
  (changes not yet on GitHub or since the version marked as reviewed, a
  branch, an earlier version, a pull request) and says what changed in plain
  language, grouped as Requirements, Design, Behaviour, Verification, Risk and
  Other, with the checks and budgets it changes first; diagrams and tables
  mark the changes (`docs/engine.md`, "Comparing versions"). A changed
  requirement or risk control names what relies on it: its satisfiers,
  mitigations, tests, derived requirements and FMEA lines.
- **Projects and collaboration.** Projects kept in the browser (IndexedDB);
  starting points (blank, requirements first, a small system) with next steps
  and a tour; local folders (File System Access, saved back with Ctrl S);
  `.kpar` and `.zip` import and `.kpar` export; GitHub through its REST API
  (a fine-grained token, or "Sign in with GitHub" through the stateless
  worker in `worker/`): open, save, get latest (a choice per conflicting
  file), branches, propose changes as a pull request, several accounts.
- **Interchange.** SysML v2 JSON export and import, and a Systems Modeling API
  client (open from and save to a server, with a three-way merge and a review
  of conflicting changes when the branch moved), `docs/interchange.md`.
- **Everywhere.** A touch-first phone layout; installable on a Home Screen,
  Dock or app list with help for each platform; offline after the first visit
  (`src/service-worker`, rules in `src/lib/offline/caching.ts`); usable on
  generated models of 100k lines (`docs/performance.md`); Lighthouse ≥ 0.9
  performance, 1.0 accessibility, ≥ 0.95 best practices and ≥ 0.9 SEO on
  mobile and desktop, and axe in the end-to-end tests, enforced in CI.

### Next

- A public **conformance dashboard** generated from CI (§6).
- **Per-element merge assist** for git: a pull's conflicts are chosen per
  file today; Save to server already merges per element.
- **Document perspective** (§8.1): the model read as a living specification.
- **Editing sequence diagrams** on the canvas.
- More starting points (product architecture, safety-critical).
- Requirement quality checks and quality gates as SysML libraries; the
  `@Convention` views checked in CI, failing a pull request.
- **Shared libraries** referenced by version (a `.kpar` or a repository) with
  an "update available" notice, instead of a copy per project
  (`docs/verification.md`, "Libraries across projects").
- PDF export of diagrams (reports already print to PDF).
- GitLab and other git hosts (Settings says "GitLab is planned").
- A high-contrast theme.

### Not doing, or later

- **Our own engine** (`sysml-cli` / tree-sitter compiled to WebAssembly, with
  its own semantic graph, element ids and interchange crates): superseded by
  the sysml-toolkit (decision #16). The design notes for it are gone from this
  plan; `docs/spikes/wasm-engine.md` and `docs/reference/interchange.md` keep
  the research.
- **A shared engine for a CLI and language server**: not part of this app.
- **isomorphic-git in OPFS** and a git proxy: GitHub's REST API answers the
  browser directly, so only sign-in needs a worker.
- **Layout sidecars per view under `.sysml-web/`**: one `layout/diagrams.json`
  per project instead.
- **XMI export**: only if someone needs it.
- **Geometry view**: no plans.
- **Real-time co-editing**: git's asynchronous review fits engineering; the
  text-patch edits leave room for it later.
- **Operational records** (NCRs, CAPAs, inspections): deferred (decision
  #2). Test results are the exception: a verification case's latest result
  is model content (`docs/verification.md`).

### Engine migration (decision #16)

Why: our own engine (`sysml-cli`, tree-sitter) resolved names
approximately — 48 of its 78 findings on the demo were false, it accepted
invalid SysML, and it had no standard JSON interchange. The toolkit
resolves 99.96 % of the official corpus's references, agrees with the
release XMI on 99.90 % of library relationships, rejects 440 of 462
invalid fixtures (ours: 63) and exports schema-valid JSON. Measured in the
browser on a throttled phone it re-analysed as fast as ours and never
blocked the main thread; its costs are start-up (library model: 5–7 s on a
phone first visit, 2.6 s on return with the prepared snapshot) and memory
(105–160 MB vs 24 MB). These were measured in October 2026 for the decision;
the reports stayed in that session's record.

How: one engine interface (`EngineApi`) is the app's only contract. Pieces the
toolkit doesn't provide are written in TypeScript over its model (tables,
diagrams, the simulator, `.kpar`, the library browser). The migration ran in
seven phases, all done: foundation, editor services, views and tables, edits,
diagrams, the rest (simulator, `.kpar`, library browser), and removing the old
engine. On a real iPhone the toolkit held 154–160 MB with no growth over 20
edits and no tab kill (library build 3.2 s, analysis 0.3 s). Requests for the
toolkit's maintainers are in `docs/engine.md`, "Upstream requests".

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

### Product principles

1. **The text is the model.** `.sysml` files in git are the only source of
   truth. Everything else (the analysed model, diagrams, tables, indexes) is
   derived and disposable.
2. **Every edit is a minimal text patch.** Visual edits, form edits and refactors
   become small changes against the exact text loaded. Formatting, comments and
   unknown syntax survive.
3. **Conformance is a feature.** Parse, resolve, validate and interchange
   follow the OMG specifications; the JSON the app writes is checked against
   the OMG schema in the tests.
4. **Semantics in the model, not the app.** Requirements status, FMEA, BOMs,
   reports, matrices and checks are expressed in SysML (metadata, views,
   constraints, calcs, domain libraries). The app renders and evaluates them; it
   does not hard-code engineering domains.
5. **One engine.** Every number the app shows comes from one analysed model,
   so views never disagree.
6. **Your data stays yours.** No backend stores models: a static app, your git
   host, and an optional stateless sign-in worker.
7. **Beautiful by default, keyboard-first, accessible.** WCAG 2.1 AA, axe in CI.
8. **SysML made approachable, not hidden.** Text and diagrams are equal ways
   to build the model; the language explains itself in context so newcomers
   learn by doing (see §7).
9. **Fast everywhere.** Mobile and desktop are both first-class; Lighthouse
   budgets are enforced in CI.

---

## 2. What we build on

| Piece | Used for |
| --- | --- |
| Open-MBEE **sysml-toolkit** (`@sysml/wasm`, Apache-2.0), pinned in `toolkit.json` | Parsing, name resolution, validation, evaluation, edits, language services, JSON interchange |
| OMG SysML v2 standard library (EPL-2.0), from the toolkit's bundle | The library every model imports; the library browser |
| CodeMirror 6 | The text editor |
| Svelte Flow (`@xyflow/svelte`) and elkjs | Diagram canvas and layout |
| Earlier tools of the author (`sysml-cli`, `sysml-studio`, `sysml2-mode`, `mycelium-web`) | Ideas and conventions: notation, the risk and reporting libraries, the house style, the GitHub flow. No code is shared with them now. |
| *The SysML v2 Book* (Weilkiens & Molnár, 2026-05) | Notation reference for the standard views |

---

## 3. Architecture

```
┌──────────────────────────────── Browser (static origin, PWA) ─────────────────────────────────┐
│                                                                                                │
│  Svelte 5 UI (SvelteKit static SPA)                                                             │
│   ├─ Workbench: explorer · editor tabs · diagrams · inspector · problems · Ctrl K palette        │
│   ├─ Text editor ── CodeMirror 6 (highlighting, diagnostics, completion, hover, rename)          │
│   ├─ Diagram canvas ── Svelte Flow + SysML node/edge renderers; elkjs layout                     │
│   └─ Tables, matrices, reports, simulator, guided forms                                          │
│                 │  typed messages (postMessage)                                                  │
│                 ▼                                                                               │
│  Engine Worker ── sysml-toolkit (WebAssembly)                                                    │
│   ├─ analysis: parse, resolve, validate → the app's model, problems                              │
│   ├─ views, tables, diagram graphs, state machines (TypeScript over the toolkit's model)         │
│   ├─ evaluation: values, checks, budgets, trade studies                                          │
│   ├─ edits: rename, set, insert, remove → minimal text edits; formatting                         │
│   ├─ language server: completion, hover, definition, references, quick fixes                    │
│   └─ interchange: SysML v2 JSON out and in; comparing versions                                   │
│                                                                                                │
│  Storage: IndexedDB (projects) · localStorage (settings, accounts) · Cache Storage (offline)    │
└──────────────┬───────────────────────────────┬──────────────────────────┬──────────────────────┘
               │ REST                           │ token exchange only      │ REST (optional)
               ▼                                ▼                          ▼
          GitHub API                   Sign-in worker (Cloudflare,   Systems Modeling API servers
                                       stateless, self-hostable)     (OMG pilot, SysON, …)
```

The engine never blocks the UI: the page sends texts and edits, the worker
answers with analyses, rendered views and text edits.

---

## 4. The engine

See `docs/engine.md`: the interface, positions, the model adapter, views and
tables, edits, diagrams, evaluation, trade studies, comparing versions,
language services, library loading, interchange, failure handling and the
upstream requests.

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
show. Only positions are tool-specific, because diagram interchange and layout
are not standardised until SysML v2.1: they live in the project's
`layout/diagrams.json`, keyed by element, with hidden elements beside them.
Missing entries fall back to automatic layout, so a diagram always renders.

### 5.2 The standard views

| View | Status |
| --- | --- |
| Browser View | Built: the explorer's model tree |
| General View | Built, read and edit: definitions (square) and usages (rounded), compartments, composition, specialization, satisfy/verify/allocate edges |
| Interconnection View | Built, read and edit: nested parts, ports on borders, connections, interfaces, bindings, flows, inherited ports |
| Grid View | Built: tables (`@TableRendering`), trace and verification matrices, dependency matrices (`@MatrixRendering`) |
| Action Flow View | Built, read and edit: start/done, decide/merge, fork/join, successions |
| State Transition View | Built, read and edit: states, transitions with trigger, guard and effect; run in the simulator |
| Sequence View | Built, read: lifelines and messages in time order |
| Use case view (`ModelViews::UseCaseView`, a General View kept to use cases) | Built, read and edit: use cases as ellipses in their subject's boundary, actors as stick figures outside, «include», specialization; add a use case or an actor, connect an actor or an include |
| Geometry View | Not planned |

Export: every diagram's toolbar has **Export**: SVG for documents, PNG at 2×
for slides (white or transparent), or either copied to the clipboard; the share
sheet on phones. The SVG is plain `<rect>`/`<path>`/`<text>` with inline
colours inside the SysML diagram frame, so it opens the same in browsers,
Inkscape and Office.

---

## 6. Interchange and conformance

| Format | Status |
| --- | --- |
| Textual notation `.sysml` | Read and write (source of truth) |
| SysML v2 JSON (KerML clause 10, API schema) | Export and import; checked against the OMG schema in the tests |
| Project interchange `.kpar` | Import and export |
| Systems Modeling API (REST) | Open from and save to a server, with a three-way merge |
| XMI | Not planned |

Importing JSON or API models writes canonical text, which then becomes the
source of truth (`docs/interchange.md`). A public conformance dashboard
(corpus parse and resolve, round trips, comparison with the pilot) is still to
come.

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
   other live.
2. **The language is visible and explained.** Every keyword, element and
   relationship can explain itself in plain words (hover, inspector, help),
   with a short example.
3. **Guidance in the flow of work.** Context-aware "Add" actions and guided
   forms offer what makes sense where you are and write idiomatic SysML for
   you, showing the text they write. Starting points, next steps and a tour
   show good structure.
4. **Problems explained.** Problems are listed in words and link to where they
   are; checks that fail say what they claimed and by how much.
5. **Standard views, not bespoke screens.** Requirements lists, matrices,
   interface tables and FMEA worksheets are SysML views over the model.
6. **Modern tooling for everyday practice.** Documents become model views and
   generated reports; spreadsheets become typed, linked elements; email review
   becomes branches and plain-language diffs; "which version is current?"
   disappears because the model lives in git.
7. **Works everywhere.** Full authoring on desktop; reading, reviewing,
   navigating and light editing on phones and tablets. Fast first load,
   installable, offline.

### 7.2 The workbench

- **Explorer**: the model as a tree, the project's files, the saved views
  grouped by kind, simulations and the standard library. Each element has a
  menu (duplicate, rename, show in text, delete from model).
- **Editor area**: tabs for files, diagrams, tables, reports and the
  simulator; text and diagram side by side (Split), where selecting in one
  selects in the other.
- **Inspector**: the selected element's kind explained in one sentence, its
  properties and values as an editable form, its relationships and related
  elements.
- **Problems**, the status bar, and **Ctrl K** search for elements, views,
  table rows, commands and help.
- **Phones**: one pane at a time with a bottom bar; diagrams pan and pinch-zoom;
  the inspector, forms and menus are bottom sheets.

### 7.3 Quality bar: fast, accessible, everywhere

- Lighthouse CI on the landing page and the demo, mobile and desktop presets:
  performance ≥ 0.9, accessibility = 1.0, best practices ≥ 0.95, SEO ≥ 0.9.
- The engine and editor load after first paint; diagrams and CodeMirror are
  code-split; fonts self-hosted.
- WCAG 2.1 AA (axe in the end-to-end tests); keyboard-operable diagrams; touch
  targets ≥ 44 px.
- Responsive from 360 px phones to wide desktops.
- Offline (`src/service-worker`, rules in `src/lib/offline/caching.ts`): the
  worker registers after load and precaches the shell (prerendered pages, the
  `404.html` SPA fallback that opens stored `/p/<id>` links, hashed JS/CSS/fonts,
  icons), served cache-first. The engine is never precached: it is cached on
  first use, and the page asks the worker to fill in missing engine files when
  idle after the engine starts. Caches are named by build version and old ones
  deleted on activate. Other origins (GitHub) and non-GET requests go to the
  network, uncached. A new version waits for "Reload" in a toast, which saves
  pending edits first.

### 7.4 Visual language

Calm, typographic and dense without clutter. Inter for UI, JetBrains Mono for
SysML, Source Serif for documents. A neutral palette with the sea-glass accent;
colour encodes element kind and status consistently across text, diagrams and
inspector, always paired with a label or shape. Light and dark themes; reduced
motion respected.

---

## 8. Engineering practice on the model

The app supports the practices systems and quality engineers already have by
expressing them in SysML and providing views over the model. Semantics live in
SysML libraries so they travel with the model to other tools.

| Practice today | In the model | Views and tools (all built) |
| --- | --- | --- |
| Requirements documents | `requirement` elements with IDs, text, rationale, status, derivation | requirements tables, specification report, import from spreadsheets |
| Traceability spreadsheets | `satisfy`, `verify`, `allocate`, derivation | trace and verification matrices, gaps, requirement DSM |
| Block diagrams and ICDs in slides | parts, ports, interfaces, items, connections | general and interconnection views, interface table, ICD report, part DSM and N² chart |
| Functional flows | actions, successions, flows, `perform`, allocation | action flow view, functional DSM |
| Modes and states | state machines | state view, simulator |
| Test plans | verification cases with objectives and `verify` | verification matrix, coverage |
| FMEA and hazard logs | `RiskAnalysis` / `HazardAnalysis` libraries | FMEA worksheets, hazard log, risk matrix, risk policy |
| Budgets (mass, power) | attributes with units, calcs, constraints | budget tables, design checks, violations in Problems |
| Trade studies | an `analysis` typed by `TradeStudies::TradeStudy` | trade study table, summary in the inspector |
| Design reviews | git branches, commits, pull requests | review changes: what changed, in plain language |

### 8.1 Perspectives: one model, two ways to read it (next)

Some people think in models and diagrams; others think in documents — a
requirements specification, an ICD, a test plan. Rather than two products,
the workbench will offer **perspectives** over the same SysML: **Model** (as
today) and **Document**, the model read as a living specification whose
chapters are SysML views, whose paragraphs are element `doc`s and requirement
texts, and where editing a sentence or a cell writes SysML through the same
edits. Nothing in it is stored outside the model.

---

## 9. Git and collaboration

Built: GitHub through its REST API from the browser (no proxy); a fine-grained
token or "Sign in with GitHub" (a GitHub App, with the stateless worker for
the token exchange, `docs/setup-github-sign-in.md`); several accounts; save
(commit and push) with the plain-language summary of changes suggested as the
message; get latest, with a choice per conflicting file; branches; propose
changes as a pull request; review a branch, an earlier version or a pull
request; local folders saved back in place.

Next: per-element merge assist for git conflicts, other git hosts.

---

## 10. Technology decisions

| Area | Decision |
| --- | --- |
| App shell | SvelteKit static SPA (adapter-static) + Svelte 5 |
| Engine | Open-MBEE sysml-toolkit (WebAssembly) in a Web Worker |
| Text editor | CodeMirror 6, language services from the engine |
| Diagrams | `@xyflow/svelte` + custom SVG nodes; `elkjs` (on the main thread, for diagrams of up to 500 elements) |
| Tables | Own Svelte rendering, a page of rows at a time |
| Spreadsheets | Hand-written OOXML and ZIP over `CompressionStream` (decision #15) |
| Git | GitHub REST API from the browser |
| Auth | GitHub App sign-in through a stateless Cloudflare Worker (`worker/`), self-hostable; personal access tokens as the fallback |
| Storage | IndexedDB for projects, localStorage for settings and accounts |
| Testing | Vitest (against the real toolkit in Node); Playwright + axe end to end; Lighthouse CI; a benchmark on generated large models |
| Hosting | GitHub Pages; PWA, offline-capable |
| Licence | `Apache-2.0 OR MIT` (§11) |

---

## 11. Licensing

The app and the worker are dual-licensed **`Apache-2.0 OR MIT`** to maximise
adoption and integration.

| Component | Licence | Notes |
| --- | --- | --- |
| sysml-toolkit | Apache-2.0 | Served unmodified from `static/toolkit/` |
| OMG `sysml.library` | EPL-2.0 (SysML v2 Release 2026-05 and later) | Served unmodified from the sysml-toolkit's bundle (`static/toolkit/stdlib/`, with the toolkit's `LICENSE-EPL-2.0` and `THIRD-PARTY-NOTICES.md` next to it); its licence and notice are shown in the app's standard-library browser and in Settings → About |
| elkjs | EPL-2.0 | Used unmodified |
| Risk, hazard, reporting and matrix libraries (`src/demo/drone/libraries/`) | `Apache-2.0 OR MIT` | Part of this repository; copied into a project when it first needs them |

---

## 12. Phases

Each phase ended in something usable and demoable.

- **Phase 0 — Foundations and spikes.** ✅ App scaffold, CI, Pages deploy,
  design system, engine in a worker, the demo. (Spike A, `docs/spikes/`,
  belongs to the engine later replaced.)
- **Phase 1 — Engine core and editor services.** ✅ Through the sysml-toolkit
  (decision #16) rather than our own engine.
- **Phase 2 — Build a model two ways.** ✅ Workbench, live diagrams with visual
  editing, inspector, problems, palette, undo, saved views, folders and
  downloads, phone layout, the demo's tour, Lighthouse budgets.
- **Phase 3 — Requirements, traceability and views.** ✅ Concept explanations,
  starting points, tables as SysML views, trace and verification matrices,
  gaps, specification and ICD reports.
- **Phase 4 — Git and collaboration.** ✅ GitHub sign-in, save, branches,
  propose changes, file-level conflict choice, semantic diff and review mode.
  Per-element merge assist for git is next.
- **Phase 5 — Behaviour.** ✅ Action flow and state views with editing,
  sequence view (read), the simulator with a simulated clock, roll-ups,
  constraint checks, trade studies.
- **Phase 6 — Verification, risk and on-ramps.** ✅ Verification matrix, FMEA,
  hazards and risk matrix over the risk libraries, dependency matrices,
  spreadsheet import, CSV/XLSX export, reports to PDF. Requirement quality
  checks and quality gates are next.
- **Phase 7 — Interchange.** ✅ JSON import and export, `.kpar` import and
  export, Systems Modeling API client with merging. The conformance dashboard
  is next.
- **Phase 8 — Polish.** ✅ Performance at 100k lines (`docs/performance.md`),
  offline and installable, accessibility in CI, user guide, self-hosting docs
  for sign-in.

---

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| The engine is someone else's project | One interface (`EngineApi`), the release pinned in `toolkit.json`, behaviour pinned by tests against the real toolkit, requests filed upstream (`docs/engine.md`) |
| Engine start-up and memory on phones | Prepared library snapshot cached after the first visit; measured on a real iPhone (§ Engine migration); sessions freed when not needed |
| Large models | Re-analysis is linear in the project (upstream request 12); the app keeps it from piling up (`docs/performance.md`) |
| Diagram layout not standardised until v2.1 | Views as SysML now, positions in `layout/diagrams.json`; migrate when v2.1 lands |
| Element identity across tools | Text stays authoritative; versions are matched by place (`docs/interchange.md`, "Identity") |
| Scope | Vertical slices; engineering features expressed as SysML libraries rather than bespoke screens |
| Adoption | Zero-install demo, plain-language help, interchange with SysON and the pilot via JSON and the API |

---

## Decision log

| # | Decision | Date |
| --- | --- | --- |
| 1 | ~~One shared Rust semantic engine compiled to WebAssembly (web, CLI, LSP)~~ — superseded by #16 | 2026-10-21 |
| 2 | Operational records (test runs, NCR, CAPA, inspections) deferred | 2026-10-21 |
| 3 | Static app + git only; no backend holds data; stateless sign-in worker; optional Systems Modeling API client | 2026-10-21 |
| 4 | Licence `Apache-2.0 OR MIT`; OMG library served under its own licence (EPL-2.0, the 2026-05+ release the toolkit bundles) | 2026-10-21 |
| 5 | SvelteKit (static SPA) + Svelte 5; reuse ideas from mycelium-web's GitHub flow but **not** its structure or UI | 2026-10-21 |
| 6 | ~~Engine built in the `sysml-cli` workspace~~ — superseded by #16 | 2026-10-21 |
| 7 | ~~Object-first, spreadsheet-like UX~~ — superseded by #9 | 2026-10-21 |
| 8 | ~~Element ids use the normative KerML 9.1 scheme for user models~~ — the toolkit's ids are used; versions are matched by place (`docs/interchange.md`) | 2026-10-21 |
| 9 | SysML is the product: a workbench where text and diagrams are equal ways to build the model, made approachable through in-context explanation and guidance; tables are SysML views, not the editing paradigm | 2026-10-21 |
| 10 | Mobile and desktop are both first-class; Lighthouse ≥ 0.9 (a11y 1.0) enforced in CI | 2026-10-21 |
| 11 | The demo model is authored and reviewed with the greatest care; it is the primary onboarding surface | 2026-10-21 |
| 12 | Every table is a SysML view rendered by the engine (`renderView`); standard tables ship as `ModelViews.sysml`, so tables are reproducible in any conformant tool | 2026-10-21 |
| 13 | Diagrams follow SysML v2 graphical notation strictly (definitions square, usages rounded, standard edge adornments, diagram frames); element families add colour, never replace shape | 2026-10-21 |
| 14 | A document-centric reading of the model is offered as a *perspective* over SysML views, not as a separate data model | 2026-10-21 |
| 15 | Spreadsheets in and out without a spreadsheet library: hand-written OOXML and a small ZIP over the browser's `CompressionStream`; imported requirements become SysML written the way the engine's own edits write it, in one undoable change | 2026-10-21 |
| 16 | Move the app onto the Open-MBEE sysml-toolkit engine (one core, maintained by an organisation) in place of our own `sysml-cli` engine; features the toolkit lacks are written in TypeScript over its model; the app switches to it directly (no users yet), porting piece by piece behind one engine interface | 2026-10-21 |
| 17 | The product is named **Tessera**; the repository and site path stay `sysml-web` | 2026-10-22 |

## Open questions

1. Whether to move the site to a domain of its own (and rename the repository).
2. When SysML v2.1 standardises diagram layout, how to migrate
   `layout/diagrams.json`.
