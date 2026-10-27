# §1 SysML v2 and KerML language coverage (+ prioritized question 2)

> Written before the fixes that followed it: what became of each critical finding is in [the assessment summary](README.md#critical-findings-and-what-became-of-them).

Assessed on `origin/main` at `92cfbcf` (2026-10-23), worktree
`/home/user/wt-assess-language`. Everything below marked "ran" was run in this
session. Engine = the Open-MBEE sysml-toolkit 0.10.10 (WebAssembly); Tessera =
the TypeScript around it (host, model adapter, diagnostics, diagrams, edits).

## How it is measured (new in this assessment)

There is no published pass/fail OMG conformance suite. Three stand-ins, all
fetched at pinned revisions by `scripts/fetch-conformance.sh` into
`.cache/conformance/` (nothing vendored), and one runner over them:

| Corpus | What it is | How "correct" is decided |
| --- | --- | --- |
| OMG SysML v2 Release **2026-05** (`de1070ae`): `sysml/src/{examples,training,validation}`, `kerml/src/examples` — 309 files | The release the toolkit's library comes from | Every file is meant to be valid. The corpus does **not** mark files invalid: its "should fail" lines are commented out (e.g. `examples/Import Tests/PrivateImportTest.sysml:12`). The OMG pilot reports 0 errors on examples/training/validation (pilot 0.57.0 and 0.62.0, `docs/interop-tools.md` on `claude/interop-tools`). So any error is a false rejection. |
| OMG pilot implementation's Xpect suites, tag 2026-05 (`fa709f28`): 428 `*.xt` files | The reference implementation's own regression tests | Declared expectations next to the model: 515 `errors` items (message at a text), 276 `noErrors` files, 194 `linkedName` (this reference must resolve to that element). |
| OpenSysML negative corpus (`a662c2bc`): 334 files | Models that must be rejected, each citing the rule it breaks | Any error = correct rejection. OpenSysML also recorded the pilot 0.62.0's verdict per file (`pilot-rejection-baseline.json`). |

Runner: `npm run assess:conformance` (`tests/conformance/run.conformance.ts`,
`tests/conformance/corpus.ts`), about 25 s. It writes
`.cache/conformance/out/results.json` (per file, per folder, per suite) and
`summary.md`. It measures parse, reference resolution and validation
separately, then what Tessera makes of the same projects. The run recorded
here is committed as evidence in `docs/assessment/data/01-language/`.
`tests/conformance/compare-pilot.mjs` compares it file by file with the pilot
checker's JSON (`tools/interop/pilot-check.sh --json`, branch
`claude/interop-tools`).

Resolution rate = written cross-references in the compact interchange that
resolved, out of all of them (target ends of typings, specializations,
subsettings, redefinitions, reference subsettings, feature chains, imports,
aliases, memberships of feature references, annotations, dependencies, type
operations; list in `results.json` → `meta.referenceProperties`).


Commands (all run in this session, 2026-10-23):

```sh
scripts/fetch-conformance.sh                       # corpora at pinned revisions
npm run assess:conformance                         # → .cache/conformance/out/{results.json,summary.md}
# pilot verdicts (branch claude/interop-tools, run from its worktree):
tools/interop/pilot-check.sh --version 0.62.0 --quiet --json examples.json --each-dir <release>/sysml/src/examples
#   … training and validation as one model each, kerml/src/examples --each-dir, src/demo/drone
node tests/conformance/compare-pilot.mjs .cache/conformance/out/results.json out.json examples.json training.json …
npx vitest run src/lib/engine/toolkit/*.assessment.test.ts
npm run build && PW_PORT=4327 npx playwright test tests/e2e/assessment-language.spec.ts
```

Evidence kept in the repository: `docs/assessment/data/01-language/`
(`summary.txt`, `results.json`, `pilot-comparison-0.62.0.{txt,json}`).

### Headline numbers (prioritized question 2)

| Measure | Engine (toolkit 0.10.10) | Reference / note |
| --- | --- | --- |
| Corpus files that parse | 309 / 309 (and the demo, 22 / 22) | pilot: all |
| Written references resolved, each suite as one model | examples 99.43 %, training 99.79 %, validation 99.79 %, KerML 97.45 % (13,735 references incl. demo; 248 unresolved per folder) | pilot: 0 linking errors on all four |
| SysML corpus files with a false error | 2 of 251 (Annex A vehicle model: 17 "ambiguous reference"; `13a-Model Containment`: 3) | pilot 0.57.0 and 0.62.0: 0 errors |
| KerML corpus files with a false error | 13 of 58 (86 errors: association-end, cross-subsetting, package-level redefinition, `Types.kerml` endpoint rules) | pilot: 0 errors |
| Unresolved-name warnings on valid SysML corpus | 24 (examples 17, training 4, validation 3) | pilot: 0 |
| Pilot Xpect `linkedName` (resolution oracle) | 191 / 194 agree | 3 not triaged |
| Pilot Xpect `noErrors` files kept error-free | 261 / 276 | 15: circular specialization ×4, ambiguity ×4, KerML association ends ×3, feature-reference metadata ×1, `queryx/failing` ×3 (a folder the pilot names "failing"; syntax errors here) |
| Pilot Xpect `errors` items with a problem shown there | 417 / 515 (203 as an error; the rest mostly unresolved names, which the toolkit reports as warnings) | 98 with nothing shown: e.g. "at most one entry/exit/do action", "only one objective", "Must be an accessible feature" |
| Negative corpus rejected (an error) | 315 / 334 (94.3 %); flagged with an error or warning 320 | pilot (recorded by OpenSysML): 323; both reject 306, pilot only 17, toolkit only 9 |
| Tessera diagnostics vs engine findings (whole corpus) | 355 / 355 shown, all on the engine's exact text range | — |
| Tessera model adapter | 0 of 10,792 located elements lost; 209 named elements without a text extent are not shown | — |
| Tessera diagrams over the corpus | 801 built, 0 failed | per-metaclass coverage in `data/01-language/summary.txt` |
| Demo, pilot vs Tessera | Tessera 0 errors; pilot 12 errors in 2 files | see critical finding C1 |

## 1.1 Language coverage

### Which versions of the SysML v2 and KerML specifications does Tessera target?
- **Answer:** The engine is sysml-toolkit **0.10.10** (`toolkit.json`; build commit `339ef0e`, built 2026-10-16). Its bundled standard library is the OMG SysML v2 Release **2026-05** (`de1070ae`; THIRD-PARTY-NOTICES names the revision), whose documents are *KerML 1.1 Beta 1* and *SysML 2.1 Beta 1*. I compared the bundle with that release's `sysml.library`: 91 of 94 files byte-identical, 3 differ only in line endings, plus 2 toolkit packages (`local-packages/TransformMeta`, `StringPatterns`). So in practice Tessera targets the 2026-05 incremental release, a draft beyond the formally adopted KerML 1.0 / SysML 2.0 that `docs/PLAN.md:140` cites. The toolkit's README states no spec version.
- **Evidence:** `toolkit.json`; `static/toolkit/stdlib/manifest.json`; `static/toolkit/THIRD-PARTY-NOTICES.md`; byte comparison against `git clone --branch 2026-05 SysML-v2-Release` (ran). `docs/PLAN.md:441` (licence row says "2026-05 and later").
- **Limitations:** The app does not show the spec or library release anywhere a user would look (Settings → About names the licence, the notice shows only a commit hash). The pilot used for comparison is 0.62.0 (2026-08) and 0.57.0 (2026-02); no pilot build matches 2026-05 exactly.
- **Status:** Verified
- **Score:** 2 (Tessera: stated in developer docs, not in the product)
- **Next action:** planned capability — show "SysML v2 / KerML Release 2026-05 (2.1/1.1 Beta 1), engine 0.10.10" in Settings → About and the docs.

### Which language constructs are fully supported, partially supported, or unsupported?
- **Answer:** Text: every construct in the corpus parses (309/309) and the editor/engine treat them alike. What Tessera does *beyond* the text is narrower. The matrix below is from `constructs.assessment.test.ts` (one model with each construct; asserted parse, resolve, adapter kind, inspector edit; diagrams/evaluation/simulation recorded as an inline snapshot):

  | Construct | Parsed + resolved | Adapter (explorer, inspector) | Shown in a diagram | Inspector edit (doc, rename) | Evaluated | Simulated |
  | --- | --- | --- | --- | --- | --- | --- |
  | package | yes | `package` | packages | yes | – | – |
  | part def / abstract def | yes | `part` | general, interconnection, packages | yes | – | – |
  | part usage, nested part | yes | `part` | general, interconnection | yes | – | – |
  | specialization `:>` | yes | super type | general (edge) | yes | – | – |
  | inheritance (inherited feature) | yes | – | general, interconnection (row) | – | yes (value through the heir) | – |
  | redefinition `:>>` | yes | `redefinition` | not shown (value row absent) | doc only (no own name) | yes | – |
  | attribute | yes | `attribute` | general (row) | yes | yes (number) | – |
  | enumeration | yes | `enum` | general, packages | yes | – | – |
  | port, `~` conjugate | yes | `port`, conjugated flag | general, interconnection | yes | – | – |
  | interface, connection | yes | `interface`, `connection` | interconnection (edge) | yes | – | – |
  | flow | yes | – (unnamed) | interconnection (edge) | – | – | – |
  | action | yes | `action` | general, packages | yes | – | – |
  | state, transition | yes | `state` | states | yes (state) | – | yes |
  | requirement, satisfy | yes | `requirement`, satisfy link | requirements, trace | yes | satisfy: verdict | – |
  | constraint (`assert`) | yes | `constraint` | general | yes | verdict | – |
  | multiplicity `[4]`, optional `[0..1]` | yes | `multiplicity` | general, interconnection (row) | yes | – | – |
  | metadata `@M` | yes | annotation with values | not drawn on the annotated part | yes (def) | – | – |
  | comment `about`, doc | yes | doc text | not drawn | doc: yes | – | – |
  | import, alias, qualified names | yes | resolved names | not drawn | text only | – | – |

  Over the whole corpus (`data/01-language/summary.txt`, "In a diagram"): definitions are drawn almost always (part/action/port/requirement/calc/state defs 100 %), usages less (part 52 %, attribute 53 %, action 29 %, view 22 %, calc 7 %, analysis 7 %; corpus plus demo); KerML-only metaclasses (Feature, Class, Classifier, Association, Behavior, Step: ~1,000 named elements), use case usages and accept/send actions are never drawn (the runner does not draw the trace view, so satisfy links are not counted there). The simulator covers state machines only (`docs/simulator.md`); evaluation covers attribute values, constraints and satisfy claims.
- **Evidence:** `src/lib/engine/toolkit/constructs.assessment.test.ts:245-367` (ran, 6 tests pass); runner diagram coverage, `docs/assessment/data/01-language/summary.txt` (ran).
- **Limitations:** Diagram coverage over the corpus is approximate (an element counts as shown if a node/edge points at its declaration or its owner's node lists its name). Only the views Tessera offers were tried (general, requirements, packages, and states/actions/interconnection per subject, up to 40 per project).
- **Status:** Verified
- **Score:** 2 (Tessera; the matrix is one fixture plus corpus-wide counts)
- **Next action:** planned capability — publish the matrix as a user-facing "what Tessera shows and edits" page; additional testing for KerML-only and behavioural usages.

### Can Tessera parse and semantically resolve representative official conformance test suites?
- **Answer:** Yes for parsing (all 309 corpus files, all 428 pilot Xpect models load); resolution 99.43–99.79 % on the SysML suites and 97.45 % on KerML examples. Against the pilot, which reports 0 errors on the same corpus, the toolkit rejects 2 SysML files and 13 KerML files and leaves 24 names unresolved in the SysML suites. Against the pilot's declared `linkedName` expectations it agrees on 191 of 194.
- **Evidence:** `tests/conformance/run.conformance.ts` + `corpus.ts` (`npm run assess:conformance`, ran, 25 s); `tests/conformance/compare-pilot.mjs` with pilot 0.62.0 and 0.57.0 JSON (ran; identical verdicts for both releases); `docs/assessment/data/01-language/pilot-comparison-0.62.0.txt`. The earlier figures in `docs/PLAN.md:118-121` (99.96 %, 440/462) are not reproducible from the repository: their scripts survive only on the assessment machine (`/home/user/eval-toolkit/harness/tk_corpus.py`, the toolkit's native CLI over the 2026-02 corpus; `results/tk_opensysmlcheck.json`, an earlier 462-file OpenSysML negative set); I did not find how 99.96 % was computed. This runner supersedes them.
- **Limitations:** No official pass/fail suite exists; "valid" is inferred from the corpus' purpose and the pilot's 0 errors. Xpect `scope` (236) and `warnings` (75) assertions are not adjudicated. The pilot comparison is at file level (errors or not; shared lines are in the JSON), not finding by finding.
- **Status:** Verified
- **Score:** 3 (engine) — reproducible runner and an automated comparison with the reference implementation; capped at 3 because the comparison shows real disagreements.
- **Next action:** additional testing — run the runner and the pilot comparison in CI (the conformance dashboard `docs/PLAN.md:284` plans) and file the false rejections upstream.

### Does it correctly handle packages, imports, namespaces, definitions, usages, specialization, inheritance, and redefinition?
- **Answer:** Mostly. The pilot's name-resolution oracle agrees on 191/194 references (imports, visibility, aliases, inherited and redefined members). But: (1) inside `satisfy R by x`, the toolkit resolves `x` outward past the satisfy usage's own (redefined) subject parameter, unlike KerML 8.2.3.5 and the pilot — this changes the meaning of 6 satisfy claims in the demo (C1); (2) false "ambiguous reference" errors on the Annex A vehicle model and `13a-Model Containment` (pilot: none); (3) "circular specialization" is reported as an error although KerML 7.3.2.3 allows cycles; (4) `import X::*` without visibility is rejected, correctly (KerML grammar `Import = visibility = VisibilityIndicator …`, both tools agree).
- **Evidence:** runner Xpect section (ran); `semantics.assessment.test.ts:82-140` (4 `it.fails`, ran); pilot comparison (ran); minimal repro `A.sysml` under C1.
- **Limitations:** Resolution of 3 `linkedName` cases (`Classes.kerml.xt`, `GlobalQualificationCrossFile.kerml.xt`, `ShadowingTests_CircleProblem4_Rdef.kerml.xt`) not triaged.
- **Status:** Verified
- **Score:** 2 (engine) — broadly right, with a semantic deviation that changes results (C1).
- **Next action:** bug fix — upstream (satisfy subject scope, ambiguity, circularity); in Tessera, qualify the demo's satisfy targets.

### Does it support attributes, parts, ports, interfaces, connections, flows, actions, states, transitions, requirements, and constraints?
- **Answer:** As text, all of them, resolved without findings (construct model) and across the corpus. In the app: all appear in the explorer/inspector with the right kind except unnamed ones (flows); interfaces, connections and flows are drawn in interconnection views; actions and states in their views; requirements in requirements/trace views; constraints and satisfy claims are evaluated; state machines are simulated. Kind mapping over the corpus is consistent (e.g. `IfActionUsage` → action, `AssertConstraintUsage` → constraint), with two cosmetic inconsistencies: `UseCaseDefinition` → `use_case` vs `UseCaseUsage` → `use case`, and generic `Definition`/`Usage` → `element` (`results.json` → `tessera.adapter.kinds`).
- **Evidence:** `constructs.assessment.test.ts` (ran); runner adapter kinds (ran).
- **Limitations:** see the matrix; `accept`/`send` actions, use cases and calc usages are rarely or never drawn.
- **Status:** Verified
- **Score:** 2 (Tessera), 3 (engine: corpus-wide)
- **Next action:** additional testing — per-construct diagram tests for behaviour usages.

### Can it handle nested structures, multiplicities, optional features, metadata, annotations, and qualified names?
- **Answer:** Yes in text, resolution and the adapter (multiplicity is read from the declaration text, `model.ts:14-18`). Nested parts, `[4]` and `[0..1]` show in general and interconnection views; metadata values are read into the model (and tables/FMEA use them) but a `@M` on a part is not drawn on it; `comment about` and docs are not drawn. Qualified, quoted and short names (`'Odd Name'`, `<'X-1'>`) resolve and survive edits.
- **Evidence:** `constructs.assessment.test.ts:278-294` (ran); `preservation.assessment.test.ts` (ran).
- **Limitations:** 209 named elements in the corpus have no text extent (97 toolkit-made conjugated port definitions, 78 reference usages, 24 port usages, 6 flow payloads, …); the app does not list or draw them.
- **Status:** Verified
- **Score:** 2 (Tessera)
- **Next action:** None (track metadata on diagrams as a roadmap item).

### Does it preserve valid constructs that the graphical interface cannot display or edit?
- **Answer:** Yes, in every case tested. On a file of constructs no diagram or form shows (notes `//* */`, `comment … locale`, quoted and short names, `#Tag` prefix metadata, `individual`, `timeslice`/`snapshot`, `variation`/`variant`, `derived`/`constant`, `calc` + `->collect`, `succession flow`, `rep … language`, `dependency`, `filter`, `alias`, `~` ports, tabs, emoji/umlauts), each app edit — value, multiplicity, type after prefix metadata, doc, insert member next to a `rep`, remove, rename across alias/`about`/dependency, and a guided-form write with an import — changes only the edited declaration's lines; 18 untouched snippets survive byte for byte; the result has no problems. A rename is exactly reversible by text substitution, and removing the form's two lines gives the original file back.
- **Evidence:** `src/lib/engine/toolkit/preservation.assessment.test.ts:127-255` (ran, 9 tests pass); `constructs.assessment.test.ts:314` (every named construct: doc and rename edits stay inside the declaration, ran); existing `edits.test.ts` (20 tests, ran), `header.test.ts` (13) and `src/lib/diagram/textpatch.test.ts` (8) (not run by me).
- **Limitations:** One hand-written fixture (corpus files are EPL and not vendored); edits on the corpus files themselves are not automated yet. Diagram-gesture edits (drag, connect) are covered by §2's tests, not here.
- **Status:** Verified
- **Score:** 3 (Tessera)
- **Next action:** additional testing — run the same edit set over every corpus project in the runner.

### Are limitations documented explicitly rather than silently ignored?
- **Answer:** Partly. `docs/engine.md:678-892` documents toolkit defects with minimal repros and how the app mends them; `docs/simulator.md` lists what the simulator doesn't support; filter terms the app can't read are "reported and ignored" (`docs/engine.md`). There is no user-facing statement of which constructs are drawn, edited, evaluated or simulated, which spec release is targeted, or that unresolved names are only warnings. KerML-only models load but are not drawn, without a note.
- **Evidence:** docs read; `grep` of README/user guide (ran).
- **Status:** Verified
- **Score:** 1 (Tessera)
- **Next action:** planned capability — a "language coverage" page generated from the construct matrix and the runner summary.

## 1.2 Semantic correctness

### Are type checking, feature conformance, inheritance, redefinition, and reference resolution correct?
- **Answer:** Largely, with measured exceptions. Correctly diagnosed: wrong usage typing, class specializing a data type, redefining a non-inherited feature, overriding a bound value, multiplicity outside the redefined one, a value of the wrong type, duplicate names. Departures found: satisfy subject scope (C1), the requirement-subject position rule not checked (`validateRequirementUsageSubjectParameterPosition`, SysML 8.3.21: the demo's 6 stakeholder needs), circularity reported as an error, false ambiguity on 2 corpus files, 13 KerML files falsely rejected, 98 of the pilot's declared errors not reported at all (e.g. "A state may have at most one entry action", "Only one objective is allowed").
- **Evidence:** `semantics.assessment.test.ts` (ran: 8 pass, 4 expected failures); runner + pilot comparison (ran).
- **Status:** Verified
- **Score:** 2 (engine)
- **Next action:** bug fix (upstream, with the repros in `semantics.assessment.test.ts`).

### Does Tessera distinguish syntactically valid text from a semantically valid model?
- **Answer:** Yes in structure: syntax errors are their own list (`model.syntax_errors`), model findings carry their stage (`code`: referential/semantic/context) and severity. But the toolkit makes unresolved names and type-conformance doubts *warnings*, so a model whose references dangle shows "0 errors" — KerML 8.2.3.5.1 calls a failed resolution an error, and the pilot reports one.
- **Evidence:** `src/lib/engine/toolkit/diagnostics.ts:76-84,110`; `semantics.assessment.test.ts:86` (`it.fails`, ran); the e2e problems count (ran).
- **Status:** Verified
- **Score:** 2 (Tessera)
- **Next action:** bug fix — show unresolved references as errors (a severity mapping in `diagnostics.ts`), or say plainly in the problems panel that the model has unresolved names.

### Are unresolved references, incompatible types, invalid relationships, and illegal redefinitions diagnosed accurately?
- **Answer:** Mostly: 315/334 negative-corpus models rejected with an error (pilot: 323), 320 flagged; the 19 not rejected include `ref`/`constant` on definitions (grammar), qualified-redefinition scoping (s95–s98), a usage subsetting a constant one, and an annotation annotating itself. The toolkit also rejects 9 files the pilot accepts (all as the fixtures intend). Pilot Xpect error items: 417/515 get a problem at the expected place.
- **Evidence:** runner negative and Xpect sections (ran); `semantics.assessment.test.ts:29-80` (ran).
- **Status:** Verified
- **Score:** 2 (engine)
- **Next action:** bug fix upstream for the listed misses.

### Are diagnostics associated with correct source locations and actionable explanations?
- **Answer:** Locations: yes — on the whole corpus all 355 engine findings appear in Tessera on their line over exactly the engine's text range (the corpus has 10 files with non-ASCII text; multi-byte positions are also pinned by `host.test.ts:229,288,300`). Explanations: the engine's wording, often with the spec rule name (`[validateFeatureValueOverriding]`); quick fixes come from the toolkit's language server where it has one (e.g. a missing import). Some messages show a raw element id ("Cannot override the non-default value of `@a908ac9b-…`", training lesson 29 checked alone). No plain-language explanation field is filled (`Diagnostic.explanation` is unused for model findings).
- **Evidence:** runner Tessera section (ran); `host.test.ts:44,229,288,300` (ran); `diagnostics.ts:76-84` (the diagnostic is built without an explanation).
- **Status:** Verified
- **Score:** 3 for locations, 2 for explanations (Tessera)
- **Next action:** bug fix — replace `@<id>` in messages with the element's name; add explanations for the most frequent rules.

### Can the editor handle temporarily invalid or incomplete models while users type?
- **Answer:** Yes, with two gaps. Typing a 3-line declaration into the demo key by key (111 analyses): nothing throws, the other 21 files keep every element and show no problems, at most 3 problems at any time, and the finished text is clean. A file cut off at 40 points always analyses and reports a syntax error inside the text. In the browser (e2e), typing an unfinished `part def` counts an error, keeps the model tree, and the count returns to the demo's own when finished. Gaps: while a brace is open, the repair cuts out the whole enclosing `part drone { … }` — up to 28 elements of that file leave the explorer and diagrams until the text parses (text untouched) — and a spurious model error ("connector end references `commandLink` … no featuring context") appears on an untouched line (about half the keystrokes); only unresolved-name follow-ons are hidden (`diagnostics.ts:74`).
- **Evidence:** `src/lib/engine/toolkit/typing.assessment.test.ts` (ran: 2 pass, 2 `it.fails` known gaps); `tests/e2e/assessment-language.spec.ts` (ran on port 4327, passes); existing `host.test.ts:239-300` "broken text" (ran).
- **Status:** Verified
- **Score:** 2 (Tessera)
- **Next action:** bug fix — hide follow-on semantic findings in a file being repaired; ask upstream for a finer-grained `lenientSources` repair.

### Are semantic results consistent across sessions, reloads, and supported environments?
- **Answer:** In Node, yes: the demo's analysis (problems, elements, kinds, ids, links) is identical after analysing another project, after an edit and its undo (the incremental rebuild path), and in a second host; element ids don't depend on file order. Two runner runs gave identical numbers. The browser runs the same WebAssembly module; `engine.spec.ts` checks the demo's problem count there.
- **Evidence:** `src/lib/engine/toolkit/consistency.assessment.test.ts` (ran, 2 pass); runner reruns (ran); `tests/e2e/engine.spec.ts:29` (not run by me).
- **Limitations:** Not compared: library loaded from the prepared snapshot (browser return visits) vs from sources (Node); Safari/Firefox (e2e is Chromium only).
- **Status:** Partially verified
- **Score:** 2 (Tessera)
- **Next action:** additional testing — compare a snapshot-loaded and a source-loaded analysis of the demo.

### Are conformance results measured separately for parsing, resolution, validation, and editing?
- **Answer:** Now yes. The runner reports parse, resolution (rate per suite, per folder, per file) and validation findings (by stage and severity) separately for the engine, and Tessera's diagnostics, adapter and diagrams separately from the engine; editing is measured by `preservation`/`constructs` tests. Before this assessment none of it was reproducible (the PLAN's figures had no kept script in the repo).
- **Evidence:** `tests/conformance/` (ran); `docs/assessment/data/01-language/`.
- **Limitations:** Editing over the corpus files is not in the runner yet; no CI job.
- **Status:** Verified
- **Score:** 3 (Tessera + engine)
- **Next action:** additional testing — CI job and a published dashboard.

## Prioritized question 2: How much of SysML v2 and KerML is actually supported, and how is that measured?

- **Answer:** Parsing: everything in the OMG corpus and the pilot's test models. Resolution: 99.4–99.8 % of written references in the SysML suites, 97.5 % in KerML; 191/194 of the pilot's declared resolutions. Validation: 0 false errors on 249 of 251 valid SysML corpus files, 13 of 58 KerML files falsely rejected, 94 % of known-invalid models rejected (pilot 97 %). Beyond text, Tessera draws definitions and structure well, behaviour and KerML-only constructs partly or not at all, evaluates values/constraints/satisfy claims and simulates state machines (matrix above). Measured by `npm run assess:conformance` (corpora pinned by `scripts/fetch-conformance.sh`), compared with the OMG pilot by `compare-pilot.mjs`, and by the `*.assessment.test.ts` files.
- **Evidence:** all of the above (ran).
- **Status:** Verified
- **Score:** 3 (measurement is reproducible and compared with the reference implementation; capped at 3 by the disagreements)
- **Next action:** additional testing — CI + dashboard; bug fixes upstream.

## Section scores

| Sub-area | Engine | Tessera | Note |
| --- | --- | --- | --- |
| 1.1 Spec versions targeted | — | 2 | 2026-05 release; not shown in the app |
| 1.1 Construct coverage (matrix) | 3 | 2 | matrix from evidence; behaviour/KerML drawing gaps |
| 1.1 Official suites parse/resolve | 3 | 3 | runner + pilot comparison |
| 1.1 Namespaces, imports, specialization, redefinition | 2 | — | C1 |
| 1.1 Structure/behaviour/requirements constructs | 3 | 2 | |
| 1.1 Nesting, multiplicity, metadata, names | 3 | 2 | metadata not drawn |
| 1.1 Preserving undrawable constructs | — | 3 | |
| 1.1 Limitations documented | — | 1 | |
| 1.2 Semantic correctness | 2 | — | C1, subject rule, circularity, KerML false errors |
| 1.2 Syntactic vs semantic validity | — | 2 | unresolved = warning |
| 1.2 Diagnosis of invalid models | 2 | — | 94 % negatives |
| 1.2 Locations / explanations | — | 3 / 2 | |
| 1.2 Incomplete text while typing | — | 2 | two known gaps |
| 1.2 Consistency | — | 2 | Node only |
| 1.2 Measured separately | 3 | 3 | new runner |

## Critical findings

**C1 — `satisfy … by x` resolves `x` differently from the specification and the reference implementation; the demo's traceability results depend on it.** Engine (name resolution), surfaced by Tessera as satisfied requirements and trace links. KerML 8.2.3.5.2: a name in a `FeatureReferenceExpression` is resolved from the nearest non-invocation namespace, here the satisfy usage's subject parameter; 8.2.3.5.4: full resolution then tries the satisfy usage, whose subject parameter redefines the requirement's subject and takes its name (KerML 8.3.3.3 `effectiveName`); SysML 8.4.17.3 spells `by f` as `subject subj redefines R::subj = f`. So when the requirement's subject is called `drone`, `by drone` names the subject itself and `drone.flightController` doesn't resolve. The pilot (0.57.0 and 0.62.0) reports exactly that on the demo (`system/Satisfaction.sysml:15-20`, 6 errors); Tessera shows 0 problems and draws/evaluates the claims against the design's `drone`. The pilot is right by the letter of the spec. Repro (toolkit: no findings, satisfying feature `A::Design::drone::fc`; pilot: `Couldn't resolve reference to Feature 'fc'`):

```sysml
package A {
    part def D;
    requirement def R { subject drone : D; }
    requirement r : R;
    package Design { part drone : D { part fc; } }
    package Claims {
        private import Design::drone;
        satisfy r by drone.fc;
        satisfy r by drone;
    }
}
```

Pinned by `semantics.assessment.test.ts:113` (`it.fails`). Fix in Tessera's content: write `by DroneArchitecture::drone.flightController` (resolves in the pilot) or rename the subject; upstream: resolve from the subject parameter outward. Not fixed here (demo content is shared with other areas; the engine is upstream).

No other finding in this section is critical. Related, not critical: the demo's 6 stakeholder needs break `validateRequirementUsageSubjectParameterPosition` (pilot: error; Tessera: nothing) — repro `package C { part def Op; requirement r { stakeholder s : Op; } }`, pinned at `semantics.assessment.test.ts:135`.

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Fix the demo: qualify satisfy targets (`DroneArchitecture::drone…`), declare `subject` before `stakeholder` in the stakeholder needs | High (flagship model valid in the reference tool) | High | S |
| File upstream: satisfy subject scope, subject-position rule, circular specialization error, false ambiguity (Annex A, 13a), KerML association-end/cross-subsetting/package-level-redefinition false errors, the 98 missing declared errors (repros in `semantics.assessment.test.ts`, `results.json`) | High | High | S (to file) |
| CI job: `assess:conformance` + pilot comparison, published as the conformance dashboard PLAN §6 promises | High | Medium | M |
| Show unresolved references as errors (or a "model has unresolved names" banner) | Medium | High | S |
| Hide follow-on model findings in a file under repair; finer repair so the enclosing element stays in the model while typing | Medium | High | M (partly upstream) |
| User-facing "language coverage" page (construct matrix, spec release, what is drawn/edited/evaluated/simulated) and the release in Settings → About | Medium | Medium | S |
| Diagnostics: names instead of `@<uuid>`, plain-language explanations for frequent rules | Medium | Medium | S–M |
| Lint: warn when a `satisfy … by` name equals the requirement's subject name | Medium | Medium | S |
| Draw metadata annotations on their elements; behaviour usages (accept/send, use cases) in diagrams | Low–Medium | Medium | M |
| Edit-preservation sweep over every corpus project in the runner | Medium | Low | S |
| Compare snapshot-loaded vs source-loaded library analyses | Low | Low | S |
