# Folder Migration Planner

A local, offline, browser-based tool for **planning** a reorganisation of a shared drive. It never touches the drive itself. You give it a scan of the existing folders and a description of the structure you want. You then work through the old folders one at a time and decide where each one goes. At the end it exports a robocopy script and a searchable "where did it go?" log.

Two panes sit side by side, with a review panel between them:

| Pane | Purpose |
|---|---|
| **Before** (left, read-only) | The folders as they are today. |
| **Review** (middle) | Details and actions for the folder you have selected. |
| **After** (right, editable) | The proposed structure. Drag folders around, rename them, or put them into slots from your target structure. |

Only folders are tracked. Loose files travel with the folder that contains them.

**Resizing:** drag the thin bar between Before/Review/After to resize the panes — the width is remembered between sessions. Inside a tree, drag the line between column headers (e.g. between *Folder* and *Files*) to resize those columns too.

---

## Contents

1. [Quick start](#quick-start)
2. [Step 1: Scan the drive with robocopy](#step-1-scan-the-drive-with-robocopy)
3. [Step 2: Write the target structure in markdown](#step-2-write-the-target-structure-in-markdown)
4. [Step 3: Convert both files to JSON and load them](#step-3-convert-both-files-to-json-and-load-them)
5. [Step 4: Review every folder](#step-4-review-every-folder)
6. [Colour legend](#colour-legend)
7. [Staleness and folder contents (optional)](#staleness-and-folder-contents-optional)
8. [Saving and resuming](#saving-and-resuming)
9. [Step 5: Export](#step-5-export)
10. [Building from source](#building-from-source)
11. [Known limitations](#known-limitations)

---

## Quick start

1. Scan the drive with robocopy to get `listing.txt`. See [Step 1](#step-1-scan-the-drive-with-robocopy).
2. Write your intended structure as an indented markdown file. See [Step 2](#step-2-write-the-target-structure-in-markdown).
3. Open `dist/index.html` in **Chrome** by double-clicking it. No server or install is needed.
4. In **☰ Menu**, choose **Convert robocopy to JSON**, then **Convert structure MD to JSON**. Each one downloads a `.json` file.
5. Choose **Open source.json…**, then **Load target structure…**.
6. Review every folder and mark each one Reviewed. The mini progress bar in the toolbar shows how far along you are.
7. Choose **Export…** to get the `.bat` script and the log.

Optionally, once `source.json` is open, load a folder-facts CSV or two (**☰ Menu → Load folder facts…** / **Load file-type breakdown…**) for staleness and contents info in the Before pane and Review panel — see [Staleness and folder contents](#staleness-and-folder-contents-optional). Remember to **Save source.json…** afterward if you want to keep it.

Only the `dist/` folder needs to be copied to the office machine.

---

## Step 1: Scan the drive with robocopy

Robocopy's list-only mode (`/L`) prints every folder and its file count without copying anything. The destination is deliberately a path that does not exist, so every folder is reported as a `New Dir`.

```bat
robocopy "G:\Marketing" "Q:\__listonly__\" /L /E /NFL /NJH /NJS /NP /UNILOG:listing.txt
```

| Flag | Why it is there |
|---|---|
| `/L` | List only. Nothing is copied, moved or deleted. |
| `/E` | Include all subfolders, including empty ones. |
| `/NFL` | Don't list individual files. This keeps the output small. |
| `/NJH` `/NJS` | Leave out the job header and summary. |
| `/NP` | No progress percentages. |
| `/UNILOG:listing.txt` | Write the log as UTF-16, so accented and non-Latin folder names survive. The importer expects this. |

**Do not add `/NS` or `/NC`.** They strip the file count or the `New Dir` label from each line. The importer needs both. The file count is what powers the *Files* column and the "empty" detection.

Notes:

- Robocopy will print `ERROR 3 … Getting File System Type of Destination` and exit with a non-zero code. This is expected, because `Q:\__listonly__\` doesn't exist. The importer skips those lines.
- The first folder listed is treated as the scan root (here `G:\Marketing`). It does not appear as a folder in the tree.
- If you truncate or redact a scan, any missing ancestor folders are created automatically as placeholders. Their file count shows as `?`.

### Converting the listing to `source.json`

**In the browser (works on a locked-down office PC):** open the app, then **☰ Menu → Convert robocopy to JSON**, pick `listing.txt`, and a `source.json` is downloaded.

**With Node (at home):**

```bat
node tools/import-robocopy.mjs --in listing.txt --out source.json
node tools/import-robocopy.mjs --in listing.txt --out source.json --root "G:\Marketing"
```

Use `--root` if the first line of the listing isn't the folder you want as the root.

Both routes use the same parser (`src/model/robocopyImport.js`), so they give identical results.

---

## Step 2: Write the target structure in markdown

The target structure is the skeleton of what you want to end up with. Write it as an indented markdown file. It appears in the After pane as empty **purple** folders, which you then fill with real folders from the Before pane.

```markdown
## Auto Financing
  / 01 - Shortcut to EdenPark brand documents
  / 02 - Strategy
    / 2026 Planning
    / Personas
  / Marketing Automation
    / Promotional
      / [Campaign name] ie. IQ Abandoned Cart
        / [Variation] ie. 2605_MayNoPay
  / Events
  / Website
    / Content
    / Creative

## Credit Cards
  / Home Trust Equityline Visa
  / Home Trust Preferred Visa

## Cross-Functional
  / Same as current
```

The format is strict about a few things:

| Rule | Detail |
|---|---|
| **Headings are top-level folders** | Any line starting with `#` to `######` starts a new top-level folder (a "department"). The heading level makes no difference. |
| **Folders are `/ Name` lines** | The `/` marks a folder. |
| **Indent with spaces, 2 per level** | 2 spaces is a direct child of the heading, 4 spaces is a grandchild, and so on. Tabs are an error. |
| **One level at a time** | You can't jump from 2 spaces straight to 6. |
| **Sibling names must be unique** | The check ignores case, because Windows does too. |
| **Bold and italics are stripped** | `**/ Name**` is the same as `/ Name`. Use bold if it helps you read the file. |
| **Everything else is ignored** | Blank lines, prose, and `<!-- comments -->` are skipped, so you can leave notes in the file. |

If anything is wrong, the converter reports the exact line number rather than silently putting a folder in the wrong place. See [tools/target-structure-example.md](tools/target-structure-example.md) for a worked example.

### Converting to JSON

**In the browser:** **☰ Menu → Convert structure MD to JSON**, pick your `.md` file, and `target-structure.json` is downloaded.

**With Node:**

```bat
node tools/build-target-structure-from-markdown.mjs --in structure.md --out target-structure.json
```

The Node version also prints the resulting full paths so you can check them.

---

## Step 3: Convert both files to JSON and load them

1. **☰ Menu → Open source.json…** and pick the file from Step 1. The Before tree appears and the After tree starts as a copy of it.
2. **☰ Menu → Load target structure…** and pick `target-structure.json`. The purple skeleton folders appear in the After tree.

Loading a target structure **adds** to the tree. Loading the same file twice duplicates the skeleton. If you've loaded a bad one, use **Reset workspace** and start again.

The After tree also contains two special folders, `_TRASH` and `_PENDING`, which always sort last. See [Trash and Pending](#trash-and-pending).

---

## Step 4: Review every folder

The goal is to get every folder in the Before pane to a decided state (*reviewed*). The progress bar tracks that. Folders you never touch stay where they are, and their children follow them.

### The basic loop

1. **Click a folder in the Before pane.** The Review panel shows its source path, its destination path, its status, its direct file count and how many descendants it has. By default the 🔗 link toggle on the Before pane also jumps the After pane to where that folder currently sits.
2. **Click a destination in the After pane.** This is only browsing. It sets the *Target / Destination Folder* in the Review panel and doesn't change which folder is under review. The 🔗 toggle on the After pane makes it also highlight the source in the Before pane. It is off by default.
3. **Act on it** using the buttons below, or drag the folder in the After pane.
4. **Mark it Reviewed** (or let the action do it for you, see below) and move on.

Anything you don't touch moves with its parent. If you move `Finance` to a new place, everything inside it goes along with no extra work. Only folders you explicitly change produce commands in the export.

### What you can do to a folder

| Action | How |
|---|---|
| **Move it** | Select it in Before, click the destination in After, then click **Move Here**. Or drag it onto a folder in the After tree. |
| **Rename it** | Edit **Folder Name** in the Review panel (press Enter or click away to apply). Or, in the After tree, click an already-selected folder again (feels like a double-click) or press **F2**. |
| **Fill a target-structure slot with it** | Select the real folder in Before, click the purple slot in After, then click **These Are Equivalent**. See below. |
| **Create a new folder** | Click the **➕** button beside the After pane's 🔗 link toggle. It's created under whichever folder is selected in the After tree (top-level if none is), and immediately opens for renaming — type the name and press Enter. |
| **Delete it** | **Delete (move to Trash)**. Nothing is really deleted. See below. |
| **Detach it** | **Detach (no inherited move)**. Use this when a parent is moving but this child shouldn't go along. It parks the folder in `_PENDING` until you decide. **Undo Detach** reverses it. |
| **Undo your changes to it** | **Revert to original**, or **Restore** if it is in the Trash. |
| **Add a note** | Type in **Note**. |

A folder's **Status** badge shows what has happened to it: unchanged, renamed, moved, moved + renamed, deleted (in Trash), new, or pending.

The tool blocks or reports:

- moving a folder into itself or one of its own descendants
- two sibling folders with the same name (case-insensitive)
- illegal Windows names (`< > : " / \ | ? *`, trailing dot or space, `CON`, `NUL`, `COM1`, and so on)

There is **no path-length check** yet. Watch for deep destinations, because Windows has a 260-character limit.

### "These Are Equivalent"

This is for the common case where the folder you want already exists, just somewhere else or under a slightly different name.

- The **real folder takes the skeleton folder's place** in the After tree.
- Any children of the skeleton folder are re-parented under the real folder.
- **Children with the same name are merged automatically.** A real `Events` folder and a skeleton `Events` folder become one, and the merged child is shown as *covered*, not blocked.
- The real folder keeps its purple tint, so you can still see that it fills a slot.

Merging two arbitrary real folders (not skeleton and real) is not supported. A name collision between real folders is an error.

### Trash and Pending

- **`_TRASH`**: "Delete" moves the folder here, with its ID added to the name (`Old__F000123`) so duplicates can't clash. Everything under the folder goes with it. The Review panel warns you how many descendants are affected. Move anything you want to keep out first. **The export does not generate any delete command.** Trashed folders are only listed, so a person can review them and delete them deliberately later.
- **`_PENDING`**: a holding area for "I don't know yet". Pending folders are **not** included in the move script. They are listed in the log so you can see what is still unresolved.

### Reviewed, Default, Flag for Follow-Up

The radio buttons at the bottom of the Review panel set a folder's review state:

| Choice | Meaning |
|---|---|
| **Default** | Not reviewed yet. |
| **Reviewed** | You have made a decision on this folder. |
| **Flag for Follow-Up** | You are deliberately postponing this one. Come back to it. |

Moving, trashing or making a folder equivalent **automatically marks it Reviewed** and clears any flag. Detaching does not, on purpose, because the folder still needs a decision.

Marking a folder Reviewed also makes all of its descendants show as **covered**. You have decided where the parent goes, so its contents follow, and you don't need to click through every subfolder.

### Progress

**☰ Menu → Progress…**, or click the mini bar in the toolbar, shows the split between reviewed, flagged, covered and unreviewed folders. The colours match the legend below.

---

## Colour legend

Folder colours are the standard yellow folder icon, tinted by review state. Use them to see at a glance what still needs attention.

### Before pane

| Icon | Meaning |
|---|---|
| 🟥 **Red** | **Unreviewed.** It hasn't been touched, so it needs attention. |
| 🟩 **Green** | **Reviewed.** You have acted on it or decided about it. It should be good to go. |
| 🟦 **Blue** (slightly faded) | **Covered.** It isn't reviewed itself, but one of its ancestors is. It moves with that ancestor, so it is probably going where it should, though nobody has looked at it specifically. |
| 🟧 **Orange** | **Flagged for follow-up.** You postponed the decision on purpose. Flagging shows in the Before pane only. |
| ▫️ **Faded, with "— empty"** | **Empty.** The folder and every folder beneath it contain no files at all. This layers on top of the other colours, so an empty folder can also be red, yellow and so on. It relies on the file counts from the robocopy scan. |
| 🟫 **Left border + "⧗"** | **Stale.** Nothing in this folder's subtree was written to more recently than the adjustable threshold. Only appears once folder-facts data is loaded — see [Staleness and folder contents](#staleness-and-folder-contents-optional). |

### After pane

The After pane uses the same yellow (reviewed) and blue (covered) as the Before pane. The differences are:

| Icon | Meaning |
|---|---|
| ⬜ **Grey, italic title** | **Unchanged and unreviewed.** It is where it will end up if you do nothing. These are the folders you are looking to find destinations for. This is the After pane's equivalent of red in the Before pane. |
| 🟪 **Purple** | **Part of the target structure.** Either an empty slot from your markdown file, or a real folder that has since been put into a slot. The exception is a real folder in a slot that is still unreviewed, which shows grey. |
| 🗑️ | The `_TRASH` bucket. |
| 📥 | The `_PENDING` bucket. |

The After pane does not show orange for flagged folders. Use the Before pane for that.

### Progress bar

| Colour | Meaning |
|---|---|
| 🟩 Green | Reviewed |
| 🟧 Orange | Flagged |
| 🟦 Blue | Covered |
| 🟥 Red | Unreviewed |

### Status badge in the Review panel

| Badge | Status |
|---|---|
| Grey | Unchanged, or the Trash / Pending bucket itself |
| Light blue | Renamed |
| Light orange | Moved, or moved + renamed |
| Light red | Deleted (in Trash) |
| Light green | New folder |
| Light yellow | Pending |

### Other columns

- **Files** shows the number of files directly in that folder. `?` means the count is unknown, for example on an auto-created placeholder folder.
- **Status** (After pane only) shows what has changed for that folder, as above.

---

## Staleness and folder contents (optional)

This whole section is extra. Nothing here is required for the core planning workflow, and the tool works exactly the same without it — the capability to read this data is additional, not required.

If you also have a scan from a separate drive-facts PowerShell pipeline (a folder **rollup CSV**, e.g. `dirfacts-rollup-<stamp>.csv`, and/or a **file-type breakdown CSV**, e.g. `extlong-<stamp>.csv`), you can load it in to see which folders look stale and what's actually inside them. This is not something this tool produces — it comes from elsewhere (`Get-DriveFacts.ps1` / `Invoke-DirRollup.ps1`, outside this repo). The paths in those CSVs must match the paths in your loaded `source.json` exactly; if they were scanned from a different root, re-scan with robocopy so the two line up.

### Loading it

**☰ Menu → Load folder facts (rollup CSV)…** and/or **☰ Menu → Load file-type breakdown (CSV)…**. Either can be loaded on its own; they're independent and usually come from different scan runs.

Each file's scan time is read from its own filename (`...-20260929-233732.csv` → scanned 2026-09-29 23:37:32). Loading a file older than what's already loaded asks you to confirm before overwriting the newer data.

**Loading only affects the current session.** Merging a CSV in does not save anything to disk by itself — you must choose **☰ Menu → Save source.json…** afterward to keep it. Refreshing the page or reopening the source without saving first loses it, the same as any other unsaved change.

### What it adds

- **Before pane:** a folder whose most recent write anywhere in its subtree is older than the threshold gets a left border and a small "⧗" mark on its title — see the [colour legend](#colour-legend).
- **Toolbar:** a **Stale after [ ] days** box appears once folder-facts data is loaded. Change it any time — every folder re-checks immediately, no reload needed. Starts at 1095 days (3 years).
- **Review panel:** a **Folder contents** section appears for any folder with loaded data, showing:
  - Direct size (just this folder), and, if the rollup CSV included it, the whole subtree's size.
  - How long since anything in the subtree was last written to, and whether that's past the stale threshold.
  - Up to 8 file types sitting directly inside the folder, as icons sorted by size, with the file count and size under each. This is always the folder's **direct contents only** — there is no subtree/recursive version of this breakdown.
- A **⚠ partial facts scan** warning appears in the toolbar if either loaded file came from an interrupted scan. Treat the staleness figures as a lower bound, not a reliable "nothing's happening here" signal, until a full re-scan replaces it.

A folder with no match in the loaded data (not scanned, or inaccessible during the scan) just shows nothing extra — missing facts data is never treated as "zero" or an error.

### Adding new file-type icons

Each file type gets its own CSS class (e.g. `.pdf` → `ext-pdf`), falling back to a generic icon ([file.svg](src/icons/svg/file.svg)) for any type that doesn't have one assigned yet. To give a new type its own icon:

1. Drop an SVG into `src/icons/svg/`.
2. Add one rule to `src/styles.css`, next to the existing ones:
   ```css
   .facts-ext-icon.ext-mov { background-image: url("icons/svg/mov.svg"); }
   ```
3. Rebuild (`node build.mjs`).

`.docx`/`.xlsx`/`.pptx` already map to the same icon as `.doc`/`.xls`/`.ppt`. Any other variant (e.g. `.pptm`) needs its own rule, named after its own extension.

---

## Saving and resuming

- **💾** (beside the menu) and **☰ Menu → Save plan** write `plan.json`. The plan stores only your changes, not a full copy of the tree, so it is small. It also records which source it belongs to, and refuses to load against the wrong one.
- **☰ Menu → Save source.json…** writes the current source back out, including any folder-facts data you've merged in (see [Staleness and folder contents](#staleness-and-folder-contents-optional)). This is the only way that data survives a refresh — merging a CSV in on its own doesn't save anything.
- The toolbar shows **unsaved changes** or **saved** at the right.
- **Autosave:** the app keeps a crash-protection copy in the browser's IndexedDB. It is stored per browser profile, so it is not shared between machines. If you come back after a crash, the app offers to restore it. If your browser has no remembered files, a **Resume last session** banner appears.
- **Remembered files:** in Chrome and Edge the app remembers the `source.json`, plan and target-structure files you have opened. The next time you open the page it reloads the source and plan automatically. The target structure is never auto-loaded, because that would duplicate it. After a browser restart Chrome may ask you to click once to re-grant access. The button then reads **Re-open <filename>…**.
- **Open plan…** loads a saved plan (the source must be loaded first). **New plan** discards the current plan.
- **Reset workspace** unloads the source and target structure and makes the app forget their remembered files, so you can pick different ones. It keeps the remembered plan file.
- **`dist/config.js`** holds three optional labels (`sourcePath`, `planPath`, `targetStructurePath`) that appear as button tooltips. They are labels only, because a browser can't silently read a path. The build never overwrites this file once it exists.

Use Chrome. Remembered files rely on the File System Access API. Firefox still works through the autosave and the file-picker fallback.

---

## Step 5: Export

**☰ Menu → Export…** shows a summary of what will be produced, with three downloads:

| File | What it is |
|---|---|
| **`migrate.bat`** | A robocopy script that carries out the moves. |
| **`migration-log.html`** | A searchable page: type an old or new folder name to find "this used to be here, where is it now?" It works offline. |
| **`migration-log.csv`** | The same log for Excel: Old Path, New Path, Status. |

### About `migrate.bat`

- The script contains one `robocopy … /E /MOVE` command per folder that needs its own move. Folders that move with their parent don't need one.
- Commands run **deepest source folder first**, so a child that is leaving its parent gets moved out before the parent is moved.
- New empty folders from your target structure are created with `mkdir`.
- The script asks you to **type `YES`** before it does anything.
- It writes `migration-log.txt` (the full robocopy log) and `migration-errors.txt` (any failed moves) next to the script, and carries on past failures instead of stopping.
- Trashed and pending folders are **not acted on**. There is no delete command. Use the log to review those lists.
- `/MOVE` deletes each source folder after its contents have been copied. **This changes the real drive.**

Before you run it on the real share:

1. **Try it on a small copied subtree first.** Long-path behaviour on the real share hasn't been tested yet.
2. Do a dry run by adding `/L` to `ROBO_OPTS` at the top of the script, then read the log.
3. To preserve NTFS permissions and ownership, consider adding `/SEC` or `/COPYALL` to `ROBO_OPTS`. Also find out who owns access control before you start.
4. Everything must be on **one share or volume**, so the moves are renames and not copy-and-delete.

---

## Building from source

Only needed if you change the code. Building needs Node, and the office machine doesn't need it.

```bat
npm install
node build.mjs          # or: npm run build
```

`build.mjs` bundles `src/main.js` and the pinned Wunderbaum 0.14.1 into `dist/app.js` and `dist/app.css`, and copies `src/index.html` and the icons. The result is an IIFE bundle with no external dependencies, so it works from `file://` (browsers block ES modules there). Refresh the open browser tab after a rebuild.

```
src/model/     store.js (core model), validate.js, io.js, export.js,
               robocopyImport.js, targetStructureMarkdown.js,
               csv.js, folderFacts.js (folder-facts CSV parsing)
src/ui/        trees.js, editor.js, progress.js, exportModal.js,
               paneResize.js, staleThreshold.js
src/icons/svg/ file-type icons for the folder-contents panel -- file.svg is
               the fallback; see "Adding new file-type icons" above
src/           main.js, index.html, styles.css, config.js
tools/         import-robocopy.mjs, build-target-structure-from-markdown.mjs,
               target-structure-example.md, make-test-data.mjs
dist/          the built app: the only folder you carry to the office
```

File-type icons are referenced from `styles.css` as plain `url("icons/svg/....svg")` paths, copied into `dist/` as-is (not run through esbuild's bundler — see `build.mjs`'s `external: ["*.svg"]`). Dropping in a new icon never needs a `build.mjs` change, just a CSS rule.

`npm run make-test-data` generates a synthetic large dataset (about 100,000 folders) for performance testing.

Tree colours and other visual styling live in `src/styles.css`. Edit it with targeted changes, because it includes a hand-written custom section.

---

## Known limitations

- There is no path-length (260-character) validation yet.
- Renaming a folder doesn't re-sort its siblings in the After tree until that branch reloads.
- The CSV and HTML logs don't yet have a "flagged" column or an "empty folders" filter.
- Merging two arbitrary real folders isn't supported. Only same-named children are merged, when you use **These Are Equivalent**.
- Each plan is a single-editor, single-file affair.
- The file-type breakdown is always the folder's direct contents only; there's no subtree/recursive version, since the scan that produces it doesn't compute one.
- A folder that is both stale and empty currently shows only the "⧗" stale mark on its title, not the "— empty" label — both share the same spot on the title text.
