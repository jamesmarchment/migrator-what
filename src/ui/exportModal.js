// Export modal: turns the current plan into downloadable outputs -- a
// robocopy .bat script for the moves, and a searchable log (HTML + CSV) of
// every source folder's old path -> new path, for "this used to be here,
// where is it now?" lookups. See model/export.js for how each is computed.

import { downloadBlob } from "../model/io.js";
import { computeMovePlan, computeFullLog, buildRobocopyScript, buildSearchLogCsv, buildSearchLogHtml } from "../model/export.js";

export function mountExportModal(store) {
  const dialog = document.createElement("dialog");
  dialog.id = "export-modal";
  dialog.innerHTML = `
    <h3>Export</h3>
    <ul class="export-summary">
      <li><b data-f="numMoves"></b> folder(s) to move (already collapsed: a folder whose whole subtree moves intact only needs one command)</li>
      <li><b data-f="numNew"></b> new empty folder(s) to create</li>
      <li><b data-f="numTrash"></b> folder(s) flagged for deletion (listed only -- no delete command is generated)</li>
      <li><b data-f="numPending"></b> folder(s) still unresolved (Pending -- not included in the move script)</li>
    </ul>
    <div class="export-actions">
      <button type="button" data-a="downloadBat">Download move script (.bat)</button>
      <button type="button" data-a="downloadHtml">Download searchable log (.html)</button>
      <button type="button" data-a="downloadCsv">Download log (.csv)</button>
    </div>
    <div class="editor-actions"><button type="button" data-a="close">Close</button></div>
  `;
  document.body.appendChild(dialog);

  const f = {};
  for (const el of dialog.querySelectorAll("[data-f]")) f[el.dataset.f] = el;
  const a = {};
  for (const el of dialog.querySelectorAll("[data-a]")) a[el.dataset.a] = el;

  a.close.addEventListener("click", () => dialog.close());

  a.downloadBat.addEventListener("click", () => {
    const plan = computeMovePlan(store);
    downloadBlob("migrate.bat", buildRobocopyScript(plan), "application/bat");
  });
  a.downloadHtml.addEventListener("click", () => {
    const rows = computeFullLog(store);
    downloadBlob("migration-log.html", buildSearchLogHtml(rows, { sourceRoot: store.sourceRoot }), "text/html");
  });
  a.downloadCsv.addEventListener("click", () => {
    const rows = computeFullLog(store);
    downloadBlob("migration-log.csv", buildSearchLogCsv(rows), "text/csv");
  });

  function refresh() {
    const plan = computeMovePlan(store);
    f.numMoves.textContent = String(plan.moves.length);
    f.numNew.textContent = String(plan.newFolders.length);
    f.numTrash.textContent = String(plan.trashed.length);
    f.numPending.textContent = String(plan.pendingUnresolved.length);
  }

  function open() {
    refresh();
    dialog.showModal();
  }

  return { open };
}
