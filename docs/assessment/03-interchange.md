# §3 Model import, export and interoperability

> Written before the fixes that followed it: what became of each critical finding is in [the assessment summary](README.md#critical-findings-and-what-became-of-them).

Assessed on `claude/assess-interchange` (based on `claude/interop-tools`, a1b2509, which
holds the reference tools: the OMG pilot implementation and Eclipse SysON, see
`docs/interop-tools.md`). Covers checklist §3, prioritized question 3 (exchange a
multi-file model with SysON without semantic loss) and the external-exchange leg of
question 1. Scores are Tessera's unless marked "engine" (the sysml-toolkit 0.10.10 does
parsing, the JSON serialization and the JSON → text lift). Everything below marked "run"
was run in this session on 2026-10-23.

## The acceptance test (as recommended by the checklist)

**Model.** `src/lib/interchange/fixtures/acceptance/` — 4 files, 5 top-level packages,
809 elements: nested packages, `private`/`public` imports, references across files in both
directions, ISQ/SI units (`9.5 [kg]`, `40 [m / s]`, `75 [kW * h]`), multiplicities
(`[4]`, `[0..1]`, `[1..2]`, `[0..*] ordered nonunique`), specialization, redefinition
(`:>> motor [2]`, `:>> maxSpeed default = …`), an alias, a calculation and its call, a
constraint def and an asserted constraint, requirement defs with subject / assume /
require, requirement usages that redefine attributes, a verification case with
`verify`, `satisfy`, a `dependency`, ports with a conjugated port (`~PowerPort`), an
interface def and usage, states with entry/do actions and transitions with `accept` and
guards, actions with successions, an allocation, prefix (`#Safety`) and body (`@Safety {
level = 3; }`, `metadata … about`) metadata, `variation`/`variant`, `individual`.
Tessera: 0 errors, 0 warnings. **OMG pilot 0.57.0: 0 errors, 0 warnings** (run).

**Comparison.** `src/lib/interchange/semantics-testing.ts`: a model's meaning as facts,
independent of ids, text layout and file names, computed from element JSON of any tool.
Each element is keyed by qualified name (`Vehicle::Structure::Car::wheels`), by
`(:>>name)` for an unnamed redefinition, or by kind and position under its owner; its facts
are its kind, how it is owned (membership kind, visibility, `kind` of
subaction/transition/requirement-constraint memberships), meaning-bearing properties
(flags, direction, literal values, operators, comment bodies) and every non-membership
relationship with its target's key (library elements by qualified name). Implied
relationships, values fixed by the metaclass and derived names are normalized away. The
fixture yields 512 keys / ~1,200 facts; the test asserts spot facts (typing, `[4]`,
redefinition target, unit operator, conjugated typing, satisfy/verify targets, guard,
import visibility, alias) so a digest that captures nothing cannot pass.

**Commands.**

```sh
npx vitest run src/lib/interchange/acceptance.assessment.test.ts src/lib/exchange/syson.assessment.test.ts
tools/interop/acceptance.sh                       # everything below, with SysON + the pilot
node tools/interop/tessera/run.mjs compare <model dir|elements.json[.gz]> <same>   # one comparison
```

`tools/interop/acceptance.sh` sends the model through every route (JSON ×3 forms, `.kpar`,
SysON text upload, SysON's element JSON, SysON's text export, Tessera's API client against
SysON), runs the pilot on every text artifact, and compares each result's semantics with the
original. `tools/interop/pilot/PilotExport.java` adds the pilot's own abstract syntax
(its Jupyter kernel's `%export`) as a referee. New headless commands:
`run.mjs kpar|unkpar|semantics|compare`.

### Results (run; `tools/interop/acceptance.sh`, twice, same numbers)

| Route | What came back | Semantic difference to the original |
| --- | --- | --- |
| Tessera → JSON (default) → Tessera | 809/809 elements, no notes, no problems | **none** (0 / 0 / 0) |
| Tessera → JSON (derived properties) → Tessera | 809 elements; **report: 104 "not carried over", 807 "reads differently"** (demo: 1,172 and 8,371) | **none** — the notes are false |
| Tessera → JSON (with the standard library) → Tessera | same | **none** |
| Tessera → `.kpar` → Tessera | 4 files byte-identical, no warnings | **none** |
| Demo (22 files, 8,385 elements) → JSON → Tessera | 8,385/8,385, 2 "repaired" notes | **none** |
| Tessera text → SysON (upload, per file and as one document) | 807 elements; SysON reports 2 unresolved names (`total`, `limit` in `constraint def MassBudget`'s result expression) | 10 keys only in ours, 17 only in SysON's, 148 changed (classified below) |
| SysON's text export → Tessera | 4 files; Tessera: 4 errors (1 syntax); pilot: 60 errors in 3 of 4 files (bare `import` and `= ;` are syntax errors to it, then unresolved names) | 61 keys lost, 5 added, 8 changed (most losses raise no error) |
| SysON's element JSON → Tessera ("Open from server") | **refused**: "The engine could not read these elements: … cannot name reference target … (element outside document?)" | — |
| SysON's JSON of a one-file model (EngineeringBasics) → Tessera | imports; text identical in meaning | 0, but the report says 6 things "couldn't be carried over" and 45 "read differently" (false) |
| Tessera "Save … as a new project" on SysON | **fails, reported**: "The server answered with something other than JSON. Is … the address of a SysML v2 API?" | nothing created on SysON |
| Tessera "Save to server" into a SysON project | **fails, reported** (same message) | SysON unchanged (checked: 0 elements after) |
| Pilot's own export of the fixture (`PilotExport.java`) vs Tessera | 2,978 elements: it includes implied features (multiplicities, result and expression parameters) and the library elements it reaches | 10 / 139 / 52 — nearly all the pilot's implied elements and its library naming; the rest are the rows marked "pilot" below |

**The pilot on every artifact Tessera exported** (`acceptance.sh`, pilot 0.62.0): the text
re-imported from each JSON form and the contents of the `.kpar`: 4 files, 0 errors, 0
warnings each. (A `.kpar` of a project that leans on the bundled view libraries would not
pass: see the last question.)

**What SysON makes of our text, classified** (Tessera fixture vs SysON's API JSON; the
pilot's export decides who follows the specification):

| Difference | Count | Who is right (pilot) | Effect on exchange |
| --- | --- | --- | --- |
| Attribute/enum usages `isComposite: true` in SysON | 92 | Tessera (pilot: false) | SysON-side |
| Expression argument memberships `private` in ours, `public` in SysON | 52 | Tessera (pilot: private) | none for meaning |
| `verify carMass` held with `kind: assumption` in SysON | 1 | Tessera (pilot: requirement) | **SysON turns a verified requirement into an assumption** |
| `entry; then off;` a transition in SysON, a succession in ours | 1 tree | Tessera (pilot: succession) | SysON-side |
| `total`/`limit` unresolved in `MassBudget` | 2 | Tessera (pilot resolves) | SysON-side; it then prints them empty |
| **Metadata body `level = 3;` a new feature `level` in ours; `:>> level` with a Redefinition in SysON** | 2 trees | **SysON** (pilot: Redefinition) | **engine bug: our JSON states metadata values that don't set the metadata's attribute** (see Critical 2) |
| Connection-end ports `isConstant: true` in SysON | 7 | SysON (pilot: true) | engine deviation, minor |
| Satisfy subject parameter `direction: in` in SysON | 4 | SysON (pilot: in) | engine deviation, minor |
| Allocation def ends in `FeatureMembership` (SysON) vs `EndFeatureMembership` (ours) | 2 | SysON (pilot: FeatureMembership) | engine deviation |
| `accept` payload `direction: inout` in ours only | 2 | SysON/pilot (none) | engine deviation, minor |
| `InvocationExpression` typed by `Sum2` in SysON | 1 | — | — |
| Top-level comments | 4 | — | SysON's API leaves out root namespaces (normalized) |

**What SysON's text export loses** (SysON 2026.9.3's *Download*; its element JSON still
has these, so it is the printer): with an error in Tessera and the pilot —
`attribute totalMass :> mass = Sum2(…)` printed `= ;`, `variant part` printed `part`,
`public import` printed bare; **silently** — the whole `calc def Sum2`, the
`verification def MassTest` and `verification massTest`, the `dependency trace`, the
`metadata Safety about carMass { level = 2; }`, the alias `Kilogram`, the constraint
def's expression (`total <= limit`), `ordered nonunique`, the body of `@Safety { level =
3; }` (printed as a bare `#Safety` prefix), and `satisfy … by
Vehicle::Configurations::myCar` printed `by myCar` (no longer resolvable from
`Traceability`). On the demo (tools agent's run, re-compared here):
`today's` in a doc comment comes back as `todays` (silent text change), and the six
`satisfy … by drone.x` chains resolve differently (the language agent's finding).

## Questions

### Can Tessera import multi-file models with nested packages, imports, and cross-file references?
- **Answer:** Yes, as text (folder, GitHub, `.kpar`/zip) and as SysML v2 JSON that Tessera or a tool following the same structure wrote. The 4-file acceptance model and the 22-file demo come back from JSON with no notes and an identical semantic digest; JSON import splits the model into one file per top-level unit, named after what it declares (`Basics.sysml`, `Vehicle.sysml`; `Reqs` and `Traceability` share a file), so the original folder layout is not restored. `.kpar` gives back every file byte for byte. JSON written by SysON for the same model is refused (next question).
- **Evidence:** `src/lib/interchange/acceptance.assessment.test.ts` ("keeps every element's meaning" ×3, ".kpar round trip"), run; `tools/interop/acceptance.sh` (pilot checks the model and every re-imported text: 0 errors), run; existing `src/lib/engine/toolkit/interchange.test.ts:227` (demo round trip), not re-run.
- **Limitations:** File paths and file boundaries are not part of JSON, so a JSON round trip renames and regroups files (and with them, element ids). `.kerml` content exported to JSON cannot be imported back (the lift writes SysML; refused with "does not parse") — `acceptance.assessment.test.ts` "KerML files…".
- **Status:** Verified
- **Score:** 3 (Tessera). The pilot independently checks the input and the re-imported text, but the semantic equality is Tessera's own engine reading both sides, so not 4.
- **Next action:** None for SysML; planned capability: keep folder layout in JSON exchange (e.g. a path per root namespace), KerML lift.

### Can it import models authored in SysON without manual cleanup?
- **Answer:** No, except small ones. Through the Systems Modeling API ("Open from server") or a JSON file, Tessera refuses SysON's element JSON for any model with a conjugated port (`~PowerPort`: SysON leaves the implied `ConjugatedPortDefinition` unnamed), a state's `entry; then …` (the succession points at an unnamed entry action), or a name SysON could not resolve; the refusal is an error dialog, nothing is half-imported. A one-file model without those imports with the same meaning, but the report claims losses that did not happen (6 "not carried over" typings/multiplicities; 45 "reads differently" about derived properties SysON sends). SysON's text export is not the model (above): Tessera shows the three errors it causes in the Problems panel, but most of what SysON's printer drops (a calc def, a verification case, a dependency, an alias, metadata values) leaves valid text and raises nothing — no tool can see that loss from the text alone.
- **Evidence:** `acceptance.assessment.test.ts` (SysON fixtures captured from SysON v2026.9.3 in `src/lib/interchange/fixtures/syson/`): "says plainly that it cannot open SysON's element JSON…" passes; `it.fails` "opens SysON's element JSON with the same meaning", "reads SysON's text export back with the same meaning", "opens a one-file SysON model without claiming that present typings were lost"; live: `tools/interop/acceptance.sh`, and the tools agent's drone and Batmobile runs. Run.
- **Limitations:** The refusal is the toolkit's lift (engine: cannot name an unnamed target); the false notes are Tessera's (`src/lib/engine/toolkit/interchange.ts:458-461` decides "lost" by id, and the toolkit gives ids by position, so SysON's other member order — multiplicity before typing — reads as loss; derived properties in a full-form file are compared against the compact form).
- **Status:** Verified (negative)
- **Score:** 1 (Tessera), 1 (engine).
- **Next action:** bug fix — (a) decide "not carried over" by place (`compareModels(own, lifted)`) instead of by id, and compare only compact-form properties (`canonicalModel` already exists); (b) before lifting, give a `ConjugatedPortDefinition` without a name `~<original>` and name unnamed succession targets, or ask upstream to lift references to unnamed elements.

### Can a model exported from Tessera be reopened in SysON with equivalent semantics?
- **Answer:** Only as text, and only approximately. SysON imports the acceptance model's text (807 elements; 2 names unresolved, a SysON gap) and the demo (8,787 elements, with the cycles and `satisfy` chains the tools agent describes). Compared by semantics, SysON's reading differs in 148 elements; by the pilot's judgement most of those are SysON's (attributes composite, a `verify` turned into an assumption, unresolved constraint parameters, entry transition), five kinds are the toolkit's (below and Critical 2). Through the API, Tessera cannot create a project on SysON or save to one at all (both fail with a misleading "other than JSON … is this the address?" message; SysON stays unchanged). SysON's *Upload document* refuses both Tessera's JSON file and its `.kpar` ("An unexpected error has occurred"; run), so text is the only file route.
- **Evidence:** `tools/interop/acceptance.sh` → `compare-syson-api-json.json`; `src/lib/exchange/syson.assessment.test.ts` (a server answering as SysON did live: `it.fails` "creates a project there", "saves a changed element there"; passing "says that creating failed", "says that saving failed, and the server is unchanged"); live probe of SysON's commit endpoint (below). Run.
- **Limitations:** What SysON accepts through its API (live, 2026-10-23): `POST /projects?name=`; a commit only with `identity: {"@type": "DataIdentity", "@id"}`; with that, a minimal payload changing a property of an existing element is applied (201), a full payload (as Tessera sends) fails with an empty 200, **and new elements are answered 201 and dropped**. So even a corrected client can only update existing elements' attributes on SysON.
- **Status:** Partially verified
- **Score:** 2 (Tessera, text route; checked automatically against SysON, but it does not pass). API route: 1 (fails, reported).
- **Next action:** bug fix in this order: (1) after any commit, read the branch back and compare (`planPush` against the new head must show 0 changes), reporting what the server did not keep; (2) `createProject` with `?name=` (and the JSON body, for the pilot server); (3) `"@type": "DataIdentity"` on identities; (4) for SysON, minimal payloads (changed properties only). (1) must come first: without it, (3) turns a reported failure into a silent loss.

### Are constructs unsupported by Tessera's UI preserved during import, editing, and export?
- **Answer:** For import/export, yes: text is the source of truth, `.kpar` and folders carry it byte for byte, and the JSON route carried every construct of the acceptance model (variation/variant, individual, alias, metadata prefix and body, `default` values, allocations, accept with guard, ordered/nonunique, conjugated ports, verify/assume) with an identical semantic digest. Through JSON, `//` comments, blank lines and layout are lost (documented), `doc`/`/* */` comments kept. Editing is the round-trip agent's area (02-round-trip): edits are targeted text edits, so untouched constructs are untouched.
- **Evidence:** `acceptance.assessment.test.ts` (JSON ×3, kpar), run; `docs/interchange.md` "What doesn't, and why".
- **Limitations:** Through SysON, constructs are lost (above). Through JSON the metadata-body values are mis-encoded for other tools (Critical 2), though Tessera reads its own JSON back correctly.
- **Status:** Verified (import/export)
- **Score:** 3
- **Next action:** None (Tessera); engine fix for metadata bodies.

### Are supported SysML, KerML, archive, and JSON interchange workflows clearly distinguished?
- **Answer:** Mostly. The project menu has separate items ("Download as .kpar", "Download as SysML v2 JSON…", "Save to server"/"Open from server"); "Import" on Your projects takes `.kpar`, `.zip` and `.json` and tells them apart by extension or content; `docs/interchange.md` has a table of the three routes. KerML: `.kerml` files are first-class as text and in `.kpar`, but nothing says that a JSON export of a project with KerML cannot be opened again (it fails with a parse error naming a `document-1.sysml` the user never had).
- **Evidence:** `src/routes/projects/+page.svelte:194-200` (`isJson`), `ExportJson.svelte`, `docs/interchange.md:9-13`; KerML test in `acceptance.assessment.test.ts`. Run.
- **Limitations:** The JSON export dialog does not say that `//` comments and layout don't come across (only the help it links to does).
- **Status:** Partially verified
- **Score:** 2
- **Next action:** additional testing / doc: say in the export dialog what JSON drops; name KerML in the JSON limits.

### Does the application distinguish lossless interchange from best-effort conversion?
- **Answer:** Partly. The JSON import dialog leads with one sentence — "Everything came across: …" (green) or "N things couldn't be carried over; M read differently" (warning) — and lists the elements, with a downloadable full report; the JSON export lists references left out and files only partly exported. `.kpar` is lossless but nothing in the UI says so. The best-effort report is not trustworthy outside the default form: it cries loss where there is none — **Tessera's own "Add derived properties" export, opened again, reports 104 things "couldn't be carried over" and 807 that "read differently" for the acceptance model (1,172 and 8,371 for the demo) while the meaning is identical** (implied `result`/`thisThing` features listed as elements, derived properties compared); SysON's one-file model: 6 false "not carried over", 45 false "reads differently"; an element whose owner is missing is reported "not carried over" though it is written at top level), and for duplicate ids it names the wrong element (below).
- **Evidence:** `src/lib/exchange/report.ts`, `ImportSummary.svelte`; `acceptance.assessment.test.ts` ("says everything came across" for the default and library forms passes; `it.fails` "…with derived properties" and the SysON one-file case); probe of malformed JSON. Run.
- **Limitations:** A false alarm is conservative (no silent loss), but it trains people to ignore the report.
- **Status:** Verified
- **Score:** 2
- **Next action:** bug fix (as in the SysON import question).

### Are model identities and cross-references preserved across export/import cycles?
- **Answer:** Cross-references: yes — every reference in the acceptance model and demo resolves to the same qualified name after JSON and `.kpar` round trips. Identities: only while files stay put. The toolkit derives ids from the file path and the element's place, so two exports give the same ids, but export → import → export changes all 809 (import renames files), and moving one file changes 113 of 809. Text carries no ids, so `.kpar`/Git keep identity only implicitly (same paths → same ids). With an API server, Tessera matches its elements to the server's by place and keeps the server's ids (`rebaseIds`), so a server project keeps its ids across saves (tested against the mock server only; SysON saves fail).
- **Evidence:** `acceptance.assessment.test.ts` ("keeps element ids from one export to the next…" passes; `it.fails` "keeps element ids through export → import → export"); existing `src/lib/exchange/api.test.ts:127` (server ids by place). Run.
- **Limitations:** Ids are not KerML 9.1 `uuid5(base + name)` (documented upstream request); elements renamed and moved at once are matched by position and can be mistaken (documented).
- **Status:** Verified
- **Score:** 2
- **Next action:** planned capability: keep ids in the text (e.g. element ids as metadata, or a sidecar map in `.kpar`) and restore original paths on JSON import.

### Are units, multiplicities, specialization, redefinition, requirements relationships, and constraints preserved?
- **Answer:** Between Tessera sessions (JSON ×3 forms, `.kpar`): all preserved, by digest. Into SysON as text: units, multiplicities, specialization, redefinition and satisfy are preserved; SysON changes `verify` into an assumption, leaves the constraint def's parameters unresolved, and its text export drops a calculation call and metadata values. Into other tools as JSON: the toolkit encodes metadata body values without their redefinition (Critical 2).
- **Evidence:** acceptance results table; `compare-*.json` in the acceptance run; `semantics-testing.ts` facts cover typing, multiplicity bounds, unit operators, specializations, redefinitions, satisfy/verify targets and kinds, constraints. Run.
- **Limitations:** The digest compares structure; it does not evaluate values (a unit converted to an equivalent unit would count as a change).
- **Status:** Verified (Tessera ↔ Tessera), Partially verified (with SysON)
- **Score:** 3 (Tessera ↔ Tessera); 2 with SysON.
- **Next action:** bug fix (engine: metadata bodies); report SysON's `verify` kind and printer losses upstream.

### Are malformed archives, missing files, duplicate entries, and unexpected paths handled safely?
- **Answer:** Archives (`.kpar`/zip): the reader detects what it can — truncated or corrupt ZIPs refused with a readable reason, checksum mismatches and files listed in `.meta.json` but missing become warnings, non-UTF-8 files are listed as skipped — **but the import page discards those warnings and the skipped list**, so a non-UTF-8 model file is left out of the imported project without a word (Critical 1, owned and being fixed by the data-integrity agent). `../`, absolute and drive-letter paths are kept as project paths (they cannot reach disk; GitHub refuses them); duplicate entries keep the last silently; entry CRCs are not checked; no decompression size limit. JSON: not-a-list and missing `@id`/`@type` are refused plainly; a reference to an unknown id is kept visibly (warning and a quoted name in the text); the toolkit's private `{"@ref": "Name"}` is accepted and resolved by name; **duplicate `@id`s are not refused** — the later element replaces the earlier, and the report names the wrong element ("A::q … not carried over: a literal integer" when `A::p` disappeared).
- **Evidence:** data-integrity agent: `src/lib/interchange/kpar.assessment.test.ts`, `tests/e2e/assessment-data-integrity.spec.ts` ("importing an archive says which files were left out", `test.fail`) — see `08-data-integrity.md`. Mine: `acceptance.assessment.test.ts` "malformed SysML v2 JSON" (`it.fails` duplicate ids; passing unknown id, not-a-list). Run (mine).
- **Limitations:** Overlap: archive reading is shared with 08; findings above are theirs, cross-checked here. Huge inputs not tested.
- **Status:** Verified
- **Score:** 1 while the import page drops warnings (critical); 2 once fixed.
- **Next action:** bug fix — show archive warnings/skipped (08), refuse duplicate `@id`s in JSON (`checkStructure` already finds them), normalise archive paths.

### Are compatibility tests automated against models produced by external tools?
- **Answer:** Now, yes: `acceptance.assessment.test.ts` reads what SysON v2026.9.3 produced from the acceptance model (element JSON and text export) and a one-file SysON model, so every unit-test run checks Tessera against another tool's output without SysON running; `tools/interop/acceptance.sh` regenerates them live and adds the pilot. Before this assessment the only "other tool" inputs were a hand-written `garage.json` ("another tool": random ids, derived properties) and the OMG library `.kpar` archives (`src/lib/interchange/kpar.test.ts:233`, which runs only when a `sysml-cli-main` checkout sits next to the repository, as it does here).
- **Evidence:** the files above; `tools/interop/` (tools agent). Run.
- **Limitations:** The live SysON/pilot run is not in CI (needs Docker and Java); the captured fixtures pin one SysON version. Most SysON cases are `it.fails` (known gaps).
- **Status:** Verified
- **Score:** 3 (automated against another tool's output, but the results do not pass; 4 is for interop that genuinely passes).
- **Next action:** additional testing: a CI job for `tools/interop/acceptance.sh` (pilot always, SysON on a schedule); make the OMG library `.kpar` test find the release without a sibling checkout.

### Can users identify exactly what changed when an import requires normalization?
- **Answer:** For JSON: yes in form — each note names the element by qualified name and kind, and "reads differently" notes say which property changed and from what to what (`isComposite true → false`); mended printer slips are listed under "Good to know"; the full list downloads as text. In substance, for other tools' files the list is mostly false positives (above), and the files themselves are renamed/regrouped without a note. For archives: nothing is shown (warnings discarded).
- **Evidence:** `report.ts`, `interchange.ts:470-500`; acceptance tests and probes. Run.
- **Limitations:** No diff view of the imported text against the file; no note that files were renamed.
- **Status:** Partially verified
- **Score:** 2
- **Next action:** bug fix (false positives), planned capability (list renamed/regrouped files).

### Does Tessera avoid undocumented private extensions that make models unusable elsewhere?
- **Answer:** Mostly. Exports contain only standard KerML 10.4 JSON (unresolved references, which the toolkit writes as the non-standard `{"@ref": "Name"}`, are left out and listed), `.kpar` is KerML 10.3, and the text is plain SysML the pilot accepts. Two exceptions: (1) **implicit view libraries** — Tessera resolves `ModelViews` and `Reporting` from bundled copies when a project lacks them (`src/lib/engine/toolkit/views/libraries.ts`), so a project that names `ModelViews::RequirementsTable` checks clean in Tessera, while its `.kpar` and Git repository lack the package and other tools report unresolved names; the user is not told (documented only in `docs/engine.md`). Projects created in the app get the files written in, so this bites hand-written or imported projects, and projects whose library file was deleted (`RiskAnalysis.sysml` without `Reporting`/`HazardAnalysis` gives 69 pilot errors, `docs/interop-tools.md`). (2) Tessera's `.kpar` omits the mandatory `version` in `.project.json` unless the project has one. Custom libraries (`RiskAnalysis`, `HazardAnalysis`, `DependencyMatrices`, `Reporting`, `ModelViews`) are ordinary SysML files in the project and pass the pilot with their dependencies.
- **Evidence:** `acceptance.assessment.test.ts` "what an exported project needs elsewhere" (`it.fails` "a project that checks clean exports a .kpar that is complete without Tessera"; passing "the acceptance model needs nothing but the standard library"); `interchange.test.ts:124` (left-out references); tools agent's pilot runs on the libraries. Run (mine).
- **Limitations:** —
- **Status:** Verified
- **Score:** 2
- **Next action:** bug fix: when a project resolves anything from the bundled view libraries without holding them, say so in Problems and offer to add them (or add them to `.kpar`/JSON exports); write `version` (e.g. `0.0.0`) in `.project.json`.

## Prioritized question 3: can Tessera exchange a multi-file model with SysON without semantic loss?

No. Tessera → SysON works only as text, and SysON then changes the meaning (a `verify`
becomes an assumption; constraint parameters unresolved) — SysON's defects by the pilot's
judgement. SysON → Tessera works only for small models: element JSON from any model with
a conjugated port or a state entry transition is refused (engine), and SysON's text export
loses or breaks constructs. The Systems Modeling API route fails in both write directions
(Tessera's request shapes; and SysON drops new elements even when the request is right).
Every one of these failures is reported to the user except SysON's text export, which
silently drops whole declarations (calc def, verification case, dependency, alias,
metadata values) while printing valid SysML — Tessera cannot know. No silent loss was
found on Tessera's side of the SysON exchange; the one latent path (a save reported done
when the server answered 2xx but kept nothing) is unreachable with SysON today and is the
first roadmap item.

## Prioritized question 1, external-exchange leg

Within Tessera, export → import keeps the meaning exactly (acceptance model and demo,
three JSON forms and `.kpar`). Across tools the meaning is kept only as far as the other
tool reads SysML the same way: the text route is the faithful one (the pilot accepts the
text with 0 errors), the JSON route carries five abstract-syntax deviations of the toolkit
(one of them semantic, Critical 2).

## Defects on Tessera's side, by whether the user is told

| Defect | Told? |
| --- | --- |
| Archive import drops non-UTF-8 model files and checksum/missing-file warnings | **Silent (critical, 08 fixing)** |
| JSON export encodes metadata body values without their redefinition (engine) | **Silent (critical, engine)** |
| Duplicate `@id` in a JSON file: earlier element replaced | Told, but names the wrong element |
| SysON JSON with conjugated ports / entry transitions refused | Told (error) |
| False "not carried over"/"reads differently" notes on other tools' JSON and on Tessera's own derived-form export | Told something false (conservative) |
| Create project / save on SysON fail | Told, with a misleading cause ("is this the address?") |
| Save reported done whenever the server answers 2xx (no read-back) | Latent silent loss: unreachable with SysON today, reachable once the identity is fixed, and with any server that accepts and drops |
| `.kpar` of a project relying on bundled view libraries is incomplete | Silent in Tessera (other tools report it) |
| KerML project's JSON cannot be opened again | Told (parse error naming a file that does not exist) |
| `.kpar` without `version` | Silent (other tools may reject) |

## Section score table

| Sub-area | Score | Note |
| --- | --- | --- |
| Multi-file text import / `.kpar` round trip | 3 | byte-identical; pilot-clean |
| SysML v2 JSON Tessera ↔ Tessera | 3 | digest-equal, three forms, demo too |
| Import from SysON (JSON or text) | 1 | refused for real models; false notes |
| Export to SysON (text) | 2 | works; SysON's reading differs (mostly SysON's) |
| Systems Modeling API with SysON | 1 | create and save fail (reported) |
| Constructs beyond the UI | 3 | carried in all Tessera routes |
| Workflow / lossless distinction | 2 | clear routes, untrustworthy notes for foreign files |
| Identity across cycles | 2 | path-dependent ids; references kept |
| Malformed archives and JSON | 1 | **critical** (archive warnings dropped); duplicate ids |
| Automated compatibility tests | 3 | SysON fixtures + live script; most cases known gaps |
| Private extensions | 2 | implicit view libraries; missing `version` |
| Engine (toolkit) serialization vs the pilot | 2 | five deviations, one semantic |

No sub-area earns 4: the only automatic checks by another tool that pass are the pilot's
acceptance of Tessera's text (input and re-imported), not a semantic match with SysON or
the pilot.

## Critical findings

1. **Archive import silently leaves out model files and integrity warnings.**
   `src/routes/projects/+page.svelte:236-247` ignores `archive.warnings` and
   `archive.skipped` from `readProjectArchive`. Repro: a zip with `A.sysml` (`package A;`)
   and `Größe.sysml` holding `package Gr\xf6\xdfe;` (Latin-1) → Import → the project opens
   with only `A.sysml`, no message. Same for a `.kpar` whose file fails its checksum or is
   listed but missing. Owned by the data-integrity agent (`08-data-integrity.md`, critical
   4; their e2e `test.fail` "importing an archive says which files were left out"); the
   lead asked them to fix it, so this branch does not touch the page.
2. **(Engine) JSON export misstates metadata values.** For `@Safety { level = 3; }` (and
   `metadata Safety about x { level = 2; }`) the toolkit builds a new `ReferenceUsage`
   with `declaredName: "level"` and no `Redefinition` of `Safety::level`; the pilot and
   SysON build `:>> level` with the Redefinition (SysML 2.0 textual notation:
   `MetadataBodyUsage = 'ref'? (':>>' | 'redefines')? OwnedRedefinition …`). Tessera's
   own JSON round trip is symmetric, so nothing shows inside Tessera, but a tool reading
   Tessera's JSON gets metadata whose attribute is unset plus a stray feature. Repro:
   `node tools/interop/tessera/run.mjs export src/lib/interchange/fixtures/acceptance
   out.json` → find `"declaredName": "level"` under a `MetadataUsage`: its
   `ownedRelationship` holds only a `FeatureValue`. Not fixed here (not a minimal app
   change; belongs in the toolkit, or a post-processing step in `exportModel` that turns
   such a feature into an unnamed feature with a `Redefinition` to the metadata
   definition's feature of that name). Reported to the language agent's area as well.

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Read the branch back after "Save to server" and report what the server did not keep | prevents silent loss with any server | high | S |
| SysON API: `?name=` on create, `@type: DataIdentity`, minimal payloads; honest error when a server answers HTML ("the server failed", not "wrong address") | SysON round trip by API (updates only: SysON drops new elements) | high | S |
| Import report: decide "not carried over" by place, skip implied elements, compare only compact-form properties | trustworthy report for full-form and other tools' JSON | high | S |
| Refuse JSON with duplicate `@id`s (`checkStructure` exists) | no wrong-element reports | medium | S |
| Lift SysON JSON: name unnamed `ConjugatedPortDefinition`s `~X`, handle unnamed succession targets (or upstream) | open SysON models | high | M |
| Metadata body features as redefinitions in JSON export (engine / post-process) | correct metadata in other tools | medium | M |
| Warn when the project resolves the bundled `ModelViews`/`Reporting` without holding them; include them on export | `.kpar`/Git usable elsewhere | medium | S |
| Write `version` in `.project.json` | KerML 10.3 conformance | low | S |
| Keep folder layout and ids through JSON (path per root namespace; id map) | identity across tools | medium | M |
| KerML lift for `.kerml` content in JSON import | KerML projects round-trip | low | M |
| CI job running `tools/interop/acceptance.sh` (pilot always, SysON weekly); OMG `.kpar` test without a sibling checkout | regression safety | medium | S |
| Report upstream to SysON: `verify` kind, attribute `isComposite`, printer losses (`= ;`, `variant`, metadata values, apostrophes in docs), dropped new elements on commit | ecosystem | medium | S |

## Files added

- `src/lib/interchange/fixtures/acceptance/` (4 `.sysml`): the acceptance model.
- `src/lib/interchange/semantics-testing.ts`: the semantic digest and comparison.
- `src/lib/interchange/acceptance.assessment.test.ts`: the acceptance test, SysON compatibility, malformed JSON, export completeness.
- `src/lib/interchange/fixtures/syson/`: SysON v2026.9.3's element JSON (gzipped) and text export of the acceptance model; its element JSON of `EngineeringBasics`.
- `src/lib/exchange/syson.assessment.test.ts`: the API client against SysON's observed behaviour.
- `tools/interop/acceptance.sh`, `tools/interop/pilot/PilotExport.java`; `tools/interop/tessera/exchange.ts` gains `kpar`, `unkpar`, `semantics`, `compare`.

## Overlap with other sections

- 08 data integrity: archive reading (paths, duplicates, CRC, non-UTF-8, checksums); the
  token sent to a `Link` host (their `api.assessment.test.ts`).
- 01 language: the pilot's 12 errors on the demo (`stakeholder` before `subject`;
  `satisfy … by drone.x` resolving to the subject parameter). For exchange: SysON resolves
  those six names the way the pilot does, so the demo's satisfy relationships mean
  something else in both other tools; the toolkit's metadata-body encoding (Critical 2).
- 02 round trip: editing preserves constructs the UI cannot draw.
