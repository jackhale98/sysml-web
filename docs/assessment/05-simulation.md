# §5 State-machine simulation and behavioural execution

Assessed on `claude/assess-simulation` (based on 92cfbcf, merged with main at 68cb9db).
Scores are Tessera's: the simulator (`src/lib/sim/emulator.ts`) is Tessera's own code.
The engine only parses and resolves the model (transition ends, `isParallel`, the final
state), which `src/lib/engine/toolkit/machines.ts` turns into the simulator's input.
Every test named here was run in this session unless it says otherwise. The OMG pilot
implementation does not execute state machines, so no other tool checks the traces and
nothing here scores above 3.

Commands (from the repository root):

```
npx vitest run src/lib/sim/reference-traces.assessment.test.ts
npx vitest run src/lib/sim src/lib/engine/toolkit/machines.test.ts
PW_PORT=4322 npx playwright test tests/e2e/assessment-simulation.spec.ts tests/e2e/emulator.spec.ts tests/e2e/machines.spec.ts --workers=2
```

## How the expected traces were derived

The reference suite (`src/lib/sim/reference-traces.assessment.test.ts`) writes each
expected trace from the specifications, not from the simulator's output:

- SysML v2.0 Part 1: 7.17.8 (change, absolute and relative time triggers), 7.18.1 (entry,
  do, exit; parallel states), 7.18.2 (initial substate, conditional initial transitions),
  7.18.3 (when a transition is triggered; the five steps of performing it; `done`;
  `terminate`), 8.4.14 (state and transition semantics).
- Kernel Semantic Library: `StatePerformances` (`entry then middle`, `middle then exit`,
  `nonDoMiddle`, `accepted [0..1]`, `deferrable`), `TransitionPerformances`, `Triggers`
  (`TriggerWhen`, `TriggerAt`, `TriggerAfter`) and `Observation` (`ObserveChange` sends a
  change signal once, when the condition becomes true).

Entry, exit and effect actions append to a `log` string, so the order in which they ran
is part of the trace. Where the specifications leave the choice open (which of two
enabled transitions fires; the order of exits in concurrent regions; a change and a timer
due at the same instant), the case checks only what is fixed ("exactly one fires", "both
regions exit before the parallel state") plus the simulator's documented choice.

SysML v2 itself does not settle two points the simulator needs, and it follows UML there,
as `docs/simulator.md` says: inner transitions have priority over outer ones, and one
event fires a transition in each orthogonal region. (The library's `acceptable`
invariant under `isDispatch` can be read as one transfer being accepted by only one state
performance in the dispatch scope; the specification text does not say so, and the
simulator takes UML's reading.)

## Results of the runs in this session

| Run | Result |
| --- | --- |
| `reference-traces.assessment.test.ts` with the fixes | 34 pass, 6 expected fail (known gaps) |
| The same file on the code before the fixes | 7 fail (exactly the tests of the three fixes), 27 pass, 6 expected fail |
| The six known gaps run as plain tests (probe) | all six fail for the stated reason |
| `src/lib/sim` and `machines.test.ts` with the fixes | 7 files, 151 pass, 6 expected fail (one existing expectation updated: the `send` in its fixture is now noted) |
| `tests/e2e/assessment-simulation.spec.ts`, `emulator.spec.ts`, `machines.spec.ts` | 7/8 pass; the loop test timed out waiting for its message, which shows only after the steps are animated (see the infinite-loop question). With a longer wait, the assessment spec: 3/3 |
| `npm run check` | 0 errors |

## Fixes made in this assessment (critical defects)

1. **An event was taken from a state the machine had already left.** With
   `transition first a then b;` and `transition first a accept Go then c;`, sending Go
   right after entering `a` went to `c`, although `a`'s untriggered transition happens as
   soon as `a` is entered (`StateTransitionPerformance`: `nonDoMiddle then self`) and the
   simulator's own documented rule is "transitions without a trigger come before
   triggered ones". The same held for a `when` already true on entry (7.17.8: the signal
   is sent at once) and a timer that is due. The Go button was offered as ready, so a
   run could show `c` as reachable from `a` when it is not. Now, while something is ready
   for a Step, events wait: each event button shows "`a -> b` fires first", and sending
   one returns "`a -> b` fires first: Step, then send `Go`" without changing anything
   (`src/lib/sim/emulator.ts:643`, `enabled`; `:1014`, `step`). Auto-run already took
   Steps first, so it is unchanged.
2. **Two signals with the same simple name were one signal.** With `accept B::Go then y`
   written before `accept A::Go then x`, pressing `A::Go` went to `y`, and the `A::Go`
   transition showed "`toY` fires first", so `x` looked unreachable. Signals now match
   exactly or with fewer qualifiers (`Go` and `A::Go` still match; `A::Go` and `B::Go`
   don't), and pre-emption is worked out per event (`emulator.ts:567`,
   `signalMatches`; `:643`).
3. **Steps of an action other than assignments were dropped without a word, and the
   trace hid them.** `entry action { assign y := 5; if x > 5 { assign y := 7; } }` ran
   as `assign y := 5` (y = 5 where the model gives 7) and the Timeline showed the entry
   action as `assign y := 5`; a `then` succession and a `send` were dropped the same way.
   The documentation said these steps are not run; the app said nothing. Now the machine
   carries a note for each such step (`if`, `send`, `accept`, loops, successions, in
   entry/do/exit actions and transition effects), shown before the run in the "may not
   run as written" callout (`src/lib/engine/toolkit/machines.ts:287`, `notRun`;
   `:554`, `skippedSteps`).

Each fix has a test that failed before it and passes with it: the seven tests of the "events wait", "signals" and note groups fail on the code before the fixes and pass after (runs above); `machines.test.ts` had one expectation of no notes on a fixture with `do send Sig() to p`, now updated to the note.
`docs/simulator.md` now says how events wait, how signals match and what the notes cover.

## Questions

### Does simulation execute the semantics represented in the SysML model, or a simplified interpretation?
- **Answer:** A defined, simplified interpretation of a subset. The simulator runs states
  (nested, parallel), transitions with signal, `when`, `after` and `at` triggers, guards,
  effects, and entry/do/exit actions, of which it executes only `assign` statements;
  other actions are recorded in the Timeline as started/stopped. Time is a simulated
  clock that moves only on Step or Wait. Where SysML v2 is silent it follows UML
  run-to-completion. `docs/simulator.md` states the rules with the clauses they come
  from and lists what is not supported.
- **Evidence:** `docs/simulator.md`; reference suite (13 trace cases, all pass);
  `src/lib/sim/semantics.test.ts` (31 tests: the demo's FlightModes and four fixture
  machines run through, and semantic cases). Run in this session.
- **Limitations:** no signal payloads, no `send` to the machine, no `if`/loops/successions
  inside actions, no `terminate`, no conditional initial transitions, change triggers
  read only variables (not time); one clock.
- **Status:** Partially verified
- **Score:** 2 (Tessera)
- **Next action:** planned capability (payloads; action steps beyond assignments).

### Are states, transitions, triggers, guards, effects, and event handling implemented correctly?
- **Answer:** For the supported subset, yes, after two fixes made here (events taken from
  a state already left; signals confused by simple name). A false guard blocks with its
  reason; exit, effect, entry run in the 7.18.3 order; guards are read before the exit
  action (8.4.14.3) and before any transition of the step fires; an event no transition
  accepts is discarded with a message. One divergence remains: a `when` signal that
  arrives while the guard is false is taken later once the guard holds, while
  `Observation::ObserveChange` sends it once (the simulator already loses a *time*
  signal in that case).
- **Evidence:** `reference-traces.assessment.test.ts` T01, T02, T08, T11b, T14 and the
  "events wait" and "signals" groups; `it.fails` "a change signal that comes while the
  guard is false is not taken later" (known gap, confirmed failing for that reason by a
  run with `it`).
- **Limitations:** a guard that reads the trigger's payload (`accept r : Reading if
  r.v > 3`) stays blocked ("r.v has no value yet") and cannot be satisfied.
- **Status:** Verified (supported subset)
- **Score:** 2
- **Next action:** bug fix (lose a change signal whose guard is false, as for time signals).

### How are competing transitions, event ordering, and multiple valid guards handled?
- **Answer:** Inner source states first (UML 14.2.3.9.4), then untriggered before
  triggered, then document order; a maximal set of transitions that exit disjoint states
  fires together (one per orthogonal region). Of two transitions from one state with
  true guards, the first written fires and the other shows "`ta` fires first" before the
  event is sent. A change and a timer due at the same instant: the first written (the
  specifications leave it open; documented). Events are processed one at a time, in the
  order sent; an unaccepted event is discarded, not deferred. Events now wait while a
  Step is pending (fix 1).
- **Evidence:** "competing transitions" group (4 tests), T08, "events wait" group,
  `semantics.test.ts` priority tests. Run.
- **Limitations:** the Timeline does not record that a step had a competing enabled
  transition (only the controls show it beforehand); effects of transitions in different
  regions on the same variable run in document order without a warning (they are
  concurrent in SysML).
- **Status:** Verified
- **Score:** 3
- **Next action:** additional testing (note conflicting writes from concurrent regions).

### Are nested states, orthogonal regions, entry/exit behavior, and other advanced constructs supported?
- **Answer:** Nested states, transitions into a nested target (`then b.b2`), from an
  inner state to an outer target, self-transitions on composites (exit and re-entry to
  the initial substate), parallel states (all regions entered, completion when every
  region is `done`), exits innermost first and entries outermost first: all match the
  library's `entry then middle then exit` ordering. Not supported: `terminate` (shows as
  an unknown state and the run sticks there, with a note), conditional initial
  transitions (`entry; if c then on;`: the first state is entered regardless; noted as
  "no source state"). SysML v2 has no history or deferral notation.
- **Evidence:** T03, T03b, T04, T05, T06, C4 (exits of every region before the parallel
  state); `it.fails` for terminate and conditional initial (both confirmed failing; both
  have passing tests that the machine carries a note).
- **Limitations:** the notes for terminate and conditional initial name the symptom
  ("unknown state `stop`", "no source state"), not the construct.
- **Status:** Verified (supported constructs); gaps reported
- **Score:** 2
- **Next action:** planned capability (terminate, conditional initial transitions).

### Are time-dependent events, timers, and delayed transitions supported where required?
- **Answer:** Yes, on a simulated clock: `after d` (evaluated on entry after the entry
  action, restarted on re-entry, not by inner transitions), `at t` (seconds since the
  start; one already past never fires), `when c`, units converted (`5 [s]`, `2 [SI::min]`),
  a time that cannot be worked out (unset variable, non-time unit, `Iso8601DateTime(…)`)
  is noted on the step and never fires. Wait runs every timer due on the way, in order.
- **Evidence:** T12; `semantics.test.ts` "simulated time" (10 tests); `emulator.test.ts`
  "the clock". Run.
- **Limitations:** no wall-clock or date-time instants; change triggers cannot read time;
  one clock.
- **Status:** Verified
- **Score:** 3
- **Next action:** None.

### Can Tessera identify unreachable states and dead transitions?
- **Answer:** No. There is no static reachability analysis. At run time a machine that can
  go nowhere shows "Stuck", unknown targets are noted, and auto-run favours the least
  visited targets, which helps exploration but proves nothing.
- **Evidence:** none (searched `src/` for reachability; none found).
- **Limitations:** n/a.
- **Status:** Not claimed
- **Score:** — (not claimed; a gap for verification use)
- **Next action:** planned capability (reachability over states and transitions, ignoring
  guards, with guard-aware hints).

### Can users inspect execution traces and understand why each transition fired?
- **Answer:** Partly. The Timeline lists each step with its time, trigger (or
  "completion"), "guard true", the do actions stopped, exit actions, effect, entry
  actions and do actions started, and notes (a timer that will not fire). Before a step,
  every outgoing transition shows whether it is ready and why not (guard false with the
  expression, has no value yet with a link to the variable, pre-empted by another, due
  at a time). Back/Forward and scrubbing show the variables at each step.
- **Evidence:** `src/lib/sim/TracePanel.svelte:99-121`; `src/lib/sim/model.ts:97`
  (`explain`), `model.test.ts` "explains blocked transitions kindly"; e2e
  `emulator.spec.ts`. Run.
- **Limitations:** a step does not record the guard expression, the variable values it
  read, or the transitions it beat; the trace cannot be exported or saved with the
  project.
- **Status:** Partially verified
- **Score:** 2
- **Next action:** planned capability (record why on each step; export the trace).

### Are simulations deterministic and reproducible for the same model and input sequence?
- **Answer:** Yes for events, Steps and Waits: every reference case run twice gives an
  identical session, and a session that crossed JSON (as it does between the worker and
  the page) resumes to the same trace. Auto-run is not: it breaks ties between ready
  events with `Math.random` and has no seed, so two auto-runs of one machine may differ
  (its run is recorded and can be stepped back through).
- **Evidence:** reference suite "same session when run twice", "went through JSON";
  "auto-run breaks ties at random" (stubs `Math.random`). Run.
- **Limitations:** no way to replay an input script except by hand.
- **Status:** Verified
- **Score:** 3 (stepping); auto-run not reproducible
- **Next action:** planned capability (seeded auto-run; save and replay an input script).

### Are unsupported constructs identified rather than silently approximated?
- **Answer:** Mostly, after fix 3. Before it, `if`, successions and `send` inside actions
  were dropped silently and the Timeline showed the shortened action. Now: steps not run
  are named in the machine's notes; unknown targets (`terminate`), transitions with no
  source (conditional initial) and times that cannot be worked out are noted; a guard
  that cannot be read blocks with its reason. Still silent: a `when` whose guard was
  false when it became true is taken later (documented now), and concurrent effects
  writing the same variable.
- **Evidence:** "where the simulator departs" group: note tests for send, `if`,
  succession, effect `send`, terminate, conditional initial (pass); e2e "a machine with a
  construct the simulator cannot run says so". Run.
- **Limitations:** the notes appear once, above the diagram, not on the steps they affect.
- **Status:** Verified
- **Score:** 2
- **Next action:** additional testing (mark the affected steps in the Timeline).

### Can simulation results be linked to requirements, test cases, and verification evidence?
- **Answer:** No. A run lives in the tab (and the browser's session memory); it is not
  saved with the project, cannot be exported, and verification cases cannot refer to a
  run or an expected trace.
- **Evidence:** none (no export or link in `src/lib/sim`; reports and requirement
  traceability do not read simulations).
- **Limitations:** n/a.
- **Status:** Not claimed
- **Score:** — (not claimed; a gap for regulated use)
- **Next action:** planned capability (save an input script and its trace as evidence of a
  verification case, re-run on change).

### Are reference models with expected execution traces used for regression testing?
- **Answer:** Yes, now: the reference suite has 13 trace cases plus 27 targeted tests
  with spec-derived expectations (6 of them expected failures for known gaps), run in the unit suite (and so in CI). Before this
  assessment the semantic tests (`semantics.test.ts`) were scenario tests written
  alongside the code, many expecting what the code did.
- **Evidence:** `src/lib/sim/reference-traces.assessment.test.ts`. Run.
- **Limitations:** the expectations are this assessment's reading of the specification;
  no other executor checks them.
- **Status:** Verified
- **Score:** 2
- **Next action:** additional testing (cross-check against another executor, e.g. a
  SysML v1/fUML or SCXML run of the same machines).

### Can execution be stopped safely if a machine enters an infinite loop?
- **Answer:** Yes. Step fires one compound step at a time, so it cannot hang. A Wait on a
  machine that never lets time pass stops after 200 steps and says "stopped after 200
  steps at 0 s: the machine keeps moving without time passing". A run stops at 1000
  steps ("Step limit reached"), which also stops auto-run; Pause stops auto-run at any
  time.
- **Evidence:** "machines that never let time pass" (cycle of untriggered transitions,
  `when true` self-transition, step limit); `emulator.test.ts` "stops a wait at the step
  limit"; e2e "a machine that never lets time pass stops a Wait and says why". Run.
- **Limitations:** a cycle is not named as a livelock when stepping one at a time. The
  Wait's message shows only after the 200 steps have been animated one by one, about
  1.5 minutes in which the controls are busy (the e2e test waits for it).
- **Status:** Verified
- **Score:** 3
- **Next action:** None.

### 5. Are the simulator's supported semantics defined and validated against reference traces?
- **Answer:** Defined: yes, in `docs/simulator.md`, with the clauses each rule comes from,
  the open choices and how the simulator settles them, and (updated here) what is not
  supported. Validated: against 13 spec-derived reference traces and 27 targeted tests,
  which found the three critical defects above (fixed) and five non-critical gaps (kept
  as expected failures). Not validated by another tool.
- **Evidence:** as above.
- **Limitations:** the semantic choices borrowed from UML are not checked against a UML
  executor.
- **Status:** Partially verified
- **Score:** 2
- **Next action:** additional testing (independent executor).

## Section scores

| Sub-area | Score | Notes |
| --- | --- | --- |
| Semantics defined and documented | 3 | `docs/simulator.md`, clause by clause; open choices stated. |
| Core execution (triggers, guards, effects, order) | 2 | 3 criticals fixed here; change-signal/guard gap open. |
| Competing transitions, event ordering | 3 | |
| Hierarchy, regions, entry/exit/do | 2 | terminate, conditional initial unsupported (noted). |
| Time | 3 | |
| Unsupported constructs reported | 2 | Silent before fix 3. |
| Trace inspection | 2 | No why-record, no export. |
| Determinism | 3 | Auto-run is random. |
| Infinite loops | 3 | |
| Reference-trace regression suite | 2 | New; self-validated only. |
| Reachability analysis | — | Not claimed. |
| Link to requirements and verification | — | Not claimed. |

## Critical findings

All three fixed in this assessment (see above); minimal reproductions, each a state
machine run in **Simulations**:

1. Event taken from a state already left:
   ```
   state def G1 { entry; then a; state a; state b; state c; state d;
       transition first a then b; transition first a accept Go then c;
       transition first b accept Go then d; }
   ```
   Press Go before Step: went to `c` (correct: `b`, then Go to `d`).
2. Signals confused by simple name:
   ```
   package G3 { package A { item def Go; } package B { item def Go; }
       state def M { entry; then s; state s; state x; state y;
           transition toY first s accept B::Go then y;
           transition toX first s accept A::Go then x; } }
   ```
   `A::Go` went to `y`; `A::Go → x` showed as pre-empted.
3. Action steps dropped silently:
   ```
   state def G8 { attribute x : Integer = 10; attribute y : Integer = 0;
       entry; then a; state a { entry action { assign y := 5; if x > 5 { assign y := 7; } } } }
   ```
   y = 5, the Timeline showed `entry assign y := 5`, no note (correct: 7, or a note).

## Open, not critical (expected failures in the suite)

- A `when` signal that comes while its guard is false is taken later (should be lost).
- Conditional initial transitions are ignored (first state entered; noted).
- `terminate` is not supported (noted; the run sticks in an unknown state).
- `send` to the machine's own part is not delivered (noted now).
- `if` and successions inside actions are not run (noted now).

## Roadmap candidates

| Candidate | Impact | User value | Effort |
| --- | --- | --- | --- |
| Save an input script with its expected trace as a verification case; re-run on change; show pass/fail in requirement traceability | High | High | M |
| Static reachability: unreachable states, transitions that can never fire (ignoring guards), with guard hints | High | High | M |
| Record on each step why it fired (guard text and values read, transitions it beat); export the trace (CSV/JSON) | Medium | High | S |
| Signal payloads: an event with values, readable in guards and effects | Medium | High | M |
| Run `send` to self, `if`, successions and loops in actions | Medium | Medium | M |
| `terminate` and conditional initial transitions | Medium | Medium | S |
| Lose a `when` signal whose guard is false (as time signals are) | Low | Medium | S |
| Seeded, replayable auto-run | Low | Medium | S |
| Warn when concurrent regions write the same variable in one step | Low | Medium | S |
| Skip the animation of a long zero-time run (a Wait stopped at 200 steps animates all of them first) | Low | Medium | S |
| Cross-check the reference traces with an independent executor | Medium | Medium | L |
