# Contributing to Fairtide

Thank you for helping. This page is how to set up, test and change Fairtide,
and how a change becomes a release. The README has the code map and the
documentation index; [docs/engine.md](docs/engine.md) explains how the app
talks to the SysML engine. Security problems go to [SECURITY.md](SECURITY.md),
not to issues.

## Setting up

You need Node 22.17 or later (`.nvmrc`), git, and for the engine fetch bash,
curl, `sha256sum`, tar and node (Linux has them; on macOS `sha256sum` comes
with coreutils).

```sh
npm install
scripts/fetch-toolkit.sh          # the SysML engine and its standard library into static/toolkit/
npx playwright install chromium   # the browser the end-to-end tests drive (once per machine)
npm run dev                       # http://localhost:5173
```

`npm install` reports advisories in development tools (Lighthouse CI and what
it pulls in). They never reach the site; CI fails only on advisories in
shipped code (`node scripts/audit-shipped.mjs`).

`scripts/fetch-toolkit.sh` downloads the release pinned in `toolkit.json`
and refuses it if its SHA-256 doesn't match. Run it again after `toolkit.json`
changes.

## Tests

```sh
npm test                               # unit tests (Vitest), about 4 minutes
npx vitest run src/lib/diagram         # one folder or file
npm run check && npm run lint && npm run format:check
npm run test:e2e                       # Playwright, end to end with axe (builds first)
npx playwright test tests/e2e/risk.spec.ts:54   # one test
```

- **Unit tests** sit beside the code (`*.test.ts`). Many load the real engine
  in Node (`loadHost()` in `src/lib/engine/toolkit/testing.ts`, or a real
  `Workspace` from `src/lib/create/testing.ts`); prefer that to a stand-in.
  Stand-ins are for what's outside the app: `fetch` for GitHub and the
  sign-in worker, the Systems Modeling API server (`exchange/api-mock.ts`), a
  fake `Worker` for the engine's supervision.
- **End-to-end tests** (`tests/e2e/*.spec.ts`) run the production build
  (`vite build` + `vite preview`) in Chromium with the real worker, engine and
  service worker. Most end with an axe accessibility check
  (`tests/e2e/axe.ts`). Network hosts other than the site are mocked with
  `page.route`. Variables, all optional:
  - `PW_PORT` — the preview's port (default 4173), so several checkouts can
    run side by side;
  - `PW_SIGN_IN=off` — build without "Sign in with GitHub" (the token-only
    flow); by default the e2e build has test sign-in settings;
  - `PW_CHROMIUM_PATH` — a Chromium to use instead of Playwright's own.
- **Known gaps** are kept as expected failures: `it.fails(…)` in unit tests,
  `test.fail(…)` in end-to-end tests, each with a comment starting "Known
  gap:" that says what's wrong. When you fix one, the test goes red: make it
  a plain `it(`/`test(` and remove the comment. Some tests pin a workaround
  for an engine defect and fail when the engine is fixed upstream
  (`docs/engine.md`, "Upstream requests"). Never skip or weaken a test to
  make it pass.
- **Assessment tests** (`*.assessment.test.ts`, `tests/e2e/assessment-*`)
  hold the evidence of `docs/assessment/`; they run in CI like the rest.
- **One skipped block**: `src/lib/interchange/kpar.test.ts` ("the OMG library
  archives") needs the OMG release's `sysml.library.kpar` folder at
  `../sysml-cli-main/sysml-v2-release/` beside this repository. Without it the
  block is skipped, as in CI.
- **Help and the user guide** are one text: edit `src/lib/help/content.ts`,
  then regenerate `docs/user-guide.md` with
  `UPDATE_USER_GUIDE=1 npx vitest run src/lib/help`.

Slower checks, not in `npm test`:

```sh
npm run build && npm run lighthouse     # Lighthouse budgets; needs Chrome (CHROME_PATH)
npm run bench                           # large generated models (docs/performance.md)
scripts/fetch-conformance.sh            # first: the OMG corpora into .cache/conformance/
npm run assess:conformance              # then the conformance runner (docs/assessment/01-language.md)
```

The OMG pilot implementation and SysON can check Fairtide's output; they need
Java and Docker ([docs/interop-tools.md](docs/interop-tools.md)).

## Making a change

- Work on a branch and open a pull request against `main`. CI
  (`.github/workflows/ci.yml`) runs the audit, formatting, lint, type checks,
  unit tests, the build and every end-to-end test; Lighthouse runs beside it.
- A fix comes with a test that fails without it.
- Commit subjects say what changed for the person using the app, often with
  the area first: `Risk: the matrix coloured by the policy`,
  `Save to folder: never overwrite a file changed on disk`.
- Text people read is plain and short, says what to do, and doesn't name the
  engine or the toolkit. Docs (`docs/*.md`) say what the app does now.
- Run `npx prettier --write` on what you changed, and `npm run check` and
  `npm run lint` before pushing.
- Stored data has format versions: the project record in the browser
  (`PROJECT_FORMAT`, `src/lib/project/store.ts`) and the layout file
  (`LAYOUT_FORMAT`, `src/lib/diagram/positions.ts`). Adding an optional field
  keeps the number; a change older versions would misread raises it, and the
  fixtures of earlier versions must still open (`src/lib/project/store.test.ts`,
  `src/lib/diagram/positions.test.ts`).

## Releases

The site at GitHub Pages is rebuilt from `main` each time CI passes for a
push (`.github/workflows/deploy.yml`); a commit whose CI failed is never
published. Settings → About shows the version, the commit and the build date.

A release is a tag on such a commit:

1. In a pull request, raise `version` in `package.json` (and `package-lock.json`)
   following [CHANGELOG.md](CHANGELOG.md)'s scheme, and rename its
   "Unreleased" section to the new version, with a fresh empty "Unreleased"
   above it.
2. Once it's merged and CI has passed on `main`, run **Actions → Release →
   Run workflow** on `main`. It tags the commit `v<version>` and publishes a
   GitHub release whose notes are that CHANGELOG section. It refuses if the
   tag exists, the section is missing, or CI didn't pass.
