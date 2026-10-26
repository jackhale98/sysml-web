# §9 Software quality and maintainability (+ questions 10, 14, 15)

Assessed on `origin/main` at `68cb9db` (2026-10-25); first pass on `92cfbcf`
(2026-10-23). Every command below was run in this session unless the block
says otherwise. "Clone" means a fresh `git clone` at `68cb9db` in a scratch
directory with its own `npm install`; "worktree" means the assessment branch.

**Dev-environment note (not app tooling).** On the assessment machine, every
`vitest`/`playwright test` run goes through a machine-wide queue
(`/home/user/tools/test-gate`, and shims from
`/home/user/tools/install-test-shims` in the main checkout's
`node_modules/.bin`). Agent worktrees link their `node_modules` into the main
checkout's, so an `npm install` in one rewrites the shared packages (this
happened once in this assessment and was repaired). A contributor's own
machine has neither the queue nor the shared packages.

## Test inventory (measured on `68cb9db`)

| Layer | Files | Tests | What runs |
| --- | --- | --- | --- |
| Unit, real engine in Node | 47 | 624 | The sysml-toolkit WASM loaded by `loadHost()` (`src/lib/engine/toolkit/testing.ts:20`), driven through `ToolkitHost` or a real `Workspace` (`src/lib/create/testing.ts`). |
| Unit, pure logic | 65 | 621 | Parsers, layout, emulator, CSV/XLSX, diff, caching rules. No engine, no mocks. |
| Unit with stand-ins | 12 | 125 | `fetch` stubs (GitHub, OAuth, the sign-in worker), a fake `Worker` (`toolkit/client.test.ts`), the in-house Systems Modeling API server (`src/lib/exchange/api-mock.ts`), and a SysON-behaving stand-in recorded from a live SysON (`exchange/syson.assessment.test.ts`). |
| …of which assessment tests (`*.assessment.test.ts`) | 16 | 195 | Added by this assessment; known gaps kept as `it.fails`. |
| End to end (Playwright, **Chromium only**) | 37 specs | ~208 | The production build (`vite build` + `vite preview`), the real worker, WASM and service worker. 32 specs run axe (`tests/e2e/axe.ts`). Network mocks: GitHub, the sign-in worker, API servers (`page.route`), and a failing WASM fetch (`engine.spec.ts`). |
| Large model | 1 unit + 1 e2e | 7 | A generated project of about 10k lines, with time budgets (`tests/unit/large-model.test.ts`, `tests/e2e/large-model.spec.ts`). |
| Conformance | `tests/conformance` | n/a | `npm run assess:conformance` over the OMG corpus (§1). **Not in CI.** |
| External checkers | `tools/interop` | n/a | OMG pilot and SysON scripts (`docs/interop-tools.md`). Run by hand, **not in CI**. |
| Performance | `tests/perf` | n/a | `npm run bench`, results in `docs/performance.md`. **Not in CI.** |
| Svelte components | 0 unit | 0 | The 130 `.svelte` files are exercised only end to end. |

Unit totals from the clone: **124 files, 1,370 tests: 1,341 passed, 28
expected failures (`it.fails`, known gaps), 1 skipped**, in 246 s with 2
workers. The skipped block (`src/lib/interchange/kpar.test.ts:232`) needs
`../../../../sysml-cli-main/…`, a checkout outside the repository, so CI and
new contributors always skip it. This branch adds 2 files and 4 tests
(below).

**Coverage** (v8; measured in the clone; `@vitest/coverage-v8@5.0.5` is not
a project dependency and was added there with `--no-save`):

| Area (TypeScript) | Lines | Branches |
| --- | --- | --- |
| All `.ts` under `src/` and `worker/src` (219 files) | **86.5 %** | 75.4 % |
| `engine/toolkit` (adapter, host, edits, evaluation, interchange) | 91.4 % | 78.5 % |
| `engine/toolkit/views` / `diagrams` | 95.4 % / 94.1 % | 77.8 % / 74.9 % |
| `sim` | 96.9 % | 88.5 % |
| `create` (guided forms) | 95.6 % | 81.2 % |
| `interchange` | 95.3 % | 84.8 % |
| `dataio` | 93.1 % | 76.9 % |
| `exchange` | 91.3 % | 80.4 % |
| `diagram` | 88.5 % | 75.1 % |
| `project` | 83.7 % | 74.5 % |
| `git` | 82.4 % | 73.6 % |
| `reports` | 75.2 % | 61.5 % |
| `review` | 67.3 % | 59.6 % |
| `offline` | 56.5 % | 68.6 % |
| `editor` | 2.3 % | 0 % |
| `.svelte` (130 files) | 0 % (end to end only) | n/a |

Covered only end to end (0–16 % in unit tests): `project/store.ts`
(IndexedDB, 5.6 %), `engine/toolkit/toolkit.worker.ts` (the worker's message
loop, 0 %), `service-worker/index.ts` (0 %), `review/review.svelte.ts` (0 %),
`editor/language.ts` (2.6 %) and `offline/pwa.svelte.ts` (15 %).
`reports/diagram.ts` is 0 % on main; this branch's escaping test covers it.

Reproduce (in a clone with its own `node_modules`, never in a shared one):

```sh
npm install --no-save @vitest/coverage-v8@5.0.5
npx vitest run --coverage.enabled --coverage.provider=v8 --coverage.reporter=json-summary \
  --coverage.include='src/**/*.ts' --coverage.include='src/**/*.svelte' --coverage.include='worker/src/**/*.ts'
```

---

### Are unit, integration, end-to-end, and regression tests covering core workflows?
- **Answer:** Yes. Each core workflow has unit tests and at least one e2e
  spec: text and diagram editing, tables, requirements and trace, budgets and
  checks, trade studies, simulator, risk, DSM, reports, import/export,
  interchange, GitHub, offline/install and phone layout. Fixes come with
  regression tests. Some tests are written to fail when an upstream bug is
  fixed, e.g. `evaluation.test.ts` for docs/engine.md "Upstream requests" 1.
  The assessment adds 16 more files of known-answer and edge-case tests, with
  known gaps as `it.fails`, which flip when fixed.
- **Evidence:** Full unit suite run in the clone (totals above). CI runs every
  e2e spec. I ran `landing`, `offline` and `engine` in the clone: 13 of 13 passed (45 s, 2 workers, port 4326).
- **Limitations:** Chromium only (`playwright.config.ts`), so Safari/WebKit
  is untested although phone use (iOS) is claimed. No long-session test.
  Svelte components are tested only end to end.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** additional testing: a WebKit Playwright project and a
  long-session test.

### Do tests exercise the actual SysML engine and application integration rather than only mocks?
- **Answer:** Yes. 624 unit tests load the real sysml-toolkit 0.10.10 WASM in
  Node and call the same `ToolkitHost` the worker runs. Guided-form, session
  and round-trip tests drive a real `Workspace` over it. Every e2e test runs
  the production build with the real worker and WASM. Mocks sit only at
  external services: the GitHub REST API, the sign-in worker and Systems
  Modeling API servers. The one internal stand-in is the fake `Worker` used
  for restart logic. External tools (the OMG pilot, SysON) have checked
  Fairtide's results through `tools/interop` (§1, §3), by hand.
- **Evidence:** Inventory above. `src/lib/exchange/api-mock.ts:1-8`. The
  SysON stand-in is recorded from a live SysON
  (`exchange/syson.assessment.test.ts:1-13`).
- **Limitations:** No automated run against a real API server or the real
  GitHub API: the API client is tested against this project's reading of the
  specification and one recorded server. `toolkit.worker.ts` is covered only
  end to end.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** additional testing: put `tools/interop/pilot-check.sh` on
  the demo and `npm run assess:conformance` in a scheduled CI job.

### Does CI catch broken builds, type errors, and regressions?
- **Answer:** CI catches them, but nothing stops a failing commit from being
  deployed. `ci.yml` runs on every push and PR: `npm ci`, toolkit fetch with
  SHA-256 check, `format:check`, `lint`, `check` (svelte-check, plus `tsc`
  for the service worker and the sign-in worker), unit tests, `build`, then
  every e2e spec with axe (2 retries on CI). `lighthouse.yml` requires
  performance ≥ 0.9, accessibility = 1, best practices ≥ 0.95 and SEO ≥ 0.9
  on mobile and desktop. **`deploy.yml` publishes every push to `main` to
  GitHub Pages without waiting for CI** (no `needs`, no `workflow_run`).
- **Evidence:** GitHub Actions history, read in this session.
  - Last 84 CI runs on `main` (2026-10-21 → 10-25): 62 success, 7 failure,
    15 cancelled (superseded, `cancel-in-progress`). `68cb9db` is green.
  - **5 of the last 40 deploys published a commit whose CI had failed**:
    `095a7e5`, `92cfbcf`, `88268e7`, `54289ab`, `dae7c14`. For example,
    `92cfbcf` failed CI in run 39892755899 (`risk-review.spec.ts:166`, 3 of 3
    attempts) and deployed in run 39892755952.
  - Recurring CI failures: `risk-review.spec.ts:54`/`:166` (an Undo
    notification never appears; addressed on main by `fb90c21`, "hold
    notifications while every accessibility check runs") and
    `files.spec.ts:70` (flaky command palette).
  - Re-runs: see "Flaky tests" below.
- **Limitations:** Branch protection could not be inspected. `retries: 2`
  hides flakiness in the pass/fail signal. Lighthouse, conformance and the
  external checkers do not gate deploy either.
- **Status:** Verified
- **Score:** 2 (Fairtide)
- **Next action:** bug fix: make deploy depend on CI success (`workflow_run`,
  or one workflow with `needs`).

### Are dependencies constrained sufficiently for reproducible builds?
- **Answer:** Mostly.
  - Locked: `package-lock.json` (v3) is committed and every workflow installs
    with `npm ci`; a fresh `npm install` in the clone left the lock unchanged.
    The engine is pinned by version, URL and SHA-256 (`toolkit.json`), and
    `scripts/fetch-toolkit.sh` refuses a mismatch. The conformance corpora are
    pinned by commit (`scripts/fetch-conformance.sh`), the pilot jar by
    SHA-256 (`docs/interop-tools.md`).
  - Loose: Node is pinned to the major version only (`.nvmrc` `22`,
    `engines` `>=22.17`, CI `node-version: 22`). Actions are pinned by major
    tag (`@v4`), not commit SHA. Lighthouse uses Chrome `stable`. The manual
    worker deploy runs `npx --yes wrangler@4` while `worker/package.json`
    pins `4.151.3`.
- **Evidence:**
  - `scripts/fetch-toolkit.sh` in the clone: downloaded and verified in under
    2 s; the result is byte-identical to the shared copy (`cmp`).
  - With `toolkit.json`'s `sha256` altered, the script exits 1 (`FAILED`) and
    leaves `static/toolkit/` untouched (run on `92cfbcf`; script unchanged
    since).
  - `npm install` in the clone: 546 packages, `git status` clean.
- **Limitations:** The toolkit comes from GitHub Releases at build time and is
  not vendored, so builds fail if the release disappears. Dependabot updates
  are only as safe as CI.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** None required. Optional: pin Node to a minor version and
  actions to commit SHAs.

### Can the application operate without network access after required assets are available locally?
- **Answer:** Yes. The service worker (`src/service-worker/index.ts`, rules
  in `src/lib/offline/caching.ts`) caches the app shell on install and the
  engine (WASM and standard library) after first use
  (`pwa.warmEngineCache()`, `engine/instance.ts:42`). Projects live in
  IndexedDB.
- **Evidence:**
  - `tests/e2e/offline.spec.ts` covers: the landing page installs the shell
    but not the engine (`:43`); the demo opens and is analysed offline from
    the cache (`:62`); stored projects and the list open offline (`:94`);
    new versions are offered, not forced (`:120`); a reload for a new version
    keeps the latest edit (`:146`).
  - Unit: `caching.test.ts` (12), `install.test.ts` (11), `launch.test.ts`
    (7).
  - Run in the clone: all five passed (with `landing` and `engine`, 13 of 13).
- **Limitations:** Offline means an already visited origin; GitHub, API
  servers and sign-in need the network. Chromium only; iOS Safari's
  service-worker eviction is untested.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** additional testing: the offline spec in WebKit.

### Are errors handled explicitly with actionable messages and useful diagnostics?
- **Answer:** Largely.
  - The engine: start-up failure is retried once, then reported in the status
    bar ("Model can't be read"), a persistent notification and the problems
    list, with the reason ("Fairtide stopped reading the model (…). Reload the
    page to try again.").
  - Imports: they list what was skipped and why (`import.test.ts:209`,
    `interchange.test.ts:203`). Archive files left out are named (fixed in
    §3/§8).
  - Analysis: unsupported table filters, trade-study forms and evaluator
    expressions give a written reason (`views.test.ts:402`,
    `emulator.test.ts:242`).
  - Saving: a save refused because another tab saved first says so
    (`project/store.ts`, `SAVED_ELSEWHERE`).
  - 29 call sites show error notifications. About 110 `catch` blocks fall back
    silently; those sampled are feature probes (storage estimate, share
    sheet, optional checks). `session.svelte.ts:96` treats a failed IndexedDB
    read as "not stored", so the `demo` id opens the bundled demo. Since the
    §8 fix, the next autosave is then refused rather than overwriting the
    stored copy (`stamp = null`, `session.svelte.ts:128`).
- **Evidence:** `tests/e2e/engine.spec.ts:57`: the WASM fetch fails twice; the
  test checks the single retry, the message and a clean axe scan. Run in the
  clone: passed.
- **Limitations:**
  - `docs/engine.md` "When the toolkit fails" still says the status bar shows
    "Engine error".
  - Two user-facing strings name the engine, which the UI avoids elsewhere:
    "The engine cannot evaluate this yet: …" (`toolkit/evaluation.ts`) and
    "The engine has N notes" (`sim/StateEmulator.svelte`).
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (docs and wording): update `docs/engine.md` and
  the two strings.

### Are background workers monitored, recoverable, and prevented from blocking the interface indefinitely?
- **Answer:** Crashes are handled; a hang is not.
  - The engine runs in a Web Worker, so it never blocks the main thread.
  - `startToolkit` (`engine/toolkit/client.ts:100-115`) watches `onerror` and
    `fatal`. A WASM trap or out-of-memory terminates the worker and starts a
    new one **once per page lifetime**, re-sending the calls in flight. A
    second death is final: every call rejects with a reload message, and one
    notification is shown.
  - **There is no time limit.** A call the worker never answers (an engine
    stuck in a loop) stays pending. Every later call queues behind it in the
    single-threaded worker, and the model stops updating without a message
    until a reload.
  - The standard-library JSON export uses a separate throwaway worker
    (`startSpareEngine`, `restarts: 0`).
- **Evidence:** New `src/lib/engine/toolkit/supervision.assessment.test.ts`
  (run in the worktree: 2 passed, 1 expected failure):
  - a crash with three calls in flight restarts once and answers all three
    (passes);
  - a second fatal error later in the session is final and reported once
    (passes);
  - `it.fails` (known gap): a never-answered call is still pending after 10
    simulated minutes.

  Also `toolkit/client.test.ts` (5 tests) and `engine.spec.ts:57` (the real
  worker, WASM unavailable).
- **Limitations:**
  - The restart budget is one per page: after one out-of-memory in a long
    session, the next ends analysis.
  - Out-of-memory on the real worker has no test; `docs/performance.md`
    records it on 100k-line models.
- **Status:** Verified (crash recovery); gap verified (no hang time limit)
- **Score:** 2 (Fairtide)
- **Next action:** planned capability: a per-call watchdog that restarts a
  worker that hasn't answered within a bound scaled to model size, and a
  restart budget that refills after a healthy period.

### Are large models tested for memory usage, startup time, editing latency, and long-running sessions?
- **Answer:** Startup, editing latency and memory: yes, for generated models
  of 10k, 50k and 100k lines. In CI, `large-model.test.ts` holds time budgets
  at 10k lines and `large-model.spec.ts` checks a 10k-line project opens
  within budget and stays usable. `npm run bench` covers the rest
  (`docs/performance.md`: worker WASM memory 333 MiB at 10k and 1,153 MiB at
  50k; a keystroke re-analysis about 1.1 s at 10k and 7 s at 50k).
  `tests/unit/edit-latency.assessment.test.ts` measures edit latency (§2).
  Long-running sessions: **not tested**. WASM memory only grows, and the
  single worker restart is the only relief.
- **Evidence:** Cited, not re-run by me; §10 owns the measurements.
- **Limitations:** Benchmarks are not in CI, only the 10k budgets. No
  low-memory device. No soak test.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing: a 30-minute scripted editing session
  that records worker memory.

### Can the engine be updated without requiring a rewrite of all application views?
- **Answer:** Upgrading the toolkit: yes. Replacing it with another engine:
  only the adapter layer is rewritten, but that layer is large.
  - The UI depends on an engine-neutral contract: `EngineApi`
    (`src/lib/engine/protocol.ts`, 30 methods) and the result types in
    `engine/types.ts` (1,087 lines). 104 app files import only those.
  - Four app files outside `src/lib/engine` import toolkit modules, all for
    text helpers rather than toolkit types: `diagram/behaviorEdits.ts` →
    `toolkit/machines.ts`; `diagram/relationships.ts`, `viewEdits.ts` and
    `duplicate.ts` → `toolkit/header.ts`.
  - The toolkit layer (`src/lib/engine/toolkit/`, excluding tests) is about
    18k lines: the model adapter and every view, diagram, evaluation, trade,
    interchange and edit routine. Another engine means re-implementing it
    behind `EngineApi`.
  - The toolkit's WASM API is typed by hand (`toolkit/api.ts`) because the
    package is fetched at build time. A signature change in an upgrade is
    caught by the real-engine tests, not the compiler.
  - The project has already swapped engines once with the UI unchanged
    (decision #16, `docs/PLAN.md`).
- **Evidence:** `grep` of imports, `wc -l`, `docs/engine.md` "Adding a
  method".
- **Limitations:** Nothing records which hand-typed signatures were checked
  against which toolkit release.
- **Status:** Verified (by inspection)
- **Score:** 2 (Fairtide)
- **Next action:** additional testing: check `api.ts` against the fetched
  `sysmlv2.d.ts` in `fetch-toolkit.sh` or `npm run check`.

### Are public interfaces and data formats documented, versioned, and tested for compatibility?
- **Answer:** Documented and partly tested, but not versioned.
  - The model is standard SysML v2 text, with no Fairtide format.
  - The layout sidecar `layout/diagrams.json`
    (`{ "<view>:<scope>": { "<nodeId>": [x, y], "#hidden": [...], "#added": [...] } }`)
    is documented in `diagram/positions.ts:1-13` and the user guide. It has
    **no version field**; readers ignore unknown keys and bad values
    (`positions.test.ts:45`).
  - Saved views and reports are SysML `view`s typed by the bundled
    `ModelViews`/`Reporting` libraries (`docs/table-rendering.md`).
  - Browser storage is IndexedDB `sysml-web` at schema version 1
    (`project/store.ts`), with no migration code. Fields added later are
    handled one by one: `folderTexts` absent → `unknownInFolder`
    (`session.svelte.ts`), and a legacy single GitHub account
    (`account.test.ts:246`).
  - Exports follow the OMG formats (`docs/interchange.md`).
  - Nothing tests that a project stored by an older build opens in a newer
    one.
- **Evidence:** The code cited. No fixture of an older stored project or
  layout file exists.
- **Limitations:** With no version in the layout file or the stored record, a
  future incompatible change cannot be detected.
- **Status:** Partially verified
- **Score:** 1 (Fairtide)
- **Next action:** additional testing: a `version` in the layout file and the
  stored records, plus fixtures written by today's build that later builds
  must open.

### Are dependency vulnerabilities and unsafe content handling checked automatically?
- **Answer:** Partly.
  - Automation: Dependabot runs weekly for npm and Actions
    (`.github/dependabot.yml`). There is no CodeQL, no `npm audit` in CI and
    no secret-scanning configuration in the repository.
  - `npm audit` on `68cb9db`: **0 vulnerabilities in production
    dependencies**. 17 in dev dependencies (14 high, 1 moderate, 2 low), all
    through `@lhci/cli`: lighthouse → puppeteer-core → `extract-zip`, `tmp`,
    `basic-ftp`, `chromium-bidi`/`zod`, plus express → `body-parser`. They run
    only in Lighthouse CI. The count grew from 14 on 10-23. The sign-in
    worker has 0.
  - Model text that reaches HTML:
    - Markdown (README/TOUR) becomes tokens, not HTML, and only `http(s)`
      links become anchors (`markdown/markdown.ts:1-5`,
      `DocumentView.svelte`).
    - There are two `{@html}` sites: a constant redirect script
      (`routes/+page.svelte`) and the report interconnection SVG
      (`reports/ReportView.svelte`), which `reports/diagram.ts` builds with
      every name escaped.
    - Printed tables and the SVG export escape (`dataio/export.test.ts:23`,
      `diagram/export/svg.test.ts:124`).
    - There is no Content-Security-Policy: GitHub Pages can't set headers and
      `src/app.html` has no CSP `<meta>`.
- **Evidence:**
  - `npm audit` and `npm audit --omit=dev` in the clone and `worker/`.
  - New `src/lib/reports/escaping.assessment.test.ts`, on the real toolkit:
    it adds a part named `<img src=x onerror="alert(1)">` with a port named
    `<script>alert(2)</script>` to the demo, builds the ICD report, and
    checks that the SVG holds them only escaped and that the Markdown export
    escapes `<` as `\<`. Run in the worktree: passed.
- **Limitations:**
  - Escaping is a per-site convention. ESLint's `svelte/no-at-html-tags` is
    disabled inline where used, so nothing automated checks new sites.
  - No CSP as a second line of defence.
- **Status:** Verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing: `npm audit --omit=dev
  --audit-level=high` or CodeQL in CI, and a CSP `<meta>` in `app.html`.

### Can a new contributor reproduce the development environment using repository documentation?
- **Answer:** Yes on Linux, with two prerequisites not written down. I
  followed the README literally in a fresh clone of `68cb9db` (Node 22.22.0,
  npm 10.9.4):

  | README step | Result |
  | --- | --- |
  | Node 22.17+ | 22.22.0 present; `.nvmrc` says `22`. |
  | `npm install` | OK, 23 s. Prints "17 vulnerabilities" (dev-only, see above) with no explanation. |
  | `scripts/fetch-toolkit.sh` | OK, 2 s. Needs bash, curl, `sha256sum`, tar and node: fine on Linux, unverified on macOS/Windows. |
  | `npm run dev` | OK: `/`, `/p/demo`, `/help` and `/toolkit/sysmlv2_bg.wasm` answer 200 on `:5173`. |
  | `npm test` | OK: 1,341 passed, 28 expected failures, 1 skipped (needs a checkout outside the repo; undocumented). |
  | `npm run check`, `lint`, `format:check` | OK, 0 errors (svelte-check: 5,201 files). |
  | `npm run test:e2e` | **Undocumented prerequisite:** Playwright's Chromium (`npx playwright install chromium`, as CI does); it worked here only because browsers were preinstalled. Subset in the clone: 13 of 13 passed (45 s, 2 workers, port 4326). |
  | `npm run lighthouse` | Needs Chrome (`CHROME_PATH`). Not run. |
  | `npm run assess:conformance` | Needs `scripts/fetch-conformance.sh` first. Documented in `docs/assessment/01-language.md`, not the README. Not run by me (§1 ran it). |

  For changing code: the README code map, `docs/engine.md` "Adding a method"
  and the per-area docs are enough. There is no CONTRIBUTING guide (branching,
  commit and PR conventions, running one e2e spec, the `PW_PORT`/`PW_SIGN_IN`
  variables, which live only in `playwright.config.ts`).
- **Evidence:** The clone run above.
- **Limitations:** macOS and Windows not tried. The toolkit needs network
  access to GitHub Releases.
- **Status:** Verified (Linux)
- **Score:** 3 (Fairtide)
- **Next action:** add the Playwright step and a short CONTRIBUTING.md to the
  README.

### Are known limitations and technical debt tracked explicitly?
- **Answer:** In documents, yes; in a tracker, no.
  - Documents: `docs/PLAN.md` (next, not doing, risks, decision log, open
    questions); `docs/engine.md` "Upstream requests" (each toolkit bug with a
    minimal reproduction and the app's workaround, plus the assessment's
    four new findings); `docs/simulator.md` "Not supported";
    `docs/interchange.md` "What doesn't, and why"; `docs/performance.md`
    "Remaining limits"; `docs/assessment/README.md` "Open, not critical".
  - Tests: some workarounds are pinned by tests that fail when upstream is
    fixed, and the assessment's known gaps are `it.fails` (28 unit, 1 e2e
    `test.fail`).
  - No TODO/FIXME markers in `src/`.
  - Missing: an issue tracker or labels in the repository (no
    `.github/ISSUE_TEMPLATE`), and owners or dates for debt items.
- **Evidence:** The files cited; `grep -c "it.fails("`.
- **Limitations:** The docs drift (the "Engine error" wording above).
- **Status:** Verified
- **Score:** 2 (Fairtide)
- **Next action:** file the upstream requests and the open findings as issues
  and link them from the docs.

### Is there a clear policy for releases, compatibility, migrations, and bug reports?
- **Answer:** No.
  - Releases: `package.json` is still `0.0.1`. There are no git tags,
    releases or CHANGELOG, and every push to `main` deploys (see CI above).
  - Version shown: Settings › About shows the app version (`0.0.1`) and the
    toolkit version, but no build or commit id, so two deployments can't be
    told apart.
  - Missing: a compatibility or migration policy for stored projects or
    `layout/diagrams.json`, SECURITY.md, issue templates, and an in-app
    "report a problem" link.
- **Evidence:** `git tag` (empty), `src/lib/version.ts`,
  `settings/Settings.svelte` (About), `.github/` contents.
- **Limitations:** n/a
- **Status:** Verified (absent)
- **Score:** 1 (Fairtide)
- **Next action:** planned capability: tagged releases with a changelog, the
  commit id in About, SECURITY.md and issue templates.

## Prioritized questions

### 10. Do automated tests cover the actual engine, UI, and integration boundaries?
- **Answer:** The engine and the UI, yes; external boundaries, only against
  stand-ins.
  - Engine: extensively (624 unit tests on the real WASM in Node, and every
    e2e test in the browser worker).
  - UI: 37 Playwright specs on the production build with axe, but only in
    Chromium and with no unit tests of Svelte components.
  - Worker boundary: covered by a stand-in (crash and restart) and end to end
    (start failure).
  - GitHub, sign-in worker and Systems Modeling API: tested only against
    stand-ins, one of them recorded from a live SysON.
  - Service worker and IndexedDB: end to end only.
  - Checks by another tool (pilot, SysON): run by hand through
    `tools/interop`, not automated.
- **Evidence:** Inventory, coverage and CI history above.
- **Limitations:** No WebKit or Firefox, no real external servers in CI, and
  no hang test on the worker (the gap shown by
  `supervision.assessment.test.ts`).
- **Status:** Verified
- **Score:** 3 (Fairtide). Reaching 4 needs the external checkers to run
  automatically.
- **Next action:** additional testing: a WebKit project, plus a scheduled job
  running the pilot and conformance checks.

### 14. Can a new contributor build, test, and modify the project using only repository documentation?
- **Answer:** Yes on Linux. Every README step worked in a fresh clone. Not
  written down: Playwright's browser install for e2e, the outside checkout
  that one skipped unit test needs, and `fetch-conformance.sh` for the
  conformance runner (documented only in the assessment). For changes,
  `docs/engine.md` and the README code map help; there is no CONTRIBUTING
  guide.
- **Evidence:** The contributor block above.
- **Limitations:** macOS and Windows not tried; the fetch script assumes GNU
  `sha256sum`.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** add the missing prerequisites to the README.

### 15. Are unsupported features, known bugs, and interchange limitations visible to users?
- **Answer:** Interchange limitations are visible in the app; other
  limitations mostly only in the docs.
  - **In the app:**
    - Interchange imports report what came across and what was left out,
      with a downloadable full list (`interchange.ts`, e2e
      `exchange.spec.ts:97`/`:171`). Archive files left out are named.
    - Excel/CSV import lists skipped rows and dropped values
      (`data-io.spec.ts:122`).
    - Table filters that aren't supported give a warning
      (`views.test.ts:402`).
    - Checks the evaluator can't do say so; simulator guards and effects it
      can't evaluate give a reason (`emulator.test.ts:242`); the toolkit's
      notes on a machine are listed (`StateEmulator.svelte`).
    - Diagrams list elements a view's filter leaves out
      (`DiagramCanvas.svelte`). `all X` in a trade study is reported as not
      supported (`trade.ts`).
    - Help (same text as `docs/user-guide.md`, "Exchange models") explains
      what JSON round trips lose.
    - Problems warns at the satisfy and subject-order cases the pilot rejects
      (§1).
  - **Docs only:**
    - The simulator's "Not supported" list (`docs/simulator.md`: history
      states, `terminate`, `send` to self, deferred signals). I found no
      in-app notice when a machine uses them.
    - The toolkit bugs in `docs/engine.md`, the limits in
      `docs/performance.md`, and the open findings in
      `docs/assessment/README.md`.
    - There is no in-app "known issues" or release-notes page.
- **Evidence:** The tests cited. I did not open the app for each simulator
  construct; §5 owns that.
- **Limitations:** Visibility of individual unsupported SysML constructs in
  diagrams and the editor is assessed in §1/§2.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** planned capability: a "Known limitations" page in Help,
  and simulator notices for history, `terminate` and `send`.

## Flaky tests (the lead's list and CI history)

Re-run in the clone on `68cb9db`: each test 4 times, `--retries=0`, 2
workers (`--repeat-each=4`). **28 of 28 passed (3.9 min).**

| Test | Earlier symptom | Now (4 runs) |
| --- | --- | --- |
| `smoke.spec.ts:328`: phone views drawer | intermittent | 4/4 |
| `edits.spec.ts:70`: rename and delete across files | intermittent | 4/4 |
| `state-editing.spec.ts:107`: state machine drawn in a new project | intermittent | 4/4 |
| `exchange.spec.ts:116`: demo to JSON and back (axe contrast) | intermittent axe failure | 4/4, axe clean |
| `files.spec.ts:71`: new file in a new folder, rename, delete, undo | flaky in CI on 10-22/23 (command palette) | 4/4 |
| `risk-review.spec.ts:54`, `:169`: Undo notification | failed 3/3 in CI on `92cfbcf` and `095a7e5` | 4/4 each |

Four clean runs on one machine show the failures are no longer frequent. They
do not prove the tests are stable: CI runs with `retries: 2`, which hides
flakiness, and the history above is the better long-run record. Command:

```sh
PW_PORT=4326 npx playwright test tests/e2e/edits.spec.ts:70 tests/e2e/state-editing.spec.ts:107 \
  tests/e2e/exchange.spec.ts:116 tests/e2e/smoke.spec.ts:328 tests/e2e/files.spec.ts:71 \
  tests/e2e/risk-review.spec.ts:54 tests/e2e/risk-review.spec.ts:169 --repeat-each=4 --retries=0 --workers=2
```

## Section score table

| Sub-area | Score | Note |
| --- | --- | --- |
| Tests of core workflows | 3 | 1,370 unit + ~208 e2e; 86.5 % TS line coverage; Chromium only |
| Real engine vs mocks | 3 | 624 unit tests on the real WASM; mocks only at external services |
| CI gating | 2 | Thorough CI, but 5 of the last 40 deploys shipped a red commit |
| Reproducible builds | 3 | Lockfile + `npm ci`, toolkit SHA-256; Node major only |
| Offline operation | 3 | e2e, Chromium |
| Error handling | 2 | Engine failure explicit; docs drift; silent fallbacks reviewed |
| Worker supervision | 2 | One crash restart; no hang time limit (`it.fails`) |
| Large models / long sessions | 2 | 10k budgets in CI; no soak test |
| Engine replaceability | 2 | Clean `EngineApi`; ~18k-line toolkit layer; hand-typed WASM API |
| Data formats and compatibility | 1 | Documented, unversioned, no compat fixtures |
| Security automation, content safety | 2 | Dependabot; escaping tested; no audit/CodeQL in CI, no CSP |
| Contributor setup (Q14) | 3 | README works on Linux; prerequisites missing |
| Limitations and debt tracking | 2 | Thorough docs and `it.fails`; no tracker |
| Release, compatibility, bug policy | 1 | None |
| Q10 tests across boundaries | 3 | External checkers by hand only |
| Q15 limitations visible in the app | 2 | Interchange yes; simulator and toolkit bugs docs only |

## Critical findings

None meets the brief's definition (silent data loss, file deletion,
unreported semantic corruption, misleading results, credential leak). Two
high-priority findings:

1. **Commits that fail CI are deployed to users.** Reproduce: Actions history.
   `92cfbcf`'s CI run 39892755899 concluded `failure`; Deploy run
   39892755952, triggered by the same push, concluded `success`. The same
   happened for `095a7e5`, `88268e7`, `54289ab` and `dae7c14`. Cause:
   `.github/workflows/deploy.yml` triggers on `push` to `main` and does not
   depend on `ci.yml`.
2. **A stuck engine call never times out.** Reproduce:
   `npx vitest run src/lib/engine/toolkit/supervision.assessment.test.ts`.
   The `it.fails` case shows a call the worker never answers still pending
   after 10 simulated minutes. In the app, the model stops updating, without
   a message, until a reload.

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Gate `deploy.yml` on CI success | No broken builds reach users | High | S |
| Watchdog per engine call, restart budget that refills | No silent hang; recovers from repeated OOM | High | M |
| WebKit Playwright project (offline included) | Evidence for the phone (iOS) claim | High | M |
| Scheduled CI: `assess:conformance`, pilot check of the demo | Automated external checks (score 4 territory) | High | M |
| `version` + compat fixtures for stored projects and `layout/diagrams.json` | Safe format changes | Medium | S |
| Releases: tags, CHANGELOG, commit id in About, SECURITY.md, issue templates | Users can name what they ran; reports have a home | Medium | S |
| `npm audit --omit=dev` or CodeQL in CI; CSP `<meta>` | Defence in depth for model text reaching HTML | Medium | S |
| Check `toolkit/api.ts` against the fetched `sysmlv2.d.ts` | Toolkit upgrades fail at compile time | Medium | S |
| In-app "Known limitations" + simulator notices for unsupported constructs | Q15 | Medium | M |
| Long-session soak test with a worker-memory budget | Catches leaks and OOM before users | Medium | M |
| README: Playwright install, conformance setup; CONTRIBUTING.md | Onboarding | Low | S |
| `docs/engine.md` failure wording; drop "engine" from two UI strings | Accuracy | Low | S |
