# Running actions

How the simulator runs actions: an action flow run step by step from
**Simulations** (`src/lib/sim/flow-run.ts`, `src/lib/sim/FlowRunner.svelte`),
and the bodies of a state machine's entry, `do` and exit actions and
transition effects (`src/lib/sim/emulator.ts`). Both use the same rules
(`src/lib/sim/flow.ts`, reading the steps with `src/lib/sim/actions.ts`).
References are to the SysML v2.0 specification (Part 1, 7.17 Actions) and to
the semantic library packages that ship with the app
(`static/toolkit/stdlib`): the Systems Library's `Actions` and the Kernel
Semantic Library's `ControlPerformances`. The state machine side is in
[the state machine simulator](simulator.md).

## What is run

Any named action definition or usage, and any use case (a use case is a kind
of action), declared in a package with steps of its own, is listed under
**Simulations** as **Run …**. An action flow diagram of one has a **Run**
button. `#run=Package::Action` in the address opens the runner directly.

The body of the action is read as a graph:

- Every step is a node: an action (`action a { … }`, `action a : A;`), a
  `perform`, an `assign`, a `send`, an `accept`, an `if`, a loop, or a
  control node (`fork`, `join`, `merge`, `decide`), with the action's own
  `start` and `done`.
- `then x;` is a succession from the step declared before it; successions
  do not count as that step, so `then fork; then a; then b;` goes from the
  fork to both `a` and `b`. `first a then b;` orders two named steps;
  `first start;` makes `start` the step the next `then` comes after.
- After a `decide`, `if c then x;` and `else y;` are its branches.
- `flow from a.x to b.y;` (or `flow of T from … to …`) carries the value of
  `a`'s parameter `x` to `b`'s `y` when `a` ends. A `succession flow` also
  orders them; a plain flow does not.
- Parameters and attributes (`in item plan : Plan = flightPlan;`, `out
  attribute ok : Boolean default true;`) are the run's values. A bound or
  default value is worked out when the step that has it starts.

## Steps

A **Step** ends every step that can end now, in the order written, then
passes their tokens on, so the steps they lead to start. The diagram shows
each step as running, waiting or done, and the edges the tokens went along.

- Control nodes take no time (`Actions::ControlAction`: `bind start =
  done`): their tokens go straight through.
- A **fork** starts all its targets (`ForkAction`: every outgoing
  succession has target multiplicity 1..1). A **join** waits for a token
  from every incoming succession (`JoinAction`) and shows how many have
  come (`1 of 2`). A **merge** passes on each token that comes to it
  (`MergePerformance`).
- A **decision** takes exactly one branch (`DecisionPerformance`: the
  outgoing link is "an instance of exactly one of the Successions"): the
  one whose guard holds, or `else` when none does. When none holds and
  there is no `else`, or a guard reads a value that is not given, the token
  waits at the decision and the run says why; give the value under
  **Values** and Step again. When several guards hold, SysML says one is
  taken but not which, so the run asks: it offers each branch. Auto-run
  takes the first written and says so on the timeline.
- A step no succession leads to starts with the action. SysML performs
  steps that no succession orders in any order, or at the same time (7.17);
  within one Step the simulator runs them in the order written. When two of
  them set the same value in one Step, the step carries a note: the order
  is the simulator's choice, so the value left is the last one written.
- A step with steps of its own (an action with a body, a `perform`, an
  action typed by a definition with a body) starts them at once, as a flow
  inside it, and ends in the Step its last one ends. A `perform` (`perform
  drone.deliveryFlight;`, `perform action c : Charge { in amount = 0.25; }`)
  runs the action it names: a definition, a usage, or a usage's
  definition; `in x = e` binds its parameters. While it runs, the diagram
  can show its own flow (the bar above the diagram lists the performed
  actions that are running; it follows the innermost one unless you pick).
- A named action with nothing to run (`action takeOff { doc … }`) takes one
  Step.

## Actions inside a step

- `assign x := e` sets a value of the action, else of the action around it,
  else (in a state machine) a variable of the machine.
- `if c { … } else if d { … } else { … }` runs the first branch whose
  condition holds (`IfThenElsePerformance`).
- `while c { … }` tests `c` before each pass, so a false test runs the body
  no times; `until d` is tested after each pass; `loop { … } until d;` has
  no `while` test, so its body runs at least once (`LoopPerformance`,
  `WhileLoopAction`). One pass per Step.
- `for v in seq { … }` runs once for each value, in order (`ForLoopAction`):
  `1..4`, `(7, 2, 9)`, or one value.
- A loop that makes 1000 passes stops the run there, with a note, in case it
  never ends; a run also stops after 10,000 Steps.

## Signals and time

- `send new Sig(…) to self` (or with no `to`) sends the action itself a
  signal: it waits in the run's queue until an `accept` takes it. A `send`
  to anything else is shown as sent, and is named before the run (nothing in
  the run receives it).
- `accept Sig;` (or `accept r : Sig via p;`) waits for its signal
  (`AcceptAction`). The controls show a **Send Sig** button for each signal
  a step waits for; sending it takes a Step. The values the signal carries
  are its definition's defaults, or the ones it was sent with, readable as
  `r.v`.
- `accept after 5 [s]` waits for the time; `accept at t` for the clock to
  reach `t`; `accept when c` for `c` to hold. Time is simulated: when
  nothing else can happen, a Step lets time pass to the next timed accept.

## In a state machine

A state's entry, `do` and exit actions and a transition's effect run with
the same rules, in one go, within the step of the machine that runs them
(`runBody` in `flow.ts`): a body with loops, `perform`, successions or
control nodes runs as a small flow; one of assignments, `if` and sends runs
in the order written, as before. Because the whole action runs within one
step of the machine, an `accept` in it cannot wait: the action ends there,
the steps after it are not run, and the machine says so (in its notes before
the run, and in a message when it happens). A `perform` runs the action it
names when the project has it; a machine's `do` action that is a name only
(`do action followFlightPlan;`) still counts as running until its state is
left.

## What is not run

The runner lists what it will not run as written above the diagram ("may not
run as written") before the run starts:

- steps it cannot run (`terminate`, statements it does not read), named;
- a `perform` of an action the project does not have (it runs as one step);
- a `send` to something outside the action;
- guards, conditions and values the expression reader does not support;
- successions to a step the action does not have.

Not supported: streaming flows (a value carried while its source still
runs), `flow`s between ports of parts, `terminate` inside an action flow,
and the state machines of other parts (a `send` to a part is not delivered
to its machine).
