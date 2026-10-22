# Model interchange reference: KerML Clause 10, `.kpar`, JSON, element identity, Systems Modeling API, XMI

Status: research reference, written for our earlier engine's `sysml-interchange` work (`sysml-cli`,
replaced by the Open-MBEE sysml-toolkit under decision #16; the app now reads and writes `.kpar` in
TypeScript, `src/lib/interchange/kpar.ts`, and exchanges element JSON and talks to API servers as
`docs/interchange.md` describes). Sources are the formal OMG
specs (KerML 1.0 formal/2025-09-01, SysML 2.0, Systems Modeling API and Services 1.0
formal/2025-09-04) plus direct inspection of the release artifacts in
`sysml-v2-release/` (`sysml.library.kpar/`, `sysml.library.xmi/`, `sysml.library.xmi.implied/`).
Anything marked **[verified]** was checked against those artifacts (scripts described in
section 8). Anything marked **[unverified]** or **[spec gap]** could not be confirmed from the
extracted spec text or the artifacts, and needs a check against the machine-readable files
(`KerML.json`, `ModelInterchange.json`, the API OpenAPI file) which are NOT in the release repo.

Citations: `K` = KerML 1.0, `S` = SysML 2.0 Part 1, `A` = Systems Modeling API 1.0.
Section numbers are those of the formal documents.

## 1. KerML Clause 10 Model Interchange (also normative for SysML)
SysML includes K Clause 10 by reference: "Clause 10 of [KerML] on Model Interchange is included by
reference as a normative part of this specification in order to define allowable methods for
interchanging SysML models." (S 6.2).

### 1.1 Unit of interchange (K 10.1)
> "A project is a set of root namespaces (see 7.2.5.3 and 8.2.3.4.1), including all elements in the
> ownership trees of those namespaces, and a set of references to used projects, such that every
> cross reference from an element in the project is to another element in that project or to an
> element in one of the used projects."

- A root namespace is a Namespace with no owner (K 7.2.5.3). Its declaration is implicit in the
  textual notation: "the body of a root namespace is given simply by the list of representations
  of its top-level elements". It has no name in text, so the name of a top-level element is not
  qualified by the root's name; the project's global scope is the flat set of all top-level
  elements of all root namespaces (K 8.2.3.5).
- One model interchange file = one root namespace and its whole ownership tree (K 10.2).
- A project interchange file (`.kpar`) = ZIP of model interchange files + `.project.json` +
  `.meta.json` (K 10.3).

### 1.2 Model interchange formats (K 10.2)
> "A model interchange file shall have one of the following formats:"

| # | Format | Extension (normative) | Notes |
|---|--------|-----------------------|-------|
| 1 | Textual notation | `.kerml` (KerML); `.sysml` (SysML, S clause 2 item 4) | Not every conformant model is expressible; tool "may either not export such model at all using the textual notation, or export the model as closely as possible, informing the user of any changes". |
| 2 | JSON (K 10.4 mapping) | `.json` | Always available for any KerML-based language ("It shall always be possible to use JSON format as a model interchange file format"). |
| 3 | XMI (XMI 2.5.1, MOF-conformant abstract syntax) | `.xmi` | Only if the language abstract syntax is MOF-based. |

Conformance sentence: "Every conformant KerML modeling tool shall provide the ability to import
and/or export (as appropriate) models in at least one of the first two formats." (K 10.2). So
textual OR JSON suffices; XMI is optional.

Non-normative extensions seen in the release (Eclipse pilot implementation, NOT standard):
`.kermlx` / `.sysmlx` = Eclipse-flavoured XMI. README of the release: "These are Eclipse XMI files
(`.kermlx` and `.sysmlx` extensions), which is not a fully normative OMG XMI representation. The XMI
is exported _without_ derived property values or implied relationships." See section 6.

KerML-based languages (K 10.2 second list): textual notation if the language has one, "The language
shall define a distinguishing file extension"; JSON "as applied to the abstract syntax of the
language"; XMI if MOF-defined.

### 1.3 What must be serialized: derived and implied content
The *project* metadata (`.meta.json`) declares the policy; the formats themselves are silent.

`includesDerived` (K 10.3 Table 13, Note 4):
- `true`: "the serializations in all XMI and JSON format model interchange files in the project
  interchange file shall include values for all derived properties."
- `false`: "XMI and JSON formatted model interchanges files shall not include values for any derived
  properties."
- absent: "whether derived property values are included may vary one model interchange file to another,
  and it is also allowable for some values to be included for some derived properties and not others."
  Consumers must therefore be prepared to recompute every derived property.

`includesImplied` (Note 5):
- `true`: "shall include all implied relationships, and the `isImpliedIncluded` property shall have the
  value `true` for all elements".
- `false`: "shall not include any implied relationships, and the `isImpliedIncluded` property shall have
  the value `false` for all elements."
- absent: varies per file and per element "as recorded by the value of the `includesImplied` property
  for each element" (sic; the per-element property is `isImpliedIncluded`).

Both flags apply to XMI and JSON only. Textual notation never carries derived or implied content.

Implied relationships (K 8.4.2, K 8.3.2.1.2/8.3.2.1.3):
- `Relationship.isImplied : Boolean = false` - "Whether this Relationship was generated by tooling to
  meet semantic rules, rather than being directly created by a modeler."
- `Element.isImpliedIncluded : Boolean = false` - "Whether all necessary implied Relationships have been
  included in the ownedRelationships of this Element. This property may be true, even if there are not
  actually any ownedRelationships with isImplied = true ... However, if it is false, then
  ownedRelationships may not contain any implied Relationships. That is, either all required implied
  Relationships must be included, or none of them."
- Constraint `validateElementIsImpliedIncluded`: `ownedRelationship->exists(isImplied) implies
  isImpliedIncluded`.
- K 8.4.2: a model "obtained through model interchange ... will not necessarily meet the semantic constraints ... In this case, a tool may insert certain implied Relationships";
  redundant implied Specializations should be skipped (an owned/implied one with the same or a more specific `general` exists), but "the above rules do not apply to Redefinitions".
  Implied relationships are *appended after* the explicit `ownedRelationship`s **[verified]** (11,217 owners in the first 40 library files, 0 counter-examples), so index-based `path()`
  values of explicit elements are the same with or without them (section 4).

Practical meaning: the stdlib `sysml.library.xmi` directory is `includesImplied=false` and
`includesDerived=false`; `sysml.library.xmi.implied` is the same model plus implied relationships
(still `includesDerived=false`). Element ids of the former are a strict subset of the latter
**[verified]** (109,673 vs 404,780 ids, 0 ids only in the former).

### 1.4 How references are encoded (K 10.4.4, XMI)
JSON: any property typed by a metaclass is "a JSON Schema object with a single field `@id`", value =
the target's `elementId`:

```json
{ "@id": "15fe7607-ceb8-38bb-bd04-dde8ca657cec" }
```

XMI (pilot dialect): same-file references are XML attributes holding the target `xmi:id`
(`type="0774a545-..."`); cross-file
references are child elements with `href="relative/path.sysmlx#<uuid>"`. See section 6.

Textual notation: by (qualified) name; ids are not present.

### 1.5 Project interchange requirements (K 10.3) - normative sentences
- "The archive shall contain a model interchange file for each of the root namespaces in the project,
  each formatted in one of the formats listed in 10.2."
- "the archive shall contain, at its top level, exactly one file named `.project.json` and exactly one
  file named `.meta.json`." Extension: ".kpar (KerML Project Archive)".
- "Other than the use of the file extensions given in 10.2, there are no requirements on the naming of the
  model interchange files ... compatible across different file systems ... easy reference using
  International Resource Identifiers (IRIs). The model interchange files may be organized into
  subdirectories, but this has no impact on the global scope for the project ... However, each model
  interchange file shall be identifiable by a unique path in the archive directory structure."
- "Every element referenced in a model interchange file in a project interchange file shall either also
  be contained in a model interchange file in that project interchange file, or in one of the projects
  referenced in the usage list". (Closure rule: no dangling cross-references.)
- A KerML-based-language archive "shall include model interchange files specific to that language", may use
  `.kpar` or a language-specific extension; if `.kpar`, "the metadata for the file shall identify the KerML-based
  language metamodel". "Each project interchange file shall only contain models in a single language, but it shall
  be able to have used projects both in the same language and in KerML".
- SysML specialisation (S clause 2, "Model Interchange Conformance"): "The project interchange file shall use the
  standard .kpar ... extension. All model interchange files ... shall be SysML models. Textual notation files
  shall use the extension .sysml. The metadata ... shall identify the metamodel using the normative SysML
  metamodel URI ... https://www.omg.org/spec/SysML/yymmnn".

### 1.6 Conformance (K clause 2, S clause 2)
- "Every conformant KerML modeling tool shall demonstrate at least Abstract Syntax Conformance and Model Interchange Conformance" (same for SysML). KerML Model Interchange Conformance =
  "can import and/or export syntactically conformant KerML models ... as specified in Clause 10"; SysML adds the pins in 1.5 (`.kpar`, `.sysml`, SysML metamodel URI).
- "If there are any conflicts between this document and the machine-readable files, the machine-readable files take precedence." (K 2, S 2, A 2): the JSON Schemas `KerML.json` and
  `ModelInterchange.json` (not available here) are authoritative over the prose of 10.3/10.4.

## 2. Project interchange: `.kpar`

### 2.1 Archive layout **[verified]** against all 10 release `.kpar` files
```
SysML_Systems_Library-2.0.0.kpar          (ZIP, entries STORED i.e. uncompressed, no directory entries)
  .project.json                           460 bytes
  .meta.json                              3192 bytes
  Actions.sysml  Allocations.sysml ... Views.sysml    one file per root namespace, flat, 21 files
```

- Model files are flat at archive root in every release kpar (subdirectories permitted by spec but unused).
- One root namespace per file; in the release each file contains exactly one `library package` whose name equals the
  file stem. File names: `<TopLevelName>.sysml` (SysML libs) or `<TopLevelName>.kerml` (Kernel libs).
- File timestamps are 1980-01-01 (reproducible build). Archive file name `Name_With_Underscores-<version>.kpar`
  is a convention only; identity of a project is its IRI (section 2.4).
- Contents: Kernel Data Type 3 `.kerml`, Function 17, Semantic 16; SysML Systems 21 `.sysml`, Analysis 4, Cause and Effect 2, Geometry 2, Metadata 4, Quantities and Units 23, Requirement
  Derivation 2. Total 94 = 36 `.kerml` + 58 `.sysml`, matching the 36 `.kermlx` + 58 `.sysmlx` files in `sysml.library.xmi`.

### 2.2 `.project.json` (K 10.3 Fig. 42, Table 12)
Serialization of `InterchangeProject` "as a single JSON object according to the Project schema definition in the
ModelInterchange.json artifact".

| Property | Type | Required | Meaning |
|----------|------|----------|---------|
| `name` | string | **yes** | Project name. |
| `description` | string | no | Free text. |
| `version` | string | **yes** | Version of the project being interchanged. SemVer recommended, not required. |
| `license` | string | no | License of the content (SPDX id by convention; unconstrained). |
| `maintainer` | string[] | no | Maintainer names. |
| `website` | IRI | no | Info page. |
| `topic` | string[] | no | Topics/keywords. |
| `usage` | object[] | no | One entry per used project. |
| `usage[].resource` | IRI | **yes** (within a usage) | Identifies the used project; "If the IRI is dereferenceable, it should resolve to a project interchange file". |
| `usage[].versionConstraint` | string | no | "only versions of the project identified by the resource property that meet this constraint may be used" compared against the used project's `version`. SemVer ranges recommended. |

Real example (SysML Systems Library):

```json
{"name":"SysML Systems Library","description":"Standard semantic library for the Systems Modeling Language (SysML)",
 "version":"2.0.0",
 "usage":[{"resource":"https://www.omg.org/spec/KerML/20250201/Semantic-Library.kpar","versionConstraint":"1.0.0"},
          {"resource":"https://www.omg.org/spec/KerML/20250201/Data-Type-Library.kpar","versionConstraint":"1.0.0"},
          {"resource":"https://www.omg.org/spec/KerML/20250201/Function-Library.kpar","versionConstraint":"1.0.0"}]}
```

Observed in the 10 release files: only `name`, `description`, `version`, `usage` are used (no license/maintainer/website/topic).
Compact JSON, key order `name, description, version, usage`. Spec UML names the association roles `usage`/`usingProject`/`usedProject`
(`ProjectBase`, `ProjectUsageBase`); the JSON has only the flattened `usage` array.

### 2.3 `.meta.json` (K 10.3 Table 13)
| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `index` | object | **yes** | Map `name -> path of model interchange file` for the "global scope of the project": keys are "all the non-null shortNames and names of all the top-level elements of the root namespaces". Values are archive-relative paths with `/` separators (Note 2). Duplicate names across root namespaces are "allowable (though not recommended)". |
| `created` | string | **yes** | ISO 8601 creation time of the interchange file. Release: `"2025-03-13T00:00:00Z"`. |
| `metamodel` | IRI | no | Language metamodel. OMG: version-specific URI `https://www.omg.org/spec/KerML/yyyymmxx` (SysML: `.../SysML/yymmnn`). Default if absent: KerML (for `.kpar`). Release value: `https://www.omg.org/spec/KerML/20250201` for Kernel libs, `https://www.omg.org/spec/SysML/20250201` for SysML libs. |
| `includesDerived` | boolean | no | See 1.3. Absent in all release kpars. |
| `includesImplied` | boolean | no | See 1.3. Absent in all release kpars. |
| `checksum` | object | no | `path -> {value, algorithm}`; "some or all" model files. |
| `checksum[path].value` | string | yes (within) | Hex digest of the file bytes. |
| `checksum[path].algorithm` | string | yes (within) | One of: SHA1, SHA224, SHA256, SHA-384, SHA3-256, SHA3-384, SHA3-512, BLAKE2b-256/384/512, BLAKE3, MD2, MD4, MD5, MD6, ADLER32 (Note 6; note the spec's own inconsistent hyphenation, "SHA256" vs "SHA-384"). |

Real file (excerpt; Systems Library):

```json
{"index":{"Actions":"Actions.sysml","Allocations":"Allocations.sysml", ... ,"Views":"Views.sysml"},
 "created":"2025-03-13T00:00:00Z",
 "metamodel":"https://www.omg.org/spec/SysML/20250201",
 "checksum":{"Allocations.sysml":{"value":"0ad900a4c25d88eb96da3d57e365f6c38cd87019bcaac5ab91eee9523b5f0ed1","algorithm":"SHA256"}, ...}}
```

Verified facts:
- All 10 release kpars use `SHA256`, one checksum per model file, checksum = hex SHA-256 of the raw archive entry bytes; recomputed for
  the Systems Library: 21/21 match **[verified]**. `.project.json`/`.meta.json` themselves are not checksummed.
- **Surprise:** the spec prose says checksum maps paths "to a list of one or more objects", but the real files map each path to a
  *single object* `{value, algorithm}`. Accept both on import; emit the single-object form (matches the reference tool).
- `index` includes short names as extra keys: Quantities and Units has 24 index keys for 23 files because `USCU` (short name) and
  `USCustomaryUnits` both map to `USCustomaryUnits.sysml` **[verified]**. Index keys cover *top-level element names*, not file names.
- `index` key order is alphabetical in the release; `checksum` key order is not. Neither is significant.

### 2.4 Usage / dependency resolution
- The `resource` IRI is the project's *identity*, not a download recipe. Release IRIs are the OMG normative IRIs, e.g.
  `https://www.omg.org/spec/KerML/20250201/Semantic-Library.kpar`, whereas the local files are named
  `Kernel_Semantic_Library-1.0.0.kpar`. A resolver therefore needs an IRI -> local project map (bundled libraries, workspace
  settings, or HTTP dereference).
- Distinct (resource, versionConstraint) pairs across the 10 release kpars **[verified]**:
  `KerML/20250201/{Semantic,Data-Type,Function}-Library.kpar` @ `1.0.0`;
  `SysML/20250201/Systems-Library.kpar` @ `2.0.0`; `SysML/20250201/Quantities-and-Units-Library.kpar` @ `2.0.0`.
- **Upstream inconsistency:** `SysML_Analysis_Library` references `https://www.omg.org/spec/KerML/20250201/Quantities-and-Units-Library.kpar`
  (KerML path) while `SysML_Geometry_Library` uses `.../SysML/20250201/Quantities-and-Units-Library.kpar`. Treat the two as aliases of the same
  library. Do not hard-fail on unknown prefix.
- Version semantics: `versionConstraint` is matched against the used project's `.project.json` `version`; the spec only recommends
  SemVer/npm-style ranges ("Tools that support such version formatting should report any version constraint violations when importing
  an interchange project, for any used projects with dereferencable resource IRIs"). Release constraints are bare versions (`1.0.0`) which
  under npm semantics mean exact.
- Closure rule (1.5): every cross-reference must resolve inside the archive or inside a used project; the `usage` list is the *complete*
  dependency declaration. Libraries are not implicitly available - a user project using `ScalarValues` or `Parts` should list them.
- Dependency graph in the release: Kernel Semantic <-> Data Type <-> Function are mutually listed (Semantic uses Data-Type + Function;
  Data-Type uses Semantic; Function uses Semantic + Data-Type), i.e. **cyclic** at project level, so a resolver must not require a DAG.
- Metamodel URIs are date-stamped (`20250201`); the same URI is the XML namespace in the pilot XMI (section 6).

### 2.5 Minimal valid user archive
`MyModel-1.0.0.kpar` = `.project.json` `{"name":"MyModel","version":"1.0.0","usage":[{"resource":"https://www.omg.org/spec/SysML/20250201/Systems-Library.kpar","versionConstraint":"2.0.0"}, ...kernel libs...]}`
+ `.meta.json` `{"index":{"Vehicles":"Vehicles.sysml"},"created":"2026-10-21T00:00:00Z","metamodel":"https://www.omg.org/spec/SysML/20250201","checksum":{"Vehicles.sysml":{"value":"<sha256 hex>","algorithm":"SHA256"}}}`
+ `Vehicles.sysml`. Obligations: one of each dot-file at top level; a file per root namespace; `index` and `created` required; `metamodel` required for SysML (S clause 2) though K allows
omission; checksums optional but cheap.

## 3. JSON serialization of elements

### 3.1 What KerML specifies (K 10.4) - the entire normative text is ~1 page
- 10.4.1: "Each root namespace shall correspond with a model interchange file with the file extension `.json` and contain serializations of
  all model elements in the ownership tree root in that namespace ... for KerML, conform to the JSON schema definitions in the
  `KerML.json` artifact provided with this specification. Other KerML-based languages may extend this schema or define their own."
- 10.4.6: "A root namespace maps to a JSON Schema **array** with values equal to the serialization ... of all model elements in the
  ownership tree rooted in that namespace." So the file is a **flat JSON array** of element objects (including the root Namespace
  itself, presumably); ownership is expressed only through reference properties, not nesting. Order is unspecified; pre-order DFS from the
  root is the natural, diff-friendly choice. **[spec gap: whether the root Namespace object is included]** - "all model elements in the
  ownership tree rooted in that namespace" reads as yes.
- 10.4.2 primitives: Boolean -> `boolean`, Integer -> `integer`, Real -> `number`, String -> `string`.
- 10.4.3 enums: "a JSON Schema string with a value that is the name of the enumeration literal, with the same capitalization as defined
  for the literal in the abstract syntax. For example, `VisibilityKind::public` maps to the string `"public"`." (So `"in"`, `"out"`, `"inout"`
  for `FeatureDirectionKind`; operator strings etc. are plain strings.)
- 10.4.4 references: "`{ "@id": "<elementId>" }`" (section 1.4).
- 10.4.5 element: "A model element maps to a JSON Schema object with fields `@id`, `@type`, and a set of its attributes. The field `@id` has a string
  value equal to the value of `Element::elementId`. The field `@type` has a string value equal to the name of the specific MOF type of the
  element, e.g. `"Structure"`." Remaining fields: "all owned and inherited properties. In addition, while redefined properties are not inherited under
  MOF/UML rules, they shall be included in the set of properties serialized for the element if they have a different name than the redefining
  property." Field name = attribute (property) name. Multiplicity: "[1..1] requires a non-null value; [0..1] allows a value or null; upper bound > 1 maps to
  a JSON array".

Consequences (read carefully):
1. `@type` is the *unprefixed* metaclass name (`"PartDefinition"`, `"FeatureMembership"`), not `sysml:PartDefinition`.
2. Both `@id` and the `elementId` property carry the id ("all owned and inherited properties" includes `elementId`). The API example in A B.1 still
   shows legacy `identifier`; do not rely on that name (section 5.4).
3. The redefinition rule means *both* names appear where both are non-derived: e.g. `FeatureTyping` has `specific` + `typedFeature` and `general` + `type`.
4. Derived properties (`name`, `qualifiedName`, `shortName`, `owner`, `ownedElement`, `owningMembership`, `owningNamespace`, `source`, `target`, `relatedElement`,
   `isLibraryElement`, ...) are included only if `includesDerived = true` in `.meta.json`. Under `false` they "shall not" appear. (Under the API the
   same rule is the Derived Property Conformance level, section 5.7.)
5. Null/empty: for [0..1] attributes the schema "allows a value or null"; the spec does not say null may be *omitted*. The pilot REST output
   emits nulls and empty arrays for every defined property (A B.1: `"description": null`, `"previousCommit": null`, `"scope": []`).
   **Safe emitter policy:** emit all non-derived properties incl. defaults/nulls/`[]` when targeting strict consumers; accept omission on import.
   **[unverified]** whether `KerML.json` marks only the [1..1] properties as `required`.
6. Reference direction: JSON has no containment, so *both* ends of ownership appear: parent `ownedRelationship: [{@id}...]`, relationship
   `owningRelatedElement: {@id}` / `ownedRelatedElement: [{@id}...]`, and child `owningRelationship: {@id}`. Ordered properties preserve order
   (`ownedRelationship`, `ownedRelatedElement`, `aliasIds`, ...), and the order is semantically significant (it drives `path()` indices, 4.2).

### 3.2 JSON-LD / schema URLs
- KerML defines **no** `@context` and no JSON-LD; `@id`/`@type` are JSON-LD-*looking* keys but the K 10.4 mapping is plain JSON validated
  by JSON Schema. The OSLC PSM of the API (A 8.2) is the Linked-Data/RDF route (`application/ld+json` recommended among RDF media types
  there, resource shapes in `OSLC_Systems_Modeling_Resource_Shapes_and_Vocabulary.zip`), not the REST JSON.
- JSON Schemas: `KerML.json` (element schema; K 10.4.1) and `ModelInterchange.json` (Project + Meta schemas; K 10.3) are "artifact[s] provided
  with this specification". Machine-readable base URLs from cover pages: KerML `https://www.omg.org/spec/KerML/20250201/`, SysML
  `https://www.omg.org/spec/SysML/20250201/`, API `https://www.omg.org/spec/SystemsModelingAPI/20250201/`. The exact file URLs are not given in the
  spec text **[spec gap]**; do not hard-code, vendor the schemas into `third_party/` and pin by hash. The API's REST/HTTP PSM is "described
  using OpenAPI Specification (OAS) 3.1 and is included with this specification" (A 8.1.1); the OSLC PSM uses OAS 2.0 (A 8.2.1).

### 3.3 Worked example (model-interchange `.json`, `includesDerived=false`, `includesImplied=false`)
Source text:

```sysml
package Demo {
    part def Vehicle { part engine : Engine; }
    part def Engine;
}
```

Ids use the section 4 rule with the (tool-assigned) top-level URL `https://example.org/models/Demo`
(`pkgId = uuid5(NAMESPACE_URL, that URL) = 97088cc9-eb30-53ad-8645-f66fc8c74209`); generated with Python `uuid.uuid5`:

| Element | path() | elementId |
|---------|--------|-----------|
| Package `Demo` | (root-of-id; = pkgId) | `97088cc9-eb30-53ad-8645-f66fc8c74209` |
| OwningMembership root->Demo | `Demo/owningMembership` | `8a80c0d4-05e6-58f1-8a59-21f7fb4498b3` |
| OwningMembership Demo->Vehicle | `Demo::Vehicle/owningMembership` | `4451f5c5-4189-5bd5-b39b-f91d239775f6` |
| PartDefinition `Vehicle` | `Demo::Vehicle` | `98185b2a-149b-5abe-ac5c-7bf30e95722f` |
| FeatureMembership Vehicle->engine | `Demo::Vehicle::engine/owningMembership` | `98c5efa1-e07f-56a5-8c6b-9f084e0b8517` |
| PartUsage `engine` | `Demo::Vehicle::engine` | `6be91022-0f4d-5efa-9dfc-bbe574567da4` |
| FeatureTyping engine->Engine | `Demo::Vehicle::engine/1` | `9a9fc2b7-46bb-5b52-9cc4-cd7f60d289be` |
| OwningMembership Demo->Engine | `Demo::Engine/owningMembership` | `91751e44-5a35-5e8d-a672-350fb445691e` |
| PartDefinition `Engine` | `Demo::Engine` | `7d59d5ed-ac31-5c5c-a412-314101c211d7` |

(The anonymous root Namespace's id is not derivable from the library rule; use any fresh UUID, see 4.4.)

Selected objects of the flat array (non-derived properties only; defaults shown for the first object, elided afterwards with `...`):

```json
[
  { "@id": "98185b2a-149b-5abe-ac5c-7bf30e95722f", "@type": "PartDefinition",
    "elementId": "98185b2a-149b-5abe-ac5c-7bf30e95722f",
    "aliasIds": [], "declaredName": "Vehicle", "declaredShortName": null,
    "isAbstract": false, "isSufficient": false, "isVariation": false, "isImpliedIncluded": false,
    "ownedRelationship": [ { "@id": "98c5efa1-e07f-56a5-8c6b-9f084e0b8517" } ],
    "owningRelationship": { "@id": "4451f5c5-4189-5bd5-b39b-f91d239775f6" } },

  { "@id": "98c5efa1-e07f-56a5-8c6b-9f084e0b8517", "@type": "FeatureMembership",
    "elementId": "98c5efa1-e07f-56a5-8c6b-9f084e0b8517", "aliasIds": [], "isImplied": false,
    "visibility": "public", "memberName": null, "memberShortName": null,
    "owningRelatedElement": { "@id": "98185b2a-149b-5abe-ac5c-7bf30e95722f" },
    "ownedRelatedElement": [ { "@id": "6be91022-0f4d-5efa-9dfc-bbe574567da4" } ], ... },

  { "@id": "6be91022-0f4d-5efa-9dfc-bbe574567da4", "@type": "PartUsage",
    "elementId": "6be91022-0f4d-5efa-9dfc-bbe574567da4", "declaredName": "engine",
    "isComposite": true, "isEnd": false, "isUnique": true, "isOrdered": false, "isVariable": false, "isConstant": false,
    "isDerived": false, "isPortion": false, "direction": null, "isAbstract": false, "isSufficient": false, "isVariation": false,
        "ownedRelationship": [ { "@id": "9a9fc2b7-46bb-5b52-9cc4-cd7f60d289be" } ],
    "owningRelationship": { "@id": "98c5efa1-e07f-56a5-8c6b-9f084e0b8517" }, ... },

  { "@id": "9a9fc2b7-46bb-5b52-9cc4-cd7f60d289be", "@type": "FeatureTyping",
    "elementId": "9a9fc2b7-46bb-5b52-9cc4-cd7f60d289be", "isImplied": false,
    "owningRelatedElement": { "@id": "6be91022-0f4d-5efa-9dfc-bbe574567da4" },
    "specific": { "@id": "6be91022-0f4d-5efa-9dfc-bbe574567da4" }, "typedFeature": { "@id": "6be91022-0f4d-5efa-9dfc-bbe574567da4" },
    "general":  { "@id": "7d59d5ed-ac31-5c5c-a412-314101c211d7" }, "type":         { "@id": "7d59d5ed-ac31-5c5c-a412-314101c211d7" }, ... }
]
```

Caveats: the exact attribute list per `@type` (e.g. whether `isReference` or `isComposite` are derived in a given SysML metaclass, whether
`memberName` is emitted) is set by `KerML.json`/the SysML metamodel, not by prose. The list above follows K 10.4.5 + K/S attribute tables; confirm
against the schema before shipping. `isComposite` for `part` is explicit in the pilot XMI only when different from the default.

## 4. Element identity (K 9.1, S 9.1)

### 4.1 Normative rule for library models **[verified against all 94 library files]**
K 9.1: "the `elementId` for any Element in the library model shall be a name-based (version 5, using SHA-1) UUID ... constructed from a name space
identifier and a name":

| Element | namespace UUID | name (UTF-8 bytes) |
|---------|----------------|--------------------|
| Top-level standard library package | `NAMESPACE_URL` = `6ba7b811-9dad-11d1-80b4-00c04fd430c8` | `https://www.omg.org/spec/KerML/` + package name |
| any element in its ownership tree | the UUID of the top-level package | the string returned by `path()` |

SysML (S 9.1): same, "except using the prefix `https://www.omg.org/spec/SysML/` when constructing the URL for a standard library package."

Checked:
- `uuid5(NAMESPACE_URL,"https://www.omg.org/spec/SysML/Parts")` = `6890ef7c-3613-5738-88c2-483f356d3ee5` = the `LibraryPackage` id in `Parts.sysmlx` (**SysML** prefix).
- `uuid5(NAMESPACE_URL,"https://www.omg.org/spec/KerML/Base")` = `cdd5d1e3-fe4b-52bd-8a01-51a53f22ba47` = `Base` in `Base.kermlx` (**KerML** prefix for Kernel libs;
  the SysML-prefix value `6ad56a10-...` does NOT match). The prefix is chosen by *which library family* (KerML: Semantic/Data Type/Function; SysML: Systems and all
  domain libraries), not by file extension: the `.kermlx` files still use the `sysml` XML namespace.
- Package name is the declared name (no quoting). Names are bare package names; no version in the URL.
- "elementIds ... shall be normative across all forms of interchange of the library models" and "shall remain stable for future versions" for elements with non-null qualifiedNames.

### 4.2 `path()` precisely (K 8.3.2.1.2 Element, 8.3.2.1.3 Relationship, 8.3.2.4.8 OwningMembership)
```
Element.path():
  if qualifiedName <> null                          -> qualifiedName
  else if owningRelationship <> null                -> owningRelationship.path() + '/' + owningRelationship.ownedRelatedElement->indexOf(self)   (1-based)
  else                                              -> ''
Relationship.path()  [redefines]:
  if owningRelationship = null and owningRelatedElement <> null
                                                    -> owningRelatedElement.path() + '/' + owningRelatedElement.ownedRelationship->indexOf(self)  (1-based)
  else                                              -> Element.path()
OwningMembership.path()  [redefines]:
  if ownedElement.qualifiedName <> null             -> ownedElement.qualifiedName + '/owningMembership'
  else                                              -> Relationship.path()
```

Rules: positions are "converted to a decimal string representation consisting of only decimal digits, with no sign, leading zeros or leading or trailing
whitespace"; indexes start at 1. `qualifiedName` (K 8.3.2.1.2): ownership-qualified name in KerML textual syntax: segments joined by `::`,
names that are not *basic names* (`[A-Za-z_][A-Za-z0-9_]*`) written in unrestricted form `'...'` with escapes (**[verified]**: `RealFunctions::'+'`,
`SI::'ångström'` - non-ASCII letters are quoted and kept as raw characters). It is `null` if the owning namespace chain is not fully named back to a
root namespace, and "If the owningNamespace has other Elements with the same name as this one, then the qualifiedName is null for all such Elements other
than the first" (so duplicates fall back to index paths, and *declaration order* decides who keeps the name).

The `name` used is the **effective** name, not `declaredName`:
- `Feature.effectiveName()` (K 8.3.3.3.4): if the feature has neither declaredName nor declaredShortName, use `namingFeature().effectiveName()`; by default
  `namingFeature()` = the `redefinedFeature` of the *first* `ownedRedefinition`. Hence the unnamed `return` parameter of `calc def SampledFunctions::Domain` (no `declaredName` in the XMI)
  gets id `uuid5(pkgId, "SampledFunctions::Domain::result")` **[verified]** - its name comes from an implied Redefinition of the library `result` feature.
- SysML overrides (S 8.3.6.4 Usage, 8.3.17.14 PerformActionUsage, 8.3.12.2 ConjugatedPortDefinition, 8.3.6.3 ReferenceUsage): `ConjugatedPortDefinition` -> `'~' + originalPortDefinition.name`; variant `Usage` -> referencedFeature of its ownedReferenceSubsetting;
  `PerformActionUsage` -> `performedAction`; payload `ReferenceUsage` of a `TransitionUsage` -> trigger payload parameter. `escapedName()` falls back to `shortName`.

Worked examples (pkg id of `Parts` = `6890ef7c-...`) **[verified]**:

| string | uuid5(pkgId, string) | element |
|--------|----------------------|---------|
| `Parts/owningMembership` | `620595d0-953a-58eb-a0e6-1ec5ced81c7a` | OwningMembership root->`Parts` |
| `Parts/1` | `84bd1321-3743-5949-a064-91fbf472253b` | 1st OwningMembership of `Parts` (owns unnamed `Documentation`) |
| `Parts/1/1` | `2b574b4a-b51c-560b-bf14-33cf613dc44c` | that `Documentation` |
| `Parts/2` | `5ce7ffa5-9f97-5740-a910-90935e8e29c6` | 2nd relationship: a `MembershipImport` (no qualifiedName) |
| `Parts::Part` | `0774a545-39e3-5bc1-9607-63beabc6bf65` | `PartDefinition Part` |
| `Parts::Part/owningMembership` | `7d4fe0b6-2f19-5aab-b809-2cba36089e64` | its OwningMembership |
| (package itself) | `uuid5(NAMESPACE_URL, ".../SysML/Parts")` = `6890ef7c-...` | `LibraryPackage Parts`; **not** `uuid5(pkgId,"Parts")` (= `fae8b81d-...`) |

Notes on subtlety:
- The *package* is the one exception to "other elements = uuid5(pkgId, path())": it uses the URL form. Its OwningMembership (`Parts/owningMembership`) uses
  the path form.
- "OwningMembership" in the rule means every Membership subtype that *owns* its member (FeatureMembership, ParameterMembership, ReturnParameterMembership,
  EndFeatureMembership, ResultExpressionMembership, VariantMembership, SubjectMembership, ...), but NOT plain `Membership` (alias; references via
  `memberElement`, owns nothing) and not imports. e.g. `Parts::Part::self/owningMembership` is the id of the FeatureMembership owning `self`.
  **[verified]**: treating only the literal `OwningMembership` type fails 6,494 FeatureMemberships.
- Index of an owned relationship counts *all* `ownedRelationship`s in order, including documentation/comment memberships, imports and (when present) implied ones;
  implied ones are appended last so explicit indices are unaffected whether or not implied relationships are serialized **[verified]**.
- Implied-relationship-dependent names: the id of an element whose name is derived through an *implied* Redefinition (e.g. unnamed return parameters) is
  computed in the implied-complete model. Consequently the elementIds in the non-implied library XMI are only reproducible by a tool that knows the implied
  relationships. 5,643 of 109,494 ids in `sysml.library.xmi` are not reproducible from that file alone for this reason; in `sysml.library.xmi.implied`, 404,511 of
  404,601 (99.98%) reproduce with the algorithm above; the 90 residuals are descendants of `PerformActionUsage`/variant/transition-payload naming-feature
  overrides (not implemented in the checker).
- `path()` is defined on the *whole* owner chain, so renaming an ancestor changes every descendant's qualifiedName-based path - or, for unnamed
  descendants, the index path from the nearest named ancestor.

Reference implementation sketch (Python): `pkg = uuid.uuid5(uuid.NAMESPACE_URL, family_prefix + name)`; every other element `uuid.uuid5(pkg, path(el))` with the UTF-8 bytes of `path`.

### 4.3 Guidance for non-library models
K 9.1 (last paragraph): "A tool may also use the above approach for generating the UUIDS for Elements of models other than standard library
models. However, it is then the responsibility of the tool to assign a unique URL to each top-level element in a model, since this is required in order to
ensure the uniqueness of the generated UUIDs. Note also that, if a model undergoes frequent changes in the names and/or ordering of Elements, this may result
in unexpected changes or reassignment of generated UUIDs."

Therefore for user models: (1) pick a stable unique URL per top-level element (e.g. `<project IRI>/<top-level name>`; remember the rule hashes the *top-level
element's* URL, one namespace UUID per top-level package); (2) apply `uuid5(topId, path())`; (3) persist an `oldPath -> id` map across renames/reorders if
stability matters (the spec explicitly warns it will not otherwise be stable); (4) ids must be valid UUID strings because the API requires `Data.getId() : UUID` (A 7.1.2:
"Each realization of Data must implement the getId() operation that provides a valid UUID").
Non-top-level uniqueness is guaranteed only within a top-level element's tree; two root namespaces may legally contain top-level elements of the same name (K 10.3
Note 1), in which case they must receive different URLs.

> **Update (sysml-cli `sysml-semantic`, `tests/library_ids.rs`):** with the SysML
> `namingFeature()`/`effectiveName()` overrides implemented (ConjugatedPortDefinition
> `~name`, PerformActionUsage/ExhibitStateUsage/IncludeUseCaseUsage, ConstraintUsage in a
> RequirementConstraintMembership, variant usages), **all 404,686** element ids below the
> root namespaces of `sysml.library.xmi.implied` reproduce exactly. That test is the
> regression oracle for identity.

### 4.4 The anonymous root Namespace id - **unresolved**
`Parts.sysmlx` root `Namespace` has `elementId="ab865815-118b-50df-9222-73d595d17e93"` (v5-shaped; version nibble 5). It is NOT derived by the K 9.1 rule (the root is
not in the library package's ownership tree; `libraryNamespace()` is null for it). Tried without success (all with uuid5 and uuid3, namespaces
URL/DNS/OID/X500/pkgId/zero/uuid5(URL,prefix)/uuid5(URL,prefix+name)): names `''`, `Parts`, `Parts.sysml(x)`, `Systems Library/Parts.sysml`,
`sysml.library/...`, `platform:/resource/...`, `file:/...`, OMG URLs with/without version stamp, `root`, `Namespace`, `0`, `1`, `/`, `<pkgId>`, plus
2-token combinations with `/ :: # . : space - _ @ ?` separators. All 94 root ids are distinct and are not shared between kernel/system files. Likely derived from a
tool-internal resource URI (Eclipse pilot) and therefore irrelevant for interoperability: **treat the root Namespace id as opaque**; a consumer must not rely on
it, and a producer may generate any UUID (a deterministic `uuid5(topId, "")` is a reasonable choice for us). Cross-file references never target the root.

## 5. Systems Modeling API and Services 1.0
Architecture (A 6.1): a platform-independent model (PIM, clause 7: services and operations) with two platform-specific models (PSMs, clause 8):
**REST/HTTP** (OpenAPI 3.1 file shipped with the spec) and **OSLC 3.0** (OAS 2.0 + resource shapes). Providers conform at PSM or PIM level.

### 5.1 Data model (A 7.1)
`Record` (abstract): `id : UUID {readOnly}`, `resourceIdentifier : IRI [0..1]`, `alias : String [0..*]`, `name : String [0..1] {subsets alias}`, `description`.
Subtypes: `Project`, `Commit`, `CommitReference` (abstract; `Branch`, `Tag`), `DataVersion`, `DataIdentity`, `Query`.

| Type | Attributes |
|------|------------|
| Project | `name` (required), `created : ISO8601DateTime`, `description`, `defaultBranch : Branch`, `branch/tag/commit/commitReference` (navigation), `usage : ProjectUsage[*]`, `queries : Query[*]`, derived `identifiedData : DataIdentity[*]` |
| Commit | `created`, `owningProject`, `previousCommit : Commit[*]` (set), `change : DataVersion[1..*]`, derived `versionedData : DataVersion[*]` |
| CommitReference | `created`, `deleted` (ISO 8601), `name`, `referencedCommit` |
| Branch | `head : Commit`, `owningProject`; mutable (head moves), destructible |
| Tag | `taggedCommit : Commit`, `owningProject`; immutable, destructible |
| DataIdentity | `id` = the element's `elementId`; derived `createdAt`, `deletedAt` : Commit |
| DataVersion | `identity : DataIdentity [1]`, `payload : Data [0..1]` (null = deletion), `commit`, derived `project`; `id` = **new random UUID per version** |
| Data (interface) | realized by `Element`, `ExternalData`, `ExternalRelationship`, `ProjectUsage`; `getId() : UUID` |
| ProjectUsage | `usedProject`, `usedProjectCommit` (project usage is itself Data, versioned in commits) |
| ExternalRelationship | `specification`, `language`, `elementEnd : Element`, `externalDataEnd : ExternalData`; `ExternalData.resourceIdentifier : IRI` |
| Query | `name`, `select : String[*]`, `scope : Data[*]` (default = owning project), `where : Constraint`, `orderBy : String[*]` |
| PrimitiveConstraint | `property : String`, `operator` (`instanceOf`, `=`, `<`, `<=`, `>`, `>=`, `in`), `value[1..*]` (String/Boolean/Integer/Double/UUID/null), `inverse : Boolean` (logical NOT) |
| CompositeConstraint | `constraint[2..*]`, `operator` (`and`, `or`) |
| DataDifference | `baseData`, `compareData : DataVersion [0..1]` |
| MergeResult | `mergeCommit : Commit [0..1]`, `conflict : DataIdentity [0..*]` |

Immutability table (A 7.1.2): Commit: not mutable, not destructible; Branch: mutable + destructible; Tag: not mutable, destructible.

### 5.2 Commit / change model (normative invariants, A 7.1.2)
- `Commit.versionedData` lists only live data (all `payload` non-null). `Commit.change` expresses deletion as a `DataVersion` with `payload = null`; only valid if
  a previous commit contains that identity.
- "`DataVersion.identity` is unique among records listed in Commit.versionedData and in Commit.change."
- Merge commits: "A Commit must resolve all conflicts in its parent Commits" - if a parent's versionedData lists version Da and the merge commit's does not contain Da,
  then `change` must list a DataVersion with `Da.identity`.
- Monotonic time: "the value of C.created must be strictly newer than ... any commit D in C.previousCommit". Timestamps: ISO 8601 with explicit UTC or offset
  (`2024-12-18T16:45:34.635726Z`); microsecond resolution suggested; UTC recommended.
- `versionedData(C) = updatedNotDeleted ∪ retained`, where retained = union over `previousCommits` of their versionedData excluding identities touched in `C.change`,
  deduplicated by identity (OCL in A 7.1.2). Clients can recompute any commit's full state from its parents.
- Delete cascade: deleting an Element identity must also delete incoming Relationships; "any references from other DataIdentity are also removed to maintain data
  integrity". Deleted data stays readable in earlier commits. Commits are never deleted in normal operation.
- createCommit input semantics: new data = DataVersion with `payload`, `identity` empty (provider assigns) or a brand-new id not present in any previous commit
  (provider "accepted as is" - this is how a client keeps its own `elementId`s); update = `payload` + existing identity; delete = identity only.
  Derived properties are "computed or verified if the API provider claims Derived Property Conformance."

### 5.3 PIM services and REST/HTTP endpoints (A 7.2, 8.1.3 Table 10)
Base URL is provider-defined (`Protocol://FQDN/...`). All JSON (`application/json`). Query params `commitId`, `branchId`, `direction`, plus pagination (5.5).

| Operation | Method + path | Request / response notes |
|-----------|---------------|--------------------------|
| createProject | `POST /projects` | body `{ "@type":"Project","name":..,"description":.. }` -> Project |
| getProjects | `GET /projects` | paged list |
| getProjectById | `GET /projects/{projectId}` | |
| updateProject | `PUT /projects/{projectId}` | body ProjectRequest (name, description, `defaultBranch`) - also implements setDefaultBranch |
| deleteProject | `DELETE /projects/{projectId}` | post-condition: later ops with that id return null/empty; behavior w.r.t. usages left to provider (3 recommended policies) |
| getCommits | `GET /projects/{projectId}/commits` | |
| createCommit | `POST /projects/{projectId}/commits?branchId={branchId}` | body CommitRequest `{ "@type":"Commit","change":[DataVersion...],"previousCommit":{...} }`; omit `branchId` -> default branch advances |
| getCommitById | `GET /projects/{projectId}/commits/{commitId}` | |
| getHeadCommit | `GET /projects/{projectId}/branches/{branchId}` then `GET .../commits/{head.@id}` | composite; default branch via Project.defaultBranch |
| getCommitChange | `GET /projects/{projectId}/commits/{commitId}/changes` | `changeTypes` filter CREATED/UPDATED/DELETED |
| getCommitChangeById | `GET /projects/{projectId}/commits/{commitId}/changes/{changeId}` | `changeId` = DataVersion id |
| getBranches / getBranchById | `GET /projects/{projectId}/branches[/{branchId}]` | |
| createBranch | `POST /projects/{projectId}/branches` | body `{ "@type":"Branch","name":..,"head":{"@id":commit} }` |
| deleteBranch | `DELETE /projects/{projectId}/branches/{branchId}` | |
| setDefaultBranch / getDefaultBranch | `PUT /projects/{projectId}` / `GET /projects/{projectId}` | via `defaultBranch` |
| getTags / getTagById / createTag / deleteTag | `GET/POST /projects/{projectId}/tags`, `GET/DELETE /projects/{projectId}/tags/{tagId}` | body `{ "@type":"Tag","name":..,"taggedCommit":{"@id":..} }` |
| getTaggedCommit | `GET .../tags/{tagId}` then commit by `taggedCommit` | composite |
| mergeIntoBranch | `POST /projects/{projectId}/branches/{targetBranchId}/merge` | returns MergeResult (mergeCommit xor conflicts); optional `resolution` Data and `description` |
| diffCommits | `GET /projects/{projectId}/commits/{compareCommitId}/diff` | base commit passed as a query parameter (name not in the extracted text **[spec gap]**, probably `baseCommitId`); `changeTypes` filter; returns DataDifference[] |
| getElements | `GET /projects/{projectId}/commits/{commitId}/elements` | all elements at the commit |
| getElementById | `GET /projects/{projectId}/commits/{commitId}/elements/{elementId}` | |
| getRelationshipsByRelatedElement | `GET /projects/{projectId}/commits/{commitId}/elements/{relatedElementId}/relationships?direction=in\|out\|both` | |
| getRootElements | `GET /projects/{projectId}/commits/{commitId}/roots` | "Get all the root elements in the given project at the given commit" |
| getQueries / getQueryById | `GET /projects/{projectId}/queries[/{queryId}]` | |
| createQuery / updateQuery / deleteQuery | `POST /projects/{projectId}/queries`, `PUT` / `DELETE .../queries/{queryId}` | |
| executeQueryById | `GET /projects/{projectId}/queries/{queryId}/results?commitId=` | default = head of default branch |
| executeQuery (ad hoc) | `GET` or `POST /projects/{projectId}/query-results` | POST exists because some clients cannot send a GET body; body = Query |
| External relationships | via Query (`@type = 'ExternalRelationship'`, `elementEnd = {elementId}`, `@id = ..`) and createCommit with payload ExternalRelationship / null | no dedicated REST endpoints |
| Project usages | via Query (`@type = 'ProjectUsage'`) and createCommit with payload ProjectUsage (`usedProjectCommit`) / null | no dedicated REST endpoints |

Spec inconsistencies to be tolerant of: Table 10 shows createCommit as `POST /projects/{projectId}/commit` in one cell and `.../commits?branchId=` in the
external-relationship rows and the examples (use `/commits`); the A B.1 createCommit example sends `"containingProject": {"id": ...}` and `"previousCommit": {"id": ...}`
(plain `id`, not `@id`) while all responses use `@id`.

### 5.4 Element JSON on the wire (A B.1 examples, informative)
```json
{ "@type": "PartDefinition", "@id": "72f90039-064b-4e91-a21d-7c58813aa4c1", "identifier": "72f90039-...", "name": "Vehicle_A", ... }
```

- `@id` / `@type` always present on records and elements; references are `{ "@id": ... }`; nullable fields are serialized as `null`; empty collections as `[]`.
- Example element carries `identifier` (pre-final name of what KerML 1.0 calls `elementId`) **[spec inconsistency]**: accept both on input; emit both for compatibility
  with the pilot (`elementId` and `identifier`) if round-tripping to pilot-era servers matters.
- Element payload shape is the K 10.4 mapping (same `@type` naming, `{ "@id" }` references). The API itself does not restate it; the REST schema `Element`/`Relationship`
  in the OpenAPI file is the contract. Derived properties appear according to the provider's Derived Property Conformance (5.7).
- Query `select` may use `@id`, `@type` and property names; `PrimitiveConstraint.property` may be `@type` (value = metaclass name; `instanceOf` for subtype match), `@id`, or any (possibly derived)
  property name. Example result row: `{"@type":"PartDefinition","@id":"...","name":"Vehicle_B","owner":null}`.

### 5.5 Pagination (A 8.1.3)
Cursor-based; applies to "any GET request that returns a collection of records". Query parameters `page[size]`, `page[before]`, `page[after]` (cursor values are
opaque base64 strings embedded in URLs). First page returned if neither cursor given; `page[size]` default is provider-defined. Response header `Link`
(IETF Web Linking, RFC 8288) carries `rel="next"` and `rel="prev"` URLs, e.g.
`<http://host:9000/projects?page[after]=MTYx...&page[size]=3>; rel="next"`. Clients "continue ... until the Link header ... does not include the URL for the next page".
The spec's prose for `page[before]`/`page[after]` is garbled ("page[before] specifies the URL of the page succeeding ..."); follow the Link header rather than constructing cursors.

### 5.6 Conformance of providers (A clause 2)
A *Service Provider* may conform at PSM level (implement one or more PSMs: REST/HTTP and/or OSLC) or PIM level (own PSM + mapping). Service conformance points:
ProjectService (all ops) / ProjectService Read (`getProjectById`, `getProjects`); ElementNavigationService (all four ops; read-only so no "Read" variant);
ProjectDataVersioningService / Read (`getCommits`, `getHeadCommit`, `getCommitById`, `getCommitChange`, `getCommitChangeById`, `getBranches`, `getBranchById`,
`getDefaultBranch`, `getTags`, `getTagById`, `getTaggedCommit`, `diffCommits`); QueryService / Read (`executeQuery`); ExternalRelationshipService;
ProjectUsageService / Read (`getProjectUsages`). Each requires passing the Annex A conformance test suite (normative): about 35 test cases - PCB 14 (versioning),
CC 6 cross-cutting (missing/nonexistent project, commit, commit-not-in-project, missing name, missing UUID), EN 5 (element navigation), PS 4, QS 2, ER 3, PU 1.
Cross-cutting rule: invalid input (missing, nonexistent, or mismatched project/commit) yields an empty result that "communicates" the reason.
Ids of created records "randomly generated and universally unique" (e.g. PIM-PCB-001).
A *Service Consumer* conformance is just "consumes the services"; no separate test suite.

### 5.7 Derived Property Conformance (A clause 2)
- **Passthrough**: store derived values supplied by clients "at face value" and return them faithfully; usable in Query constraints; provider never has to compute.
- **Full**: derived properties are always included in responses with correctly computed values (even if a commit not touching the element changed them); consumers
  "free to omit derived properties" on input; usable in queries.
- A provider may claim neither. Consequence for the engine as a *client*: never assume derived values are present; as a *producer*, emit them only if the target declares
  Full or Passthrough support.

### 5.8 OSLC PSM (A 8.2)
Project -> `oslc_config:Component`, Branch -> Stream, Tag -> Baseline, DataVersion -> VersionResource, Query constraints -> `oslc.where`; Commit, ProjectUsage, DataDifference, MergeResult,
ExternalData/Relationship, query persistence and usage create/delete are "Not available". RDF media types RDF/XML, Turtle, JSON-LD. Low priority for us.

## 6. XMI notes (pilot dialect, `sysml.library.xmi*`)

### 6.1 Normative vs. observed
Normative: `.xmi` files per XMI 2.5.1 over the MOF-conformant KerML/SysML abstract syntax (K 10.2). The spec gives **no** namespace-URI, `href`, or ordering
rules in prose; these live in the XMI/MOF machine-readable files (`KerML.xmi`, `SysML.xmi`, not in this repo). Everything below is observed from the Eclipse pilot
output (`.kermlx`/`.sysmlx`), which the README itself calls "not a fully normative OMG XMI representation".

### 6.2 Dialect **[verified over 94 files each]**
```xml
<?xml version="1.0" encoding="ASCII"?>
<sysml:Namespace xmi:version="2.0" xmlns:xmi="http://www.omg.org/XMI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:sysml="https://www.omg.org/spec/SysML/20250201"
                 xmi:id="ab865815-..." elementId="ab865815-...">
  <ownedRelationship xsi:type="sysml:OwningMembership" xmi:id="620595d0-..." elementId="620595d0-...">
    <ownedRelatedElement xsi:type="sysml:LibraryPackage" xmi:id="6890ef7c-..." elementId="6890ef7c-..." declaredName="Parts" isStandard="true">
```

- Encoding `ASCII`; non-ASCII/specials are numeric character references (`&#x398;`, `&#xe5;ngstr&#xf6;m`, `&#xA;` in `body`, `&lt;`).
- **One namespace for everything**: `xmlns:sysml="https://www.omg.org/spec/SysML/20250201"` is used for SysML *and* Kernel (`.kermlx`) files (all 188 files in both directories have `sysml:Namespace` as root; no `kerml:` prefix). The URI is the same date-stamped metamodel URI used in `.meta.json`.
- Root element = the root `Namespace` (tag name, not `xsi:type`); every other element is a child element of its owning *relationship* by property name
  (`ownedRelationship`, `ownedRelatedElement`) with `xsi:type="sysml:<Metaclass>"`. Containment is by nesting only; the opposite ends (`owningRelationship`,
  `owningRelatedElement`) are never written.
- `xmi:id == elementId` always (514,453 of 514,453 ids across both directories); both are written. `isImpliedIncluded`, `isImplied`, `isAbstract`, etc. are XML attributes, **default values omitted**
  (booleans false, enums default, `visibility="public"` omitted; `visibility="private|protected"` and `direction="in|out|inout"` written).
- Attribute order observed: `xmi:id, elementId, [isImplied], [reference attrs], [declaredShortName], declaredName, [isImpliedIncluded], boolean flags...`.
- References: same-file target -> attribute whose value is the target's id, single-valued in all 188 files (`type="0774a545-..."`, `typedFeature=`, `subclassifier=`, `redefiningFeature=`,
  `memberElement=` for in-file targets, `annotatedElement=`); cross-file -> child element named after the property with
  `href="<relative path, %20-encoded>#<uuid>"`, e.g. `<superclassifier href="Items.sysmlx#8e9bd20f-..."/>`,
  `<importedMembership href="../Kernel%20Libraries/Kernel%20Semantic%20Library/Objects.kermlx#3f16753b-..."/>`. A cross-file `memberElement` carries an
  `xsi:type` hint: `<memberElement xsi:type="sysml:Feature" href="...#..."/>`. 12,133 hrefs in the non-implied set (105,403 in the implied set); no `#id`-only hrefs exist.
- Relationship properties in the redefining-name form only: `FeatureTyping` writes `typedFeature` + `type` (not `specific`/`general`); `Subclassification` writes
  `subclassifier` + `superclassifier`; `Redefinition` `redefiningFeature`/`redefinedFeature`; `Subsetting` `subsettingFeature`/`subsettedFeature`;
  `TypeFeaturing` `featureOfType`/`featuringType`; `FeatureChaining` `chainingFeature`; `ReferenceSubsetting` `referencedFeature`; `Annotation` `annotatedElement`.
  (Contrast with the JSON rule, 3.1 item 3, which also requires the redefined names.)
- Derived properties never appear (`name`, `qualifiedName`, `owner`, ...). Library files list `Documentation`/`Comment` as `body="..."` attributes.
- Directory layout mirrors the textual library: `Kernel Libraries/{Kernel Data Type Library,Kernel Function Library,Kernel Semantic Library}/*.kermlx`,
  `Systems Library/*.sysmlx`, `Domain Libraries/{Analysis,Cause and Effect,Geometry,Metadata,Quantities and Units,Requirement Derivation}/*.sysmlx`; **no**
  `.project.json`/`.meta.json` (not a project archive). File stems equal top-level package names.

### 6.3 `sysml.library.xmi` vs `sysml.library.xmi.implied` **[verified]**
Same 94 files, same layout; the `.implied` set is the `includesImplied=true` serialization.

| Metric | `xmi` | `xmi.implied` |
|--------|-------|---------------|
| XML nodes | 121,806 | 510,183 |
| elements with `xmi:id` | 109,673 | 404,780 |
| `href` references | 12,133 | 105,403 |
| elements with `isImplied="true"` | 0 | 177,827 |
| elements with `isImpliedIncluded="true"` | 0 | 87,258 |

What implied adds (type counts of `isImplied="true"` relationships): `TypeFeaturing` 72,115; `Subsetting` 46,680; `Redefinition` 42,470; `BindingConnector` 12,025; `FeatureTyping` 3,895;
`Subclassification` 318; `CrossSubsetting` 317; `ReferenceSubsetting` 7. Mechanics (e.g. `Parts::Part::start`):
- adds `isImpliedIncluded="true"` to the owner element (Features, BindingConnectors, literals, multiplicity ranges, expressions ... **not** memberships/imports, i.e. not literally
  "all elements" as K 10.3 Note 5 says for `includesImplied=true`);
- appends implied relationships after the explicit ones: `<ownedRelationship xsi:type="sysml:Subsetting" ... isImplied="true" subsettingFeature="..."><subsettedFeature href="Items.sysmlx#..."/>`;
- an implied `TypeFeaturing` may *own* a synthesized anonymous feature (2,658 `Feature`s owned by implied relationships, e.g. `Part_snapshots`, `ForLoopAction_whileLoop_body_snapshots`) that
  has its own `Redefinition` (of `Occurrences::Occurrence::snapshots`) and a non-implied-flagged `TypeFeaturing`;
- nested implied elements are named `<Type>_<feature>` style; ids still follow `uuid5(pkgId, path())`.
Explicit relationships/elements and their ids are byte-identical between the two sets (except the added attributes). Roughly 3.7x element growth: do not import `.implied` data into an
engine that recomputes implied relationships itself unless it dedups on `isImplied`.

## 7. Implications for an implementation (written for `sysml-interchange`) - checklist

### 7.1 Must emit to round-trip with other tools
1. **Model files**: textual `.sysml`/`.kerml` (source of truth) and/or JSON `.json` array. Minimum for K conformance: textual OR JSON. XMI optional.
2. **JSON element objects**: `@id` (UUID), `@type` (unprefixed metaclass name), `elementId`, every non-derived attribute of the metaclass chain incl. redefined-name pairs
   (`specific`+`typedFeature`, `general`+`type`, ...), booleans/enums as JSON bool/strings (`"in"`, `"public"`), references as `{"@id": ...}`, ordered lists in model order, both ends
   of ownership (`ownedRelationship`/`owningRelationship`, `ownedRelatedElement`/`owningRelatedElement`). Emit null/`[]` explicitly. Vendor `KerML.json` and validate our output in CI.
3. **Ownership tree completeness**: a file must contain the whole ownership tree of its root namespace (incl. root Namespace, Memberships, Documentation/Comment, imports, multiplicities,
   literals, expression trees, parameters). Cross-file refs by `{"@id"}` must resolve in the same project or in a `usage` project.
4. **Stable ids**: UUID v5 per K 9.1 (4.2); mandatory *exact match* for the standard libraries (differential test against `sysml.library.xmi.implied`, 404k ids); deterministic scheme +
   persisted rename map for user models (4.3). IDs must be valid UUID strings.
5. **Implied relationships / derived values**: decide per output and declare it: `.meta.json` `includesDerived` / `includesImplied` set to exactly what we wrote (true/false). If
   `includesImplied=false`, set `isImplied=false`/`isImpliedIncluded=false` everywhere; if true, include *all* implied relationships and set `isImpliedIncluded=true` consistently. To
   reproduce library ids for unnamed elements we must model implied Redefinitions (4.2) internally even when not emitting them.
6. **`.kpar`**: ZIP with top-level `.project.json` (`name`, `version` required; `usage[]` with the OMG IRIs + `versionConstraint` for every library actually referenced) and `.meta.json`
   (`index`: every top-level `name`/`shortName` -> file, `created`, `metamodel` = `https://www.omg.org/spec/SysML/20250201` (or KerML), `checksum` SHA256 per file as
   `{value, algorithm}` objects). Extension `.kpar`; files `.sysml` for SysML (S clause 2). Stored or deflated both fine for readers; the release uses stored.
7. **API client** (push/pull): `@id`/`@type` JSON; create commit with `DataVersion{payload, identity:{@id}}` (supply our own `elementId` as new identity to keep ids), `POST .../commits`;
   follow `Link: rel="next"` pagination; tolerate `identifier` as alias of `elementId`, `timestamp` as alias of `created`, single-object `previousCommit`.

### 7.2 Optional / tolerate-on-import
- XMI export (`.xmi`) and the pilot's `.kermlx/.sysmlx` import (needed only to diff against golden data; parse namespace `https://www.omg.org/spec/SysML/20250201`, `xsi:type`, attribute vs
  `href` child references, default-omitted attributes).
- `license`, `maintainer`, `website`, `topic` in `.project.json`; `checksum` (verify when present, emit anyway); `includesDerived`/`includesImplied` absent -> treat as "unknown, recompute".
- Derived property values in input: ignore/recompute unless `includesDerived=true` and we choose to trust them (Passthrough-style).
- OSLC PSM, ExternalRelationship/ExternalData, merge/diff endpoints, query CRUD (only `executeQuery` is needed for read-only conformance).
- Accept `checksum` values as either a single object or a list; accept `usage` IRIs from either KerML/ or SysML/ path for Quantities-and-Units; accept subdirectories in archives.
- Anonymous root Namespace id: opaque; never compare or depend on it.

### 7.3 Gaps to close before claiming conformance
- Obtain `KerML.json`, `ModelInterchange.json`, the SysML JSON schema and the API OpenAPI file (all absent from `sysml-v2-release`) from the 20250201 machine-readable bundles; pin them
  under `third_party/` and generate attribute tables from them, not from prose.
- Implement the SysML `namingFeature` overrides (PerformActionUsage, variant usages, TransitionUsage payload, ConjugatedPortDefinition `~name`) so all 404,601 implied-set ids reproduce.
- Compare against a pilot-produced JSON sample (none ships in the release repo) for the exact per-metaclass field set.

## 8. Verification log
- kpar: `unzip -l`/`unzip -p` on all 10 `sysml.library.kpar/*.kpar`, parsed with Python `json`; SHA-256 recomputed for all 21 Systems Library entries (all match); all entries STORED.
- ids: Python `uuid.uuid5`; a checker walks every `.sysmlx/.kermlx`, builds qualifiedName (`::`, quote non-basic names, first-of-duplicates only, effective names via first `Redefinition`, `~` for
  conjugated ports), `path()` per 4.2, prefix by library family. `xmi`: 103,851/109,494 elements reproduce (rest need implied redefinitions); `xmi.implied`: 404,511/404,601 (rest need SysML
  `namingFeature` overrides). All 94 package ids match `uuid5(NAMESPACE_URL, prefix+name)`. Every `elementId` of `xmi` occurs in `xmi.implied`; `xmi:id == elementId` for 514,453 elements.
- XMI statistics: `xml.etree.ElementTree` histograms of `xsi:type` (126 metaclasses in `xmi`, 127 in `xmi.implied`) and attributes over both directories.
- Spec text quoted from the supplied plain-text extractions (K 10, 9.1, 8.3.2, 8.4.2; S clause 2, 9.1; A clause 2, 7, 8, Annex A/B).

## 9. Open questions
1. Exact `KerML.json` required/optional field set per `@type`; whether the root Namespace object is part of `.json` model files.
2. How the pilot derives the root Namespace id (4.4).
3. `diffCommits` base-commit parameter name; `createCommit` path singular/plural (use plural).
4. Whether `ModelInterchange.json` accepts `checksum[path]` as list, object, or both.
5. Whether a SysML JSON profile adds a `@context` or wrapper (none documented).
