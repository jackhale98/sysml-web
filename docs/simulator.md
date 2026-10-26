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
  accept it, at the current time. A signal matches with or without its
  package (`ArmCommand`, `DroneInterfaces::ArmCommand`); two signals whose
  packages differ (`Commands::Stop`, `Faults::Stop`) are different. While
  something is ready for a Step, events wait: the machine has already left a
  state whose untriggered transition is ready, so the event buttons show
  what fires first, and sending one says to Step first.
- **Step** fires what is ready now: transitions without a trigger,
  guard-only ones, change triggers (`accept when …`) whose condition holds
  and time triggers (`accept after …`, `accept at …`) that are due. If
  nothing is, it takes the oldest signal the machine sent itself (see
  [Signals the machine sends itself](#signals-the-machine-sends-itself)). If
  there is none, time passes to the next timer and what comes due then
  fires.
- **Wait** lets time pass, by an amount or to the next timer. On the way,
  everything that becomes ready fires at its own time, one step after
  another, so waiting an hour runs every timer due in that hour. A Wait
  that takes more than a few steps is shown at once, where it ended, rather
  than animated step by step; one that takes 200 steps without time
  passing stops there and says so.

Within a step, guards and conditions are all read before anything fires;
inner states' transitions come before their ancestors'; transitions without
a trigger come before triggered ones (as UML's completion events do);
and a maximal set of ready transitions that leave different states fires
together, so parallel regions each take their own step. A transition stops
the `do` actions still running in the states it leaves, runs their exit
actions innermost first, runs its effect, then enters its target (entry
actions outermost first, each followed by its `do` action), as in SysML
7.18.3, Transition Usages.

When transitions in different regions fire in one step and their actions
set the same variable, the step carries a note: the regions run at the
same time, SysML leaves the order open, and the simulator runs them in the
order they are written, so the value left is the last one's.

### Initial states

`entry; then a;` enters `a`. Conditional initial transitions
(`entry; if startOn then on; if not startOn then off;`, SysML 7.18.2) are
read when the region is entered, after its state's entry action
(`entry then middle`): the first written whose guard holds is taken. If
none holds, no state in that region is entered, and the step says so (a
machine with nothing entered can do nothing more: it shows as stuck).

### `terminate`

A transition to a terminate action (`accept Abort then stop;` with
`action stop terminate;`) exits its source and runs its effect as any
transition, then ends the machine: the states still active in other
regions are left without their exit actions (their `do` actions stop), and
the run is complete. This follows UML's terminate pseudostate, which SysML
v2's terminate action replaces: the performance ends, it is not exited.

## Actions

Entry, `do` and exit actions and transition effects run their steps in the
order written:

- `assign x := e` changes a variable;
- `if c { … } else if d { … } else { … }` runs the first branch whose
  condition holds;
- `then <step>`, a succession inside the action, runs the step after the
  one before it;
- `send new Sig(…) to self` (or to the part that exhibits the machine)
  sends the machine a signal (below);
- `action { … }` runs its steps; a named action (`do monitor`) changes
  nothing the simulator keeps.

SysML performs the actions of a body that no succession orders
concurrently; the simulator takes the written order, so `assign y := 5;
if x > 5 { assign y := 7; }` leaves 7 when `x` is above 5. Anything else
(`accept`, loops, `perform`, a `send` to another part) is not run, and the
machine says so before it runs.

## Signals the machine sends itself

A `send` to the machine itself (`to self`, or to the part that exhibits it)
puts the signal in a queue. Signals are taken one per step, in the order
sent, after what is ready without one (UML's completion events come first,
14.2.3.9.1): a Step takes the oldest when nothing else is ready, and a
Wait takes them on the way. Events you send wait for the queue: the event
buttons say which signal comes first. A queued signal no transition
accepts is dropped, with a message, as an event would be.

## Signal values

A transition that names the signal it accepts (`accept r : Reading if
r.v > 3 do assign last := r.v then b;`) reads its values in its guard and
effect. The values are the ones it was sent with (`send new Reading(7) to
self`, in the order of the signal's attributes, or `Reading(v = 7)`), else
the defaults the signal's definition gives (`item def Reading { attribute
v : Integer = 5; }`). An event sent with the buttons carries the defaults.
A guard that reads a value the signal does not carry does not hold, and
says which value is missing.

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
- A time or change signal that comes while its transition's guard is false
  is not taken (the guard is part of whether the transition accepts it)
  and is lost (no signal is deferred): a timer does not fire again until
  its state is entered again, and a change trigger not until its condition
  turns false and then true again (`Observation::ObserveChange` sends the
  signal once, when the condition becomes true). The transition shows why.
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

- A `do` action with steps the simulator runs (assignments, `if`, sends
  to the machine itself; see [Actions](#actions)) runs them once, right
  after the entry action, and completes. Running it again as time passes
  would not be SysML: an action performs its steps once.
- Any other `do` action (a named action, `do monitorTemperature`, a `send`
  to another part) has no steps the simulator can run, so it counts as
  running until the state is left. The timeline shows it started on entry
  and stopped on exit.
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

## The Timeline

Each step records why it fired: the event (or the action that sent the
signal), the condition that turned true, the timer that came due and when,
or "completion" for a transition without a trigger; the values its guard
and condition read; and the transitions that were ready too and gave way
to it. **Save the run as CSV or JSON** writes it out: the CSV has one row per
step, the JSON the whole run with the machine's qualified name, file and
line, and, for a project kept in a repository, the repository, branch and
commit its files are based on, with the number of files changed since (0:
the run is of that commit's model), so a run can be filed as evidence for
a requirement or a verification case. Linking a run to them in the model
is not supported.

## Auto-run

Auto-run takes a Step whenever one can happen, else sends a ready event:
the one leading to the states visited least, then the one sent least
often, then the first listed. Nothing is left to chance, so running it
again from the start gives the same run.

## Reachability

Before a run, the simulator reads the machine for states no transition can
reach and transitions that can never fire, and lists them above the
diagram. Guards are taken to be possibly true unless they are constant
(`if false`), so what it lists is unreachable whatever the values, events
and timers; something it does not list may still be unreachable because of
its guards. A transition never fires when its source cannot be reached,
when its guard or `when` condition is constant and false, or when its
source is a simple state with a transition that has no trigger and no
guard: that one is taken as soon as the state is entered, before any
event, timer or condition, and before later untriggered ones.

## Not supported

The simulator lists what it cannot run in a note above the diagram ("may
not run as written") before the run starts.

- Steps of an action other than those under [Actions](#actions)
  (`accept`, loops, `perform`, a `send` to another part or through a
  port): each one is named in the note.
- Change triggers that read the time, and clocks other than the default
  one.
- History states and deferred signals: SysML v2 has no notation for them.
- Values for a signal sent with the event buttons other than its
  definition's defaults.
