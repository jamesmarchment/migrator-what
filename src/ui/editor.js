// Middle panel: shows/edits the currently active folder. Bound to store mutations,
// not to Wunderbaum directly -- trees.js's `onActivate` callback drives `show(id)`.

import { getErrors } from "../model/validate.js";
import { formatBytes, extClassName } from "../model/folderFacts.js";

const STATUS_LABEL = {
  unchanged: "Unchanged",
  renamed: "Renamed",
  moved: "Moved",
  "moved+renamed": "Moved + renamed",
  deleted: "Deleted (in Trash)",
  new: "New folder",
  trash: "Trash",
  pending: "Pending (parked, no decision yet)",
  "pending-bucket": "Pending (holding area)",
};

export function mountEditor(container, store, refs) {
  container.innerHTML = `
    <div class="editor-empty">Select a folder in either tree to review it.</div>
    <div class="editor-body" hidden>
      <div class="editor-row editor-cols">
        <div class="editor-col"><label>ID</label><span data-f="id"></span></div>
        <div class="editor-col editor-col-right"><label>Status</label><span class="badge" data-f="status"></span></div>
      </div>
      <div class="editor-row"><label>Source path</label><div class="editor-path" data-f="srcPath"></div></div>
      <div class="editor-row">
        <label>Destination path</label>
        <div class="dest-path-row">
          <div class="editor-path" data-f="destPath"></div>
          <button type="button" class="icon-btn" data-a="editDestParent" title="Edit destination folder">✏️</button>
          <input type="text" list="parent-options" data-f="parentInput" autocomplete="off" hidden />
        </div>
        <datalist id="parent-options" data-f="parentOptions"></datalist>
        <div class="editor-error" data-f="parentError"></div>
      </div>
      <div class="editor-row">
        <label>Folder Name</label>
        <input type="text" data-f="nameInput" autocomplete="off" />
        <div class="editor-error" data-f="nameError"></div>
      </div>
      <div class="editor-row">
        <label>Target / Destination Folder</label>
        <div class="move-here-box">
          <div class="editor-path" data-f="moveTargetPath">(click a folder in the After tree to pick a destination)</div>
          <div class="move-here-actions">
            <button type="button" data-a="moveHere" disabled>Move Here</button>
            <button type="button" data-a="equivalent" disabled title="Replace the target-structure skeleton folder with this real folder">These Are Equivalent</button>
          </div>
        </div>
        <div class="editor-error" data-f="moveTargetError"></div>
      </div>
      <div class="editor-row editor-cols">
        <div class="editor-col"><label>Direct files</label><span data-f="files"></span></div>
        <div class="editor-col"><label>Descendants (After tree)</label><span data-f="descendants"></span></div>
      </div>
      <div class="editor-row facts-row" data-f="factsSection" hidden>
        <label>Folder contents (from loaded facts data)</label>
        <div class="facts-warning" data-f="factsPartialNote" hidden>
          ⚠ Loaded from a partial scan -- treat this as a lower bound, not a reliable signal.
        </div>
        <div class="facts-nodata" data-f="factsNoDataNote" hidden>
          No facts data for this folder (not in the loaded scan, or it was inaccessible during the scan).
        </div>
        <div data-f="factsBody" hidden>
          <div>Direct: <span data-f="factsDirect"></span></div>
          <div data-f="factsSubtreeRow" hidden>Subtree (this + everything under it): <span data-f="factsSubtree"></span></div>
          <div data-f="factsAgeRow" hidden>Last write anywhere in subtree: <span data-f="factsAge"></span></div>
          <div class="facts-ext-grid" data-f="factsExtList"></div>
        </div>
      </div>
      <div class="editor-row">
        <label>Note</label>
        <textarea data-f="note" rows="3"></textarea>
      </div>
      <div class="editor-row review-mark-row">
        <label><input type="radio" name="review-mark" data-f="markDefault" value="default" /> Default</label>
        <label><input type="radio" name="review-mark" data-f="markReviewed" value="reviewed" /> Reviewed</label>
        <label><input type="radio" name="review-mark" data-f="markFlagged" value="flagged" /> Flag for Follow-Up</label>
      </div>
      <div class="editor-actions">
        <button type="button" data-a="delete">Delete (move to Trash)</button>
        <button type="button" data-a="restore">Restore</button>
        <button type="button" data-a="detach">Detach (no inherited move)</button>
        <button type="button" data-a="undetach">Undo Detach</button>
        <button type="button" data-a="revert">Revert to original</button>
      </div>
    </div>
  `;

  const f = {};
  for (const el of container.querySelectorAll("[data-f]")) f[el.dataset.f] = el;
  const a = {};
  for (const el of container.querySelectorAll("[data-a]")) a[el.dataset.a] = el;
  const emptyEl = container.querySelector(".editor-empty");
  const bodyEl = container.querySelector(".editor-body");

  let currentId = null;
  let moveTargetId = null;
  let parentPathToId = new Map();

  function isReservedBucket(id) {
    return id === store.TRASH || id === store.PENDING;
  }

  function rebuildParentOptions() {
    parentPathToId = new Map();
    f.parentOptions.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const id of store.allIds()) {
      if (isReservedBucket(id)) continue;
      const path = store.destPath(id);
      parentPathToId.set(path, id);
      const opt = document.createElement("option");
      opt.value = path;
      frag.appendChild(opt);
    }
    f.parentOptions.appendChild(frag);
  }

  // Destination path starts read-only (a plain path string); the pencil button
  // swaps it for the same "type a path" parent-input this used to always show
  // as its own row -- same commit logic (the `change` listener below), just
  // tucked away until asked for, since browsing the After tree is the
  // preferred way to pick a destination.
  let destPathEditing = false;
  function toggleDestPathEdit(editing) {
    destPathEditing = editing;
    f.destPath.hidden = editing;
    a.editDestParent.hidden = editing;
    f.parentInput.hidden = !editing;
    if (editing) {
      f.parentError.textContent = "";
      f.parentInput.focus();
      f.parentInput.select();
    }
  }

  function refresh() {
    toggleDestPathEdit(false);
    refreshMoveTarget();
    if (currentId === null) {
      emptyEl.hidden = false;
      bodyEl.hidden = true;
      return;
    }
    const id = currentId;
    emptyEl.hidden = true;
    bodyEl.hidden = false;

    const status = store.folderStatus(id);
    f.id.textContent = id;
    f.srcPath.textContent = store.isNew(id) ? "(new folder -- no source counterpart)" : store.srcPath(id);
    f.destPath.textContent = store.destPath(id);
    f.status.textContent = STATUS_LABEL[status] ?? status;
    f.status.className = `badge badge-${status.replace("+", "-")}`;
    f.nameInput.value = store.effName(id);
    const parentKey = store.effParentKey(id);
    f.parentInput.value = parentKey === store.ROOT ? "(top level)" : store.destPath(parentKey);
    const filesVal = store.filesOf(id);
    f.files.textContent = store.isNew(id) ? "—" : filesVal === null ? "unknown" : String(filesVal);
    f.descendants.textContent = String(store.descendantCount(id));
    refreshFacts(id);
    const meta = store.getMeta(id);
    f.note.value = meta.note ?? "";
    const mark = meta.reviewed ? "reviewed" : meta.flagged ? "flagged" : "default";
    f.markDefault.checked = mark === "default";
    f.markReviewed.checked = mark === "reviewed";
    f.markFlagged.checked = mark === "flagged";
    f.nameError.textContent = "";
    f.parentError.textContent = "";

    const inTrash = parentKey === store.TRASH;
    const inPending = parentKey === store.PENDING;
    a.delete.disabled = isReservedBucket(id) || inTrash;
    a.restore.disabled = !inTrash;
    a.detach.disabled = isReservedBucket(id) || inTrash || inPending;
    a.undetach.disabled = !inPending;
    a.revert.disabled = store.isNew(id) || status === "unchanged";
  }

  function show(id) {
    currentId = id;
    rebuildParentOptions();
    refresh();
  }

  // Three graceful-degradation levels, so "no facts data was ever loaded"
  // (the common case) costs nothing beyond one hidden check: (1) nothing
  // loaded at all -- whole section stays hidden; (2) facts loaded but this
  // exact folder has none (not in the scan, or it was inaccessible) -- a
  // one-line note, no numbers; (3) data present -- direct/subtree size, age,
  // and up to 8 extensions by bytes, capped so this stays "not overwhelming"
  // per the original ask rather than dumping every extension in the folder.
  const MAX_EXTENSIONS_SHOWN = 8;
  function refreshFacts(id) {
    const status = store.factsStatus();
    const hasAnyFacts = !!status.factsStamp || !!status.extensionsStamp;
    f.factsSection.hidden = !hasAnyFacts;
    if (!hasAnyFacts) return;

    f.factsPartialNote.hidden = !(status.factsPartial || status.extensionsPartial);

    const facts = store.folderFacts(id);
    const ext = store.folderExtensions(id);
    f.factsNoDataNote.hidden = !!facts || !!ext;
    f.factsBody.hidden = !facts && !ext;

    if (facts) {
      f.factsDirect.textContent = `${facts.directFiles} file(s), ${formatBytes(facts.directBytes)}`;
      f.factsSubtreeRow.hidden = !status.factsHasSubtree;
      if (status.factsHasSubtree) {
        f.factsSubtree.textContent = `${facts.subtreeFiles} file(s), ${formatBytes(facts.subtreeBytes)}`;
      }
      const stale = store.isStale(id);
      f.factsAgeRow.hidden = stale === null;
      if (stale !== null) {
        const days = Math.round((Date.now() - Date.parse(facts.subtreeNewestWriteUtc)) / 86400000);
        f.factsAge.textContent = `${days} day(s) ago${stale ? " — STALE" : ""}`;
      }
    } else {
      f.factsSubtreeRow.hidden = true;
      f.factsAgeRow.hidden = true;
    }

    f.factsExtList.innerHTML = "";
    if (ext) {
      const top = [...ext].sort((a2, b2) => b2.bytes - a2.bytes).slice(0, MAX_EXTENSIONS_SHOWN);
      for (const e of top) {
        const item = document.createElement("div");
        item.className = "facts-ext-item";
        item.title = `${e.extension}: ${e.count} file(s), ${formatBytes(e.bytes)}`;

        // extClassName (model/folderFacts.js) never fails or falls back to a
        // fixed list -- an extension styles.css has no icon rule for yet
        // just inherits .facts-ext-icon's own default (icons/svg/file.svg).
        // Adding a new file type is then purely a CSS + SVG change, no JS.
        const icon = document.createElement("div");
        icon.className = `facts-ext-icon ${extClassName(e.extension)}`;
        item.appendChild(icon);

        // Three stacked lines -- type, then count, then size -- as separate
        // elements rather than one string with <br>, so each line can carry
        // its own styling and nothing here ever touches innerHTML.
        const label = document.createElement("div");
        label.className = "facts-ext-label";
        const typeLine = document.createElement("div");
        typeLine.className = "facts-ext-label-type";
        typeLine.textContent = e.extension;
        const countLine = document.createElement("div");
        countLine.className = "facts-ext-label-count";
        countLine.textContent = `${e.count} file(s)`;
        const sizeLine = document.createElement("div");
        sizeLine.className = "facts-ext-label-size";
        sizeLine.textContent = formatBytes(e.bytes);
        label.append(typeLine, countLine, sizeLine);
        item.appendChild(label);

        f.factsExtList.appendChild(item);
      }
      if (ext.length > top.length) {
        const more = document.createElement("div");
        more.className = "facts-ext-more";
        more.textContent = `+${ext.length - top.length} more`;
        f.factsExtList.appendChild(more);
      }
    }
  }

  function refreshMoveTarget() {
    f.moveTargetError.textContent = "";
    if (moveTargetId === null) {
      f.moveTargetPath.textContent = "(click a folder in the After tree to pick a destination)";
      a.moveHere.disabled = true;
      a.equivalent.disabled = true;
      return;
    }
    f.moveTargetPath.textContent = store.destPath(moveTargetId);
    const targetIsBucket = isReservedBucket(moveTargetId);
    a.moveHere.disabled = currentId === null || targetIsBucket;
    a.equivalent.disabled = currentId === null || !store.isNew(moveTargetId) || targetIsBucket;
  }

  // Called from trees.js's After-tree `activate` handler (navigation only -- see
  // main.js's onActivate). Does not touch `currentId` / the folder under review.
  function setMoveTarget(id) {
    moveTargetId = id;
    refreshMoveTarget();
  }

  f.nameInput.addEventListener("change", () => {
    if (currentId === null) return;
    const name = f.nameInput.value.trim();
    const errors = getErrors(store, currentId, name, store.effParentKey(currentId));
    if (errors.length) {
      f.nameError.textContent = errors[0];
      return;
    }
    f.nameError.textContent = "";
    store.rename(currentId, name);
  });

  f.parentInput.addEventListener("change", () => {
    if (currentId === null) return;
    const typed = f.parentInput.value.trim();
    if (typed === "(top level)") {
      store.moveFolder(currentId, null);
      return;
    }
    const targetId = parentPathToId.get(typed);
    if (!targetId) {
      f.parentError.textContent = "Not a known folder path. Pick one from the list.";
      return;
    }
    const errors = getErrors(store, currentId, store.effName(currentId), targetId);
    if (errors.length) {
      f.parentError.textContent = errors[0];
      return;
    }
    try {
      f.parentError.textContent = "";
      store.moveFolder(currentId, targetId);
    } catch (err) {
      f.parentError.textContent = err.message;
    }
  });

  a.editDestParent.addEventListener("click", () => toggleDestPathEdit(true));
  f.parentInput.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || currentId === null) return;
    const parentKey = store.effParentKey(currentId);
    f.parentInput.value = parentKey === store.ROOT ? "(top level)" : store.destPath(parentKey);
    f.parentInput.blur();
  });
  f.parentInput.addEventListener("blur", () => {
    // A successful commit already closes this via refresh() (see toggleDestPathEdit
    // at the top of refresh()); this covers clicking away with no change made, or
    // after Escape resets the value back to its original.
    if (!f.parentError.textContent) toggleDestPathEdit(false);
  });

  f.note.addEventListener("change", () => {
    if (currentId !== null) store.setNote(currentId, f.note.value);
  });
  for (const [el, mark] of [
    [f.markDefault, "default"],
    [f.markReviewed, "reviewed"],
    [f.markFlagged, "flagged"],
  ]) {
    el.addEventListener("change", () => {
      if (currentId !== null && el.checked) store.setReviewMark(currentId, mark);
    });
  }

  a.delete.addEventListener("click", () => {
    if (currentId === null) return;
    const n = store.descendantCount(currentId);
    if (n > 0 && !window.confirm(`This folder has ${n} descendant(s) in the After tree. They will move to Trash with it. Continue?`)) {
      return;
    }
    store.trash(currentId);
  });
  a.restore.addEventListener("click", () => {
    if (currentId !== null) store.restore(currentId);
  });
  a.detach.addEventListener("click", () => {
    if (currentId !== null) store.detach(currentId);
  });
  a.undetach.addEventListener("click", () => {
    if (currentId !== null) store.undetach(currentId);
  });
  a.revert.addEventListener("click", () => {
    if (currentId !== null) store.revert(currentId);
  });
  a.moveHere.addEventListener("click", () => {
    if (currentId === null || moveTargetId === null) return;
    const errors = getErrors(store, currentId, store.effName(currentId), moveTargetId);
    if (errors.length) {
      f.moveTargetError.textContent = errors[0];
      return;
    }
    try {
      f.moveTargetError.textContent = "";
      store.moveFolder(currentId, moveTargetId);
    } catch (err) {
      f.moveTargetError.textContent = err.message;
    }
  });
  a.equivalent.addEventListener("click", () => {
    if (currentId === null || moveTargetId === null) return;
    try {
      f.moveTargetError.textContent = "";
      store.equate(currentId, moveTargetId);
      // The skeleton at moveTargetId no longer exists -- currentId now sits
      // exactly where it was, so follow the cursor there rather than leaving a
      // stale reference to a deleted folder.
      moveTargetId = currentId;
      refreshMoveTarget();
    } catch (err) {
      f.moveTargetError.textContent = err.message;
    }
  });
  store.subscribe((event) => {
    if (event.type === "reset") {
      currentId = null;
      moveTargetId = null;
      refresh();
      return;
    }
    // A facts/extensions merge or threshold change only ever affects the
    // facts sub-section of whichever folder is currently shown -- cheap,
    // not a reason to touch the rest of refresh().
    if (event.type === "facts-changed") {
      if (currentId !== null) refreshFacts(currentId);
      return;
    }
    // Keep the move-target display live if that folder itself was edited elsewhere.
    if (moveTargetId !== null && (event.id === moveTargetId || event.newParentKey === moveTargetId)) {
      refreshMoveTarget();
    }
    if (currentId === null) return;
    if (event.id === currentId || event.oldParentKey === currentId || event.newParentKey === currentId) {
      refresh();
    }
  });

  return { show, setMoveTarget };
}
