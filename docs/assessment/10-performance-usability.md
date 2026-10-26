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

{{RUNS}}

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

{{QUESTIONS}}
