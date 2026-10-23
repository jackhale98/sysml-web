# Fairtide user guide

<!-- Made from src/lib/help/content.ts, the help in the app: change it there, then run
     UPDATE_USER_GUIDE=1 npx vitest run src/lib/help -->

Fairtide is a workbench for SysML v2 models, in the browser, on a phone or a computer. This is
the help that comes with it: open it in the app with **Help** in the project menu, by pressing
<kbd>?</kbd>, or by typing `?` in search.

## Contents

- [Getting started](#getting-started)
- [Ideas in plain words](#ideas-in-plain-words)
- [How do I…](#how-do-i)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Where’s my data?](#wheres-my-data)

## Getting started

What a project is, what is in it, and the three ways of looking at it.

### A project

A project is one system model: the text files that describe it, the views saved with it and a short tour. Make one from **Your projects**: give it a name and choose where to start.

- **Blank**: a first requirement, the system part and three views. Build it your way.
- **Requirements first**: for moving a requirements spreadsheet. The usual columns, a trace and a report.
- **Small system**: a flashlight with parts, a wire between them, a mass budget and its on/off states. Good for learning.
- **From GitHub**: open the models in a repository you already have.

A new project opens on its **Overview**, with **Next steps** that tick themselves as you do them, and **Start the tour** for a walk through what is there.

In the app: **New project**.

### Its files

A project is a folder of plain text files, the same as any SysML v2 tool reads:

- `.sysml` files (in `model/`, or in folders such as `requirements/` and `design/`): the model itself: requirements, parts, how they connect, what they do.
- `views/Views.sysml`: the saved views: tables, diagrams, budgets and reports.
- `libraries/`: the definitions the tables and reports use. You rarely need to open these.
- `layout/diagrams.json`: where you put the boxes on each diagram, and what each one hides.
- `TOUR.md`: the project’s tour, in Markdown. Write your own for the next reader.

Open **Files** in the explorer to see them all, or find any file, element or view with search (Ctrl K, or ⌘K on a Mac).

**New file** (in **Files**, or from search) starts another `.sysml` file. Each file’s **⋯** button (**More actions**) can **Rename…** it, **Move to folder…** or **Delete…** it; before a delete, it says what else uses the file. Undo takes any of them back.

### Text, diagrams and tables

The **text** is the model. Every **diagram** and **table** is drawn from it, so they never disagree: add a part in a diagram and the line appears in the text; change a cell in a table and the text changes too.

Open a model file to see its text and its diagram side by side (**Split**), or choose **Text** or **Diagram** at the top right. On a phone, a file opens as its diagram; **Text** is one tap away.

You don’t have to write SysML. **Add** in a diagram, the forms in the details panel and **New view** write it for you, and show you the text they write, so you learn it as you go.

### Change what a diagram shows

Right-click a box (long-press on a phone) to see its actions. Two of them look alike but do very different things:

- **Remove from diagram** takes the box off this diagram only. The element stays in the model, in the text and in every other diagram and table. Undo puts it back.
- **Delete from model** takes the element out of the text, so it leaves every diagram and table. Before you confirm, it says what else uses it: those places show as problems until you change them.

In a saved view, removing an element its `expose` line names removes that line (the view’s own record of what it shows). Anything else is hidden on that diagram, and the layout remembers it beside the positions.

Hidden elements are listed at the foot of the diagram (“2 hidden · Show all”): open the list to show one again, or show them all. Other diagrams are not affected.

**Duplicate** (Ctrl D, ⌘ D on a Mac, or in a box’s actions, an element’s menu in the explorer, the details panel and search) copies the element right after it in the text, with everything inside it, under a free name (`battery2`), and selects the copy.

**Add connected elements** (in a box’s actions, on structure diagrams) puts on the diagram what the element refers to (**Outgoing**: its type, what it specializes, satisfies or is connected to), what refers to it (**Incoming**), or both, in one step. A saved view gets an `expose` line for each; its filter may still leave some out, and it says so.

On an **interconnection** diagram, which draws one element’s parts and how they are wired, **Add connected elements** shows again the parts beside it that a connection, flow or binding joins it to, if you removed them from the diagram. State, action and sequence diagrams draw one machine, process or interaction, so it isn’t offered there.

**View as** (in a saved view’s toolbar) shows the same view as another kind of diagram that fits what it shows: a part’s general view as its interconnection view, an action’s as its action flow, and back. Only the view’s type changes (`view v : GeneralView` becomes `view v : InterconnectionView`); its positions and hidden elements come along.

### The overview and the details panel

The **Overview** shows the project at a glance: what the model has, how many requirements are met and tested, and any problems.

Select anything (in a diagram, a table, the text or the explorer) and the **details panel** shows what it is, in plain words, with its values and links. On a phone, the details slide up from the bottom.

In the explorer’s model tree, each element has a menu: its **⋯** button, a right-click, or a long press on a phone. It can **Duplicate** the element, **Rename** it (references to it follow), **Show in text**, or **Delete from model** (after saying what else uses it).

Its **Related elements** say what it refers to (its type, what it specializes, satisfies or is connected to), what refers to it, and where it is. Choose one to go to it: a quick answer to “what uses this?”.

Give a value with its unit, such as `2 [kg]`, here or in a table. If the package doesn’t know that unit yet, its import (`private import SI::*;`) is added with the value, and one **Undo** takes both back.

**Problems** (bottom of the screen, or in **More** on a phone) lists anything the model gets wrong, such as a name that refers to nothing. Click one to go to it.

In the app: **Show problems**.

## Ideas in plain words

SysML has its own words for things engineers already know. Here they are, as the details panel explains them.

### Definition and usage

Almost everything comes in two forms. A **definition** (written with `def`) describes a kind of thing once, like a datasheet or a catalogue entry. A **usage** is SysML’s word for one of them used in a place, in a role: the battery in this flashlight.

So `part def Battery` says what every battery of that kind is like, and `part battery : Battery` puts one in the design. The `:` reads “is a”.

> **Part definition**: A part definition describes a kind of component once, with its properties, ports and inner parts, so it can be reused.
>
> _Like a part number in a catalog: it says what every 'Battery 6S-5000' is like, not which one sits in which drone._

> **Part usage**: A part usage is a component in a specific place and role, such as the battery inside this drone.
>
> _Like a line in a bill of materials or a reference designator on a drawing ('B1: battery')._

```sysml
part def Drone {
    part battery : Battery;
    part rotors : Rotor[4];
}
part prototype : Drone;
```

### Part

A part is a piece of the system: hardware, software, a person or a facility. Parts contain parts, which makes the system’s breakdown, like a bill of materials.

> **Part usage**: A part usage is a component in a specific place and role, such as the battery inside this drone.
>
> _Like a line in a bill of materials or a reference designator on a drawing ('B1: battery')._

Give a part numbers with **attributes**: `attribute mass :> ISQ::mass = 48 [g];` says it has a mass, measured as a mass, of 48 grams.

> **Attribute usage**: An attribute is a property of something, like the mass of a battery or the voltage at a port.

In the app: **Add a part**.

### Port

A port is where something goes in or out of a part: power, data, fluid, force. A **port def** is the kind of connection point, like a connector standard; `~` in front of it (`~PowerPort`) is its mirror image, for the side that receives.

> **Port usage**: A port is a connection point on a part, where things like power, data or fluid go in or out.
>
> _Like a physical connector or pin on a board: the place where you plug something in._

> **Port definition**: A port definition describes a kind of connection point and what can pass through it, like a connector standard.
>
> _Like a connector specification (USB-C, M12): the pinout is defined once and reused on many devices._

### Interface

An interface joins two ports and says what crosses between them. An **interface def** is the agreement, written once; each interface uses it to join two particular ports.

> **Interface definition**: An interface definition describes an agreed port-to-port link and what crosses it, like an interface control document.
>
> _Like an ICD: both teams design to it, and it is reviewed and changed as one thing._

> **Interface usage**: An interface is a specific port-to-port link between two parts, following an agreed interface definition.

```sysml
part def Drone {
    part battery : Battery;
    part motor : Motor;
    interface power : PowerInterface
        connect battery.powerOut to motor.powerIn;
}
```

### Requirement

A requirement is a “shall” statement with an ID, like a row of a requirements spreadsheet. Its statement is its `doc` text. When it can be checked by a number, a `require constraint` states the check, with units, and the app checks it against the design. The ID (`<'REQ-12'>`) stays the same when the title changes or the requirement moves: Problems warns when two requirements share one, and the editor marks a requirement without one and suggests the next free ID.

> **Requirement usage**: A requirement is a specific 'shall' statement in your model, like 'the drone shall weigh at most 25 kg'.
>
> _Like a numbered line in a requirements specification, but linked to the design and the tests._

> **Requirement definition**: A requirement definition is a reusable template for a 'shall' statement, with a subject and a checkable condition.
>
> _Like a requirement template in a spec, with blanks for the limits that each use fills in._

```sysml
requirement <'REQ-12'> droneMass : MassRequirement {
    doc /* The drone shall weigh at most 25 kg. */
    attribute :>> massLimit = 25 [SI::kg];
}
satisfy droneMass by prototype;
```

In the app: **Add a requirement**.

### Satisfy and verify

**Satisfy** says which part of the design meets a requirement. **Verify** says which test checks it. Together they make the trace: a requirement with neither is a gap. Add them from the requirement’s details: **Add what satisfies it** and **Add a test that verifies it**.

> **Satisfy**: Claims that a design element meets a requirement; the element is bound to the requirement as its subject.

> **Verify**: Declares, inside a verification case's objective, which requirement the test checks; the case's verdict says whether it passed.

```sysml
satisfy 'Maximum mass' by flashlight;
```

In the app: **Link a part to a requirement**.

### View

A view is a saved table, diagram or report. It is part of the model, so it is shared and reviewed like the rest. `expose` says which part of the model it shows; the view’s kind says how.

- **Diagrams**: general, interconnection, state, action flow and sequence diagrams.
- **Tables**: requirements, requirement gaps, bill of materials, interfaces, trace and verification matrices, budgets and design checks, and the tables of trade studies and risk.
- **Documents**: a specification of the requirements, and an interface control document.
- **Matrices**: dependency matrices and N² charts (see **See what depends on what**).

> **View usage**: A view is a specific diagram or report generated from the model, like the parts tree of the drone.

In the app: **New view**.

### Constraint

A constraint is a rule that is true or false, such as “the mass is at most 150 g”. A requirement uses one as its check (`require constraint`); the app works out the values and says whether each holds.

> **Constraint usage**: A constraint is a rule applied in a specific place, like 'total mass at most 25 kg' for this drone.

> **Constraint definition**: A constraint definition is a reusable rule or equation, like Ohm's law, that is either true or false.

In the app: **Set a limit**.

### State machine

A state machine lists the modes something can be in (off, on, low battery) and what makes it switch between them. A **transition** leaves one state (`first`), on an event (`accept`), maybe only if a condition holds (`if`), for another (`then`).

> **State definition**: A state definition describes the modes something can be in, like off, idle and flying, and how it switches between them.
>
> _Like a mode diagram or a state machine in embedded software._

> **Transition**: A transition is a change from one state to another, triggered by an event and optionally guarded by a condition.

Run any state machine from **Simulations** in the explorer: send it events and watch it move. **Step** takes what happens without an event: a transition with no trigger, an `accept when …` whose condition is true, or a timer that is due; if nothing is ready, time passes to the next timer. **Wait** lets time pass by an amount, and everything due on the way happens in order.

Time is simulated: the clock starts at 0 and moves only when you Step or Wait. `accept after 5 [SI::min]` fires 5 minutes after its state was entered, counting again each time the state is entered; `accept at 2 [SI::h]` fires 2 hours after the start. The **Timeline** shows when each step happened.

Something that changes over time, like a battery running down, is a timed transition that changes a value: `accept after 5 [SI::min] do assign charge := charge - 0.1`. A state’s `do` action starts once the state is entered and stops when it is left.

In the app: **Draw a state machine**.

### Action flow

An action flow is a process, step by step: `then` for the next step, `fork` and `join` for steps at the same time, `decide` and `merge` for a choice.

> **Action definition**: An action definition describes a kind of task or function, with what goes in and what comes out.
>
> _Like a block in a functional flow diagram or a function signature in code._

> **Action usage**: An action is a specific step in a behavior, like 'take off' within a delivery mission.

> **Succession**: A succession says one step must finish before the next one starts.

In the app: **Draw an action flow**.

### Package

> **Package**: A package is a named folder that groups related model elements and keeps their names apart.
>
> _Like a folder in a PDM vault: it organizes the drawings, it is not part of the product._

## How do I…

Short answers to the common jobs, each with a button that starts it.

### Add a part

1. Open a diagram (such as **Structure**) and choose **Add**, or select a part definition and use **Add** in the details panel.
2. Choose **Part**, give it a name (`battery`) and, if you like, a type (`Battery`).
3. It appears in the diagram and as a line in the text.

On a phone, use the **+** button.

In the app: **Add a part**.

### Connect ports

1. Give the parts ports (**Add** › **Port**).
2. Open an **Interconnection diagram** of the part that holds them (**New view** makes one).
3. Select a port, choose **Connect** (or press C) and pick the port at the other end.

In text: `interface wire : Wire connect battery.powerOut to led.powerIn;`

In the app: **New interconnection diagram**.

### Write a requirement

1. Choose **Add** › **Requirement** (or open the requirements table).
2. Give it an ID, a title and a “shall” statement.
3. To make it checkable, select it and choose **Set a limit**: “mass at most 150 g”.

In the app: **Add a requirement**.

### Link a requirement to the design

1. Select the requirement (in the requirements table, a diagram or the explorer).
2. In its details, under **Satisfied by**, choose **Add what satisfies it** and pick the part that meets it.
3. Under **Verified by**, choose **Add a test that verifies it**: pick a test, or type a name to make a new one.

Each pick writes a `satisfy` or `verify` line, and the requirement leaves the **Gaps** list once both are there. In a diagram, **Connect** from a part to a requirement does the same.

In the app: **Link a requirement**.

### Check a budget

1. Give the parts a value, such as `mass`.
2. Select the part they belong to, and next to its value choose **Add up**: it sums the value over its parts and can make a budget table.
3. Choose **Set a limit** next to the total to write a requirement that checks it. The budget shows the margin and turns red when it is over.

In the app: **New budget**.

### Compare options

**New trade study** compares alternatives (parts, or kinds of part) on criteria you weight, such as mass, cost and power, and ranks them. The study is saved in the model, so it updates when a value changes.

In the app: **New trade study**.

### Analyse what can fail (FMEA)

An FMEA lists what can go wrong, what follows and why, and rates each line from 1 to 10 for **severity** (how bad the effect is), **likelihood** (how likely the cause is) and **detection** (how likely it is to go unnoticed). **New FMEA** asks which kind you want:

- **Design FMEA**: how the parts of a design can fail.
- **Process FMEA**: how the steps of a process (making, assembling, servicing) can go wrong.
- **Use FMEA**: the mistakes a user can make in each task, or foreseeable misuse.

It opens as a worksheet. **Add a line** to choose the part, step or task, say how it fails, what follows and why, and choose the three ratings, each with what it means. Lines can link to the hazard they can lead to. Edit any cell in place; the bin at the end of a row removes the line.

The **risk priority number** (severity × likelihood × detection) with its **band** (low, medium, high or critical), the **action priority** (high, medium or low, from the AIAG-VDA table) and the **acceptability** (acceptable, reduce as far as possible, or unacceptable) are calculated, never typed in. **Risk matrix** counts the lines by severity and likelihood, each cell coloured and patterned by its zone.

**Risk policy** (on the risk matrix, or from the search box) is your organisation’s rule: paint which cells are acceptable, to reduce or unacceptable, say where the RPN bands start, and choose whether worksheets lead with the action priority or the RPN. Both figures stay on every worksheet.

To review the high risks, use the quick reviews above a worksheet (**High priority**, **Severity ≥ 9**, **Unacceptable**, **RPN ≥ …**) or **Filter** any column: numbers by range, levels by value, text that contains words. Export takes the rows shown. **Save as a view** keeps the filters in the model, as a view anyone can open.

Each line can name the **risk controls** and **mitigations** that address it: choose them when adding a line, or select the line’s part and use **Link a risk control or mitigation** in its details, which also shows whether each control is implemented and verified. The controls already in place stay as words in the line.

A rating outside 1 to 10, a severity that is not the worst harm of the line’s hazard, an unacceptable risk, or a high-priority or unacceptable line without a verified control is flagged in its cell and under **Problems**. The rules come from the risk library in `libraries/RiskAnalysis.sysml`, which the first FMEA adds to the project.

In the app: **New FMEA**.

### Log hazards and their controls

**New hazard** records a source of harm, when people are exposed to it (optional), the harms it can cause with how severe each is, and the **risk controls** that lower the risk. Each control is a requirement, so what implements it and the test that proves it are linked as for any requirement.

1. Name the hazard and describe it.
2. Add the harms it can cause, and choose how severe each is.
3. Add the risk controls, each a “shall” statement.
4. In the **hazard log** that opens, choose a control, then **Add what satisfies it** and **Add a test that verifies it** in its details.

The hazard log lists each hazard with its harms, the worst severity and its controls, with gaps left empty. The words come from `libraries/HazardAnalysis.sysml`.

In the app: **New hazard**.

### See what depends on what (DSM)

A **dependency matrix** (DSM) lists the same parts down the side and across the top. The cell in a part’s row and another’s column shows how the first leads to the second: a connection, an item passed along a flow, a binding. Read across a row for what a part affects, down a column for what it depends on. An **N² chart** is the same grid with the interfaces and items named in the cells. It is read from the model, so it is always up to date.

1. **New DSM** (in **Make something new**, **New view** or the search box): choose a part DSM, an N² chart, a functional DSM (the steps of a process) or a requirement DSM (which requirements are derived from which).
2. Choose whose parts to compare, such as the drone, and whether to include the parts inside them too.
3. Choose what counts as a link and the order, then a name.

On the matrix, **Counts** switches kinds of link on and off: connections, flows, bindings, allocations, uses and satisfies for parts. **Suggested modules** reorders the parts so the ones linked to each other sit together and outlines the groups with more links inside than between them; it is a suggestion from the links alone. Both are saved in the view, and Undo takes them back.

Point at or select a cell for its links, with **Show in SysML**. Select an empty cell between two parts to **Connect them**. The lightning button beside a part shows what a change to it may affect, directly and through others, with how many. A part with no links, and a connection with no interface definition, are flagged for review.

On a phone each part is a card that opens to what it is connected with, leads to and comes from, with **What a change affects** and **Add a connection**; **Grid** shows the matrix, scrolling sideways.

In the app: **New DSM**.

### Draw a state machine

1. Choose **Add** › **State definition** in a package and give it a name.
2. Open its state diagram (right-click it, or **New view** › **State diagram**).
3. Add states with **Add**, and draw transitions with **Transition** (or press C).
4. Run it from **Simulations** in the explorer.

In the app: **New state diagram**.

### Make a report

**New view** › **Specification** makes a document of the requirements with their trace and gaps; **Interface control document** does the same for interfaces. **Print / PDF** prints it or saves it as a PDF; it also downloads as one HTML file or as Markdown. Tables export to Excel or CSV from their **Export** menu, and diagrams to SVG or PNG (or copy to the clipboard) from theirs.

In the app: **New report**.

### Import from Excel

1. Choose **Import requirements…** in the project menu (or **Import** above the requirements table).
2. Pick an Excel or CSV file, or paste cells copied from a spreadsheet.
3. Match its columns to ID, title, statement and the rest, check the preview, and import. A row whose ID is already here updates that requirement.

In the app: **Import requirements**.

### Save to GitHub

**Save to GitHub…** in the project menu connects the project to a repository and saves your changes there, with a note of what changed. Others can then open it from GitHub, and you can start a branch or propose changes for review. No git know-how needed.

Once a project is on GitHub, the project menu also has **Get latest** (bring in what others saved; where you both changed a file, choose whose to keep), **Propose changes…** (a pull request) and **Open on GitHub**. Sign in with GitHub, or connect with an access token; **Settings** › **Accounts** can hold more than one account.

**Review changes** in the project menu says what changed in the model, in plain words: requirements, design, behaviour, verification and risk, with the checks and budgets the change affects first. Compare with what is not on GitHub yet, a branch, an earlier version or a proposal; diagrams and tables mark what changed. In a project kept only in this browser, **Mark as reviewed** sets the version later changes are compared with.

In the app: **Save to GitHub**.

### Exchange models with other tools

Other SysML v2 tools read and write models in three ways, and Fairtide does all three. Your SysML text stays the source of truth: what comes in is written as text, and what goes out is made from it.

- **A .kpar file**: the project’s SysML text in one archive. **Download as .kpar** in the project menu writes one; **Import** on **Your projects** opens one. Everything comes across exactly as written.
- **SysML v2 JSON**: the standard file of model elements, each with an id and a type, that API servers and many tools exchange. **Download as SysML v2 JSON…** in the project menu writes it: only your model (it refers to the standard library by its standard ids, which every tool knows), or with the standard library too, so the file stands on its own. **Import** on **Your projects** reads one and writes it as SysML text.
- **A SysML v2 API server**, such as the OMG pilot server or SysON (its address ends in `/api/rest`): **Connect to a SysML v2 API server…** in the project menu.

An import says what came across and what didn’t, in a few lines; **Download the full list** gives all of it as a text file. JSON holds no comments, blank lines or layout, so a model that went through JSON reads the way Fairtide writes SysML, and element ids are not kept in the text (they come from file names here).

1. **Open from server**: choose the project, its branch and a version (the latest, or an earlier commit). It opens as a new project on this device.
2. **Save to server**: Fairtide reads the branch’s latest version, matches your elements to the server’s and saves only what differs, as one commit. What the server has and your project doesn’t is removed in that commit; earlier commits keep it.

If someone else saved to the branch since you opened the project from the server (or last saved it there), saving merges first. Their changes come into your project, as one step you can undo, and yours go to the server on top of theirs. Where you both changed the same element differently, or one of you removed something the other changed, both versions are shown in plain words: choose **Keep mine** or **Keep theirs** for each (or **Keep all mine**, **Keep all theirs**). Nothing is written until you save, and the result says what came in and what was sent.

The merge works on the model, not on your text: your files keep their notes and layout, and a new element of theirs is added where it belongs. An element they changed is written again the way the formatter writes it, so `//` notes and layout inside it don’t come through; the review names those elements first.

The browser talks to the server directly (there is no Fairtide server in between), so the server must allow this page. It answers `OPTIONS` requests and sends `Access-Control-Allow-Origin` with this page’s address (or `*`), `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Allow-Methods: GET, POST` and `Access-Control-Expose-Headers: Link` (for long lists). If it doesn’t, Fairtide says so: ask whoever runs it. A token stays on this device and goes only to its server.

In the app: **Download as SysML v2 JSON**.

### Install it on my phone

Fairtide can live on your Home Screen, Dock or app list and works offline. Choose **Install app** in the project menu or in **Settings** › **About**. On an iPhone or iPad, use **Share** › **Add to Home Screen** in Safari.

In the app: **Install app**.

### Switch projects

Open the project menu (the project’s name at the top left): your recent projects are listed there, with **All projects…** for the rest. You are asked first if changes here are not saved to GitHub or the folder yet.

In the app: **All projects**.

## Keyboard shortcuts

On a Mac, use ⌘ where it says Ctrl.

### Everywhere

| Keys | What they do |
| --- | --- |
| <kbd>Ctrl K</kbd> | Search the model, views and commands |
| <kbd>?</kbd> | Open this help |
| <kbd>Ctrl S</kbd> | Save to the folder (projects opened from a folder) |
| <kbd>Ctrl D</kbd> | Duplicate the selected element (not in the text) |
| <kbd>Ctrl ,</kbd> | Settings |
| <kbd>Esc</kbd> | Close a dialog or menu |

### In the text

| Keys | What they do |
| --- | --- |
| <kbd>Ctrl Space</kbd> | Suggest what to type |
| <kbd>Ctrl Z / Ctrl Shift Z</kbd> | Undo / redo |
| <kbd>Ctrl F</kbd> | Find and replace |
| <kbd>F12 or Ctrl click</kbd> | Go to where a name is defined |
| <kbd>Shift F12</kbd> | Find where a name is used |
| <kbd>F2</kbd> | Rename everywhere |
| <kbd>Ctrl .</kbd> | Quick fix |
| <kbd>Shift Alt F</kbd> | Tidy the layout of the text |

### In diagrams

| Keys | What they do |
| --- | --- |
| <kbd>C</kbd> | Connect from the selected element |
| <kbd>F2</kbd> | Rename |
| <kbd>H</kbd> | Remove from this diagram (it stays in the model) |
| <kbd>Ctrl D</kbd> | Duplicate, beside it |
| <kbd>Delete or Backspace</kbd> | Delete from the model |
| <kbd>Arrow keys</kbd> | Move the selected boxes |
| <kbd>Shift F10</kbd> | The element’s menu |
| <kbd>+ / − / 0</kbd> | Zoom in, out, fit (sequence diagrams and the simulator) |

### In the model tree

| Keys | What they do |
| --- | --- |
| <kbd>Shift F10</kbd> | The element’s menu |
| <kbd>F2</kbd> | Rename |
| <kbd>Ctrl D</kbd> | Duplicate the selected element |

### In the simulator

| Keys | What they do |
| --- | --- |
| <kbd>1 to 9</kbd> | Send that event |
| <kbd>S</kbd> | Step |
| <kbd>W</kbd> | Wait (let time pass) |
| <kbd>B</kbd> | Back a step |
| <kbd>P</kbd> | Play or pause |

## Where’s my data?

Plainly: on your device, unless you choose to put it somewhere else.

### In this browser

Your projects are kept in this browser, on this device, as you work. Nothing is sent to a Fairtide server: there isn’t one. They are there next time you open Fairtide here, even offline.

They are not on your other devices, and clearing this browser’s site data deletes them. So keep a copy of anything that matters:

### Keeping a copy

- **GitHub**: **Save to GitHub…** keeps every version, with who changed what, and lets your team work on it too. Only GitHub sees the files.
- **A folder**: open a folder (in Chrome or Edge on a computer) and Fairtide saves back to the files there.
- **A file**: **Download as .kpar** in the project menu saves the whole project as one file, which any SysML v2 tool can read. Import it again from **Your projects**.
- **Another tool or a server**: **Download as SysML v2 JSON…** and **Connect to a SysML v2 API server…** (see **Exchange models with other tools**).

**Settings** › **Projects & storage** shows how much space is used and can ask the browser to keep your projects.

In the app: **Download as .kpar**.
