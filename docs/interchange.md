# Model interchange

How Tessera exchanges models with other SysML v2 tools, what comes across
and what doesn't, and why. The SysML text stays the source of truth: what
comes in is written as text, and what goes out is made from the text.
Background on the standards (KerML clause 10, `.kpar`, element identity, the
Systems Modeling API) is in `docs/reference/interchange.md`.

| Way | Out | In | Code |
| --- | --- | --- | --- |
| `.kpar` (KerML 10.3) | Download as .kpar | Import on Your projects | `src/lib/interchange/kpar.ts` |
| SysML v2 JSON (KerML 10.4) | Download as SysML v2 JSON… | Import on Your projects | `src/lib/engine/toolkit/interchange.ts` |
| Systems Modeling API (REST) | Save to server | Open from server | `src/lib/exchange/` |

All of it loads on first use: the dialogs, the client and the import code
are separate chunks; the worker gains four methods (`exportInterchange`,
`importInterchange`, and for saving when the server moved on, `mergeInputs`
and `weaveInterchange`).

## What the toolkit provides, and what the app adds

The sysml-toolkit (0.10.10) does the heavy lifting:

- `Session.toCompactJson()`: the user units as KerML 10.4 element JSON, one
  flat array, non-derived properties only, defaults elided;
  `toFullJson(false)` adds derived properties and implied relationships.
- `canonicalizeCompact(json)`: every absent non-derived property spelled at
  its default.
- `Session.fromInterchangeJsonWithPreparedLibrary(json, library, indent)`:
  lifts element JSON (compact or full) to SysML text units (`units()`),
  resolved against the standard library, with `warnings()` for what it
  couldn't place; `minimizeQualifications()` respells references as the
  shortest names that resolve; `formatSource` formats.
- `elementById`, `isLibraryElement`, `property`: element ids, including the
  standard library's.

The app adds (`interchange.ts`, `src/lib/exchange/`):

- **Export.** The analysed session's compact JSON, canonicalized, with the
  properties a subtype redefines under another name written out (KerML
  10.4.5: `memberElement`, `general`/`specific`, `subsettedFeature`/
  `subsettingFeature`, `conjugatedPortDefinition`; the canonical form leaves
  them null). References that never resolved (the toolkit writes them as
  `{"@ref": "Name"}`, which is not KerML 10.4) are left out and listed. The
  view libraries the session adds for a project that lacks them are left out
  unless the project uses them.
- **The standard library, with its standard ids.** The toolkit serializes
  only user units. The library's sources are opened as user units in a
  second session (other ids), and each element is matched to the prepared
  library's element in the same place: a top-level package by name, the rest
  by position in its owner's `ownedRelationship` / `ownedRelatedElement`. All
  91,439 elements under the 96 root namespaces match, with distinct ids and
  the same types. It costs about 1.5 s and 140 MB of WebAssembly memory, so
  it runs in a worker of its own (`startSpareEngine`) that is stopped
  afterwards.
- **Import.** Standard library elements in the file are left out (it is
  built in). The lifted text is named after what each unit declares
  (`DroneArchitecture.sysml`), double spaces in code are collapsed and the
  text is formatted. Two known printer slips are mended (below) and `expose
  $::A` is written `expose A`, each kept only when the re-checked model has
  no more errors and no more differences. The text is then checked and
  compared with the lifted model, element by element, to report what
  didn't come across.
- **Other tools' JSON, made liftable** (`prepareForLift`), only where the
  meaning is certain (each case seen in SysON 2026.9's API JSON): a
  `ConjugatedPortDefinition` without a declared name gets the name the
  specification derives (`~PowerPort`, as the toolkit writes it); an unnamed
  transition with no trigger, guard or effect from a state's `entry` action
  (SysON's reading of `entry; then off;`) becomes the succession that text
  is (SysML 2.0 `EntryTransitionMember`; the pilot reads it so), noted as
  repaired; an invocation typed by what it invokes (KerML 1.0's beta form)
  gets the final form's membership; a feature chain without `operator` gets
  `.`; and an expression referring to a feature the file doesn't name (a
  name its tool couldn't resolve) is left out whole and named in a note,
  rather than refusing the file. A file in which two elements share an `@id`
  is refused, naming both.
- **Matching across tools** (`elements.ts`). Ids depend on the tool (see
  Identity), so two versions are matched by place: each element's
  _ownership key_ (its owner's key and its name, or its kind and position
  among its owner's unnamed parts of that kind); renamed elements are then
  matched by position under an owner that matched (`matchIds`).
  `compareModels` reports what differs; `rebaseIds` gives a model another's
  ids; `changeSet` lists what to send; `merge.ts` merges three versions.

## `.kpar`

**Out.** The project's files byte for byte, `.project.json` and
`.meta.json` (an index of top-level names and a SHA-256 per file). When the
project uses the bundled `ModelViews` or `Reporting` library (the app
resolves them from its own copies when a project lacks them) without
holding it, the archive includes it, and what it uses in turn, so the
archive is complete for other tools; the download says so.

**In.** A `.kpar` or any ZIP of a project. What doesn't hold is said in the
notice the project opens with, and nothing is dropped silently: a path that
would leave the project (`../`, absolute, a drive letter) is left out and
named (Windows `\` separators become `/`); a path the archive holds twice
keeps the last copy and says so; an entry whose data fails the ZIP's own
CRC-32 is kept and named as damaged (said once when its `.meta.json`
checksum fails too); files that aren't UTF-8 text are named. An archive
that would unpack to more than 256 MB is refused before or while
inflating, whatever its headers claim.

## SysML v2 JSON

**Out.** A flat array of elements (KerML 10.4.6), each with `@id`, `@type`
and `elementId`. Options: _Only my model_ (the default) or _Include the
standard library_; _Add derived properties_ (off by default).

- Only my model: references to the standard library are `{"@id": …}` with
  its standard ids (KerML 9.1), which every SysML v2 tool knows. Every other
  reference resolves within the file.
- Include the standard library: every reference resolves within the file.
  About 91,000 more elements (written without indentation).
- Checked against the OMG's JSON schema for SysML 2.0
  (`https://www.omg.org/spec/SysML/20250201/SysML.json`, a gzipped copy in
  `src/lib/exchange/fixtures/`, validated by `schema-testing.ts`): the full
  form has every property the schema requires and is valid as it stands;
  the default form is valid in every property it has (the schema requires
  derived properties too, which KerML 10.3 allows a file to leave out with
  `includesDerived = false`).

**In.** A `.json` file on Your projects (or any file starting with `[` or
`{`): a flat array of elements, an API server's answer (data versions with
`payload`), or `{"elements": […]}`. The import dialog says in a sentence
whether everything came across, lists what didn't (a few lines per group,
all of it in **Download the full list**), names the files and opens the
project.

### What round-trips

The demo (22 files, 8,385 elements on 2026-10-23) → JSON → text: no
problems, every element, the same named elements by qualified name and kind,
and the same structure element by element (`interchange.test.ts`, `exchange.spec.ts`
opens its views). A hand-written file from "another tool" (random ids,
derived properties present, defaults omitted) imports with no notes, and
saving it back changes nothing.

### How the import decides what didn't come across

By meaning, not by id (`carriedOver`): each of the file's explicit elements
is matched to the lifted model's element in the same place (ownership keys
with the root namespaces and their memberships left out, so files, a
server's missing root namespaces and member order don't matter), and only
what has no counterpart is "not carried over". Implied elements are not
compared: those owned through an implied relationship (a calculation's
`result`, a connector's `thisThing`, in a full-form file) and, for files
whose tool writes them out without marking them, whatever the lifted
model's full form has, implied, in the same place. "Reads differently"
compares only properties that carry meaning: references by place, unset,
`false` and empty as one value, and not derived properties (those the
toolkit's compact form leaves empty and its full form fills in). Tessera's
own export in every form, opened again, has no notes; SysON's JSON of the
acceptance model has 3 (the expression SysON couldn't resolve, and two
transition parameters the toolkit doesn't model) plus "reads differently"
notes for SysON's own deviations (`isComposite` on attributes,
`isVariation` on enumerations, comment bodies kept with their ` * `).

### What doesn't, and why

- **Layout and comments.** JSON has no comments (`//`, `/* */`), blank lines
  or member order beyond ownership order; the text comes back as the toolkit
  prints it. `doc` comments come across.
- **Ids in the text.** Text has no ids. The toolkit derives a user model's
  ids from the file's name and the element's place, so an imported model has
  other ids than the file it came from (the API client matches them by place
  instead).
- **Values the text can't hold.** A value the textual notation can't express
  is changed by the lift, and the import says so (e.g. `isComposite: true`
  on a part at package level: `part car : Vehicle;` is not composite).
- **Elements the toolkit doesn't know** (an unknown `@type`, a dangling
  owner) are left out and listed.
- **Implied relationships** (`isImplied: true`, in full-form files) are not
  written out: the text implies them and they are worked out from it again.
- **Unresolved references** in the project are left out of the export and
  listed (fix the model's problems first to keep them).
- **Files with syntax errors** export what parses of them, and the dialog
  says which files.

## Systems Modeling API

The REST/HTTP binding (Systems Modeling API and Services 1.0, clause 8.1),
as the pilot implementation and SysON (`…/api/rest`) answer it. The client
uses `GET /projects`, `POST /projects`, `GET /projects/{p}/branches`,
`GET /projects/{p}/commits`, `GET /projects/{p}/commits/{c}/elements`
(following the `Link` header's `rel="next"`) and
`POST /projects/{p}/commits?branchId={b}` with
`{"@type": "Commit", "description", "change": [DataVersion…]}`, each data
version `{"@type": "DataVersion", "identity": {"@type": "DataIdentity",
"@id"}, "payload"}` (`payload: null` deletes; SysON ignores an identity
without its `@type`). A new project is `POST /projects?name=…` with the
JSON body too (SysON takes the query, the pilot the body). For a server
under `/api/rest` (SysON), a changed element's payload holds only its
`@id`, `@type` and the properties that change: SysON fails a commit
holding whole elements, the pilot replaces an element with its payload.
Given a site's address without the API path, it also tries `/api/rest`. A
"next page" link to another site is not followed (the token stays with its
server; the list stops with a message). A web page where JSON was expected
is said for what it is: to a read, the address is probably not the API's;
to a change, the server didn't take the request.

- **Open from server** reads the elements of a commit (the branch's head,
  or one chosen from the commit list) and imports them as above, into a new
  project linked to the server project and branch.
- **Save to server** exports the project (default form), reads the elements
  at the branch's head, gives ours the server's ids where they sit in the
  same place, and sends one commit with what differs: new elements, changed
  ones (properties we spell that differ; one the server leaves out counts as
  its default), and removed ones. What the server has and the project
  doesn't is removed in that commit; earlier commits keep it. The parent is
  the branch head (the server's choice when `branchId` is given); no
  `previousCommit` is sent. **Then the branch is read back** and set against
  what was sent, by place: a new element missing, a change not there, or a
  removed element still there is named ("didn't keep all of this save …")
  instead of "Saved", and the project's link moves to what the server holds
  now. A server that answers a commit with an empty body (SysON, for a
  commit it failed) is judged by the read-back too. Matching ignores root
  namespaces, which SysON's API doesn't serve: for such a server ours are
  not sent, and what they held keeps the server's owners. To a server under
  `/api/rest`, a save that both adds and removes sends the additions first
  and the removals only once the additions are seen kept, so an element
  moved elsewhere can't be lost from both places. "Save … as a new project there" makes the
  project first. When the branch's head is not the commit the project was
  opened from or last saved to, saving merges first (below).
- **Connections** are kept in this browser's local storage
  (`sysml-web:api-servers`, the link per project in `sysml-web:api-links`),
  like the GitHub accounts. A token is sent only to its own server, as
  `Authorization: Bearer …`, never shown again, and removed with
  **Settings › Delete all local data**.

### Saving when someone else saved meanwhile (merging)

The link of a project to its server (`sysml-web:api-links`) records the
commit it was opened from or last saved to: the **base**. When the branch's
head has moved on from it, Save to server makes a three-way merge of
**base**, **mine** (this project, exported) and **theirs** (the head), in
`merge.ts` (pure) and `src/lib/engine/toolkit/weave.ts` (in the worker):

1. **Same form.** The base and the head are read; the worker puts them in
   the form the export writes (`canonicalModel`: only compact-form
   properties, each spelled, redefined ones written out, no implied
   relationships), so the three compare property by property. A project
   with syntax errors is refused: the merge needs every element in place.
2. **Matching**, as for a save: base and theirs by the server's ids (then
   by place, for a tool that renumbers), mine to base by place
   (`matchIds`), and what both added by the same ownership key. The merge
   works in mine's ids wherever mine has the element.
3. **Merging** element by element, property by property: what only one
   side changed is taken, the same change on both sides once, and the lists
   of what an element owns merge both sides' insertions and removals (the
   side that reordered leads). What is left is a **conflict**: a property
   both changed differently (or an element both added differently), or a
   part of the model one side removed while the other changed something in
   it, added to it, or made something refer to it. Conflicts are gathered
   per element as people know it (the nearest named member: a typing's
   conflict is its part's) and described in words (`name: “myCar”`,
   `type: Garage::Engine`, `removed it`).
4. **Review** (`MergeReview.svelte`): what comes in, what goes out, and each
   conflict with **Keep mine** / **Keep theirs** (and both for all). Save is
   off until every conflict is decided. Nothing is read from or written to
   the text, and nothing sent, before Save.
5. **Their changes into the text** (`weaveInterchange`), as one undoable
   step through the workspace's edit path, then **ours to the server**: the
   project is exported again and saved against the head as an ordinary save
   (so the server ends up holding exactly what the text says), one commit
   whose parent is their head. Just before writing, the branch's head is
   read again; if someone saved meanwhile, nothing is written and the
   dialog says to save again. The link then records the new commit (or the
   head, when there is nothing of ours to send). The result says what came
   in, which files changed, and what was sent.

#### How their changes are written into the text

Text is the source of truth, and a server holds no text, so their changes
are written into the files as narrowly as the toolkit allows (the decision
this feature turns on). Lifting the whole merged model to text, as an
import does, would lose every `//` note, blank line and layout choice in
the project; regenerating each file their changes touch would lose them in
those files. Instead the merged model is lifted to text once (formatted as
the editor formats, short names), and each of their changes is placed by
the toolkit's member extents:

- **An element they added** is written where it belongs: after the member
  it follows in the merged model (or before the one it precedes), indented
  like its neighbour, spaced by blank lines when the neighbours are.
- **An element they removed** is taken out with its lines.
- **A rename** goes through the editor's rename, so references follow.
- **Any other change** writes the smallest member declaration holding it
  again (a part, a definition, an attribute) from the lifted text.
- A file they added is written whole, named after what it declares; a file
  they emptied (its root namespace gone) is removed.

Then the result is checked: the changed files are read again and compared,
element by element, with the lifted text. A file where they differ is
written whole from the lifted text instead; whatever still differs is
listed, and the save waits for **Save anyway** (it would replace the
server's version of those elements with the text's).

What doesn't merge, and is said rather than dropped:

- **Text-only detail inside what is written again.** `//` notes, blank
  lines and layout inside a declaration they changed don't come through
  (the review names those declarations, with how many notes each had, before
  saving; the result again). Elsewhere the text is untouched.
- **Spelling.** A declaration written again spells references as the
  toolkit prints them: shortest names that resolve, and units by their
  names (`700 [gram]` where the file had `[g]`).
- **Element-level granularity.** Two changes to the same property conflict
  even if they are textually far apart (a documentation comment edited on
  both sides is one conflict, not merged line by line). An element matched
  by place can be mistaken for another when one side both removed an
  element and added one of the same kind in its place (as with saving).
- **References into what was removed.** Choosing to remove something the
  other side started using leaves that reference unresolved: the conflict
  says so, and the checks then show it.

### What the server must allow (CORS)

The page calls the server from the browser; there is no proxy. The server
must answer the preflight `OPTIONS` request and send:

```
Access-Control-Allow-Origin: https://jackhale98.github.io   (or *)
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Expose-Headers: Link
```

`Expose-Headers: Link` lets the client follow pages of a long list; without
it only the first page is read. The site is served over HTTPS, so the server
must be too, except on `localhost`. A request that gets no answer says so
plainly: unreachable, or not allowing this origin.

### With SysON (checked live, SysON v2026.9.3, 2026-10-26)

Run with `tools/interop/syson-roundtrip.sh` (SysON in Docker) and
`node tools/interop/fairtide/run.mjs create|push|pull`:

| Step | Before (2026-10-23) | Now |
| --- | --- | --- |
| Save … as a new project there | fails ("other than JSON … is this the address?") | made (`?name=`) |
| Open from server (acceptance model, 807 elements) | refused (conjugated ports, `entry; then`, unresolved names) | opens; meaning identical but for `total <= limit` in `MassBudget`, which SysON couldn't resolve (named in a note) |
| Save a change to an element SysON has (minimal payload) | fails | kept (rename, `visibility`, `isComposite`; checked by read-back) |
| Save new elements | fails | answered 201, dropped by SysON; the read-back names them, nothing removed |
| Change a reference (`ownedRelationship`, `memberElement`, `owningRelationship`) | — | answered 201, ignored by SysON; named by the read-back |
| Change a feature's `direction` | — | empty 200, nothing kept; named by the read-back |

Of the 174 changes a save of a renamed acceptance model sends, sent one kind
at a time: every scalar property (`declaredName`, `isComposite`,
`isConstant`, `visibility`, `isAbstract`, `operator`, a comment's `body`)
was kept; every change to a reference was answered 201 and ignored; a
`direction` change made SysON answer with nothing.

Saving the unchanged acceptance model to SysON still reports what SysON
can't hold: its own readings that differ from ours (an `entry; then` held
as a transition, an invocation typed by its calculation, transition
parameters) would need new elements, which SysON drops, so those are named
and nothing is removed.

### Reported upstream (SysON)

For Eclipse SysON (found with v2026.9.3; the fixtures in
`src/lib/interchange/fixtures/syson/` reproduce each):

1. **The API drops new elements.** `POST /api/rest/projects/{p}/commits`
   with a `DataVersion` whose payload is a new element (owner given or not,
   whole or minimal) answers `201 Created` and the element is not there
   afterwards. Expected: created, or an error.
2. **Commits fail or are ignored silently.** The same endpoint with
   payloads carrying every property, or changing a feature's `direction`,
   answers `200` with an empty body and changes nothing; a change to any
   reference-valued property (`ownedRelationship`, also only reordered,
   `memberElement`, `owningRelationship`) answers `201` and is ignored.
   Expected: applied, or a 4xx naming the property.
3. **An untyped identity or a project name in the body answer with the web
   app.** `identity` without `"@type": "DataIdentity"`, and `POST /projects`
   with only a JSON body, answer `200 text/html` (the SPA's index page).
   Expected: 400 with a reason (or accepting both forms, as the pilot does).
4. **`entry; then off;` is read as a `TransitionUsage`**, not the
   `SuccessionAsUsage` SysML 2.0 makes of an `EntryTransitionMember` with
   `then` (the pilot reads a succession).
5. **`verify carMass;` in a verification case's objective is held with
   `kind: assumption`**, not as a requirement verification (pilot: requirement).
6. **Names in a `constraint def`'s result expression stay unresolved**
   (`total <= limit` with `in attribute total; in attribute limit;`): the
   API then serves `FeatureReferenceExpression`s whose `Membership` names
   nothing, and the text export prints `>= ;`.
7. **The text export ("Download") loses model content while printing valid
   SysML**: a whole `calc def`, a `verification def` and its usage, a
   `dependency`, an `alias`, metadata body values (`@Safety { level = 3; }`
   printed `#Safety`), the constraint expression, `ordered nonunique`, and
   `satisfy … by Vehicle::Configurations::myCar` printed `by myCar`; and
   prints `attribute totalMass :> mass = ;`, `variant part` as `part`, and a
   bare `import` for `public import` (syntax errors elsewhere). The model in
   its API is right, so it is the printer.
8. **Attribute and enumeration usages are served with `isComposite: true`**
   and enumeration definitions with `isVariation: false` (the specification
   and the pilot: false and true).

## Identity

The toolkit's ids for a user model are UUIDv5s derived from the unit's name
and the element's place (qualified name, or owner and position): stable from
one export to the next while names, files and order stay put, and the same
ids the semantic diff compares by. They are not KerML 9.1's
`uuid5(NAMESPACE_URL, base + name)` for a top-level element, and there is no
way to give the toolkit a base URI per unit (upstream request). The standard
library's ids are the normative ones (`Parts::Part` is
`0774a545-39e3-5bc1-9607-63beabc6bf65` in every tool).

Not kept yet: ids through export → import → export, and through a file
move (both change every id of the file, because the path is part of the
derivation). The design, not built: keep a map from ownership key (with
transparent roots, as the import report uses) to id beside the project —
written into `.kpar` metadata (`.meta.json` allows extra fields) and filled
from an imported JSON file — and pass it through `rebaseIds` on every
export, so an element keeps its id wherever it sits in the same place. A
JSON import would also record each root namespace's original file path (in
the same map) to restore the folder layout.
