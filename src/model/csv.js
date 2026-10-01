// Generic CSV parsing -- pure string-in/object-out, no file I/O, same
// convention as robocopyImport.js/targetStructureMarkdown.js. Needed because
// this codebase only ever *wrote* CSV before (export.js's csvField/
// buildSearchLogCsv) -- nothing here has had to *read* one until folderFacts.js.
//
// A real state machine, not `line.split(",")`: the PowerShell writers this
// data comes from (see Invoke-DirRollup.ps1's own Write-CsvRow) quote a field
// only when it contains a comma, quote, or newline, doubling any embedded
// quote -- and real Windows folder names can contain commas. A regex split
// can't correctly un-escape a quoted field that itself contains the
// delimiter, so this walks the text character by character.

const COMMA = 44; // ","
const QUOTE = 34; // '"'
const CR = 13; // "\r"
const LF = 10; // "\n"

// -> { header: string[], rows: string[][] }. Tolerates \r\n or \n line
// endings and a trailing blank line (common when a file ends with a newline).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function endField() {
    row.push(field);
    field = "";
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < n) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === QUOTE) {
        if (text.charCodeAt(i + 1) === QUOTE) {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += text[i];
      i++;
      continue;
    }
    if (c === QUOTE) {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === COMMA) {
      endField();
      i++;
      continue;
    }
    if (c === CR) {
      // Peek for \r\n; a bare \r (old Mac line endings) is treated the same way.
      i++;
      if (text.charCodeAt(i) === LF) i++;
      endRow();
      continue;
    }
    if (c === LF) {
      i++;
      endRow();
      continue;
    }
    field += text[i];
    i++;
  }
  // Final row, unless the file ended cleanly on a newline (in which case the
  // loop's last endRow() already emitted an empty trailing row to drop here).
  if (field !== "" || row.length > 0) endRow();
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();

  const header = rows.shift() ?? [];
  return { header, rows };
}

// -> Record<string,string>[], zipping header+rows into plain objects -- what
// every caller in folderFacts.js actually wants, rather than dealing with
// parallel header/row arrays and column indexes by hand.
export function parseCsvRecords(text) {
  const { header, rows } = parseCsv(text);
  return rows.map((cols) => {
    const rec = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = cols[i] ?? "";
    return rec;
  });
}
