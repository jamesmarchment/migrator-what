// File loading/saving. Runs on `file://`, so this never uses fetch() -- files come
// in via FileReader (file picker or drag/drop) or the File System Access API when
// available, falling back to a download link / file input when it isn't (expected
// to be the common case on a locked-down office browser opened from file://, so
// that fallback path is treated as primary, not an afterthought).
//
// "Auto-load on open" (see main.js / config.js): a file:// page can't read an
// arbitrary path with zero clicks -- there's no server, and browsers require a
// real user gesture before showing any file picker, even on page load. The best
// achievable version, implemented here, is: the FIRST time you open (or save) a
// file via the File System Access API, its FileSystemFileHandle is remembered in
// IndexedDB; on every later page load, if that handle's permission is still
// durably granted, the file is re-read with zero clicks (see peekTracked,
// called at startup with no user gesture available). If the browser has
// downgraded the permission back to "ask again" (common after a restart), or if
// the File System Access API isn't available at all (the realistic case on a
// locked-down office browser), there's no way around at least one click -- in
// that case openTracked() (called from a real click handler) re-prompts for
// permission on the same remembered file, or falls all the way back to a fresh
// picker / plain <input type=file> if there's no handle yet.

import { parseRobocopyListing } from "./robocopyImport.js";
import { parseTargetStructureMarkdown } from "./targetStructureMarkdown.js";
import { parseCsvRecords } from "./csv.js";
import { parseDirFactsRecords, parseExtLongRecords, parseStamp } from "./folderFacts.js";

const DB_NAME = "folder-migrator";
const DB_STORE = "autosave";
const DB_KEY = "current-plan";
const HANDLE_STORE = "handles";

// Chrome treats ALL file:// pages as one shared IndexedDB origin, regardless of which
// directory index.html is actually opened from (verified directly: two different file://
// folders read and wrote the exact same IndexedDB data). Without this, copying this app
// to a different folder -- e.g. from a shared drive to a local one -- would silently see,
// and overwrite, the previous install's remembered file handles and autosave snapshot,
// since nothing here actually distinguished one install from another.
//
// The namespace is `location.pathname` (the real path index.html is running from) by
// default, UNLESS config.js sets `installId` explicitly -- that override exists because
// this only guards against collisions in OUR OWN storage keys; it can't fix Chrome's
// native Save/Open dialogs defaulting to "wherever anything was last saved in this browser
// profile", which has nothing to do with this page and is a likely source of "it saved
// over my other copy's file" even once this namespacing is correct (see startInHint
// below for the other half of that fix). Setting a distinct `installId` per copy in
// config.js is a manual guarantee if there's ever doubt the auto-detected path is
// actually distinguishing two installs (e.g. the same share reachable via two different
// mapped drive letters, which would otherwise look like two different paths that are
// really the same file).
function namespacedKey(key) {
  const configId = typeof window !== "undefined" ? window.FOLDER_MIGRATOR_CONFIG?.installId : "";
  const ns = configId || (typeof location !== "undefined" && location.pathname ? location.pathname : "");
  return `${ns}::${key}`;
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

export async function loadSourceFromFile(file) {
  const text = await readFileAsText(file);
  const json = JSON.parse(text);
  if (json.version !== 1 || !Array.isArray(json.folders)) {
    throw new Error("Not a recognised source.json (expected {version:1, folders:[...]})");
  }
  return json;
}

export async function loadPlanFromFile(file) {
  const text = await readFileAsText(file);
  return JSON.parse(text);
}

export async function loadTargetStructureFromFile(file) {
  const text = await readFileAsText(file);
  const json = JSON.parse(text);
  if (!Array.isArray(json) && !Array.isArray(json?.children)) {
    throw new Error('Not a recognised target-structure file (expected {"children":[...]} or a bare array)');
  }
  return json;
}

// Turns a raw robocopy /L listing (the same input tools/import-robocopy.mjs
// takes) into source.json shape, entirely client-side -- the whole point
// being an office machine that can't install Node can still do this. The
// actual parsing lives in robocopyImport.js so the CLI and the browser share
// one implementation; this just handles the browser-specific bit (decoding
// the file's bytes -- robocopy writes these listings as UTF-16LE).
export async function loadRobocopyFromFile(file, { root } = {}) {
  const buf = await file.arrayBuffer();
  const text = new TextDecoder("utf-16le").decode(buf);
  return parseRobocopyListing(text, { root });
}

// Folder-facts CSVs (see model/folderFacts.js and "test data/handoff_copilot.md")
// -- optional, supplemental data merged into the live source via
// store.mergeFacts/mergeExtensions (see main.js), not remembered as a tracked
// file: the user's own data model is "merge it in and stamp it", with a saved
// source.json carrying the merge forward, not a handle we silently re-read.
export async function loadDirFactsFromFile(file) {
  const { byPath, hasSubtree } = parseDirFactsRecords(parseCsvRecords(await readFileAsText(file)));
  const { stamp, isPartial } = parseStamp(file.name);
  return { byPath, hasSubtree, stamp, isPartial };
}

export async function loadExtLongFromFile(file) {
  const byPath = parseExtLongRecords(parseCsvRecords(await readFileAsText(file)));
  const { stamp, isPartial } = parseStamp(file.name);
  return { byPath, stamp, isPartial };
}

// Same idea, for the target-structure markdown format (see tools/target-
// structure-example.md / model/targetStructureMarkdown.js) -- plain text, no
// special encoding needed unlike the robocopy listing.
export async function loadTargetStructureMarkdownFromFile(file) {
  const text = await readFileAsText(file);
  return parseTargetStructureMarkdown(text);
}

function supportsFileSystemAccess() {
  return typeof window !== "undefined" && "showSaveFilePicker" in window && "showOpenFilePicker" in window;
}

export function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function downloadJson(filename, json, { pretty = true } = {}) {
  // No File System Access handle involved here -- the browser's own download mechanism
  // always lands in the profile's configured Downloads folder, never next to index.html,
  // which is itself a common source of "where did my save go" confusion worth logging.
  console.log(`[folder-migrator] downloading "${filename}" via browser download (no file handle -- lands in your Downloads folder, not next to index.html)`);
  downloadBlob(filename, pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json), "application/json");
}

// --- shared IndexedDB (autosave snapshot + remembered file handles) ---

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) {
        req.result.createObjectStore(DB_STORE);
      }
      if (!req.result.objectStoreNames.contains(HANDLE_STORE)) {
        req.result.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Logged plainly (not console.debug) since this is exactly what someone troubleshooting
// "why did this save/load the wrong file" needs to see without first knowing to enable
// verbose logging. Can't log a full filesystem path for the handle itself -- the File
// System Access API never exposes one, by design -- but `location.href` (this page's own
// path) plus the derived namespace and the handle's bare filename is enough to tell
// whether two installs are actually getting distinct namespaces.
function logHandleOp(action, key, extra = "") {
  console.log(`[folder-migrator] ${action} "${key}" handle -- page: ${location.href}, namespace: ${namespacedKey(key)}${extra ? ", " + extra : ""}`);
}

async function saveHandle(key, handle) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).put(handle, namespacedKey(key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    logHandleOp("remembered", key, `filename: ${handle.name}`);
  } catch (err) {
    console.warn(`Could not remember the "${key}" file handle:`, err);
  }
}

async function loadHandle(key) {
  try {
    const db = await openDb();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readonly");
      const req = tx.objectStore(HANDLE_STORE).get(namespacedKey(key));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    logHandleOp("looked up", key, handle ? `found filename: ${handle.name}` : "found: nothing");
    return handle;
  } catch {
    return null;
  }
}

// Picks a directory hint for a fresh Open/Save dialog: prefers whichever OTHER tracked
// handle this same install already holds, so the dialog opens near this app's own files
// instead of defaulting to Chrome's browser-wide "last folder saved to anywhere" -- a
// per-profile default with no relation to this page, and the likely reason a save can
// land in a different install's folder even once storage is correctly namespaced (see
// namespacedKey above). Falls back to no hint (the browser's own default) if this
// install has no other tracked handle yet -- unavoidable for a completely fresh install's
// very first save.
async function startInHint(excludeKey) {
  for (const key of ["source", "plan", "target-structure"]) {
    if (key === excludeKey) continue;
    const handle = await loadHandle(key);
    if (handle) return handle;
  }
  return undefined;
}

async function deleteHandle(key) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).delete(namespacedKey(key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`Could not forget the "${key}" file handle:`, err);
  }
}

// "Forget" one or more tracked files -- so the next openTracked() for that key
// shows a fresh picker instead of silently reusing whatever was remembered.
// For "wipe the slate clean and use a different file" (see main.js's
// resetWorkspace): deliberately never includes "plan", since resuming a saved
// plan is meant to keep working even after the source/target-structure files
// it was reviewed against get swapped out for corrected ones.
export async function forgetTracked(keys) {
  await Promise.all(keys.map(deleteHandle));
}

// --- remembered-file reads ("auto-load on open") ---

// Startup-safe: no user gesture available yet, so this can only use a
// permission that's still durably granted from a previous session -- it never
// shows a picker or a permission prompt. Returns one of:
//   { status: "granted", file }          -- durably trusted; safe to auto-load
//   { status: "needs-permission", name } -- a file WAS remembered (`name` is
//                                            its filename), but the browser
//                                            wants a fresh click to re-confirm
//                                            access (common after a restart) --
//                                            callers should suggest "Re-open
//                                            <name>" rather than showing a
//                                            plain, unlabeled Open button.
//   { status: "none" }                   -- nothing remembered for this key
export async function peekTracked(key) {
  if (!supportsFileSystemAccess()) return { status: "none" };
  const handle = await loadHandle(key);
  if (!handle) return { status: "none" };
  try {
    if ((await handle.queryPermission({ mode: "read" })) === "granted") {
      return { status: "granted", file: await handle.getFile() };
    }
    return { status: "needs-permission", name: handle.name };
  } catch {
    return { status: "none" }; // stale handle (file moved/deleted)
  }
}

// Must be called from a real user-gesture handler (a click), since it may need
// to show a picker or re-request permission. Order of attempts: (1) a
// remembered handle, re-confirming permission if needed; (2) a fresh native
// picker, remembering whatever's chosen for next time; (3) the plain
// <input type=file> fallback (never remembered -- a plain File has no handle).
export async function openTracked(key, { types, fallbackInputEl } = {}) {
  if (supportsFileSystemAccess()) {
    const remembered = await loadHandle(key);
    if (remembered) {
      try {
        let perm = await remembered.queryPermission({ mode: "read" });
        if (perm !== "granted") perm = await remembered.requestPermission({ mode: "read" });
        if (perm === "granted") return await remembered.getFile();
      } catch {
        // stale handle -- fall through to a fresh picker below
      }
    }
    try {
      const [handle] = await window.showOpenFilePicker({ types, startIn: await startInHint(key) });
      await saveHandle(key, handle);
      return await handle.getFile();
    } catch (err) {
      if (err?.name === "AbortError") return null;
      console.warn(`File System Access open failed for "${key}", falling back:`, err);
    }
  }
  if (!fallbackInputEl) throw new Error("No fallback <input type=file> provided.");
  return new Promise((resolve) => {
    fallbackInputEl.onchange = () => {
      const file = fallbackInputEl.files?.[0];
      fallbackInputEl.value = "";
      resolve(file ?? null);
    };
    fallbackInputEl.click();
  });
}

// Same picker as openTracked's fresh-picker branch, but never remembers the
// handle -- for actions where "pick whichever file, every time" is the point
// (e.g. converting a robocopy listing), unlike source/plan/target-structure,
// which are each meant to represent one ongoing file you keep coming back to.
export async function pickFileOnce({ types, fallbackInputEl } = {}) {
  if (supportsFileSystemAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker({ types });
      return await handle.getFile();
    } catch (err) {
      if (err?.name === "AbortError") return null;
      console.warn("File System Access open failed, falling back:", err);
    }
  }
  if (!fallbackInputEl) throw new Error("No fallback <input type=file> provided.");
  return new Promise((resolve) => {
    fallbackInputEl.onchange = () => {
      const file = fallbackInputEl.files?.[0];
      fallbackInputEl.value = "";
      resolve(file ?? null);
    };
    fallbackInputEl.click();
  });
}

const PLAN_TYPES = [{ description: "Plan JSON", accept: { "application/json": [".json"] } }];

// Save plan.json, reusing the remembered "plan" handle when possible so repeated
// saves go back to the same file without a picker each time.
export async function savePlan(store) {
  const json = store.toPlanJson();
  if (supportsFileSystemAccess()) {
    try {
      let fileHandle = await loadHandle("plan");
      if (fileHandle) {
        let perm = await fileHandle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") perm = await fileHandle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") fileHandle = null;
      }
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: "plan.json",
          types: PLAN_TYPES,
          startIn: await startInHint("plan"),
        });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(json, null, 2));
      await writable.close();
      await saveHandle("plan", fileHandle);
      return { method: "fs-access" };
    } catch (err) {
      if (err && err.name === "AbortError") return { method: "cancelled" };
      console.warn("File System Access save failed, falling back to download:", err);
    }
  }
  downloadJson("plan.json", json);
  return { method: "download" };
}

const SOURCE_SAVE_TYPES = [{ description: "Source JSON", accept: { "application/json": [".json"] } }];

// Save source.json -- mainly for after a robocopy import, so the parsed result
// becomes a normal, reopenable file (and, on Chrome/Edge, remembering its handle
// under the same "source" key openTracked/peekTracked use, so a later session's
// "Re-open <name>…" picks it straight back up like any other opened source.json).
export async function saveSource(json) {
  if (supportsFileSystemAccess()) {
    try {
      let fileHandle = await loadHandle("source");
      if (fileHandle) {
        let perm = await fileHandle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") perm = await fileHandle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") fileHandle = null;
      }
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: "source.json",
          types: SOURCE_SAVE_TYPES,
          startIn: await startInHint("source"),
        });
      }
      const writable = await fileHandle.createWritable();
      // Not pretty-printed, unlike savePlan()'s plan.json: source.json can carry merged
      // folder-facts data at real-share scale (~105k folders, tens of MB -- see
      // handoff.md §10), where 2-space indentation both roughly doubles the bytes
      // written now and, more importantly, the bytes every future JSON.parse has to
      // chew through on each later load. Nobody hand-edits source.json.
      await writable.write(JSON.stringify(json));
      await writable.close();
      await saveHandle("source", fileHandle);
      return { method: "fs-access" };
    } catch (err) {
      if (err && err.name === "AbortError") return { method: "cancelled" };
      console.warn("File System Access save failed, falling back to download:", err);
    }
  }
  downloadJson("source.json", json, { pretty: false });
  return { method: "download" };
}

// Open plan.json (via the remembered "plan" handle when possible). `onFile(json)`
// is called once a file is chosen/read.
export async function openPlan(onFile, fallbackInputEl) {
  const file = await openTracked("plan", { types: PLAN_TYPES, fallbackInputEl });
  if (!file) return;
  const json = await loadPlanFromFile(file);
  onFile(json);
}

// --- IndexedDB autosave (crash protection only; explicit Save/Open above is authoritative) ---

export async function loadAutosavedPlan() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(namespacedKey(DB_KEY));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Autosave read failed (continuing without it):", err);
    return null;
  }
}

async function writeAutosave(planJson) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(planJson, namespacedKey(DB_KEY));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Subscribes to the store and writes an autosave snapshot `debounceMs` after the
// last change. Returns an unsubscribe function.
export function initAutosave(store, { debounceMs = 1000, onSaved } = {}) {
  let timer = null;
  return store.subscribe((event) => {
    if (event.type === "reset") return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await writeAutosave(store.toPlanJson());
        onSaved?.();
      } catch (err) {
        console.warn("Autosave write failed:", err);
      }
    }, debounceMs);
  });
}
