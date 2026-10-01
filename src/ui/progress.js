// Review-progress: what fraction of SOURCE folders have been marked "Reviewed"
// (see the checkbox in editor.js), "Flagged for Follow-Up", implicitly covered
// because a source-tree ancestor was reviewed, or untouched. Two views share
// computeProgress: the full modal (computed on open, not kept live -- a full
// scan over every source folder's ancestor chain is fine for an on-open modal,
// not something to run per keystroke) and a small unlabeled bar mounted
// straight in the toolbar (mountMiniProgressBar), which *is* kept live -- see
// its own comment for why that's still fine at 100k-folder scale.

export function computeProgress(store) {
  const ids = store.sourceIds();
  let reviewed = 0;
  let flagged = 0;
  let covered = 0;
  let unreviewed = 0;
  for (const id of ids) {
    const status = store.reviewStatus(id);
    if (status === "reviewed") reviewed++;
    else if (status === "flagged") flagged++;
    else if (status === "covered") covered++;
    else unreviewed++;
  }
  return { total: ids.length, reviewed, flagged, covered, unreviewed };
}

function pct(n, total) {
  return total === 0 ? 0 : (100 * n) / total;
}

export function mountProgressModal(store) {
  const dialog = document.createElement("dialog");
  dialog.id = "progress-modal";
  dialog.innerHTML = `
    <h3>Review Progress</h3>
    <div class="progress-bar">
      <div class="progress-seg-reviewed" data-f="segReviewed"></div>
      <div class="progress-seg-flagged" data-f="segFlagged"></div>
      <div class="progress-seg-covered" data-f="segCovered"></div>
      <div class="progress-seg-unreviewed" data-f="segUnreviewed"></div>
    </div>
    <ul class="progress-legend">
      <li><span class="progress-dot dot-reviewed"></span> Reviewed <b data-f="numReviewed"></b></li>
      <li><span class="progress-dot dot-flagged"></span> Flagged for Follow-Up <b data-f="numFlagged"></b></li>
      <li><span class="progress-dot dot-covered"></span> Covered by a reviewed ancestor <b data-f="numCovered"></b></li>
      <li><span class="progress-dot dot-unreviewed"></span> Not reviewed <b data-f="numUnreviewed"></b></li>
    </ul>
    <p>Total source folders: <b data-f="numTotal"></b></p>
    <div class="editor-actions"><button type="button" data-a="close">Close</button></div>
  `;
  document.body.appendChild(dialog);

  const f = {};
  for (const el of dialog.querySelectorAll("[data-f]")) f[el.dataset.f] = el;
  dialog.querySelector('[data-a="close"]').addEventListener("click", () => dialog.close());

  function refresh() {
    const { total, reviewed, flagged, covered, unreviewed } = computeProgress(store);
    f.segReviewed.style.width = pct(reviewed, total) + "%";
    f.segFlagged.style.width = pct(flagged, total) + "%";
    f.segCovered.style.width = pct(covered, total) + "%";
    f.segUnreviewed.style.width = pct(unreviewed, total) + "%";
    f.numReviewed.textContent = String(reviewed);
    f.numFlagged.textContent = String(flagged);
    f.numCovered.textContent = String(covered);
    f.numUnreviewed.textContent = String(unreviewed);
    f.numTotal.textContent = String(total);
  }

  function open() {
    refresh();
    dialog.showModal();
  }

  return { open };
}

// A small, unlabeled version of the same bar, live in the toolbar. Kept
// up to date on every "reviewed"/"flagged" meta change and full reset, rather
// than only on open like the modal -- but a full computeProgress() pass over
// 100k folders is just cheap Map lookups (no DOM work), realistically low
// tens of milliseconds even at that scale, so recomputing per relevant event
// is fine. The debounce below is a cheap defensive margin for bursts of many
// events at once (e.g. an equate() cascade), not a sign it's actually slow.
export function mountMiniProgressBar(container, store, { onClick } = {}) {
  container.innerHTML = `
    <div class="mini-progress-seg mini-progress-reviewed" data-f="segReviewed"></div>
    <div class="mini-progress-seg mini-progress-flagged" data-f="segFlagged"></div>
    <div class="mini-progress-seg mini-progress-covered" data-f="segCovered"></div>
    <div class="mini-progress-seg mini-progress-unreviewed" data-f="segUnreviewed"></div>
  `;
  const f = {};
  for (const el of container.querySelectorAll("[data-f]")) f[el.dataset.f] = el;

  if (onClick) {
    container.style.cursor = "pointer";
    container.addEventListener("click", onClick);
  }

  function refresh() {
    const { total, reviewed, flagged, covered, unreviewed } = computeProgress(store);
    f.segReviewed.style.width = pct(reviewed, total) + "%";
    f.segFlagged.style.width = pct(flagged, total) + "%";
    f.segCovered.style.width = pct(covered, total) + "%";
    f.segUnreviewed.style.width = pct(unreviewed, total) + "%";
    container.title =
      `${reviewed} reviewed, ${flagged} flagged, ${covered} covered, ${unreviewed} not reviewed ` +
      `(${total} total) -- click for details`;
  }

  let debounceTimer = null;
  function scheduleRefresh() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 200);
  }

  store.subscribe((event) => {
    if (event.type === "reset") scheduleRefresh();
    else if (event.type === "meta" && (event.field === "reviewed" || event.field === "flagged")) scheduleRefresh();
  });

  refresh();
  container.hidden = false;
}
