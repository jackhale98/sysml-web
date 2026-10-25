# §9 Software quality and maintainability (+ questions 10, 14, 15)

Assessed on `origin/main` at `92cfbcf` (2026-10-23). Commands were run in this
session unless a block says otherwise. "Clone" means a fresh `git clone` at
`92cfbcf` in a scratch directory with its own `npm install`. "Worktree" means
`/home/user/wt-assess-quality`.

**Dev-environment note (not app tooling).** On this assessment machine, every
`vitest` and `playwright test` run goes through a machine-wide queue
(`/home/user/tools/test-gate`, and the shims installed by
`/home/user/tools/install-test-shims` into the main checkout's
`node_modules/.bin`). Worktrees link their `node_modules` into the main
checkout's. Running `npm install` in such a worktree rewrites the shared packages
(this happened once during the assessment and was repaired). Contributors on
their own machines have neither the queue nor the shared packages.

## Test inventory (measured)

| Layer | Files | Tests | What runs |
| --- | --- | --- | --- |
| Unit, real engine in Node | 35 | 454 | The sysml-toolkit WASM loaded by `loadHost()` (`src/lib/engine/toolkit/testing.ts:20`) and driven through `ToolkitHost`, or through a real `Workspace` (`src/lib/create/testing.ts`). |
| Unit, pure logic | 58 | 571 | Parsers, layout, emulator, CSV/XLSX, diff, caching rules: no engine and no mocks. |
| Unit with stand-ins | 15 | 124 (18 of them also on the real engine) | `fetch` stubs (GitHub, OAuth, the sign-in worker), a fake `Worker` (`toolkit/client.test.ts`), and an in-memory Systems Modeling API server written by this project (`src/lib/exchange/api-mock.ts`). |
| End to end (Playwright, Chromium only) | 34 specs | ~193 | The production build (`vite build` + `vite preview`), the real worker and WASM, and the service worker. 32 of the 34 specs run axe. Network mocks: GitHub, the sign-in worker and the API server (`page.route`), and a failing WASM fetch in `engine.spec.ts`. |
| Large model | 1 unit + 1 e2e | 7 | A generated project of about 10k lines with time budgets (`tests/unit/large-model.test.ts`, `tests/e2e/large-model.spec.ts`). |
| Performance | `tests/perf` | n/a | Benchmarks (`npm run bench`), recorded in `docs/performance.md`. Not run in CI. |
| Accessibility | axe in 32 e2e specs; Lighthouse a11y = 1 | n/a | `lighthouse.yml`, mobile and desktop. |
| Svelte components | 0 unit | 0 | The 128 `.svelte` files are exercised only by e2e. |

Totals from the run in the clone: **106 files, 1,131 tests (1,130 passed, 1
skipped)** in 139 s with 2 workers. The skipped block
(`src/lib/interchange/kpar.test.ts:232`) needs `../../../../sysml-cli-main/…`,
a checkout outside the repository, so CI and new contributors always skip it.

**Coverage** (v8, measured in the clone. `@vitest/coverage-v8@5.0.5` is not a
project dependency; it was added there with `--no-save`):

| Area (TypeScript only) | Lines | Branches |
| --- | --- | --- |
| All `.ts` under `src/` and `worker/src` (214 files) | **85.2 %** | 74.0 % |
| `engine/toolkit` (adapter, host, edits, evaluation, interchange) | 90.7 % | 77.3 % |
| `engine/toolkit/views`, `engine/toolkit/diagrams` | 95.3 %, 94.1 % | 77.7 %, 74.4 % |
| `sim` | 96.9 % | 88.5 % |
| `create` (guided forms) | 95.5 % | 81.1 % |
| `dataio` | 93.1 % | 76.8 % |
| `exchange` | 88.7 % | 77.7 % |
| `diagram` | 86.6 % | 72.2 % |
| `git` | 75.3 % | 70.9 % |
| `project` | 75.6 % | 64.0 % |
| `reports` | 75.2 % | 61.5 % |
| `review` | 66.5 % | 58.6 % |
| `offline` | 56.5 % | 68.6 % |
| `editor` | 2.3 % | 0 % |
| `.svelte` files (128) | 0 % (e2e only) | n/a |

Files with no unit coverage include `project/store.ts` (IndexedDB persistence,
5.6 %), `engine/toolkit/toolkit.worker.ts` (the worker's message loop, 0 %),
`service-worker/index.ts` (0 %), `review/review.svelte.ts` (0 %),
`reports/diagram.ts` (0 % before this assessment) and
`git/connection.svelte.ts` (12 %). These paths are reached only by e2e tests.

Reproduce (in a clone with its own `node_modules`):

```sh
npm install --no-save @vitest/coverage-v8@5.0.5
npx vitest run --coverage.enabled --coverage.provider=v8 \
  --coverage.reporter=json-summary --coverage.include='src/**' --coverage.include='worker/src/**'
```

---

### Are unit, integration, end-to-end, and regression tests covering core workflows?
- **Answer:** Yes for the core workflows. Text editing, diagram editing,
  tables, requirements and trace, budgets and checks, trade studies, the
  simulator, risk, DSM, reports, import/export, interchange, GitHub,
  offline/install and phone layout each have unit tests and at least one e2e
  spec (inventory above). Regression tests are added with fixes: for example,
  `evaluation.test.ts` is written to fail when an upstream toolkit bug is fixed
  (docs/engine.md "Upstream requests" 1). Some areas have no automated test:
  multi-hour sessions, browsers other than Chromium, and the IndexedDB store at
  unit level.
- **Evidence:** I ran the full unit suite in the clone: 1,130 passed, 1 skipped.
  CI runs every e2e spec (`.github/workflows/ci.yml`). I ran
  `landing.spec.ts`, `offline.spec.ts` and `engine.spec.ts` in the clone
  (results under "network" and "workers" below).
- **Limitations:** Chromium only (`playwright.config.ts:55`), so Safari/WebKit
  is not tested, although the product claims phone support (iOS). No
  long-session or soak test. Svelte components are tested only end to end.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** additional testing: add a WebKit Playwright project and a
  long-session test.

### Do tests exercise the actual SysML engine and application integration rather than only mocks?
- **Answer:** Yes. 454 unit tests load the real sysml-toolkit 0.10.10 WASM in
  Node and call the same `ToolkitHost` the worker runs. Guided-form tests drive
  a real `Workspace` over it (`src/lib/create/testing.ts:24`). All e2e tests run
  the production build with the real worker and WASM. The mocks sit at
  external boundaries: the GitHub REST API, the OAuth/sign-in worker, and
  Systems Modeling API servers (`api-mock.ts`, written from the OMG
  specification by this project). One internal stand-in exists: the fake
  `Worker` in `toolkit/client.test.ts`, which tests restart logic.
- **Evidence:** the inventory above. `src/lib/exchange/api-mock.ts:1-8` says it
  is used by unit tests (`api.test.ts`, `sync.test.ts`) and e2e
  (`exchange.spec.ts`).
- **Limitations:** No test runs against a real API server (OMG pilot, SysON)
  or the real GitHub API, so those boundaries are verified only against this
  project's reading of the specifications. The worker message loop
  (`toolkit.worker.ts`) is covered only by e2e.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** additional testing: run the exchange tests against a real
  pilot-implementation or SysON container.

### Does CI catch broken builds, type errors, and regressions?
- **Answer:** CI (`ci.yml`) runs on every push and pull request: `npm ci`,
  toolkit fetch with SHA-256 check, `format:check`, `lint`, `check`
  (svelte-check plus `tsc` for the service worker and the sign-in worker), unit
  tests, `build`, and every e2e spec with axe (2 retries on CI).
  `lighthouse.yml` enforces performance ≥ 0.9, accessibility = 1, best
  practices ≥ 0.95 and SEO ≥ 0.9 on mobile and desktop. **But the GitHub Pages
  deploy (`deploy.yml`) runs on every push to `main` independently of CI.** It
  neither `needs` CI nor waits on it, so a red build ships.
- **Evidence:** GitHub Actions history, read in this session. `main@92cfbcf`:
  CI run 39892755899 **failed**
  (`risk-review.spec.ts:166` failed all 3 attempts; `files.spec.ts:70`
  flaky). Deploy run 39892755952 **succeeded** and published that commit. The
  last 81 CI runs on `main` (2026-10-21 to 2026-10-23): 60 success, 6 failure,
  15 cancelled (superseded by `cancel-in-progress`). Recurring e2e failures in
  the logs: `risk-review.spec.ts:54` and `:166` (an Undo toast never
  appears), and `files.spec.ts:70` (command palette, flaky). Re-runs of the
  intermittent tests the lead listed: see "Flaky tests" below.
- **Limitations:** Branch protection on `main` could not be inspected. The
  flaky-test signal is diluted by `retries: 2` on CI. Lighthouse does not gate
  deploy either.
- **Status:** Verified
- **Score:** 2 (Fairtide): CI catches the failures, but nothing stops a failing
  commit from reaching users.
- **Next action:** bug fix: make `deploy.yml` depend on CI (`workflow_run` on CI
  success, or one workflow with `needs`).

### Are dependencies constrained sufficiently for reproducible builds?
- **Answer:** Mostly. `package-lock.json` (lockfile v3) is committed, and every
  workflow installs with `npm ci`. `package.json` uses `^` ranges, but the lock
  governs them. A fresh `npm install` in the clone left the lock unchanged. The
  engine is pinned by version, URL and SHA-256 in `toolkit.json`.
  `scripts/fetch-toolkit.sh` verifies the checksum and refuses a mismatch. Node
  is pinned only to a major version (`.nvmrc` `22`, `engines` `>=22.17`, CI
  `node-version: 22`). GitHub Actions are pinned by major tag (`@v4`), not by
  commit SHA. Lighthouse uses Chrome `stable`. The manual worker deploy runs
  `npx --yes wrangler@4`, although `worker/package.json` pins `4.151.3`.
- **Evidence:** I ran `scripts/fetch-toolkit.sh` in the clone: it downloaded
  and verified the toolkit in 1 s, and the result is byte-identical to the
  shared copy (`cmp`). With the `sha256` in `toolkit.json` altered, it exits 1
  with `FAILED` and leaves the existing `static/toolkit/` in place.
  `npm install` in the clone: 546 packages, lockfile unchanged.
- **Limitations:** The toolkit tarball is fetched from GitHub Releases at build
  time. If the release disappears, builds fail, because the asset is not
  vendored. Dependabot (weekly, npm and actions) will open update PRs, and
  their safety relies on CI.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** None required. Optional: pin Node to a minor version and
  actions to commit SHAs.

### Can the application operate without network access after required assets are available locally?
- **Answer:** Yes, by design. The service worker (`src/service-worker/index.ts`,
  rules in `src/lib/offline/caching.ts`) caches the app shell on install. It
  caches the engine (WASM and standard library) after first use
  (`pwa.warmEngineCache()` in `engine/instance.ts:42`). Stored projects live
  in IndexedDB.
- **Evidence:** `tests/e2e/offline.spec.ts` covers five cases. The landing
  page installs the shell but not the engine (`:43`). The demo opens and is
  analysed offline with the engine from the cache (`:62`). Stored projects and
  the project list open offline (`:94`). New versions are offered and not
  forced (`:120`), and a reload for a new version keeps the latest edit
  (`:146`). Unit: `caching.test.ts` (12), `install.test.ts` (11),
  `launch.test.ts` (7). Run in this session: RESULT_OFFLINE.
- **Limitations:** Offline means an already visited origin. GitHub, API
  servers and sign-in need the network, as expected. Tested in Chromium only;
  iOS Safari's service-worker storage eviction is not tested.
- **Status:** RESULT_OFFLINE_STATUS
- **Score:** 3 (Fairtide)
- **Next action:** additional testing: offline e2e in WebKit.

### Are errors handled explicitly with actionable messages and useful diagnostics?
- **Answer:** Largely. Engine start-up failure is retried once, then reported in
  the status bar ("Model can't be read"), in a persistent toast, and in the
  problems list with the reason ("Fairtide stopped reading the model (…).
  Reload the page to try again."). Imports list what was skipped and why
  (`import.test.ts:209`, `interchange.test.ts:203`). Unsupported table
  filters, trade-study forms and evaluator expressions produce a written
  reason (`views.test.ts:402`, `emulator.test.ts:242`). 29 call sites raise
  error toasts. 112 `catch` blocks fall back silently. Most are legitimate
  feature probes (storage estimate, share sheet, optional checks). One is
  worth review: `session.svelte.ts:68` treats a failed IndexedDB read as "not
  stored". For the `demo` id, that opens the bundled demo in place of the
  person's edited copy (flagged for §8).
- **Evidence:** `tests/e2e/engine.spec.ts:57` (WASM fetch fails twice: retried
  once, message shown, axe clean). Run in this session: RESULT_ENGINE.
- **Limitations:** `docs/engine.md:669-676` still says the status bar shows
  "Engine error"; the app now says "Model can't be read". Two user-facing
  strings name the engine, which the product avoids elsewhere: "The engine
  cannot evaluate this yet: …" (`toolkit/evaluation.ts:891`) and "The engine
  has N notes" (`sim/StateEmulator.svelte:614`).
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (docs): update `docs/engine.md` "When the toolkit
  fails". Review the silent `catch` in `session.load`.

### Are background workers monitored, recoverable, and prevented from blocking the interface indefinitely?
- **Answer:** The engine runs in a Web Worker, so it never blocks the main
  thread. `startToolkit` (`toolkit/client.ts:100-115`) watches `onerror` and
  `fatal` messages: a WASM trap (`RuntimeError: unreachable`) or out-of-memory
  terminates the worker. It starts a new one **once per page lifetime**, and
  calls in flight are re-sent. A second death is final: every call rejects with
  a reload message and `onFailure` toasts once. **There is no time limit.** A
  call the worker never answers (an engine stuck in a loop) stays pending, and
  every later call queues behind it in the single-threaded worker. Analysis
  silently stops updating until the person reloads. Standard-library JSON
  export uses a second, throwaway worker (`startSpareEngine`, `restarts: 0`).
- **Evidence:** New tests in
  `src/lib/engine/toolkit/supervision.assessment.test.ts`:
  - a crash with three calls in flight restarts once and answers all three
    (passes);
  - a second fatal error later in the session is final and reported once
    (passes);
  - `it.fails` (known gap): a call that is never answered is still pending
    after 10 simulated minutes.

  Existing tests: `toolkit/client.test.ts` (5) and `engine.spec.ts:57` (real
  worker, WASM unavailable). Run in this session: RESULT_SUPERVISION.
- **Limitations:** The restart budget is one per page, not per incident. After
  one out-of-memory in a long session, the next one ends analysis.
  Out-of-memory on the real worker is not reproduced by a test;
  `docs/performance.md:171` records it happening on 100k-line models.
- **Status:** Verified (crash recovery); gap verified (no hang timeout)
- **Score:** 2 (Fairtide)
- **Next action:** planned capability: a per-call watchdog that terminates and
  restarts a worker that has not answered within a bound (scaled to model
  size), and a restart budget that refills after a healthy period.

### Are large models tested for memory usage, startup time, editing latency, and long-running sessions?
- **Answer:** Startup, editing latency and memory: yes, for generated models of
  10k, 50k and 100k lines. In CI, `large-model.test.ts` holds time budgets at
  10k lines, and `large-model.spec.ts` checks that a 10k-line project opens
  within budget and stays usable. `npm run bench` measures more (recorded in
  `docs/performance.md`: worker WASM memory 333 MiB at 10k and 1,153 MiB at
  50k; a keystroke re-analysis takes about 1.1 s at 10k and 7 s at 50k).
  Long-running sessions: **not tested.** WASM memory only grows, and the one
  restart (above) is the only relief.
- **Evidence:** cited, not re-run by me. §10 (perf-ux) owns the measurements.
- **Limitations:** The benchmarks are not in CI; only the 10k budgets are. No
  low-memory device runs. No soak test.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing: a 30-minute scripted editing session that
  records worker memory.

### Can the engine be updated without requiring a rewrite of all application views?
- **Answer:** Upgrading the toolkit: yes. Replacing it with a different
  engine: only the adapter needs rewriting, but the adapter is large. The UI
  depends on the engine-neutral contract: `EngineApi`
  (`src/lib/engine/protocol.ts`, 30 methods) and the result types in
  `engine/types.ts` (1,087 lines). 104 UI/app files import only those. Outside
  `src/lib/engine`, four app files import toolkit modules directly
  (`diagram/behaviorEdits.ts` → `toolkit/machines.ts`; `diagram/relationships.ts`,
  `viewEdits.ts`, `duplicate.ts` → `toolkit/header.ts`), and they use
  text-level helpers, not toolkit types. The toolkit-specific layer
  (`src/lib/engine/toolkit/`, excluding tests) is 17,909 lines. It holds the
  model adapter and all views, diagrams, evaluation, trade, interchange and
  edit logic, so a different engine means re-implementing that layer behind
  `EngineApi`. The toolkit's wasm API is typed by hand
  (`toolkit/api.ts`, 191 lines) because the package is fetched at build time.
  A toolkit upgrade that changes a signature is therefore caught only by tests,
  not by the compiler. The project has already swapped engines once (decision
  #16, `docs/PLAN.md:113`), with the UI unchanged.
- **Evidence:** `grep` counts above. `docs/engine.md` "Adding a method".
- **Limitations:** Upgrading the toolkit is a `toolkit.json` change plus the
  real-engine unit suite. Nothing records which hand-typed signatures were
  checked against which toolkit version.
- **Status:** Verified (by inspection and counts)
- **Score:** 2 (Fairtide)
- **Next action:** additional testing: generate `api.ts` from (or check it
  against) the fetched `sysmlv2.d.ts` in `fetch-toolkit.sh` or `npm run check`.

### Are public interfaces and data formats documented, versioned, and tested for compatibility?
- **Answer:** Documented, partly tested, not versioned.
  - **The model** is standard SysML v2 text, so it needs no Fairtide format.
  - **The layout sidecar** `layout/diagrams.json`
    (`{ "<view>:<scope>": { "<nodeId>": [x, y], "#hidden": [...], "#added": [...] } }`)
    is documented in `diagram/positions.ts:1-13` and the user guide. It has
    **no version field**. Readers ignore unknown keys and invalid values
    (`parseLayout`, tested in `positions.test.ts:45`).
  - **Saved views and reports** are SysML `view`s typed by the bundled
    `ModelViews`/`Reporting` libraries (docs/table-rendering.md).
  - **Browser storage** is the IndexedDB database `sysml-web` at schema
    version 1 (`project/store.ts:51`) with no migration code. Optional fields
    added later are handled ad hoc (`folderTexts` absent →
    `session.svelte.ts:81`; a legacy single GitHub account →
    `account.test.ts:246`).
  - **Exports** (.kpar, SysML v2 JSON, the Systems Modeling API) follow the OMG
    formats (docs/interchange.md).

  Nothing tests that a project stored by an older build opens in a newer one.
- **Evidence:** code references above. No fixture of an older `StoredProject`
  or older layout file exists.
- **Limitations:** No version in `layout/diagrams.json` or in the stored
  project record, so a future incompatible change cannot be detected.
- **Status:** Partially verified
- **Score:** 1 (Fairtide)
- **Next action:** additional testing: add a `version` to the layout file and
  stored records, and fixtures of records written by today's build that future
  builds must open.

### Are dependency vulnerabilities and unsafe content handling checked automatically?
- **Answer:** Partly. Dependabot is configured (weekly, npm and GitHub
  Actions; `.github/dependabot.yml`). There is no CodeQL, no `npm audit` step
  in CI and no secret scanning configured in the repository. `npm audit` today:
  **0 vulnerabilities in production dependencies**. 14 in dev dependencies (11
  high, 1 moderate, 2 low), all through `@lhci/cli` (lighthouse →
  puppeteer-core → `extract-zip`, `tmp`, `basic-ftp`, `uuid`); they run only
  in Lighthouse CI. The sign-in worker: 0. Unsafe content:
  - Markdown (README/TOUR) is parsed to tokens, never HTML, and only `http(s)`
    links become anchors (`markdown/markdown.ts:1-5`,
    `DocumentView.svelte:76`).
  - There are two `{@html}` sites. One is a constant redirect script
    (`routes/+page.svelte:159`). The other is the report interconnection SVG
    (`reports/ReportView.svelte:309`), built by `reports/diagram.ts` with every
    name escaped.
  - Printed tables escape (`dataio/export.ts:118`, `export.test.ts:23`). The
    SVG export escapes (`diagram/export/svg.test.ts:124`).
  - There is no Content-Security-Policy. GitHub Pages cannot set headers, and
    `src/app.html` has no CSP `<meta>`.
- **Evidence:** I ran `npm audit` and `npm audit --omit=dev` in the clone and
  in `worker/`. New test `src/lib/reports/escaping.assessment.test.ts` builds
  the demo's ICD report on the real toolkit. It adds a part named
  `<img src=x onerror="alert(1)">` with a port named
  `<script>alert(2)</script>` and checks that the diagram SVG contains them
  only escaped. Result: RESULT_ESCAPING.
- **Limitations:** Escaping is by convention per site, with no automated check
  that new `{@html}`/`innerHTML` uses are safe (ESLint's
  `svelte/no-at-html-tags` is disabled inline at each site). No CSP as a
  second line of defence.
- **Status:** Verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing: add CodeQL (or `npm audit --omit=dev
  --audit-level=high`) to CI and a CSP `<meta>` in `app.html`.

### Can a new contributor reproduce the development environment using repository documentation?
- **Answer:** Yes on Linux, with two undocumented steps. I followed the README
  literally in a fresh clone (Node 22.22.0, npm 10.9.4):

  | README step | Result |
  | --- | --- |
  | Node 22.17+ | 22.22.0 present. `.nvmrc` says `22`. |
  | `npm install` | OK, 12 s. Prints "14 vulnerabilities" (dev-only, see above) with no explanation. |
  | `scripts/fetch-toolkit.sh` | OK, 1 s. Needs bash, curl, `sha256sum`, tar and node: fine on Linux, unverified on macOS/Windows. |
  | `npm run dev` | OK. `/`, `/p/demo` and `/toolkit/sysmlv2_bg.wasm` return 200 on `:5173`. |
  | `npm test` | OK: 1,130 passed, 1 skipped (needs a checkout outside the repo, undocumented). |
  | `npm run check`, `lint`, `format:check` | OK, 0 errors (svelte-check: 5,168 files). |
  | `npm run test:e2e` | **Undocumented prerequisite:** Playwright's Chromium (`npx playwright install chromium`, as CI does). Worked here only because browsers were preinstalled. Subset run in the clone: RESULT_CLONE_E2E. |
  | `npm run lighthouse` | Needs Chrome (`CHROME_PATH`). Not run. |

  For modifying the code: `docs/engine.md` "Adding a method", the code map in
  the README, and the per-area docs are adequate. There is no CONTRIBUTING
  guide (branching, commit and PR conventions, how to run one e2e spec, the
  `PW_PORT`/`PW_SIGN_IN` variables, which live only in
  `playwright.config.ts`).
- **Evidence:** the clone run above (this session).
- **Limitations:** Not tried on macOS or Windows. Network access to GitHub
  Releases is required for the toolkit.
- **Status:** Verified (Linux)
- **Score:** 3 (Fairtide)
- **Next action:** additional testing: add the Playwright install step and a
  short CONTRIBUTING.md.

### Are known limitations and technical debt tracked explicitly?
- **Answer:** In documents, yes: `docs/PLAN.md` ("Next", "Not doing, or
  later", risks, decision log, open questions); `docs/engine.md` "Upstream
  requests" (15 numbered toolkit bugs, each with a minimal reproduction and the
  app's workaround); `docs/simulator.md` "Not supported";
  `docs/interchange.md` "What doesn't, and why"; `docs/performance.md`
  "Remaining limits". The code has no TODO/FIXME markers. Some workarounds
  are tied to tests that fail when upstream is fixed
  (`evaluation.test.ts`). Not tracked: an issue tracker or labels in the
  repository (no `.github/ISSUE_TEMPLATE`), and owners or dates for debt
  items.
- **Evidence:** the files cited.
- **Limitations:** Docs drift (e.g. "Engine error" above).
- **Status:** Verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing: file the upstream requests and link them
  from `docs/engine.md`.

### Is there a clear policy for releases, compatibility, migrations, and bug reports?
- **Answer:** No. `package.json` is at version `0.0.1`, unchanged. There are no
  git tags, GitHub releases or CHANGELOG. Every push to `main` deploys (see the
  CI block). Settings › About shows the app version (`0.0.1`) and the toolkit
  version, but not a build or commit id, so two deployments cannot be told
  apart. There is no compatibility or migration policy for stored projects or
  `layout/diagrams.json`, no SECURITY.md, no issue templates, and no in-app
  "report a problem" link.
- **Evidence:** `git tag` (empty), `src/lib/version.ts`,
  `Settings.svelte:740-760`, `.github/` contents.
- **Limitations:** n/a
- **Status:** Verified (absent)
- **Score:** 1 (Fairtide)
- **Next action:** planned capability: tagged releases with a changelog, the
  commit id in About, a SECURITY.md and issue templates.

## Prioritized questions

### 10. Do automated tests cover the actual engine, UI, and integration boundaries?
- **Answer:** Engine: yes, extensively (454 unit tests on the real WASM in
  Node, plus every e2e test in the browser worker). UI: yes, through 34
  Playwright specs on the production build with axe, but only in Chromium, and
  with no unit tests of Svelte components. Integration boundaries: the worker
  boundary is tested with a stand-in (crash and restart) and end to end (start
  failure). The GitHub, sign-in worker and Systems Modeling API boundaries are
  tested only against mocks written by this project. The service worker and
  IndexedDB are tested only end to end.
- **Evidence:** inventory and coverage above. CI history.
- **Limitations:** No WebKit or Firefox. No real external servers. No
  hang/timeout test on the worker (gap shown by
  `supervision.assessment.test.ts`).
- **Status:** Verified
- **Score:** 3 (Fairtide). It would be 4 only with checks by another tool
  against a real server.
- **Next action:** additional testing: WebKit project, and a pilot or SysON
  container job.

### 14. Can a new contributor build, test, and modify the project using only repository documentation?
- **Answer:** Yes on Linux. Every README step worked in a fresh clone. Two
  prerequisites are not written down: Playwright's browser install for e2e, and
  the external checkout one skipped unit test needs. "Modify" is supported by
  `docs/engine.md` and the README code map. There is no CONTRIBUTING guide.
- **Evidence:** contributor block above.
- **Limitations:** macOS and Windows not tried. The fetch script assumes GNU
  `sha256sum`.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** add the missing prerequisites to the README.

### 15. Are unsupported features, known bugs, and interchange limitations visible to users?
- **Answer:** Interchange and import limitations are visible in the app. Other
  limitations are mostly visible only in the docs.
  - **Visible in the app:**
    - interchange imports report what came across and what was left out, with
      a downloadable full list (`interchange.ts:705-747`, e2e
      `exchange.spec.ts:97`/`:171`);
    - Excel/CSV import lists skipped rows and left-out values (e2e
      `data-io.spec.ts:122`);
    - unsupported table filters give a warning (`views.test.ts:402`);
    - checks the evaluator cannot do say so ("cannot evaluate this yet");
    - simulator guards and effects it cannot evaluate give a reason
      (`emulator.test.ts:242`), and the toolkit's notes on a machine are
      listed (`StateEmulator.svelte:609`);
    - diagrams list elements a view's filter leaves out
      (`DiagramCanvas.svelte:704`);
    - `all X` in a trade study is reported as not supported (`trade.ts:329`);
    - the JSON round trip's loss of comments and layout is explained in the
      in-app Help (same text as `docs/user-guide.md` "Exchange models").
  - **Docs only:**
    - the simulator's "Not supported" list (history states, `terminate`, `send`
      to self, deferred signals; `docs/simulator.md:115`): I found no in-app
      notice when a machine uses them;
    - the 15 known toolkit bugs (`docs/engine.md` "Upstream requests");
    - the performance limits (`docs/performance.md`);
    - the unsupported roadmap items.

  There is no in-app "known issues" or release-notes page.
- **Evidence:** the tests cited. I did not open the app to check each
  simulator construct; the §5 report owns that.
- **Limitations:** Visibility of individual unsupported SysML constructs in
  diagrams and editors is assessed in §1/§2.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** planned capability: a "Known limitations" page in Help, fed
  by the docs, and simulator notices for history, `terminate` and `send`.

## Flaky tests (the lead's list)

RESULT_FLAKY

## Section score table

| Sub-area | Score | Note |
| --- | --- | --- |
| Test coverage of core workflows | 3 | 1,131 unit + ~193 e2e; 85 % TS line coverage; Chromium only |
| Real engine vs mocks | 3 | 454 unit tests on the real WASM; mocks only at external services |
| CI gating | 2 | Thorough CI, but deploy is not gated on it (a red `main` shipped) |
| Reproducible builds | 3 | Lockfile + `npm ci`, toolkit SHA-256 pinned; Node major only |
| Offline operation | 3 | e2e on Chromium |
| Error handling | 2 | Engine failure explicit; docs drift; some silent fallbacks |
| Worker supervision | 2 | Crash restart once; no hang timeout (`it.fails` test) |
| Large models / long sessions | 2 | 10k budgets in CI; no soak test |
| Engine replaceability | 2 | Clean `EngineApi`; 18k-line toolkit layer; hand-typed WASM API |
| Data formats and compatibility | 1 | Documented; unversioned; no compat fixtures |
| Security automation and content safety | 2 | Dependabot, escaping tested; no CodeQL/audit in CI, no CSP |
| Contributor setup (Q14) | 3 | README works on Linux; two undocumented prerequisites |
| Limitations and debt tracking | 2 | Thorough docs; no issue tracker |
| Release/compat/bug policy | 1 | None |
| Q10 tests across boundaries | 3 | |
| Q15 limitations visible in the app | 2 | Interchange yes; simulator and toolkit bugs docs-only |

## Critical findings

None meets the brief's definition of critical (silent data loss, file
deletion, unreported semantic corruption, misleading results, credential
leak). Two high-priority findings:

1. **A commit that fails CI is deployed to users.** Reproduce: `main@92cfbcf`.
   CI run 39892755899 concluded `failure` (`risk-review.spec.ts:166`).
   Deploy-to-Pages run 39892755952, triggered by the same push, concluded
   `success`. Cause: `.github/workflows/deploy.yml` triggers on `push` to
   `main` with no dependency on `ci.yml`.
2. **A stuck engine call never times out.** Reproduce:
   `npx vitest run src/lib/engine/toolkit/supervision.assessment.test.ts`. The
   `it.fails` case shows that a call the worker never answers is still pending
   after 10 simulated minutes. In the app, the model stops updating with no
   message until a reload.

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Gate `deploy.yml` on CI success | Stops broken builds reaching users | High | S |
| Per-call watchdog and refilling restart budget in `startToolkit` | No silent hang; recovers from repeated OOM in long sessions | High | M |
| Version field + compat fixtures for stored projects and `layout/diagrams.json` | Safe future format changes | Medium | S |
| Releases: tags, CHANGELOG, commit id in About, SECURITY.md, issue templates | Users and auditors can name what they ran; bug reports have a home | Medium | S |
| WebKit Playwright project (+ offline in WebKit) | Phone (iOS) claim gets evidence | High | M |
| CodeQL or `npm audit --omit=dev` in CI; CSP `<meta>` | Defence in depth for model-text-to-HTML paths | Medium | S |
| Check `toolkit/api.ts` against the fetched `sysmlv2.d.ts` | Toolkit upgrades fail at compile time, not at runtime | Medium | S |
| CI job against a real pilot/SysON API container | Interop evidence beyond the in-house mock | High | M |
| README: Playwright install; CONTRIBUTING.md | Smoother onboarding | Low | S |
| In-app "Known limitations" (Help) + simulator notices for unsupported constructs | Q15 | Medium | M |
| Long-session soak test with worker-memory budget | Catches leaks and OOM before users | Medium | M |
| Fix `docs/engine.md` "When the toolkit fails" wording; drop "engine" from two UI strings | Accuracy | Low | S |
