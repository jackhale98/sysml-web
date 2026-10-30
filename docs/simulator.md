# The state machine simulator

What the simulator (`src/lib/sim/emulator.ts`, run from **Simulations**)
does with a state machine, which parts of SysML v2 it follows, and where the
specifications leave a choice open. References are to the SysML v2.0
specification (Part 1, "SysML") and KerML 1.0, and to the semantic library
packages that ship with the toolkit (`static/toolkit/stdlib`):
`StatePerformances`, `TransitionPerformances`, `Triggers`, `Clocks`,
`Transfers`, `Occurrences` and the Systems Library's `States` and `Ports`.
How actions run, in a machine and as action flows run on their own, is in
[Running actions](action-runs.md); [Several parts
together](#several-parts-together) covers machines that send each other
signals (`src/lib/sim/system.ts`).

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

Entry, `do` and exit actions and transition effects run their steps as
[Running actions](action-runs.md) describes, within the step of the
machine that runs them:

- `assign x := e` changes a variable;
- `if c { … } else if d { … } else { … }` runs the first branch whose
  condition holds;
- `while c { … } until d`, `loop { … } until d` and `for v in seq { … }`
  run their body as the library's `LoopPerformance` and `ForLoopAction`
  say (a loop stops after 1000 passes, with a message);
- `then <step>`, a succession inside the action, runs the step after the
  one before it, and `first a then b` orders named actions (`action a {
  … }`) whatever order they are written in;
- `perform x` (`perform action c : Charge { in amount = 0.25; }`) runs the
  action it names, with its parameters, when the project has it;
- `send new Sig(…) to self` (or to the part that exhibits the machine)
  sends the machine a signal (below); `send new Sig(…) via port` or `to`
  another part sends it to another part, when the parts run together
  ([Several parts together](#several-parts-together));
- `action { … }` runs its steps; a named action with nothing to run (`do
  monitor`) changes nothing the simulator keeps.

SysML performs the actions of a body that no succession orders
concurrently; the simulator takes the written order, so `assign y := 5;
if x > 5 { assign y := 7; }` leaves 7 when `x` is above 5. A whole action
runs within one step of the machine, so an `accept` inside it cannot wait:
the action ends there, the steps after it are not run, and the machine says
so before it runs and when it happens. A `send` to another part or through a
port is run only when the machine runs with its part's neighbours; a machine
run on its own says it is not sent.

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
v : Integer default 5; }`). An event sent with its button carries the
defaults; the sliders button beside it opens the signal's attributes, to
send it with values of your own (numbers, true/false, text; a number left
empty keeps the default). The values form is offered for a signal a
transition reads (`accept r : Reading`): only those can make a difference.
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
- A condition may read the clock: `localClock.currentTime`,
  `universalClock.currentTime` or `Time::universalClock.currentTime` (every
  occurrence's `localClock` defaults to the `universalClock`,
  `Occurrences`; its `currentTime` advances with time, `Clocks::Clock`).
  Its value is the simulated time, in seconds. Such a condition turns true
  as time passes, so it is due like a timer: `accept when
  localClock.currentTime >= 30 [SI::s]` fires at 30 s on a Step or a Wait,
  and the transition shows "turns true at 30 s" before then. The simulator
  works out when from each comparison with the clock (`currentTime >=
  start + 30 [SI::s]` with `start` a variable is due at its value + 30 s); a
  strict comparison (`> 30 [SI::s]`) has no first instant at which it holds,
  so it is taken 1 ms after. A condition that reads the clock in another
  way (inside arithmetic, `currentTime * 2 > t`) is read at each step only,
  as conditions on variables are.
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

## Several parts together

A part (or part definition) with two or more parts, at any depth, that
exhibit a state machine (`exhibit state s : M;`, or `exhibit state s { … }`
with states of its own, in the part, its definition or the definition's
supertypes) is listed in **Simulations** as "machines together". The demo's
`GroundLink::linkTest` is one: the ground station's console commands the
flight controller (`FlightModes`) over a command link.
`toolkit/systems.ts` reads the parts, their ports (their own and their
definitions') and the connections, interfaces and bindings between ports
written in the context or in any part inside it; `sim/system.ts` runs them.
Each part's machine runs as it would alone, with these additions.

**Delivery.**

- `send S via p` is a `SendPerformance` whose sender is the port `p`. A
  port's outgoing transfers go to the ports connected to it by an interface
  (Systems Library `Ports`: `outgoingTransfersFromSelf :>
  interfacingPorts.incomingTransfersToSelf`); the simulator takes plain
  `connect` connections between ports the same way. So the signal goes
  along each connection of `p` to the port at its other end, and to the
  part that port belongs to. A `bind a = b.c` makes one port of two names
  (KerML binding connectors), so a signal reaching `a` reaches `b.c` too,
  and goes on into the part inside.
- `send S to x` names its receiver (`SendPerformance::receiver`, bound to
  its `incomingTransfersToSelf`): the signal goes to the part `x`, found
  from the sending part outwards, or to the part whose port `x` is.
- `accept S via p` takes `S` only if it came in at `p` (the accepter's
  `receiver` is the port). `accept S` with no `via` has the default
  receiver, `this`, its part; SysML does not say in so many words whether
  a transfer to one of a part's ports is also one to the part, and the
  simulator takes it that it is (a port is the part's connection point,
  `Ports::Port`), so `accept S` takes `S` at whichever port it came in.
  A signal a machine sends itself, or one sent with the event buttons,
  comes in at no particular port: any transition that accepts the signal
  takes it.

**Ordering.** Each part keeps its own queue of the signals that came to it
(`Occurrence::incomingTransfers`). A part takes them one per step, in the
order they arrived (`earlierFirstIncomingTransferSort`), after what is ready
without a signal, exactly as [signals a machine sends
itself](#signals-the-machine-sends-itself); signals from other parts and
from itself share that one queue. A signal arrives after it is sent
(`SendPerformance`: `succession self then sentTransfer`), so the receiver
takes it on a later Step, never in the step that sent it. The model gives a
transfer no duration, so it arrives at the same simulated time. An event
sent with a part's buttons comes after the signals already waiting there.

**What is lost.** A signal that reaches no part with a machine is lost when
it is sent, and the Timeline says why: the port is connected to nothing,
the part at the other end has no state machine (the demo's radio, which has
no behaviour, would stop a command on its way to the flight controller in
`deliveryService`), the receiving machine has finished, or the `send` names
no port and no receiver. A signal that reaches a machine but that none of
its transitions accepts when its turn comes is dropped, with a note (no
signal is deferred: SysML v2 has no deferral, and `StatePerformance`'s
accepters take only what they accept).

**Steps and time.** All parts share one clock (every occurrence's
`localClock` defaults to the `universalClock`). A **Step** takes one
run-to-completion step in every part that has something ready now (a
transition without a trigger, a condition that holds, a timer that is due,
a signal waiting). Parts run concurrently; the simulator lists their steps
in the order the parts are written, and since a signal sent in a step is
taken on a later one, that order changes nothing else. When no part has
anything ready, time passes for all of them to the earliest time something
comes due in any of them, and what comes due then fires. **Wait** goes on
that way to its time (and stops after 200 steps if the parts keep moving
without time passing). Variables are set per part (the Variables panel
shows the selected part's), and events are sent to the selected part.

**On screen.** On a wide screen every part's machine is drawn side by side;
on a phone, tabs above the diagram switch between them, each tab with the
part's current state. One Timeline lists each part's steps, each signal
sent (from which part, through which port, to which part and port, with its
values) and each one lost or dropped.

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

- Steps of an action other than those under [Actions](#actions) (an
  `accept`, which cannot wait within a step; a `perform` of an action the
  project does not have): each one is named in the note. A `send` to
  another part or through a port is noted on a machine run alone; it is run
  when its part runs with the others ([Several parts
  together](#several-parts-together)). Actions run on their own, as action
  flows, are in [Running actions](action-runs.md).
- Clocks other than the default one. A model may define its own `Clock`,
  but SysML says only that its `currentTime` advances monotonically, not
  how fast, and `accept after` / `accept at` have no notation for naming a
  clock, so the simulator has nothing to run it by.
- History states and deferred signals: SysML v2 has no notation for them.
- Flows (`flow of X from a.p.x to b.q.x`) between parts do not carry the
  signals a machine sends: a flow is itself a transfer of its item, made
  when the item is available, not a path for `send`. Signals go along
  connections and interfaces.
- A part with multiplicity (`part rotors : Rotor[4]`) runs one machine, not
  one per rotor. A part that exhibits two state machines runs the first,
  with a note.
- A part's own values for its machine's attributes (`exhibit state :>>
  modes { attribute :>> x = 1; }`) are not read; set them in the Variables
  panel.
