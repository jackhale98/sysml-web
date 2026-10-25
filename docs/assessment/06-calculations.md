# §6 Calculations, roll-ups, constraints and trade studies

Assessed on `claude/assess-calculations` (merged with `main` at 68cb9db). Scores are
Fairtide's unless marked "engine". Every test named here was run in this session unless it
says otherwise.

Commands (from the repository root):

```
npx vitest run src/lib/engine/toolkit/evaluation.assessment.test.ts \
  src/lib/engine/toolkit/trade.assessment.test.ts src/lib/sim/expr.assessment.test.ts
npx vitest run src/lib/engine/toolkit/evaluation.test.ts src/lib/engine/toolkit/trade.test.ts \
  src/lib/sim src/lib/engine/toolkit/views src/lib/workbench/views.test.ts \
  src/lib/project/templates/templates.test.ts src/lib/create/create.test.ts \
  src/lib/create/generators.test.ts src/lib/create/riskReview.test.ts \
  src/lib/engine/toolkit/compare.test.ts src/lib/review/semantic.test.ts \
  src/lib/engine/toolkit/host.test.ts
PW_PORT=4323 npx playwright test tests/e2e/assessment-calculations.spec.ts \
  tests/e2e/budgets.spec.ts tests/e2e/trade.spec.ts --workers=2
```

How it works, in one paragraph: values and verdicts come from the engine (`evaluate` and
`verify` of the sysml-toolkit, in `src/lib/engine/toolkit/evaluation.ts`). The app fills
in what the engine leaves undecided or gets wrong for a usage: sums over a fixed-size
collection (`part rotors : Rotor[4]`), expressions a part inherits from its definition, a
trade study's criteria, scores and selection. It does so with its own evaluator
(`src/lib/sim/expr.ts`, also the simulator's). Budgets (`views/budget.ts`) walk the bill of
materials and multiply each part's value by its quantity. Units are converted by
`src/lib/engine/quantity.ts` (tables, inspector) and `src/lib/sim/units.ts` (the app's
evaluator). These are two lists that differ: the pound is in the second only, the grain in
neither. The engine's own units come from the standard library.

## Results of the runs in this session

| Run | Result |
| --- | --- |
| New unit tests (3 files) without the fixes (pristine `main` 68cb9db, in a separate worktree) | 7 fail, 16 pass, 4 expected fail. The 7 are the critical findings below and the workspace test (below). |
| The same with the fixes | RESULT_AFTER |
| Existing related unit suites (20 files, list above) with the fixes | 20 files, 305 tests pass |
| `tests/e2e/assessment-calculations.spec.ts`, `budgets.spec.ts`, `trade.spec.ts` with the fixes | RESULT_E2E |
| `npm run check` | RESULT_CHECK |

The workspace trade test failed on `main` for a reason in the test, not the app: it first
used a `setDeclaration` edit that matched nothing. It now applies a text change as one
undoable step, as the app's forms do. The other six failures before the fix were for the
stated reasons: 200 g instead of 300 g (inherited expression), 60 g instead of 40 g
(subsets), "the sum of its parts" with no word of the variable parts, ranks `[1, 3, 2]`
instead of `[3, 2, 1]` (units ignored), a grain mass ranked as 7000, and
`1 [furlong] + 1 [m]` = `2 [furlong]`.

## Fixes made in this assessment (critical defects)

Each was a misleading result shown as correct. Each has a test that fails on `main` and
passes with the fix (both runs above).

1. **Budgets used a definition's values for an expression a part inherits.** With
   `part def Battery { attribute cells default 4; attribute cellMass default 50 [g];
   attribute mass = cells * cellMass; }` and `part battery : Battery { :>> cells = 6; }`,
   the mass budget showed 200 g (4 × 50 g) for the battery. The right answer is 300 g. The
   assembly's total and the root's own `total` attribute were wrong with it (500 g shown;
   540 g right). The engine's `evaluate` on an inherited feature has no receiver (upstream
   request 9). The trade studies already worked around this; the budgets did not. Now
   `Evaluation.valueFor` (`evaluation.ts:329`) works such an expression out with the part's
   own values. `appValue` also re-evaluates inherited expressions on the way down
   (`inheritsExpression`, `:317`) and keeps the engine's value when it can't. `budget.ts`
   uses it for parts (`:106`) and root attributes (`:237`). Test: "works the inherited mass
   out with each part's values, not the definition's".
2. **A part named out of a collection was counted twice.** With `part motors : Motor[4];
   part m1 :> motors; part m2 :> motors;` the budget added 4 × 10 g + 10 g + 10 g = 60 g.
   The right answer is 40 g: `m1` and `m2` are two of the four. Now such a part shows its
   value, and its total is empty with the note "one of `motors`, counted there"
   (`budget.ts:114`, `:150`). Test: "counts a part that is one of a collection once, in the
   collection".
3. **Parts of variable number were silently left out or counted at their least.** With
   `part o : Opt[0..1]; part r : Opt[2..4];` the budget left `o` out and counted `r` as 2,
   and the parent's note said "the sum of its parts". That is now true only with the
   addition "; counts `o` (0..1) as 0 and `r` (2..4) as 2, whose number can vary"
   (`budget.ts:129`, `rangeOf` `:363`). The count itself is unchanged (see the roadmap).
   Test: "says when it counts parts of variable number at their least".
4. **Trade studies ranked scores without their units.** For a score that is a mass, with
   alternatives at 0.6 kg, 500 g and 450 g, a MinimizeObjective selected the 0.6 kg pack
   (0.6 < 450 < 500 as plain numbers). Now the scores are converted to one unit before
   ranking (`trade.ts:222`). If they don't convert (a grain, which the tables' unit list
   lacks), nothing is selected and the note names the units. Tests: "ranks scores in one
   unit", "never selects by comparing numbers in units it cannot convert".
5. **The app's evaluator added an unknown unit to a known one by magnitude.** `7000 [gr] +
   100 [g]` gave `7100 [gr]`. It is 8543 gr. This value appeared as a trade-study criterion.
   Now `+`, `-` and the aggregate functions refuse units that differ when either is
   unknown. Comparisons still compare by magnitude, as the simulator documents and its
   test `2 [widget] > 1 [gadget]` expects (`sim/expr.ts:331`). Test: "does not add a unit
   it does not know to one it knows".

`docs/engine.md` (Budgets, Selection) describes the new behaviour.

---

## 6.1 Expression evaluation

### Does the expression engine correctly implement its documented operators, precedence, and error behavior?
- **Answer:** Yes for the cases tried. Engine: `2 + 3 * 4` = 14, `(2 + 3) * 4` = 20, `2 ** 3 ** 2` = 512
  (right-associative), `-2 ** 2` = 4 (KerML's unary minus binds tighter), `7 / 2` = 3.5,
  `1 / 3` an exact fraction, `7 % 3` = 1, `if 1 > 2 ? 10 else 20` = 20, `true and not false`.
  The app's evaluator gives the same, plus `true or false and false` = true and
  `10 - 4 / 2` = 8. Errors give a reason, not a value: "division by zero", "type error:
  cannot combine quantities in `kg` and `m`", "undefined variable `mass`".
- **Evidence:** `evaluation.assessment.test.ts:101` ("follows the documented precedence and
  operators"), `sim/expr.assessment.test.ts:21`, `:33`; existing `src/lib/sim/expr.test.ts`.
  Run in this session.
- **Limitations:** The engine doesn't evaluate `sum((1, 2, 3))` without importing the
  function ("unresolved reference `sum`"). The app's evaluator reads a subset of the
  expression syntax (no `collect`, `select`, sequences); what it can't read is "not an
  expression the app reads", never a guess.
- **Status:** Verified
- **Score:** 3 (engine and Fairtide)
- **Next action:** None

### Are units checked for dimensional consistency, including conversions and incompatible-unit errors?
- **Answer:** The engine converts within a dimension (`1 [kg] + 500 [g]` = 1.5 kg;
  `1 [W*h] + 3600 [J]` = 2 W·h; `1 [lb] + 1 [kg]` = 3.2046 lb). It refuses `kg + m` and
  `kg > m` with a reason, and flags them in Problems as "expression combines incompatible
  quantity dimensions `M` and `L`" at their lines. Budgets add g and kg (500 g + 1.5 kg =
  2000 g). They never add pounds, plain numbers or metres to grams: the sum is left empty.
  Trade scores are now ranked in one unit (fix 4). The app's evaluator no longer adds an
  unknown unit to a known one (fix 5).
- **Evidence:** `evaluation.assessment.test.ts:121`, `:314`; `trade.assessment.test.ts:59`,
  `:79`; `sim/expr.assessment.test.ts:39`, `:48`. Run in this session.
- **Limitations:** Two unit lists (`quantity.ts`, `sim/units.ts`) differ from each other
  and from the library. The tables don't convert lb, oz, ft, °C, so a budget with a part in
  pounds has no total. A grain converts nowhere. The library's pound is 0.4535924 kg, not
  0.45359237 kg (relative error 7 × 10⁻⁸; engine/library). A mass written in metres in an
  untyped attribute (`attribute mass = 5 [m]`) is shown in a mass budget without a warning.
  So is a plain number, with a share computed as if it were grams. Comparisons in the
  app's evaluator still compare unknown units by magnitude.
- **Status:** Verified
- **Score:** 2 (Fairtide; units outside the two lists are a gap); engine 3
- **Next action:** planned capability: take conversion factors from the library's own unit definitions, one list for tables, inspector and evaluator.

### Are missing values, undefined expressions, circular dependencies, and divide-by-zero conditions handled explicitly?
- **Answer:** Yes, as "no value" or "undecided" with a reason, never as a number. A missing
  value reads `none`, and an expression over it says "`missing` has no value in `p`". A
  cycle reads "cyclic feature value involving `a`". Division and modulo by zero read
  "division by zero". In the app: the inspector shows `= ?` with **Why?**, the checks view
  shows **Undecided**, and a budget cell is empty with a note ("no mass is given",
  "not computed: …").
- **Evidence:** `evaluation.assessment.test.ts:157`. e2e
  `assessment-calculations.spec.ts`: hover power 0 W → endurance `= ?`, Why? says
  division by zero, SYS-001 Undecided, budget unchanged, undo restores. Existing
  `budgets.spec.ts` "the inspector shows what an expression comes to, and why when it
  cannot". RESULT_E2E_SHORT
- **Limitations:** An undecided requirement check is not a problem: a division by zero that
  leaves a requirement undecided shows only in the checks view, not in Problems. A
  self-reference (`selfRef = selfRef + 1`) gives an "unresolved reference" warning instead
  of a cycle.
- **Status:** Verified
- **Score:** 3 (engine and Fairtide)
- **Next action:** additional testing; consider listing undecided checkable claims in Problems as information.

### Are numerical results reproducible across sessions and supported environments?
- **Answer:** Yes in what was compared. A fresh analysis gives byte-identical values,
  budget tables and trade studies. The demo's numbers (27.54 min, 2770 g, 397 W, scores
  0.3927/0.2842/0/0.5868) are the same in Node (unit tests) and in Chromium (e2e,
  `budgets.spec.ts`, `trade.spec.ts`).
- **Evidence:** "gives the same values in a fresh analysis", "gives the same table in a fresh
  analysis" (`evaluation.assessment.test.ts:182`, `:281`), "gives the same study from a
  fresh analysis" (`trade.assessment.test.ts:158`); e2e above. Run in this session.
- **Limitations:** Chromium only; Firefox and Safari were not run. Displayed values have 4
  significant digits (`formatMagnitude`), and so does a CSV export.
- **Status:** Partially verified
- **Score:** 2
- **Next action:** additional testing (Firefox/WebKit projects).

### Can users trace calculated results back to their inputs and dependencies?
- **Answer:** Partly. A check lists the feature chains its constraint names, with values
  ("Met: drone.endurance = 27.54 min (needs ≥ 25 min)"). An undecided value names the
  missing or collection input it depends on, followed through references (`cause`,
  `evaluation.ts:218`). The inspector shows an attribute's expression and its value, and
  the values of the attributes an element contains. Budget rows are the parts tree; each
  row opens its element. There is no view of what a value depends on, nor of what depends
  on it.
- **Evidence:** existing `evaluation.test.ts:50` ("gives the values, the limit and the
  margin…"), `:174` ("says why a value is undecided"); e2e `budgets.spec.ts`. Run in this
  session.
- **Limitations:** Only the first missing input is named. Values the app works out are
  marked internally (`byApp`) but look the same to people.
- **Status:** Partially verified
- **Score:** 1
- **Next action:** planned capability: a "depends on / used by" list for an attribute in the inspector.

## 6.2 Engineering rollups

### Do mass and power rollups handle nested components, inheritance, redefinitions, and repeated instances correctly?
- **Answer:** Yes on the known-answer model, after fixes 1–3. Four levels deep (drone → pods[2] → hub
  → rotors[4], 8 rotors, 240 g); values inherited from definitions; redefined in a
  specialized definition (HeavyArm 80 g) and in a usage (40 g); a specialization's parts
  with its redefinition (`BigDrone`: 2384 g). Two usages of one definition both count.
  Total 1384 g, matching the hand sum. An expression a part inherits is now evaluated
  with the part's values (fix 1).
- **Evidence:** `evaluation.assessment.test.ts:232`, `:257`, `:369`; existing
  `evaluation.test.ts:273`, `:346` (demo mass and power budgets), e2e `budgets.spec.ts`.
  Run in this session.
- **Limitations:** A part with its own value is not compared with the sum of its parts
  (its value wins, with no note when they differ). Ranges count at their lower bound
  (`[*]` counts as 1, `[0..*]` as 0). A collection's member with a value of its own
  (`m1 :> motors { :>> mass = 15 [g]; }`) is still counted at the collection's value.
- **Status:** Verified
- **Score:** 2 (fixed in this session; broader fixtures would make it 3)
- **Next action:** bug fix (ranges: show least–most; a member's own value).

### Are part usages counted correctly without accidentally counting definitions or duplicate references?
- **Answer:** Yes after fix 2. `ref part` is left out. A definition that no part uses is
  not counted in any part's total (over the whole model the drone's and the big drone's
  totals are unchanged and contain none of its parts). A variation is not part of the
  bill of materials (`views/rows.ts:691`). A part that subsets a sibling collection
  is no longer counted twice.
- **Evidence:** `evaluation.assessment.test.ts:232` (spare `ref part` not listed), `:268`,
  `:397`; existing `evaluation.test.ts:346` (`rotors` reference counted once). Run in this
  session.
- **Limitations:** Subsetting across levels (`part m1 :> other.motors`) isn't recognised
  as membership. A part bound by value to another part (`part x = y;`) was not tried.
- **Status:** Verified
- **Score:** 2
- **Next action:** additional testing.

### Are missing values and invalid inputs handled predictably?
- **Answer:** Yes, never as a confident number. A part without a value shows an empty cell
  with "no mass is given". Its parent adds the others and says "adds up the parts that have
  a mass; 1 has none". A sum over units that don't convert is left empty, and the root says
  how many parts it left out. An optional attribute (`powerDraw [0..1]`) leaves its parts
  out. A model with a syntax error still renders a budget from what parsed; Problems shows
  the error, the budget doesn't.
- **Evidence:** `evaluation.assessment.test.ts:314`; `it.fails` `:334`, `:343` (known gaps:
  the note's wording, shares). Run in this session.
- **Limitations:** A parent whose parts are in units that don't add up says "no mass is
  given" instead of why. A value in an unconverted unit shows a share of "0 %", and a plain
  number a share as if it were grams.
- **Status:** Verified
- **Score:** 2
- **Next action:** bug fix (note wording, share).

### Are dependent values recalculated when upstream model inputs change?
- **Answer:** Yes. Every analysis rebuilds values and checks; nothing is cached across a
  change. Through the workspace: making the violating arm lighter removes the check problem.
  A changed price changes the trade table's scores, ranks and selection, and undo puts them
  back. In the UI: a changed hover power turns SYS-001 violated (existing e2e), and 0 W
  turns it undecided (new e2e).
- **Evidence:** `evaluation.assessment.test.ts:455`; `trade.assessment.test.ts:164`;
  existing `evaluation.test.ts:100`, `trade.test.ts:128`; e2e `budgets.spec.ts` "a value
  that breaks a requirement…", `trade.spec.ts` "a pricier pack changes the choice, until
  undone", `assessment-calculations.spec.ts`. Run in this session.
- **Limitations:** On a model whose analysis takes more than 2 s, checks wait for a pause
  in typing (`docs/performance.md`).
- **Status:** Verified
- **Score:** 3
- **Next action:** None

### Can users inspect the dependency graph behind a calculated result?
- **Answer:** No graph. What exists is described under "trace calculated results" above:
  values named in a check, an undecided value's first missing input, the inspector's
  expression and values. The dependency matrix (DSM) covers structure (connections, flows,
  bindings), not value dependencies.
- **Evidence:** code reading (`Inspector.svelte:110-131`, `evaluation.ts:218`,
  `docs/dsm.md`).
- **Limitations:** —
- **Status:** Not claimed
- **Score:** 1
- **Next action:** planned capability (as above).

### Are results validated against independent hand calculations or trusted reference implementations?
- **Answer:** Against hand calculations, yes. Every new test states its arithmetic beside
  the expected value (nested budget, inherited expression, subsets, ranges, unit
  conversions, trade scores and ranks). The demo's expected results are documented in its
  tour (`src/demo/drone/TOUR.md`). No other tool computed these numbers; the OMG pilot
  implementation doesn't evaluate them.
- **Evidence:** the three new test files; existing `evaluation.test.ts`, `trade.test.ts`.
- **Limitations:** No reference implementation, so the score is capped at 3.
- **Status:** Verified (hand calculations)
- **Score:** 3
- **Next action:** None

## 6.3 Constraints and trade studies

### Do constraints evaluate against the intended model scope?
- **Answer:** `satisfy R by x` evaluates R's constraint with R's subject bound to `x`. Three
  claims on one requirement (`arm.mass <= 75 [g]`) by 50 g, 80 g (specialized definition)
  and 70 g (usage redefinition) parts give satisfied, violated and satisfied, with margins
  25, −5 and 5 g. An `assert constraint` in a part definition over one of its parts
  (`h.mass <= 60 [g]` in `Craft`) was decided for that part (violated, 80 g) in a probe run
  in this session, not kept as a test. **But an `assert constraint` in a definition
  is decided only for the definition's own values.** `Arm`'s `mass <= 60 [g]` reads
  "Met." although `HeavyArm` (80 g) and a usage (70 g) break it. Nothing reports the
  violation (engine `verify`; the app shows one check "by Arm").
- **Evidence:** `evaluation.assessment.test.ts:443`; `it.fails` `:474` (open critical
  finding); existing `evaluation.test.ts:29`, `:205`. Run in this session.
- **Limitations:** As above. Redefining a bound (non-default) value is an error the engine
  reports (`validateFeatureValueOverriding`), so redefinable values need `default`.
- **Status:** Partially verified
- **Score:** 1 (critical gap open); engine 1
- **Next action:** bug fix: evaluate a definition's assertions for each specialization and usage that redefines what they read (or report upstream and say "checked for the definition only" until then).

### Are failed constraints linked to affected model elements?
- **Answer:** Yes. A violated claim or assertion is a warning at the `satisfy` or the
  assertion, in Problems and the editor, with the values and the limit ("armReq is not met
  by craft.h: craft.h.mass = 80 g (needs ≤ 75 g)"). Its range is the claim's text, so
  Problems jumps there. The checks view's row opens the claim; budget rows carry the limit,
  margin and verdict of a claim on their value.
- **Evidence:** `evaluation.assessment.test.ts:455` (through the workspace, and gone after
  the fix); existing e2e `budgets.spec.ts` ("the checks view … shows the claim", "a value
  that breaks a requirement is a violation and a problem, until undone"). Run in this
  session.
- **Limitations:** The warning sits at the claim, not at the part whose value fails it.
- **Status:** Verified
- **Score:** 3
- **Next action:** None

### Can trade studies compare alternatives with different assumptions, constraints, and parameter values?
- **Answer:** Different parameter values, yes. Each alternative's own values, including
  expressions it inherits with its own inputs (`mass = cells * cellMass`: 200, 300,
  180 g), feed criteria, weights (read from a weighted sum) and the score. Per-alternative
  conditions in the score work (`if massMargin < 0 [kg] ? 0.0 else …`, the demo).
  Different assumptions per alternative (scenarios) are not a concept. The design context
  (`drone.takeOffMass`) is one, so comparing under other assumptions means another study
  or an edit.
- **Evidence:** `trade.assessment.test.ts:136`; existing `trade.test.ts:68`, `:98`, `:296`.
  Run in this session.
- **Limitations:** `all X` alternatives are not supported (said in the study). Subject
  alternatives must be listed.
- **Status:** Verified (parameters); Not claimed (scenarios)
- **Score:** 2
- **Next action:** planned capability: named scenarios (sets of assumed values) per study.

### Are results recalculated when the underlying model or scenario inputs change?
- **Answer:** Yes, on every analysis. Through the workspace, a changed price moves scores
  0.62/0.47/0.41 → 0.62/0.47/0.65 and the selection from `four` to `light`, and undo
  restores it. In the UI the same holds for the demo (existing e2e).
- **Evidence:** `trade.assessment.test.ts:164`; `trade.test.ts:128`; e2e `trade.spec.ts`
  "a pricier pack changes the choice, until undone". Run in this session.
- **Limitations:** No scenario inputs (above).
- **Status:** Verified
- **Score:** 3
- **Next action:** None

### Are units and assumptions consistent across compared alternatives?
- **Answer:** Units now are (fix 4). A criterion's values are shown in one unit (700 g,
  600 g, 550 g for 0.7 kg, 600 g, 550 g), and scores are ranked in one unit. If they can't
  be converted, nothing is selected and the note says why. Assumptions are shared, since
  every alternative is evaluated in the same design context.
- **Evidence:** `trade.assessment.test.ts:59`, `:79`; `it.fails` `:93` (a grain mass
  can't be converted, so nothing is selected). Run in this session.
- **Limitations:** A criterion's "best" mark (`inBase`, `trade.ts:994`) still compares
  unconvertible values as plain numbers. The direction probe (nudging a criterion by 0.1 %)
  assumes the score is smooth near each value.
- **Status:** Verified
- **Score:** 2
- **Next action:** bug fix (no best mark across unconverted units).

### Can users reproduce and export a trade study with its inputs and results?
- **Answer:** Reproduce: the study is model text, so the same text gives the same study,
  byte for byte (fresh-analysis test). Export: the trade table exports as CSV or XLSX with
  each criterion's value per alternative, its weight, the score and the rank (e2e checks
  the CSV). The inputs that aren't criteria (an alternative's own `price` or `cells`, the
  objective, constants in the score) are not in the export: they are in the model text.
  Values are exported as displayed (4 significant digits).
- **Evidence:** `trade.assessment.test.ts:158`; e2e `trade.spec.ts` "the inspector sums a
  trade study up, and the table exports as CSV". Run in this session.
- **Limitations:** As above. A report (`src/lib/reports`) can include the table; not
  assessed here.
- **Status:** Partially verified
- **Score:** 2
- **Next action:** planned capability: export the alternatives' input values and the objective with the table, at full precision.

### Are uncertainty, sensitivity analysis, and optimization supported where claimed, or explicitly identified as future capabilities?
- **Answer:** Not supported. Optimization goes no further than selecting the best of the
  listed alternatives. A local sensitivity probe (±0.1 %) is used internally, only to say
  which direction of a criterion is better; it is not shown as sensitivity. Uncertainty:
  `docs/table-rendering.md:96` documents a `"uncertainty"` row provider as "evaluated
  uncertainty analyses (case, critical, target limits, worst-case range, margin, cp, cpk,
  result)". The code (`views/rows.ts:97`) returns an empty table with the warning
  "uncertainty analyses are not evaluated by this engine yet". The table says so; the doc
  overclaims.
- **Evidence:** code reading; `grep -n uncertainty src/lib/engine/toolkit/views/rows.ts`.
- **Limitations:** —
- **Status:** Not claimed (uncertainty: documented but not implemented, warned in the table)
- **Score:** — (Not claimed)
- **Next action:** fix the doc (mark the provider as planned); planned capability: worst-case and RSS ranges over tolerances.

## Prioritized question 6: Are calculation rollups and units correct for nested structures, inheritance, redefinitions, and invalid values?

After this session's fixes, yes on every known-answer case tried. That covers four
levels, multiplicities, inherited and redefined values (definition and usage),
specializations, references, unused definitions, repeated parts, subsets, ranges (with a
note), g + kg, W·h + J, and refusal of lb/plain/metre mixes and of kg + m. Before them,
three cases gave a confident wrong number: inherited expressions (200 g for 300 g), subsets
(60 g for 40 g) and the silent left-out optional part. Open: unit lists that miss library
units (no total, never a wrong one), and definition assertions checked for the definition
only (critical, open). Score 2.

## Prioritized question 7: Are trade-study results reproducible and recalculated when inputs change?

Yes. The same text gives the same study byte for byte. A change through the workspace or
the UI recalculates scores, ranks and selection, and undo restores them. Before this
session, scores in different units were ranked as plain numbers, which selected the
heaviest pack under a MinimizeObjective (fixed). The export carries criteria, weights,
scores and ranks, not all inputs. Score 3 for recalculation and reproducibility, 2 for
export.

## Section scores

| Sub-area | Score | Notes |
| --- | --- | --- |
| Operators, precedence, errors | 3 | engine and app evaluator agree; hand-checked |
| Units and dimensions | 2 | engine 3; two partial unit lists in the app |
| Missing, cycles, division by zero | 3 | `?` with reasons; undecided not in Problems |
| Reproducibility | 2 | Node and Chromium only |
| Tracing results to inputs | 1 | values named in checks; no dependency view |
| Roll-ups: nesting, inheritance, redefinition, repeats | 2 | three critical defects fixed here |
| Counting (refs, definitions, subsets) | 2 | subset double count fixed here |
| Missing and invalid inputs in budgets | 2 | never a wrong total; notes imprecise |
| Recalculation | 3 | workspace and UI |
| Constraint scope | 1 | definition assertions checked for the definition only (critical, open) |
| Failed constraints linked to elements | 3 | |
| Trade studies: alternatives, units | 2 | unit ranking fixed here; no scenarios |
| Trade studies: reproduce and export | 2 | inputs outside the criteria not exported |
| Uncertainty, sensitivity, optimization | Not claimed | doc overclaims the uncertainty table |

## Critical findings

1. **Fixed — budgets evaluated an inherited expression with the definition's values.**
   Repro (before the fix): the `INHERITED` model in `evaluation.assessment.test.ts`; the
   mass budget showed `craft.battery` 200 g (right: 6 × 50 = 300 g), `craft.spare` 200 g
   (4 × 60 = 240 g) and `craft` 400 g (540 g).
2. **Fixed — a part that subsets a sibling collection was counted twice.** Repro:
   `part def Quad { part motors : Motor[4]; part m1 :> motors; part m2 :> motors; }`
   with `Motor` 10 g: 60 g shown, 40 g right.
3. **Fixed — optional parts left out without a word.** Repro: `part o : Opt[0..1];`
   beside other parts: the parent's total excluded `o` and read "the sum of its parts".
   Now the note names it. The count is still the least (roadmap).
4. **Fixed — trade-study scores ranked without units.** Repro: the `MASSES` model in
   `trade.assessment.test.ts` (score `p.mass`, MinimizeObjective, 0.6 kg / 500 g / 450 g):
   the 0.6 kg pack was selected.
5. **Fixed — unknown + known unit added by magnitude** in the app's evaluator: `7000 [gr] +
   100 [g]` = `7100 [gr]` as a trade criterion.
6. **Open — a definition's `assert constraint` is checked for the definition only.** Repro:
   the `SCOPE` model in `evaluation.assessment.test.ts`. `part def Arm { attribute mass
   default 50 [g]; assert constraint light { mass <= 60 [g] } }`, `part def HeavyArm :> Arm
   { :>> mass default 80 [g]; }`, a `HeavyArm` usage. Checks: one, "Met.", by Arm; no
   violation anywhere. Test: `it.fails` "checks a definition's assertion for the parts
   that redefine its values". Engine (`verify` evaluates the assertion in its owner only)
   and app (it presents that as the check). Not fixed here: deciding per usage needs
   evaluating the constraint for every specialization and usage, which is not a minimal
   change.

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Definition assertions decided for each specialization and usage (or labelled "for the definition's values only" until then); report upstream | High (critical open) | High | M |
| One unit table from the library's own unit definitions, for tables, inspector and evaluator (lb, ft, °C, grain…) | High | High | M |
| Budgets: show least–most totals for variable multiplicities (`[0..1]`, `[2..4]`, `[*]` as 0..*) instead of the least | Medium | High | M |
| Budget notes say why a sum is empty (units that don't add up); no share for unconverted values | Low | Medium | S |
| A part's own value vs the sum of its parts: flag a difference | Medium | Medium | S |
| A collection member's own value (`m1 :> motors { :>> mass = … }`) counted in the collection's total | Medium | Medium | S |
| Budget tables say when the model has syntax errors | Medium | Medium | S |
| "Depends on / used by" for an attribute in the inspector | Medium | High | M |
| Undecided requirement checks listed in Problems (as information) | Low | Medium | S |
| Trade export with the alternatives' input values, the objective and full precision | Medium | Medium | S |
| Trade-study scenarios (assumption sets) | Medium | Medium | L |
| No "best" mark across unconverted units in trade criteria | Low | Low | S |
| `docs/table-rendering.md`: mark the `uncertainty` provider as planned | Low | Low | S |
| Worst-case / RSS tolerance ranges (uncertainty) | Medium | Medium | L |
| Firefox and WebKit runs of the budget and trade e2e | Low | Medium | S |
