# §4 Core MBSE Modeling Capabilities

Assessed on `origin/main` at `68cb9db` (branch `claude/assess-mbse`), on the drone demo
(`src/demo/drone`, 22 files). New evidence is in
`src/lib/project/traceability.assessment.test.ts` (shared with §7, see
[07-requirements-risk](07-requirements-risk.md)); existing tests cited were run in this
session unless marked otherwise.

Reproduce the new evidence:
`npx vitest run src/lib/project/traceability.assessment.test.ts`

Reproduce the existing evidence cited here:
`npx vitest run src/lib/engine/toolkit/diagrams/related.test.ts src/lib/project/requirements.test.ts src/lib/project/requirementChecks.test.ts src/lib/project/requirementIds.test.ts src/lib/engine/toolkit/views/views.test.ts src/lib/engine/toolkit/views/dsm.test.ts src/lib/workbench/dsm.test.ts src/lib/engine/toolkit/evaluation.test.ts`

Last run (with the existing tests cited, 18 files): 199 passed, 6 expected failures (the `it.fails` gaps), on `68cb9db` plus these tests.

One model, one source: everything below is read from the SysML text on each analysis. The
toolkit parses and resolves; Tessera's adapter, tables, DSM, related panel, checks and
reports are TypeScript over the toolkit's model. Scores are Tessera's unless stated.

---

### Can users model structure, behavior, interfaces, requirements, constraints, and their relationships coherently?
- **Answer:** Yes, in one SysML v2 model. The demo has part and port definitions and usages, interfaces with flows, an action flow with fork/join/decision/merge, a sequence, a state machine, stakeholder needs and system requirements with `require constraint`s in units, derivation, satisfy, verify, allocate, analyses, a trade study, an FMEA and a hazard log, and the views that show them. Each kind has a diagram or table: general, interconnection, action flow, sequence, state transition views; requirements/trace/verification tables; DSM and N² chart; constraint checks evaluated against the design's values. The demo checks clean (no errors, only its two deliberate risk-review warnings).
- **Evidence:** `src/lib/engine/toolkit/views/views.test.ts` (every standard table of the demo), `src/lib/engine/toolkit/views/dsm.test.ts:181`–`:225` (parts, steps, requirements), `src/lib/engine/toolkit/evaluation.test.ts:29` (requirement constraints decided), `src/lib/engine/toolkit/views/risk.test.ts:95` (demo checks clean). Ran in this session.
- **Limitations:** Language coverage is §1's. Some kinds have no editor beyond text (e.g. analyses, verification cases); they are preserved (§2).
- **Status:** Verified (on the demo)
- **Score:** 2
- **Next action:** None

### Can requirements be traced to design elements, behavior, and verification cases?
- **Answer:** Yes. `satisfy R by X` (X a part, a part's feature, or an action such as a `Mitigation`), `verify R` in a verification case's objective, `#derivation` (need → requirement), `allocate` (action → part). The requirements table, Requirement coverage, Trace matrix (requirement × satisfier), Verification matrix (requirement × case), Requirement DSM (derivation/refinement, optionally satisfy), the related panel and the specification report all read these; links follow edits. A `satisfy` whose target is not a requirement is an error. Since `68cb9db`, Problems warns at a `satisfy … by x.y` whose root `x` is the requirement's own subject name, which other SysML tools read as the subject rather than the imported part (the engine reads the part; the demo's subject is now `system`, so the demo means the same in every tool).
- **Evidence:** `traceability.assessment.test.ts` (coverage follows `satisfy`/`verify` edits; satisfy of a non-requirement is an error; related panel of SYS-001); `src/lib/project/requirements.test.ts:102`; `src/lib/engine/toolkit/diagrams/related.test.ts:70`; `src/lib/project/requirementChecks.test.ts:33`, `:40`; `src/lib/engine/toolkit/views/views.test.ts:516`. Ran in this session.
- **Limitations:** Behaviour reaches a requirement only through `satisfy … by <action>` or through allocation to a part that satisfies it; there is no view that joins requirement → part → allocated action. The engine's reading of a subject-named `satisfy` root differs from the spec (reported upstream; Tessera warns).
- **Status:** Verified
- **Score:** 2
- **Next action:** None (cross-check trace links with the pilot implementation is §1/§3's).

### Can Tessera identify orphaned requirements, unallocated functions, missing interfaces, and unverified requirements?
- **Answer:** *Unverified / unsatisfied requirements*: yes — the home view's gap list ("Not allocated", "No test"), the `RequirementGaps` table and the report's Gaps chapter; on the demo, 11 of 24 (six stakeholder needs, SYS-005, SYS-006, SYS-011, RC-003, RC-007); the home list and the table agree. *Orphaned*: a link or annotation whose target no longer exists is an `unresolved reference` warning at the line; a requirement with no links at all shows as a gap; a requirement not derived from any need is shown by the Requirement DSM's "no links" flag. *Missing interfaces*: the part DSM flags connections with no interface/connection definition and parts with no connection. *Unallocated functions*: **not reliably** — in the functional DSM with allocations counted, the "no links" flag ignores links to elements outside the matrix (the parts), so every step of the delivery flight is flagged, allocated or not; the allocation does show as "Also, outside this matrix".
- **Evidence:** `traceability.assessment.test.ts` (home gaps = `RequirementGaps`; unresolved references; functional DSM flag is `it.fails` with the gap); `src/lib/workbench/dsm.test.ts:167` (untyped connection, unlinked element); `src/lib/engine/toolkit/views/views.test.ts:501`. Ran in this session.
- **Limitations:** No check for unallocated actions; no cycle check on derivation; dangling links are warnings, not errors.
- **Status:** Partially verified
- **Score:** 2
- **Next action:** bug fix (count links to elements outside the matrix before flagging "no links"; or an "unallocated steps" filter).

### Can users navigate between structural and behavioral views?
- **Answer:** Yes. The related panel lists, for any element, what it is typed by, specializes, satisfies, verifies, connects to, flows to, is allocated to/from and derives, in both directions, each opening the element; a flight-controller part lists the actions allocated to it, an action lists its part. Diagrams and tables select into the inspector and **Show in SysML** goes to the text. The action flow view can draw allocations as swimlanes.
- **Evidence:** `src/lib/engine/toolkit/diagrams/related.test.ts:34` (`in allocates DeliveryMission::DeliveryFlight::takeOff` on the flight controller), `:58`, `:70`. e2e `tests/e2e/smoke.spec.ts:76` (inspector), `tests/e2e/dsm.spec.ts:117` (cell → inspector → text) — not run by me.
- **Limitations:** One hop at a time; no saved "navigation path".
- **Status:** Verified (engine side); UI flows cited, not run by me
- **Score:** 2
- **Next action:** None

### Are allocations between functions, components, and other elements represented correctly where applicable?
- **Answer:** Allocations are SysML `allocate a to b` usages, read as the toolkit resolves them: the related panel (`allocates`, both ways), the `AllocationMatrix` table (`relation:allocation`), the DSM `allocation` kind (from what is allocated to where), and swimlanes. Everything is re-read on each analysis.
- **Evidence:** `src/lib/engine/toolkit/diagrams/related.test.ts:34`; `src/lib/engine/toolkit/views/dsm.test.ts:101`. Ran in this session.
- **Limitations:** No allocation definitions or allocation checks (e.g. "every step allocated to exactly one part"). The DSM "no links" flag ignores allocations to elements outside the matrix (above).
- **Status:** Partially verified
- **Score:** 2
- **Next action:** additional testing (allocation of usages through definitions; `allocation def`).

### Are model dependencies queryable across the project?
- **Answer:** Partly. Saved views are queries over the whole project: `rows = "relation:satisfy|verify|allocation|connection"`, `type:`, `kind:`, `@Metadata`, with `expose`, `filter` and `where` (e.g. requirements with no owner — the seven risk controls in the demo). The related panel answers "what is this related to" for any element; the DSM answers "what does this lead to" for one kind of element and the kinds chosen; references/go-to-definition work across files. There is no general query language and no cross-kind dependency graph.
- **Evidence:** `traceability.assessment.test.ts` (`where = "owner == \"\""` view); `src/lib/engine/toolkit/views/views.test.ts:78`, `:129`, `:375`; `src/lib/engine/toolkit/diagrams/related.test.ts`. Ran in this session.
- **Limitations:** `where` compares the columns a row provider offers; it cannot walk relationships.
- **Status:** Partially verified
- **Score:** 2
- **Next action:** planned capability (a query or impact view across kinds).

### Can definitions and libraries be reused across projects without unnecessary duplication?
- **Answer:** Within a project, yes (definitions, specialization, imports across files; the OMG standard library is built in and browsable). Across projects, by **copy**: the risk, DSM, reporting and view libraries are copied into a project's `libraries/` folder on first use and become the project's own; a `.kpar` or `.zip` of another project's files can be imported. There is no shared library dependency (no versioned package a project refers to and updates from).
- **Evidence:** `docs/risk-analysis.md` ("the demo's copies are the only copies in the code"), `src/lib/create/risk.test.ts:177` (first FMEA brings the libraries); `tests/e2e/library-kpar.spec.ts:99` (a `.kpar` from another tool imports) — e2e not run by me.
- **Limitations:** A fix to a shared library must be copied into each project by hand; nothing says a project's copy is out of date.
- **Status:** Partially verified
- **Score:** 1
- **Next action:** planned capability (library packages referenced by version, e.g. from a Git repository or `.kpar`, with an "update available" notice).

### Can users manage model complexity through packages, hierarchy, filtering, and scoped views?
- **Answer:** Yes. Packages and nested usages are shown as a model tree with a filter; views scope with `expose X::*`, `X::**` and the DSM's `levels`, filter by metaclass or metadata (`filter @SysML::PartUsage`), and narrow rows with `where`; reports cover what their view exposes. Saved views are model content, so a scope is shared through Git.
- **Evidence:** `src/lib/engine/toolkit/views/views.test.ts:301`, `:315`, `:375`, `:584`; `src/lib/engine/toolkit/views/dsm.test.ts:149`; `src/lib/reports/reports.test.ts:201` (report narrows to its expose). Ran in this session.
- **Limitations:** Large-model behaviour is §10's.
- **Status:** Verified
- **Score:** 2
- **Next action:** None

### Can users inspect upstream and downstream dependencies for a model element?
- **Answer:** One hop both ways for any element (related panel: `in`/`out` for typing, specialization, satisfy, verify, connect, flow, bind, allocate, derive). Transitively, within a DSM: "What a change affects" follows the counted kinds from an element (from STK-001: SYS-001, SYS-002, SYS-010; from the battery: what it powers and what those command). Not shown: FMEA lines that name a risk control or are about an element, and impact across kinds.
- **Evidence:** `src/lib/engine/toolkit/diagrams/related.test.ts`; `src/lib/workbench/dsm.test.ts:130`, `:144`; `traceability.assessment.test.ts` (requirement DSM impact; risk-control related panel). Ran in this session.
- **Limitations:** See §7 "Can requirement changes identify affected designs, tests, and risks?".
- **Status:** Partially verified
- **Score:** 2
- **Next action:** planned capability (FMEA lines in the related panel).

### Are validation results actionable and traceable to relevant elements?
- **Answer:** Yes. Problems lists syntax errors, the engine's diagnostics (unresolved reference, wrong relationship target, duplicate names), the app's checks (requirement constraint violated, with the values against the limit; FMEA rating out of scale; severity disagreeing with the hazard; unacceptable risk; high priority without a verified control; satisfy root named like the subject; subject not first; duplicate requirement IDs; a note for a requirement without an ID suggesting the next free one), each at its file and line with a jump. Table cells carry their own flags.
- **Evidence:** `traceability.assessment.test.ts` (dangling references at their lines after a rename, a move and a merge; RC-099; removed part); `src/lib/engine/toolkit/evaluation.test.ts:100`; `src/lib/engine/toolkit/views/risk.test.ts:157`; `src/lib/project/requirementIds.test.ts:18`, `:65`; `src/lib/project/requirementChecks.test.ts:33`. Ran in this session.
- **Limitations:** Unresolved references are warnings; nothing ties a warning to the coverage figure it changed.
- **Status:** Verified
- **Score:** 3
- **Next action:** None

### Can teams define and enforce modeling conventions?
- **Answer:** Define, partly; enforce, barely. What exists: (1) **library constraints** — an `assert constraint` on an attribute def (e.g. `FmeaRating` 1–10) is checked on every value of that type and reported as a problem, so a team can encode value rules in its own library (the type's base type is not checked: a likelihood of 5.5 for an `Integer` rating passes, §7); (2) **saved `where` views** that list violations (requirements without an owner); (3) **built-in checks** for requirement IDs (shared IDs warned, missing IDs noted) and the subject rules. What does not exist: user-defined structural rules (naming patterns, "every requirement has a verification method", "every part has a mass"), rule severities, or a gate that blocks a commit or a pull request.
- **Evidence:** `src/lib/engine/toolkit/views/risk.test.ts:157` (library constraint enforced); `traceability.assessment.test.ts` (`where` view of requirements without an owner); `src/lib/project/requirementIds.test.ts`. Ran in this session.
- **Limitations:** Views list, they do not fail anything; the built-in checks are fixed.
- **Status:** Partially verified
- **Score:** 1
- **Next action:** planned capability (rules as model content — e.g. a `@Convention` metadata on a view meaning "rows are problems" — and a CI script that fails on them).

### Can the same model support architecture, verification planning, engineering analysis, and review without duplicate sources of truth?
- **Answer:** Yes: architecture, requirements, verification cases, analyses, budgets, trade studies, FMEA, hazard log, views and reports are one set of SysML files; tables, diagrams, checks, the review's semantic diff and reports are computed from them on each analysis; only diagram positions are stored outside the model (`layout/diagrams.json`). One caveat: "coverage" is computed by three slightly different rules (home, tables, report — a need covered through derived requirements is a gap on the home view and covered in the report).
- **Evidence:** `traceability.assessment.test.ts` (home gaps = gaps table); `src/lib/reports/reports.test.ts:180` (report coverage); `src/lib/reports/revision.assessment.test.ts` (report is a pure function of the files); `src/lib/engine/toolkit/compare.test.ts:77` (review from two versions of the same files). Ran in this session.
- **Limitations:** Coverage definitions differ; test results are not part of the model (§7).
- **Status:** Verified
- **Score:** 2
- **Next action:** planned capability (one coverage rule everywhere).

---

## Section score table

| Sub-area | Score | Notes |
| --- | --- | --- |
| Coherent multi-aspect model | 2 | Demo covers every aspect; checks clean |
| Requirement traceability | 2 | Standard relationships; subject-name `satisfy` warned |
| Gap detection | 2 | Requirements yes; unallocated steps flagged wrongly |
| Structure ↔ behaviour navigation | 2 | Related panel, both ways |
| Allocations | 2 | Read correctly; no allocation checks |
| Project-wide dependency queries | 2 | Views with `where`; no query language |
| Library reuse across projects | 1 | Copy, not reference |
| Complexity management (scopes, filters) | 2 | |
| Upstream/downstream inspection | 2 | One hop, or transitive within a DSM |
| Actionable validation | 3 | File/line, values, suggestions |
| Modelling conventions | 1 | Library constraints and views; no rules engine |
| Single source of truth | 2 | Three coverage rules |

## Critical findings

None in this section. The satisfy-subject reading reported by §1 (trace links another tool
does not see) is mitigated on main: Problems warns at each such `satisfy`, and the demo no
longer uses the subject's name for the part.

## Other findings (not critical)

1. **DSM "no links" flag ignores links outside the matrix.** Repro: open `deliveryFlightDsm`,
   count only *allocation*: every step is flagged as having no links, though each is
   allocated to a part (shown under "Also, outside this matrix"). Test:
   `traceability.assessment.test.ts`, "the functional DSM, counting allocations, flags only
   steps no part is allocated" (`it.fails`, `traceability.assessment.test.ts:367`). Code: `src/lib/workbench/dsm.ts:248`.
2. **Three coverage rules** (home/tables vs report) for needs covered through derivation.

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Count outside-matrix links in the DSM "no links" flag (or an "unallocated steps" check) | Medium | Medium | S |
| Conventions as model content that Problems and a CI script enforce | High | High | M |
| Library packages referenced by version instead of copied | Medium | High | L |
| Cross-kind impact/query view (requirement → design → tests → risks) | High | High | M |
| One coverage rule across home, tables and report | Medium | Medium | S |
