# §8 Data integrity, Git collaboration and recovery

> Written before the fixes that followed it: what became of each critical finding is in [the assessment summary](README.md#critical-findings-and-what-became-of-them).

Assessed on `claude/assess-data-integrity` (based on 92cfbcf). Scores are Fairtide's unless
marked "engine". Every test named here was run in this session unless it says otherwise.

Commands (from the repository root):

```
npx vitest run src/lib/project/session.assessment.test.ts src/lib/git/collab.assessment.test.ts \
  src/lib/git/merge-semantics.assessment.test.ts src/lib/interchange/kpar.assessment.test.ts \
  src/lib/exchange/api.assessment.test.ts
npx vitest run src/lib/project src/lib/git src/lib/interchange src/lib/exchange src/lib/offline
PW_PORT=4325 npx playwright test tests/e2e/assessment-data-integrity.spec.ts --workers=2
```

How storage works, in one paragraph: every project lives in IndexedDB (`sysml-web` /
`projects`, one record per project holding all its files), saved 0.6 s after each change
(`src/lib/project/session.svelte.ts:14`) and at once when the page is hidden, left or
reloaded for an update (`src/routes/p/[project]/+page.svelte:57-98`). A folder project
also keeps the folder handle and the folder's text of every file not written back yet; a
GitHub project keeps the commit its files are based on and the text of every file there
(`src/lib/git/types.ts`, `GitRecord`). Tokens live in `localStorage` only.

## Results of the runs in this session

| Run | Result |
| --- | --- |
| New unit tests (5 files) | 25 pass, 6 `it.fails` known gaps (5 confirmed failing for the stated reason by a probe run with `it`; the sixth, the stale "Saved", follows from `changed()` not touching `saveState`) |
| Area unit suites (`src/lib/project`, `git`, `interchange`, `exchange`, `offline`, `dataio`, `worker/src`) with the fixes | 35 files, 304 pass, 6 expected fail |
| `tests/e2e/assessment-data-integrity.spec.ts` | 7/7 pass; `--repeat-each=3` 21/21 |
| Tab tests repeated (`-g "closing the tab\|two tabs" --repeat-each=12`) | 24/24, and 23/24 in another run (one failure, test not identified) |
| Existing e2e touching persistence (`offline`, `install`, `files`, `smoke`, `review`, `signin`, `exchange`, `library-kpar`) with the fixes | 63 pass, 1 skipped |
| `npm run check` | 0 errors |

The tab-close test is timing-sensitive by nature (the tab is closed within the autosave
delay and the save must finish while the page is torn down): about 1 failure in 25–50 runs
on this heavily loaded machine. The original code passed it 12/12 in one comparison run; the
sample is too small to tell the two apart.

## Fixes made in this assessment (critical defects)

1. **Two tabs of one project silently dropped each other's edits.** Each tab saved the whole
   project record; the later save replaced the other tab's changes. Now each save says
   which version it was based on (`updated`), and the store refuses it, in the same
   IndexedDB transaction, when another tab saved meanwhile (`src/lib/project/store.ts`,
   `saveProject`: the check and the write are queued together, and a stale check aborts the
   transaction); the tab shows "Not saved" with the reason, and leaving asks first. A
   page's own saves now go one at a time so they are not mistaken for another tab's
   (`session.svelte.ts`, `save`/`write`). Test: `session.assessment.test.ts` "keeps the
   edits of two tabs…" failed before the change (run as a probe with `it`, AssertionError)
   and passes after; e2e "two tabs of one project…" (see below).
2. **"Get latest" replaced edits made while it waited for conflict choices.** A pull with
   conflicts is kept pending while the sheet is open or closed; choosing then applied the
   files as they were when it was planned, so typing done meanwhile (in the conflicting
   file, or in a file only they had changed) was overwritten without a word. Now the pull
   is refused with "Files changed here since you chose Get latest… Get latest again"
   when any file it would write changed (`src/lib/git/connection.svelte.ts`, `asPlanned`).
   Tests: `collab.assessment.test.ts` "keeps edits made while a pull waits…" and "…to a
   file only they had changed" failed before (probe run: the later edit was reverted) and
   pass after.
3. **"Import a project" left files out without a word.** A model file that isn't UTF-8 was
   dropped, and the archive's checksum warnings (a file changed since the archive was made,
   a file listed but missing, unreadable metadata) were thrown away
   (`src/routes/projects/+page.svelte`, `importArchive`). Now the project opens with a
   notice that stays until dismissed: "rig.zip: Left out a file that isn't readable as
   text (save as UTF-8 and import again): Weights.sysml. Rig.sysml has changed since the
   archive was made…"; when nothing readable is left, the error names the files. Test: e2e
   "importing an archive says which files were left out, and what did not check out" ran
   as `test.fail` before the change (expected failure observed) and passes after.

## Fixed after the assessment (`claude/fix-folder-save`)

The answers below describe the app as assessed; these gaps are now closed.

1. **"Save to folder" no longer overwrites a file changed on disk.** It re-reads the folder
   first and compares each file with the folder's text as last read or written
   (`src/lib/project/folderSync.ts`). Changed only here: written. Changed only in the folder
   (or added or deleted there): brought into the project, as one undoable step, and the toast
   says so. Changed on both sides, differently (including a file deleted on one side and
   edited on the other, and a new file whose name a new file on disk took): nothing is
   written; the same per-file choice as "Get latest" opens (combine both when the lines
   differ, keep mine, take the folder's), and a file that changes again before the choice is
   finished makes it stop and ask again. The folder's `.project.json` is no longer rewritten.
   Tests: `session.assessment.test.ts` "does not overwrite a file changed on disk…" (failed
   as plain `it` before, passes), `session-folder.test.ts` "files changed in the folder
   meanwhile", e2e `files.spec.ts` "saving to the folder asks before overwriting…".
2. **No stale "Saved" during the autosave delay.** A change shows "Saving…" until it is
   stored (`session.assessment.test.ts` "does not show a change waiting for its autosave as
   saved", failed before, passes).
3. **The tab-close test is deterministic.** The page also saves on `beforeunload`; the e2e
   test holds the autosave timer still (Playwright clock), checks the status says "Saving…",
   fires the page-hidden or page-left event, and checks the store before closing the tab
   (passes 60/60 with `--repeat-each=30`).

## Questions

### Can the application recover from browser crashes, tab closure, and interrupted saves without losing acknowledged edits?
- **Answer:** Yes for edits shown as saved. Each edit is in IndexedDB within 0.6 s; closing the tab, switching app or reloading flushes at once. A browser killed with SIGKILL after "Saved" shows reopens with the edit. A save the browser refuses (quota) leaves the last good copy intact, shows "Not saved", and leaving asks first with "Try again". An interrupted folder save keeps every file counted as unsaved and a retry finishes it.
- **Evidence:** `tests/e2e/assessment-data-integrity.spec.ts` ("an edit survives closing the tab straight after typing", "an edit shown as saved survives the browser being killed", "a save the browser refuses…"); `src/lib/project/session.assessment.test.ts` ("reports a save the browser refused…", "saves a change still waiting…when flushed", "reports a write that failed part-way…"); existing `tests/e2e/offline.spec.ts:146` (reload for a new version keeps the latest edit), `tests/e2e/smoke.spec.ts:171` (survives a reload). Run in this session: see the results table above (the tab-close test is timing-sensitive).
- **Limitations:** An edit made less than 0.6 s before a hard crash (power loss, killed process) can be lost, and during that moment the status still says "Saved" from the save before (`session.assessment.test.ts`, `it.fails` "does not show a change waiting for its autosave as saved"). Undo history is in memory only (lost on reload). Storage eviction is possible unless the browser grants persistence (asked for when a project is first stored; shown in Settings).
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** additional testing (Safari/Firefox, iOS background kill); small fix for the stale "Saved" status.

### Does it distinguish saved changes from unsaved changes?
- **Answer:** Yes, per destination: the status shows Saving…/Saved/Not saved for this browser; "N unsaved · Save to folder" for folder projects; the branch chip shows "N unsaved" against the GitHub base; the projects list and the leave dialog count the same way (`src/lib/project/pending.ts`). The one blur: the 0.6 s autosave window (above).
- **Evidence:** `src/lib/project/pending.test.ts` (existing, run), `session.assessment.test.ts` (leaveRisk after a refused save), `tests/e2e/install.spec.ts:219` (existing, not run here), `tests/e2e/files.spec.ts` folder test (existing, not run here).
- **Limitations:** No per-file "modified" marker in the editor tabs for browser-only projects (everything is saved there). The `.project.json` (name/description) is not counted as a GitHub change.
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** bug fix (show "Saving…" from the first keystroke).

### Can multiple users collaborate without silently overwriting one another's work?
- **Answer:** Through GitHub, yes: a save is refused unless the branch still points at the commit the project is based on (checked first, then `force: false` on the ref update), with "Someone saved newer changes… Get the latest first"; nothing is written and local changes stay. "Get latest" takes their changes where only they changed a file and asks per file where both did (with a combined version when the lines differ). Two tabs of one project in one browser no longer overwrite each other (fixed here). Through a SysML v2 API server, a save after someone else saved merges element by element and re-checks the head before committing. Through a shared folder, no: the folder is not re-read before "Save to folder", so a change made on disk to the same file is overwritten.
- **Evidence:** `src/lib/git/collab.assessment.test.ts` (two people on one branch: refused, nothing lost, merge, both saved; GitHub's 422 "not a fast forward" after the check is reported as "get the latest", base unchanged); existing `src/lib/git/github.test.ts:141`, `src/lib/git/sync.test.ts:112`, `src/lib/exchange/sync.test.ts:58`, `src/lib/exchange/merge.test.ts`; e2e "saving to GitHub after someone else saved is refused plainly…"; `session.assessment.test.ts` two-tab test and `it.fails` "does not overwrite a file changed on disk…".
- **Limitations:** Folder projects: last writer wins against other editors/sync tools (known gap, test kept as `it.fails`). Two tabs: the losing tab is told and must reload; its unsaved edits are not merged. API server first save (no link to a base commit) is planned against the head and not re-checked before the commit.
- **Status:** Partially verified
- **Score:** 2 (Fairtide) — GitHub path 3, folder path 1.
- **Next action:** bug fix (re-read folder files before writing; refuse or ask when they changed).

### Are merge conflicts involving the same model element detected and resolved safely?
- **Answer:** GitHub: by file and line. Changes to the same or adjacent lines of a file are a conflict with no automatic merge; the person chooses theirs, mine or (when lines differ) the combined text, per file, before anything is written. A file renamed here and changed there shows as "deleted here" vs changed. API server: by element and property (`src/lib/exchange/merge.ts`): both changed the same property differently, both added in the same place, or one removed what the other changed or started using, each asked as "Keep mine/Keep theirs".
- **Evidence:** `collab.assessment.test.ts` ("asks when both changed the same element (the same line)…", "flags a file renamed here and changed there"); existing `src/lib/git/diff.test.ts:81-100`, `src/lib/exchange/merge.test.ts:282-406`.
- **Limitations:** Git merging is textual: two edits to one element on non-adjacent lines merge without a question. A rename is shown as delete + add, so a conflict on a renamed file reads as "deleted here".
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** planned capability (element-level merge for Git, reusing the server merge).

### Can Git merges produce syntactically valid but semantically inconsistent models, and how are these detected?
- **Answer:** Yes. Detection is the ordinary analysis after the pull: unresolved names are reported as problems. Nothing in "Get latest" itself says the merge broke the model. Tested on the real engine, all four textual merges that break the model are reported by the analysis after the merge: a rename here plus a new use of the old name there (unresolved `Engine`, no conflict at all), a feature removed here and used there in the same file (combined version offered, then unresolved `mass`), the same definition name added by both sides (duplicate-name error), and the same requirement identifier `<'R-4'>` added by both sides (duplicate-name error on the short name).
- **Evidence:** `src/lib/git/merge-semantics.assessment.test.ts` (real engine; merges as "Get latest" does; 4 tests, run, pass).
- **Limitations:** The pull outcome says "Got the latest version" even when the merged model has new errors; there is no "problems introduced by this merge" list, so a break is noticed only if someone looks at the problem count. Breaks that are valid SysML (a value changed on one side that a constraint on the other side now fails) show only as a failed check. Found while testing: the engine rejects `first` and `frame` as names (they are keywords), which is correct SysML.
- **Status:** Partially verified
- **Score:** 2 (Fairtide; name resolution is the engine's)
- **Next action:** planned capability (after a pull, compare problems before/after and show new ones; flag duplicate names and identifiers).

### Are identifiers stable across renames, file moves, and refactoring?
- **Answer:** Files: a rename or move changes only the path (SysML resolves by name, so references hold); undo moves it back; folders and GitHub see delete + add. Elements: the text has no persistent element IDs; identity is the qualified name. Rename-everywhere (engine) updates references across files in one undoable step. For the SysML v2 API, elements keep the server's ids by matching place (`rebaseIds`), including when another tool renumbered them. Requirement IDs are covered by §7.
- **Evidence:** existing `src/lib/project/workspace-undo.test.ts:49`, `src/lib/git/sync.test.ts:54`, `src/lib/project/session-folder.test.ts:115,159`, `src/lib/exchange/merge.test.ts:418` (all run here).
- **Limitations:** Renaming an element changes its identity for Git history and for any external tool keyed on qualified names; there is no stable UUID in the text (SysML textual notation has none by default).
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** None for files; additional testing for API-server id stability across an element rename.

### Can users undo imports, bulk edits, and automated transformations?
- **Answer:** Model edits from forms, diagrams, tables, quick fixes, rename-everywhere, file create/rename/delete, requirement import and changes brought in from an API server are one undoable step each (`Workspace.transact`, last 50). Importing a project creates a new project; the source file is untouched (delete the project to undo). Not undoable as a step: "Get latest" and "Discard" on GitHub projects (they write files outside a transaction; an open editor's own history can revert its file).
- **Evidence:** existing `src/lib/project/workspace-undo.test.ts` (run), `src/lib/dataio/*` tests (not run here), `src/lib/exchange/ApiServer.svelte` `bringIn` (code).
- **Limitations:** Undo is in memory, per page; lost on reload. 50 steps.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (make pull/discard one undoable transaction).

### Are failed saves and interrupted exports reported clearly?
- **Answer:** Browser save failures: "Not saved" with the browser's message as a tooltip, and leaving asks ("Your latest changes couldn't be saved… Try again"). Folder: an error toast with the reason; nothing marked saved. GitHub: plain-language errors by kind (expired sign-in, no permission, rate limit, branch moved, offline) (`src/lib/git/errors.ts`). `.kpar` export: an error toast if building it fails; the browser's download itself is not observable.
- **Evidence:** `session.assessment.test.ts`, e2e storage-full test, existing `src/lib/git/github.test.ts:262,345` (run), `collab.assessment.test.ts` 422 case.
- **Limitations:** The refused-save message is only in a tooltip (the visible text is "Not saved"). After a two-tab refusal, "Try again" fails again until reload (the dialog's advice is about storage).
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** additional testing (word the two-tab case in the leave dialog).

### Can a project be recovered from corrupt files or partial archives?
- **Answer:** A file with syntax errors opens and is reported, nothing is dropped. Archives: one cut short or with invalid compressed data is refused with "not a ZIP file"/an error; a `.kpar` whose file changed or is missing is detected by its SHA-256 checksums, and (fixed here) the import now says so, and names model files left out because they aren't UTF-8. Still open: a plain ZIP's entry CRCs are not checked, and duplicate entries keep the last silently.
- **Evidence:** `src/lib/interchange/kpar.assessment.test.ts` (passing: truncated, invalid deflate, checksum mismatch, missing file, non-UTF-8 listed as skipped by the reader; `it.fails`: duplicate entries, CRC); e2e "importing an archive says which files were left out, and what did not check out"; existing `src/lib/interchange/kpar.test.ts:89,172`.
- **Limitations:** No size limit on decompression (a ZIP bomb would exhaust memory; not tested). The import notice is a toast that stays until dismissed; it is not kept with the project.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (check CRC; warn on duplicates; cap entry size).

### Are multi-file operations atomic where necessary, or is there a safe recovery mechanism?
- **Answer:** Browser save: one IndexedDB put of the whole project, so all files or none. GitHub save: one commit, made visible by one ref update; a failure before it leaves only unreferenced objects. Folder save: not atomic (file by file), but safe to retry: every file stays "unsaved" until all succeed, and the browser copy holds them. A case-only rename removes the old name before writing the new, so a failure between leaves the folder without the file until retried (the browser copy has it). Model edits in one transaction are not rolled back if a later step fails, but they are one undo step.
- **Evidence:** `session.assessment.test.ts` (write fails part-way; rename whose write fails), `collab.assessment.test.ts` (ref update refused), existing `src/lib/git/github.test.ts:91`.
- **Limitations:** Folder writes are not transactional; a crash mid-save leaves the folder mixed (recoverable from the browser copy).
- **Status:** Verified
- **Score:** 3 (Fairtide)
- **Next action:** None (consider write-new-then-rename for folders).

### Does Fairtide avoid modifying files outside the intended workspace?
- **Answer:** Yes on disk: it writes only through the folder handle the person picked (the browser scopes it), only `.sysml`, `.kerml`, `.md` and `.project.json`, and paths made in the app are checked (`src/lib/project/filenames.ts`: no `..`, no leading dot, no reserved names). Other files are not touched; empty folders left by a deleted file are removed. Archive entry paths, however, are not checked: `../x.sysml`, `/etc/x.sysml` and `C:\x.sysml` become project files and are written into any `.kpar` exported later. They cannot reach the disk (folder projects come only from a picked folder) and GitHub refuses them.
- **Evidence:** `kpar.assessment.test.ts` (`it.fails` "refuses or reports paths that leave the project"; passing test documenting the re-export), existing `src/lib/project/filenames.test.ts`, `session-folder.test.ts`.
- **Limitations:** `.project.json` is rewritten on every folder save (formatting normalised).
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (normalise or refuse archive paths on import).

### Can users work offline and synchronize changes predictably?
- **Answer:** Yes: the app shell and engine are cached; stored projects open and edit offline; changes not on GitHub are counted and kept; GitHub actions say they need a connection. Sync is manual (Save to GitHub / Get latest), with the conflict rules above; nothing syncs in the background.
- **Evidence:** existing `tests/e2e/offline.spec.ts` (not run here; the lead runs the full suite), `src/lib/offline/caching.test.ts` (run), `src/lib/git/errors.ts` `networkError`.
- **Limitations:** One device per browser; no automatic retry.
- **Status:** Partially verified (by existing tests)
- **Score:** 3 (Fairtide)
- **Next action:** None

### Are repository permissions, credentials, and tokens handled securely?
- **Answer:** GitHub tokens (a pasted fine-grained token, or "Sign in with GitHub" access + refresh tokens) and API-server tokens are kept in `localStorage` in plain text, sent only as `Authorization` headers. Sign-in uses PKCE and a state check; the one-time code is removed from the address bar; the client secret stays in a stateless worker that logs nothing and answers only allowed origins. In this session's tests the token was not in the stored project, the exported `.kpar`, any cache, any address or the console, and only `api.github.com` received it. One leak path: the SysML v2 API client sends its token to whatever host a "next page" `Link` header names.
- **Evidence:** e2e "the GitHub token stays out of the project, its export, the offline cache, addresses and the console"; `src/lib/exchange/api.assessment.test.ts` (`it.fails` cross-host `Link`); existing `src/lib/git/oauth.test.ts`, `src/lib/git/account.test.ts`, `worker/src/index.test.ts`, `src/lib/offline/caching.test.ts` (run); grep: no `console.*` call outside the engine client prints request data.
- **Limitations:** No Content-Security-Policy (`src/app.html`), so any script injection could read `localStorage` tokens. Permissions are GitHub's (fine-grained token scopes or the App's chosen repositories); Fairtide adds none.
- **Status:** Partially verified
- **Score:** 2 (Fairtide)
- **Next action:** bug fix (keep the API token to the server's origin); planned capability (CSP).

### Can users migrate projects between machines and supported repository providers without losing work?
- **Answer:** Between machines: `.kpar` export and import round-trip every file byte for byte (checksummed); a GitHub project opens on another machine from the repository. What does not travel: undo history, the "marked as reviewed" checkpoint, the folder link, account tokens, and (via GitHub) the project's name and description in `.project.json`, which is never committed. Providers: only GitHub is built; GitLab and others are planned (`GitProvider` interface).
- **Evidence:** existing `tests/e2e/smoke.spec.ts:171` (round trip, not run here), `src/lib/interchange/kpar.test.ts:49,212` (run).
- **Limitations:** As listed. Other providers: Not claimed.
- **Status:** Verified (machines); Not claimed (other providers)
- **Score:** 3 (Fairtide, machines)
- **Next action:** planned capability (commit `.project.json`; GitLab).

## Prioritized question 8: Can a failed save, interrupted import, or browser crash cause data loss?

Edits shown as saved survive a closed tab, a reload and a killed browser (tested). A refused
save is reported and nothing is half-written. An interrupted folder save is retried safely.
Before this assessment, two tabs of one project and a pending "Get latest" could each drop
work silently; both are fixed and tested. Remaining loss paths: (1) a hard crash within
0.6 s of typing, while the status still reads "Saved"; (2) "Save to folder" overwrites a
file changed on disk since it was opened; (3) importing an archive silently leaves out model
files that aren't UTF-8 and ignored checksum warnings — fixed here; the import now says what
was left out and why.

## Prioritized question 9: Can multiple users collaborate through Git without silent overwrites or undetected semantic merge errors?

No silent overwrites through GitHub: saves are fast-forward only and refused plainly when
the branch moved; pulls never write a file both sides changed without a choice; edits made
while a pull waits are no longer overwritten (fixed here). Semantic merge errors are only
partly detected: unresolved references after a clean textual merge show as problems in the
normal analysis, and so do duplicate definitions and duplicate requirement identifiers
(tested on the real engine), but the pull itself never says the merge broke the model:
it reports success and leaves the person to notice the problem count.

## Section scores

| Sub-area | Score | Notes |
| --- | --- | --- |
| Browser persistence and crash recovery | 3 | tab close, kill, quota tested; 0.6 s window |
| Saved vs unsaved | 3 | stale "Saved" during the autosave delay |
| Multi-user: GitHub | 3 | fast-forward only, pull conflicts, pending-pull fix |
| Multi-user: two tabs | 2 | fixed here: detect and refuse; no merge |
| Multi-user: shared folder | 1 | external changes overwritten (critical) |
| Same-element conflicts | 3 | line-level (Git), element-level (API server) |
| Semantic merge detection | 2 | via ordinary analysis only |
| Identifier stability | 2 | path-only renames; no element ids in text |
| Undo of bulk/automated edits | 2 | pulls not undoable; in-memory only |
| Failure reporting | 3 | |
| Corrupt/partial archives | 2 | import warnings shown (fixed here); no CRC check, duplicates silent |
| Atomicity | 3 | folder retry-safe, not atomic |
| Workspace confinement | 2 | archive paths not normalised |
| Offline and sync | 3 | existing tests |
| Credentials | 2 | API token follows cross-host links; no CSP |
| Migration | 3 | machines; other providers not claimed |

## Critical findings

1. **Fixed — two tabs of one project lost each other's edits silently.** Repro (before the
   fix): open a project in two tabs; edit `A.sysml` in the first (wait for "Saved"); edit
   `B.sysml` in the second; reload: the first tab's edit is gone. Tests:
   `session.assessment.test.ts`, e2e "two tabs of one project…".
2. **Fixed — "Get latest" overwrote edits made while it waited for conflict choices.** Repro
   (before the fix): GitHub project; someone else changes `A.sysml` and `B.sysml`; you change
   `A.sysml`; Get latest → conflict; close the sheet; edit `A.sysml` (or `B.sysml`); Get
   latest → Keep mine: the later edit is reverted. Tests: `collab.assessment.test.ts`.
3. **Open — "Save to folder" overwrites changes made to the same file on disk.** Repro: open
   a folder; edit `model/A.sysml` in another editor and save there; edit `model/A.sysml` in
   Fairtide; Save to folder: the other editor's change is gone, with no warning. Test:
   `session.assessment.test.ts` `it.fails` "does not overwrite a file changed on disk…".
4. **Fixed — importing an archive dropped non-UTF-8 model files and checksum warnings
   silently.** Repro (before the fix): zip `Rig.sysml` (UTF-8) and `Weights.sysml` (Latin-1
   `ö`); Import a project: it opened with `Rig.sysml` only and said nothing. Test: e2e
   "importing an archive says which files were left out, and what did not check out".

## Roadmap candidates

| Item | Impact | User value | Effort |
| --- | --- | --- | --- |
| Re-read folder files before "Save to folder"; ask when changed on disk | Removes a silent-overwrite path | High | S |
| Check ZIP CRCs; warn on duplicate entries; cap entry size | Detects corrupt archives | Medium | S |
| Normalise/refuse `..`, absolute and drive paths in archives | Stops hostile paths propagating to exports | Medium | S |
| After "Get latest", list problems the merge introduced (before/after diff of diagnostics) | Detects semantic merge breaks at the point they happen | High | M |
| Report duplicate member names and duplicate requirement identifiers | Detects the most common semantic merge clash | High | M (engine or Fairtide check) |
| Element-level merge for Git (reuse the API-server merge) | Fewer false conflicts, real element conflicts | High | L |
| Make "Get latest" and "Discard" one undoable step | Recovery after a wrong choice | Medium | S |
| Show "Saving…" from the first change (not the stale "Saved") | Honest status | Medium | S |
| Two tabs: lock (Web Locks/BroadcastChannel) so the second tab opens read-only or reloads | Better than refusing after the fact | Medium | M |
| Keep the API-server token to its origin when following `Link` | Closes a credential leak path | Medium | S |
| Content-Security-Policy | Limits token theft by injected script | Medium | M |
| Commit `.project.json` to GitHub | Name/description travel with the project | Low | S |
| GitLab/Gitea providers | Migration between providers | Medium | L (planned) |
