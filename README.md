# SysML Web

A web workbench that makes **SysML v2** approachable. Build models in text or
diagrams — both edit the same SysML, live — with plain-language explanations
of every element, so engineers new to MBSE can model productively. The model
is standard SysML v2 text in your own git repository, readable by any
conformant tool, and the app works on desktop and mobile.

**Status:** early preview — explorer, engine-backed text editor, live diagrams
you can edit, inspector, requirements view and a guided demo model. See
[docs/PLAN.md](docs/PLAN.md) for the plan and roadmap.

## Development

Requires Node 22.17+, and to build the engine: Rust with the
`wasm32-unknown-unknown` target, clang, and `wasm-bindgen-cli` 0.2.129.

```sh
npm install
scripts/build-engine.sh   # builds the SysML engine into static/engine/
npm run dev               # http://localhost:5173
npm test                  # unit tests (Vitest)
npm run check && npm run lint
npm run test:e2e          # Playwright end-to-end + axe accessibility checks
npm run lighthouse        # Lighthouse CI, mobile and desktop (after npm run build)
```

The engine is [`sysml-wasm`](https://github.com/jackhale98/sysml-cli/tree/main/crates/sysml-wasm)
from `jackhale98/sysml-cli`, built at the revision pinned in `engine.json`. Set
`SYSML_CLI_DIR=/path/to/sysml-cli` to build from a local checkout instead.

| Path | What lives there |
| --- | --- |
| `src/lib/engine` | Engine worker, typed client and JSON types |
| `src/lib/project` | Open project state: files, analyses, elements, requirements |
| `src/lib/workbench` | Workbench: explorer, text editor, inspector, views, edit actions |
| `src/lib/diagram` | Diagram canvas (Svelte Flow), SysML notation, ELK layout |
| `src/lib/editor` | CodeMirror support driven by the engine |
| `src/lib/learn` | Plain-language explanations of SysML concepts |
| `src/lib/ui` | Design-system components |
| `src/routes` | Landing page and the workbench (`/p/[project]`) |
| `src/demo/drone` | The demo project (SysML v2) |
| `docs` | Plan, interchange reference, spikes |

## Licence

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option. Third-party components keep their
own licences and are used unmodified: the OMG SysML v2 standard library
embedded in the engine is LGPL-3.0-only (its notice is shown in the app's
standard-library browser), and the ELK layout library (elkjs) is EPL-2.0.

SysML is a registered trademark of the Object Management Group.
