# Baselines

A baseline is a version of the model frozen under a name at a design review
(SRR, PDR, CDR, …), that everything afterwards is judged against: what
changed since PDR, which requirements changed, whether a report describes
the model as it was reviewed. This page says how Tessera keeps baselines,
how it decides which one the model is at, and the choices behind it. The
[user guide](user-guide.md#mark-a-baseline-pdr-cdr) has the short version.

## Where they are kept

| Project                                    | A baseline is                                                         | Who sees it                               |
| ------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------- |
| Connected to a GitHub repository           | An annotated git tag, `baseline/<name>`, on the commit it is based on | Everyone with the repository, in any tool |
| Kept only in this browser                  | A frozen copy of the project's files, stored with the project here    | This browser only                         |
| Opened from a folder on this computer      | The same: a copy stored with the project in this browser              | This browser only                         |

### On GitHub: annotated tags

**Mark baseline** makes an annotated tag on the commit the project is based
on (`git.base`, the version last saved to or got from GitHub), then the ref
`refs/tags/baseline/<name>` that names it:

1. `GET /repos/{owner}/{repo}/git/matching-refs/tags/baseline/`: the list
   is read again first, so a baseline someone else marked meanwhile isn't
   doubled.
2. `POST /repos/{owner}/{repo}/git/tags` with the name, the message and the
   commit.
3. `POST /repos/{owner}/{repo}/git/refs` with `refs/tags/baseline/<name>`.

Removing one is `DELETE /repos/{owner}/{repo}/git/refs/tags/baseline/<name>`;
the commit stays in the history. The list is the matching refs, with
`GET /repos/{owner}/{repo}/git/tags/{sha}` for each annotated tag's message.

These calls need **Contents: Read and write**, the permission the GitHub
App and a fine-grained token already have to save (commit) to the
repository ([setup](setup-github-sign-in.md)); nothing new is asked for. A
repository with tag protection (a ruleset on `refs/tags/baseline/*`) can
refuse them: the app then says GitHub refused, in its words.

The tag's message is the baseline's name, its description, and the date it
stands for as a trailer:

```text
PDR

As presented at the review; actions closed.

Baseline-date: 2026-03-12
```

A `baseline/…` tag made with git itself (`git tag -a baseline/SRR`, or a
lightweight tag) is listed too: its name comes from the first line of its
message, else from the tag; its date from the trailer, else the day it was
tagged. Names git doesn't allow in a tag become dashes (`PDR 2` →
`baseline/PDR-2`). Names are unique, ignoring case.

A baseline names a version on GitHub, so changes not saved there have to
be saved first: **Mark baseline** says so rather than tag a version that
isn't the model you see. Tags are listed when the GitHub sheet opens and
when a report or the review needs them, with the project's own account.

### In this browser

A project that isn't connected to GitHub keeps each baseline in its stored
record (`StoredProject.baselines`, in IndexedDB): the name, date,
description, when it was marked, and a copy of every project file. It is an
optional field, so the record's format version (`PROJECT_FORMAT`) stays 1:
a project stored before baselines opens with none, and an older build reads
the record and keeps the field when it saves.

If the project is connected to GitHub later, these baselines stay listed
beside the repository's tags, marked "Kept in this browser". They are not
turned into tags: their files aren't a commit on GitHub.

### Folder projects: nothing is written to the folder

A folder project's baselines are kept in this browser, like any project
not on GitHub. Writing them into the folder was considered and left out:

- A copy of the model in the folder (`baselines/PDR/…`) would be read as
  part of the model by Tessera, the OMG pilot and other tools that load
  every `.sysml` file below a folder: every definition twice.
- A folder is often a git working copy, or shared through a synced drive.
  Copies of the model there would be committed or synced as new files, and
  diffs and merges would show them; git users already have tags for this.
- Writing needs the folder's permission each session, and a baseline would
  then depend on the folder being reachable.

So a folder project's baselines live only in this browser: clearing the
site's data, or opening the folder in another browser, loses them. To keep
baselines with the model, and share them with the team, save the project
to GitHub; a folder that is a git working copy can be tagged with git
(`git tag -a baseline/PDR`), and opened from GitHub its tags show here.

## Which baseline the model is at

`baselineStatus` (in `src/lib/project/baselines.ts`) gives the baseline the
model is at, or the latest it was at:

- **Exactly at a baseline**: a browser baseline whose model files
  (`.sysml`, `.kerml`) are word for word those of the project now (layout
  and other files aside); or a tag on the commit the project is based on,
  with no model change since that commit.
- **Changed since**: otherwise, the newest baseline (by the date it stands
  for, then by when it was marked) the project was at: any browser baseline
  (they were marked on this project), or a tag whose commit is in the
  history of the project's commit. That is asked of GitHub once per tag
  (`GET /repos/{owner}/{repo}/compare/{tag commit}...{base}`): a tag on
  another branch's history doesn't count.

Word for word means a comment counts as a change here, as it does for the
"with changes not committed" of a report's revision: a report made after
any edit says the model changed since the baseline, while **Review
changes** compares by meaning and may find no change to the model.

## Reports

A report's title page has a **Baseline** line, and its introduction a
sentence, when the project has a baseline:

- `Baseline: CDR`: the model is exactly baseline CDR.
- `Changed since baseline PDR`: it was at PDR and has changed since.

The Markdown and HTML downloads and the printed page footer carry the same
words beside the revision (`Commit 3f2a9c1 of acme/drone (main)`). A
project with no baseline gets neither.

## Comparing with a baseline

**Changes since PDR** in the list opens **Review changes** comparing the
model now with the baseline: its tagged commit's files from GitHub (only
the files not already known are downloaded), or its stored copy. The review
is the usual semantic one (by meaning, not text), with what the changes do
to checks and budgets first and every changed requirement named with what
relies on it. **Go to** › **Requirements** jumps to the requirements that
changed. The review's **Compare** menu lists the baselines too, so you can
switch between them and the other versions.

## Code

| File                                  | What                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `src/lib/project/baselines.ts`        | Tag names and messages, reading tags, order, `baselineStatus`        |
| `src/lib/project/baselines.svelte.ts` | The open project's baselines: list, mark, remove, `status`           |
| `src/lib/git/github.ts`               | `listTags`, `createTag`, `deleteTag`                                 |
| `src/lib/git/Baselines.svelte`        | The **Baselines** section of the GitHub sheet                        |
| `src/lib/review/review.svelte.ts`     | The `baseline` review source                                         |
| `src/lib/reports/`                    | `ReportBaseline`, the title page line and the introduction's sentence |

Tests: `src/lib/project/baselines.test.ts` (tags, order, status, marking and
removing against a fake GitHub), `src/lib/project/session-baselines.test.ts`
(a project stored before baselines; a baseline kept across a reload),
`src/lib/project/store.test.ts` (the format), `src/lib/git/github.test.ts`
(the API calls), `src/lib/reports/revision.assessment.test.ts` (the report's
words) and `tests/e2e/baselines.spec.ts` (in the browser, and on a mocked
GitHub).
