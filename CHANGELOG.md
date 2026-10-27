# Changelog

What changed in each release of Tessera. Versions are `MAJOR.MINOR.PATCH`
(`package.json`); while the major version is 0, a minor version adds or
changes features and a patch only fixes. Each release is a git tag `vX.Y.Z`
made by the Release workflow ([CONTRIBUTING.md](CONTRIBUTING.md#releases)).
Settings → About shows the version, the commit and the build date of the
copy you are running.

## Unreleased

- Fairtide is now **Tessera**: a new name, logo, loader and app icons.

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
