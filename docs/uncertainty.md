# Uncertain values

A value in a model can say how much it varies: a tolerance band, or a
distribution. The budgets and the design checks then show the spread of
what is worked out from such values and how often a limit is met, beside the
nominal figures they always showed. This page is the design: how the
uncertainty is written in SysML, how it is propagated, how accurate the
answers are, and how tolerance analysis (stack-ups) builds on it.

The code: `src/lib/uncertainty/` (the propagation core: pure TypeScript, no
page, no engine), `src/lib/engine/toolkit/uncertainty.ts` (reading the model
and following its expressions), `views/budgetSpread.ts` (the budgets),
`evaluation.ts` (the checks), and the library
`src/demo/drone/libraries/Uncertainty.sysml`
(`src/lib/create/uncertaintyLibrary.ts` copies it into a project).

## In the model

The value keeps its value (the **nominal**), and owns an attribute typed by
one of the `Uncertainty` library's attribute definitions:

```sysml
attribute :>> mass default 1100 [g] {
    attribute tolerance : Uncertainty::Tolerance { :>> plus = 60 [g]; :>> minus = 40 [g]; }
}
attribute capacity :> energy default 216 [W*h] {
    attribute uncertainty : Uncertainty::Normal { :>> standardDeviation = 6 [W*h]; }
}
attribute usableFraction : Real default 0.85 {
    attribute uncertainty : Uncertainty::Uniform { :>> min = 0.8; :>> max = 0.9; }
}
```

| Definition | Fields | Left out |
| --- | --- | --- |
| `Normal` | `mean`, `standardDeviation` | `mean`: the nominal |
| `Uniform` | `min`, `max` | |
| `Triangular` | `min`, `mode`, `max` | `mode`: the nominal |
| `Tolerance` | `plus`, `minus`, `reading`, `sigmas` | `minus`: as `plus`; `reading`: `normal`; `sigmas`: 3 |

The attribute's name is free (`tolerance`, `uncertainty`); what counts is
its type, or a type that specializes one of these (a project can define
`attribute def UniformTolerance :> Tolerance { :>> reading = ToleranceReading::uniform; }`).

**A tolerance's reading** is stated, never assumed silently. The band is
always `nominal − minus` to `nominal + plus`, and worst-case analysis takes
its ends. Sampling reads it as `reading` says:

- `normal` (the default): a normal distribution centred on the band, the
  band spanning `sigmas` standard deviations each way (3: 99.73 % of values
  inside). An asymmetric band `+60/−40 g` is centred 10 g above the nominal,
  with σ = 100 g / 6. This is the usual reading of a process that holds its
  tolerance at ±3σ.
- `uniform`: any value in the band as likely as any other (all you know is
  the band).
- `triangular`: most likely at the nominal, falling to none at the band's
  ends.

**Units** work as everywhere else: the numbers are read in any unit of the
value's kind and converted (a tolerance of `5 [g]` on a value of `1.1 [kg]`),
a number without a unit is in the value's unit, and a unit of another kind
(`5 [m]` on a mass) is refused: the value is then taken as exact and the
reason kept (`Spreads.problems`). A temperature in °C or °F is not sampled
(its zero shift makes sums ambiguous, as in the rest of the app).

**Why attributes, not metadata.** Metadata was the first choice: it is
SysML's way to annotate. But SysML v2 allows only *model-level evaluable*
expressions as metadata values, and a quantity with a unit (`60 [g]`, the
`[` operator) is not one: the OMG pilot implementation rejects
`@Tolerance { plus = 60 [g]; }` with "Must be model-level evaluable". A
tolerance without its unit would break the rule that units work everywhere.
Attribute definitions and usages have no such limit, and they say what they
mean in any SysML v2 tool: the mass has a tolerance whose `plus` is 60 g. The
library and the demo pass the pilot check (`tools/interop/pilot-check.sh
src/demo/drone`: 23 files, 0 errors, the demo's 6 known warnings), and the
nominal value, which every other tool reads, is unchanged.

**One draw per part.** A value is sampled once for each place it is used,
by its path (`drone::frontLeft::motor::powerDraw`): the four motors of one
definition vary independently, as four real motors do. A collection whose
parts aren't named one by one (`part motors : Motor[4]` without its
members) is one value counted four times, so its parts vary together: the
cautious reading for a sum. Correlation between different values is not
modelled yet (they are independent).

## What the app shows

- **Design checks** lead their explanation with how often the check is met
  over the samples: "Met in 98.8 % of cases: drone.endurance =
  27.54 min, in 90 % of cases between 25.59 and 29.54 min (needs ≥ 25 min)."
  "Met in all 10,000 sampled cases" when no sample fails, "Met in only
  33.0 % of cases; not met at the values given" when the nominal fails. The
  verdict (satisfied, violated) is still the one at the nominal values, so
  nothing else in the app changes its mind with the sampling. The share is
  also the checks table's `metIn` field, and the check's `spread` carries
  the full numbers (`types.ts`, `CheckSpread`).
- **Budgets** get two columns, only when something they add up varies:
  **Likely range** (P5 to P95 of the row's total: 90 % of cases) after
  `total`, and **Within limit** (the share of cases that meet the
  requirement that limits the row, the check's own number) after `check`.
  All rows come from one run, so an assembly's range and its parts' agree
  case by case.
- **Models without uncertainty** take none of this: `Spreads.any` is false,
  the checks have no `spread`, the explanations and the budget columns are
  exactly as before (`uncertainty.test.ts`, "a model without uncertain
  values").

## How it is worked out

**Following the model.** For a value, the app follows the expression the
model gives it (`emptyMass = airframe.mass + battery.mass + … +
sum(rotors->collect { in r : Rotor; r.mass })`, `endurance =
HoverEndurance(battery.usableEnergy, hoverPower)`) through the values it
reads, as the app's evaluator reads them (`sim/expr.ts`): `->collect` over
the parts a collection names, the model's calc defs inlined with their
parameters bound. It stops at uncertain values (the inputs) and at values
nothing uncertain feeds (constants, the toolkit's own values, exactly as
the app shows them). An expression the evaluator can't read is taken at its
value and the spread's `note` says which. Then:

- **Compiled** (`uncertainty/compile.ts`): the expression becomes a plain
  number function of the inputs, with every number in the coherent SI unit
  of its dimension, so units are worked out once and a sample costs a few
  additions and multiplications. The rules are the evaluator's (a bare
  number beside a quantity takes its unit; `+` and comparisons need one
  dimension). Unit tests compare it with the evaluator on the same values.
- **Checked against the nominal.** At the nominal values, the compiled
  function must give the value the app shows (to 1 part in 10⁹), and a
  compiled constraint the verdict it shows; otherwise no spread is shown,
  rather than a wrong one.

**Monte Carlo** (`uncertainty/propagate.ts`, `sampling.ts`). Each input is
sampled through its distribution's quantile function from uniform numbers.
The generator is sfc32 (128-bit state), seeded through splitmix32 with the
seed (1) and the input's path, so each input has its own stream: its
samples don't depend on which other inputs a run includes, and the budget
row and the check on the same total see the same samples. 10,000 samples by
default; a run stops at its time budget (250 ms) once it has 1,000, and says
how many it took (`samples`). Latin hypercube sampling is an option of the
core (each input's range cut into n strata, one sample in each, in a random
order per input): means and spreads settle with far fewer samples, and a run
cut short stays unbiased. The app uses plain sampling, whose error is the
textbook one below.

**Outputs** (`statistics.ts`): mean, standard deviation (n − 1), minimum and
maximum, P5/P50/P95 (linear interpolation, as Excel's `PERCENTILE.INC`), a
20-bin histogram, and for a limit the share of samples that meet it with
its 95 % Wilson interval (honest at 0 % and 100 %: all 10,000 met gives
99.96 % to 100 %). A sample whose result is not a finite number (a division
by zero) is counted as failed and as not meeting the limit.

**First order and worst case**, beside Monte Carlo, to cross-check it and
because tolerance analysis needs all three:

- *First order* (`firstOrder`): the model linearised at the inputs' means
  by central differences, σ = √Σ(∂f/∂xᵢ · σᵢ)², with each input's share of
  the variance. Exact for a linear model (a sum, a stack); for a product it
  misses the σx²σy² term of the variance, and for a quotient it misses the
  upward bias of the mean (about x·σy²/y³), which Monte Carlo keeps: the
  unit tests show both against their closed forms.
- *Worst case* (`worstCase`): every input at the end of its range that
  pushes the result furthest each way, the directions found from the model.
  Exact for anything that moves one way with each input over its range
  (sums, stacks, products and quotients of positive values). A normal
  without a band is taken at ±3σ.

## Accuracy

Monte Carlo's error shrinks as 1/√n. At the default 10,000 samples:

| Estimate | Standard error | At 10,000 samples |
| --- | --- | --- |
| Mean | σ/√n | 1 % of σ |
| Standard deviation (normal result) | σ/√(2n) | 0.7 % of σ |
| A share p meeting a limit | √(p(1−p)/n) | 0.5 points at p = 50 %, 0.1 points at p = 99 % |
| P5 or P95 (normal result) | √(p(1−p)/n) / f(qₚ) | 0.021 σ |

So "Met in 98.8 % of cases" is good to about ±0.2 points (two standard
errors), and a share is shown to one decimal; above 99.9 % but not 100 % it
reads "over 99.9 %". The unit tests hold each estimate to four standard
errors of its known answer (sums of normals, uniform and triangular
moments, percentiles, a product, a quotient, the demo's endurance by
numerical integration); the runs are seeded, so those bounds state the
method's accuracy and the tests don't flicker.

**Speed.** The demo's mass budget with its spreads, 31 rows from one run of
10,000 samples plus worst case, renders in about 50 ms in Node; the
endurance check's run takes a few milliseconds. Everything is cached per
analysis (`Spreads.cached`).

## Towards tolerance analysis

A tolerance stack-up is a chain of dimensions with directions (a gap is the
housing less the parts in it) and three answers side by side: worst case,
RSS and Monte Carlo. The core already has all three, and
`uncertainty/stack.ts` is the thin layer itself: `stackUp(dimensions)` with
each dimension's tolerance and direction gives the nominal, the worst case
(the tolerances added), the RSS band (first order, ±3σ) and, when asked, a
Monte Carlo run with the share meeting a limit. Its unit test is a 4-part
stack worked by hand (gap 0.50 ± 0.28 worst case, ± 0.146 RSS).

What remains is reading the chain from the model and showing it:

1. **The chain in SysML**: the gap is an ordinary attribute whose value is
   the stack, `attribute gap :> length = housing.length - a.length -
   b.length - c.length;`, the dimensions with tolerances as above. The
   directions need not be written: they are the signs of the first-order
   sensitivities (`firstOrder(...).sensitivities`), which also handle a
   dimension that enters twice or with a ratio. A requirement `gap >= 0.4 [mm]`
   gives the limit.
2. **A row provider** `stack:<feature>` (beside `budget:` in
   `views/rows.ts`): one row per contributing dimension with its nominal,
   tolerance, direction, sensitivity and share of the variance
   (`firstOrder(...).shares`, the "percent contribution" a tolerance analyst
   looks for first), then the result's rows: nominal, worst case, RSS and
   Monte Carlo (P0.135 to P99.865, the ±3σ equivalent, and the share within
   the limit).
3. **A view def** `ToleranceStackup` in `ModelViews` with those columns,
   used like the budgets (`view gapStack : ToleranceStackup { expose …; }`).

Beyond that: correlated inputs (a shared fixture, one batch of parts) need a
correlation matrix and correlated sampling (Cholesky on the normal scores);
process capability figures (Cp, Cpk) follow from the Monte Carlo summary and
the limits; 2D and 3D stacks need geometry the model doesn't have.

## Not yet

- No form to give a value a distribution: write the SysML (help: "Say how
  much a value varies"). `distributionText` and `missingUncertaintyLibrary`
  in `src/lib/create/uncertaintyLibrary.ts` are what such a form would use.
- Trade studies don't show a spread; they could reuse `Spreads` per
  alternative.
- The seed, the sample count and Latin hypercube sampling are options of
  the core and of `Spreads.options`, not settings in the app.
- Correlation between different values (see above).
