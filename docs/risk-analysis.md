# Risk analysis: the FMEA and hazard libraries

Fairtide's FMEA worksheets, risk matrices and hazard logs are ordinary
SysML v2. Two libraries say what the words mean, and the app's forms only
write text that uses them:

- `RiskAnalysis` (`libraries/RiskAnalysis.sysml`): FMEA lines, their
  ratings, the risk priority number and the action priority, and the
  worksheet views.
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
| `metadata def Fmea` | One FMEA line, attached to the element that can fail: `@Fmea about drone::battery { … }`. Fields: `failureMode` (for a use FMEA, the use error), `effect`, `cause`, `category` (the kind of FMEA, `design` by default), `severity`, `likelihood`, `detection`, the optional `preventionControls` and `detectionControls` (what is in place, which justifies the likelihood and detection), the optional `initialSeverity`, `initialLikelihood` and `initialDetection` (the assessment before risk reduction) and `hazard` (the hazard the failure can lead to). |
| `attribute def FmeaRating :> Integer` | A rating of 1 to 10, with `assert constraint inRange { that >= 1 and that <= 10 }`. |
| `enum def RiskCategory` | The kind of FMEA a line belongs to: `design` (DFMEA: a part fails), `process` (PFMEA: a process step goes wrong), `'use'` (uFMEA: a user makes a use error or misuses the product in a foreseeable way), `software` (a design FMEA of software). |
| `calc def Rpn` | severity × likelihood × detection, 1 to 1000. |
| `enum def ActionPriorityLevel` | `low`, `medium`, `high`. |
| `calc def ActionPriority` | The AIAG-VDA action priority table: bands of severity (9–10, 7–8, 4–6, 2–3, 1), then likelihood, then detection, as nested `if … ? … else …`. |
| `occurrence def FailureMode :> RiskEvent` | A failure as an element of its own, for when it takes part in a causal chain. |
| `action def Mitigation`, `enum def MitigationKind`, `enum def MitigationStatus` | The work that implements a risk control (`satisfy`), whether it prevents or detects, and where it stands. |
| `view def FmeaWorksheet` | Every line, highest RPN first, with the category. |
| `view def DesignFmeaWorksheet`, `ProcessFmeaWorksheet`, `UseFmeaWorksheet` | One kind of line each (`where` on the category; a design worksheet takes software lines too), with headings for the kind: part, process step, task and use error. |
| `view def FmeaRiskReduction` | The lines assessed before risk reduction: their RPN and action priority then and now. |
| `view def RiskMatrix` | A count of lines by severity (down) and likelihood (across), every rating shown. |

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
| `view def HazardLog` | One row per hazard: its description, harms, worst severity, controls, and what satisfies and verifies them. |

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

Both are flagged in the cell and listed under Problems (a warning at the
value), and show in the design checks and in review.

- **A value its type rejects.** A metadata field's value must meet the
  asserted constraints of the type the field is declared with: an
  `FmeaRating` of 14 is outside `that >= 1 and that <= 10`. The rule is
  the library's constraint, evaluated with `that` bound to the value; a
  calc whose argument breaks its parameter's type (the RPN of that line)
  has no result.
- **Severity from the hazard.** An `@Fmea` line whose `hazard` leads,
  through `Causation` connections, to harms with a severity should have
  the worst of their `SeverityScale` values as its `severity`.

## How another tool reads it

Everything is in the text, in standard SysML v2:

- The lines are metadata usages typed by `RiskAnalysis::Fmea`, annotating
  the element that can fail. Their values are the metadata's features;
  a field left out has the metadata def's default.
- The RPN and the action priority are calc defs a tool can evaluate with
  the line's ratings; nothing derived is stored.
- The hazards, situations and harms are occurrence usages; their links are
  connection usages typed by `Causation`; the controls are requirement
  usages typed by `RiskControl`, linked with `satisfy` and `verify`.
- The worksheets, the matrix and the hazard log are view defs with a
  `@TableRendering` (`Reporting`), the convention documented in
  [table-rendering.md](table-rendering.md): `rows = "@Fmea"` with
  columns that invoke the calcs, `where` on the category, a `pivot` over
  two bounded ratings, and `rows = "hazards"` for the hazard log.
