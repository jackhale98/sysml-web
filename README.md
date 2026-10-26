# Fairtide

A web workbench that makes **SysML v2** approachable. Build a model in text or
in diagrams (both edit the same SysML, live) with a plain-language explanation
of every element, so engineers new to MBSE can model productively. The model is
standard SysML v2 text in your own git repository, readable by any conformant
tool. Fairtide runs in the browser on a computer or a phone, keeps working
offline, and has no server of its own: projects stay in your browser until you
save them to GitHub, a folder or a file.

**Try it:** <https://jackhale98.github.io/sysml-web/> (open the delivery-drone
demo, no sign-up).

What it does today:

- **Text and diagrams, one model.** A SysML editor with completion, hover
  explanations, go to definition, rename and formatting; general,
  interconnection, state, action flow and sequence diagrams drawn from the text
  and editable on the canvas; guided forms that write the SysML for you.
- **Requirements and traceability.** Requirements tables, trace and
  verification matrices, gaps, a specification and an interface control
  document, import from Excel or CSV and export to Excel, CSV, SVG and PNG.
- **Analysis on top of the model.** Requirement checks with units, budgets that
  add up mass or power, trade studies, a state machine simulator with a
  simulated clock, risk analysis (design, process and use FMEAs, hazards and a
  hazard log, a risk matrix coloured by your risk policy) and dependency
  matrices (DSM and N² charts).
- **Your files, your history.** Save to GitHub, propose changes as a pull
  request and review what changed in plain language; open a folder and save
  back to it; exchange `.kpar`, SysML v2 JSON and Systems Modeling API servers
  with other SysML v2 tools.

## Running it

Requires Node 22.17+.

```sh
npm install
scripts/fetch-toolkit.sh  # the SysML engine and its standard library into static/toolkit/
npm run dev               # http://localhost:5173
```

To change Fairtide, see [CONTRIBUTING.md](CONTRIBUTING.md): setup, tests and
their conventions, and releases.

## Testing

```sh
npm test                  # unit tests (Vitest)
npm run check && npm run lint && npm run format:check
npx playwright install chromium   # once, before the first end-to-end run
npm run test:e2e          # Playwright end to end, with axe accessibility checks (builds first)
npm run build && npm run lighthouse   # Lighthouse budgets, mobile and desktop
npm run bench             # performance on generated large models (docs/performance.md)
```

CI (`.github/workflows/ci.yml`) audits the shipped dependencies and runs the
formatting, lint, type checks, unit tests, build and end-to-end tests;
`lighthouse.yml` runs the Lighthouse budgets. The conformance runner needs
`scripts/fetch-conformance.sh` first (CONTRIBUTING.md).

**Browsers.** The end-to-end suite runs in Chromium. `browsers.yml` runs a
smoke set (`smoke`, `landing`, `onboarding`, `phone-layout` and `editor` specs)
in Firefox and WebKit, Safari's engine, not blocking yet; locally,
`PW_BROWSERS=firefox,webkit npx playwright test --project=firefox --project=webkit`
once those browsers are installed (`npx playwright install firefox webkit`).
Firefox has no phone emulation, so it leaves out the phone tests. Opening a
folder works only in Chrome and Edge, as the app says.

## Deploying

Each push to `main` whose CI passes is built and published to GitHub Pages
(`.github/workflows/deploy.yml`, with `BASE_PATH=/sysml-web`); a commit whose CI
failed is never published. Releases are tagged by hand
([CONTRIBUTING.md](CONTRIBUTING.md#releases), [CHANGELOG.md](CHANGELOG.md)).
The site is plain files, so any static host works:
`BASE_PATH=/your/path npm run build` and serve `build/`, falling back to
`404.html` for unknown paths.

The pages carry a Content-Security-Policy (`src/app.html`): scripts only from
the site, any https host for connections (GitHub, the sign-in worker and the
Systems Modeling API servers people enter). A host that sends its own policy
header must allow at least the same, including `'wasm-unsafe-eval'` for the
engine and `'unsafe-inline'` for SvelteKit's start-up script.

**Sign in with GitHub** needs a GitHub App and a small Cloudflare worker
(`worker/`); see [docs/setup-github-sign-in.md](docs/setup-github-sign-in.md).
Without them, people connect GitHub with a personal access token.

## Documentation

| Doc | What it is for | Who it is for |
| --- | --- | --- |
| [Contributing](CONTRIBUTING.md) | Setting up, running the tests and their conventions, making a change, releases. | Developers |
| [Changelog](CHANGELOG.md) and [security](SECURITY.md) | What each release changed; how to report a security problem. | Everyone |
| [User guide](docs/user-guide.md) | Starting a project, the ideas in plain words, how to do the common jobs, shortcuts, where your data is kept. The same text as **Help** in the app. | Users |
| [Risk analysis](docs/risk-analysis.md) | The FMEA and hazard libraries: each definition, the risk policy, reviews saved as views, how another tool reads them. | Modellers |
| [Dependency matrices](docs/dsm.md) | The DSM and N² chart views: rows, links, suggested modules, change impact. | Modellers |
| [Table rendering](docs/table-rendering.md) | How any SysML view becomes a table (`@TableRendering`), for views written by hand. | Modellers |
| [State machine simulator](docs/simulator.md) | What the simulator does with a state machine: steps, the simulated clock, `do` actions, what is not supported. | Modellers |
| [Model interchange](docs/interchange.md) | `.kpar`, SysML v2 JSON and Systems Modeling API servers: what round-trips, merging on Save to server, what a server must allow. | Modellers, developers |
| [Interchange reference](docs/reference/interchange.md) | Background research on the standards: KerML clause 10, `.kpar`, element identity, the API, XMI. | Developers |
| [The engine](docs/engine.md) | How the app uses the sysml-toolkit: the engine interface, positions, views, edits, diagrams, checks, and requests for upstream. | Developers |
| [Performance](docs/performance.md) | How large models are measured, the results, and what still limits them. | Developers |
| [Plan](docs/PLAN.md) | Product principles, architecture, what is built, what is next, and the decision log. | Developers |
| [Sign in with GitHub](docs/setup-github-sign-in.md) | Setting up the GitHub App and the sign-in worker for your own deployment. | Self-hosters |
| [Robustness and MBSE assessment](docs/assessment/README.md) | What Fairtide demonstrably supports, with evidence and scores, and every critical finding and its fix. | Everyone |
| [Assessment: language coverage](docs/assessment/01-language.md) | The official corpus, the engine against the OMG pilot, a construct matrix. | Developers |
| [Assessment: text, diagrams, round trips](docs/assessment/02-round-trip.md) | Every edit kind, save/reload, exports, edit latency. | Developers |
| [Assessment: import, export, interoperability](docs/assessment/03-interchange.md) | JSON, `.kpar` and SysON, compared by meaning. | Developers |
| [Assessment: MBSE coverage](docs/assessment/04-mbse.md) | Structure, behaviour, traceability, gaps, navigation, conventions. | Developers |
| [Assessment: simulation](docs/assessment/05-simulation.md) | The state machine simulator against reference traces from the specification. | Developers |
| [Assessment: calculations and trade studies](docs/assessment/06-calculations.md) | Known-answer tests for expressions, units, roll-ups, constraints and trade studies. | Developers |
| [Assessment: requirements, risk, verification](docs/assessment/07-requirements-risk.md) | Requirement identity, coverage, FMEA arithmetic, change impact, revisions. | Developers |
| [Assessment: data integrity, Git, recovery](docs/assessment/08-data-integrity.md) | Crashes, tabs, folders, GitHub, archives, credentials. | Developers |
| [Assessment: software quality](docs/assessment/09-quality.md) | Tests, coverage, CI, supervision, security, contributor setup. | Developers |
| [Assessment: performance, usability, deployment](docs/assessment/10-performance-usability.md) | Measured load and edit times by model size, phone emulation, accessibility, self-hosting. | Developers |
| [Interop tools](docs/interop-tools.md) | Running the OMG pilot implementation and SysON as checkers. | Developers |
| [Spike: WebAssembly engine](docs/spikes/wasm-engine.md) | A dated note (2026-10-21) from an engine the app no longer uses. | Developers (history) |

The same list is in [docs/README.md](docs/README.md).

## Where the code is

The engine is the Open-MBEE [sysml-toolkit](https://github.com/Open-MBEE/sysml-toolkit)
(`@sysml/wasm`), at the release pinned in `toolkit.json`, run in a Web Worker;
see [docs/engine.md](docs/engine.md).

| Path | What lives there |
| --- | --- |
| `src/lib/engine` | Engine interface, the sysml-toolkit worker and its model adapter, views, diagrams, checks |
| `src/lib/project` | Open project state: files, analyses, elements, requirements; project templates |
| `src/lib/workbench` | Workbench: explorer, text editor, inspector, overview, tables, matrices, edit actions |
| `src/lib/create` | Guided forms (new view, roll-up, limit, trade study, FMEA, hazard, DSM) and the SysML they write |
| `src/lib/diagram` | Diagram canvas (Svelte Flow), SysML notation, ELK layout, export |
| `src/lib/editor` | CodeMirror support driven by the engine |
| `src/lib/sim` | State machine simulator |
| `src/lib/review` | Comparing versions: what changed, in plain language |
| `src/lib/reports` | Specification and interface control documents |
| `src/lib/dataio` | Excel and CSV import and export |
| `src/lib/interchange`, `src/lib/exchange` | `.kpar` archives; SysML v2 JSON and the Systems Modeling API client |
| `src/lib/git` | GitHub: connecting, sign-in, opening and saving repositories |
| `src/lib/offline` | Service worker rules, install prompts |
| `src/lib/help`, `src/lib/learn` | The in-app help (source of the user guide) and plain-language explanations of SysML |
| `src/lib/landing`, `src/lib/ui` | Landing page illustrations; design-system components |
| `src/routes` | Landing page, projects, help and the workbench (`/p/[project]`) |
| `src/demo/drone` | The demo project (SysML v2) and its tour |
| `worker` | The sign-in worker (Cloudflare), for "Sign in with GitHub" |
| `tests` | End-to-end tests, the large-model unit test and the benchmark |
| `docs` | The documentation above |

## Licence

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option. Third-party components keep their
own licences and are used unmodified: the OMG SysML v2 standard library,
served from the [sysml-toolkit](https://github.com/Open-MBEE/sysml-toolkit)'s
bundle, is EPL-2.0 (its notice is shown in the app's standard-library browser
and in Settings → About), the sysml-toolkit itself is Apache-2.0, and the ELK
layout library (elkjs) is EPL-2.0.

SysML is a registered trademark of the Object Management Group.

The repository and site are still named `sysml-web`, the product's working name
before it became Fairtide.
