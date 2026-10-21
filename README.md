# SysML Web

A web app for systems engineering on **SysML v2**. Requirements, components,
interfaces, tests and failure modes are edited through spreadsheets, forms and
diagrams — no SysML knowledge needed — while the model itself is standard
SysML v2 text in your own git repository, readable by any conformant tool.

**Status:** Phase 0 preview: the app shell, the drone demo project analysed by
the WebAssembly engine, a read-only requirements grid and the model browser.
See [docs/PLAN.md](docs/PLAN.md) for the plan and roadmap.

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
```

The engine is [`sysml-wasm`](https://github.com/jackhale98/sysml-cli/tree/main/crates/sysml-wasm)
from `jackhale98/sysml-cli`, built at the revision pinned in `engine.json`. Set
`SYSML_CLI_DIR=/path/to/sysml-cli` to build from a local checkout instead.

| Path | What lives there |
| --- | --- |
| `src/lib/engine` | Engine worker, typed client and JSON types |
| `src/lib/project` | Open project state and the plain-language views of the model |
| `src/lib/ui` | Design-system components |
| `src/routes` | Landing page and the project workspace (`/p/[project]/…`) |
| `src/demo/drone` | The demo project (SysML v2) |
| `docs` | Plan, interchange reference, spikes |

## Licence

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option. The OMG SysML v2 standard library
used by the engine is EPL-2.0.

SysML is a registered trademark of the Object Management Group.
