// The only file that touches the Wunderbaum API directly. Two instances share one
// store: `before` (read-only) and `after` (editable). See handoff.md section 5,
// "Tree sync semantics".

import { Wunderbaum } from "wunderbaum";
import "wunderbaum/dist/wunderbaum.css";
import { getErrors } from "../model/validate.js";

// Factories, not shared objects: Wunderbaum's resizer (see columnsResizable
// below) mutates a column's definition object in place (colDef.customWidthPx
// = ...) to remember a drag. Before and After are separate trees with their
// own Files/Status columns -- if both pointed at the same object, resizing
// one tree's Files column would silently resize the other tree's too, since
// they'd be reading/writing the same customWidthPx. Each mount*() call below
// gets its own fresh set. minWidth clamps how far a drag can shrink a column
// -- without it the resizer will happily crush one to Wunderbaum's own 4px
// default, which is only a hairline once collapsed.
const filesCol = () => ({ id: "files", title: "Files", width: "70px", minWidth: "40px" });
const statusCol = () => ({ id: "status", title: "Status", width: "110px", minWidth: "60px" });
// The "*" (title) column has no fixed width -- it's weighted to auto-fill
// whatever space Files/Status don't take. Shrinking Files/Status via their
// resizer hands the freed space straight to this column for free (no code
// needed), which is the main payoff for "deep folder path" visibility;
// dragging the resizer directly after "*" instead pins it to an explicit
// width of its own. minWidth only matters for the latter case.
const TITLE_COL_MIN_WIDTH = "160px";

// Custom emoji-based icon set (see styles.css for the ::before glyphs). Wunderbaum's
// default iconMap points at an icon font (bootstrap-icons) that isn't bundled --
// these class names are resolved entirely from our own CSS, so no extra font asset
// is needed to stay offline/file://-friendly.
const ICON_MAP = {
  folder: "wbi-folder",
  folderOpen: "wbi-folder-open",
  folderLazy: "wbi-folder",
  doc: "wbi-folder",
  loading: "wbi-loading",
  error: "wbi-error",
  expanderExpanded: "wbi-exp-open",
  expanderCollapsed: "wbi-exp-closed",
  expanderLazy: "wbi-exp-closed",
};

function filesColumnText(node) {
  const f = node.data.files;
  if (node.data.isNew) return "";
  if (f === null || f === undefined) return "?";
  return String(f);
}

// Walks ancestor ids (top -> target, inclusive), expanding/lazy-loading each level,
// then scrolls to and activates the final node. Used for both reveal directions and
// for search results. No-ops quietly if any ancestor can't be found (e.g. a new
// folder with no source counterpart, or an id the tree hasn't got data for).
//
// `refs.syncing` is a re-entrancy guard: activating the revealed node fires that
// tree's own `activate` handler, which would otherwise reveal back into the
// originating tree and ping-pong forever. Set while the sync-driven activation is
// in flight so the nested `activate` handler can recognise it's not a real user
// click and skip cross-revealing again.
export async function reveal(tree, chain, refs) {
  if (!chain || chain.length === 0) return;
  let node = tree.findKey(chain[0]);
  if (!node) return;
  for (let i = 1; i < chain.length; i++) {
    await node.setExpanded(true);
    node = tree.findKey(chain[i]);
    if (!node) return;
  }
  await node.makeVisible({ scrollIntoView: true });
  if (refs) refs.syncing = true;
  try {
    await node.setActive(true, { activate: true });
  } finally {
    if (refs) refs.syncing = false;
  }
}

// Wunderbaum's own tree.load()/node.loadLazy() are async, and a store mutation
// can emit several events back-to-back synchronously (e.g. equate() cascades a
// rename + a couple of moveFolder calls, each emitting separately) -- letting
// their refreshes run concurrently is unsafe: a full tree.load() tears down
// node objects that a same-tick node.loadLazy() elsewhere may still be mid-way
// through using, which Wunderbaum surfaces as an internal null-reference error.
// Funnel every tree-touching refresh through one chain per tree so they always
// run one at a time, in order.
function makeRefreshQueue() {
  let chain = Promise.resolve();
  return function enqueue(work) {
    chain = chain.then(work, work); // keep the chain alive even if a step throws
    return chain;
  };
}

// Refreshes a destination-tree parent's children after a store mutation, without
// collapsing it if it's currently open. `rootData()` supplies fresh top-level data
// when parentKey is the virtual ROOT container (which isn't a real node).
async function refreshParent(tree, store, parentKey, rootData) {
  if (parentKey === store.ROOT) {
    await tree.load(rootData());
    return;
  }
  const node = tree.findKey(parentKey);
  if (!node) return; // branch was never expanded -- nothing rendered to refresh
  await node.loadLazy(true);
}

// Live-refreshes one node's `review-*` class (see store.js's reviewStatus) without
// a full lazy-reload -- `setClass` persists across re-renders. No-ops quietly for
// a node that isn't currently materialized (findKey returns null); it'll simply
// compute the right class next time it's lazily loaded, since toBeforeWbData/
// toAfterWbData always compute `classes` fresh from the store.
function applyReviewClass(node, store) {
  if (!node) return;
  const newClass = `review-${store.reviewStatus(node.key)}`;
  if (node.classes) {
    for (const c of [...node.classes]) {
      if (c.startsWith("review-") && c !== newClass) node.setClass(c, false);
    }
  }
  node.setClass(newClass, true);
}

// Live-refreshes one node's `stale-folder` class (see store.js's isStale) --
// same setClass mechanism as applyReviewClass, just a plain boolean toggle
// rather than a swap between mutually-exclusive class names. Used both when
// new facts data is merged and when the staleness threshold itself changes,
// since both fire the same store "facts-changed" event (see mountBefore).
function applyStaleClass(node, store) {
  if (!node) return;
  node.setClass("stale-folder", store.isStale(node.key) === true);
}

// Marking one folder reviewed can change the displayed status of its whole
// source-subtree (a "covered" child needs to redraw once its covering ancestor
// changes) -- walk it, but only touch nodes that are actually materialized.
function refreshReviewStatus(tree, store, id) {
  applyReviewClass(tree.findKey(id), store);
  if (!store.isNew(id)) {
    for (const did of store.srcDescendantIds(id)) applyReviewClass(tree.findKey(did), store);
  }
}

export function mountBefore(container, store, refs, onActivate) {
  const tree = new Wunderbaum({
    element: container,
    id: "tree-before",
    source: store.getBeforeRoot(),
    iconMap: ICON_MAP,
    columnsResizable: true,
    columns: [{ id: "*", title: "Folder (Before)", minWidth: TITLE_COL_MIN_WIDTH }, filesCol()],
    lazyLoad: (e) => store.getBeforeChildren(e.node.key),
    render: (e) => {
      for (const col of Object.values(e.renderColInfosById)) {
        if (col.id === "files") col.elem.textContent = filesColumnText(e.node);
      }
    },
    // Before-tree clicks are the only thing that sets "the folder under review" --
    // see mountAfter's activate handler for why this must bail out entirely when
    // `refs.syncing` (i.e. this activation is just an echo from the user browsing
    // the After tree, not a real click here). `refs.linkBefore` is the pane's own
    // link-toggle button: only reveal into the After tree while it's pressed.
    activate: (e) => {
      if (refs.syncing) return;
      onActivate(e.node.key, "before");
      if (refs.linkBefore && refs.after) reveal(refs.after, store.destAncestorChain(e.node.key), refs);
    },
  });
  refs.before = tree;

  // The Before tree's own structure never changes, but review status (driven by
  // `meta.reviewed`) does -- across a plan reset and on every reviewed toggle.
  const enqueue = makeRefreshQueue();
  store.subscribe((event) => {
    if (event.type === "reset") {
      enqueue(() => tree.load(store.getBeforeRoot()));
      return;
    }
    if (event.type === "meta" && event.field === "reviewed") {
      enqueue(() => refreshReviewStatus(tree, store, event.id));
    } else if (event.type === "meta" && event.field === "flagged") {
      // Unlike "reviewed", flagging never changes any OTHER folder's status
      // (no "covered"-style cascade) -- just this one row.
      enqueue(() => applyReviewClass(tree.findKey(event.id), store));
    } else if (event.type === "facts-changed") {
      // Fired by a fresh facts/extensions merge OR a threshold change (see
      // store.js) -- either way, every currently-materialized row's stale
      // class may need to flip. tree.visit() walks only already-loaded nodes
      // without triggering any lazy-load (confirmed against Wunderbaum's own
      // source), so this is a single cheap pass even at 100k-folder scale --
      // no tree.load() needed, unlike a plan "reset".
      enqueue(() => tree.visit((node) => applyStaleClass(node, store)));
    }
  });

  return tree;
}

export function mountAfter(container, store, refs, onActivate) {
  const rootData = () => store.getAfterRoot();

  const tree = new Wunderbaum({
    element: container,
    id: "tree-after",
    source: rootData(),
    iconMap: ICON_MAP,
    columnsResizable: true,
    columns: [{ id: "*", title: "Folder (After)", minWidth: TITLE_COL_MIN_WIDTH }, filesCol(), statusCol()],
    lazyLoad: (e) => store.getAfterChildren(e.node.key),
    render: (e) => {
      for (const col of Object.values(e.renderColInfosById)) {
        if (col.id === "files") col.elem.textContent = filesColumnText(e.node);
        else if (col.id === "status") col.elem.textContent = e.node.data.status ?? "";
      }
    },
    // After-tree clicks are navigation only -- they update the "move target" (see
    // editor.js's Move Here button) without disturbing which folder is under review.
    // `onActivate` still runs even during a sync echo from a Before-tree click,
    // since landing the After cursor on the counterpart is a good default move
    // target; only the reveal-cascade back into Before is guarded against.
    // `refs.linkAfter` is this pane's own link-toggle button: only reveal into the
    // Before tree while it's pressed (off by default -- this is exactly the
    // "clicking After moves Before's highlight" behavior the toggle controls).
    activate: (e) => {
      onActivate(e.node.key, "after");
      if (refs.syncing) return;
      if (refs.linkAfter && refs.before && !store.isNew(e.node.key)) {
        reveal(refs.before, store.srcAncestorChain(e.node.key), refs);
      }
    },
    // Drag-and-drop reparenting (moveFolder/trash/detach via a dropped node) was
    // deliberately removed -- not needed in practice (the editor panel's "Move Here"
    // already covers moving a folder), and a stray drag ending outside any
    // Wunderbaum-recognized drop target would fall through to the browser's default
    // "navigate to whatever was dragged" behavior, which file://'s unique-per-load
    // origin then blocks with a console warning ("Unsafe attempt to load URL
    // .../index.html from frame with URL .../index.html") -- harmless, since Chrome
    // blocks the navigation outright, but not worth the surface area to keep around
    // for a feature that isn't used. Without a `dnd.dragStart` callback, Wunderbaum's
    // own dnd extension defaults to disabled (dragStart: null) and never makes nodes
    // draggable in the first place, so this isn't a workaround -- there's no drag to
    // go stray anymore.
    edit: {
      trigger: ["clickActive", "F2"],
      apply: (e) => {
        if (e.node.key === store.TRASH || e.node.key === store.PENDING) {
          throw new Wunderbaum.util.ValidationError("Cannot rename the Trash/Pending bucket here.");
        }
        const newName = e.inputElem.value.trim();
        const parentKey = store.effParentKey(e.node.key);
        const errors = getErrors(store, e.node.key, newName, parentKey);
        if (errors.length) throw new Wunderbaum.util.ValidationError(errors[0]);
        store.rename(e.node.key, newName);
      },
    },
  });
  refs.after = tree;

  const enqueue = makeRefreshQueue();
  store.subscribe((event) => {
    if (event.type === "reset" || event.type === "bulk-create") {
      // bulk-create (loadTargetStructure) has no single parentKey -- nodes can
      // land at arbitrary depths -- so just reload the whole tree; this only
      // happens on a deliberate, infrequent "Load target structure…" action.
      enqueue(() => tree.load(rootData()));
      return;
    }
    if (event.type === "equate" && event.merged?.length) {
      // A same-named collision was auto-resolved (see store.js's equate/
      // planEquateMerges) -- those merges can land at arbitrary depths below
      // destParentId, not just directly under it, so the generic oldParentKey/
      // newParentKey refresh below wouldn't reach them all. Only pay for a full
      // reload when a merge actually happened; the common, non-colliding equate
      // still gets the narrower refresh further down.
      enqueue(() => tree.load(rootData()));
      return;
    }
    if (event.type === "meta") {
      if (event.field === "reviewed") enqueue(() => refreshReviewStatus(tree, store, event.id));
      else if (event.field === "flagged") enqueue(() => applyReviewClass(tree.findKey(event.id), store));
      return;
    }
    if (event.type === "rename") {
      enqueue(() => {
        const node = tree.findKey(event.id);
        if (node) node.setTitle(store.effName(event.id));
      });
      return;
    }
    if (event.type === "noop") return;
    // move / trash / restore / create: the node's parent bucket changed.
    if (event.oldParentKey !== undefined) enqueue(() => refreshParent(tree, store, event.oldParentKey, rootData));
    if (event.newParentKey !== undefined) enqueue(() => refreshParent(tree, store, event.newParentKey, rootData));
    if (event.parentKey !== undefined) enqueue(() => refreshParent(tree, store, event.parentKey, rootData));
  });

  return tree;
}
