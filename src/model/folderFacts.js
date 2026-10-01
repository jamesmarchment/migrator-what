// Interprets the two CSVs described in "test data/handoff_copilot.md" that
// matter for this feature -- dirfacts/dirfacts-rollup.csv (per-folder size +
// staleness) and extlong.csv (per-folder, per-extension file counts). Pure
// object-in/object-out (given already-parsed CSV records), no file I/O, no
// DOM -- same convention as robocopyImport.js/targetStructureMarkdown.js, so
// this could grow a Node CLI wrapper later without rework. Depends on csv.js
// only for the actual text parsing.
//
// Deliberately does NOT read IsQuiet/IsArchiveRoot/IsNearMissRoot/ActiveFiles
// (present in the sample rollup CSV but, on inspection, not actually written
// by the checked-in Invoke-DirRollup.ps1 -- the sample and the script are
// from different runs, so those columns can't be trusted to exist or be
// current) or StaleFiles/StaleBytes/SubtreeStalePctBytes (Phase-0's own
// judgement, frozen at scan time via -StaleDays, a DIFFERENT clock from the
// one this tool lets a reviewer adjust live -- mixing the two is exactly the
// "two clocks" confusion the handoff doc warns about). Everything this file
// computes comes from one clock only: SubtreeNewestWriteUtc vs. an
// adjustable threshold, applied in store.js's isStale().

const STAMP_RE = /(\d{8}-\d{6})/;

// Filenames look like "dirfacts-rollup-20260929-233732.csv" or
// "extlong-20260923-140502-partial.csv" (any prefix before the stamp is
// ignored, so this also matches the "test_" prefixed sample files). Stamps
// are fixed-width, zero-padded "yyyyMMdd-HHmmss", so plain string comparison
// is already correct chronological order -- no date parsing needed just to
// answer "is this one newer".
export function parseStamp(filename) {
  const m = STAMP_RE.exec(filename);
  return { stamp: m ? m[1] : null, isPartial: /partial/i.test(filename) };
}

// "20260929-233732" -> "2026-09-29 23:37:32", for display only.
export function formatStamp(stamp) {
  if (!stamp) return "unknown time";
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return stamp;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

// Empty string means "no files, no date" in these CSVs -- must not become
// `new Date("")` (an Invalid Date that silently poisons every later
// comparison). Non-empty values are ISO 8601 UTC with sub-millisecond digits
// (e.g. "...8180000Z") that JS's Date only needs truncated, not preserved --
// this tool only ever compares at day granularity.
function parseNullableIso(value) {
  return value ? value : null;
}

function findCol(header, name) {
  return header.includes(name);
}

// Accepts records from either a plain dirfacts.csv (Direct* only) or a
// dirfacts-rollup.csv (Direct* + Subtree*) -- distinguished by whether
// "SubtreeBytes" is a column on the input at all. Throws if this doesn't
// look like either (no "Path" column).
export function parseDirFactsRecords(records) {
  if (records.length === 0) throw new Error("Empty CSV -- no rows to read.");
  const header = Object.keys(records[0]);
  if (!findCol(header, "Path")) {
    throw new Error('Not a recognised folder-facts CSV (expected a "Path" column).');
  }
  const hasSubtree = findCol(header, "SubtreeBytes");

  const byPath = new Map();
  for (const r of records) {
    if (!r.Path) continue;
    const row = {
      directFiles: Number(r.DirectFiles) || 0,
      directBytes: Number(r.DirectBytes) || 0,
    };
    if (hasSubtree) {
      row.subtreeFiles = Number(r.SubtreeFiles) || 0;
      row.subtreeBytes = Number(r.SubtreeBytes) || 0;
      row.subtreeOldestWriteUtc = parseNullableIso(r.SubtreeOldestWriteUtc);
      row.subtreeNewestWriteUtc = parseNullableIso(r.SubtreeNewestWriteUtc);
    }
    byPath.set(r.Path, row);
  }
  return { byPath, hasSubtree };
}

// One row per (directory, extension) pair -- grouped here into one array per
// Path, since that's what every caller (editor.js's contents panel) wants.
// Throws if this doesn't look like an extlong.csv at all.
export function parseExtLongRecords(records) {
  if (records.length === 0) throw new Error("Empty CSV -- no rows to read.");
  const header = Object.keys(records[0]);
  if (!findCol(header, "Path") || !findCol(header, "Extension")) {
    throw new Error('Not a recognised extension-breakdown CSV (expected "Path" and "Extension" columns).');
  }

  const byPath = new Map();
  for (const r of records) {
    if (!r.Path) continue;
    let list = byPath.get(r.Path);
    if (!list) byPath.set(r.Path, (list = []));
    list.push({
      extension: r.Extension || "(none)",
      count: Number(r.Count) || 0,
      bytes: Number(r.Bytes) || 0,
    });
  }
  return byPath;
}

// A few classic variant extensions share one icon concept (a .docx is still
// "a Word doc" for iconography purposes) -- anything not listed here just
// becomes its own class from the raw extension. See extClassName below for
// where this is actually used, and styles.css's "File-type icons" section
// for the CSS side of this contract.
const EXT_ICON_ALIASES = { docx: "doc", xlsx: "xls", pptx: "ppt" };

// "jpg" -> "ext-jpg" (styles.css then either has a matching .ext-jpg rule
// with its own icon, or it doesn't yet and falls through to .facts-ext-icon's
// default file.svg) -- deliberately never throws or falls back to a fixed
// list here: an extension CSS has no rule for is a normal, expected state,
// not an error, so a new icon only ever needs a new CSS rule, no JS change.
export function extClassName(extension) {
  const clean = (extension || "").replace(/^\./, "").toLowerCase();
  const key = EXT_ICON_ALIASES[clean] ?? clean;
  const safe = key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `ext-${safe || "none"}`;
}

const UNITS = ["bytes", "KB", "MB", "GB", "TB"];

// "1.37 GB" / "482 KB" style -- matches the 2-decimal rounding
// Invoke-DirRollup.ps1's own console preview uses, so a number shown here
// looks familiar if a reviewer ever cross-checks against the PowerShell
// script's own output.
export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 bytes";
  let unitIndex = 0;
  let value = n;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const rounded = unitIndex === 0 ? String(value) : value.toFixed(2);
  return `${rounded} ${UNITS[unitIndex]}`;
}
