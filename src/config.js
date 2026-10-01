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
//
// installId: normally leave this blank -- the tool tells copies of itself apart
// automatically, using the full path index.html is running from, so copying this whole
// folder somewhere else (a different share, a local drive, etc.) already gets its own
// separate "remembered files" rather than colliding with another copy's. Only set this
// if you have reason to believe that's NOT working for your setup -- e.g. the same share
// is reachable through two different mapped drive letters, which would otherwise look
// like two different paths that are really the same files. Set a distinct string here in
// each copy (e.g. "office-share" vs "my-laptop") to force them apart manually. Check the
// browser console (F12) for lines starting "[folder-migrator]" to see which path/namespace
// is actually being used when troubleshooting a save/load landing in the wrong place.
window.FOLDER_MIGRATOR_CONFIG = {
  sourcePath: "",
  planPath: "",
  targetStructurePath: "",
  installId: "",
};
