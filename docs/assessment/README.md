# Robustness and MBSE assessment

An assessment of Fairtide as software and as an MBSE tool, question by
question, against the owner's checklist (correctness, edge cases,
interoperability, failure handling, reproducibility). Each section's report
gives, per question, the answer, the evidence (tests and commands to
reproduce it), limitations, a status and a score from 0 (unknown) to 4
(proven by another tool or by use). Scores are capped at 3 unless another
tool checks the result automatically: the OMG pilot implementation and
SysON, run by the scripts in [the interop tools](../interop-tools.md).

Interim: four of the ten sections are done (October 2026). The rest
(simulation, calculations and trade studies, MBSE coverage and requirements,
software quality, performance and deployment) are not assessed yet.

| Section | Report | Headline |
| --- | --- | --- |
| 1. Language coverage | [01-language](01-language.md) | 309/309 official example files parse; 99.4–99.8 % of references resolve; the engine and the pilot agree on 249 of 251 SysML files. Re-run with `npm run assess:conformance`. |
| 2. Text, diagrams, round trips | [02-round-trip](02-round-trip.md) | 55 kinds of edit change only their target: comments and other files byte-identical, one undo restores every byte, no drift over repeated round trips. |
| 3. Import, export, interoperability | [03-interchange](03-interchange.md) | Fairtide ↔ Fairtide (JSON, `.kpar`) keeps the meaning exactly; with SysON, text works one way and its API doesn't work either way. |
| 8. Data integrity, Git, recovery | [08-data-integrity](08-data-integrity.md) | Tokens never reach project files, archives, caches, addresses or logs; Save to GitHub never overwrites; an edit survives the browser being killed once Saved shows. |

## Scores so far

Fairtide's own scores (the engine's, where they differ, are in each report).

| Area | Score | Notes |
| --- | --- | --- |
| Parsing and resolving the official corpus | 3 | Measured, reproducible; the engine's own correctness scores 2 (see the satisfy finding). |
| Preserving what the editors can't show | 3 | Byte-identical through every edit kind. |
| Edits, round trips, layout apart from the model | 3 | |
| Undo, exports, save/reload, responsiveness | 2 | Undo fixed since (below). |
| Fairtide ↔ Fairtide exchange | 3 | |
| Exchange with SysON | 1 | SysON's API and its text export lose data; Fairtide's API client was only tested against its own mock. |
| Browser storage, crash recovery, GitHub collaboration | 3 | |
| Shared folders | 1 → fixed | Save to folder overwrote changes made on disk (fixed since). |

## Critical findings and what became of them

Critical means silent data loss, a model silently changed in meaning, or a
misleading result shown as correct. Each fix was proven with a test that
fails without it and passes with it.

| Finding | Section | Status |
| --- | --- | --- |
| `satisfy R by drone.x`: other tools read `drone` as R's own subject; the engine reads the imported part, so trace tables showed links another tool doesn't see (six in the demo). | 1 | **Mitigated.** The engine bug is reported upstream ([engine](../engine.md)); Problems warns at such a satisfy with the spelling that means the part; drawing a link and the Set a limit form write that spelling; the demo and the blank template no longer use the subject's name for the part. The pilot now finds no errors in the demo. |
| Requirements that declare a stakeholder before any subject (six in the demo); the engine accepts them, the pilot rejects them. | 1 | **Mitigated.** Problems warns (the pilot's four cases matched); the demo is fixed. |
| Removing a specialization made an untouched `:>> mass` redefine the library's `ISQ::mass`, with no warning; budgets changed silently. | 2 | **Fixed.** The edit's notification names every redefinition that now redefines something else. |
| Undo restored whole files, losing anything typed after the edit; a notification's Undo undid the latest edit, not its own. | 2 | **Fixed.** Undo reverses only its own edit and keeps later typing; it refuses, changing nothing, when its own text has been changed since. |
| Metadata values (`@Safety { level = 3; }`) exported to JSON as new features, which other tools read as the metadata left unset. | 3 | **Fixed** in the export. |
| Importing an archive dropped files that aren't UTF-8 text, and checksum warnings, without a word. | 3, 8 | **Fixed.** A notice names each file left out and why. |
| Two tabs of one project overwrote each other's saves. | 8 | **Fixed.** A save based on an out-of-date copy is refused and says why. |
| "Get latest" could revert edits made while it waited for conflict choices. | 8 | **Fixed.** It stops and asks to run again. |
| Save to folder overwrote changes made to the same file on disk. | 8 | **Fixed.** Changes only on disk are brought in; changes on both sides are put to the person with the same choices as Get latest, and nothing is written until they choose. |
| The status said Saved during the 0.6 s before a change was stored. | 8 | **Fixed** (it says Saving…). |

## Open, not critical (the reports give each a proposed fix)

- **Save to server** reports success on any reply and never reads the server
  back; SysON answers success and drops new elements. Read back after saving
  must come before making Fairtide's requests fit SysON's API.
- **Element ids** change on every export → import cycle and when a file moves;
  requirement IDs (short names) are the stable handle (Problems warns at
  duplicates).
- **Unresolved names** show as warnings, so a broken model can read "0 errors".
- The API client sends its token to whatever host a server's "next page" link
  names; archive paths (`../`, absolute) are not checked; a corrupted ZIP entry
  is not noticed.
- Opening a file with Windows line endings rewrites it; some edits mix line
  endings; a folder file that isn't UTF-8 is read with replacement characters.
- The review's change summary misses some changes (`default` vs `=`,
  `derived`, `expose`) and reports reformatting as a change.
- While an unclosed `{` is being typed, up to 28 elements leave the explorer and
  diagrams for a moment.
- The pilot warns at six satisfy links in the demo whose part is not of the
  requirement's subject type (`by drone.flightController` for a requirement
  about the drone); Fairtide doesn't check subject types.

## Reproducing

The new tests are in the unit and browser suites (`*.assessment.test.ts`,
`tests/e2e/assessment-*.spec.ts`), so CI runs them. A known gap is kept as
an expected failure (`it.fails`), which turns red when it is fixed so it can
become a plain test. The conformance run is `npm run assess:conformance`;
the pilot and SysON checks need Java and Docker ([interop tools](../interop-tools.md)).
