// The single source of truth for source folders + plan overrides. No DOM, no
// Wunderbaum imports here -- ui/trees.js and ui/editor.js are views over this.
// (validate.js is a dependency-free pure-function module, imported below for the
// bulk target-structure loader -- still no DOM/Wunderbaum coupling.)
// See handoff.md section 5 for the data model this implements.

import { checkIllegalName, checkSiblingCollision } from "./validate.js";

const ROOT = "ROOT";
const TRASH = "TRASH";
const PENDING = "PENDING";

function normParent(destParentId) {
  return destParentId === null || destParentId === undefined ? ROOT : destParentId;
}

// Deterministic, dependency-free hash used only to detect "this plan was made
// against a different source.json", not for any security purpose.
function fnv1aHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Feeds each folder's id/parentId/name characters straight into a per-folder running
// FNV-1a hash (no template-literal/join string allocation per folder), then XORs each
// folder's hash into one accumulator -- order-independent, so folder order in the
// source JSON never changes the result, without needing the sort the previous
// implementation used to get that same property.
//
// Measured against the original (`[...folders].sort(...).join("\n")` then one
// fnv1aHash call) on a 105k-folder synthetic dataset (tools/make-test-data.mjs
// --withFacts): the original was ~20-30ms; an earlier attempt here that called
// fnv1aHash() once per folder (template-literal string + hex round-trip per call)
// was actually ~2-3x SLOWER (~60-70ms) despite being O(n) vs O(n log n) -- V8's
// native sort/join have low constants, and 105k separate allocations/calls add real
// overhead at this scale. This allocation-free version (no sort, no per-folder
// strings) is the one that's actually faster in practice, ~9-13ms. Re-benchmark with
// tools/bench-load.mjs before changing this again -- the "obviously better" Big-O
// didn't hold up the first time.
function computeSourceHash(folders) {
  let acc = 0;
  for (const f of folders) {
    let h = 0x811c9dc5;
    h = fnv1aStep(h, f.id);
    h = fnv1aStep(fnv1aStep(h, "|"), f.parentId ?? "");
    h = fnv1aStep(fnv1aStep(h, "|"), f.name);
    acc ^= h >>> 0;
  }
  return (acc >>> 0).toString(16);
}

function fnv1aStep(h, str) {
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

export function createStore() {
  // --- immutable source state ---
  // ("Immutable" with one deliberate exception: a folder's optional .facts/
  // .extensions properties, below, are written in place by mergeFacts()/
  // mergeExtensions() on an explicit user action -- see those functions.
  // Nothing else ever mutates a folder record after init().)
  let sourceRoot = "";
  let rootFiles = null; // the scan root's own direct file count, if the loaded source.json carried one -- kept only so exportSourceJson() can round-trip it
  let byId = new Map(); // id -> {id, parentId, name, files, inferred?, facts?, extensions?}
  let srcChildren = new Map(); // (parentId|null) -> id[]
  let sourceHash = "";
  // id -> true (whole subtree has zero files anywhere) | false (has at least
  // one file somewhere) | null (can't tell -- some folder in it has an
  // unknown/inferred file count). Lazily computed per id, memoized here since
  // source is immutable after init() -- cleared whenever it isn't.
  let emptySubtreeCache = new Map();
  // id -> full source path string. srcPath() walks the ancestor chain on every call
  // with no reuse between calls -- cheap for a single lookup (e.g. the editor panel),
  // but mergeFacts()/mergeExtensions() call it once per folder (O(n) calls), which
  // without this cache costs O(n*depth) total. Same lifecycle as emptySubtreeCache:
  // valid as long as source folders' id/parentId/name are immutable, cleared on
  // init()/unload().
  let srcPathCache = new Map();

  // --- optional folder-facts overlay (see model/folderFacts.js) ---
  // Supplemental to the loaded source, not to the plan: reset on init()/
  // unload() (a merge joined against a since-replaced source is misleading)
  // but left alone by newPlan(). See mergeFacts()/mergeExtensions() below for
  // why these are a full-replace on every merge, not a running total.
  let staleThresholdDays = 1095; // matches Get-DriveFacts.ps1's own -StaleDays default, for a familiar starting number -- this is still our own independently-computed, adjustable clock, never a read of that script's frozen StaleFiles/StaleBytes columns
  let factsStamp = null;
  let factsPartial = false;
  let factsHasSubtree = false;
  let extensionsStamp = null;
  let extensionsPartial = false;

  function resetFacts() {
    staleThresholdDays = 1095;
    factsStamp = null;
    factsPartial = false;
    factsHasSubtree = false;
    extensionsStamp = null;
    extensionsPartial = false;
  }

  // --- mutable plan state ---
  let overrides = new Map(); // sourceFolderId -> {destParentId?, destName?}
  let newFolders = new Map(); // id -> {id, destParentId, destName, isTrash?, isPending?, _preBucket?}
  let meta = new Map(); // id -> {note, reviewed}
  let history = [];
  let nextNewSeq = 1;

  // destChildrenIndex: parentKey ("ROOT" or a folder id) -> Set<id>
  // Covers BOTH source folders (keyed by their effective parent) and new folders.
  let destChildrenIndex = new Map();

  const listeners = new Set();
  function emit(event) {
    for (const fn of listeners) fn(event);
  }

  function indexAdd(parentKey, id) {
    let set = destChildrenIndex.get(parentKey);
    if (!set) destChildrenIndex.set(parentKey, set = new Set());
    set.add(id);
  }
  function indexRemove(parentKey, id) {
    destChildrenIndex.get(parentKey)?.delete(id);
  }

  function rebuildDestChildrenIndex() {
    destChildrenIndex = new Map();
    for (const f of byId.values()) {
      const ov = overrides.get(f.id);
      const destParent = normParent(ov?.destParentId !== undefined ? ov.destParentId : f.parentId);
      indexAdd(destParent, f.id);
    }
    for (const nf of newFolders.values()) {
      indexAdd(normParent(nf.destParentId), nf.id);
    }
  }

  function init(sourceJson) {
    sourceRoot = sourceJson.root ?? "";
    rootFiles = sourceJson.rootFiles ?? null;
    byId = new Map();
    srcChildren = new Map();
    for (const f of sourceJson.folders) {
      byId.set(f.id, f);
      const key = f.parentId ?? null;
      if (!srcChildren.has(key)) srcChildren.set(key, []);
      srcChildren.get(key).push(f.id);
    }
    sourceHash = computeSourceHash(sourceJson.folders);
    emptySubtreeCache = new Map();
    srcPathCache = new Map();
    // A previously-enriched source.json (see exportSourceJson()) carries its
    // own facts/extensions merge forward as plain folder properties, already
    // reconstructed above -- just restore the bookkeeping fields that
    // describe them, rather than re-deriving anything.
    resetFacts();
    factsStamp = sourceJson.factsStamp ?? null;
    factsPartial = !!sourceJson.factsPartial;
    factsHasSubtree = !!sourceJson.factsHasSubtree;
    extensionsStamp = sourceJson.extensionsStamp ?? null;
    extensionsPartial = !!sourceJson.extensionsPartial;
    newPlan();
  }

  function newPlan() {
    overrides = new Map();
    newFolders = new Map();
    meta = new Map();
    history = [];
    nextNewSeq = 1;
    newFolders.set(TRASH, { id: TRASH, destParentId: ROOT, destName: "_TRASH", isTrash: true });
    newFolders.set(PENDING, { id: PENDING, destParentId: ROOT, destName: "_PENDING", isPending: true });
    rebuildDestChildrenIndex();
    emit({ type: "reset" });
  }

  // Clears the loaded source entirely -- back to exactly the pre-init() state,
  // as if the page had just been reloaded, but without an actual reload (so it
  // doesn't race with the startup auto-load silently bringing the same source
  // right back). Purely an in-memory reset: remembered file handles in
  // IndexedDB are untouched, so "Open source.json…" still offers to reopen
  // whatever was remembered, on request rather than automatically.
  function unload() {
    sourceRoot = "";
    rootFiles = null;
    byId = new Map();
    srcChildren = new Map();
    sourceHash = "";
    emptySubtreeCache = new Map();
    srcPathCache = new Map();
    resetFacts();
    newPlan(); // also resets the plan and emits "reset", same as store.js's own init() does
  }

  function loadPlan(planJson) {
    if (planJson.sourceHash && planJson.sourceHash !== sourceHash) {
      throw new Error(
        "This plan was created against a different source.json (sourceHash mismatch). " +
          "Loading it anyway would silently misattribute overrides to the wrong folders."
      );
    }
    overrides = new Map(Object.entries(planJson.overrides ?? {}));
    newFolders = new Map();
    for (const nf of planJson.newFolders ?? []) {
      const copy = { ...nf };
      // Back-compat: earlier plans stored the pre-bucket snapshot under `_preTrash`
      // before Pending existed as a second bucket alongside Trash.
      if (copy._preTrash && !copy._preBucket) {
        copy._preBucket = copy._preTrash;
        delete copy._preTrash;
      }
      newFolders.set(nf.id, copy);
    }
    if (!newFolders.has(TRASH)) {
      newFolders.set(TRASH, { id: TRASH, destParentId: ROOT, destName: "_TRASH", isTrash: true });
    }
    if (!newFolders.has(PENDING)) {
      newFolders.set(PENDING, { id: PENDING, destParentId: ROOT, destName: "_PENDING", isPending: true });
    }
    meta = new Map(Object.entries(planJson.meta ?? {}));
    history = [...(planJson.history ?? [])];
    nextNewSeq =
      1 +
      Math.max(
        0,
        ...[...newFolders.keys()]
          .map((id) => /^N(\d+)$/.exec(id))
          .filter(Boolean)
          .map((m) => Number(m[1]))
      );
    rebuildDestChildrenIndex();
    emit({ type: "reset" });
  }

  function toPlanJson() {
    return {
      version: 1,
      sourceHash,
      overrides: Object.fromEntries(overrides),
      newFolders: [...newFolders.values()],
      meta: Object.fromEntries(meta),
      history,
    };
  }

  function pushHistory(id, field, from, to) {
    history.push({ seq: history.length + 1, ts: new Date().toISOString(), id, field, from, to });
  }

  // --- lookups ---

  function isNew(id) {
    return newFolders.has(id);
  }

  function srcName(id) {
    return byId.get(id)?.name ?? null;
  }

  function effName(id) {
    const nf = newFolders.get(id);
    if (nf) return nf.destName;
    const f = byId.get(id);
    if (!f) return null;
    const ov = overrides.get(id);
    return ov?.destName ?? f.name;
  }

  function effParentKey(id) {
    const nf = newFolders.get(id);
    if (nf) return normParent(nf.destParentId);
    const f = byId.get(id);
    if (!f) return null;
    const ov = overrides.get(id);
    const raw = ov?.destParentId !== undefined ? ov.destParentId : f.parentId;
    return normParent(raw);
  }

  function filesOf(id) {
    return byId.get(id)?.files ?? null;
  }

  function isInferred(id) {
    return !!byId.get(id)?.inferred;
  }

  function destPath(id) {
    const parts = [];
    let cur = id;
    let guard = 0;
    while (cur && cur !== ROOT) {
      if (++guard > 10000) throw new Error(`destPath: cycle detected reaching ${id}`);
      parts.unshift(effName(cur));
      cur = effParentKey(cur);
    }
    return sourceRoot + "\\" + parts.join("\\");
  }

  function srcPath(id) {
    const cached = srcPathCache.get(id);
    if (cached !== undefined) return cached;
    const parts = [];
    let cur = id;
    let guard = 0;
    while (cur) {
      // An ancestor already resolved (e.g. by an earlier sibling's call, or mergeFacts/
      // mergeExtensions having already processed it) lets the walk stop early instead
      // of continuing to the root -- this is what makes a full iteration over every
      // folder (mergeFacts/mergeExtensions) O(n) instead of O(n*depth).
      const ancestorHit = srcPathCache.get(cur);
      if (ancestorHit !== undefined) {
        const full = parts.length ? ancestorHit + "\\" + parts.join("\\") : ancestorHit;
        srcPathCache.set(id, full);
        return full;
      }
      if (++guard > 10000) throw new Error(`srcPath: cycle detected reaching ${id}`);
      const f = byId.get(cur);
      if (!f) break;
      parts.unshift(f.name);
      cur = f.parentId;
    }
    const path = sourceRoot + "\\" + parts.join("\\");
    srcPathCache.set(id, path);
    return path;
  }

  function getSourceChildren(parentId) {
    return (srcChildren.get(parentId ?? null) ?? []).slice();
  }

  function getDestChildren(parentKeyOrNull) {
    const key = normParent(parentKeyOrNull);
    return [...(destChildrenIndex.get(key) ?? [])];
  }

  // getDestChildren's own order is just insertion order (source-file order for
  // untouched real folders, then whatever order things got reparented in) --
  // fine for internal bookkeeping (cycle/collision checks, counting), but not
  // what the After tree should display: alphabetical (natural/numeric-aware,
  // case-insensitive), with Trash and Pending always pinned to the very bottom
  // regardless of name, since they're buckets, not part of the structure.
  function sortedDestChildren(parentKeyOrNull) {
    const ids = getDestChildren(parentKeyOrNull);
    ids.sort((a, b) => {
      const aBucket = a === TRASH || a === PENDING;
      const bBucket = b === TRASH || b === PENDING;
      if (aBucket !== bBucket) return aBucket ? 1 : -1;
      if (aBucket) return a === TRASH ? -1 : 1; // fixed Trash-then-Pending order
      return effName(a).localeCompare(effName(b), undefined, { numeric: true, sensitivity: "base" });
    });
    return ids;
  }

  // Ancestor chain (top -> id, inclusive) in the Before (source) tree.
  function srcAncestorChain(id) {
    const chain = [];
    let cur = id;
    let guard = 0;
    while (cur !== null && cur !== undefined) {
      const f = byId.get(cur);
      if (!f) break; // unknown id
      if (++guard > 10000) throw new Error(`srcAncestorChain: cycle detected reaching ${id}`);
      chain.unshift(cur);
      cur = f.parentId;
    }
    return chain;
  }

  // Ancestor chain (top -> id, inclusive) in the After (destination) tree.
  function destAncestorChain(id) {
    const chain = [];
    let cur = id;
    let guard = 0;
    while (cur !== ROOT) {
      if (++guard > 10000) throw new Error(`destAncestorChain: cycle detected reaching ${id}`);
      chain.unshift(cur);
      cur = effParentKey(cur);
      if (cur === null) break; // hit an id with no known parent (shouldn't happen)
    }
    return chain;
  }

  function descendantCount(id) {
    let count = 0;
    const stack = getDestChildren(id);
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue; // defensive: don't hang on a corrupt cycle
      seen.add(cur);
      count++;
      stack.push(...getDestChildren(cur));
    }
    return count;
  }

  function wouldCreateCycle(id, newParentId) {
    if (newParentId === id) return true;
    let cur = normParent(newParentId);
    let guard = 0;
    while (cur !== ROOT) {
      if (++guard > 10000) return true; // corrupt chain -- treat as unsafe
      if (cur === id) return true;
      cur = effParentKey(cur);
      if (cur === null) return true; // hit an unknown/inferred-away id
    }
    return false;
  }

  // All descendants of `id` in the Before (source) tree -- used to cascade a
  // review-status redraw when `meta.reviewed` changes (see reviewStatus below).
  function srcDescendantIds(id) {
    const out = [];
    const stack = getSourceChildren(id);
    while (stack.length) {
      const cur = stack.pop();
      out.push(cur);
      stack.push(...getSourceChildren(cur));
    }
    return out;
  }

  // "reviewed" (its own meta.reviewed flag) beats "flagged" (its own
  // meta.flagged flag -- deliberately marked "come back to this later")
  // beats "covered" (not itself reviewed, but a source-tree ancestor is)
  // beats "unreviewed" (none of the above). Flagged wins over covered on
  // purpose: an explicit flag on this exact folder is more specific than the
  // passive inference that an ancestor's review covers it too. New/skeleton
  // folders have no source ancestry, so "covered" doesn't apply to them, but
  // they can still be flagged.
  function reviewStatus(id) {
    const m = getMeta(id);
    if (isNew(id)) {
      if (m.reviewed) return "reviewed";
      return m.flagged ? "flagged" : "unreviewed";
    }
    if (m.reviewed) return "reviewed";
    if (m.flagged) return "flagged";
    const ancestors = srcAncestorChain(id).slice(0, -1);
    if (ancestors.some((aid) => getMeta(aid).reviewed)) return "covered";
    return "unreviewed";
  }

  // Whether id's whole source subtree (itself + every descendant) has zero
  // files anywhere: true (definitely empty), false (a file exists somewhere in
  // it), or null (can't tell -- some folder in it has an unknown file count,
  // e.g. a placeholder ancestor auto-created for a redacted/truncated robocopy
  // scan -- see robocopyImport.js). A single known non-empty folder anywhere
  // in the subtree makes the whole thing false, even past an unknown one.
  // Memoized in emptySubtreeCache since source is immutable after init() --
  // without that, this would be an O(subtree) walk on every render of a large
  // tree, not the O(1) lookup it needs to be at 100k-folder scale.
  function isEmptySubtree(id) {
    if (emptySubtreeCache.has(id)) return emptySubtreeCache.get(id);
    const f = byId.get(id);
    if (f.files > 0) {
      emptySubtreeCache.set(id, false);
      return false;
    }
    let result = f.files === 0 ? true : null;
    for (const childId of getSourceChildren(id)) {
      const childResult = isEmptySubtree(childId);
      if (childResult === false) {
        result = false;
        break;
      }
      if (childResult === null && result === true) result = null;
    }
    emptySubtreeCache.set(id, result);
    return result;
  }

  // --- optional folder-facts overlay (see model/folderFacts.js) ---

  // Merging is a full replace, not a patch: a folder dropped from a fresher
  // rescan (renamed/moved/deleted on the real share since the last merge)
  // must not keep showing an old, now-orphaned .facts forever. `byPath` is a
  // Map<absolute path, {directFiles, directBytes, subtreeFiles?,
  // subtreeBytes?, subtreeOldestWriteUtc?, subtreeNewestWriteUtc?}> as
  // produced by folderFacts.js's parseDirFactsRecords -- joined here by exact
  // srcPath(id) string match, per the source data's own "no normalization"
  // rule. Folders not present in `byPath` simply end up with no .facts,
  // which every reader (isStale, folderFacts, toBeforeWbData) already treats
  // as "no data", not "zero" -- the same graceful-absence handling that
  // covers "this feature was never used at all".
  function mergeFacts(byPath, { stamp = null, isPartial = false, hasSubtree = false } = {}) {
    for (const f of byId.values()) delete f.facts;
    for (const f of byId.values()) {
      const row = byPath.get(srcPath(f.id));
      if (row) f.facts = row;
    }
    factsStamp = stamp;
    factsPartial = isPartial;
    factsHasSubtree = hasSubtree;
    emit({ type: "facts-changed" });
  }

  // Same shape as mergeFacts, for extlong.csv's direct-children-only
  // extension breakdown. Kept as a separate merge/stamp pair from mergeFacts
  // deliberately -- the two CSVs come from independent pipeline runs (the
  // sample data in this repo even has two different stamps for them) and
  // there's no requirement they be loaded together or agree.
  function mergeExtensions(byPath, { stamp = null, isPartial = false } = {}) {
    for (const f of byId.values()) delete f.extensions;
    for (const f of byId.values()) {
      const rows = byPath.get(srcPath(f.id));
      if (rows) f.extensions = rows;
    }
    extensionsStamp = stamp;
    extensionsPartial = isPartial;
    emit({ type: "facts-changed" });
  }

  function setStaleThresholdDays(days) {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("Staleness threshold must be a positive number of days.");
    }
    staleThresholdDays = n;
    emit({ type: "facts-changed" }); // same event as a fresh merge -- both need the identical Before-tree re-class pass
  }

  function folderFacts(id) {
    return byId.get(id)?.facts ?? null;
  }

  function folderExtensions(id) {
    return byId.get(id)?.extensions ?? null;
  }

  // null = can't tell (no facts loaded, or no subtree data for this folder --
  // e.g. only a plain dirfacts.csv was merged, or this exact folder wasn't in
  // the scan at all); true/false = definitively computed against the CURRENT
  // staleThresholdDays. Deliberately NOT memoized like isEmptySubtree, which
  // is a genuine O(subtree) walk -- this is one property read plus a date
  // subtraction, and the threshold can change after a cached value was
  // computed, which a memo would need explicit invalidation for, with no real
  // performance gain to justify it.
  function isStale(id) {
    const f = folderFacts(id);
    if (!f || !f.subtreeNewestWriteUtc) return null;
    const ageDays = (Date.now() - Date.parse(f.subtreeNewestWriteUtc)) / 86400000;
    return ageDays >= staleThresholdDays;
  }

  function factsStatus() {
    return { factsStamp, factsPartial, factsHasSubtree, extensionsStamp, extensionsPartial };
  }

  // Serializes the LIVE model, not a round-tripped copy of whatever
  // source.json was originally opened -- byId is the single source of truth,
  // and its folder records now carry any merged .facts/.extensions, so
  // "Save source.json…" must read from here to actually persist them.
  function exportSourceJson() {
    return {
      version: 1,
      root: sourceRoot,
      separator: "\\",
      rootFiles,
      folders: [...byId.values()],
      factsStamp,
      factsPartial,
      factsHasSubtree,
      extensionsStamp,
      extensionsPartial,
    };
  }

  // --- node data for Wunderbaum ---

  function toBeforeWbData(id) {
    const f = byId.get(id);
    const emptyClass = isEmptySubtree(id) === true ? " empty-tree" : "";
    const staleClass = isStale(id) === true ? " stale-folder" : "";
    return {
      key: id,
      title: f.name,
      lazy: true,
      files: f.files,
      inferred: !!f.inferred,
      classes: `review-${reviewStatus(id)}${emptyClass}${staleClass}`,
    };
  }

  function toAfterWbData(id) {
    const nf = newFolders.get(id);
    if (nf) {
      const isBucket = !!nf.isTrash || !!nf.isPending;
      return {
        key: id,
        title: nf.destName,
        lazy: true,
        isTrash: !!nf.isTrash,
        isPending: !!nf.isPending,
        isNew: true,
        icon: nf.isTrash ? "wbi-trash" : nf.isPending ? "wbi-pending" : undefined,
        // Skeleton/target-structure folders have no source ancestry, so
        // reviewStatus() would only ever say "unreviewed" for their whole
        // lifetime as a placeholder -- that's not a meaningful signal (it never
        // changes), so give them their own static class instead of the
        // review-* scheme used for real folders. See styles.css.
        classes: isBucket ? undefined : "skeleton-slot",
      };
    }
    const f = byId.get(id);
    const status = folderStatus(id);
    // fromSkeleton (see equate()) marks a real folder that filled -- directly or
    // via a same-named merge -- a target-structure slot. It's a separate,
    // persistent signal from review-status colors: it stays true even once the
    // folder is fully reviewed/covered and its review-* color has gone quiet, so
    // it can still be styled distinctly ("this is part of the intended
    // structure") independent of review state.
    const skeletonClass = getMeta(id).fromSkeleton ? " skeleton-slot" : "";
    return {
      key: id,
      title: effName(id),
      lazy: true,
      files: f.files,
      status,
      classes: `review-${reviewStatus(id)}${skeletonClass}`,
    };
  }

  function folderStatus(id) {
    if (isNew(id)) {
      const nf = newFolders.get(id);
      if (nf.isTrash) return "trash";
      if (nf.isPending) return "pending-bucket";
      const p = normParent(nf.destParentId);
      if (p === TRASH) return "deleted";
      if (p === PENDING) return "pending";
      return "new";
    }
    const ov = overrides.get(id);
    if (!ov) return "unchanged";
    const destParent = normParent(ov.destParentId);
    if (destParent === TRASH) return "deleted";
    if (destParent === PENDING) return "pending";
    const moved = ov.destParentId !== undefined;
    const renamed = ov.destName !== undefined;
    if (moved && renamed) return "moved+renamed";
    if (moved) return "moved";
    if (renamed) return "renamed";
    return "unchanged";
  }

  function getBeforeRoot() {
    return getSourceChildren(null).map(toBeforeWbData);
  }
  function getBeforeChildren(id) {
    return getSourceChildren(id).map(toBeforeWbData);
  }
  function getAfterRoot() {
    return sortedDestChildren(ROOT).map(toAfterWbData);
  }
  function getAfterChildren(id) {
    return sortedDestChildren(id).map(toAfterWbData);
  }

  // --- mutations ---

  function setOverride(id, patch) {
    const f = byId.get(id);
    if (!f) throw new Error(`setOverride: unknown source folder ${id}`);
    const cur = { ...(overrides.get(id) ?? {}) };
    Object.assign(cur, patch);
    // Normalise away no-ops so the plan stays sparse/minimal.
    if (cur.destName !== undefined && cur.destName === f.name) delete cur.destName;
    if (cur.destParentId !== undefined && cur.destParentId === normParent(f.parentId)) {
      delete cur.destParentId;
    }
    if (Object.keys(cur).length === 0) overrides.delete(id);
    else overrides.set(id, cur);
  }

  function rename(id, newName) {
    const oldName = effName(id);
    if (newName === oldName) return { type: "noop" };
    const parentKey = effParentKey(id);
    if (isNew(id)) {
      newFolders.get(id).destName = newName;
    } else {
      setOverride(id, { destName: newName });
    }
    pushHistory(id, "destName", oldName, newName);
    const event = { type: "rename", id, parentKey };
    emit(event);
    return event;
  }

  function moveFolder(id, newParentIdRaw) {
    const newParentKey = normParent(newParentIdRaw);
    const oldParentKey = effParentKey(id);
    if (oldParentKey === newParentKey) return { type: "noop" };
    if (wouldCreateCycle(id, newParentKey)) {
      throw new Error(`Cannot move ${id}: ${newParentKey} is ${id} or one of its own descendants`);
    }
    if (isNew(id)) {
      newFolders.get(id).destParentId = newParentKey;
    } else {
      setOverride(id, { destParentId: newParentKey });
    }
    indexRemove(oldParentKey, id);
    indexAdd(newParentKey, id);
    pushHistory(id, "destParentId", oldParentKey, newParentKey);
    const event = { type: "move", id, oldParentKey, newParentKey };
    emit(event);
    if (!isNew(id) && markReviewedIfNeeded(id)) {
      emit({ type: "meta", id, field: "reviewed" });
    }
    return event;
  }

  function createFolder(parentIdRaw, name, { silent = false } = {}) {
    const parentKey = normParent(parentIdRaw);
    const id = `N${String(nextNewSeq++).padStart(4, "0")}`;
    newFolders.set(id, { id, destParentId: parentKey, destName: name });
    indexAdd(parentKey, id);
    pushHistory(id, "destName", null, name);
    const event = { type: "create", id, parentKey };
    if (!silent) emit(event);
    return id;
  }

  // Shared mechanics for Trash and Pending: move a folder's override (or, for a
  // new/skeleton folder, its own destParentId/destName) to point at a reserved
  // bucket id, optionally suffixing the name for uniqueness, snapshotting the
  // prior position so it can be restored later.
  function moveToBucket(id, bucketId, { suffixName }) {
    const oldParentKey = effParentKey(id);
    if (oldParentKey === bucketId) return null;
    const baseName = effName(id);
    const newName = suffixName ? `${baseName}__${id}` : baseName;
    if (isNew(id)) {
      const nf = newFolders.get(id);
      nf._preBucket = { destParentId: nf.destParentId, destName: nf.destName };
      nf.destParentId = bucketId;
      nf.destName = newName;
    } else {
      setOverride(id, { destParentId: bucketId, destName: newName });
    }
    indexRemove(oldParentKey, id);
    indexAdd(bucketId, id);
    pushHistory(id, "destParentId", oldParentKey, bucketId);
    return { oldParentKey, newParentKey: bucketId };
  }

  function restoreFromBucket(id, bucketId) {
    const oldParentKey = effParentKey(id);
    if (oldParentKey !== bucketId) return null;
    let newParentKey;
    if (isNew(id)) {
      const nf = newFolders.get(id);
      const pre = nf._preBucket ?? { destParentId: null, destName: nf.destName.replace(/__[^_]+$/, "") };
      nf.destParentId = pre.destParentId;
      nf.destName = pre.destName;
      delete nf._preBucket;
      newParentKey = normParent(nf.destParentId);
    } else {
      overrides.delete(id);
      newParentKey = normParent(byId.get(id).parentId);
    }
    indexRemove(bucketId, id);
    indexAdd(newParentKey, id);
    pushHistory(id, "destParentId", bucketId, newParentKey);
    return { oldParentKey: bucketId, newParentKey };
  }

  function trash(id) {
    if (id === TRASH || id === PENDING) throw new Error(`Cannot trash the ${id} bucket itself`);
    const result = moveToBucket(id, TRASH, { suffixName: true });
    if (!result) return { type: "noop" };
    const event = { type: "trash", id, ...result };
    emit(event);
    if (!isNew(id) && markReviewedIfNeeded(id)) {
      emit({ type: "meta", id, field: "reviewed" });
    }
    return event;
  }

  function restore(id) {
    const result = restoreFromBucket(id, TRASH);
    if (!result) return { type: "noop" };
    const event = { type: "restore", id, ...result };
    emit(event);
    return event;
  }

  // Detach: explicitly stop inheriting wherever an ancestor's move would take
  // this folder, without yet choosing a real destination -- parks it in the
  // Pending bucket. Deliberately does NOT auto-mark reviewed: the point is to
  // flag "still needs a decision", so auto-reviewing it would hide that cue.
  function detach(id) {
    if (id === TRASH || id === PENDING) throw new Error(`Cannot detach the ${id} bucket itself`);
    const result = moveToBucket(id, PENDING, { suffixName: false });
    if (!result) return { type: "noop" };
    const event = { type: "detach", id, ...result };
    emit(event);
    return event;
  }

  function undetach(id) {
    const result = restoreFromBucket(id, PENDING);
    if (!result) return { type: "noop" };
    const event = { type: "undetach", id, ...result };
    emit(event);
    return event;
  }

  function revert(id) {
    if (isNew(id)) return { type: "noop" };
    if (!overrides.has(id)) return { type: "noop" };
    const oldParentKey = effParentKey(id);
    overrides.delete(id);
    const newParentKey = normParent(byId.get(id).parentId);
    if (oldParentKey !== newParentKey) {
      indexRemove(oldParentKey, id);
      indexAdd(newParentKey, id);
    }
    pushHistory(id, "revert", null, null);
    const event = { type: "move", id, oldParentKey, newParentKey };
    emit(event);
    return event;
  }

  // Marks a real folder as having filled a target-structure slot (see equate()
  // and toAfterWbData's `skeleton-slot` class) -- a persistent record, separate
  // from review status, so it can still be styled once review-status colors
  // have moved on (e.g. once "covered" folders get further reviewed directly).
  function markFromSkeleton(id) {
    const m = { ...(meta.get(id) ?? {}) };
    m.fromSkeleton = true;
    meta.set(id, m);
  }

  function findChildByName(parentKey, name) {
    const lower = name.toLocaleLowerCase();
    for (const id of getDestChildren(parentKey)) {
      if (effName(id).toLocaleLowerCase() === lower) return id;
    }
    return null;
  }

  // Walks the prospective merge tree for equate(realId, skeletonId) -- including
  // same-named collisions, which are auto-resolved by treating them as "this is
  // the same folder on both sides" (the reviewer already told us so by equating
  // their parents) rather than blocked -- and throws before any mutation happens
  // if a cycle or a genuinely unresolvable collision (skeleton vs. skeleton --
  // neither side is a real folder to merge into) would occur anywhere in it.
  // Populates `moves` (orphans to reparent directly, no collision) and `merges`
  // (colliding pairs to recursively fold together) so the actual mutation phase
  // in equate() can run straight through without re-deriving any of this.
  function planEquateMerges(realId, skeletonId, moves, merges) {
    for (const childId of getDestChildren(skeletonId)) {
      if (wouldCreateCycle(childId, realId)) {
        throw new Error(`Cannot equate: reparenting ${childId} onto ${realId} would create a cycle.`);
      }
      const existing = findChildByName(realId, effName(childId));
      if (existing === null) {
        moves.push({ childId, parentId: realId });
      } else if (isNew(existing)) {
        throw new Error(
          `Cannot equate: both "${effName(realId)}" and the target structure already have an unfilled ` +
            `"${effName(childId)}" placeholder here -- nothing real to merge it with. Resolve that first.`
        );
      } else {
        merges.push({ realChildId: existing, skeletonChildId: childId });
        planEquateMerges(existing, childId, moves, merges); // deeper same-named matches, if any
      }
    }
  }

  // "This real folder IS that target-structure skeleton folder": sourceId moves
  // + renames into skeletonId's exact slot. Anything already parented under the
  // skeleton gets reparented onto sourceId -- except where sourceId already has
  // a same-named child (e.g. a real "Team Meetings" subfolder matching the
  // skeleton's "Team Meetings" placeholder); that's treated as a match, not a
  // conflict, and the two are folded together the same way, recursively. Only
  // sourceId itself is marked reviewed -- everything folded in along the way
  // shows as "covered" (inheriting from sourceId) rather than reviewed on its
  // own, since the reviewer never looked at it directly. Every cycle/collision
  // check runs before any mutation, so the whole (possibly nested) merge is
  // still all-or-nothing.
  function equate(sourceId, skeletonId) {
    if (isNew(sourceId)) throw new Error("equate: the folder under review must be a real (source) folder.");
    const skeleton = newFolders.get(skeletonId);
    if (!skeleton) throw new Error("equate: target must be an existing target-structure folder.");
    if (skeletonId === TRASH || skeletonId === PENDING || skeleton.isTrash || skeleton.isPending) {
      throw new Error("equate: cannot equate with the Trash or Pending bucket.");
    }
    if (sourceId === skeletonId) throw new Error("equate: source and target must differ.");

    const destParentId = normParent(skeleton.destParentId);
    const destName = skeleton.destName;

    if (wouldCreateCycle(sourceId, destParentId)) {
      throw new Error(`Cannot equate: ${destParentId} is ${sourceId} or one of its own descendants.`);
    }
    const collision = checkSiblingCollision({ getDestChildren, effName }, destParentId, destName, skeletonId);
    if (collision) throw new Error(`Cannot equate: ${collision}`);

    const moves = [];
    const merges = [];
    planEquateMerges(sourceId, skeletonId, moves, merges);

    if (destName !== effName(sourceId)) rename(sourceId, destName);
    if (effParentKey(sourceId) !== destParentId) moveFolder(sourceId, destParentId);
    for (const { childId, parentId } of moves) moveFolder(childId, parentId);
    for (const { realChildId, skeletonChildId } of merges) {
      const parentKey = effParentKey(skeletonChildId);
      newFolders.delete(skeletonChildId);
      indexRemove(parentKey, skeletonChildId);
      pushHistory(skeletonChildId, "equate", skeletonChildId, realChildId);
      markFromSkeleton(realChildId);
    }

    newFolders.delete(skeletonId);
    indexRemove(destParentId, skeletonId);
    pushHistory(skeletonId, "equate", skeletonId, sourceId);
    markFromSkeleton(sourceId);

    if (markReviewedIfNeeded(sourceId)) emit({ type: "meta", id: sourceId, field: "reviewed" });

    const event = {
      type: "equate",
      sourceId,
      skeletonId,
      destParentId,
      reparented: moves.map((m) => m.childId),
      merged: merges.map((m) => ({ realId: m.realChildId, skeletonId: m.skeletonChildId })),
      newParentKey: destParentId,
    };
    emit(event);
    return event;
  }

  // Recursively creates folders from a hand-authored skeleton (see the
  // "target structure" JSON schema). Purely additive to the current plan's
  // newFolders -- loading the same file twice will duplicate nodes, by design
  // (no attempt to de-duplicate against a prior load). Validates as it goes and
  // rolls back everything it created if any node fails partway through, so a
  // bad node deep in a large file never leaves a half-built skeleton behind.
  function loadTargetStructure(json) {
    const roots = Array.isArray(json) ? json : Array.isArray(json?.children) ? json.children : [];
    if (roots.length === 0) throw new Error("Target structure JSON has no children to load.");

    const createdIds = [];
    function rollback() {
      for (let i = createdIds.length - 1; i >= 0; i--) {
        const id = createdIds[i];
        const nf = newFolders.get(id);
        if (!nf) continue;
        indexRemove(normParent(nf.destParentId), id);
        newFolders.delete(id);
      }
    }
    function addNode(node, parentKey, pathForErrors) {
      const name = typeof node?.name === "string" ? node.name.trim() : "";
      const here = pathForErrors ? `${pathForErrors}/${name || "(blank)"}` : name || "(blank)";
      const illegal = checkIllegalName(name);
      if (illegal) throw new Error(`Target structure "${here}": ${illegal}`);
      const collision = checkSiblingCollision({ getDestChildren, effName }, parentKey, name, null);
      if (collision) throw new Error(`Target structure "${here}": ${collision}`);
      const id = createFolder(parentKey, name, { silent: true });
      createdIds.push(id);
      for (const child of Array.isArray(node.children) ? node.children : []) addNode(child, id, here);
    }
    try {
      for (const top of roots) addNode(top, ROOT, "");
    } catch (err) {
      rollback();
      throw err;
    }
    emit({ type: "bulk-create", ids: createdIds });
    return { createdIds, count: createdIds.length };
  }

  function setNote(id, note) {
    const m = { ...(meta.get(id) ?? {}) };
    m.note = note;
    meta.set(id, m);
    emit({ type: "meta", id, field: "note" });
  }

  // "default" (neither), "reviewed", or "flagged" -- mutually exclusive by
  // construction (a three-way radio in the editor, not two independent
  // checkboxes), so setting one always clears the other. Emits field:
  // "reviewed" when meta.reviewed actually changed (either direction), since
  // that's the one that can change descendants' "covered" status and needs
  // trees.js's cascading refresh; otherwise field: "flagged", which only ever
  // needs to refresh this one row. Either way, the refresh reads reviewStatus()
  // fresh from the already-updated meta, so it always ends up showing the
  // right one of the two changed fields regardless of which event fired.
  function setReviewMark(id, mark) {
    const m = { ...(meta.get(id) ?? {}) };
    const wasReviewed = !!m.reviewed;
    m.reviewed = mark === "reviewed";
    m.flagged = mark === "flagged";
    meta.set(id, m);
    emit({ type: "meta", id, field: wasReviewed !== m.reviewed ? "reviewed" : "flagged" });
  }

  // Sets meta.reviewed=true (clearing any flag) if it isn't already; returns
  // whether it changed. Used to auto-review a folder on a manual placement
  // decision (move/trash/equate) without spuriously re-emitting when it was
  // already reviewed. Clearing the flag here too is the same reasoning as
  // setReviewMark: an action that resolves a folder's placement is a stronger
  // signal than "come back to this later", so it supersedes the flag.
  function markReviewedIfNeeded(id) {
    const m = { ...(meta.get(id) ?? {}) };
    if (m.reviewed) return false;
    m.reviewed = true;
    m.flagged = false;
    meta.set(id, m);
    return true;
  }

  function getMeta(id) {
    return meta.get(id) ?? {};
  }

  function allIds() {
    return [...byId.keys(), ...newFolders.keys()];
  }

  function sourceIds() {
    return [...byId.keys()];
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    ROOT,
    TRASH,
    PENDING,
    init,
    newPlan,
    unload,
    loadPlan,
    toPlanJson,
    isNew,
    srcName,
    effName,
    effParentKey,
    filesOf,
    isInferred,
    destPath,
    srcPath,
    getSourceChildren,
    getDestChildren,
    srcAncestorChain,
    destAncestorChain,
    srcDescendantIds,
    descendantCount,
    folderStatus,
    reviewStatus,
    isEmptySubtree,
    mergeFacts,
    mergeExtensions,
    setStaleThresholdDays,
    folderFacts,
    folderExtensions,
    isStale,
    factsStatus,
    exportSourceJson,
    getBeforeRoot,
    getBeforeChildren,
    getAfterRoot,
    getAfterChildren,
    rename,
    moveFolder,
    createFolder,
    trash,
    restore,
    detach,
    undetach,
    revert,
    equate,
    loadTargetStructure,
    setNote,
    setReviewMark,
    getMeta,
    allIds,
    sourceIds,
    subscribe,
    get sourceRoot() {
      return sourceRoot;
    },
    get sourceHash() {
      return sourceHash;
    },
    get staleThresholdDays() {
      return staleThresholdDays;
    },
  };
}
