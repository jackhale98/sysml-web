# Fairtide

A web workbench that makes **SysML v2** approachable. Build models in text or
diagrams — both edit the same SysML, live — with plain-language explanations
of every element, so engineers new to MBSE can model productively. The model
is standard SysML v2 text in your own git repository, readable by any
conformant tool, and the app works on desktop and mobile.

**Status:** early preview — explorer, engine-backed text editor, live diagrams
you can edit, inspector, requirements view and a guided demo model. See
[docs/PLAN.md](docs/PLAN.md) for the plan and roadmap.

## Using it

New to Fairtide, or to SysML? The [user guide](docs/user-guide.md) covers
starting a project (blank, requirements first, or a small example system),
the ideas in plain words, how to do the common jobs, keyboard shortcuts and
where your data is kept. It is the same guide as **Help** in the app.

FMEA worksheets, risk matrices and hazard logs are standard SysML with two
small libraries; [docs/risk-analysis.md](docs/risk-analysis.md) says what
each definition means and how another tool reads them, and
[docs/table-rendering.md](docs/table-rendering.md) how any view becomes a
table.

## Development

Requires Node 22.17+.

```sh
npm install
scripts/fetch-toolkit.sh  # the SysML engine and its standard library into static/toolkit/
npm run dev               # http://localhost:5173
npm test                  # unit tests (Vitest)
npm run check && npm run lint
npm run test:e2e          # Playwright end-to-end + axe accessibility checks
npm run lighthouse        # Lighthouse CI, mobile and desktop (after npm run build)
```

**Sign in with GitHub** needs a GitHub App and a small Cloudflare worker
(`worker/`); see [docs/setup-github-sign-in.md](docs/setup-github-sign-in.md).
Without them, people connect GitHub with a personal access token.

The engine is the Open-MBEE [sysml-toolkit](https://github.com/Open-MBEE/sysml-toolkit)
(`@sysml/wasm`), at the release pinned in `toolkit.json`; see
[docs/engine.md](docs/engine.md).

| Path | What lives there |
| --- | --- |
| `src/lib/engine` | Engine interface, the sysml-toolkit worker and its model adapter |
| `src/lib/project` | Open project state: files, analyses, elements, requirements |
| `src/lib/workbench` | Workbench: explorer, text editor, inspector, views, edit actions |
| `src/lib/diagram` | Diagram canvas (Svelte Flow), SysML notation, ELK layout |
| `src/lib/editor` | CodeMirror support driven by the engine |
| `src/lib/git` | GitHub: connecting, sign-in, opening and saving repositories |
| `worker` | The sign-in worker (Cloudflare), for "Sign in with GitHub" |
| `src/lib/learn` | Plain-language explanations of SysML concepts |
| `src/lib/ui` | Design-system components |
| `src/routes` | Landing page and the workbench (`/p/[project]`) |
| `src/demo/drone` | The demo project (SysML v2) |
| `docs` | Plan, interchange reference, spikes |

## Licence

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option. Third-party components keep their
own licences and are used unmodified: the OMG SysML v2 standard library,
served from the [sysml-toolkit](https://github.com/Open-MBEE/sysml-toolkit)'s
bundle, is EPL-2.0 (its notice is shown in the app's standard-library browser
and in Settings → About), the sysml-toolkit itself is Apache-2.0, and the ELK
layout library (elkjs) is EPL-2.0.

SysML is a registered trademark of the Object Management Group.
