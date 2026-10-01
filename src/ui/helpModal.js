// A static reference modal -- condensed from README.md's "Step 4: Review
// every folder" and "Colour legend" sections, deliberately NOT the setup
// steps (scanning, target structure, export) -- those are done once by
// whoever sets the tool up, not by whoever is reviewing folders day to day,
// and this is the help they'll actually need while doing that. No store
// dependency: unlike Progress/Export, this needs no source loaded to be
// useful, so main.js mounts and wires it unconditionally at startup.

export function mountHelpModal() {
  const dialog = document.createElement("dialog");
  dialog.id = "help-modal";
  dialog.innerHTML = `
    <button type="button" class="dialog-close-x" data-a="close" aria-label="Close" title="Close">✕</button>
    <h3>Review Help</h3>
    <div class="help-scroll">
      <section>
        <h4>The basic loop</h4>
        <ol>
          <li>Click a folder in the <b>Before</b> pane (left). The Review panel shows its status and details.</li>
          <li>Click a destination folder in the <b>After</b> pane (right) to pick a target -- this is just browsing, it doesn't change which folder you're reviewing.</li>
          <li>Act on it: move it, rename it, delete it, or leave it as-is.</li>
          <li>Mark it <b>Reviewed</b> (most actions do this for you) and move on.</li>
          <li><b>Save your work</b> with <b>Save plan</b> (or 💾) regularly -- it is not saved automatically.</li>
        </ol>
      </section>

      <section>
        <h4>What you can do to a folder</h4>
        <table class="help-table">
          <tr><td><b>Move it</b></td><td>Pick a destination in After, then click <b>Move Here</b>. Puts the folder inside of the selected folder.</td></tr>
          <tr><td><b>Rename it</b></td><td>Edit <b>Folder Name</b> in the Review panel. Or in the After tree, click an already-selected folder again, or press <b>F2</b>.</td></tr>
          <tr><td><b>Fill a target-structure slot</b></td><td>Select the real folder in Before, click the purple slot in After, then click <b>These Are Equivalent</b>.</td></tr>
          <tr><td><b>Create a new folder</b></td><td>Click the <b>➕</b> button beside the After pane's 🔗 toggle. It opens for renaming immediately.</td></tr>
          <tr><td><b>Delete it</b></td><td><b>Delete (move to Trash)</b>. Nothing is actually deleted -- see Trash &amp; Pending below.</td></tr>
          <tr><td><b>Detach it</b></td><td><b>Detach (no inherited move)</b> -- use when a parent is moving but this one child shouldn't go along. Parks it in <code>_PENDING</code>.</td></tr>
          <tr><td><b>Undo changes</b></td><td><b>Revert to original</b>, or <b>Restore</b> if it's in the Trash.</td></tr>
          <tr><td><b>Add a note</b></td><td>Type in the <b>Note</b> box.</td></tr>
        </table>
      </section>

      <section>
        <h4>Colour legend -- Before pane</h4>
        <ul class="help-legend">
          <li><span class="help-dot" style="background:#4caf50"></span><b>Green</b> &mdash; Reviewed. Good to go.</li>
          <li><span class="help-dot" style="background:#d9534f"></span><b>Red</b> &mdash; Unreviewed. Needs attention.</li>
          <li><span class="help-dot" style="background:#4a90d9"></span><b>Blue</b> &mdash; Covered. An ancestor is already reviewed, so this one is riding along.</li>
          <li><span class="help-dot" style="background:#f0973b"></span><b>Orange</b> &mdash; Flagged for follow-up. You're deliberately coming back to this one.</li>
          <li><span class="help-dot" style="background:#ffdedd"></span><b>Faded</b> &mdash; Empty, this folder and everything under it has no files.</li>
          <li><b>⧗ Hourglass</b> &mdash; stale: nothing in its subtree has been written to recently.</li>
        </ul>        
      </section>

      <section>
        <h4>Colour legend -- After pane</h4>
        <ul class="help-legend">
          <li><span class="help-dot" style="background:#d6d4d6"></span><b>Grey</b> &mdash; Unchanged and unreviewed, these are the folders you are looking to find destinations for.</li>  
          <li><span class="help-dot" style="background:#cb44e3"></span><b>Purple</b> &mdash; Part of the target structure. These folders exist in the planning document, things should go there.</li>  
          <li><span class="help-dot" style="background:#96ecff"></span><b>Blue</b> &mdash; Moved with parent folder. These have not been reviewed individually, but are inside a folder that has.</li>            
        </ul>
      </section>

      <section>
        <h4>Trash &amp; Pending</h4>
        <p><code>_TRASH</code>: "Delete" moves a folder here. It's listed for review, not acted on -- the final export never generates a delete command.</p>
        <p><code>_PENDING</code>: a holding area for "I don't know yet" -- folders here are left out of the move script until you decide.</p>
      </section>

      <section>
        <h4>Worth knowing</h4>
        <ul>
          <li>Drag the thin bar between panes to resize them, or the line between column headers inside a tree.</li>
          <li>If folder-facts data has been loaded, the Review panel shows a <b>Folder contents</b> section with size, staleness and file types for the selected folder.</li>
          <li>Save your work with <b>Save plan</b> (or 💾) regularly -- it is not saved automatically.</li>
        </ul>
      </section>
    </div>
    <div class="editor-actions"><button type="button" data-a="close">Close</button></div>
  `;
  document.body.appendChild(dialog);
  for (const el of dialog.querySelectorAll('[data-a="close"]')) {
    el.addEventListener("click", () => dialog.close());
  }

  return { open: () => dialog.showModal() };
}
