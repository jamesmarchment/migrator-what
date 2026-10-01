import "./styles.css";
import { createStore } from "./model/store.js";
import * as io from "./model/io.js";
import { mountBefore, mountAfter, reveal } from "./ui/trees.js";
import { mountEditor } from "./ui/editor.js";
import { mountProgressModal, mountMiniProgressBar } from "./ui/progress.js";
import { mountExportModal } from "./ui/exportModal.js";
import { mountEditorPaneResize } from "./ui/paneResize.js";
import { mountStaleThresholdControl } from "./ui/staleThreshold.js";
import { formatStamp } from "./model/folderFacts.js";
import { checkSiblingCollision } from "./model/validate.js";

// See config.js: paths there are labels only (a file:// page can't read an
// arbitrary path with zero clicks). Real "auto-load on open" comes from the
// browser remembering whichever file you actually pick/save via the buttons
// below -- see io.js's peekTracked/openTracked for how that works.
const CONFIG = window.FOLDER_MIGRATOR_CONFIG ?? {};
const JSON_TYPES = [{ description: "JSON", accept: { "application/json": [".json"] } }];

const store = createStore();
// linkBefore/linkAfter: each pane's own link-toggle button -- while true, selecting
// a folder in that pane reveals its counterpart in the other pane. Before starts
// linked (reviewing a folder shows where it currently sits in the After tree);
// After starts unlinked (browsing the After tree for a move target shouldn't yank
// the Before tree's highlight around).
const refs = { before: null, after: null, syncing: false, linkBefore: true, linkAfter: false };
let editorApi = null;
let progressApi = null;
let exportApi = null;
let treesMounted = false;

const $ = (id) => document.getElementById(id);
const saveIndicator = $("save-indicator");

if (CONFIG.sourcePath) $("btn-open-source").title = `Configured: ${CONFIG.sourcePath}`;
if (CONFIG.planPath) {
  $("btn-open-plan").title = `Configured: ${CONFIG.planPath}`;
  $("btn-save-plan").title = `Configured: ${CONFIG.planPath}`;
  $("btn-save-plan-toolbar").title = `Configured: ${CONFIG.planPath}`;
}
if (CONFIG.targetStructurePath) $("btn-load-structure").title = `Configured: ${CONFIG.targetStructurePath}`;

function setupLinkToggle(buttonId, refsKey) {
  const btn = $(buttonId);
  btn.setAttribute("aria-pressed", String(refs[refsKey]));
  btn.addEventListener("click", () => {
    refs[refsKey] = !refs[refsKey];
    btn.setAttribute("aria-pressed", String(refs[refsKey]));
  });
}
setupLinkToggle("link-toggle-before", "linkBefore");
setupLinkToggle("link-toggle-after", "linkAfter");

// "New folder" (see index.html's #btn-create-folder-after, next to the After
// pane's link-toggle): renaming already works by double-clicking a folder in
// the After tree (trees.js's `edit: { trigger: ["clickActive", "F2"] }`), so
// this button just needs to create something and hand off straight into that
// same rename box -- no separate name-entry UI of its own (this replaced the
// old "Create New Folder" box in the editor panel, which asked for the name
// up front instead).
function uniqueNewFolderName(parentKey, base = "New folder") {
  let name = base;
  for (let n = 2; checkSiblingCollision(store, parentKey, name, null); n++) {
    name = `${base} (${n})`;
  }
  return name;
}
$("btn-create-folder-after").addEventListener("click", async () => {
  if (!treesMounted) {
    window.alert("Load source.json first.");
    return;
  }
  // Defaults to wherever is currently active in the After tree; falls back
  // to top-level for nothing selected yet, or for the Trash/Pending buckets,
  // which aren't a real destination to create a folder inside of.
  const activeNode = refs.after?.getActiveNode();
  const parentKey =
    activeNode && activeNode.key !== store.TRASH && activeNode.key !== store.PENDING ? activeNode.key : store.ROOT;
  const newId = store.createFolder(parentKey, uniqueNewFolderName(parentKey));
  if (refs.after) {
    await reveal(refs.after, store.destAncestorChain(newId), refs);
    refs.after.findKey(newId)?.startEditTitle();
  }
});

// Toolbar actions live in a hamburger dropdown instead of a bare row of
// buttons -- same elements/ids/click handlers as before, just tucked away
// until asked for, since a row of 7 buttons next to the resume banner was
// exactly the "too many buttons, unclear what to click" clutter that came up
// earlier. save-indicator stays outside the menu since it's a status readout,
// not an action, and should be glanceable without opening anything.
function setupToolbarMenu() {
  const btn = $("btn-menu");
  const menu = $("toolbar-menu");
  const submenus = [...menu.querySelectorAll(".menu-submenu")].map((wrap) => ({
    trigger: wrap.querySelector(".menu-submenu-trigger"),
    panel: wrap.querySelector(".menu-submenu-panel"),
  }));

  function closeSubmenus() {
    for (const { trigger, panel } of submenus) {
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }
  }
  function closeMenu() {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    closeSubmenus(); // so reopening the menu never shows a submenu left open from last time
  }
  function toggleMenu() {
    const opening = menu.hidden;
    menu.hidden = !opening;
    btn.setAttribute("aria-expanded", String(opening));
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  // Each submenu trigger (Convert…, Load facts data…) just opens/closes its
  // own flyout panel -- it's excluded from the "any button closes the whole
  // menu" delegate below, and only one submenu is open at a time, same as a
  // native nested menu.
  for (const { trigger, panel } of submenus) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = panel.hidden;
      closeSubmenus();
      panel.hidden = !opening;
      trigger.setAttribute("aria-expanded", String(opening));
    });
  }
  // Any action inside the menu closes it -- delegated so it covers every
  // current (and future) menu button without wiring each one individually.
  // Submenu triggers are excluded (handled above); their own action buttons
  // (e.g. "Convert robocopy to JSON") still close everything on click, same
  // as a top-level item.
  menu.addEventListener("click", (e) => {
    if (e.target.closest(".menu-submenu-trigger")) return;
    if (e.target.closest("button")) closeMenu();
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !e.target.closest(".menu-wrap")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) closeMenu();
  });
}
setupToolbarMenu();

// Editor pane width is adjustable regardless of whether a source is loaded
// yet -- the pane and its resizer bars exist in the DOM from page load.
mountEditorPaneResize({
  editorPane: $("editor-pane"),
  leftHandle: $("resize-before-editor"),
  rightHandle: $("resize-editor-after"),
});

let lastExplicitActionAt = 0;
function setIndicator(text, dirty, { explicit = false } = {}) {
  if (explicit) lastExplicitActionAt = Date.now();
  // Don't let a debounced background autosave stomp a just-shown explicit
  // save/open/new-plan message before the user has had a chance to read it.
  if (!explicit && Date.now() - lastExplicitActionAt < 2000) return;
  saveIndicator.textContent = text;
  saveIndicator.classList.toggle("dirty", !!dirty);
}

// Before-tree clicks pick "the folder under review"; After-tree clicks are
// navigation only and just update the Move Here target (see ui/editor.js).
function onActivate(id, source) {
  if (source === "after") editorApi?.setMoveTarget(id);
  else editorApi?.show(id);
}

function mountTreesOnce() {
  if (treesMounted) return;
  mountBefore($("tree-before"), store, refs, onActivate);
  mountAfter($("tree-after"), store, refs, onActivate);
  editorApi = mountEditor($("editor"), store, refs);
  progressApi = mountProgressModal(store);
  mountMiniProgressBar($("mini-progress-bar"), store, { onClick: () => progressApi.open() });
  exportApi = mountExportModal(store);
  mountStaleThresholdControl($("stale-threshold-control"), $("stale-threshold-days"), store);
  store.subscribe((event) => {
    if (event.type === "reset") {
      setIndicator("plan reset", false);
    } else if (event.type !== "noop") {
      setIndicator("unsaved changes", true);
    }
    if (event.type === "reset" || event.type === "facts-changed") {
      const status = store.factsStatus();
      $("facts-partial-warning").hidden = !(status.factsPartial || status.extensionsPartial);
    }
  });
  io.initAutosave(store, {
    onSaved: () => setIndicator("autosaved (crash protection)", true),
  });
  treesMounted = true;
}

function applyLoadedSource(json, indicatorText) {
  store.init(json);
  mountTreesOnce();
  $("btn-open-source").disabled = true;
  $("btn-open-source").title = "Click Reset workspace first to load a different source.json";
  $("btn-save-source").disabled = false;
  $("btn-reset-workspace").disabled = false;
  setIndicator(indicatorText, false, { explicit: true });
  $("resume-banner").hidden = true;
}

async function loadSourceIntoStore(file) {
  const json = await io.loadSourceFromFile(file);
  applyLoadedSource(json, `loaded ${json.folders.length} folders from source`);
}

// Clears the current session back to a blank slate, in place (no page reload,
// which would just race the startup auto-load into silently bringing the same
// source right back -- see store.js's unload()). Also forgets the remembered
// "source" and "target-structure" file handles, so a click on "Open
// source.json…" / "Load target structure…" afterward shows a fresh picker
// instead of silently re-reading the same (possibly broken) file again --
// "wipe the slate clean and use a new file instead" for when one of those
// turns out to have an error in it. Deliberately does NOT forget "plan": the
// point of resetting is to swap out a bad source/target-structure, not to
// lose the ability to resume a saved plan once a corrected one is loaded.
async function resetWorkspace() {
  if (!treesMounted) return;
  if (
    !window.confirm(
      "Reset the workspace? This clears the loaded source and discards any unsaved plan, and forgets the " +
        "remembered source.json / target-structure files so you can pick different ones. Your saved plan.json " +
        "is not affected."
    )
  ) {
    return;
  }
  store.unload();
  await io.forgetTracked(["source", "target-structure"]);
  $("btn-open-source").disabled = false;
  $("btn-open-source").title = "";
  $("btn-save-source").disabled = true;
  $("btn-reset-workspace").disabled = true;
  $("btn-load-structure").textContent = "Load target structure…";
  $("btn-load-structure").title = "";
  setIndicator("no source loaded", false, { explicit: true });
}
$("btn-reset-workspace").addEventListener("click", resetWorkspace);

async function maybeOfferAutosaveRecovery() {
  const autosaved = await io.loadAutosavedPlan();
  if (autosaved && autosaved.sourceHash === store.sourceHash) {
    if (window.confirm("Found an autosaved plan from a previous session. Restore it?")) {
      store.loadPlan(autosaved);
      setIndicator("restored autosaved plan", true, { explicit: true });
    }
  }
}

// After (re-)loading source from a real click, silently chain into resuming a
// remembered plan.json too -- the click's user gesture covers both permission
// regrants, so this is what makes "click yes once" reopen the whole session
// rather than needing a second, separate click on "Open plan…". Only falls
// back to the autosave-crash-recovery prompt when there's no remembered plan
// file at all (or resuming it didn't pan out).
async function tryResumePlan() {
  const planInfo = await io.peekTracked("plan");
  if (planInfo.status === "none") {
    await maybeOfferAutosaveRecovery();
    return;
  }
  try {
    const file = await io.openTracked("plan", { types: JSON_TYPES });
    if (!file) {
      await maybeOfferAutosaveRecovery();
      return;
    }
    const json = await io.loadPlanFromFile(file);
    store.loadPlan(json);
    setIndicator("plan loaded", true, { explicit: true });
  } catch (err) {
    console.warn("Could not resume remembered plan.json:", err);
    await maybeOfferAutosaveRecovery();
  }
}

async function openSource() {
  try {
    const file = await io.openTracked("source", { types: JSON_TYPES, fallbackInputEl: $("file-input-source") });
    if (!file) return;
    await loadSourceIntoStore(file);
    await tryResumePlan();
  } catch (err) {
    window.alert(`Could not load source.json: ${err.message}`);
  }
}
$("btn-open-source").addEventListener("click", openSource);

// The resume banner (see tryAutoLoadOnStartup) is just a second, more obvious
// entry point onto the exact same "open source.json" action -- it exists
// because on a browser without the File System Access API (Firefox, Safari),
// "Open source.json…" never relabels itself or hints that anything's
// remembered, so a returning user has no visible reason to trust that clicking
// it will bring their plan back too. The banner names that out loud instead of
// relying on a plain, generic-looking button among several others.
$("btn-resume-banner").addEventListener("click", () => {
  $("resume-banner").hidden = true;
  openSource();
});
$("btn-dismiss-banner").addEventListener("click", () => {
  $("resume-banner").hidden = true;
});

// Converts a raw robocopy /L listing straight to a downloaded source.json,
// entirely client-side -- see model/robocopyImport.js. This is what makes the
// tool usable on a locked-down office machine that can't run tools/import-
// robocopy.mjs (no Node available there): bring the .txt scan, not a
// pre-converted source.json.
//
// Deliberately does NOT load the result into the live session (that's what
// "Open source.json…" + the file this produces is for) -- it used to, but
// that meant it only worked when nothing was loaded yet, which the auto-
// resume/remembered-source machinery made awkward to arrange on purpose (the
// whole point of that machinery is to make a loaded session the default).
// This way it's just a converter, available regardless of session state.
//
// Uses pickFileOnce, not openTracked -- this is a stateless, repeatable
// utility (pick a listing, get a JSON), not an ongoing file you keep coming
// back to, so it should never get "stuck" remembering the first .txt you ever
// converted and silently re-reading that one forever.
$("btn-import-robocopy").addEventListener("click", async () => {
  try {
    const file = await io.pickFileOnce({
      types: [{ description: "Robocopy listing", accept: { "text/plain": [".txt"] } }],
      fallbackInputEl: $("file-input-robocopy"),
    });
    if (!file) return;
    const { json, stats } = await io.loadRobocopyFromFile(file);
    const extras = [
      stats.inferredCount ? `${stats.inferredCount} inferred` : null,
      stats.skippedLines ? `${stats.skippedLines} line(s) skipped` : null,
    ].filter(Boolean);
    io.downloadBlob("source.json", JSON.stringify(json, null, 2), "application/json");
    setIndicator(
      `converted ${stats.folderCount} folders to source.json` + (extras.length ? ` (${extras.join(", ")})` : ""),
      false,
      { explicit: true }
    );
  } catch (err) {
    window.alert(`Could not convert robocopy listing: ${err.message}`);
  }
});

// Same pattern as "Convert robocopy to JSON" -- a stateless converter (picks a
// file every time via pickFileOnce, never remembers it, never touches the
// live session), just for the target-structure markdown format instead (see
// model/targetStructureMarkdown.js / tools/target-structure-example.md).
$("btn-convert-structure-md").addEventListener("click", async () => {
  try {
    const file = await io.pickFileOnce({
      types: [{ description: "Target structure markdown", accept: { "text/markdown": [".md"] } }],
      fallbackInputEl: $("file-input-structure-md"),
    });
    if (!file) return;
    const { json, stats } = await io.loadTargetStructureMarkdownFromFile(file);
    io.downloadBlob("target-structure.json", JSON.stringify(json, null, 2), "application/json");
    setIndicator(
      `converted ${stats.departmentCount} department(s), ${stats.folderCount} folder(s) to target-structure.json` +
        (stats.skippedLines ? ` (${stats.skippedLines} line(s) skipped)` : ""),
      false,
      { explicit: true }
    );
  } catch (err) {
    window.alert(`Could not convert target structure markdown: ${err.message}`);
  }
});

// Merges optional folder-facts data (see model/folderFacts.js and "test
// data/handoff_copilot.md") straight into the live source, not just a
// download -- unlike the two converters above, there's no separate JSON
// output step: the merge IS the result, and "Save source.json…" is what
// persists it. A one-shot picker (pickFileOnce), not a remembered handle --
// the user's own data model here is "merge it in and stamp it", carried
// forward by the saved source.json itself, not by re-reading the same CSV
// file every session.
$("btn-load-dirfacts").addEventListener("click", async () => {
  if (!treesMounted) {
    window.alert("Load source.json first.");
    return;
  }
  try {
    const file = await io.pickFileOnce({
      types: [{ description: "Folder facts CSV", accept: { "text/csv": [".csv"] } }],
      fallbackInputEl: $("file-input-dirfacts"),
    });
    if (!file) return;
    const result = await io.loadDirFactsFromFile(file);
    const current = store.factsStatus().factsStamp;
    if (result.stamp && current && result.stamp < current) {
      const proceed = window.confirm(
        `Already-merged facts data is from a newer scan (${formatStamp(current)}) than the file you just picked ` +
          `(${formatStamp(result.stamp)}). Load it anyway and overwrite the newer data?`
      );
      if (!proceed) return;
    }
    store.mergeFacts(result.byPath, result);
    setIndicator(
      `merged folder facts for ${result.byPath.size} folder(s)${result.isPartial ? " -- PARTIAL SCAN" : ""}`,
      true,
      { explicit: true }
    );
  } catch (err) {
    window.alert(`Could not load folder facts CSV: ${err.message}`);
  }
});

$("btn-load-extlong").addEventListener("click", async () => {
  if (!treesMounted) {
    window.alert("Load source.json first.");
    return;
  }
  try {
    const file = await io.pickFileOnce({
      types: [{ description: "File-type breakdown CSV", accept: { "text/csv": [".csv"] } }],
      fallbackInputEl: $("file-input-extlong"),
    });
    if (!file) return;
    const result = await io.loadExtLongFromFile(file);
    const current = store.factsStatus().extensionsStamp;
    if (result.stamp && current && result.stamp < current) {
      const proceed = window.confirm(
        `Already-merged file-type data is from a newer scan (${formatStamp(current)}) than the file you just ` +
          `picked (${formatStamp(result.stamp)}). Load it anyway and overwrite the newer data?`
      );
      if (!proceed) return;
    }
    store.mergeExtensions(result.byPath, result);
    setIndicator(
      `merged file-type breakdown for ${result.byPath.size} folder(s)${result.isPartial ? " -- PARTIAL SCAN" : ""}`,
      true,
      { explicit: true }
    );
  } catch (err) {
    window.alert(`Could not load file-type breakdown CSV: ${err.message}`);
  }
});

$("btn-save-source").addEventListener("click", async () => {
  if (!treesMounted) {
    window.alert("Load a source first.");
    return;
  }
  // Serializes the LIVE model (store.js's byId), not the original file --
  // this is what actually persists a merged facts/extensions overlay (see
  // btn-load-dirfacts/btn-load-extlong below) into the saved source.json.
  const result = await io.saveSource(store.exportSourceJson());
  if (result.method === "cancelled") return;
  setIndicator(result.method === "download" ? "downloaded source.json" : "saved source.json", false, {
    explicit: true,
  });
});

$("btn-new-plan").addEventListener("click", () => {
  if (!treesMounted) return;
  if (!window.confirm("Discard the current plan and start a fresh one?")) return;
  store.newPlan();
});

$("btn-open-plan").addEventListener("click", async () => {
  if (!treesMounted) {
    window.alert("Load source.json first.");
    return;
  }
  try {
    await io.openPlan((json) => {
      store.loadPlan(json);
      setIndicator("plan loaded", false, { explicit: true });
    }, $("file-input-plan"));
  } catch (err) {
    window.alert(`Could not open plan.json: ${err.message}`);
  }
});

$("btn-load-structure").addEventListener("click", async () => {
  if (!treesMounted) {
    window.alert("Load source.json first.");
    return;
  }
  try {
    const file = await io.openTracked("target-structure", {
      types: JSON_TYPES,
      fallbackInputEl: $("file-input-structure"),
    });
    if (!file) return;
    const json = await io.loadTargetStructureFromFile(file);
    const { count } = store.loadTargetStructure(json);
    setIndicator(`loaded ${count} target-structure folder(s)`, true, { explicit: true });
  } catch (err) {
    window.alert(`Could not load target structure: ${err.message}`);
  }
});

$("btn-progress").addEventListener("click", () => {
  if (!treesMounted) {
    window.alert("Load source.json first.");
    return;
  }
  progressApi.open();
});

$("btn-export").addEventListener("click", () => {
  if (!treesMounted) {
    window.alert("Load source.json first.");
    return;
  }
  exportApi.open();
});

async function savePlanAction() {
  if (!treesMounted) {
    window.alert("Load source.json first.");
    return;
  }
  const result = await io.savePlan(store);
  if (result.method === "cancelled") return;
  setIndicator(result.method === "download" ? "downloaded plan.json" : "saved plan.json", false, {
    explicit: true,
  });
}
$("btn-save-plan").addEventListener("click", savePlanAction);
// Same action, always visible next to the hamburger -- saving is frequent
// enough to not want to open the menu for it every time.
$("btn-save-plan-toolbar").addEventListener("click", savePlanAction);

// A file is "remembered" whenever peekTracked's status isn't "none" -- either
// durably granted (a same-session reopen) or needing one fresh click to
// re-confirm (the common case after a browser restart, since Chrome resets
// File System Access permission grants then even though the handle itself is
// still valid). Either way, relabel the button so that's obvious rather than
// looking like a cold start.
function labelRemembered(buttonId, info) {
  if (info.status === "none") return;
  const btn = $(buttonId);
  const name = info.status === "granted" ? info.file.name : info.name;
  btn.textContent = `Re-open ${name}…`;
  btn.title =
    info.status === "granted" ? `Remembered: ${name} (click to load it)` : `Click to re-grant access to ${name}`;
}

// Startup auto-load: silently resumes "source" (and then "plan") if the browser
// still durably trusts access to them from a previous session (see
// io.peekTracked -- this never shows a picker or a permission prompt, since no
// user gesture is available yet at page load). All three tracked buttons get
// relabeled up front regardless of outcome, so a restart that reset every
// permission still leaves it obvious which button to click and what it'll
// reopen -- previously this bailed out as soon as source needed a click,
// which left the plan button looking like nothing was remembered for it.
(async function tryAutoLoadOnStartup() {
  try {
    // Target structure is never auto-invoked even when access is durably
    // granted (loading it is additive, so silently re-running it on every open
    // would duplicate folders) -- but relabel the button either way, so one
    // click reuses the remembered file instead of re-browsing from scratch.
    const structureInfo = await io.peekTracked("target-structure");
    labelRemembered("btn-load-structure", structureInfo);

    // "Convert robocopy to JSON" has no remembered handle at all (see
    // pickFileOnce) -- nothing to relabel, its label always stays put.

    const sourceInfo = await io.peekTracked("source");
    labelRemembered("btn-open-source", sourceInfo);

    const planInfo = await io.peekTracked("plan");
    labelRemembered("btn-open-plan", planInfo);

    if (sourceInfo.status !== "granted") {
      // Not about to auto-load silently -- at least one click is unavoidable.
      // If there's autosaved work waiting (the one recovery path that doesn't
      // depend on the File System Access API at all, so it works even in
      // Firefox/Safari), say so loudly rather than leaving it to be discovered
      // by chance after re-opening source among several other toolbar buttons.
      const autosaved = await io.loadAutosavedPlan();
      if (autosaved) $("resume-banner").hidden = false;
      return;
    }
    await loadSourceIntoStore(sourceInfo.file);

    if (planInfo.status === "granted") {
      const json = await io.loadPlanFromFile(planInfo.file);
      store.loadPlan(json);
      setIndicator("auto-loaded plan.json", true, { explicit: true });
    } else {
      await maybeOfferAutosaveRecovery();
    }
  } catch (err) {
    console.warn("Auto-load on startup failed:", err);
  }
})();
