# 02 — Text editing, diagrams and round-trip fidelity

> Written before the fixes that followed it: what became of each critical finding is in [the assessment summary](README.md#critical-findings-and-what-became-of-them).

Section §2 of the checklist, and prioritized questions 1 (edit and save/reload legs; external
exchange is in `03-interchange.md`) and 4.

**How this was assessed.** Every edit the app makes was driven through the code path the UI
uses (`Workspace` on the real engine, `#lib/workbench/actions.ts`, the diagram and form
planners), on a fixture written to be hostile — comments in every position, odd spacing,
compact one-line bodies, tabs, unicode, metadata (`@Review`, `#Review`), short names, a
named `comment about`, `alias`, `variation`/`variant`, `individual`, `dependency`,
`rep … language`, a cross-file redefinition — plus the demo. For each edit, the test checks
that every marked comment is kept as written, that files the edit is not about are
byte-identical, that the semantic diff (`#lib/review/semantic.ts`) names only the elements
the edit is about, that no new problems appear (unless expected), and that one undo
restores every byte; the changed lines and the semantic diff are pinned in a snapshot,
which was reviewed line by line.

New evidence (all run in this session; known gaps are `it.fails`/`test.fail` and flip when
fixed — `ASSESS_SHOW_GAPS=1` runs them as plain tests to show why they fail):

| File | What |
| --- | --- |
| `src/lib/project/round-trip.assessment.test.ts` (+ `__snapshots__/…snap`, `fixtures/round-trip/`) | 55 edit kinds table-driven; formatter; file operations; CRLF files; 5 text↔diagram cycles; 10-step undo; undo gaps; text→views propagation; quick fix |
| `src/lib/project/save-fidelity.assessment.test.ts` | bytes through the folder read/write path |
| `src/lib/diagram/export/export.assessment.test.ts` | SVG export of 12 demo diagrams, a one-node one and a ~500-node one |
| `tests/unit/edit-latency.assessment.test.ts` | edit latency on a 10.5k-line project |
| `tests/e2e/assessment-round-trip.spec.ts` | browser: edit → reload → save to folder bytes; drag writes only the layout; CRLF opened in the editor |

Existing tests run alongside in this session (13 files, 171 passed): `toolkit/edits.test.ts`,
`workspace-undo.test.ts`, `workspace-units.test.ts`, `behaviorEdits.test.ts`,
`relationships.test.ts`, `viewEdits.test.ts`, `duplicate.test.ts`, `textpatch.test.ts`,
`positions.test.ts`, `export/svg.test.ts`, `export/sequence.test.ts`, `session-folder.test.ts`,
`review/semantic.test.ts`; and `tests/unit/large-model.test.ts` (12 passed).

Commands (from the worktree root):

```
npx vitest run src/lib/project/round-trip.assessment.test.ts src/lib/project/save-fidelity.assessment.test.ts src/lib/diagram/export/export.assessment.test.ts tests/unit/edit-latency.assessment.test.ts
PW_PORT=4321 npx playwright test tests/e2e/assessment-round-trip.spec.ts
ASSESS_SHOW_GAPS=1 npx vitest run src/lib/project/round-trip.assessment.test.ts src/lib/project/save-fidelity.assessment.test.ts   # see each gap fail
```

## §2 Text editing, diagrams and round-trip fidelity

### Can every supported diagram edit be translated into a targeted source change?
- **Answer:** Yes for every diagram gesture tried. Structure (compose, specialize, satisfy,
  verify, allocate, connect, delete a connection or satisfy line), behaviour (add state, draw
  / change / delete a transition, entry action, set start, delete a state with its lines,
  add a step, step to done), and view edits (expose, view-as) each produce a change confined
  to the statement involved; unchanged lines are byte-identical (pinned line diffs). Members
  and declarations go through the engine's span-preserving edits (`toolkit/edits.ts`); what
  the engine has no operation for is a text patch checked for new syntax errors
  (`textpatch.ts`, `behaviorEdits.ts`, `viewEdits.ts`), refused if the file changed meanwhile
  (`actions.ts:300` `applySteps`).
- **Evidence:** `round-trip.assessment.test.ts:488-656` (diagram cases), snapshot
  `src/lib/project/__snapshots__/round-trip.assessment.test.ts.snap`; existing
  `relationships.test.ts`, `behaviorEdits.test.ts`, `viewEdits.test.ts`, `textpatch.test.ts`.
  Run by me in this session.
- **Limitations:** Cosmetic only: adding a port to a one-line body moves its `}` to a new
  line at column 0; a doc added to a compact body is written `{ doc /* … */attribute` (no
  space); an entry action in a tab-indented file is indented with tabs plus four spaces. The
  diagram-move (layout) and "remove from diagram" never touch SysML (below).
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** None (cosmetic indentation: roadmap)

### Does editing text update all affected diagrams, tables, and inspector views correctly?
- **Answer:** Yes: every view is derived from the one analysis of the current text. A typed
  value change, a new definition and a rename (replacing every occurrence by hand) appear in
  the element tree and inspector values, in a general-view diagram's node, in the mass-budget
  table, and in the requirement check's margin after the next analysis.
- **Evidence:** `round-trip.assessment.test.ts:895` ("a text edit reaches every view of the
  model", on the demo). Run by me. Existing e2e `edits.spec.ts`, `diagrams.spec.ts` (not run
  by me).
- **Limitations:** Views update after the analysis delay (debounced); on large models that is
  seconds (see responsiveness). Not checked in the browser by me.
- **Status:** Verified (Node, real engine)
- **Score:** 2 (Fairtide)
- **Next action:** additional testing (browser e2e of a typed change reaching an open diagram and table)

### Does Fairtide preserve comments, formatting, annotations, and unsupported constructs during edits?
- **Answer:** Yes for model edits: across 55 edit kinds on the hostile fixture, every marked
  comment (line, block, trailing, inside bodies, before/after the package, in `rep`, `doc`)
  is kept as written unless it sits on the statement being removed or is the doc being
  replaced; spacing like `part def  Engine  :>  Base   {` is kept around the change;
  metadata, alias, variation, `individual`, `dependency`, `comment about` and `rep` survive
  and are renamed through where they refer. Two exceptions, neither semantic: **the
  formatter** (Shift-Alt-F) re-lays out everything by design (it keeps comments, but moves a
  header's trailing comment into the body and rewrites `dependency from A to B` as
  `dependency A to B`, `accept Go` as `accept : Go`, `default 6000.0` as `default = 6000.0` —
  equivalent forms); and **Windows line endings** (next items).
- **Evidence:** `round-trip.assessment.test.ts:189` (`check`), `:664` (table), `:670`
  (formatter, snapshot pins its output and checks idempotence and no problems). Run by me.
- **Limitations:** Engine edits add new lines with LF into CRLF files (mixed endings,
  `round-trip.assessment.test.ts:767`, known gap); opening a CRLF file in the text editor
  rewrites it to LF and marks it unsaved (`assessment-round-trip.spec.ts:132`, known gap).
  `layout/diagrams.json` is re-serialized by the app, dropping unknown keys (by design,
  `positions.ts:49`).
- **Status:** Verified (with the two line-ending gaps)
- **Score:** 3 (Fairtide)
- **Next action:** bug fix (line endings)

### Can users repeatedly move between text and diagrams without semantic drift?
- **Answer:** Yes. Five cycles of: a line typed in the text, a part drawn on a diagram, a
  multiplicity and a value set and reset in the inspector, a cross-file rename there and
  back, and both new parts deleted (one from the explorer, one from the diagram) leave every
  file byte-identical to the start, and the semantic diff empty, after every cycle.
- **Evidence:** `round-trip.assessment.test.ts:774`. Run by me.
- **Limitations:** Byte identity holds because deletes take their whole line; a part added
  and deleted inside a one-line body was not cycled.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** None

### Do diagram edits preserve model elements and relationships that were not intentionally changed?
- **Answer:** Yes. For every diagram and inspector edit the semantic diff names only the
  target (and, for a delete with references, the element whose type no longer resolves,
  which the toast and Problems say). Renames change every reference (types, `:>>`
  redefinitions in other files, `alias … for`, `comment about`, `dependency`, `satisfy`,
  `verify`) and nothing in comment prose (`KEEP-10 … about Engine` stays).
- **Evidence:** the `touches` assertion in `round-trip.assessment.test.ts:189-240`; rename
  snapshots. Run by me.
- **Limitations:** The semantic diff is itself the oracle, and it has blind spots (it does
  not see `default` vs `=`, `derived`, or `expose`; see review findings) — those three cases
  were checked by the pinned line diff instead. **Removing a specialization can silently
  change what an untouched line means**: after `Engine :> Base` loses `:> Base` (inspector,
  or deleting the specialization line on a diagram), Engine's `attribute :>> mass = 120 [kg]`
  no longer redefines `Base::mass` but the library's `ISQ::mass` (imported by the package);
  no problem is reported and the toast does not warn. Reproduced on the demo by deleting the
  Camera → Component line in the component catalogue (`:>> powerDraw` is reported, `:>> mass`
  is not). See critical findings.
- **Status:** Partially verified (one unreported rebinding)
- **Score:** 2 (Fairtide); the missing diagnostic is the engine's
- **Next action:** bug fix (refuse or warn when a header edit changes what a member's redefinition resolves to; report a redefinition of a non-inherited feature)

### Are unsupported diagram constructs preserved rather than deleted or silently rewritten?
- **Answer:** Yes. Constructs no editor shows (`alias`, `comment about`, unattached
  comments, `dependency`, `variation`/`variant`, `individual`, `rep … language`, prefix
  metadata `#Review`, `ordered nonunique`) are never touched unless an edit is about them;
  deleting a definition that contains a `rep` removes it with its owner, as intended.
- **Evidence:** fixture `src/lib/project/fixtures/round-trip/Hostile.sysml`; every case in
  `round-trip.assessment.test.ts:293-657` asserts those lines' markers. Run by me.
- **Limitations:** The formatter rewrites some of them into equivalent forms (above).
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** None

### Can users create, modify, and delete elements through both text and graphical workflows?
- **Answer:** Yes: text (the editor), explorer/inspector (add, rename, delete, duplicate,
  every declaration property), table cells (name, id, doc, feature, metadata field),
  diagrams (draw relations, states, transitions, steps; delete lines and nodes), guided forms
  (limit/requirement form tested here; view, roll-up, trade, FMEA, hazard forms in
  `create/*.test.ts`), quick fixes, and file operations.
- **Evidence:** the 55 cases above; `round-trip.assessment.test.ts:940` (quick fix), `:701`
  (file ops). Run by me.
- **Limitations:** Guided forms other than the limit form were not run against the hostile
  fixture; `setTableColumns` and `setViewMetadata` were not (the demo covers them in
  `edits.test.ts`).
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** additional testing (remaining forms on the hostile fixture)

### Are undo and redo reliable across edits involving multiple model elements?
- **Answer:** Undo is reliable for model edits taken one after another: ten edits across two
  files (cross-file renames, a delete with references, duplicate, metadata cell, a state
  added, a value that imported `SI::*`, a state and its transition deleted) undone ten times
  restore every byte and an empty semantic diff. Each edit is one step even when it spans
  files. **But:** model undo restores the whole file as it was before the edit, so text
  typed in that file after the edit is discarded with it; and a toast's Undo undoes the
  latest edit, not the one the toast names, when two toasts show. There is no model-level
  redo; Redo (Ctrl Shift Z) is the text editor's history, which holds engine edits applied
  while the file is open.
- **Evidence:** `round-trip.assessment.test.ts:825` (passes), `:864` and `:876` (known gaps,
  shown failing for the stated reason with `ASSESS_SHOW_GAPS=1`); `workspace.svelte.ts:641`
  (`undo`). Existing `workspace-undo.test.ts`. Run by me.
- **Limitations:** Workspace undo is reachable only from the toast (6 s, 12 s with a warning).
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (undo by inverse change rather than whole-file restore; toast undoes its own entry)

### Are diagram layouts stored independently from semantic model content where appropriate?
- **Answer:** Yes. Positions, hidden and added nodes go only to `layout/diagrams.json`
  (`positions.ts:13`); dragging a box in the browser leaves every `.sysml` file
  byte-identical in browser storage and in the saved folder, and adds only the layout file.
  Saved views keep what they show in SysML (`expose`), which is model content by design.
- **Evidence:** `assessment-round-trip.spec.ts:149` (passes); `positions.test.ts`. Run by me.
- **Limitations:** Moving a box is not a model undo step; the layout file's unknown content
  is dropped when it is rewritten.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** None

### Can diagrams be exported without missing labels, relationships, or visual elements?
- **Answer:** Yes for what the canvas shows. For 12 demo diagrams (general, interconnection,
  requirements, states, actions, packages, trace) laid out as the canvas does, the SVG holds
  every node name and every routed edge's label (whole, or cut with an ellipsis to the box
  exactly as the canvas cuts it) and at least one path per routed edge, all inside the frame.
- **Evidence:** `export.assessment.test.ts:98`; existing `svg.test.ts`, `sequence.test.ts`,
  e2e `export.spec.ts` (SVG, PNG, clipboard on the demo; not run by me). Run by me.
- **Limitations:** By design the export is what the canvas draws: long names are cut with
  "…", compartments show 6 rows then "+n more", decisions/forks/joins carry no name (a
  tooltip on the canvas), and edges ELK cannot route between drawn nodes are absent.
- **Status:** Verified (SVG); PNG/clipboard rely on the existing e2e
- **Score:** 2 (Fairtide)
- **Next action:** None

### Are SVG, PNG, clipboard, and other supported exports correct at different diagram sizes?
- **Answer:** SVG: correct from one node to ~500 nodes (a general view of a 10.5k-line
  project, capped at `MAX_NODES`): every name and label present. PNG is 2× unless the image
  would exceed 16 Mpx, then scaled down to fit (`pngScale`), so very large diagrams lose
  resolution, not content.
- **Evidence:** `export.assessment.test.ts:112` (one node, scale 2), `:122` (large). Run by me.
- **Limitations:** PNG pixels and clipboard were not checked at large sizes in a browser.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing (browser PNG at large size)

### Does the application remain responsive when editing large models?
- **Answer:** Edits are applied in well under a second on a 10.5k-line project; the model is
  re-analysed within ~2–3 s. Measured (Node, real engine, 3 runs each; see table below).
- **Evidence:** `tests/unit/edit-latency.assessment.test.ts`; `tests/unit/large-model.test.ts`
  (12 passed). Run by me; numbers in the table at the end.
- **Limitations:** Node, not a browser; one worker; re-analysis cost grows with the whole
  project, not the edit (docs/engine.md item 12), so larger models wait longer.
- **Status:** Verified (10k lines)
- **Score:** 2 (Fairtide)
- **Next action:** additional testing (browser, 30k+ lines — owned by the performance section)

## Prioritized questions

### 1. Can Fairtide preserve the semantics of a complex model through text edits, diagram edits, save/reload, and export/import?
- **Answer:** Text edits, diagram/inspector/form edits, undo and save/reload: yes, with
  text outside the intended change byte-identical in every case tried and unedited files
  byte-identical through save and reload — with one exception in meaning: removing a
  specialization can silently rebind a redefinition to an imported library feature
  (critical finding 1). Line endings and byte-order marks are not always preserved (no semantic
  effect). Export/import: see `03-interchange.md`.
- **Evidence:** all of the above; `save-fidelity.assessment.test.ts`; `assessment-round-trip.spec.ts:99`.
- **Limitations:** CRLF files, BOM, non-UTF-8 files (below).
- **Status:** Partially verified (edit and save/reload legs)
- **Score:** 2 (Fairtide) — 3 for text fidelity, held at 2 by the unreported rebinding
- **Next action:** bug fix (rebinding check; line endings, encoding checks)

### 4. Does the application preserve constructs that its graphical editors cannot represent?
- **Answer:** Yes; see "unsupported diagram constructs" above.
- **Evidence:** fixture and the 55-case table. Run by me.
- **Limitations:** The formatter normalises some of them to equivalent forms.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** None

## Save/reload fidelity details

- Unchanged files: Unix and Windows line endings, a lone CR, tabs, trailing spaces, no final
  newline and emoji/unicode go through the folder read (`File.text()`) and write
  (`writeToFolder`) byte-identical (`save-fidelity.assessment.test.ts:72`).
- In the browser, an edit, a reload and Save to folder change only the edited line; the CRLF
  file not opened is written back byte-identical (`assessment-round-trip.spec.ts:99`).
- Known gaps: a UTF-8 BOM is dropped (`:84`); a non-UTF-8 file is read with U+FFFD in place
  of bytes, without a warning, and written so once edited (`:91`; `.kpar` import, by
  contrast, refuses non-UTF-8 — `interchange/kpar.ts:205`).

## Measured edit latency (10,546 lines, Node 22, real engine)

Opening the project (analysis and checks): 2.4 s. Each edit run 3 times, undone in between;
median (range), ms. "Applied" is until the text has changed; "settled" adds the workspace's
re-analysis, including its typing delay (1 s on a project whose analysis takes over 2 s,
`workspace.svelte.ts:87`).

| Edit | Files changed | Applied | Settled |
| --- | --- | --- | --- |
| Add a part (inspector) | 1 | 359 (359–466) | 1776 (1769–1963) |
| Rename a definition used in 2 files | 2 | 361 (361–379) | 1843 (1803–1909) |
| Delete a part | 1 | 7 (7–9) | 1768 (1752–1770) |
| Duplicate a definition (waits for the analysis itself) | 1 | 1839 (1786–1851) | 1839 (1786–1851) |
| Set a value (inspector) | 1 | 539 (527–565) | 1958 (1946–2068) |

`tests/unit/large-model.test.ts` (analysis, keystroke re-analysis, checks, tables, tree on the
same size) also passed within its budgets in this session.

## Section scores

| Sub-area | Score | Note |
| --- | --- | --- |
| Diagram/inspector/form edits → targeted text changes | 3 | 55 kinds, pinned diffs, hostile fixture |
| Preservation of untouched elements/relationships | 2 | one unreported rebinding after removing a specialization |
| Text → views propagation | 2 | Node-level; browser not checked by me |
| Preservation of comments / unsupported constructs | 3 | CRLF gaps cosmetic |
| Repeated round trips | 3 | 5 cycles byte-identical |
| Undo/redo | 2 | Whole-file undo discards later typing; toast undoes latest |
| Layout separate from semantics | 3 | e2e: drag touches only `layout/diagrams.json` |
| Exports | 2 | SVG checked small→large; PNG/clipboard by existing e2e only |
| Responsiveness while editing | 2 | 10k lines measured; larger owned by §10 |
| Save/reload fidelity (edit leg of Q1) | 2 | BOM, CRLF-in-editor, non-UTF-8 gaps |

## Critical findings

1. **Removing a specialization silently rebinds a redefinition to a library feature
   (unreported semantic change).** No edit changed text outside its target, but this one
   changes the meaning of an untouched line without a diagnostic or warning. Repro (the
   fixture, reduced; tests in `round-trip.assessment.test.ts:964-1020`, "a redefinition left
   without its feature", including the demo case):

   ```
   package P { private import ISQ::*;
     abstract part def Base { attribute mass :> ISQ::mass; }
     part def Engine :> Base { attribute :>> mass = 120 [kg]; } }
   ```

   Remove `:> Base` from Engine in the inspector (Specializes, cleared) or delete the
   specialization line on a diagram. Engine's `:>> mass` now resolves to `ISQ::mass` (go to
   definition lands in the library), Problems stays empty, and the toast names only the
   specialization change. On the demo: delete the Camera → Component line in Component
   catalogue — `:>> powerDraw` is reported as a problem, `:>> mass` is not; the mass budget
   is unchanged (Camera's 60 g is still counted) and the power budget drops 3 W. The edit is the
   one asked for; what is missing is the check `toolkit/edits.ts` documents for composed edits
   ("keep every reference resolving to what it did") and the engine's report of a
   redefinition of a feature that is not inherited. Not fixed here: the fix belongs in the
   edit check or the engine, not a minimal patch. Whether this counts as critical is the
   lead's call; it is listed here so it is not averaged away.

No other normal edit silently changed or deleted model content outside its target, across
55 edit kinds on a hostile fixture, five text↔diagram cycles and a ten-step undo.

Data-integrity findings (not semantic; non-critical):

1. **Undo discards text typed after the edit it undoes.** Repro: add a part from the
   inspector (toast with Undo), type a line elsewhere in the same file within 6 s, click
   Undo — the typed line is gone along with the part (`round-trip.assessment.test.ts:864`).
   If the file is open in the editor, Ctrl Z in the editor can bring it back.
2. **A toast's Undo undoes the latest edit, not its own.** Repro: two quick edits in
   different files, click Undo on the first toast — the second edit is undone (the toast
   says which) (`:876`).
3. **Opening a CRLF file rewrites it with LF and marks it unsaved.** Repro: open a folder
   with a CRLF `.sysml` file, click it in Files — "1 unsaved · Save to folder" appears
   without any edit (`assessment-round-trip.spec.ts:132`). Saving rewrites every line.
4. **Engine edits write LF lines into CRLF files** (mixed endings) for adds, duplicates,
   docs, transitions and exposes (`round-trip.assessment.test.ts:767`).
5. **Non-UTF-8 files are accepted silently** with U+FFFD in place of bytes
   (`save-fidelity.assessment.test.ts:91`); a BOM is dropped (`:84`).

Review (semantic diff) inaccuracies found on the way (owned by review; reported here because
they make the review misreport an edit):
- `default` vs `=`, `derived`, and `expose` changes are invisible to the semantic diff
  (cases "change a value to a default", "make a value derived", "add an element to a view").
- A unit in brackets is read as a multiplicity in some positions: `mass=40[kg]` gives
  `multiplicity: kg`; `accept after 5 [s]` gives `multiplicity: - -> s`.
- A reformatted model is reported as changed (dependency matched by its text)
  (`round-trip.assessment.test.ts:696`, known gap).
- A `comment about X` is folded into X's `doc` in the diff.

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Refuse or warn when a declaration edit changes what a member's references/redefinitions resolve to; report redefinitions of non-inherited features | Semantic safety | High | M |
| Undo by inverse change (keep later typing), toast Undo bound to its own entry, model-level redo | Data safety | High | M |
| Keep a file's line-ending style: editor `lineSeparator` from the file, engine/patch inserts in the file's style | Git diffs, Windows users | High | S |
| Detect non-UTF-8 / BOM on folder open: refuse or warn, and keep the BOM on save | Data safety | Medium | S |
| Semantic diff: report value kind, `derived`, `expose`, triggers; don't read `[unit]` as multiplicity | Review accuracy | Medium | M |
| Warn in the toast when a specialization removal leaves redefinitions unresolved | Clarity | Low | S |
| Indent inserted lines in the file's style (tabs), keep a compact body's `}` in place | Cosmetic | Low | S |
| Browser e2e: typed text reaching an open diagram/table; PNG/clipboard at large sizes | Evidence | Medium | S |
| Run the remaining guided forms against the hostile fixture | Evidence | Medium | S |
