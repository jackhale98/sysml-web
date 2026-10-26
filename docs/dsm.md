# Dependency matrices (DSM and N² charts)

How Fairtide shows a SysML v2 view as a dependency matrix: a design
structure matrix (DSM) or an N² chart. The convention is defined in the
`DependencyMatrices` library (`libraries/DependencyMatrices.sysml` in the
demo, copied into a project by its first **New DSM**); this page documents
it for anyone writing matrix views by hand or building another tool that
reads them. Tables have their own convention: [table-rendering.md](table-rendering.md).

## The views

A matrix is an ordinary `view def` that specializes the standard
`GridView` (SysML v2's view of "relationships arranged in a rectangular
grid", such as a dependency matrix) and says with `@MatrixRendering` what
its rows are and which relationships count:

```sysml
metadata def MatrixRendering {
    attribute elements : String;          // "parts", "actions" or "requirements"
    attribute dependencies : String;      // the kinds that count, ;-separated
    attribute order : String[0..1];       // "model" or "clustered"
    attribute cells : String[0..1];       // "marks" or "names"
    attribute levels : Natural[0..1];     // with `expose X::**`: how deep
}

view def DependencyMatrix :> StandardViewDefinitions::GridView {
    @MatrixRendering {
        elements = "parts";
        dependencies = "connection; flow; binding";
        order = "model";
        cells = "marks";
    }
}

view def InterfaceN2 :> DependencyMatrix {
    @MatrixRendering { dependencies = "connection; flow"; cells = "names"; }
}

view def FunctionalDsm :> StandardViewDefinitions::GridView {
    @MatrixRendering { elements = "actions"; dependencies = "succession; flow"; order = "model"; cells = "marks"; }
}

view def RequirementDsm :> StandardViewDefinitions::GridView {
    @MatrixRendering { elements = "requirements"; dependencies = "derivation; refinement"; order = "model"; cells = "marks"; }
}
```

A view typed by one of them says what it compares with `expose`, and may
change any setting with its own `@MatrixRendering` (the values a view
gives override its def's, setting by setting, as `@TableRendering` does):

```sysml
view droneDsm : DependencyMatrix {
    expose DroneArchitecture::drone::*;
    @MatrixRendering { dependencies = "connection; flow; allocation"; order = "clustered"; }
}
```

The app saves what is chosen on the matrix (the kinds counted, the order)
the same way, in the view's own `@MatrixRendering`, as one undoable step.

## Rows and columns

The rows are the elements the view exposes of the matrix's kind, in the
order they are declared; the columns are the same elements in the same
order, so each is on the diagonal.

- `expose X::*`: X's members (owned, and those its definition and
  supertypes give it). `expose X::**`: their members too, as many levels
  deep as `levels` says (all when left out); a nested element is listed
  under the one it is in. `expose X`: X itself.
- **parts** are part usages (not `ref` parts, which refer to parts listed
  elsewhere) and part definitions; a package that has both lists its
  usages, a package of definitions lists its definitions. **actions** are
  action usages and definitions (`perform`, `send`, `accept` among them).
  **requirements** are requirement and concern usages and definitions.
- Without `expose`: the parts of the project's first part that has parts,
  the steps of its first action that has steps, or every requirement its
  packages hold.

A part a definition gives to several usages (each rotor's `esc`, written
once in `Rotor`) is listed once per usage, by its path (`frontLeft.esc`).

## Links

Each link is read from the row's element to the column's: across a row is
what an element leads to or affects, down a column what leads to it.

| kind | from | to | |
| --- | --- | --- | --- |
| `connection` | either end | the other | a `connect`, `connection` or `interface`, both ways |
| `flow` | the source | the target | `flow of Item from a.p to b.q` |
| `binding` | either end | the other | `bind a = b`, both ways |
| `allocation` | what is allocated | where | `allocate a to b` |
| `typing` | B | A | a feature of A is typed by B's definition: A uses what B is |
| `satisfy` | what satisfies | the requirement | `satisfy R by a` |
| `succession` | the step before | the step after | `first a then b`, through forks, joins, decisions and merges |
| `derivation` | the original requirement | the one derived from it | a `#derivation` connection |
| `refinement` | what is refined | what refines it | a `#refinement` dependency |

A connector's ends are resolved as the language resolves feature chains,
from where the connector is written: a connector of a definition applies
in every listed element typed by it. An end stands for the deepest listed
element on its path, so an end on a port (`battery.powerOut`) or a
parameter (`checkDropZone.isClear`) stands for its part or action. A link
with one end outside the matrix (the radio's antenna bound to the drone's
own port, an action allocated to a part) is kept as the element's link
outside the matrix, shown with its details.

An interface's definition says what it carries: its own flows between its
ends (`flow of ElectricPower from supply.power to load.power`) give, for
each direction, the items that pass. An N² chart (`cells = "names"`) shows
in each cell the interfaces and the items that pass from the row's part to
the column's.

## Suggested modules

`order = "clustered"` reorders the elements into suggested modules. It is
a suggestion from the links alone, worked out the same way every time:

1. Links of the counted kinds weigh 1 each, in either direction, between
   two elements.
2. Elements linked to exactly the same others (the four rotors, each
   powered by the board and commanded by the flight controller) start as
   one group; every other linked element starts alone.
3. The two groups whose joining most raises the modularity (the share of
   the weights inside groups, less what chance would put there given how
   linked each group is: the gain of joining a and b is
   2·(e_ab / 2m − a_a·a_b)) are joined, again and again while it rises.
   Ties go to the pair that comes first in the model.
4. Groups of two or more are the suggested modules, numbered in the order
   of their first element; elements on their own follow in model order,
   and elements with no links come last.

The order is a pure function of the elements and the links, so the same
model always gives the same suggestion.

## Change impact

What a change to an element may reach: the elements it leads to, then
what those lead to, and so on, along the counted kinds (a connection or a
binding both ways). Each is directly affected or reached in two or more
steps; the matrix says how many of each.

## Review flags

A connection or interface with no definition (a plain `connect`), and an
element with no links among the counted kinds, are flagged. Links to
elements outside the matrix count: a step allocated to a part is not
flagged in a functional DSM that counts allocations, though the matrix
lists only steps.

## In the app

The grid numbers the elements down the side and across the top; a cell
shows a mark per kind of link (C connection, F flow, B binding, A
allocation, U uses, S satisfies, N comes next, D derivation, R refinement)
with how many, or the names for an N² chart. Pointing at a cell, or
moving to it with the arrow keys, describes its links; choosing one
selects the connection for the inspector, and **Show in SysML** shows where
it is written. An empty cell between two parts of the same thing offers
**Connect them**, which writes a `connect` (through ports when the parts
have them, with an interface definition when one fits) as one undoable
step. A part's lightning button shows what a change to it may affect.

On a phone the matrix is a list: each element opens to what it is
connected with, leads to and comes from, grouped by kind, with **What a
change affects** and **Add a connection**; the settings are a sheet, and
**Grid** shows the matrix, scrolling sideways.

The matrix is read once per analysis of the model; the order, the modules
and the change impact are worked out as they are chosen, so switching kinds
or order shows at once.
