// Parses the "New Dir" lines of a `robocopy /L /E ... source Q:\__listonly__\`
// listing into the tool's source.json shape (see handoff.md section 5). Pure
// string-in/object-out -- no file I/O here, so it works identically from
// tools/import-robocopy.mjs (Node, reads the file itself) and from the
// browser bundle (io.js decodes the picked File, then calls this). That's the
// whole point: a locked-down office machine with no Node can still turn a raw
// robocopy scan into source.json, entirely client-side.
//
// Line shape (after String#trim()): `New Dir          <fileCount>\t<full path>\`
// The very first "New Dir" line is normally the scan root itself -- it has no
// parent and is not emitted as a folder; its file count is captured as
// rootFiles instead.

const NEW_DIR_RE = /^New Dir\s+(\d+)\t(.+)$/;
const RESERVED_IDS = new Set(["TRASH", "ROOT"]);

function splitNameAndParent(path) {
  // path always ends with a trailing separator, e.g. "G:\Marketing\Administration\"
  const trimmed = path.replace(/\\+$/, "");
  const lastSep = trimmed.lastIndexOf("\\");
  if (lastSep < 0) throw new Error(`Cannot split path with no separator: ${path}`);
  return {
    name: trimmed.slice(lastSep + 1),
    parentPath: trimmed.slice(0, lastSep + 1),
  };
}

// `text` is the already-decoded listing (UTF-16LE decoding happens in the
// caller, since that step differs between Node's fs and the browser's File
// API). `root`, if given, overrides which path is treated as the scan root --
// otherwise the first "New Dir" line is assumed to be it.
export function parseRobocopyListing(text, { root: rootArg } = {}) {
  const raw = text.replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);

  let rootPath = rootArg ? rootArg.replace(/\\*$/, "") + "\\" : null;
  let rootFiles = null;
  const pathToId = new Map();
  const folders = [];
  let nextSeq = 1;
  let skippedLines = 0;
  let inferredCount = 0;

  // Resolves a folder's parent id, auto-vivifying missing ancestors as placeholder
  // folders (files: null, inferred: true). Needed because a scan can be redacted/
  // truncated (sections deleted for size) so a listed folder's real parent may be
  // absent even though robocopy's own output is normally strict pre-order.
  function resolveParentId(parentPath) {
    if (parentPath === rootPath) return null;
    const existing = pathToId.get(parentPath);
    if (existing !== undefined) return existing;

    const { name, parentPath: grandParentPath } = splitNameAndParent(parentPath);
    const grandParentId = resolveParentId(grandParentPath);
    const id = `F${String(nextSeq++).padStart(6, "0")}`;
    if (RESERVED_IDS.has(id)) throw new Error(`Generated id "${id}" collides with a reserved plan id`);
    folders.push({ id, parentId: grandParentId, name, files: null, inferred: true });
    pathToId.set(parentPath, id);
    inferredCount++;
    return id;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = NEW_DIR_RE.exec(line);
    if (!m) {
      skippedLines++;
      continue;
    }
    const files = Number(m[1]);
    const path = m[2];

    if (rootPath === null) {
      // First New Dir line with no root given: treat it as the scan root.
      rootPath = path;
      rootFiles = files;
      continue;
    }
    if (path === rootPath) {
      rootFiles = files;
      continue;
    }

    const { name, parentPath } = splitNameAndParent(path);
    const parentId = resolveParentId(parentPath);

    const id = `F${String(nextSeq++).padStart(6, "0")}`;
    if (RESERVED_IDS.has(id)) {
      throw new Error(`Generated id "${id}" collides with a reserved plan id`);
    }
    folders.push({ id, parentId, name, files });
    pathToId.set(path, id);
  }

  if (rootPath === null) {
    throw new Error("No 'New Dir' lines found -- is this a robocopy /L listing?");
  }

  const json = {
    version: 1,
    root: rootPath.replace(/\\$/, ""),
    separator: "\\",
    rootFiles,
    folders,
  };

  return {
    json,
    stats: { folderCount: folders.length, skippedLines, inferredCount, rootFiles, root: json.root },
  };
}
