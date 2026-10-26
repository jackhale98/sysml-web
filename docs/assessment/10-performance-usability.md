# 10 — Performance, usability, accessibility and deployment

Section §10 of the checklist, and prioritized question 11 (how performance scales with
model size, diagnostic count and lower-memory devices).

Assessed on `claude/assess-perf-ux` (main at 68cb9db merged in). Scores are Fairtide's
unless marked "engine". Every figure here was measured in this session unless it says
otherwise; nothing is quoted from `docs/performance.md` without a re-run beside it.

**The machine.** A shared 4-core Linux container, 15 GiB RAM, no swap; Node 22; headless
Chromium 141 (Playwright 1.56, build `chromium-1194`, the only browser installed). Every
benchmark ran alone through the machine-wide test gate (load average 0.7–1.6 during the
engine runs). Single runs on this machine vary by ±10–20 %; read medians against medians.

**What was measured, how.** Generated projects from `tests/perf/generate.ts` (the
drone demo's style; no problems): 10,546 lines in 66 files ("10k"), 50,020 in 304 ("50k"),
99,943 in 605 ("100k"), and the drone demo itself (2,605 lines in 22 files, of which six
are project libraries). Every run is kept and summarised as median / p90 / max
(nearest-rank; with 3–7 runs p90 is usually the max).

New evidence:

| File | What |
| --- | --- |
| `tests/perf/assessment-engine.bench.ts` (+ `assessment-vitest.config.ts`) | Engine in Node through `ToolkitHost`, every run kept: open, keystroke, checks alone, the app's own metadata checks alone, completion, hover, tables, a diagram, WebAssembly memory |
| `tests/perf/assessment-perf-ux.bench.ts` (+ `assessment-playwright.config.ts`) | The built app in Chromium, every run kept: cold start, repeat load from the cached engine snapshot, first and second edit, CPU time and peak resident memory of the renderer, JS heap, worker memory; desktop, or phone emulation with the whole renderer slowed |
| `tests/perf/assessment-duty-cycle.mjs` | Slows a browser's renderer processes, workers included, by pausing them (SIGSTOP/SIGCONT) for ¾ of every 20 ms; DevTools CPU throttling cannot slow workers |
| `tests/perf/assessment-stats.ts` | median / p90 / max tables from a run's JSON |
| `tests/e2e/assessment-perf-ux.spec.ts` | 5,000 problems; navigation at 10k; axe on every demo screen in light and dark; the exchange-dialog contrast flake, made deterministic; keyboard-only path and focus return; recovery from failed imports, an invalid edit and a runaway machine; every request host; four screen sizes; a first-time user's guided walk-through; Settings → About |
| `tests/e2e/assessment-perf-ux-deploy.spec.ts` + `tests/perf/assessment-static-server.mjs` | A sub-path build without sign-in, served by a plain static server with a strict CSP, all other hosts refused (skipped unless `ASSESS_DEPLOY_URL` is set) |
| (no new file) | `tests/perf/engine.bench.ts` run in a worktree at the perf merge (`b49281c`) before and after main's run, for the checks slowdown |

Commands (worktree root; build first with `npm run build`, preview on `PW_PORT`):

```
ASSESS_SIZES=demo,10000,50000,100000 ASSESS_RUNS=demo:7,10000:5,50000:5,100000:3 ASSESS_OUT=engine.json \
  npx vitest run --config tests/perf/assessment-vitest.config.ts
ASSESS_SIZES=demo,10000,50000,100000 ASSESS_RUNS=demo:7,10000:5,50000:3,100000:3 ASSESS_OUT=desktop.json \
  PW_PORT=4328 npx playwright test --config tests/perf/assessment-playwright.config.ts
ASSESS_DEVICE=phone ASSESS_DUTY=4 ASSESS_SIZES=demo,10000,50000,100000 ASSESS_RUNS=demo:5,10000:3,50000:2,100000:1 \
  ASSESS_OUT=phone.json PW_PORT=4328 npx playwright test --config tests/perf/assessment-playwright.config.ts
node --experimental-strip-types tests/perf/assessment-stats.ts engine.json
PW_PORT=4328 npx playwright test tests/e2e/assessment-perf-ux.spec.ts --workers=2
# baseline for the checks: in a worktree at b49281c
BENCH_LINES=50000 BENCH_RUNS=3 npx vitest run --config tests/perf/vitest.config.ts
# self-hosting
BASE_PATH=/tools/fairtide PUBLIC_GITHUB_CLIENT_ID= PUBLIC_GITHUB_APP_SLUG= PUBLIC_SYNC_WORKER= npm run build
node tests/perf/assessment-static-server.mjs build /tools/fairtide 4329 --csp &
ASSESS_DEPLOY_URL=http://localhost:4329/tools/fairtide/ PW_PORT=4328 npx playwright test tests/e2e/assessment-perf-ux-deploy.spec.ts
```

## Runs in this session

| Run | Result |
| --- | --- |
| Engine bench, demo ×7, 10k ×5, 50k ×5, 100k ×3 (Node) | all runs completed, none failed; 9.5 min |
| `engine.bench.ts` at `b49281c`, 50k ×3, before and after the above | completed; checks 2518 / 2287 ms |
| Browser bench, desktop: demo ×7, 10k ×5, 50k ×3, 100k ×3 | all 18 runs completed; 12.6 min |
| Browser bench, phone emulation, renderer slowed 4×: demo ×5, 10k ×3, 50k ×2, 100k ×1 | all 11 runs completed; 25 min |
| `assessment-perf-ux.spec.ts` (17 tests) | final run: 17 passed in 5.7 min, 3 of them `test.fail` known gaps failing as stated; earlier runs fixed mistakes in the tests themselves, and the walk-through once timed out on the late-opening view (see that question) |
| `assessment-perf-ux-deploy.spec.ts` against a sub-path build with a strict CSP | 1 passed ("refused: none; problems: none") |
| Two builds of the same commit, `sha256sum` of `build/` | 8 of 230 files differ (the build-time version stamp) |
| `npm run check` | 0 errors, 0 warnings |


## Measurements

### Engine in Node (the worker's work, plus the page's model building)

ms unless noted; median / p90 / max. "Checks" is `host.checks` right after the views
(as the page asks); "metadata checks" is the app's own `annotationChecks` alone, which
runs inside every checks call.

| | demo (7 runs) | 10k (5) | 50k (5) | 100k (3) |
| --- | --- | --- | --- | --- |
| open: analysis | 167 / 218 / 218 | 1083 / 1291 / 1291 | 6760 / 7884 / 7884 | 16930 / 59100¹ / 59100 |
| open: checks | 57 / 89 / 89 | 482 / 505 / 505 | 4616 / 4970 / 4970 | 13655 / 14288 / 14288 |
| — of which metadata checks | 2 / 6 / 6 | 44 / 55 / 55 | 1417 / 1570 / 1570 | 6402 / 7251 / 7251 |
| open: page model (elements, tree, requirements) | 2 / 3 / 3 | 13 / 14 / 14 | 67 / 79 / 79 | 133 / 145 / 145 |
| keystroke: analysis | 166 / 169 / 169 | 1022 / 1029 / 1029 | 6186 / 6368 / 6368 | 15355 / 16523 / 16523 |
| keystroke: checks | 57 / 58 / 58 | 456 / 587 / 587 | 4489 / 4892 / 4892 | 13244 / 14637 / 14637 |
| completion (first after the edit) | 1 / 31 / 31 | 25 / 107 / 107 | 45 / 181 / 181 | 93 / 422 / 422 |
| hover (first after the edit) | 32 / 60 / 60 | 205 / 269 / 269 | 1273 / 1692 / 1692 | 2685 / 2983 / 2983 |
| table: every requirement | — | 8 / 16 / 16 | 35 / 43 / 43 | 92 / 101 / 101 |
| table: product bill of materials | — | 26 / 39 / 39 | 773 / 789 / 789 | 2937 / 3025 / 3025 |
| diagram: product interconnection | — | 6 / 8 / 8 | 32 / 62 / 62 | 63 / 66 / 66 |
| metadata annotations | 74 | 456 | 2122 | 4229 |
| WebAssembly memory (MiB) | 172 | 333 | 1150 | 1761 |

¹ The first 100k open in the process: the adapter took 51.7 s (9.0–9.6 s in the other
two runs) while the instance grew to 1.76 GiB.

### The checks at 50k (and 100k) are slower than documented — confirmed, and found

`docs/performance.md` ("Re-checked on 2026-10-23") reports checks at 50k of 4.3–4.5 s
against 2.8–2.9 s the day before, not looked into. Measured here, same machine, same
generator, interleaved:

| checks at 50k, ms | open | keystroke |
| --- | ---: | ---: |
| perf merge `b49281c`, run 1 (median of 3) | 2518 | 2445 |
| main (68cb9db), median of 5 (p90) | 4616 (4970) | 4489 (4892) |
| perf merge `b49281c`, run 2 (median of 3) | 2287 | 2323 |

So 1.8–2.0× at 50k, and at 100k 13.4 s against the documented 5.2 s (2.6×). Most of
the increase is the app's own metadata checks (`views/annotationChecks.ts`, added with
the risk libraries, 7b0fc63): 44 ms at 10k, 1.4 s at 50k, 6.4 s at 100k — 4.65× the
annotations cost 32×, 2× cost 4.5×: quadratic. The cause is `metadataDefinition`
(`src/lib/engine/toolkit/views/domains.ts:65-77`), which scans every annotation and then
every record of the model for each annotation it is asked about, and is called once per
annotation by `valueProblems` (`views/assertions.ts:35`) and again by `riskProblems`
(`views/riskLines.ts:316`). Caching it per view context (as `typeDomain` and
`typeInvariants` already are) should take the metadata checks back to tens of ms. The
remaining ~0.6 s at 50k over the baseline was not attributed (candidates: the new
requirement-ID checks, more per-analysis checks since). Not critical (nothing is wrong,
only slow), but at 100k every pause in typing costs ~16 s of analysis plus ~13 s of
checks, during which completion and hover wait (one worker).

### App in Chromium, desktop (1440×900, CPU not slowed)

The built app, each run in a fresh browser context. ms from navigation (page clock)
unless noted; median / p90 / max. "Engine ready" is the worker's library loaded;
"repeat" is a reload once the engine's prepared library snapshot is in Cache Storage (it
is fetched when the page goes idle after the first open). An edit is one character in a
doc comment of the largest project file, typed in the editor; "next frame" is from the
key event to the next frame, "analysed"/"checked" the page's `sysml:analysed` /
`sysml:checked` marks. Renderer RSS is the peak resident set (`VmHWM`) of the renderer
process, which holds the page and the engine's worker.

| | demo (7 runs) | 10k (5) | 50k (3) | 100k (3) |
| --- | --- | --- | --- | --- |
| cold: engine ready | 1745 / 1890 / 1890 | 1798 / 1875 / 1875 | 1721 / 1747 / 1747 | 1791 / 1797 / 1797 |
| cold: "Model ready" | 2446 / 2609 / 2609 | 3611 / 3753 / 3753 | 11606 / 11697 / 11697 | 27074 / 27795 / 27795 |
| cold: checks shown | 2539 / 2714 / 2714 | 4078 / 4251 / 4251 | 17424 / 17548 / 17548 | 42586 / 43567 / 43567 |
| cold: longest main-thread task | 137 / 178 / 178 | 53 / 85 / 85 | 198 / 206 / 206 | 350 / 385 / 385 |
| repeat: engine ready (snapshot) | 485 / 512 / 512 | 510 / 546 / 546 | 547 / 581 / 581 | 620 / 732 / 732 |
| repeat: "Model ready" | 1153 / 1251 / 1251 | 2287 / 2404 / 2404 | 10417 / 10640 / 10640 | 26610 / 27480 / 27480 |
| repeat: checks shown | 1231 / 1340 / 1340 | 2780 / 2906 / 2906 | 16311 / 16397 / 16397 | 42429 / 43595 / 43595 |
| edit 1: key → next frame | 23 / 102 / 102 | 29 / 41 / 41 | 80 / 99 / 99 | 190 / 207 / 207 |
| edit 1: → analysed | 342 / 413 / 413 | 1396 / 1618 / 1618 | 7594 / 8163 / 8163 | 18609 / 18917 / 18917 |
| edit 1: → checked | 428 / 480 / 480 | 1888 / 2141 / 2141 | 13453 / 14653 / 14653 | 35116 / 35491 / 35491 |
| edit 2: key → next frame | 19 / 23 / 23 | 19 / 22 / 22 | 64 / 66 / 66 | 204 / 215 / 215 |
| edit 2: → analysed | 257 / 257 / 257 | 1060 / 1230 / 1230 | 6157 / 6243 / 6243 | 15994 / 16703 / 16703 |
| edit 2: → checked | 322 / 341 / 341 | 1562 / 1687 / 1687 | 12269 / 13018 / 13018 | 33389 / 34176 / 34176 |
| renderer CPU, cold open (s) | 4.7 | 7.1 | 24 | 59 |
| renderer CPU, two edits (s) | 1.7 | 4.8 | 27 | 73 |
| renderer peak RSS (MiB) | 603 / 619 / 619 | 753 / 798 / 798 | 1708 / 1711 / 1711 | 2749 / 2756 / 2756 |
| worker WebAssembly memory at the end (MiB) | 121 | 274 / 280 / 280 | 1027 / 1084 / 1084 | 1956 / 2031 / 2031 |
| page JS heap used (MiB) | 23 / 38 / 38 | 49 / 51 / 51 | 54 / 59 / 59 | 78 / 79 / 79 |

Against `docs/performance.md` (2026-10-22, "after", one median of 3): "Model ready"
matches (12.7 s → 11.6 s at 50k, 28.3 s → 27.1 s at 100k); the checks don't
(keystroke → checks 10.5 s → 13.5 s at 50k, 22.4 s → 35.1 s at 100k), from the
metadata checks above. The cached snapshot saves 1.2–1.3 s of engine start at every
size, which is most of a repeat load of the demo (2.4 s → 1.2 s) and little of a
large one (the analysis dominates). The worker's memory at 100k ends at 1956–2031 MiB,
within 17–92 MiB of the instance's 2 GiB ceiling (`docs/performance.md`, "Memory").
`crossOriginIsolated` is false, so `performance.measureUserAgentSpecificMemory` is not
available on the page; the renderer's resident set is reported instead.

### App in Chromium, phone emulation with the CPU slowed 4×

Pixel 7 emulation (412×915, touch, device scale 2.6) and the whole renderer process,
worker included, paused for ¾ of every 20 ms (`assessment-duty-cycle.mjs`). Calibration
(a fixed loop): 104–109 ms on the desktop runs, 405–431 ms here on both the main thread
and in a worker, i.e. 4.0×. Same measures as above; the phone layout opens a file from
the Views catalogue and needs "Edit text" before typing.

| | demo (5 runs) | 10k (3) | 50k (2) | 100k (1) |
| --- | --- | --- | --- | --- |
| cold: engine ready | 7505 / 8141 / 8141 | 7916 / 7992 / 7992 | 7654 / 8425 | 7606 |
| cold: "Model ready" | 10011 / 10785 / 10785 | 16178 / 16390 / 16390 | 51251 / 55368 | 112611 |
| cold: checks shown | 11445 / 12182 / 12182 | 19648 / 19649 / 19649 | 74073 / 78257 | 177702 |
| cold: longest main-thread task | 123 / 164 / 164 | 207 / 228 / 228 | 737 / 742 | 1661 |
| repeat: engine ready (snapshot) | 1887 / 1905 / 1905 | 1750 / 1896 / 1896 | 1920 / 2017 | 1983 |
| repeat: "Model ready" | 4458 / 4606 / 4606 | 9490 / 9941 / 9941 | 45607 / 47800 | 108813 |
| edit 1: key → next frame | 43 / 72 / 72 | 63 / 79 / 79 | 336 / 347 | 860 |
| edit 1: → analysed | 1033 / 1066 / 1066 | 4855 / 5219 / 5219 | 28399 / 28846 | 66388 |
| edit 1: → checked | 1378 / 1449 / 1449 | 8247 / 8851 / 8851 | 52528 / 54062 | 138033 |
| edit 2: key → next frame | 41 / 103 / 103 | 44 / 60 / 60 | 207 / 221 | 736 |
| edit 2: → analysed | 860 / 912 / 912 | 4551 / 4756 / 4756 | 28289 / 28414 | 66132 |
| renderer peak RSS (MiB) | 552 | 679 / 691 / 691 | 1333 / 1414 | 2155 |

(50k: median and max of 2 runs; 100k: one run.) The snapshot matters more here: a repeat
open of the demo is 4.5 s instead of 10 s. At 50k a keystroke takes a third of a second
to show and the analysis half a minute; at 100k nearly a second and over a minute.


## §10 questions

### Does Fairtide remain responsive with representative small, medium, and large projects?
- **Answer:** Small (demo, 2.6k lines) and medium (10.5k lines): yes. The page never blocks for long (longest main-thread task 53–178 ms on open, ≤113 ms on an edit), a keystroke reaches the next frame in 19–41 ms, and the model is re-analysed 0.26–0.41 s (demo) and 1.1–1.6 s (10k) after a keystroke. Large (50k): typing stays fluid (64–99 ms to the next frame) but feedback is slow: the analysis lands 6–8 s after a pause and the checks 12–15 s, and completion and hover wait behind them (one worker). 100k: a keystroke takes ~200 ms to show (190–215 ms, the main thread's work on a 100k-line model), the analysis 16–19 s and the checks 33–35 s after a pause, and the engine ends within 17–92 MiB of its 2 GiB ceiling. The page itself is not the bottleneck at any size (JS heap ≤ 79 MiB, explorer and tables paged); the engine's whole-project re-analysis is, plus the app's metadata checks, which are quadratic (below).
- **Evidence:** tables above (`assessment-engine.bench.ts`, `assessment-perf-ux.bench.ts`, run here); guardrails `tests/unit/large-model.test.ts` and `tests/e2e/large-model.spec.ts` (10k only; not run here — the lead runs the suites).
- **Limitations:** headless Chromium on a shared Linux container; one character typed at a time (a run of typing is not measured); the guardrails stop at 10k lines, so the 2× checks regression at 50k–100k went unnoticed for days.
- **Status:** Verified
- **Score:** 2 (Fairtide) — measured and reproducible, but no guardrail above 10k and a regression undetected.
- **Next action:** bug fix (cache `metadataDefinition`); additional testing (a 50k budget in the large-model test).

### What are cold-start, repeat-load, and first-edit latency distributions?
- **Answer:** In the desktop table above (median / p90 / max, 3–7 runs per size). Cold start to "Model ready": 2.4 s (demo), 3.6 s (10k), 11.6 s (50k), 27.1 s (100k); checks shown 0.1 s, 0.5 s, 5.8 s, 15.5 s later. Repeat load with the cached engine snapshot: engine ready in 0.5–0.6 s instead of 1.7–1.8 s; "Model ready" 1.2 s, 2.3 s, 10.4 s, 26.6 s. First edit → analysed: 0.34 s, 1.4 s, 7.6 s, 18.6 s; → checks 0.43 s, 1.9 s, 13.5 s, 35.1 s; a second edit is 10–25 % faster. Spread is small: p90/max within 3–15 % of the median except the demo's first keystroke frame (23 ms median, 102 ms max) and the first 100k open in a Node process (59 s once, 17 s otherwise).
- **Evidence:** `tests/perf/assessment-perf-ux.bench.ts`, `tests/perf/assessment-engine.bench.ts` (commands at the top; run here, raw runs summarised with `assessment-stats.ts`).
- **Limitations:** first visit measured with the app's files served from localhost (no network transfer time; the engine is 3.3 MB to download, the snapshot 10 MB); no real device.
- **Status:** Verified
- **Score:** 3 (Fairtide) — reproducible distributions at four sizes, desktop and slowed phone.
- **Next action:** None (keep the bench; add its 10k figures to CI as a budget).

### What are peak memory and CPU usage on desktop and lower-memory mobile devices?
- **Answer:** Desktop: renderer peak resident memory (page and engine worker together) 0.6 GiB (demo), 0.75 GiB (10k), 1.7 GiB (50k), 2.75 GiB (100k); the engine's WebAssembly memory 121 MiB, 280 MiB, 1.0–1.1 GiB, 1.96–2.03 GiB (it never shrinks; its ceiling is 2 GiB, so a model much over 100k lines cannot be opened, and 100k is within 2–5 % of it after two edits); page JS heap 23–79 MiB. CPU: a cold open costs 4.7, 7.1, 24 and 59 renderer-CPU seconds, two edits 1.7, 4.8, 27 and 73 s (more than wall time at 50k–100k: the worker and the page run in parallel). On a phone-sized screen with the whole renderer slowed 4× (phone table above): cold open 10 s (demo), 16 s (10k), 51 s (50k), 113 s (100k); edit → analysed 1.0 s, 4.9 s, 28 s, 66 s; the longest main-thread task 0.12, 0.21, 0.74 and 1.7 s; resident memory as on the desktop (0.55–2.2 GiB)). Memory on a phone: emulation can't lower the memory available; the measured footprints say a phone browser that gives a tab ~1–1.5 GiB (common for mid-range phones; not measured here) can hold 10k comfortably, 50k at best, and not 100k.
- **Evidence:** desktop and phone tables above (`assessment-perf-ux.bench.ts`, run here); `VmHWM` of the renderer via CDP `SystemInfo.getProcessInfo`; CDP `Performance.getMetrics` for the JS heap; the worker's `sysmlStats()`.
- **Limitations:** no real phone; Chrome's DevTools CPU throttling cannot slow a worker ("Operation is only supported for pages, not workers", seen in this session), so the phone runs slow the whole renderer process by pausing it (`assessment-duty-cycle.mjs`), calibrated at 4.0× on both the main thread and a worker; `performance.measureUserAgentSpecificMemory` needs cross-origin isolation, which the app does not have.
- **Status:** Partially verified (desktop measured; phone emulated, memory limits inferred)
- **Score:** 2 (Fairtide)
- **Next action:** additional testing on a real mid-range phone; planned capability: warn before opening a project whose size will not fit (the engine's memory is known after the first analysis).

### Does the UI remain usable when semantic analysis reports thousands of diagnostics?
- **Answer:** Yes. A project of 10 files with 5,000 unresolved type references (5,000 problems; the engine reports unresolved names as warnings, see §1) opens to "Model ready" in 3.7–5.8 s (four runs) with the status bar reading "0 errors, 5000 warnings" at the same moment and no main-thread task over 160 ms. The problems list opens in 87–118 ms, lists the first 500 under a heading per kind of problem with "4500 more not listed.", scrolls end to end in 44–50 ms; a problem opens its file at the place in ~0.2 s with every warning in the file underlined; typing there shows at once (no long task) and the count follows an edit (deleting a file's 500 → "4500 warnings"); the command palette answers in 0.1 s; axe finds nothing with the list open. One slow part: after typing in that file, the new analysis arrived 9.6 s later (one run), against ~1.4 s for the clean 10k project; not investigated.
- **Evidence:** `tests/e2e/assessment-perf-ux.spec.ts` "a model with 5,000 problems stays usable…" (run here); the cap `PROBLEMS_LISTED = 500` (`src/lib/workbench/Workbench.svelte`).
- **Limitations:** problems of one kind (unresolved names); the 501st and later problems are reachable only by fixing earlier ones or through the editor's underlines (the list has no paging or filter by file); 50k-line projects with thousands of problems not tried.
- **Status:** Verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing (why re-analysis of the problem-heavy project is slow); planned capability (filter or page the problems list).

### Can engineers navigate large models without excessive waiting?
- **Answer:** At 10k lines, yes: expanding a package in the explorer 102 ms, the command palette opening and finding an element by name in 0.11–0.12 s, choosing it to the inspector 78 ms, the product's interconnection diagram 0.3 s; the table of every requirement 3.8 s in that run (it waits for the worker while the checks run; 8–16 ms in the worker itself). The explorer starts with packages closed above 30 top-level packages and lists 200 entries at a time; tables show 300 rows with a button for more; diagrams over 500 elements are not laid out and say how to narrow the view (`docs/performance.md`, "What was changed"). Above 10k the worker is the limit: anything that needs it (opening a view, hover, completion) waits for an analysis or the checks in progress — up to 6–8 s + 12–15 s after an edit at 50k and 16–19 s + 33–35 s at 100k, and ×4 on the slowed phone.
- **Evidence:** `tests/e2e/assessment-perf-ux.spec.ts` "a 10k-line model: explorer, search and views…" (run here); worker-side times in the engine table; `docs/performance.md`'s browser table for 50k/100k explorer and tables (2026-10-22; not re-run here).
- **Limitations:** navigation steps timed once per run at 10k only; not measured while an analysis is running at 50k/100k.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing (navigation timings at 50k in the bench); bug fix (the metadata checks) shortens every wait above 10k.

### Are common tasks discoverable without extensive documentation?
- **Answer:** Mostly. A new project opens on an overview with a "Next steps" checklist (write a requirement, add a part, link them, make a view, add up or set a limit, keep a copy), each with a button that opens the form or place for it and ticks itself when done; a tour per template; empty states that say what to do; a command palette (Ctrl K) that also searches the help (`?`); the `?` key; Help with 46 topics, 16 of them "How do I…" answers whose buttons perform the task; hover explanations in the text. Gaps: the landing page's primary button is "Try the demo" and starting one's own project sits under the in-page "Get started" link; on a phone the text opens read-only and needs "Edit text"; the guided limit goes into the first requirement in the file, not the one just written (below).
- **Evidence:** `tests/e2e/onboarding.spec.ts` (existing, not re-run here); the walk-through test below (run here); help content `src/lib/help/content.ts`; next steps `src/lib/workbench/home/NextSteps.svelte`.
- **Limitations:** judged by scripted walk-throughs and reading the screens, not by sessions with real first-time users.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** additional testing (a moderated session with two or three new users).

### Can a first-time user complete a meaningful modeling task using the guided workflow alone?
- **Answer:** Yes, in the scripted walk-through: from the landing page ("Get started" → "Start a new project"), a Blank project, then only the "Next steps" buttons and their forms — a requirement (Add), a part (Add), a requirements table (New view, three steps), a satisfy link ("Show me" opens the requirement's details at the picker of what can satisfy it), a limit ("Set a limit": value `mass`, "At most", 12, unit kg → `require constraint { theSystem.mass <= 12 [kg] }` written into the requirement) and a download — reaching "All done" with 0 problems and no SysML typed. Points where the screen did not carry the person: (1) the limit goes into the first requirement in the file (the template's placeholder `REQ-001`), not the one they just wrote; (2) the System's `mass` has no value, so the new check is undecided, and no next step says to give it one (the "Add up" route does); (3) after "Create", the new view opens a second or two later, replacing whatever the person has gone back to (the test has to wait for it); (4) on a phone the text opens read-only behind an "Edit text" button. The walk passed once and timed out once at point (3) before the wait was added.
- **Evidence:** `tests/e2e/assessment-perf-ux.spec.ts` "a first-time user completes a modelling task with the guided workflow alone" (run here: passed in two of three runs; the failed one was point 3); screenshots of each screen and the written text checked by hand (`perfux/dbg/walk*.mjs` in the session scratchpad, not committed).
- **Limitations:** a script knows where to click; real first-time users were not observed; Blank template only (the other two starting points are covered by `onboarding.spec.ts`).
- **Status:** Verified (the path works); Partially verified (that a newcomer would find it)
- **Score:** 2 (Fairtide)
- **Next action:** planned capability: the limit step should target the requirement just written and offer to set the value it checks; additional testing with real users.

### Does the application work on supported browsers and mobile screen sizes?
- **Answer:** Screen sizes: yes in Chromium. The demo opens, has no sideways page scroll and passes axe at 390×844 (phone, touch), 820×1180 (tablet, touch), 1440×900 and 2560×1440; the existing `phone-layout.spec.ts` checks every main phone screen for sideways scrolling. Browsers: only Chromium is tested, here and in CI (`playwright.config.ts` has one project, `chromium`); only Chromium (Playwright build 1194) is installed on this machine, and no other browser was installed for this assessment. Firefox and Safari (including iPhone Safari, which the app targets with Home Screen install and share-sheet exports) are untested. Some features are Chromium-only by design and say so: opening a folder ("in Chrome or Edge on a computer", user guide). No document lists the supported browsers.
- **Evidence:** `tests/e2e/assessment-perf-ux.spec.ts` "on a phone/tablet/desktop/wide desktop…" (4 passed here); `tests/e2e/phone-layout.spec.ts` (existing, not re-run).
- **Limitations:** emulated viewports in Chromium, not real devices; no WebKit or Gecko run at all.
- **Status:** Partially verified (screen sizes); Unverified (other browsers)
- **Score:** 2 (screen sizes), 1 (browsers) — Fairtide
- **Next action:** additional testing: add Playwright `webkit` and `firefox` projects to CI for a smoke subset; state the supported browsers in the README.

### Are keyboard navigation, screen-reader labels, focus management, and contrast adequate?
- **Answer:** Mostly adequate, with three keyboard gaps. *Automated checks:* axe (WCAG rules as `@axe-core/playwright` runs them) finds nothing on every screen of the demo the sweep reaches, in the light and in the dark theme: landing, projects, help page, overview, model tree, text editor, problems list, every one of the demo's views (tables, diagrams, matrices, DSMs, simulations, reports, risk views), the command palette, every Settings tab, the project menu, the Download as JSON dialog, the explorer's New list and its New view form — 0 screens with violations in either theme. The existing specs make 170 axe checks, all in the light theme except the landing page; the dark-theme workbench had none before this. Also clean at 390, 820, 1440 and 2560 px wide. *Screen-reader labels:* icon buttons are labelled ("Project overview", "Source control", "Inspector", "Settings", "Theme: match system"), the status bar's problems chip reads "Problems: 0 errors, 5000 warnings", the state machine diagram is a group named with its states and current state, status changes are in `role="status"` live regions; not tried with a real screen reader. *Keyboard:* Tab from the top reaches the header, the explorer and every view in order; Ctrl K, typing and Enter select an element and show it in the inspector; Settings takes focus, keeps it while tabbing (it leaves only for the browser's own controls) and gives it back to the Settings button on Escape. Gaps: the explorer's "Filter the model" box shows no focus indicator on a computer; the project menu doesn't move with the arrow keys (it is a `role="menu"`; Tab works); and a dialog opened from that menu returns focus to the page body when it closes, not to the menu button. There is no skip link. *Contrast:* passes in both themes; the intermittent `color-contrast` failure on `.xc-primary` in the exchange dialogs (exchange.spec "the demo downloads as SysML v2 JSON…") is axe measuring the dialog during its 180 ms fade-in: held 20 ms in (opacity 0.20) it reports `.xc-primary`, `.xc-button` and the option labels, finished it reports nothing (test below, passed in every run).
- **Evidence:** `tests/e2e/assessment-perf-ux.spec.ts`: "axe finds nothing on any screen of the demo, in the light / dark theme", "the exchange dialog contrast failure is axe catching the dialog mid-fade", "keyboard only…", and three `test.fail` known gaps (focus ring, arrow keys, focus back on the menu button) — run here; existing axe checks in 31 specs (not re-run).
- **Limitations:** automated rules catch a part of WCAG; no NVDA/VoiceOver session; zoom/reflow at 200 % and forced-colours mode not tried; the sweep waits for finished CSS animations before each check (`settled()`), which is what removes the flake.
- **Status:** Verified (axe, keyboard paths tried); Unverified (real screen readers)
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (the three keyboard gaps; wait for animations in `tests/e2e/axe.ts`); additional testing with a screen reader.

### Can users recover from failed imports, invalid edits, and failed simulations without restarting?
- **Answer:** Yes for the three cases tried, all in one page without a reload. Failed imports: a damaged `.kpar` says "damaged.kpar could not be read: This is not a ZIP file (a .kpar file is one)." and a truncated JSON file "broken.json could not be imported: This isn't a JSON file (Expected ',' or '}' after property value … line 1 column 33)."; the projects page then creates a project as usual. Invalid edit: typing `part def }}} ;; : : missing` shows "Problems: 1 errors", the model stays "Model ready" (the rest still read), and Ctrl Z returns to 0 problems. Failed simulation: a machine whose two states hand over to each other with no trigger, asked to wait 10 s, stops itself at 200 transitions within 0.2 s and says "stopped after 200 steps at 0 s: the machine keeps moving without time passing"; the rest of the app answers meanwhile (the command palette opens). But the emulator first plays all 200 transitions as an animation, so the reason appears only after 89 s and the emulator takes no other step until then. Engine failures (the worker crashing or running out of memory) restart the worker and say "Fairtide stopped reading the model. Reload the page to try again." (`src/lib/engine/instance.ts`), which does ask for a reload; not triggered here.
- **Evidence:** `tests/e2e/assessment-perf-ux.spec.ts` "recovery without a reload…" (run here, passed); existing `exchange.spec.ts` "a file that is not SysML v2 JSON says so" (not re-run).
- **Limitations:** one example of each; a corrupt but valid ZIP, a JSON with valid syntax but wrong shapes, and a worker crash were not tried here (§3 and §8 cover archives and storage).
- **Status:** Verified
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (show a runaway wait's reason at once; don't animate hundreds of steps).

### Can organizations deploy Fairtide locally or in controlled environments?
- **Answer:** Yes for the app itself: it is static files. A build with `BASE_PATH=/tools/fairtide` and the sign-in variables empty, served by a 60-line static server under that path with a strict Content-Security-Policy (`default-src 'self'`, `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`, `connect-src 'self'`, …) and every request to another host refused, opened from its landing page and from a deep link (`/tools/fairtide/p/demo`, served by the `404.html` fallback), read the demo with no problems, opened a table and Settings → About, with no refused request, no CSP violation and no console error. Without the GitHub sign-in worker, GitHub is connected with a personal access token (`docs/setup-github-sign-in.md`). Limits for a controlled environment: the GitHub API host is fixed (`src/lib/git/github.ts:28`, `https://api.github.com`), so GitHub Enterprise Server is not supported, and GitHub is the only Git host (GitLab is "planned" in Settings); the site ships no CSP of its own (`src/app.html`), so the policy above is the deployer's to set, and it needs `'unsafe-inline'` for SvelteKit's inline start script and `'wasm-unsafe-eval'` for the engine; the service worker (offline use) needs HTTPS or localhost.
- **Evidence:** `tests/e2e/assessment-perf-ux-deploy.spec.ts` with `tests/perf/assessment-static-server.mjs` (commands at the top; run here: 1 passed, "refused: none; problems: none"); `README.md` "Deploying".
- **Limitations:** one static server and Chromium; not tried behind a real proxy or on an intranet host; Git integration in a closed network not possible (GitHub.com only).
- **Status:** Verified (static hosting); Not claimed (GitHub Enterprise, other Git hosts)
- **Score:** 3 (Fairtide) for self-hosting the app; 1 for Git in a closed network.
- **Next action:** planned capability (a configurable GitHub API base URL for Enterprise Server); document a recommended CSP.

### Is telemetry documented and controllable?
- **Answer:** There is no telemetry. Walking through the landing page, the projects page, a new project from a template, the demo, two views and Settings → About, then idling 20 s (the engine snapshot download and the service worker's caching), every one of 612 requests went to the app's own host, from the page, its workers and the service worker; no analytics, error-reporting or font CDN. The source has no analytics or beacon code; the only other hosts it can contact are the ones a person connects to (`api.github.com` with their token, the sign-in worker when configured, a Systems Modeling API server they enter). The user guide says projects stay in the browser and "Nothing is sent to a Fairtide server: there isn't one" (`docs/user-guide.md:498`), but no document says in so many words that there is no telemetry.
- **Evidence:** `tests/e2e/assessment-perf-ux.spec.ts` "every request goes to the site itself" (run here: `localhost:4328 (612)`); `grep` for `fetch(`, `sendBeacon`, `WebSocket`, analytics names over `src/` (run here: only engine, library, export, Git, sign-in and API-server calls).
- **Limitations:** the e2e build has sign-in configured but no one signed in, so the worker was correctly not contacted; GitHub flows were not exercised here (§8 covers tokens).
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** add one sentence to the user guide ("Fairtide collects no telemetry or usage data").

### Are releases reproducible, and can users verify which version and engine they are running?
- **Answer:** Partly. Settings → About shows "App 0.0.1" and "Engine: sysml-toolkit 0.10.10" (a link to that release) with the running engine's own report beside it ("(toolkit 0.10.10)"). But the app version is `package.json`'s 0.0.1, never changed, and there is no commit, build date or tag on the page or in the repository (no git tags, no releases, no changelog), so two different deployments both say 0.0.1. Inputs are pinned: `package-lock.json` with `npm ci` in CI and deploy, and the engine by version and SHA-256 (`toolkit.json`, checked by `scripts/fetch-toolkit.sh`). Two builds of the same commit differ in 8 of 230 files (the HTML pages, `_app/version.json` and `service-worker.js`), only by SvelteKit's version string, which defaults to the build time (`1792937107005` vs `…123967`); every JS chunk and the engine files were byte-identical.
- **Evidence:** `tests/e2e/assessment-perf-ux.spec.ts` "Settings → About…" (run here); two builds of 68cb9db with `sha256sum` over `build/` (run here, through the gate); `src/lib/version.ts`, `src/lib/settings/Settings.svelte` About section, `.github/workflows/deploy.yml`.
- **Limitations:** builds compared on one machine with the same Node; no check against the published GitHub Pages build.
- **Status:** Verified
- **Score:** 1 (Fairtide)
- **Next action:** planned capability: set SvelteKit's `version.name` to the commit SHA (reproducible builds, and a version people can quote), show it in About, tag releases with a changelog.

## Prioritized question 11

### How does performance scale with model size, diagnostic count, and lower-memory devices?
- **Answer:** *Model size:* the engine's analysis grows slightly faster than the model (1.1 s at 10k, 6.8 s at 50k, 16.9 s at 100k lines in Node; ×1.1–1.3 in the browser), and it runs on every pause in typing; the checks grow faster still (0.48, 4.6, 13.7 s) because the app's metadata checks are quadratic (44 ms, 1.4 s, 6.4 s; `views/domains.ts:65`); the page's own work stays small (13, 67, 133 ms per analysis). Memory grows about linearly (the engine's WebAssembly memory 0.28, 1.0–1.1, 1.96–2.03 GiB; the renderer's resident set 0.75, 1.7, 2.75 GiB) and reaches the engine's 2 GiB ceiling at about 100k lines. *Diagnostic count:* 5,000 problems cost little: open in 3.7–5.8 s for a 5k-line project, the list capped at 500 rows (87–118 ms to open), no long main-thread task; re-analysis after typing in that project was slow (9.6 s, one run). *Lower-powered devices:* with the whole renderer 4× slower, everything the engine does is ~4× slower (cold open 10 s demo, 16 s 10k, 51 s 50k, 113 s 100k; edit → analysed 1.0, 4.9, 28, 66 s), and the main thread starts to stutter above 10k (a keystroke takes 0.34 s to show at 50k and 0.86 s at 100k; longest task 1.7 s). *Lower-memory devices:* not emulated (Chromium cannot cap a tab's memory); by the measured footprint, a phone that allows a tab ~1–1.5 GiB fits 10k and probably not 50k. In practice: comfortable to 10k lines on a desktop and to a few thousand on a phone; usable but slow at 50k on a desktop; at the limit at 100k.
- **Evidence:** every table above; commands at the top (all run here).
- **Limitations:** generated models of one style (no problems, many metadata annotations — 4,229 at 100k — which is what makes the metadata checks dominate); no real phone; one character per edit.
- **Status:** Verified (size, diagnostics, CPU); Partially verified (memory on phones)
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (cache `metadataDefinition`); additional testing (real phone; a 50k budget in CI); planned capability (upstream incremental analysis, `docs/engine.md` request 12).

## Section scores

Fairtide's scores (the engine's own speed is upstream; where it decides the answer it is
noted).

| Sub-area | Score | Notes |
| --- | --- | --- |
| Responsiveness by model size | 2 | Fine to 10k; slow feedback at 50k; at the limit at 100k; metadata checks quadratic (2× regression undetected) |
| Latency distributions (cold, repeat, edit) | 3 | Reproducible bench, every run kept, four sizes, desktop and slowed phone |
| Memory and CPU, desktop and phone | 2 | Desktop measured; phone CPU emulated; phone memory inferred; 2 GiB engine ceiling at ~100k (engine) |
| Thousands of diagnostics | 2 | 5,000 problems: list, editor, status bar responsive; list capped at 500 without paging |
| Navigating large models | 2 | 10k measured; above it everything waits on the one worker |
| Discoverability | 2 | Next steps, tour, help, palette; scripted, not user-tested |
| Guided first task | 2 | Works with buttons and forms alone; four points need knowledge the screen doesn't give |
| Browsers and screen sizes | 1 | Screens 2 (four sizes pass); browsers 1 (Chromium only, nothing else ever run) |
| Accessibility | 2 | axe clean on every demo screen in both themes; three keyboard gaps; no screen-reader session |
| Recovery without restarting | 2 | Imports, invalid edits, runaway machine: recovered in place; a runaway wait animates 89 s before saying why |
| Self-hosting / controlled environments | 3 | Sub-path, strict CSP, no outside hosts, no sign-in worker: verified; GitHub Enterprise not supported |
| Telemetry | 3 | None; verified by request log |
| Release reproducibility and version visibility | 1 | Engine pinned and shown; app always "0.0.1"; build stamp is a timestamp; no tags |

## Critical findings

None in this section by the brief's definition (no data loss, no silent change of a
model's meaning, no misleading result). The worst found are performance and
accessibility defects, below.

Notable, not critical:

1. **The checks are quadratic in metadata annotations** (1.8–2.0× slower at 50k than
   at the perf merge, 2.6× at 100k). Repro: `ASSESS_SIZES=50000,100000 ASSESS_RUNS=3
   npx vitest run --config tests/perf/assessment-vitest.config.ts`; compare
   `checks.annotationChecksOnly` (1.4 s at 50k, 6.4 s at 100k for 2,122 / 4,229
   annotations) with `docs/performance.md`. Cause: `metadataDefinition`
   (`src/lib/engine/toolkit/views/domains.ts:65-77`) scans all annotations and all
   records per call, called per annotation from `assertions.ts:35` and
   `riskLines.ts:316`.
2. **100k lines ends within 17–92 MiB of the engine's 2 GiB ceiling** after an open
   and two edits in the browser (worker memory 1956–2031 MiB). Repro: the desktop bench
   at 100000. Past it the worker traps and restarts (`docs/performance.md`); nothing
   warns before a project is that large.
3. **Keyboard gaps in the workbench.** (a) The explorer's "Filter the model" box shows
   no focus indicator on a computer (`outline: 0` on `.search input`, and the wrapper's
   `:focus-within` style is phone-only; `src/lib/workbench/Explorer.svelte`). (b) The
   project menu is announced as a menu but doesn't move with the arrow keys (Tab does).
   (c) A dialog opened from that menu (e.g. Download as SysML v2 JSON) leaves focus on
   the page body when closed, not on the menu button. Repro: the three `test.fail`
   tests in `tests/e2e/assessment-perf-ux.spec.ts` (every tab stop…, …arrow keys,
   …back on the menu button).
4. **A runaway machine's wait plays its 200 transitions before saying why.** Repro: a `state def` with
   `transition first a then b; transition first b then a;`, Run, choose "10 s", Wait:
   the wait stops at step 200 in 0.2 s, then the emulator animates the 200 transitions
   and shows "…keeps moving without time passing" 89 s later
   (`tests/e2e/assessment-perf-ux.spec.ts` "recovery without a reload…";
   `src/lib/sim/StateEmulator.svelte` `animate` before `flash`).
5. **The exchange-dialog contrast failure (exchange.spec "the demo downloads…") is a
   test race, not a contrast defect**: axe runs while the sheet dialog fades in
   (`@keyframes pop`, opacity 0 → 1 over 180 ms, `src/lib/ui/SheetDialog.svelte`);
   held 20 ms in (opacity 0.20), axe reports `.xc-primary`, `.xc-button` and the
   option labels; finished, nothing. Repro: `tests/e2e/assessment-perf-ux.spec.ts`
   "the exchange dialog contrast failure is axe catching the dialog mid-fade" (passed
   twice here). Fix in the shared helper `tests/e2e/axe.ts`: wait for finite
   animations (`document.getAnimations()` whose end time is finite) before analysing,
   as `settled()` in the new spec does. The colours themselves pass in both themes.
6. **The app version is always 0.0.1** and builds are stamped with their build time,
   so a deployment cannot be identified or rebuilt bit-for-bit.

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Cache `metadataDefinition` per view context (and check `riskProblems` for the same scan) | Checks at 50k back to ~3 s, at 100k ~7 s | High for large projects | S |
| A 50k-line budget in `tests/unit/large-model.test.ts` (analysis and checks) | Catches regressions like the above | Medium | S |
| Wait for animations in `tests/e2e/axe.ts` | Removes the contrast flake | CI stability | S |
| Focus style for the explorer's filter box on computers | WCAG 2.4.7 | Keyboard users | S |
| Build stamp = commit SHA (`version.name`), shown in About; tags and a changelog | Identifiable, reproducible releases | Medium (regulated users) | S |
| Show a runaway wait's reason at once and skip animating hundreds of steps | Clear feedback | Medium | S |
| Warn when a project approaches the engine's memory ceiling (memory is known after the first analysis) | No surprise crash at ~100k | Medium | S |
| WebKit and Firefox smoke projects in CI; list supported browsers | Confidence for iPhone/Safari users | High for phone users | M |
| Configurable GitHub API base URL (GitHub Enterprise Server) | Closed networks | High for some organisations | M |
| A recommended CSP in the deploy docs; "no telemetry" sentence in the user guide | Easier approval in controlled environments | Medium | S |
| Real-phone measurements (mid-range Android, iPhone) | Replaces emulation | Medium | M |
| Incremental analysis upstream (`docs/engine.md` request 12) | Every keystroke above 10k | High | L (upstream) |
