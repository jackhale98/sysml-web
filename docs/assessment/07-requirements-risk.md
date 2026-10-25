# §7 Requirements, Risk, and Verification

Assessed on `origin/main` at `92cfbcf` (branch `claude/assess-mbse`). New evidence is in
three test files, all run in this session on the real toolkit in Node:

- `src/lib/project/traceability.assessment.test.ts` — requirement identity (rename, move,
  file rename, Git merge), coverage, gaps, risk references, change impact, conventions.
- `src/lib/engine/toolkit/views/fmea.assessment.test.ts` — RPN, RPN bands, AIAG-VDA action
  priority against an independently typed handbook table, configuration, rating limits.
- `src/lib/reports/revision.assessment.test.ts` — reports regenerated from a revision.

Reproduce:
`npx vitest run src/lib/project/traceability.assessment.test.ts src/lib/engine/toolkit/views/fmea.assessment.test.ts src/lib/reports/revision.assessment.test.ts`

Existing tests also run in this session (all passing) are named where cited.

"Coverage" means three slightly different things in the app; this matters for several
answers below:

| Where | Counts | A need covered only through derived requirements |
| --- | --- | --- |
| Home rings and gap list (`workspace.coverage`, `src/lib/project/workspace.svelte.ts:131`, from `collectRequirements`, `src/lib/project/requirements.ts:33`) | requirement **usages**, direct `satisfy`/`verify` only | a gap ("Not allocated", "No test") |
| Tables (`requirements`/`trace` rows, `src/lib/engine/toolkit/views/rows.ts:460`) | usages and unused requirement defs; satisfying a usage counts for its def and supertypes | a gap |
| Specification report (`src/lib/reports/specification.ts:65`) | requirements in the report's scope | **covered** ("Through the requirements derived from it") |

On the demo: home 24 requirements, 16 satisfied, 13 verified, 11 with a gap (six of them
stakeholder needs); the report over its 17 requirements says 76 % satisfied, 65 % verified,
6 gaps (`src/lib/reports/reports.test.ts:180`).

---

### Do requirements have stable identities across edits, moves, renames, and Git merges?
- **Answer:** The stable identity is the requirement's **short name** (`requirement <'SYS-001'> 'Flight endurance'`), which is plain SysML and survives every rename and move tested. The engine's element ids are UUIDv5s of the qualified name *and the file (unit) name*: they change on any rename, move or file rename (`docs/engine.md:567`, `:883`), so nothing in the app relies on them across versions; the review matches elements by id, then by owner/name/body similarity. Results: (1) **rename through the app** (engine `rename` op) — ID, title, satisfy/verify links and coverage kept, no problems, the review says "Renamed requirement `SYS-001` to `Hover endurance`" with no add/remove; (2) **rename typed in the text** — each old reference is reported as `unresolved reference` (warning) at its line, and coverage drops honestly (SYS-001 loses both links); (3) **move to another package in a new file**, imports updated by hand — ID, links, coverage kept, review says "Moved requirement `SYS-002` … from `SystemRequirements` to `PayloadRequirements`"; without updating imports each reference is reported; (4) **file rename** — engine ids change, ID/links/coverage unchanged, review reports one line ("Moved package … to the file …"); (5) **Git merge** (the app's own `merge3`) of a rename on one side and a new `satisfy` by the old name on the other merges cleanly and the dangling `satisfy` is reported at its line; two branches adding `SYS-012` to the same package merge cleanly and the engine reports a duplicate-name **error**. Two requirements with the same ID in **different packages** are not flagged on this base; a check for that (`src/lib/project/requirementIds.ts`, commit `9480cb8`) is landing on main now — the test switches from `it.fails` to `it` automatically when the file is present.
- **Evidence:** `src/lib/project/traceability.assessment.test.ts:115` (rename via app), `:137` (typed rename), `:155`/`:172` (move), `:182` (file rename, ids change), `:203` (merge, dangling link), `:219` (merge, duplicate ID error), `:252`/`:255` (cross-package duplicate ID, conditional on the landing check). Existing: `src/lib/engine/toolkit/compare.test.ts:166` (ids by qualified name; unnamed elements by position), `src/lib/review/semantic.test.ts:142`, `:215`. All ran in this session.
- **Limitations:** No "move to package" operation in the app: a move is cut/paste plus fixing imports by hand. Unresolved references are **warnings**, not errors, so a merged model with a dangling trace link still "works" and its coverage silently loses that link apart from the warning. The review of an app rename also lists an unrelated unnamed `objective` (in `analysis/Performance.sysml`) as removed and added (`traceability.assessment.test.ts:131`, `it.fails`). Unnamed relationships (`satisfy`, `verify`) have positional engine ids (`compare.test.ts:211`): fine for the review (it matches them by content) but not an identity for an external tool. A requirement without a short name has no identity that survives a rename.
- **Status:** Verified (for the scenarios listed)
- **Score:** 2 (Fairtide; identity is a modelling convention plus the engine's name resolution)
- **Next action:** bug fix (spurious `objective` change in the review); merge the requirement-ID check; consider raising unresolved trace references to errors in the gap views.

### Can requirements be traced through design, implementation, and verification?
- **Answer:** Yes, within the model, with standard SysML: `#derivation` connections (need → requirement), `satisfy R by X` (design or a `Mitigation` action as "implementation"), `verify` in a verification case's objective, `allocate` (behaviour → structure). The requirements table, trace matrix, verification matrix, requirement coverage, requirement gaps, requirement DSM, the related panel and the specification report all read these. "Implementation" outside the model (code, drawings, test logs) cannot be linked except as text. Note from the lead's interop work: the OMG pilot implementation resolves `drone` in `satisfy 'Battery protection' by drone.battery` (`src/demo/drone/system/Satisfaction.sysml:18`) to the requirement's own `subject drone`, not the imported architecture part, so the trace links Fairtide shows for the demo may not be what another tool reads from the same text (under investigation by the language section).
- **Evidence:** `traceability.assessment.test.ts:262` (links follow edits), `:392` (related panel: `in satisfies drone`, `in verifies enduranceFlightTest`, `out derives 'Parcel delivery'`); existing `src/lib/project/requirements.test.ts:102`, `src/lib/engine/toolkit/diagrams/related.test.ts:70`, `src/lib/reports/reports.test.ts:131`, `src/lib/engine/toolkit/views/dsm.test.ts`. Ran in this session.
- **Limitations:** No link to external artefacts. Trace across the derivation chain to verification is computed only in the report. Possible semantic disagreement with the pilot implementation on `satisfy … by <name>` resolution (see above).
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing (cross-check trace links with the pilot implementation once the language question is settled).

### Are coverage metrics derived from actual model relationships?
- **Answer:** Yes: every figure is computed from the resolved `satisfy`/`verify` (and, in the report, `#derivation`) relationships on each analysis; nothing is stored. Adding a `satisfy` raises "satisfied" from 16 to 17 and emptying an objective drops "verified" from 13 to 12; an unresolved link does not count. The home view's gaps and a `RequirementGaps` table name the same requirements. But there are three definitions (table above): the report counts a need covered through its derived requirements, the home view and tables do not. And "verified" means *a verification case names it*, not that a test passed.
- **Evidence:** `traceability.assessment.test.ts:262`, `:281`, `:137` (unresolved link not counted); `src/lib/reports/reports.test.ts:180`. Interop note above (pilot reads the demo's `satisfy … by drone…` differently). Ran in this session.
- **Limitations:** Inconsistent definitions across home/tables/report; "verified" is planned verification, not executed; trace semantics may differ from another tool for `satisfy … by` names that a requirement's subject shadows.
- **Status:** Verified (derivation from relationships); Partially verified (consistency)
- **Score:** 2 (Fairtide)
- **Next action:** planned capability (one coverage definition shared by home, tables and report, with "through derived requirements" shown as such everywhere).

### Can Fairtide identify missing, circular, contradictory, or orphaned relationships where meaningful?
- **Answer:** *Missing*: unsatisfied and unverified requirements (home gap list, `RequirementGaps`, report Gaps chapter); FMEA lines of high priority or unacceptable risk without a verified control; DSM "unlinked" flags (a step with no allocation, a part with no connection) and untyped connections. *Dangling/orphaned*: any reference that no longer resolves (a `satisfy`/`verify`/derivation to a renamed requirement, an `@Fmea about` a removed part, a `riskControls` naming a control that does not exist) is an `unresolved reference` warning at its line. *Wrong kind*: `satisfy` of a non-requirement is an error from the engine. *Circular*: not detected (a derivation cycle A→B→A raises nothing). *Contradictory*: not detected between requirements; a requirement's own constraint can be reported violated by the design.
- **Evidence:** `traceability.assessment.test.ts:281`, `:301`, `:313` (`it.fails`, circular), `:326`, `:334`, `:365`; existing `src/lib/create/riskReview.test.ts:277`, `src/lib/workbench/dsm.test.ts`. Ran in this session.
- **Limitations:** Circular derivation and contradictory requirements are not checked. Dangling references are warnings, not errors. A need without derived requirements and without links is listed as a gap but not called "orphaned".
- **Status:** Partially verified
- **Score:** 2 (Fairtide; resolution diagnostics are the engine's)
- **Next action:** planned capability (derivation-cycle check; an "orphan" filter in the gap views).

### Can verification cases specify methods, expected results, and pass/fail outcomes?
- **Answer:** *Method*: yes — `@VerificationMethod { kind = … }` on the case (SysML's `VerificationCases` library) and the requirement's own `verificationMethod` attribute (`EngineeringBasics`), shown in the requirements table. *Expected result*: yes as model content — the case's doc and a `return :>> verdict = PassIf(…)` expression (`src/demo/drone/verification/VerificationPlan.sysml:26`). *Pass/fail outcome*: **no**. Nothing records that a case was run or what it returned; the case's `verdict` expression is not evaluated into any table. The "check" verdicts the app shows (satisfied / violated / undecided) are the requirement's `require constraint` evaluated against the design's values — a design analysis, not a test result.
- **Evidence:** `traceability.assessment.test.ts:355` (no verification case appears among the checks; SYS-001's "satisfied" comes from the design); `src/lib/engine/toolkit/views/rows.ts:492` (the requirement's verdict is the worst check of its constraint); `docs/table-rendering.md`. Ran in this session.
- **Limitations:** No test-result model, no import of test results, no link from a result to a requirement.
- **Status:** Partially verified (methods, expected results); outcomes not offered
- **Score:** 1 (Fairtide)
- **Next action:** planned capability (record outcomes as model content, e.g. an `@VerificationResult { verdict; date; revision; evidence }` metadata on the case, shown in the verification matrix).

### Are test results associated with the exact model revision they verify?
- **Answer:** No test results are recorded (previous question), so none is tied to a revision. Git history (commit SHA, author, time) identifies model revisions, and the review can compare any of a branch's last 15 commits, but nothing links an outcome to one.
- **Evidence:** none in code (`src/lib/review/remote.ts:24`, `src/lib/git/github.ts:451` for revisions only).
- **Limitations:** —
- **Status:** Not claimed
- **Score:** — (not claimed). Gap note for regulated use: verification evidence must live outside Fairtide (test management system) and reference the commit SHA by hand.
- **Next action:** planned capability (result metadata carrying the commit it was run against).

### Can requirement changes identify affected designs, tests, and risks?
- **Answer:** Partly. (1) The **review** (semantic diff against a commit, branch or pull request) reports the changed requirement and, first, any **verdict** it changes: tightening SYS-001 to 35 min shows "`drone.endurance` now violates `SYS-001` ‘Flight endurance’ (27.54 min < 35 min)". It does **not** list what depends on the changed requirement: rewording risk control RC-001 reports only "description reworded", not its verification case (`batteryAbuseTest`), its mitigation (`batteryManagementSystem`) or the FMEA line that relies on it. (2) The **related panel** shows one hop both ways (what satisfies, verifies and derives a requirement), but not FMEA lines that name a control in `riskControls`. (3) The **requirement DSM**'s "What a change affects" follows derivation transitively (STK-001 reaches SYS-001, SYS-002, SYS-010), not satisfy/verify/risk.
- **Evidence:** `traceability.assessment.test.ts:382`, `:392`, `:407`, `:415` (`it.fails`: related panel without FMEA lines), `:425` (`it.fails`: review without dependants); existing `src/lib/engine/toolkit/compare.test.ts:93`. Ran in this session.
- **Limitations:** No transitive impact across kinds (requirement → design → other requirements' verdicts → tests → risks) in one place.
- **Status:** Partially verified
- **Score:** 1 (Fairtide)
- **Next action:** planned capability (an impact list for a changed requirement: its satisfiers, verification cases, derived requirements and FMEA lines/hazards, in the review and the related panel).

### Can risk analyses reference model elements and remain consistent when the architecture changes?
- **Answer:** Yes. An FMEA line is `@Fmea about drone::battery { … }` — a model reference; its `hazard`, `riskControls` (by control ID) and `mitigations` are references too. Renaming the part through the app updates the line (the worksheet shows `drone::powerPack`); removing the part leaves the line with an `unresolved reference \`drone::battery\`` warning at the line; a `riskControls` naming a control that doesn't exist is reported the same way. A severity that disagrees with the worst harm of the line's hazard is flagged.
- **Evidence:** `traceability.assessment.test.ts:326`, `:334`; existing `src/lib/engine/toolkit/views/risk.test.ts:180`, `src/lib/create/riskReview.test.ts:98`, `src/lib/engine/toolkit/compare.test.ts:108` (FMEA follows a part rename in the review). Ran in this session.
- **Limitations:** Warnings, not errors; the review of a part removal does not say an FMEA line was orphaned. FMEA lines on a definition apply to every usage, which the worksheet shows once.
- **Status:** Verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing (an FMEA line about a usage inherited through a definition).

### Are FMEA calculations and risk-priority metrics configurable and correct?
- **Answer:** Correct against independent known answers, and configurable through the project's own library. The RPN equals S×O×D and the action priority equals the AIAG-VDA (2019) DFMEA/PFMEA table in **all 1000 rating combinations** (the table is typed into the test as the handbook lays it out, not derived from the library). RPN bands fall at the default thresholds (51/151/401) on the worksheet — 50 low, 54 medium, 150 medium, 160 high, 400 high, 405 critical — and move when the project's library changes them; a project that changes the `ActionPriority` calc gets its own answer on the worksheet; the worksheet sorts by RPN numerically. Ratings 1 and 10 are accepted; 0, 11 and 5.5 are flagged in their cell and leave RPN, priority and band empty rather than computing a figure from an invalid rating. The risk policy (`Acceptability`) is a calc a form paints; the toolkit evaluates the painted calc to the same zones in every cell.
- **Evidence:** `src/lib/engine/toolkit/views/fmea.assessment.test.ts:99` (oracle sanity), `:117` (1000 cells), `:155`, `:170`, `:192`, `:211`; existing `src/lib/engine/toolkit/views/risk.test.ts:103` (app = toolkit, every cell), `src/lib/create/riskPolicy.test.ts:73`, `:103`. Ran in this session.
- **Limitations:** Only the DFMEA/PFMEA action-priority table (not FMEA-MSR). The RPN has no "S≥9 always reviewed" rule unless the project's policy adds it (the default `Acceptability` and the AP table cover it). Not cross-checked by another FMEA tool.
- **Status:** Verified
- **Score:** 3 (Fairtide; calcs evaluated by the toolkit from the project's library)
- **Next action:** None (optionally an FMEA-MSR table as an alternative library calc).

### Can users distinguish identified risks, mitigations, verification activities, and evidence of mitigation effectiveness?
- **Answer:** Partly. Distinct, typed model elements: hazards / hazardous situations / harms (`HazardAnalysis`), FMEA lines (`@Fmea`), risk controls (`RiskControl` requirements), mitigations (`Mitigation` actions with `status`: proposed, inProgress, completed, verified), and verification cases that `verify` a control. The FMEA risk-reduction view shows before/after RPN, priority and acceptability, the controls with whether they are verified, and the mitigations with their status. *Evidence of effectiveness* is only a `verify` link plus a status someone typed; no test outcome is recorded (see above).
- **Evidence:** `src/lib/create/riskReview.test.ts:98`, `:277`; `src/lib/engine/toolkit/views/risk.test.ts:239` (hazard log); demo `src/demo/drone/risk/DesignFmea.sysml`. Ran in this session.
- **Limitations:** "Verified control" means "a verification case names it"; a `Mitigation` status of `verified` is self-declared.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** planned capability (tie "verified" to a recorded passing result).

### Can reports be regenerated from a specific revision for review or audit?
- **Answer:** A report is a pure function of the model files plus the date stamp: the same files give the same document byte for byte, and the files of an older revision give that revision's figures (76 % satisfied before a link is added, 82 % after). In the app, a project opened from GitHub is opened at a **branch head** (the branches API, `src/lib/git/github.ts:275`), so regenerating a report for an old commit means making a branch at it on GitHub, or checking it out locally and opening the folder. The review can load any of a branch's last 15 commits, but only to compare. The report names the project version and date, **not the commit** it was built from.
- **Evidence:** `src/lib/reports/revision.assessment.test.ts:45`, `:51`, `:65`; existing `src/lib/reports/reports.test.ts`. Ran in this session.
- **Limitations:** No "open at commit/tag"; no revision stamp on the report; the date is the generation date.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** planned capability (open a project read-only at a commit or tag; stamp reports with repository, branch and commit SHA).

### Are approval identity, timestamps, and change records available where required by the intended workflow?
- **Answer:** Fairtide has no approvals, sign-off states or user accounts of its own. Change records come from Git: commits made through the app carry the GitHub user's identity and time, the review suggests a commit message and pull-request description from the semantic diff, and approvals can be GitHub pull-request reviews. Requirement `@StatusInfo { status; owner }` is free model content, not an access-controlled approval.
- **Evidence:** `src/lib/git/github.ts:332` (commit), `:383` (pull request); `src/lib/review/semantic.test.ts:414` (commit message). Not run beyond those unit tests.
- **Limitations:** Approval identity and e-signature are whatever GitHub provides; nothing in the model records who approved which revision.
- **Status:** Not claimed
- **Score:** — (not claimed)
- **Next action:** None in-app; document a GitHub-based approval workflow (protected branches, required reviews).

### Regulated product-development use (access control, audit trail, e-signatures, validation)
- **Access control:** none in the app (static site; files in browser storage). Repository permissions on GitHub are the only control. **Not claimed.**
- **Audit trail:** Git history of the text (who, when, what, line by line) plus the semantic review for a readable model-level change record. Browser-local edits before a commit have no audit trail.
- **Electronic signatures:** none (no 21 CFR Part 11 / EU Annex 11 signature manifestation, meaning, or binding to a record). GitHub PR approvals are not e-signatures in that sense. **Not claimed.**
- **Validation for a quality system:** no validation package (requirements spec, risk assessment of the tool, IQ/OQ/PQ, traceable test report). The automated tests (including this assessment's) are a starting point for an organisation's own tool validation; the FMEA calcs have known-answer tests.
- **Gap note:** for ISO 13485 / ISO 14971 / IEC 62304 work, use Fairtide as an authoring and analysis tool inside a controlled Git workflow (protected branches, required reviews, signed commits), keep approvals and verification results in a validated system, and record the commit SHA of each reviewed report by hand.

---

## Prioritized question 12: Can requirements be traced through design, verification, and revision-specific evidence?

Through design and planned verification: **yes** (satisfy/verify/derive/allocate read by tables,
matrices, DSM, related panel, report; identity by short name holds through rename, move, file
rename and merge, with dangling links reported). Through **revision-specific evidence: no** —
verification cases cannot record outcomes, and reports are not stamped with the commit. Score 2
for traceability, 0–1 for evidence (not claimed).

## Prioritized question 13: Can the tool identify model changes and their downstream engineering impact?

Model changes: **yes** — the semantic review reports added/removed/renamed/moved elements and
relationships by requirement ID, verdict changes first, budget totals and computed values
(`compare.test.ts`, `semantic.test.ts`, and the rename/move/file-rename tests here), with one
spurious entry found. Downstream impact: **partly** — verdict, budget and value impact is computed;
dependants of a changed requirement (tests, implementers, risks) are not listed; the DSM's change
impact is transitive but within one matrix's kinds. Score 2 for change identification, 1 for
downstream impact.

---

## Section score table

| Sub-area | Score | Notes |
| --- | --- | --- |
| Requirement identity (rename, move, file, merge) | 2 | Short-name ID holds; dangling links are warnings; cross-package duplicate IDs landing |
| Traceability (derive / satisfy / verify / allocate) | 2 | Standard SysML; pilot may read `satisfy … by` differently |
| Coverage metrics | 2 | From relationships; three definitions |
| Missing / circular / orphaned relationships | 2 | No cycle or contradiction check |
| Verification methods and expected results | 1 | Outcomes not recorded |
| Test results tied to revision | — | Not claimed |
| Change impact of a requirement | 1 | Verdicts yes; dependants no |
| Risk references under architecture change | 2 | Renames follow; removals warned |
| FMEA calculations and configuration | 3 | 1000-cell known-answer tests |
| Risks / mitigations / verification / effectiveness | 2 | Effectiveness = a `verify` link |
| Reports at a revision | 2 | Deterministic; branch heads only; no commit stamp |
| Approvals, e-signatures, access control | — | Not claimed (Git/GitHub supply identity and history) |

## Critical findings

None confirmed in this section. One **pending**:

1. *Possible semantic disagreement on trace links* (reported by the lead from the interop
   tools): for `satisfy 'Battery protection' by drone.battery` in
   `src/demo/drone/system/Satisfaction.sysml:18`, Fairtide resolves `drone` to the imported
   `DroneArchitecture::drone`; the OMG pilot resolves it to the requirement's inherited
   `subject drone`. If the pilot is right, Fairtide's trace matrix, coverage and design checks
   on the demo show links another tool does not see (misleading analysis presented as correct).
   Reproduce: open the demo, Trace matrix shows `drone.battery` satisfying SYS-009; run the
   pilot on the same files. Owner: §1 language section.

## Other findings (not critical)

- Review noise: renaming SYS-001 through the app also lists "Added/Removed `objective` in
  `enduranceBudget`" (another file, untouched). Repro: `traceability.assessment.test.ts:131`.
- Coverage definitions differ (home/tables vs report) for needs covered through derivation.
- Unresolved trace references are warnings; the gap views do not say *why* a link vanished.
- Cross-package duplicate requirement IDs are not flagged on this base (check landing in `9480cb8`).

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Verification results as model content (verdict, date, commit, evidence link) shown in the verification matrix and coverage ("verified" = passed) | High | High | M |
| Impact list for a changed requirement (implementers, verification cases, derived requirements, FMEA lines, hazards) in review and related panel | High | High | M |
| Stamp reports with repository/branch/commit; open a project read-only at a commit or tag | High (audit) | High | S–M |
| One coverage definition across home, tables and report | Medium | Medium | S |
| Derivation-cycle check; orphan filter in gap views | Medium | Medium | S |
| Related panel: FMEA lines that name a control / are about an element | Medium | Medium | S |
| Fix the spurious unnamed-`objective` change in the review after a rename | Low | Medium | S |
| "Move to package" refactoring that updates imports and references | Medium | Medium | M |
| Documented GitHub approval workflow for regulated users | Medium | Medium | S |
