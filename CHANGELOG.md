# Changelog

What changed in each release of Tessera. Versions are `MAJOR.MINOR.PATCH`
(`package.json`); while the major version is 0, a minor version adds or
changes features and a patch only fixes. Each release is a git tag `vX.Y.Z`
made by the Release workflow ([CONTRIBUTING.md](CONTRIBUTING.md#releases)).
Settings → About shows the version, the commit and the build date of the
copy you are running.

## Unreleased

- Fairtide is now **Tessera**: a new name, logo, loader and app icons.

### Modelling

- **Variants and configurations**: product lines with `variation` points and
  their `variant`s in standard SysML; choose a configuration to see that
  product's bill of materials, budgets, checks and diagrams; a variability
  matrix; Problems flag a point left open, chosen twice, or chosen from
  outside its variants.
- **Use case diagrams**: use cases as ellipses inside their subject's
  boundary, actors outside, `include` arrows; add, connect and delete on the
  canvas (`UseCaseView`, a general view in `ModelViews`).
- **Action flows run** step by step, like state machines: successions,
  decisions with guards, fork, join, merge, loops, `perform`, `accept` and
  `send`, item flows; shown on the action flow diagram.
- **State machines run together**: a part whose parts have state machines
  runs them side by side on one clock, with signals sent through ports and
  along the connections between them; conditions that read the clock; values
  for a signal sent from its event button.

### Analysis

- **Uncertainty**: a value can carry a tolerance or a distribution (normal,
  uniform, triangular), written with the `Uncertainty` library; budgets show a
  likely range and how often the limit is kept, checks say how often they are
  met (Monte Carlo, with first-order and worst-case results alongside).
- **Fault tree analysis**: a `FaultTreeAnalysis` library in plain SysML (top,
  intermediate and basic events, AND, OR, k-out-of-n and inhibit gates), the
  fault tree diagram, minimal cut sets, the exact top event probability and
  importance measures; a top event above its tolerable probability is a
  problem.
- **Reliability budget**: failure rates (FIT) rolled up over the parts to the
  system's failure rate and MTBF, against a reliability requirement.
- **Baselines**: mark a version as a named baseline (PDR, CDR…), kept as a git
  tag on GitHub or a copy in this browser; compare the model with it in one
  click; reports say which baseline they are, or that the model changed since.

### Exchange

- **ReqIF import and export** (`.reqif`, `.reqifz`) for DOORS, Polarion, Jama
  and other requirements tools: attributes, types and relations matched, a
  preview before anything changes, and re-imports that update requirements in
  place rather than adding them again.

### Fixes

- Lines on an interconnection view run to the ports they connect, not to the
  middle of a box's side.
- On a phone a large diagram opens at a readable size, and the state machine
  emulator keeps most of the screen for the machine while it runs.
- An edit no longer redraws a view's diagram afresh, losing its zoom and pan;
  a diagram is placed before it is shown rather than sliding into place.
- A report links the view definition its chapters come from, and each chapter
  the view it is drawn from.
- Every save asks the browser to keep the site's storage for good.
- The diagram toolbar wraps rather than growing wider than its canvas.

## 0.1.0

The first tagged release: everything built from 2026-10-21 to 2026-10-26,
summarised from the git history.

### Modelling

- SysML v2 text editor with completion, hover explanations, go to definition,
  references, rename, formatting and code actions; a plain-language
  explanation of every element.
- Diagrams drawn from the text and editable on the canvas: general,
  interconnection, state, action flow and sequence views; add connected
  elements, hide and show, "view as" another kind, split view with the text;
  export as SVG, PNG or to the clipboard.
- Guided forms that write the SysML: new view, roll-up, limit, trade study,
  FMEA, hazard, dependency matrix, state machines and action flows.
- Explorer, inspector (values editable in place, related elements both ways,
  satisfy and verify pickers), command palette, undo that takes back only its
  own edit.
- Starting points (blank, requirements first, a small system) and the
  delivery-drone demo with its tour.

### Analysis

- Requirements tables, trace and verification matrices, gaps; requirement IDs
  kept through renames, moves and merges; shared IDs warned about.
- Constraint checks with units, budgets that add up values over parts, trade
  studies that rank alternatives with their units.
- State machine simulator with a simulated clock and `do` actions.
- Risk analysis: design, process and use FMEAs, hazards and a hazard log, a
  risk matrix coloured by the project's risk policy, RPN bands, controls and
  mitigations.
- Dependency matrices (DSM and N² charts) with suggested modules and change
  impact.
- Reports: a requirements specification and an interface control document.

### Files and exchange

- Projects kept in the browser with autosave, working offline once visited
  (installable as an app).
- GitHub: sign in or use a token, several accounts, open and save
  repositories, propose changes as pull requests, review what changed in
  plain language, merges that never overwrite.
- Open a folder and save back to it without overwriting files changed on disk.
- `.kpar` archives, SysML v2 JSON, Systems Modeling API servers (with merge on
  save), Excel and CSV import and export.

### Engine and quality

- The Open-MBEE sysml-toolkit (pinned in `toolkit.json`) in a Web Worker;
  restarted once if it crashes; large models measured to 100k lines
  (`docs/performance.md`).
- The robustness and MBSE assessment (`docs/assessment/`), with its fixes.
- Deploys only commits that passed CI; a shipped-dependency audit in CI;
  a Content-Security-Policy; a time limit on engine calls and a warning when
  the engine's memory nears its ceiling; versioned storage formats; the
  commit and build date in Settings → About.
