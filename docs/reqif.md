# ReqIF import and export

ReqIF (OMG Requirements Interchange Format 1.2) is how requirements move
between DOORS, DOORS Next, Polarion, Jama, Codebeamer and other requirements
tools. Tessera reads `.reqif` files and `.reqifz` archives in the requirements
import dialog, and writes the project's requirements as `.reqif` from the
**Export** menu of a requirements table.

| Code | What it does |
| --- | --- |
| `src/lib/dataio/xml-tree.ts` | A small XML parser: a tree, or an error with its line. No DTDs, no external entities. |
| `src/lib/dataio/reqif.ts` | Reads a `.reqif` / `.reqifz` into datatypes, types, objects, relations and specifications; XHTML to text. |
| `src/lib/dataio/reqif-plan.ts` | Matches attributes, object types and relation types; plans what an import creates, updates and leaves out. |
| `src/lib/dataio/reqif-apply.ts` | Carries out the plan as one undoable change. |
| `src/lib/dataio/reqif-write.ts` | Writes ReqIF; checks a ReqIF document against the schema's rules (`checkReqif`). |
| `src/lib/project/libraries/ReqIFInterchange.sysml` | The `@ReqIF` metadata definition a project gets with its first ReqIF import. |
| `src/lib/dataio/fixtures/reqif/` | Hand-written files shaped like DOORS Next, DOORS 9, Polarion and Jama exports. |

## Import

The ReqIF import goes through the same planning as the spreadsheet import
(`planImport`): each requirement object is a row and each attribute a column,
so value matching, enumeration literals, status, updates and the notes about
what was left out work the same way.

### What maps to what

| ReqIF | Tessera |
| --- | --- |
| SPECIFICATION | A package carrying `@ReqIF { identifier = "…"; }`. One specification into a new file: the file's package is the specification. |
| SPEC-OBJECT of a heading type (`Heading`, `Chapter`, `Section`, `Folder`…), or with a heading value and no text (DOORS' `Object Heading`, `ReqIF.ChapterName`) | A package inside its specification or heading, with `@ReqIF`. |
| SPEC-OBJECT of any other type | A `requirement` in the package of the heading it is under, with `@ReqIF`. |
| A requirement under another requirement | Next to it, in the same package (see below). |
| SPEC-OBJECT of an information type (`Information`, `Note`, `Figure`, `Table`…) | Left out by default; the person can make the type requirements or headings. |
| Attribute → ID, title, text | `<'ID'>`, the name, the `doc` comment. |
| Attribute → status, owner, originator | `@StatusInfo` (status must be one of SysML's `StatusKind` literals). |
| Attribute → rationale, open issue | `@Rationale`, `@Issue`. |
| Attribute → an attribute of the chosen requirement definition (priority, kind, verification method…) | `:>> priority = Priority::high;`, enumeration values matched to literals as in the spreadsheet import. |
| SPEC-RELATION of a derivation type (`Derived From`, `derives`, `Derived by`) | `#derivation connection { end #original ::> …; end #derive ::> …; }` |
| SPEC-RELATION of a refinement type (`Refines`, `Refined By`) | `#refinement dependency A to B;` |
| Any other SPEC-RELATION | Left out, named in the preview by type. |

Datatypes: STRING, INTEGER, REAL and DATE values are taken as text (a date at
midnight loses its time); BOOLEAN is `true`/`false`; ENUMERATION is the
values' LONG-NAMEs (several for a multi-valued attribute); XHTML is turned
into plain text: paragraphs become lines with a blank line between them, `<br>`
a line break, `<ul>`/`<ol>` items `- item` / `1. item` (nested lists
indented), table rows `cell | cell`, links `text (address)`, and an image or
embedded object `[attachment: file.png]`. Attribute DEFAULT-VALUEs apply to
objects that have no value of their own.

Attribute names recognised automatically (case and punctuation ignored):

| Field | Names |
| --- | --- |
| ID | `ReqIF.ForeignID`, `Absolute Number`, `ID`, `Document Key`, `Item ID`, `Object Identifier`, `Object Number`, `Identifier`, and the spreadsheet import's ID headings |
| Title | `ReqIF.Name`, `Name`, `Title`, `Object Short Text`, `Summary`, `Short Title` |
| Text | `ReqIF.Text`, `Object Text`, `Description`, `Text`, `Primary Text`, `Requirement Text` |
| Heading | `ReqIF.ChapterName`, `Object Heading`, `Chapter Name`, `Heading`, `Chapter` |
| Priority (when the definition has it) | `Priority`, `Severity` (Polarion) |
| The rest | as spreadsheet headings, without the `ReqIF.` prefix (`Status`, `Owner`, `Rationale`, …) |

The person can change every match, every object type's role (requirement,
heading, left out) and every relation type's meaning (derivation or
refinement, either direction, or left out) before importing.

### Re-import

Every requirement, specification package and heading package keeps the
IDENTIFIER it had in the file as metadata:

```sysml
requirement <'1002'> 'Hover endurance' : DroneRequirement {
    doc /* The drone shall hover for at least 20 minutes with a 1 kg payload. */
    :>> priority = Priority::high;
    @ReqIF { identifier = "_so_1002"; }
}
```

`ReqIF` is a metadata definition in `libraries/ReqIFInterchange.sysml`, which
the first ReqIF import adds to the project (like the risk libraries); it is
plain SysML any SysML v2 tool parses. Another import finds each object first
by its IDENTIFIER, then by its ID: a requirement already in the model is
updated where it differs (the same field-by-field update as the spreadsheet
import, previewed as changes), and is never added twice. What is new goes
into the package of the heading or specification it is under in the file, if
an earlier import made that package; otherwise into the chosen destination.
A relation already in the model (both ends already there and the
derivation or refinement already written) is not written again.

### What is left out, and why

Nothing is dropped without a word: the preview lists each kind of thing left
out, with examples.

- **Problems in the file**: a reference to an object, attribute, type or
  enumeration value that isn't defined, an IDENTIFIER used twice, a value of
  another kind than its attribute. The import goes on with what can be read
  and names the rest. A file that is not well-formed XML, or not ReqIF, is
  refused with the line and the reason.
- **Attachments** (images, OLE objects in a `.reqifz`): Tessera's text
  can't hold them; the requirement's text names each one where it was.
- **Relations other than derivation and refinement** (satisfies, verifies,
  relates to, links to test cases): SysML's `satisfy` and `verify` need a
  design element or a verification case at the other end, which a
  requirements tool's file doesn't have. They are named by type.
- **Relations whose ends are not requirements** (a heading, an object of a
  type left out, an object not in the file).
- **Requirement under requirement**: SysML can nest requirements, but other
  tools then need dot notation (`A.B`) to refer to the inner one, and the
  app's tables and derivations read requirements in packages. They are put
  next to their parent, in the same package, and the preview counts them.
- **Status values** that are not SysML's `StatusKind` (`open`, `tbd`, `tbr`,
  `tbc`, `done`, `closed`): workflow states like *Draft* or *Approved* don't
  say which of these they mean. Map the status attribute to a requirement
  definition's own attribute to keep them.
- **Attributes the chosen requirement definition doesn't have**: as in the
  spreadsheet import, a warning names them and suggests a definition that
  has them.
- **Moves and deletions on re-import**: a requirement the file now puts under
  another heading stays where it is (the preview says so); one no longer in
  the file stays in the model (the preview names it, to delete by hand if
  that is meant). Headings are not renamed.
- **Relation groups, tool extensions, access rights** (`SPEC-RELATION-GROUP`,
  `TOOL-EXTENSIONS`, `EDITABLE-ATTS`) carry nothing the model holds.

## Export

**Export** › **ReqIF** above a requirements table writes every requirement in
the project (libraries left out) as `<project> requirements.reqif`:

- **Datatypes**: string, XHTML, and an enumeration for status and for each
  enumeration attribute in use (with every literal of the enumeration); real
  and boolean when attributes need them.
- **Spec types**: `Requirement`, with `ReqIF.ForeignID` (ID), `ReqIF.Name`
  (title), `ReqIF.Text` (XHTML), `Status`, `Owner`, `Originator`, `Rationale`
  and the attributes the requirements redefine (kind, priority, verification
  method…), only those some requirement has a value for; `Heading`, with
  `ReqIF.ChapterName`; a `Derived from` relation type; a specification type.
- **Spec objects**: each requirement, its text as XHTML paragraphs and lists;
  each package inside a top-level package as a heading object.
- **Specifications**: one per top-level package that has requirements, with
  its packages as headings and their requirements under them.
- **Relations**: each derivation, from the derived requirement to the one it
  comes from (`Derived from`), which is how DOORS Next and Jama name it.

Identifiers are stable: a requirement or package imported from ReqIF gets
back its IDENTIFIER; any other requirement gets `tessera-req-<ID>` (or one
made from a hash of its qualified name if it has no ID), a package
`tessera-spec-<name>` or `tessera-heading-<hash>`. Exporting the same model
twice gives the same identifiers, so the other tool updates what it imported
before instead of adding it again. LAST-CHANGE is the time of the export.

Refinements are not exported yet: ReqIF has no standard relation type for
them, and the derivation is the one every requirements tool knows.

### Checking against the schema

The ReqIF XSD can't be fetched offline, so `checkReqif` checks the schema's
rules that matter for exchange: well-formed XML; the `REQ-IF` root in the
ReqIF namespace; each element's children in the schema's order, required
ones present (and the `xsd:choice` lists of datatypes, spec types and
attribute definitions); the required attributes (`IDENTIFIER`,
`LAST-CHANGE`, `MAX-LENGTH`, `MAX`/`MIN`, `ACCURACY`, `MULTI-VALUED`,
`THE-VALUE`, `KEY`/`OTHER-CONTENT`); IDENTIFIERs that are XML IDs and unique;
every `…-REF` resolving to an element of the right kind; XHTML values one
`div` or `p` in the XHTML namespace; and values only of attributes their
object's type defines. Every export in the tests passes it.

## Tests

- `src/lib/dataio/reqif.test.ts`: reading each fixture (DOORS Next, DOORS 9,
  Polarion, a Jama `.reqifz` built in the test); XHTML to text; malformed
  input refused or reported; attribute, type and relation matching; importing
  into the demo and checking the SysML parses, resolves and reads back;
  re-import with changes (updates in place, the new requirement under its
  heading, the new derivation, no duplicates); re-import matching by
  IDENTIFIER alone; refinements; export checked with `checkReqif`, stable
  identifiers, identifiers kept from an import; round trip (export the demo,
  import into a project with only `EngineeringBasics`: the same IDs, titles,
  texts, attributes, statuses, owners, rationales and derivations).
- `tests/e2e/reqif.spec.ts`: the import dialog with the DOORS Next fixture
  (matches, types, preview, import, the same file again changes nothing,
  undo) and the **Export** › **ReqIF** menu entry.
- Everything an import writes passes the OMG pilot implementation
  (`tools/interop/pilot-check.sh`) with 0 errors and no warnings beyond the
  demo's own six.
