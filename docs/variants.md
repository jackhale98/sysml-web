# Variants and configurations

One design often makes several products: a standard drone and a long-range
one, with another battery and another radio. SysML v2 writes those choices
into the model with its own variability constructs (SysML v2 7.6.8,
`variation` and `variant`); Tessera reads them, shows any configuration's
bill of materials, budgets, checks and structure diagrams, lists them in a
variability matrix, and reports a configuration whose choices don't add up.
Nothing here is Tessera notation: the model stays plain SysML v2 that other
tools read (the demo passes the OMG pilot implementation's checks).

For using it in the app, see **Help → Show one configuration of a product**
([user guide](user-guide.md#show-one-configuration-of-a-product)). This page is
for modellers writing it by hand and for developers.

## In the model

```sysml
// A variation definition: the answers to one choice, each a variant.
variation part def RadioOption :> TelemetryRadio {
    variant part standardRadio : TelemetryRadio;
    variant part longRangeRadio : TelemetryRadio {
        attribute :>> mass = 75 [g];
        attribute :>> range = 30 [km];
    }
}

// The product line: the product with its choices left open (variation points).
part droneFamily :> drone {
    part battery :>> battery : BatteryOption;   // typed by a variation def
    part radio :>> radio : RadioOption;
}

// A configuration: the product line with one variant chosen for each point.
part longRangeDrone :> droneFamily {
    part :>> battery = BatteryOption::longRangePack;
    part :>> radio = RadioOption::longRangeRadio;
}
```

- **Variation point**: a `variation` usage (`variation part engine : Engine {
  variant part small; variant part big; }`), or a usage typed by a `variation`
  definition (`part radio : RadioOption`). Its **variants** are the
  variation's `variant` members.
- **Product line**: a usage or a definition whose features are variation
  points (`droneFamily`; `part def Lamp { part bulb : BulbChoice; }`). A
  variation point in a package on its own (the battery trade study's
  `batteryOptions`) is listed as a point but belongs to no product line.
- **Configuration**: a usage directly in a package that specializes a product
  line (`:>` for a usage, `:` for a definition) and chooses for its points:
  it binds each one to a variant (`part :>> radio = RadioOption::longRangeRadio;`)
  or specializes one (`part :>> radio :> RadioOption::longRangeRadio;`). A
  choice it doesn't make itself it takes from the usage it specializes on the
  way to the line (`part sportsCar :> smallCar;` keeps `smallCar`'s engine).
- **The product** a configuration shows is the outermost usage it specializes
  (`droneFamily :> drone`, so `drone`): that is what the demo's tables and
  diagrams expose.

Two conventions in the demo (`system/DroneConfigurations.sysml`) are worth
copying:

- **Variation definitions rather than variations in the product line.** A
  configuration then refers to a variant by the definition
  (`BatteryOption::longRangePack`), not through the point
  (`droneFamily::battery::longRangePack`, which is also correct SysML).
- **A point redefines the product's part under a name of its own**
  (`part battery :>> battery`). Without it the point is named by what it
  redefines, so renaming the drone's `battery` would leave each
  configuration's `:>> battery` pointing at nothing (the rename can't follow
  the implied name, and refuses).

A variant needs its values to be overridable: a value bound with `=` in a
definition can't be redefined (the pilot reports *Cannot override a binding
feature value*), so `Battery` and `TelemetryRadio` give theirs as `default`s.

## Showing a configuration

The selector (**Configuration**, above the bill of materials, the mass and
power budgets, the design checks, and the general and interconnection
diagrams of a product that has configurations) is one choice for the whole
workbench, so every table and diagram that can show it agrees. **As written**
is the model as it is; nothing else changes then.

How the engine works it out (`src/lib/engine/toolkit/variability.ts`):

1. **Discovery** reads the model adapter's records: variants by their
   membership (`VariantMembership`), variations by the `variation` keyword,
   specializations and types as the toolkit resolved them
   (`ViewContext.supers`), a choice's binding by resolving its value where it
   is written (`ViewContext.resolveIn`). Nothing is evaluated: `all X` and
   other extents are not needed.
2. **The configured model.** The page adds a pseudo-file
   (`.tessera/configuration`, holding the configuration's qualified name,
   `src/lib/engine/configuration.ts`) to the files of a call. The host
   (`ToolkitHost.buildConfigured`) then rewrites, in a copy of the texts, the
   declaration each chosen point stands for (`drone::battery`: the feature the
   point redefines, else the point itself) as the chosen variant: typed by the
   variant's type, with the variant's features, those of what it specializes
   (`longRangePack :> batteryOptions::semiSolidState` brings the pack's mass,
   capacity and usable fraction), the variation's common ones, and those of
   the declaration it replaces that the variant doesn't redefine; its doc
   comment names the variant. Everything that reads `drone.battery` (the
   roll-up `emptyMass`, `endurance`, the `satisfy` claims) now reads the
   variant, by the toolkit's own evaluation, `verify` and diagrams.
3. **A session apart.** The rewritten texts are analysed in a session of
   their own (from the analysed one's settled outcomes), kept beside the
   analysed project's and freed when the project changes. The analysed model,
   its problems, the editor's language services and every call without the
   pseudo-file are untouched.
4. **Lines kept.** The rewritten declaration is written on one line, followed
   by as many line breaks as it had, and padded to its length when shorter,
   so every other element keeps its line (a table row still opens where it is
   written). When it is longer, the byte offsets after it in that file move;
   the diagram then finds such a node by its name.
5. **Read only.** A configuration is worked out, not written, so its tables
   have no editable cells and its diagrams no editing (Add, Connect, Rename,
   Delete are off); the note above the table or on the diagram says what is
   shown.

A choice with a problem (below) is left as written when the configuration is
shown. An unknown configuration name is the model as written.

Hand-worked demo figures (`variability.test.ts`): the long-range drone is
2.77 kg − 0.1 kg (semi-solid-state pack, 1000 g for 1100 g) + 0.045 kg
(long-range radio, 75 g for 30 g) = 2.715 kg empty and 3.715 kg at take-off;
it draws 397 W + 5 W = 402 W; its endurance is 260 W·h × 0.9 / 400 W =
35.1 min (today: 216 W·h × 0.85 / 400 W = 27.54 min). The standard drone is
the drone as written.

## The variability matrix

`ModelViews::VariabilityMatrix` (in `libraries/ModelViews.sysml`, so a project
gets it like the other standard tables):

```sysml
view def VariabilityMatrix {
    @TableRendering {
        rows = "variability";
        columns = "configuration; variationPoints; description = doc";
    }
}

view droneVariants : VariabilityMatrix {
    expose DroneConfigurations::*;
}
```

One row per configuration; `variationPoints` stands for one column per
variation point the configurations choose for (a name two product lines share
is told apart by the line, `droneFamily.battery`), each cell the variant
chosen. A choice with a problem is the cell's problem (marked, with the
reason). Fields: `configuration`, `productLine`, `product`, `doc`, `file`,
`line` and the points. **New view → Variability matrix** saves one.

## Problems

Warnings in **Problems** and in the editor (code `variability`), at the
configuration or at the choice:

- a configuration that leaves a variation point open: *`openDrone` leaves the
  variation point `battery` open: choose one of its variants (`standardPack`,
  `longRangePack`) with `:>> battery = …`*;
- a choice that isn't one of the point's variants: *`wrongDrone`:
  `batteryOptions::lithiumPolymer` is not one of the variants of `battery`*;
- two choices for one point, by two redefinitions (*chooses for `radio` more
  than once*) or by binding a list (*`battery` is bound to 2 elements*).

A choice whose name doesn't resolve is left to the unresolved-name error the
model already reports. A choice a configuration inherits is reported where it
is made.

## Limits

- A configuration is a usage directly in a package; a part typed by a product
  line inside another part (a fleet of drones) is not one.
- A point whose declaration is in a library can't be shown chosen; nor a
  point nested inside a part of the product line (`droneFamily.camera.lens`)
  unless it redefines a feature of the model (its declaration is rewritten
  wherever it is written, a definition included: every usage of that
  definition then shows the variant).
- The rewritten declaration keeps the declaration's keyword, name and
  multiplicity, and its type becomes the variant's; other specializations it
  writes (`:> rotors`) and a value it is given are dropped.
- Names in the copied text are as the variant writes them: they must resolve
  where the product is written too (units from `SI`, as in most models).
- Constraint checks of the configuration are those of the product: a
  `satisfy … by drone` is decided with the chosen variants. The inspector's
  values and **Problems** stay those of the model as written.
- Trade studies are unchanged: a study's alternatives can be variants, and a
  configuration can choose the one it selects (the demo's long-range pack
  specializes the study's `semiSolidState`).
