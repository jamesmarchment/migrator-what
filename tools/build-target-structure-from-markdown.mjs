#!/usr/bin/env node
// Converts a target-structure markdown file (see target-structure-example.md
// for the format spec and a worked example) into the tool's target-structure
// JSON shape. The actual parsing lives in ../src/model/targetStructureMarkdown.js.
//
// Usage:
//   node tools/build-target-structure-from-markdown.mjs --in structure.md --out target-structure.json

import { readFileSync, writeFileSync } from "node:fs";
import { parseTargetStructureMarkdown, flattenPaths } from "../src/model/targetStructureMarkdown.js";

function parseArgs(argv) {
  const args = { in: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.in || !args.out) {
    throw new Error("Usage: build-target-structure-from-markdown.mjs --in <file.md> --out <file.json>");
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const text = readFileSync(args.in, "utf8");
const { json, stats } = parseTargetStructureMarkdown(text);

writeFileSync(args.out, JSON.stringify(json, null, 2));
console.log(`Wrote ${args.out}`);
console.log(
  `${stats.departmentCount} department(s), ${stats.folderCount} folder(s) total` +
    (stats.skippedLines ? `, ${stats.skippedLines} non-structural line(s) skipped` : "")
);
console.log("\nResulting paths:");
for (const p of flattenPaths(json)) console.log("  " + p);
