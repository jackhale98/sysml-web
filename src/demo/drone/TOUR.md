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

A state machine: idle, armed, flying, returning home, landing and failsafe. Each
transition says what triggers it (`accept LinkLost`), an optional guard
(`if preflightChecksPassed`) and where it goes. `accept when stateOfCharge < ...`
fires on its own when the battery runs low. The flight controller runs it
(`exhibit state` in `DroneComponents::FlightController`).
Diagram: **`DroneViews::flightModeStates`**.

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

A design FMEA. Hazards lead to harms (`Causation`). Risk controls are requirements
on the design. Mitigations are the work that implements them (`satisfy`). Each
`@Fmea` line rates one failure mode of one component. The risk priority number is
calculated from the ratings, never typed in, and so is the action priority (high,
medium or low). Two risk controls are not verified yet. Tables:
**`DroneViews::fmeaWorksheet`**, **`DroneViews::riskMatrix`** (the lines by severity and
likelihood) and **`DroneViews::hazardLog`** (each hazard with its harms and controls).

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
