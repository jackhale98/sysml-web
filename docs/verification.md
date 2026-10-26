# Requirements, verification results and conventions

How Fairtide reads coverage, recorded verification results, change impact
and a project's own modelling conventions from the SysML text, for
modellers writing it by hand and for other tools reading it. Everything
here is ordinary SysML v2, checked with the OMG pilot implementation
([interop tools](interop-tools.md)).

## Coverage: one rule

The home page, the requirement tables (`satisfied`, `verified` and the
Requirement gaps view, see [table rendering](table-rendering.md)) and the
specification report count coverage the same way:

- A requirement is **satisfied** when something satisfies it (`satisfy R by
  x`), or when it has been derived into other requirements (`#derivation
  connection { end #original ::> R; end #derive ::> S; }`) and every one of
  them is satisfied, by this same rule.
- **Verified** is the same with `verify` in a verification case's objective.
- **Tests passed** is the same with recorded results (below): every
  verification case that verifies it has a passing result that still holds
  for the model as it is.

A circle of derivations (A derived from B derived from A) covers nothing by
itself, and is a warning under Problems at its first derivation, naming
every requirement in it.

## Verification results

A verification case records what it returned when it was run as metadata
on the case, from the `VerificationResults` library
(`libraries/VerificationResults.sysml`, which a project gets with its first
recorded result):

```sysml
verification <'VC-001'> enduranceFlightTest {
    subject testDrone :> drone;
    objective { verify 'Flight endurance'; }
    return :>> verdict = PassIf(hoverUntilReserve.flightTime >= 25 [min]);
    @VerificationResult {
        verdict = VerdictKind::pass;
        date = "2026-10-20";
        runBy = "A. Engineer";
        commit = "3f2a9c1d0b4e5f60718293a4b5c6d7e8f9012345";
        evidence = "https://example.com/flight-log-17.csv";
    }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `verdict` | `VerificationCases::VerdictKind` | `pass`, `fail`, `inconclusive` or `error` (SysML's own verdicts) |
| `date` | `String` | when it was run, ISO 8601 (`2026-10-20`) |
| `runBy` | `String[0..1]` | who ran it (`by` is a SysML keyword) |
| `commit` | `String[0..1]` | the Git commit of the model it was run against |
| `evidence` | `String[0..1]` | where the evidence is: a link to a test report, a log |

The metadata def restricts what it annotates to verification case usages
(`:> annotatedElement : SysML::VerificationCaseUsage`), so other tools
reject it elsewhere. A case keeps one result: recording a new one in the
app replaces it, and Git keeps the earlier ones. If a case has several, the
latest by date counts.

A requirement's verification is the worst of its cases' results: failed (a
`fail` or `error`), inconclusive, not run (a case without a result),
out of date (all passed, one no longer holds), passed.

### Whether a result still holds

A result names the commit it was run against. It holds while the model is
the same as at that commit; recorded results, the import of their library
and the library file itself don't count as changes, so recording one
result never makes another out of date.

- Connected to GitHub, at the result's commit: it holds unless the model
  has changed since (changes not saved yet count).
- At a later commit: Fairtide reads the result's commit from GitHub once,
  compares its model files with the project's base, and the result holds
  if only results differ.
- Not connected, or the result names no commit: **commit unknown**: it is
  shown as recorded, and said to be unknown.

## Reports name their revision

A report's title page, introduction, printed footer and Markdown name the
version of the model it was made from: `Commit 3f2a9c1 of owner/repo
(main)`, with `, with changes not committed` when the model had changed
since, or `Not committed` for a project that isn't on GitHub.

## Change impact

The review's impact list names, for each requirement (or risk control)
that changed or was removed, what relies on it: what satisfies it (a part
of the design), the mitigations that implement it (`Mitigation` actions
that satisfy it), the verification cases that verify it, the requirements
derived from it and the FMEA lines whose `riskControls` name it (by the
element the line is about and its failure mode). A rename or move made in
the app carries every reference with it, so it lists none.

The related-elements panel lists an FMEA line both ways: on a risk control,
**Named in the FMEA of** the element the line is about; on that element,
**Its FMEA names** the controls, mitigations and hazard.

## Conventions

A table view marked `@Convention` (from the `Reporting` library) says that
every row it lists breaks a rule of the project. Each row is a problem at
the element it is about:

```sysml
view requirementsWithoutOwner : RequirementsTable {
    @TableRendering { where = "owner == \"\""; }
    @Convention { rule = "Every requirement names its owner."; }
}
```

`rule` is the message (`message` is a SysML keyword); `severity =
ConventionSeverity::error` (or `note`) sets how much it matters, a warning
otherwise. The view's `rows`, `expose` and `where` say what to look at, so
any table Fairtide can show can be a convention. A view that can't be shown
is a problem of its own; one convention lists at most 100 problems.

Conventions are checked in the app, with the other checks. Nothing blocks a
commit or a pull request on them yet.

## Libraries across projects

The libraries a project uses (`RiskAnalysis`, `HazardAnalysis`,
`DependencyMatrices`, `ModelViews`, `Reporting`, `VerificationResults`) are
copied into its `libraries/` folder on first use and become its own: a
project's risk policy is written in its copy. A fix to a library reaches a
project only by copying it in by hand; nothing says a copy is out of date.
A reference to a shared, versioned library (a `.kpar` or a Git repository a
project names, with an "update available" notice that merges the new
version into the project's changes) is the design this would take; it is
not built.
