# Robustness and MBSE assessment

An assessment of Fairtide as software and as an MBSE tool, question by
question, against the owner's checklist (correctness, edge cases,
interoperability, failure handling, reproducibility), completed in October
2026. Each section's report gives, per question, the answer, the evidence
(tests and commands to reproduce it), limitations, a status and a score:

| Score | Meaning |
| --- | --- |
| 0 | Unknown: no evidence. |
| 1 | Basic: partial, or shown by hand. |
| 2 | Tested: automated tests cover normal use and some edge cases. |
| 3 | Robust: broad tests, failure handling, reproducible evidence. |
| 4 | Proven: another tool or real use confirms it. |

Scores are capped at 3 unless another tool checks the result automatically
(the OMG pilot implementation and SysON, run by the scripts in
[the interop tools](../interop-tools.md)). Averages are not used: a critical
failure is listed on its own, whatever the rest scores.

The section reports and the one-line summaries below are as assessed; what
changed after is under [the findings and what became of them](#critical-findings-and-what-became-of-them)
and [the roadmap](#roadmap-and-what-was-done).

| Section | Report | In one line |
| --- | --- | --- |
| 1. Language coverage | [01-language](01-language.md) | 309/309 official example files parse; 99.4–99.8 % of references resolve; the engine and the pilot agree on 249 of 251 SysML files (`npm run assess:conformance`). |
| 2. Text, diagrams, round trips | [02-round-trip](02-round-trip.md) | 55 kinds of edit change only their target; comments and other files stay byte-identical; no drift over repeated round trips. |
| 3. Import, export, interoperability | [03-interchange](03-interchange.md) | Fairtide ↔ Fairtide keeps the meaning exactly; with SysON, text works one way and its API neither way. |
| 4. MBSE coverage | [04-mbse](04-mbse.md) | Structure, behaviour, requirements and their links in one model; gaps found from relationships; no conventions mechanism. |
| 5. Simulation | [05-simulation](05-simulation.md) | Semantics written down clause by clause and checked by 13 reference traces; three silent misbehaviours fixed. |
| 6. Calculations and trade studies | [06-calculations](06-calculations.md) | Known answers by hand; five silent wrong results fixed; one open. |
| 7. Requirements, risk, verification | [07-requirements-risk](07-requirements-risk.md) | IDs hold through renames, moves and merges; FMEA arithmetic right in all 1,000 cells; no pass/fail results yet. |
| 8. Data integrity, Git, recovery | [08-data-integrity](08-data-integrity.md) | Tokens never leak; Save to GitHub never overwrites; four silent-loss paths fixed. |
| 9. Software quality | [09-quality](09-quality.md) | 1,370 unit and ~210 browser tests, half on the real engine; 86.5 % line coverage; deploys don't wait for CI. |
| 10. Performance, usability, deployment | [10-performance-usability](10-performance-usability.md) | Demo ready in 2.4 s, 100k lines in 27 s; no telemetry; self-hosts on any static server; Chromium only. |

## Scores

Fairtide's own scores; each report also gives the engine's where they differ.
**Assessed** is the score the section reports give. **After the fixes** is the
lead's estimate once every finding below was dealt with; it was not
re-assessed independently, and stays under 4 wherever no other tool checks
the result automatically.

| Category | Assessed | After the fixes | Critical gaps (open) | Evidence |
| --- | --- | --- | --- | --- |
| SysML v2 / KerML correctness | 3 (engine 2) | 3 | None; the engine's satisfy resolution and °C/°F comparisons are worked around in the app | §1: conformance runner, pilot comparison, construct matrix |
| Text/diagram round-trip fidelity | 3 | 3 | None | §2: 55 edit kinds on a hostile fixture, byte comparisons, undo; line endings and encodings kept |
| Import/export interoperability | 3 with itself, 1 with SysON | 3 with itself, 2 with SysON | None; SysON keeps only some kinds of change, and the read-back after saving names what it dropped | §3: acceptance model compared by meaning; SysON v2026.9.3 checked live |
| MBSE modelling coverage | 2 | 3 | None | §4; conventions, circular derivations, one coverage rule |
| State-machine simulation | 2 | 3 | None | §5: 13 reference traces; action steps now run; reachability |
| Calculations and trade studies | 2 | 3 | None | §6: hand-calculated known answers; per-part assertion checks; one unit list |
| Requirements and verification | 2 | 3 | None | §7; recorded results tied to commits, reports stamped with their commit, change impact |
| Data integrity and Git collaboration | 3 | 3 | None | §8: crash, tab, folder, merge and archive tests |
| Software quality and maintainability | 2 | 3 | None | §9; deploys wait for CI; versioned releases and formats |
| Performance and usability | 2 | 2 | None | §10; keyboard fixes; Firefox and Safari run in CI but don't block it yet |
| Security and deployment | 2 | 3 | None | Tokens stay on their own server; archive paths and sizes checked; Content-Security-Policy; dependency audit |

## Critical findings and what became of them

Critical means silent data loss, a model silently changed in meaning, or a
misleading result shown as correct. Every fix was proven with a test that
fails without it and passes with it, re-run by the lead before merging.

| Finding | Section | Status |
| --- | --- | --- |
| `satisfy R by drone.x`: other tools read `drone` as R's own subject; the engine reads the imported part, so trace tables showed links another tool doesn't see. | 1 | **Mitigated.** Reported upstream ([engine](../engine.md)); Problems warns; the app's writers qualify the part; the demo and blank template fixed. The pilot finds no errors in the demo. |
| Requirements declaring a stakeholder before any subject (the engine accepts, the pilot rejects). | 1 | **Mitigated.** Problems warns; demo fixed. |
| Removing a specialization silently made an untouched `:>> mass` redefine the library's `ISQ::mass`. | 2 | **Fixed.** The edit's notification names every redefinition that moved. |
| Undo restored whole files, losing later typing; a notification's Undo undid another edit. | 2 | **Fixed.** |
| Metadata values exported to JSON in a form other tools read as unset. | 3 | **Fixed.** |
| Archive import dropped files without a word. | 3, 8 | **Fixed.** |
| Two tabs of a project overwrote each other. | 8 | **Fixed.** |
| Get latest could revert edits made while it waited. | 8 | **Fixed.** |
| Save to folder overwrote changes made on disk. | 8 | **Fixed.** |
| Budgets worked an inherited expression (`mass = cells * cellMass`) out with the definition's values, not the part's (200 g shown for 300 g). | 6 | **Fixed.** |
| A part declared as one of a collection (`m1 :> motors`) was counted twice. | 6 | **Fixed.** |
| Parts of variable number were left out or counted at their least without a word. | 6 | **Fixed** (the budget names them and the count used). |
| Trade studies ranked scores without their units (0.6 kg beat 450 g). | 6 | **Fixed.** |
| The app's evaluator added an unknown unit to a known one by magnitude. | 6 | **Fixed** (refused). |
| An event was taken from a state the machine was about to leave. | 5 | **Fixed** (events wait for what is ready). |
| Signals with the same simple name were one signal. | 5 | **Fixed.** |
| Steps inside actions (`if`, `send`, successions) were dropped silently. | 5 | **Fixed** (named in the simulator's notes; they still don't run). |
| A definition's `assert constraint` is checked only against the definition's own values: a subtype that breaks it reads "Met". | 6 | **Fixed.** Checked for each part that has it, with that part's values. |
| A value in `°C` or `°F` against a limit in kelvin read "Met" when it wasn't (60 °C within 330 K): the engine compares them as differences. | 6 | **Fixed** in the app, which decides such checks itself; reported upstream. |
| A save to SysON could delete the server's model when none of its elements matched ours (found while fixing §3, against a test server). | 3 | **Fixed.** Removals are sent only after the additions are seen kept, and elements match without root namespaces. |
| An API token was sent to whatever host a server's "next page" link named. | 3, 8 | **Fixed.** Tokens go only to their own server; such a link isn't followed. |

## Roadmap and what was done

Every finding in the section reports was taken up by one of eight fix
agents (simulation, checks, text, platform, units, usability, exchange,
traceability) or by the lead. Each fix came with a test that fails without
it and passes with it, run both ways; the known-gap tests turned into plain
ones.

| Roadmap item | Outcome |
| --- | --- |
| 1. A definition's constraints for each part and subtype | **Done.** Undecided checks are shown in Problems with what's missing. |
| 2. Deploy only what passed CI | **Done.** Deploys run after CI succeeds on the same commit. |
| 3. Engine calls that never answer | **Done.** Calls time out and say so; a memory warning before the tab gives out. |
| 4. Checks at 50k lines | **Done.** The metadata checks are cached per view: 2,946 → 13 ms at 50k. |
| 5. Verification results | **Done (core).** Results are recorded on verification cases as SysML metadata (verdict, date, who, commit, evidence), shown in tables, matrices, the home view and the report, and marked out of date once the model changes after their commit ([verification](../verification.md)). Simulator runs export with their commit but aren't results. |
| 6. Save to server | **Done.** The server is read back after saving and anything it didn't keep is named. Requests now fit SysON's API, checked live: creating and opening projects and changing names and values work; SysON ignores changed references and new elements, and Fairtide says so. |
| 7. Change impact | **Done.** A review names what relies on a changed requirement or risk control (designs, tests, mitigations, derived requirements, FMEA lines); circular derivations are problems. |
| 8. Security | **Done.** Token origin, archive paths, duplicates, checksums and sizes; a Content-Security-Policy; a dependency audit in CI. GitHub Enterprise Server works with access tokens. |
| 9. Keyboard | **Done.** Focus ring, menu arrow keys, focus return, skip links; the accessibility checks wait for animations and hold notifications. |
| 10. Browsers | **Started.** Firefox and Safari (WebKit) run in CI without blocking it, until their first results are reviewed. |
| 11. Smaller | **Done.** Unresolved names are errors; line endings, BOMs and encodings kept; the review's change summary; one unit list from the library, temperature scales, ranges and totals; whole-number FMEA ratings; versioned formats, releases and a changelog. |

### Still open

- **Identity through JSON:** element ids don't survive export, import and
  export again; designed in [interchange](../interchange.md#identity), not built.
- **SysON:** its text export and its loss of `total <= limit` in its own
  element JSON are reported to SysON; Fairtide opens the rest.
- **Libraries across projects:** a design note in [verification](../verification.md);
  replacing a library from the template would overwrite a project's own policy.
- **Conventions in CI:** conventions show in Problems but don't fail a build.
- **Simulator runs as results:** a run can't yet be recorded against a
  requirement or verification case.
- **Signed commits:** not started.

## The final question

*What evidence shows that Fairtide can be trusted to represent, modify,
analyse and exchange real engineering models without silently losing
information or producing misleading results?*

- **Represent:** the official corpus parses and resolves as the reference
  implementation reads it, measured repeatably; where the engine departs
  from the specification (satisfy names, subject order), the app now says
  so rather than showing a different design.
- **Modify:** every kind of edit changes only its target, byte for byte;
  undo, folder saves, tabs, GitHub merges and archive imports were each
  found able to lose work silently and each now refuses or asks instead,
  proven by tests that failed before.
- **Analyse:** budgets, trade studies, checks and the simulator each gave
  confident wrong answers in specific cases; all found are fixed with
  known-answer tests, including inherited constraints and temperatures.
  Analysis outside budgets, checks, trade studies, FMEA and the simulator
  is not claimed.
- **Exchange:** Fairtide's own formats round-trip by meaning, and its text
  passes the reference implementation. With SysON, text works one way and
  its API keeps only some kinds of change; Fairtide reads the server back
  and names what was not kept rather than reporting success.

So: trustworthy for representing, modifying and analysing models within
what it offers, with the evidence in the reports and the tests; for
exchange with SysON, only with the read-back's word on what arrived.
Verification results are recorded against the commit they were run on;
approvals and e-signatures, which regulated workflows need, are not
claimed.

## Reproducing

The new tests are in the unit and browser suites (`*.assessment.test.ts`,
`tests/e2e/assessment-*.spec.ts`), so CI runs them. A known gap is kept as
an expected failure (`it.fails`, `test.fail`), which turns red when it is
fixed so that it becomes a plain test. The conformance run is
`npm run assess:conformance`; the performance benches are in `tests/perf`
(`assessment-*`); the pilot and SysON checks need Java and Docker
([interop tools](../interop-tools.md)).
