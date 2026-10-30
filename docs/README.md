# Tessera documentation

What each document is for, and who it is for. New to Tessera? Start with the
[user guide](user-guide.md), or open the live app at
<https://tessera-engineering.com/> and take the demo's tour.

## For people using Tessera

- [User guide](user-guide.md): starting a project, the ideas of SysML in plain
  words, how to do the common jobs, keyboard shortcuts and where your data is
  kept. It is the same text as **Help** in the app (it is generated from it).

## For modellers writing SysML by hand, or another tool reading it

- [Risk analysis](risk-analysis.md): the `RiskAnalysis` and `HazardAnalysis`
  libraries behind FMEA worksheets, hazard logs and the risk matrix; the risk
  policy; reviews saved as views.
- [Dependency matrices](dsm.md): the `DependencyMatrices` library behind DSMs
  and N² charts; links, suggested modules and change impact.
- [Table rendering](table-rendering.md): the `@TableRendering` convention that
  turns any SysML view into a table.
- [Variants and configurations](variants.md): variation points, product lines
  and configurations in standard SysML; showing one configuration, the
  variability matrix and the problems Tessera reports.
- [Requirements, verification results and conventions](verification.md): the
  coverage rule, `@VerificationResult` and when a result is out of date,
  reports that name their commit, change impact, and `@Convention` views.
- [State machine simulator](simulator.md): what the simulator does with a state
  machine, its simulated clock and `do` actions, and where the specification
  leaves a choice open.
- [Model interchange](interchange.md): `.kpar`, SysML v2 JSON and Systems
  Modeling API servers; what round-trips, how Save to server merges, and what a
  server must allow.

## For developers

- [Contributing](../CONTRIBUTING.md): setting up, the tests and their
  conventions, making a change and cutting a release; the
  [changelog](../CHANGELOG.md) and [security policy](../SECURITY.md).
- [Plan](PLAN.md): product principles, architecture, what is built, what is
  next and the decision log.
- [The engine](engine.md): how the app uses the Open-MBEE sysml-toolkit, piece
  by piece, and the requests for its maintainers.
- [Performance](performance.md): how large models are measured, the results and
  the remaining limits.
- [Interchange reference](reference/interchange.md): research notes on the
  standards (KerML clause 10, `.kpar`, element identity, the Systems Modeling
  API, XMI).
- [Spike: WebAssembly engine](spikes/wasm-engine.md): a dated historical note
  (2026-10-21) about an engine the app no longer uses.

## Assessment

- [Robustness and MBSE assessment](assessment/README.md): what Tessera
  demonstrably supports and how robustly, section by section, with the
  evidence, the scores and every critical finding and its fix:
  [language coverage](assessment/01-language.md),
  [text, diagrams and round trips](assessment/02-round-trip.md),
  [import, export and interoperability](assessment/03-interchange.md),
  [MBSE coverage](assessment/04-mbse.md),
  [simulation](assessment/05-simulation.md),
  [calculations and trade studies](assessment/06-calculations.md),
  [requirements, risk and verification](assessment/07-requirements-risk.md),
  [data integrity, Git and recovery](assessment/08-data-integrity.md),
  [software quality](assessment/09-quality.md),
  [performance, usability and deployment](assessment/10-performance-usability.md).
- [Interop tools](interop-tools.md): the OMG pilot implementation and SysON,
  run as checkers of Tessera's output.

## For self-hosters

- [Sign in with GitHub](setup-github-sign-in.md): the GitHub App and the
  Cloudflare worker behind "Sign in with GitHub" on your own deployment.
- Running, testing and deploying the site: the [README](../README.md).
