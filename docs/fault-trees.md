# Fault trees and the reliability budget

Tessera's fault trees and reliability budgets are ordinary SysML v2, like
its FMEA worksheets and hazard logs ([risk-analysis.md](risk-analysis.md)).
Two more libraries say what the words mean:

- `FaultTreeAnalysis` (`libraries/FaultTreeAnalysis.sysml`): top,
  intermediate and basic events, gates, the tolerable probability of a top
  event, the fault tree diagram and three tables.
- `Reliability` (`libraries/Reliability.sysml`): failure rates, the FIT
  unit, the reliability requirement and the reliability budget.

The demo's copies are the only copies in the code. A project gets them in
its `libraries/` folder with the risk libraries, the first time it makes an
FMEA or a hazard (`src/lib/create/riskLibraries.ts`); from then on they are
the project's own. Both pass the OMG pilot implementation's checks
(`tools/interop/pilot-check.sh src/demo/drone`: 0 errors, and no warnings
from these files).

## How a fault tree is written

```sysml
occurrence droneFalls : TopEvent {
    :>> gate = GateKind::'or';
    ref :>> hazard = uncontrolledDescent;      // a HazardAnalysis::Hazard
    :>> exposureTime = 30 [min];               // probabilities are over this time
}
occurrence batteryRunsFlat : IntermediateEvent { :>> gate = GateKind::'and'; }
occurrence motorStops : BasicEvent {
    :>> failureRate = 8000 [FIT];
    ref :>> component = drone.rotors.motor;
    :>> failureMode = "Motor stops or loses torque";
}
occurrence lowCharge : BasicEvent { :>> probability = 0.02; }

connection : Causation connect motorStops to lossOfThrust;
connection : Causation connect lossOfThrust to droneFalls;
```

| Definition | What it is |
| --- | --- |
| `occurrence def TopEvent :> GateEvent` | The undesired event a tree is about. `hazard` names the hazard it is; `tolerableProbability` the most probability it may have; `exposureTime` the time its probability is over (and its basic events', where they give none). |
| `occurrence def IntermediateEvent :> GateEvent` | An event between the top and the basic events. |
| `abstract occurrence def GateEvent :> FaultEvent` | An event with a `gate` (`'and'`, `'or'`, `atLeast`, `inhibit`; `'or'` by default) and, for `atLeast`, `k`. |
| `occurrence def BasicEvent :> FaultEvent` | A failure, an error or a condition: its `probability`, or a `failureRate` and an `exposureTime`; the `component` that fails and its `failureMode`. |
| `occurrence def UndevelopedEvent`, `ConditioningEvent :> BasicEvent` | An event not developed further (a diamond), and the condition of an inhibit gate (an oval). |
| `abstract occurrence def FaultEvent :> RiskEvent` | Any event of a tree, with a `description`. |
| `enum def GateKind` | `'and'`: all its causes; `'or'`: any one; `atLeast`: at least `k` of its `n` causes (a voting gate); `inhibit`: its cause while its condition holds. |
| `calc def TolerableProbability` | The policy: the most probability a top event may have by the worst severity of its hazard's harms (by default 1E-6 for catastrophic, 1E-5 critical, 1E-4 serious, 1E-3 minor, 1E-2 negligible). The organisation's choice, like the risk policy. |
| `view def FaultTreeDiagram` | The tree of each top event the view exposes, drawn top-down. |
| `view def FaultTreeSummary` | One row per top event: hazard, probability, upper bound, tolerable, margin, verdict, number of cut sets and the smallest's order. |
| `view def MinimalCutSets` | The minimal cut sets of each top event, most likely first, with their probability and share. |
| `view def BasicEventImportance` | Each basic event with its component, failure mode, probability, Fussell-Vesely and Birnbaum importance, and whether the FMEA has its failure mode. |

### Why this shape

The choice that matters is where the gates go. Fault tree tools draw a gate
as a symbol of its own, and RAAML 1.0 (a SysML v1 profile) makes gates
elements. Here a gate is an attribute of the event above it, and the tree
is `Causation` connections from each cause to its effect:

- **Every event above the basic ones has exactly one gate.** That is how
  IEC 61025 and the NUREG-0492 handbook draw trees, so nothing is lost by
  putting the gate on the event: `gate = 'and'` reads "this happens when
  all its causes do".
- **It is the causal graph the hazard log already has.** `HazardAnalysis`
  links hazard → hazardous situation → harm with `Causation`; its doc
  anticipated that "an FTA is this causation graph plus gate semantics". A
  fault tree below a hazard continues the same chain with the same links.
- **It reads plainly in another tool.** A SysML v2 tool that has never heard
  of Tessera sees occurrence usages, each with a value saying how its
  causes combine, and connection usages typed by a library connection def.
  There are no gate elements with ports to wire, no metadata to interpret
  and no notation outside the language. Separate gate elements would have
  doubled the elements and the connections, and made a reader walk event →
  gate → event.
- **A repeated event is one element.** A failure under two gates (a common
  cause, such as a power board feeding both the rotors and the flight
  controller) is one occurrence with two connections, so the analysis
  knows it is the same event and counts it once. Trees that copy an event
  under each gate (and match them by name) are a classic source of wrong
  answers.
- **The links to the rest of the risk work are references.** A top event's
  `hazard` names a `Hazard`, as an FMEA line's does; a basic event's
  `component` names the part usage that fails, and its `failureMode` the
  failure mode as the FMEA line about that part names it. The app matches a
  basic event to the FMEA line about the same element (or the same usage
  reached another way: `drone.rotors.motor` and `drone::rotors::motor` are
  both `Rotor::motor`) with the same failure mode, and shows whether there
  is one.

Priority-AND gates are left out: their answer depends on the order events
happen in, which a cut set analysis can't give. An inhibit gate is an AND
whose condition is drawn apart.

### Probabilities

A basic event's probability is, in order: its `probability`; else
p = 1 − e^(−λt) from its `failureRate` λ (else its `component`'s) and its
`exposureTime` t (else its top event's). λ and t are evaluated with their
units, so `8000 [FIT]` over `30 [min]` and `8E-6 [h^-1]` over `0.5 [h]`
give the same 4E-6. An event with neither is a problem (see below).

## What the app works out

`src/lib/engine/faultTree.ts`, pure functions tested against hand-worked
examples (`faultTree.test.ts`):

- **Minimal cut sets**, built bottom-up from the leaves (the sets MOCUS
  finds): an OR's are its inputs' together, an AND's every union of one of
  each, a k-of-n's those of every k inputs; after each gate the sets that
  contain another are dropped. Because a repeated event is the same id in
  each set, A·A = A and A + A·B = A hold.
- **The top event's probability, exactly**, from a binary decision diagram
  of the tree (Shannon decomposition), basic events independent. The
  rare-event approximation (the sum of the cut sets' probabilities) and the
  min-cut upper bound, 1 − Π(1 − P(cut set)), are shown beside it,
  labelled. For (A + B)·(A + C) with every p = 0.1 the answer is 0.109;
  multiplying up through the gates gives 0.19² = 0.0361, a third of it,
  because it counts A twice.
- **Importance**: Birnbaum, P(top | event certain) − P(top | event
  impossible); Fussell-Vesely, the probability of the union of the cut sets
  that contain the event over the top event's; and the risk achievement and
  reduction worths. The tables show the first two.

The toolkit side (`src/lib/engine/toolkit/views/faultTrees.ts`) reads the
trees from the model and provides the rows `faultTrees`, `cutSets` and
`basicEvents` ([table-rendering.md](table-rendering.md)) and the drawing.

### Problems

- **A top event more likely than it may be**: its probability is above its
  `tolerableProbability`, else above `TolerableProbability` of the worst
  harm its hazard leads to (through `Causation`). A warning at the top
  event; the summary table marks it violated, the diagram draws it red.
- **A tree that can't be worked out**: a basic event without a probability
  or a failure rate, an event without an exposure time to go with its
  rate, a gate without causes, a `k` that doesn't fit, a loop. A note at
  the top event, saying which.

## The diagram

`view x : FaultTreeDiagram { expose droneFalls; }` (or a package: every top
event in it) opens as a fault tree: events as boxes with their probability,
the gate's symbol under each event above the basic ones (AND, OR, k of n
with its numbers, INHIBIT as a hexagon), circles under basic events,
diamonds under undeveloped ones, ovals under conditions. A repeated event
is drawn under each of its gates with a dashed box. A box selects its
element; above the drawing, each top event's probability, the most it may
be and the verdict. It is drawn as SVG by `src/lib/diagram/FaultTreeCanvas.svelte`
(layout in `faultTreeLayout.ts`), as the sequence diagram is; in another
tool, the view def's `render asTreeDiagram` gives a general tree of the
same elements.

## The reliability budget

```sysml
abstract part def Component {
    attribute failureRate :> Reliability::failureRate [0..1];
}
part def Motor :> Component { attribute :>> failureRate = 20000 [FIT]; }

requirement <'REL-001'> 'Drone reliability' : ReliabilityRequirement {
    :>> minimumMtbf = 2000 [h];
}
satisfy 'Drone reliability' by drone;

view droneReliabilityBudget : Reliability::ReliabilityBudget {
    expose DroneArchitecture::drone::**;
}
```

| Definition | What it is |
| --- | --- |
| `attribute def FailureRateValue :> ISQ::FrequencyValue`, `attribute failureRate` | A failure rate: an inverse time. A part def declares its own with `:> Reliability::failureRate`. |
| `attribute <FIT> failuresInTime` | 1 FIT = 10^-9 h^-1, as a `ConversionByConvention` from hertz. The app's unit table knows it, so FIT and `h^-1` add up and convert. |
| `requirement def ReliabilityRequirement` | `maximumFailureRate` and/or `minimumMtbf`, for the system that satisfies it. |
| `view def ReliabilityBudget` | `rows = "reliability:failureRate"`: the mass budget's rows over the failure rate, with `mtbf` and the requirement's limit, margin and verdict. |

The budget adds the rates up the parts tree like a mass budget (each part's
rate times how many there are). That is the failure rate of a series
system: one that fails when any part fails, each failing independently at a
constant rate; MTBF = 1 / Σλ. Redundant parts are not in series: model them
as an AND gate in a fault tree.

Why the requirement states values rather than a constraint: the system's
failure rate is the budget's sum, which no attribute of the model holds, so
a `require constraint { system.failureRate <= … }` would have nothing to
evaluate (and would need the subject's definition to declare a
`failureRate` it never has a value for). With the limits as values, a
person reads them, another tool shows them, and the app decides the claim
from the budget: the `satisfy` is satisfied or violated with its margin, in
the budget, the requirements table, the design checks and Problems (it
stands for the toolkit's "stated in words only" check of the same claim).
When both limits are given, the tighter shows.

## In the demo

- `system/Components.sysml`: a failure rate on every component (FIT).
- `analysis/Reliability.sysml`: REL-001, an MTBF of at least 2000 h,
  satisfied by `drone`. The budget comes to 215 000 FIT, an MTBF of 4651 h.
- `risk/FaultTree.sysml`: the tree of the hazard "uncontrolled descent",
  per 30-minute flight: an OR of loss of thrust (motor, blade, speed
  controller, power board), loss of control (power board again, software
  lock-up) and the battery running flat (an AND of a low charge and a
  low-battery return that doesn't trigger). Six minimal cut sets, 8.5E-6
  per flight against the 1E-5 the policy allows for its critical harm.
- `views/Views.sysml`: `droneFallsTree`, `faultTreeSummary`,
  `droneFallsCutSets`, `droneFallsImportance`, `droneReliabilityBudget`.

## Limits

- Basic events are independent; common-cause failures are modelled as
  events of their own (as the shared power board is).
- No priority-AND, no dynamic gates, no NOT: trees are coherent.
- The importance table shows Fussell-Vesely and Birnbaum; the worths are
  worked out but not shown.
- The review's budget changes ("Drone power budget: 397 W → 394 W") cover
  `budget:` views only, not the reliability budget yet.
- There is no form to start a fault tree; it is written in the text.
