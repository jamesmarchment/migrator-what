// Editable directly here in dist/ -- no rebuild needed to change these.
//
// IMPORTANT: a file:// page cannot silently read an arbitrary path with zero
// clicks (there's no server, and browsers require a real click before showing
// any file picker, even on page load). These paths are used only as labels, so
// the toolbar buttons and prompts can tell you which file to pick.
//
// The actual "auto-load on open" comes from the browser remembering the file
// you picked last time: the first time you open (or save) each file via the
// toolbar, this tool remembers it, and on every later page load it re-reads
// that same file automatically if the browser still trusts the access (no
// click needed). If the browser asks again (common after a restart, or if
// this feature isn't supported at all on this machine), you'll see the usual
// one-click Open button instead -- never worse than before, just not silent.
window.FOLDER_MIGRATOR_CONFIG = {
  sourcePath: "",
  planPath: "",
  targetStructurePath: "",
};
