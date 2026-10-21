# Spike A — tree-sitter-sysml + Rust → WebAssembly

**Verdict: feasible, no workarounds.** Run 2026-10-21.

## Versions

rustc 1.97.0 · `tree-sitter =0.27.1` · `tree-sitter-language =0.1.9` ·
`wasm-bindgen =0.2.129` (+ matching `wasm-bindgen-cli`) · clang 18.1.3 · Node 22.
Grammar: `jackhale98/tree-sitter-sysml` `src/parser.c` (39.8 MB, ABI 14, no
external scanner).

tree-sitter ≥ 0.25 supports `wasm32-unknown-unknown` natively: it compiles a
small libc subset (`src/wasm-stdlib`) and allocates through Rust. The grammar's
`parser.c` needs the libc headers that `tree-sitter-language` exports via
`DEP_TREE_SITTER_LANGUAGE_WASM_HEADERS` — without them: `'stdlib.h' file not found`.
tree-sitter 0.27 requires Rust ≥ 1.90 (edition 2024).

## Recipe

`Cargo.toml`

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
tree-sitter = "=0.27.1"
tree-sitter-language = "=0.1.9"   # direct dep so DEP_*_WASM_HEADERS reaches build.rs
wasm-bindgen = "=0.2.129"

[build-dependencies]
cc = "1"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
```

`build.rs`

```rust
fn main() {
    let g = std::env::var("TREE_SITTER_SYSML_SRC").unwrap(); // grammar/src
    let mut c = cc::Build::new();
    c.std("c11").include(&g).file(format!("{g}/parser.c")).warnings(false).opt_level(2);
    if let Ok(h) = std::env::var("DEP_TREE_SITTER_LANGUAGE_WASM_HEADERS") {
        c.include(h);
    }
    println!("cargo:rerun-if-changed={g}/parser.c");
    c.compile("tree-sitter-sysml");
}
```

`lib.rs`

```rust
extern "C" { fn tree_sitter_sysml() -> *const (); }
let lang = unsafe { tree_sitter::Language::from_raw(tree_sitter_sysml() as *const _) };
```

Build: `CC_wasm32_unknown_unknown=clang cargo build --release --target wasm32-unknown-unknown`,
then `wasm-bindgen --target web --out-dir pkg <wasm>`.

## Measurements

| | Raw | gzip -9 | brotli q11 |
| --- | --- | --- | --- |
| wasm-bindgen output (opt-level z + LTO) | 5.13 MB | 527 KB | **285 KB** |
| after `wasm-opt -Oz` | 3.41 MB | 589 KB | 335 KB |

Serve the plain output brotli-compressed (wasm-opt compresses worse).

Build: `parser.c` → wasm object 4.4 s; clean build 16 s.

Parse (Node 22, new parser per call, incl. s-expression build):

| File | Size | Nodes | Cold | Warm |
| --- | --- | --- | --- | --- |
| EVSample.sysml | 11 KB | 2,023 | 3–5.6 ms | 2.3–3.4 ms |
| SimpleQuadcopter.sysml | 10.7 KB | 2,101 | 3.0 ms | 2.9 ms |
| SysML v2 Spec Annex A SimpleVehicleModel.sysml | 73.5 KB | 10,486 | 10.7 ms | 9.4 ms |

All parsed without errors; a deliberately broken input reported `has_error`.

## Implications

- The engine exposes its own wasm-bindgen API (snapshots, queries, edit ops);
  the JS `web-tree-sitter` API is not needed.
- Vendor the grammar into `engine/` (git submodule or pinned path) and pass its
  location to `build.rs`; CI uses the committed `parser.c` (regeneration takes
  ~12 CPU-minutes).
