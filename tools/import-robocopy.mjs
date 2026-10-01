#!/usr/bin/env node
// CLI wrapper around ../src/model/robocopyImport.js -- the actual parsing lives
// there now so the exact same logic also runs client-side in the browser
// bundle (see io.js's loadRobocopyFromFile / main.js's "Import robocopy
// listing…"), for offices where this Node script can't be run at all.
//
// Usage:
//   node tools/import-robocopy.mjs --in example.txt --out source.json [--root "G:\Marketing"]

import { readFileSync, writeFileSync } from "node:fs";
import { parseRobocopyListing } from "../src/model/robocopyImport.js";

function parseArgs(argv) {
  const args = { in: null, out: null, root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--root") args.root = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.in || !args.out) {
    throw new Error("Usage: import-robocopy.mjs --in <file> --out <file> [--root <path>]");
  }
  return args;
}

function importRobocopy({ inPath, outPath, rootArg }) {
  const text = readFileSync(inPath, "utf16le");
  const { json, stats } = parseRobocopyListing(text, { root: rootArg });

  writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`Imported ${stats.folderCount} folders from ${inPath} -> ${outPath}`);
  console.log(`Root: ${stats.root}  (rootFiles=${stats.rootFiles})`);
  if (stats.skippedLines) console.log(`Skipped ${stats.skippedLines} non-data lines (headers/footers).`);
  if (stats.inferredCount) {
    console.log(
      `Auto-created ${stats.inferredCount} placeholder ancestor folder(s) missing from the scan ` +
        `(files: null, inferred: true) -- likely a redacted/truncated input.`
    );
  }
}

const args = parseArgs(process.argv.slice(2));
importRobocopy({ inPath: args.in, outPath: args.out, rootArg: args.root });
