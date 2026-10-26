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

| Category | Score | Critical gaps (open) | Evidence |
| --- | --- | --- | --- |
| SysML v2 / KerML correctness | 3 (engine 2) | None open; the engine's satisfy resolution is mitigated in the app | §1: conformance runner, pilot comparison, construct matrix |
| Text/diagram round-trip fidelity | 3 | None | §2: 55 edit kinds on a hostile fixture, byte comparisons, undo |
| Import/export interoperability | 3 with itself, 1 with SysON | None open; SysON's API is unusable from Fairtide (reported, not silent) | §3: acceptance model compared by meaning, live SysON and pilot runs |
| MBSE modelling coverage | 2 | None | §4 |
| State-machine simulation | 2 | None open | §5: 13 reference traces from the specification |
| Calculations and trade studies | 2 | A definition's `assert constraint` is checked only for the definition's own values | §6: hand-calculated known answers |
| Requirements and verification | 2 | None; pass/fail results and revision-stamped reports don't exist (not claimed) | §7: identity across rename/move/merge, AIAG-VDA table |
| Data integrity and Git collaboration | 3 | None open | §8: crash, tab, folder, merge and archive tests |
| Software quality and maintainability | 2 | None | §9: test inventory, coverage, CI history |
| Performance and usability | 2 | None | §10: measured distributions, phone emulation |
| Security and deployment | 2 | None | §8, §9, §10: tokens, static hosting under a strict CSP, no telemetry |

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
| A definition's `assert constraint` is checked only against the definition's own values: a subtype that breaks it reads "Met". | 6 | **Open.** Engine and app; kept as a failing test; first on the roadmap. |

## Roadmap, by engineering impact

1. **The open critical:** check a definition's constraints for each part and subtype that has it.
2. **Deploy only what passed CI** (5 of the last 40 deploys published a commit whose CI had failed).
3. **Engine calls that never answer:** time them out and say so (today the model stops updating silently).
4. **Checks at 50k lines are 1.8–2× slower than before** (the app's metadata checks grow quadratically; `views/domains.ts` `metadataDefinition`, cache per view context).
5. **Verification results:** pass/fail outcomes on verification cases, tied to the commit they were run against; reports that name their commit.
6. **Save to server:** read the server back after saving before making Fairtide's requests fit SysON's API.
7. **Change impact:** a changed requirement or risk control names the designs, tests, mitigations and FMEA lines that depend on it; circular derivations.
8. **Security:** the API client must not send its token to another host named by a server's link; check archive paths; ship a Content-Security-Policy; dependency audit in CI.
9. **Keyboard:** focus ring in the explorer filter, arrow keys in the project menu, focus back after its dialogs, a skip link; the accessibility check to wait for animations (the flaky contrast failure is a race).
10. **Browsers:** Firefox and Safari in CI.
11. **Smaller:** unresolved names as errors; line endings and encodings kept; the review's change summary; one unit list matching the library; FMEA ratings must be whole numbers; versioned storage formats and releases.

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
- **Analyse:** budgets, trade studies and the simulator each gave confident
  wrong answers in specific cases; eight are fixed with known-answer tests.
  One remains (inherited constraints), and analysis outside budgets, checks,
  trade studies, FMEA and the simulator is not claimed.
- **Exchange:** Fairtide's own formats round-trip by meaning, and its text
  passes the reference implementation; exchange with SysON is not
  trustworthy today, mostly through SysON's own faults, and Fairtide says
  when it fails rather than reporting success.

So: trustworthy for representing and modifying models, with the evidence in
the reports; trustworthy for the analyses it offers once the open constraint
gap is closed; not yet for exchange with SysON, or for regulated workflows
that need recorded verification results, approvals or e-signatures, which
it does not claim.

## Reproducing

The new tests are in the unit and browser suites (`*.assessment.test.ts`,
`tests/e2e/assessment-*.spec.ts`), so CI runs them. A known gap is kept as
an expected failure (`it.fails`, `test.fail`), which turns red when it is
fixed so that it becomes a plain test. The conformance run is
`npm run assess:conformance`; the performance benches are in `tests/perf`
(`assessment-*`); the pilot and SysON checks need Java and Docker
([interop tools](../interop-tools.md)).
