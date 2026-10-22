# Model interchange

How Fairtide exchanges models with other SysML v2 tools, what comes across
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
are separate chunks; the worker gains two methods (`exportInterchange`,
`importInterchange`).

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
- **Matching across tools** (`elements.ts`). Ids depend on the tool (see
  Identity), so two versions are matched by place: each element's
  _ownership key_ (its owner's key and its name, or its kind and position
  among its owner's unnamed parts of that kind); renamed elements are then
  matched by position under an owner that matched. `compareModels` reports
  what differs; `rebaseIds` gives a model another's ids; `changeSet` lists
  what to send.

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

The demo (21 files, 6,291 elements) → JSON → text: no problems, all 6,291
elements, the same named elements by qualified name and kind, and the same
structure element by element (`interchange.test.ts`, `exchange.spec.ts`
opens its views). A hand-written file from "another tool" (random ids,
derived properties present, defaults omitted) imports with no notes, and
saving it back changes nothing.

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
  written out: the text implies them and the engine works them out again.
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
version `{"@type": "DataVersion", "identity": {"@id"}, "payload"}` (`payload:
null` deletes). Given a site's address without the API path, it also tries
`/api/rest`.

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
  `previousCommit` is sent. "Save … as a new project there" makes the
  project first. Merging with changes made on the server since the last
  open is not attempted: the commit makes the branch hold this project.
- **Connections** are kept in this browser's local storage
  (`sysml-web:api-servers`, the link per project in `sysml-web:api-links`),
  like the GitHub accounts. A token is sent only to its own server, as
  `Authorization: Bearer …`, never shown again, and removed with
  **Settings › Delete all local data**.

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

## Identity

The toolkit's ids for a user model are UUIDv5s derived from the unit's name
and the element's place (qualified name, or owner and position): stable from
one export to the next while names, files and order stay put, and the same
ids the semantic diff compares by. They are not KerML 9.1's
`uuid5(NAMESPACE_URL, base + name)` for a top-level element, and there is no
way to give the toolkit a base URI per unit (upstream request). The standard
library's ids are the normative ones (`Parts::Part` is
`0774a545-39e3-5bc1-9607-63beabc6bf65` in every tool).
