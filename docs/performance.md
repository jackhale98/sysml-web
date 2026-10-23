# Performance on large models

The plan's target (`docs/PLAN.md`, Phase 8) is a workbench that stays usable
on a model of 100k lines. This page says how that is measured, what the
numbers were before and after the work that followed, what was changed, and
what still limits it — most of it in the toolkit (`docs/engine.md`, upstream
requests 12–15).

## Method

**Projects.** `tests/perf/generate.ts` writes valid SysML v2 projects of any
size in the drone demo's style: per subsystem (about 1160 lines in seven
files) interfaces with flows, a component catalogue (an abstract base,
specializations redefining mass and power, assemblies with bindings and
connections), an architecture usage with a part tree five levels deep,
interfaces and flows and a mass roll-up, 30 requirements with metadata,
constraints and a derivation, satisfy and verify links, a state machine and
an action flow, and five views (tables and diagrams); a product package
connects every subsystem to a data bus and has a table of every requirement
and the product's bill of materials. The toolkit finds no problems in them.
10k lines is 66 files, 50k 304 and 100k 605. Nothing generated is committed.
The official SysML v2 examples (95 files, 7k lines) are a second, realistic
corpus (`--corpus`).

**Engine, in Node** (`tests/perf/engine.bench.ts`): what the worker does,
through `ToolkitHost`, plus the page's own model building — open (analysis,
views, state machines, checks; the structured clone of the analyses; the
page's elements, tree and requirements), a one-character edit in a doc
comment of the largest file and the same again, completion and hover there,
three tables and six diagrams. WebAssembly memory is the instance's (it
never shrinks).

**App, in headless Chromium** (`tests/perf/browser.bench.ts`): the built app,
the project put into the browser's store, then as a person uses it: open it
("Model ready", then the checks), the explorer (rows on the page, scrolling),
open the largest file as text, type a character in a doc comment
(→ analysed, → checked), complete a type name, hover one, open the table of
every requirement and the product's interconnection diagram. Long tasks are
the main thread's (`PerformanceObserver`); worker time is the worker's own
record of its calls; memory is the worker's WebAssembly memory. CPU
throttling is Chrome's DevTools emulation (`--throttle 4`, roughly a
mid-range phone); it slows the page's main thread, not the worker.

```sh
npm run bench                                   # Node and browser, 10k/50k/100k, 3 runs each
npm run bench -- --engine --lines 10000 --runs 5
npm run bench -- --browser --throttle 4 --lines 10000,50000
npm run bench -- --engine --corpus ../sysml-v2-release/sysml/src/examples
```

**The machine.** A shared 4-core container where other agents ran their
own test suites. The numbers below were taken through the shared test gate
(one heavy run at a time; load average 1–6), "before" and "after" in turns;
a first round taken without the gate (load average 15–30) showed the same
picture, two to five times slower. Each figure is the median of three runs
unless noted; read before against after within a table.

## Results

These were measured on 2026-10-22. Before is the benchmark's own commit
(`856ce0e`, the code as it was), after is the branch that made the changes
below (merged the same day). 10k is 10,546 lines in 66 files, 50k 50,020 in 304, 100k
99,943 in 605.

### Engine, in Node

Medians of 3 runs, ms (memory MiB). Measured through the shared test gate
(load average 2–6 on 4 cores). "Page model" is the page's own work on an
analysis: elements, the explorer's tree and the requirements rows.

| | 10k before | 10k after | 50k before | 50k after | 100k before¹ | 100k after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| open: analysis | 1163 | 1161 | 7350 | 7348 | 20288 | 17159 |
| — session / check / adapter | 313 / 349 / 488 | 337 / 356 / 466 | 1889 / 2037 / 3298 | 1879 / 2140 / 3292 | 4571 / 4190 / 11526 | 3733 / 4302 / 8896 |
| open: checks | 487 | 455 | 3498 | 2928 | 7839 | 5225 |
| open: page model | 101 | 15 | 3149 | 98 | 12665 | 154 |
| — of which the tree | 91 | 6 | 3079 | 37 | 12506 | 64 |
| keystroke: analysis | 1112 | 1127 | 6921 | 6718 | 15658 | 16184 |
| keystroke: checks | 466 | 449 | 3317 | 2774 | 7483 | 5331 |
| keystroke: page model | 158 | 15 | 2917 | 82 | 14907 | 145 |
| completion (first after the edit) | 24 | 32 | 57 | 55 | 461 | 127 |
| hover (first after the edit) | 257 | 240 | 1295 | 1394 | crashed | 3012 |
| table of every requirement | 11 | 13 | 47 | 48 | — | 147 |
| table: product bill of materials | 42 | 46 | 977 | 1001 | — | 3647 |
| diagram: interconnection of the product | 5 | 6 | 29 | 38 | — | 63 |
| diagram: every definition | 5 | 5 | 25 | 29 | — | 64 |
| WebAssembly memory (MiB) | 384 | 333 | 1423 | 1153 | 2031 | 1851 |

¹ Before, a 100k project lost about 10k elements to the adapter's limit (so
its analysis did less), and the engine ran out of memory at the first hover:
one run, which stopped there.

The official SysML v2 examples as one project (95 files, 7,250 lines; after):
analysis 968 ms, checks 526 ms, page model 6 ms, keystroke 629 ms, hover
452 ms, 279 MiB.

### App, in Chromium

The built app, desktop viewport; medians of 3 runs, ms unless noted;
measured through the shared test gate (load average 1–5). "Worker" is the
engine's own time; open's "model ready" before the fix included the checks.

| | 10k before | 10k after | 50k before | 50k after | 100k before¹ | 100k after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| open: "Model ready" | 4448 | 5155 | 19373 | 12703 | 56422 | 28349 |
| open: checks shown | 4203 | 6605 | 18476 | 16394 | 54538 | 34396 |
| open: longest main-thread task | 245 | 84 | 3099 | 153 | 16647 | 280 |
| open: total blocking time | 331 | 37 | 4511 | 128 | 19618 | 284 |
| explorer: rows / DOM nodes | 946 / 15634 | 65 / 1439 | 4482 / 73502 | 201 / 4762 | 8707 / 141361 | 201 / 6740 |
| open the largest file | 306 | 287 | 527 | 378 | 1175 | 653 |
| keystroke → analysis on the page | 1306 | 1424 | 6878 | 6767 | 16845 | 16147 |
| keystroke → checks on the page | 1843 | 1866 | 13171 | 10490 | 36230 | 22403 |
| keystroke: longest main-thread task | 110 | 114 | 3069 | 73 | 11549 | 167 |
| completion | 233 | 255 | 367 | 369 | 862 | 688 |
| hover (first after the edit) | 905 | 914 | 2090 | 2101 | 8075 | 3417 |
| table of every requirement | 4553 | 464 | 83980 | 608 | > 18 min | 901 |
| table: rows on the page | 279 | 279 | 1333 | 300 | — | 300 |
| product interconnection diagram | 1493 | 245 | 23784 | 924 | — | 1339 |
| worker memory (MiB) | 333 | 333 | 1153 | 1153 | — | 1768 |
| page JS heap (MiB) | 106 | 66 | 254 | 104 | — | 125 |

¹ One run, which didn't get past the table; the model was the truncated one.

With the CPU throttled 4× (the page's main thread; the worker is not
slowed, `open: worker` and `keystroke: worker` match the unthrottled runs):

| | 10k before | 10k after | 50k before | 50k after |
| --- | ---: | ---: | ---: | ---: |
| open: "Model ready" | 6049 | 4298 | 30756 | 14299 |
| open: checks shown | 5086 | 4629 | 26909 | 18275 |
| open: longest main-thread task | 1015 | 136 | 9358 | 460 |
| open: total blocking time | 1941 | 257 | 15647 | 822 |
| explorer: scroll to the end and back | 91 | 37 | 241 | 65 |
| open the largest file | 909 | 757 | 2290 | 1837 |
| keystroke → analysis on the page | 1295 | 1223 | 7333 | 7365 |
| keystroke → checks on the page | 2147 | 1712 | 21478 | 11037 |
| keystroke: longest main-thread task | 379 | 0 | 9856 | 193 |
| completion | 279 | 330 | 822 | 717 |
| hover | 1119 | 1065 | 2280 | 2277 |
| table of every requirement² | 19644 | 7051 | 12300 | 2457 |
| product interconnection diagram | 11854 | 866 | 227595 | 3827 |

At 100k lines, throttled, after: "Model ready" in 45–63 s (two runs; the
analysis itself 28–39 s in the worker).

² Throttled, the table's times include Playwright's own polling of the
page (its role queries run on the throttled main thread); the 279-row table
at 10k profiles at 1.6 s on its own.

At 10k lines the open and keystroke times are the engine's either way and
within the machine's noise; the page's own share (long tasks, blocking
time) is what changed.

## What was changed

Bottlenecks found by the benchmark, in the order they hurt:

1. **The explorer's tree was quadratic.** `buildTree` looked for each
   element's owner by scanning every element: 22 s on the main thread at
   100k lines (4.5 s at 50k), on every analysis. Owners are now looked up by
   file and name. The same pattern was in the requirements rows (every
   satisfy and verify link scanned per requirement), the tables (each row
   filtered every element of the model to find its own, and looked its
   predecessor up with `indexOf`) and the checks (every constraint scanned
   every element twice): all indexed now.
2. **A 100k-line project lost elements and crashed the engine.** The model
   adapter stopped reading at 100,000 elements (a guard against pathological
   input), so the last files' elements, views and requirements were silently
   missing; the limit is now 2 million. And the toolkit's instance is
   limited to 2 GiB: after an edit, the checks and a hover it ran out of
   memory (`RuntimeError: unreachable`), the worker restarted and reloaded
   the model, and the next hover crashed it again. Two sessions are now
   freed when they are no longer needed: the language server's navigation
   sessions (a resolved copy of the whole workspace, out of date after any
   edit anyway) when the analysis of new text starts, and, once the
   instance has grown past 1 GiB (about 50k lines), the second session the
   checks evaluate in, as soon as the checks are made (values asked for
   later reopen it). 100k lines now
   stays under the limit (1.8 GiB in Node after open, edit, checks,
   completion and hover).
3. **Keystrokes queued analyses, and checks held up "Model ready".** Every
   pause in typing sent an analysis; on a model whose analysis takes 10 s
   they queued in the worker, and each was followed by the checks (as long
   again). Now one analysis runs at a time (text that changes meanwhile is
   analysed once it is done), views and checks are skipped when newer text
   is waiting, and the checks follow "Model ready" instead of preceding it.
   On a model whose analysis takes more than 2 s the analysis waits for a
   1 s pause in typing (250 ms otherwise) and so do the checks, so
   completion asked for while typing isn't stuck behind them.
4. **All analyses crossed to the page after every keystroke.** The worker
   now sends only the analyses that changed (element ids are stable, so an
   edit changes one file's analysis), the page puts back the ones it has,
   and the elements built from an unchanged analysis are reused
   (`engine/toolkit/delta.ts`, `collectElements`).
5. **Too much on the page at once.** The explorer opened every top-level
   package and listed every child: 15,600 DOM nodes at 10k lines, 73,500
   at 50k. Top-level packages now start closed when there are more than 30,
   and a list shows 200 entries with a button for more. A table shows 300
   rows with a button for more (search, sort and export see every row; a
   search result further down is brought onto the page). A diagram of more
   than 500 elements isn't laid out (ELK runs on the main thread); it says
   how to narrow the view instead. The problems list shows the first 500.

Behaviour on the demo is unchanged: it has fewer than 30 top-level
packages, so they start open, its tables and diagrams are far below the
limits, and its analysis takes well under 2 s.

## Re-checked on 2026-10-23

After risk analysis, dependency matrices, the simulator's clock and model
exchange landed, the engine benchmark was run again in Node
(`npm run bench -- --engine --lines 10000,50000 --runs 3`, medians of 3,
through the shared test gate, load average under 1.5). The browser benchmark
and the 100k size were not re-run, so the Chromium tables above and the 100k
column are the 2026-10-22 figures.

| ms (memory MiB) | 10k on 10-22 | 10k on 10-23 | 50k on 10-22 | 50k on 10-23 |
| --- | ---: | ---: | ---: | ---: |
| open: analysis | 1161 | 1114 | 7348 | 6747 |
| open: checks | 455 | 482 | 2928 | 4332 |
| open: page model | 15 | 14 | 98 | 73 |
| keystroke: analysis | 1127 | 1057 | 6718 | 6948 |
| keystroke: checks | 449 | 507 | 2774 | 4511 |
| completion | 32 | 24 | 55 | 61 |
| hover | 240 | 222 | 1394 | 1215 |
| table: product bill of materials | 46 | 42 | 1001 | 784 |
| WebAssembly memory | 333 | 333 | 1153 | 1153 |

The numbers hold, except the checks at 50k lines: 4.3–4.5 s rather than
2.8–2.9 s. That one hasn't been looked into yet; treat the 50k and 100k
checks figures above as optimistic.

## Remaining limits

- **Every keystroke re-analyses the whole project** in the toolkit: about
  1.1 s at 10k lines, 7 s at 50k and 16 s at 100k, then the checks (0.5 s,
  3 s, 5 s; 4.3 s at 50k on 2026-10-23, see above). Session, `check()` and
  the adapter's first reads are each linear in the project; the incremental
  path (`fromSourcesSettled`) saves nothing measurable. Upstream request 12.
  The app keeps it from piling up (one analysis at a time, a longer pause
  before analysing a large model) but can't make it shorter.
- **The first hover after an edit** rebuilds the language server's copy of
  the workspace (1.4 s at 50k, 3 s at 100k) and blocks the worker meanwhile.
  Upstream request 13.
- **Memory.** The instance can't grow past 2 GiB; 100k lines takes about
  1.8 GiB after an edit, the checks and a hover (and on a phone the browser
  may refuse much less). A project much over 100k lines will run out.
  Upstream request 14.
- **One worker.** Highlighting, completion and hover wait while an analysis
  or the checks run. A second, syntax-only worker would let highlighting
  through; completion and hover need the analysed model. Upstream request 15.
- **The product's bill of materials** takes 1 s at 50k and 3.6 s at 100k in
  the worker: the composition rows are walked for the whole model before the
  view's `expose` narrows them.
- **Open** at 100k is about 30 s on a desktop (17 s of it the analysis),
  and 45–60 s with a throttled page.
- **Not measured**: a real phone (only DevTools CPU throttling, which slows
  the page but not the worker, so engine times on a phone will be several
  times the desktop's); `performance.measureUserAgentSpecificMemory` (it
  needs a cross-origin isolated page; the worker's WebAssembly memory is
  reported instead); typing a run of characters (the benchmark types one);
  the throttled 100k run before the fix (the unthrottled one didn't finish
  its table in 18 minutes).

## Guardrails

- `tests/unit/large-model.test.ts` (in `npm test`): a generated 10k-line
  project is valid (no problems), analysed, re-analysed after a keystroke,
  checked and tabled within generous budgets; the page's elements, tree and
  requirements are built within a second; and a tree of 50k elements nests
  within 3 s (quadratic, it took about 20 s).
- `tests/e2e/large-model.spec.ts`: the 10k-line project opens in the browser
  within 90 s with no problems, the explorer shows at most a page of rows,
  a package opens, the tables of every requirement and of the product's
  parts open, and a subsystem's interconnection diagram draws.
- `npm run bench` for the full measurements.
