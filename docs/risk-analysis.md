# Risk analysis: the FMEA and hazard libraries

Fairtide's FMEA worksheets, risk matrices and hazard logs are ordinary
SysML v2. Two libraries say what the words mean, and the app's forms only
write text that uses them:

- `RiskAnalysis` (`libraries/RiskAnalysis.sysml`): FMEA lines, their
  ratings, the risk priority number and its bands, the action priority,
  the organisation's risk policy (acceptability), and the worksheet views.
- `HazardAnalysis` (`libraries/HazardAnalysis.sysml`): hazards, hazardous
  situations, harms, the causal links between them, risk controls and the
  hazard log.

The demo's copies (`src/demo/drone/libraries/`) are the only copies in the
code. A project gets them in its `libraries/` folder the first time it
makes an FMEA or a hazard (with `Reporting`, which the views use, if it
lacks it); from then on they are the project's own, to read and change
like any SysML. The tables and checks read the libraries from the
project, so a change there (another rating scale, another column) changes
what the app shows.

They follow the AIAG-VDA FMEA handbook (2019) for the ratings and the
action priority, ISO 14971 for hazards, harms and risk control, and
IEC 62366 for use errors.

## RiskAnalysis

| Definition | What it is |
| --- | --- |
| `metadata def Fmea` | One FMEA line, attached to the element that can fail: `@Fmea about drone::battery { … }`. Fields: `failureMode` (for a use FMEA, the use error), `effect`, `cause`, `category` (the kind of FMEA, `design` by default), `severity`, `likelihood`, `detection`, the optional `preventionControls` and `detectionControls` (what is in place, as words, which justifies the likelihood and detection), the optional `initialSeverity`, `initialLikelihood` and `initialDetection` (the assessment before risk reduction), `hazard` (the hazard the failure can lead to), `riskControls` (the `RiskControl` requirements that address it) and `mitigations` (the `Mitigation` actions that lower it). |
| `attribute def FmeaRating :> Integer` | A rating of 1 to 10, with `assert constraint inRange { that >= 1 and that <= 10 }`. |
| `enum def RiskCategory` | The kind of FMEA a line belongs to: `design` (DFMEA: a part fails), `process` (PFMEA: a process step goes wrong), `'use'` (uFMEA: a user makes a use error or misuses the product in a foreseeable way), `software` (a design FMEA of software). |
| `calc def Rpn` | severity × likelihood × detection, 1 to 1000. |
| `enum def RpnBandLevel`, `calc def RpnBand` | The band an RPN falls in: `low`, `medium`, `high`, `critical`, each starting at a threshold the calc states as an attribute (`mediumFrom = 51`, `highFrom = 151`, `criticalFrom = 401`). |
| `enum def RiskAcceptability`, `calc def Acceptability` | The risk policy: `acceptable`, `reduce` (as far as possible) or `unacceptable`, by severity and likelihood (ISO 14971). |
| `enum def ActionPriorityLevel` | `low`, `medium`, `high`. |
| `calc def ActionPriority` | The AIAG-VDA action priority table: bands of severity (9–10, 7–8, 4–6, 2–3, 1), then likelihood, then detection, as nested `if … ? … else …`. |
| `occurrence def FailureMode :> RiskEvent` | A failure as an element of its own, for when it takes part in a causal chain. |
| `action def Mitigation`, `enum def MitigationKind`, `enum def MitigationStatus` | The work that implements a risk control (`satisfy`), whether it prevents or detects, and where it stands. |
| `view def FmeaWorksheet` | Every line, highest risk first, with its RPN and band, action priority, acceptability, risk controls and the category. |
| `view def DesignFmeaWorksheet`, `ProcessFmeaWorksheet`, `UseFmeaWorksheet` | One kind of line each (`where` on the category; a design worksheet takes software lines too), with headings for the kind: part, process step, task and use error. |
| `view def FmeaRiskReduction` | The lines assessed before risk reduction: their RPN, action priority and acceptability then and now, their controls, whether those are verified, and their mitigations and status. |
| `view def RiskMatrix` | A count of lines by severity (down) and likelihood (across), every rating shown, each cell with its zone in the risk policy (`cellLevel`). |

The ratings, in the app's words (the forms show them):

- **Severity**: how bad the effect is. 1 no noticeable effect … 7 the main
  function works less well, 8 it is lost, 9 breaks a law or regulation,
  10 can hurt someone.
- **Likelihood** (AIAG-VDA's occurrence): how likely the cause is. 1
  cannot happen (prevented by design) … 10 almost certain.
- **Detection**: how likely the failure is to slip through. 1 always
  caught … 10 cannot be detected before it reaches the user.

A worksheet of one FMEA is a view that exposes the package of its lines:

```sysml
package DroneDesignFMEA {
    private import RiskAnalysis::*;
    private import DroneArchitecture::drone;

    @Fmea about drone::battery {
        failureMode = "Thermal runaway";
        effect = "Fire in the airframe";
        cause = "Internal cell short";
        category = RiskCategory::design;
        severity = 8; likelihood = 3; detection = 6;
        hazard = DroneFmea::batteryFire;
    }
}

view droneDesignFMEA : DesignFmeaWorksheet { expose DroneDesignFMEA::*; }
view droneDesignFMEAMatrix : RiskMatrix { expose DroneDesignFMEA::*; }
```

## The risk policy

Which risks an organisation accepts is its own decision (ISO 14971 asks
for a documented policy). The library states it as a calc, so it is model
content: the risk matrix colours its cells by it, the worksheets have an
Acceptability column computed from it, and a line in its unacceptable
zone is a problem. The default, in the calc's own words:

```sysml
enum def RiskAcceptability {
    enum acceptable;
    enum reduce;        // reduce as far as possible, then weigh what remains against the benefit
    enum unacceptable;
}

calc def Acceptability {
    doc
    /*
     * … In plain words:
     *   severity 9 to 10: unacceptable at likelihood 4 to 10, reduce at 2 to 3, acceptable at 1;
     *   severity 7 to 8: unacceptable at likelihood 6 to 10, reduce at 3 to 5, acceptable at 1 to 2;
     *   severity 4 to 6: unacceptable at likelihood 8 to 10, reduce at 5 to 7, acceptable at 1 to 4;
     *   severity 2 to 3: reduce at likelihood 8 to 10, acceptable at 1 to 7;
     *   severity 1: acceptable.
     */
    in severity : FmeaRating;
    in likelihood : FmeaRating;
    return : RiskAcceptability =
        if severity >= 9 ?
            (if likelihood >= 4 ? RiskAcceptability::unacceptable
             else if likelihood >= 2 ? RiskAcceptability::reduce
             else RiskAcceptability::acceptable)
        else if severity >= 7 ? …
        else RiskAcceptability::acceptable;
}
```

Why a calc of nested conditions rather than, say, a table of thresholds:
it is the same shape as `ActionPriority`, any SysML v2 tool can evaluate
it (the toolkit does, and the tests check its answer in every cell
against the app's), and it can say any zones, not only those a formula
like severity × likelihood allows. People don't need to write it: the
**Risk policy** form paints the grid and writes the calc back, one band of
severities with the same zones per condition, with the doc in plain words.
The form reads the policy by evaluating the calc in every cell, so a calc
written by hand reads back too.

The RPN bands are a calc whose thresholds are attributes, so changing one
is changing a number:

```sysml
calc def RpnBand {
    in rpn : Integer;
    attribute mediumFrom : Integer = 51;
    attribute highFrom : Integer = 151;
    attribute criticalFrom : Integer = 401;
    return : RpnBandLevel =
        if rpn >= criticalFrom ? RpnBandLevel::critical
        else if rpn >= highFrom ? RpnBandLevel::high
        else if rpn >= mediumFrom ? RpnBandLevel::medium
        else RpnBandLevel::low;
}
```

RPN-based review and the AIAG-VDA action priority are both on every
worksheet. Which one a project leads with is the worksheets' own
`@TableRendering`: the order of the two columns and `sortBy` (`"-rpn"`,
or `"-actionPriority; -rpn"`, levels sorting in their declared order). The
form's **Worksheets** step rewrites the library's worksheet defs.

## Risk controls in a line

A line names the risk controls that address it, and the mitigations that
lower it, as model references, like its `hazard`:

```sysml
@Fmea about drone::battery {
    failureMode = "Thermal runaway";
    …
    hazard = batteryFire;
    riskControls = 'RC-001';                 // or ('RC-001', 'RC-004')
    mitigations = batteryManagementSystem;
}
```

A control is written by its ID (its short name) where it has one. Whether
it is implemented and verified is ordinary traceability: what `satisfy`s
it and what `verify`s it. The mitigations of a line are the ones it names
and those that satisfy its controls, each with its `status`. The free-text
`preventionControls` and `detectionControls` stay as AIAG-VDA's "current
controls". A line whose action priority is high, or whose risk is
unacceptable, and none of whose controls is verified, is flagged for
review.

## Reviews saved as views

A worksheet filtered to the lines to review can be saved as a view: a
usage of the same view def, over what the worksheet showed, whose
`@TableRendering` adds a `where`:

```sysml
view fmeaReview : DesignFmeaWorksheet {
    expose DroneFmea::*;
    @TableRendering { where = "Acceptability(severity, likelihood) != RiskAcceptability::acceptable"; }
}
```

A view's `where` narrows the rows of the def it is typed by (the
conditions accumulate, as `filter`s do), so the design worksheet's own
condition on the category still applies. The condition uses the columns'
own expressions, so it needs nothing the app knows.

Why `where` and not SysML v2's `filter`: a view's `filter` is a condition
on each *element* it exposes. An FMEA line is a metadata usage
annotating the part that fails; `filter @Fmea` keeps the parts that have
a line, but not one line of a part rather than another, and
`Fmea::severity >= 8` on a part with two lines has no single value (the
toolkit leaves such a condition undecided, so it keeps everything). The
lines themselves, the metadata usages in the package, are not annotated
by `@Fmea`, so `filter @Fmea` drops them all. The same holds for the
design, process and use worksheets: their condition is on the line's
`category`, so they keep `where` too. Text filters ("effect contains
fire") stay a way of looking: SysML's expression language has no
"contains".

## HazardAnalysis

| Definition | What it is |
| --- | --- |
| `occurrence def Hazard :> RiskEvent` | A potential source of harm, with a `description`. |
| `occurrence def HazardousSituation :> RiskEvent` | When people, property or the environment are exposed to a hazard; `p1` and `p2` are the probabilities that the situation arises and that it leads to the harm (`calc def HarmProbability`). |
| `occurrence def Harm :> RiskEvent` | Injury or damage, with its `severity`. |
| `enum def SeverityScale :> Integer` | How severe a harm is: `negligible = 2`, `minor = 4`, `serious = 6`, `critical = 8`, `catastrophic = 10`, each its value on the FMEA severity scale. |
| `connection def Causation` | From a cause to its effect (`end cause`, `end effect`): hazard → situation → harm, or failure mode → hazard. |
| `requirement def RiskControl` | A requirement that lowers the risk of a `hazard`, with its kind (`hierarchy`) and a `rationale`. What implements it `satisfy`s it, a verification case `verify`s it. |
| `enum def ControlHierarchy` | The ISO 14971 kinds of control, most effective first: `inherentSafety`, `protectiveMeasure`, `informationForSafety`. |
| `view def HazardLog` | One row per hazard: its description, the hazardous situations and harms it leads to, the worst severity, its controls, and what satisfies and verifies them. |

```sysml
occurrence 'Battery fire' : Hazard { :>> description = "Fire or explosion of the pack."; }
occurrence 'Charging indoors' : HazardousSituation;
occurrence Burns : Harm { :>> severity = SeverityScale::critical; }
connection : Causation connect 'Battery fire' to 'Charging indoors';
connection : Causation connect 'Charging indoors' to Burns;
requirement <'RC-001'> 'Thermal cut-off' : RiskControl {
    doc /* The pack shall disconnect before any cell reaches its thermal limit. */
    :>> hierarchy = ControlHierarchy::protectiveMeasure;
    ref :>> hazard = 'Battery fire';
}
satisfy 'Thermal cut-off' by drone::battery;
```

## The rules the app checks

Each is flagged in the cell and listed under Problems (a warning at the
value), and shows in the design checks and in review.

- **A value its type rejects.** A metadata field's value must meet the
  asserted constraints of the type the field is declared with: an
  `FmeaRating` of 14 is outside `that >= 1 and that <= 10`. The rule is
  the library's constraint, evaluated with `that` bound to the value. A
  type that is an `Integer` (as `FmeaRating` is) takes whole numbers only:
  a likelihood of 5.5 is flagged too. A calc whose argument breaks its
  parameter's type (the RPN of that line) has no result.
- **Severity from the hazard.** An `@Fmea` line whose `hazard` leads,
  through `Causation` connections, to harms with a severity should have
  the worst of their `SeverityScale` values as its `severity`.
- **An unacceptable risk.** A line whose `Acceptability(severity,
  likelihood)` is `unacceptable` (at its likelihood).
- **No verified control.** A line whose `ActionPriority` is `high`, or
  whose risk is unacceptable, and none of whose `riskControls` is verified
  (at its `riskControls`).

## How another tool reads it

Everything is in the text, in standard SysML v2:

- The lines are metadata usages typed by `RiskAnalysis::Fmea`, annotating
  the element that can fail. Their values are the metadata's features;
  a field left out has the metadata def's default.
- The RPN, its band, the action priority and the acceptability are calc
  defs a tool can evaluate with the line's ratings; nothing derived is
  stored. The risk policy is the `Acceptability` calc and `RpnBand`'s
  thresholds.
- A line's `riskControls` and `mitigations` are references to requirement
  usages typed by `RiskControl` and action usages typed by `Mitigation`.
- The hazards, situations and harms are occurrence usages; their links are
  connection usages typed by `Causation`; the controls are requirement
  usages typed by `RiskControl`, linked with `satisfy` and `verify`.
- The worksheets, the matrix and the hazard log are view defs with a
  `@TableRendering` (`Reporting`), the convention documented in
  [table-rendering.md](table-rendering.md): `rows = "@Fmea"` with
  columns that invoke the calcs, `where` on the category, a `pivot` over
  two bounded ratings with `cellLevel = "Acceptability(severity,
  likelihood)"`, and `rows = "hazards"` for the hazard log.
