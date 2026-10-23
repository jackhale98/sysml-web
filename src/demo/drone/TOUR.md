# A guided tour of the delivery drone

This project models a small quadcopter that delivers parcels of up to 1 kg from a
depot to customers within 3 km, then flies home. It is written in SysML v2, a text
language for describing systems. Every diagram in the app is drawn from this text,
and editing a diagram edits the text.

Follow the stops in order. Each one names the element to open (by its qualified
name, `Package::element`) and what it teaches.

## 1. Start with the world around the drone: `DeliveryContext::deliveryService`

The operator, the ground station, the drone and the recipient, and how they are
connected. This is the "big picture" before any detail.
Diagram: **`DroneViews::serviceContext`** (Interconnection View).

## 2. A stakeholder need: `StakeholderNeeds::'Parcel delivery'`

Needs are written as requirements. The ID `STK-001` is the short name in `<'...'>`,
the statement is the `doc` text, and `stakeholder` records who asked for it.
Status, owner and rationale are metadata (`@StatusInfo`, `@Rationale`). The
requirements table in the app reads exactly these fields.

## 3. A measurable system requirement: `SystemRequirements::'Flight endurance'`

`SYS-001` has a subject (the drone) and a `require constraint` that states the
requirement as a check with units: `drone.endurance >= 25 [min]`. Its subject comes
from `SystemRequirements::DroneRequirement`, a requirement kind that specializes
`EngineeringRequirement`. At the bottom of the file, `#derivation` connections link
each system requirement to the need it comes from.
Diagram: **`DroneViews::requirementTree`**.

## 4. A definition: `DroneComponents::Battery`

A `part def` describes a kind of component, like a datasheet. `Battery`
specializes (`:>`) the abstract `Component`, gives its inherited `mass` a value
(`:>>` redefines it), and computes `usableEnergy` from other attributes, with units
(`216 [W*h]`). Its `port powerOut` is where power leaves it.
Diagram: **`DroneViews::componentCatalogue`**.

## 5. A usage: `DroneArchitecture::drone`

The design is built from usages of the catalogue definitions. The four rotors are named
by where they sit (`frontLeft`, …), because diagonal pairs spin opposite ways, and
`ref part rotors : Rotor[4]` refers to all four: `[4]` is a multiplicity. Compare it with `DroneArchitecture::DeliveryDrone`, the definition
that says what any delivery drone must offer. At the end, `emptyMass` is a mass roll-up,
like a spreadsheet formula that lives in the model.
Diagram: **`DroneViews::droneBreakdown`**.

## 6. Ports, interfaces and flows: `DroneInterfaces::CommandLinkPort`

A port lists what goes out and what comes in. The drone uses `~CommandLinkPort`, the
conjugate (mirror image), so commands that go out of the ground station come in to
the drone. `DroneInterfaces::CommandLink` is a reusable connection that carries both
flows. In `DroneArchitecture::drone`, see how power, commands and sensor signals are
connected, and in `DroneComponents::Rotor` how `bind` passes a port through to a
nested part.
Diagram: **`DroneViews::droneInterconnection`**.
To put a diagram in a document or on a slide, use **Export** in its toolbar: SVG
for documents, PNG for slides, or copy it straight to the clipboard.

## 7. The mission: `DeliveryMission::DeliverParcel` and `DeliveryMission::DeliveryFlight`

The use case says who is involved and what success means (its `objective`). The
delivery flight says how, step by step: `then` for the next step, `fork`/`join` for
steps at the same time, and `decide`/`merge` for a choice (drop the parcel only if
the drop zone is clear).
Diagram: **`DroneViews::deliveryFlightFlow`** (Action Flow View).

Who tells whom what, and when: `DeliverySequence::ParcelDelivery` is the same delivery
as an interaction between the operator, the ground station, the drone and the recipient.
Each `message` says what it carries (`of FlightPlan`), who sends it and who receives it,
and `then` puts it after the one before.
Diagram: **`DroneViews::deliverySequence`** (Sequence View).

## 8. Who does what: `FunctionAllocation`

`DeliveryDrone` performs the delivery flight (`perform`). `allocate` then assigns each
step to the component responsible: the camera checks the drop zone, the latch
releases the parcel, the flight controller does the rest.

## 9. Flight modes: `FlightControl::FlightModes`

A state machine: idle, armed, flying, returning home, landing, charging and
failsafe. Each transition says what triggers it (`accept LinkLost`), an optional
guard (`if preflightChecksPassed`) and where it goes. Time matters too:
`accept after 5 [SI::min]` fires 5 minutes after the state was entered, and its
`do assign stateOfCharge := ...` uses up some of the battery each time.
`accept when stateOfCharge < ...` fires on its own when the battery runs low, and
on the ground `charging` adds charge every 10 minutes until the drone is ready.
The flight controller runs it (`exhibit state` in `DroneComponents::FlightController`).
Diagram: **`DroneViews::flightModeStates`**.

Run it from **Simulations**: switch `preflightChecksPassed` on, press
`ArmCommand` and `TakeOffCommand`, then **Step**. Each Step lets time pass to the
next timer, so the clock goes 5, 10, 15 minutes and the charge goes down until the
drone turns home. Press `ArrivedHome` and `TouchDown`, then Step (or **Wait**)
until it has charged and is idle again.

## 10. Meeting the requirements: `RequirementSatisfaction` and `DronePerformance`

`satisfy 'Battery protection' by drone.battery` assigns each requirement to the part
responsible. `DronePerformance::HoverEndurance` is a calculation with units, and the
analyses `massBudget` and `enduranceBudget` state the margins: 0.23 kg below the
mass limit and 2.5 minutes above the endurance target.

## 11. Budgets and checks: `DroneViews::designChecks`

Because the requirements state their limits as constraints with units, the app can check
them against the design. `satisfy 'Flight endurance' by drone` binds the requirement's
subject to `drone`, so `drone.endurance >= 25 [min]` is evaluated with the drone's values:
216 W·h × 0.85 / 400 W = 27.5 minutes, so it is **satisfied**, with 2.5 minutes to spare.
Change `hoverPower` in `DroneArchitecture::drone` to `450 [W]` and the check turns
**violated** and shows up under Problems; Undo puts it back. The take-off mass check is
met with 0.23 kg to spare (3.77 kg of 4 kg). Tables: **`DroneViews::droneMassBudget`** adds up what each part weighs (2.77 kg
empty) and **`DroneViews::dronePowerBudget`** what each part draws in hover (397 W).

## 12. Proving it: `DroneVerification::enduranceFlightTest`

A verification case names what it tests (its subject), what it verifies (its
objective), the method (`@VerificationMethod`) and how the verdict is decided.
Diagram: **`DroneViews::requirementCoverage`**. This table shows the gaps left in on
purpose: nothing satisfies or verifies `'Ingress protection'` (SYS-005) or
`'Acoustic noise'` (SYS-006), and `'Controlled parcel release'` (SYS-011) is not
verified yet.

## 13. What could go wrong: `DroneFmea`

Risk management in the terms of ISO 14971, with the risk libraries in `libraries/`.
Follow one thread through it:

1. **Hazard**: `payloadDrop`, the parcel falling from height.
2. **Hazardous situation**: `parcelOverPeople`, the parcel coming loose above someone
   at the drop zone (a `Causation` connection leads from the hazard to it).
3. **Harm**: `impactInjury`, critical (8 on the severity scale), at the end of the chain.
4. **Risk controls**: requirements on the hazard. `RC-005 Release height interlock` is
   safe by design (the hook cannot open above 2 m); `RC-007 Drop-zone clearance check`
   is a protective measure. Other hazards have a guard (`RC-004 Propeller guards`) and
   information for safety (`RC-006 Hand-over warnings`).
5. **What implements each control**: a `satisfy` from a part (`drone.payloadRelease`)
   or a `Mitigation` action (`dropZoneScan`, in progress).
6. **What verifies it**: a verification case in `DroneVerification` (`releaseInterlockTest`).

Each `@Fmea` line rates one failure mode of one component, names its hazard and the
controls that address it, and keeps its ratings before the controls. The RPN and its
band, the action priority and the acceptability under the risk policy (the
`Acceptability` calc in `libraries/RiskAnalysis.sysml`) are calculated, never typed in.

Two controls are deliberately not verified yet: `RC-003 Navigation integrity monitoring`
(the hazard log shows the gap for `flyAway`) and `RC-007 Drop-zone clearance check`. So the
camera's line, "A person under the drop point is not seen", is still unacceptable and of
high priority with no verified control: it is listed under **Problems** as a review item.

A reviewer opens **`DroneViews::fmeaWorksheet`** and uses the quick reviews above it
(**High priority**, **Unacceptable**, ...) or **Filter** to see only what still needs work,
then **Save as a view**: **`DroneViews::fmeaReview`** is such a saved review (the lines the
policy says to reduce). **`DroneViews::riskReduction`** shows the risk before and after the
controls, **`DroneViews::riskMatrix`** the lines by severity and likelihood coloured by the
policy (its **Risk policy** button changes the zones), and **`DroneViews::hazardLog`** each
hazard with its situations, harms, controls and what implements and verifies them.

## 14. Documents for review: `DroneViews::droneSpecification`

Not everyone who reviews the design reads SysML. A report is a view too: it puts
what it exposes into a document. `droneSpecification` lists the needs and
requirements with their attributes, what satisfies and verifies each one, and
the gaps; `DroneViews::droneInterfaceControl` describes the connections, interfaces
and ports between the drone's parts. Print them, save them as PDF, or download
them as HTML or Markdown to send round. Report: **`DroneViews::droneSpecification`**.

## 15. Choosing between designs: `BatteryTrade::batteryTradeStudy`

Is today's battery the right one? A trade study compares alternatives and picks one by
an objective. The alternatives are the battery the design flies (`drone.battery`) and
three candidate packs, the variants of `BatteryTrade::batteryOptions`. The evaluation
function works out what each pack gives the drone (its take-off mass, hover power,
endurance, margin to the 4 kg limit and price) and `BatteryTrade::BatteryScore`
weighs them: endurance 50 %, mass margin 20 %, price 30 %. The objective,
`MaximizeObjective`, selects the semi-solid-state pack (0.59), well ahead of today's
(0.39), though it costs almost three times as much; the three-cell pack would put the
drone over 4 kg and scores nothing. Raise the semi-solid-state pack's `price` to
`2500.0` and today's battery comes out on top; Undo puts it back.
Table: **`DroneViews::batteryTrade`**.

## 16. What depends on what: `DroneViews::droneDsm`

A dependency matrix (DSM) lists the drone's parts down the side and across the top.
The cell in the battery's row and the power distribution board's column says the
battery is connected to it; the flight controller's row shows the motor commands it
passes to each rotor. Read across a row for what a part affects, down a column for
what it depends on. The airframe is flagged: nothing is connected to it. Switch
**Suggested modules** on and the parts regroup into power and propulsion and the
avionics; the lightning button beside the battery shows what a change to it may
reach. The view is `view droneDsm : DependencyMatrix` with `expose
DroneArchitecture::drone::*`, from `libraries/DependencyMatrices.sysml`; what it
counts and its order are saved in its text. `DroneViews::droneN2` is the same grid
as an N² chart, naming the interfaces and items in each cell;
`DroneViews::deliveryFlightDsm` compares the steps of a delivery flight, and
`DroneViews::requirementDsm` the requirements derived from each need.
Matrix: **`DroneViews::droneDsm`**.
