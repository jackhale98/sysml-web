# The state machine simulator

What the simulator (`src/lib/sim/emulator.ts`, run from **Simulations**)
does with a state machine, which parts of SysML v2 it follows, and where the
specifications leave a choice open. References are to the SysML v2.0
specification (Part 1, "SysML") and KerML 1.0, and to the semantic library
packages that ship with the toolkit (`static/toolkit/stdlib`):
`StatePerformances`, `TransitionPerformances`, `Triggers`, `Clocks` and the
Systems Library's `States`.

## Steps

The simulator runs one run-to-completion step at a time:

- **An event** (a signal such as `ArmCommand`) fires the transitions that
  accept it, at the current time. Signals match by their last name.
- **Step** fires what is ready now: transitions without a trigger,
  guard-only ones, change triggers (`accept when …`) whose condition holds
  and time triggers (`accept after …`, `accept at …`) that are due. If
  nothing is ready, time passes to the next timer and what comes due then
  fires.
- **Wait** lets time pass, by an amount or to the next timer. On the way,
  everything that becomes ready fires at its own time, one step after
  another, so waiting an hour runs every timer due in that hour.

Within a step, guards and conditions are all read before anything fires;
inner states' transitions come before their ancestors'; transitions without
a trigger come before triggered ones (as UML's completion events do);
and a maximal set of ready transitions that leave different states fires
together, so parallel regions each take their own step. A transition stops
the `do` actions still running in the states it leaves, runs their exit
actions innermost first, runs its effect, then enters its target (entry
actions outermost first, each followed by its `do` action), as in SysML
7.18.3, Transition Usages. `assign x := e` in actions and effects changes
variables; other actions are shown in the timeline only.

## Time

The session keeps the simulated time (from 0 at the start) and when each
active state was entered. The timeline shows the time of each step.

- `accept after d` is the library's `TriggerAfter`: a time signal at the
  time the trigger is evaluated plus `d` (SysML 7.17.8, relative time
  trigger; KerML 9.2.14). An accepter is performed during its source state,
  after the entry action (`StatePerformance`: `entry then middle`; a
  transition does not happen during the entry when `isRunToCompletion`), so
  the simulator evaluates `d` when the state is entered, after its entry
  action. It fires `d` after the state was entered. Leaving and entering the
  state again (a self-transition included) starts it again; transitions
  inside a composite state do not restart the composite's timers.
- `accept at t` is `TriggerAt`: a time signal when the clock reaches `t`
  (the time since the start). One already past when its state is entered
  never comes: `TimeSignal`'s condition is the clock *equal to* the time.
- `accept when c` is `TriggerWhen`: a change signal when `c` turns true, or
  at once if it is true when first evaluated (SysML 7.17.8). Variables only
  change in steps (assignments, or the Variables panel), never by time
  passing alone, so a condition is read at the current time before time
  moves on: a condition an assignment makes true is taken before the next
  timer, wherever it is written.
- A time signal that comes while its transition's guard is false is not
  taken (the guard is part of whether the transition accepts it) and is
  lost: that timer does not fire again until its state is entered again.
- Durations and times are numbers with time units, converted with the
  units the simulator knows: `5 [s]`, `2 [SI::min]`, `1.5 [h]`, or a
  variable holding one. A bare number counts seconds. A duration that cannot
  be worked out (a variable with no value, a unit that is not a time) is
  noted on the step that entered the state and never fires; once you give
  the missing value, it is evaluated again and counts from that moment.

### Two transitions ready at the same instant

When a change trigger and a timer of the same state are both ready at the
same time (say, a condition made true at minute 2 and a timer also due at
minute 2), the specifications do not say which is taken: KerML orders the
signals a state may accept by when they arrive
(`earlierFirstIncomingTransferSort`), and these arrive together; UML leaves
equal-priority conflicts to the implementation (14.2.3.9.4). The simulator
takes the one written first. It adds no rule of its own, such as "change
before time": the timing decides everything else.

## `do` actions

A state's `do` action starts after its entry action and continues while the
state is active; leaving the state stops it if it is still running, before
the exit action (SysML 7.18.1, States Overview; 7.18.3, Transition Usages).
In the simulator:

- A `do` action made only of assignments runs them once, right after the
  entry action, and completes. Running it again as time passes would not be
  SysML: an action performs its steps once.
- Any other `do` action (a named action, `do monitorTemperature`, a `send`)
  has no steps the simulator can run, so it counts as running until the
  state is left. The timeline shows it started on entry and stopped on
  exit.
- A transition without a trigger waits for the state's substates to finish,
  not for its `do` action: `StateTransitionPerformance` orders the
  transition after the source's `nonDoMiddle` performances (every middle
  performance except `do`), and the transition then stops the `do` action
  if it is still running. SysML v2 has no completion event that waits for
  the `do` action, as UML's does.

To model something that changes with time, such as a battery running down,
use a timed transition with an assignment, as the demo's `FlightModes`
does:

```sysml
state cruising;
transition useCharge first cruising accept after 5 [SI::min]
    do assign stateOfCharge := stateOfCharge - 0.15 then cruising;
```

Putting the self-transition on a substate keeps the outer state, and its
running `do` action, active while the charge goes down.

## Not supported

- The steps inside a `do`, entry or exit action other than assignments
  (`send`, `accept`, successions, loops).
- Signals sent by `send` actions to the machine itself: send events with the
  buttons.
- Change triggers that read the time, and clocks other than the default
  one.
- History states, `terminate`, deferred signals.
