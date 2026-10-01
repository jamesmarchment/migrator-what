#!/usr/bin/env node
// Profiles where time actually goes when opening/merging/saving a large, facts-enriched
// source.json (handoff.md §10) -- file read, JSON.parse, store.init(), computeSourceHash,
// the facts/extensions merge, and the save-side stringify. Run against a file produced by
// `node tools/make-test-data.mjs --count 105000 --maxDepth 15 --withFacts 1 --out ...`.
//
// Usage: node tools/bench-load.mjs <path-to-source.json>
//
// store.js has no DOM/Wunderbaum dependency (see its own header comment), so it runs
// under plain Node -- this gives real CPU-time numbers for everything except the actual
// browser main-thread-freeze question, which still needs a manual in-browser check
// (see handoff.md §10 plan, Step 1.3) since Node can't simulate that.

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node tools/bench-load.mjs <path-to-source.json>");
  process.exit(1);
}

function timeMs(fn) {
  const start = performance.now();
  const result = fn();
  return { ms: performance.now() - start, result };
}

function fmt(ms) {
  return `${ms.toFixed(1)} ms`;
}


const { createStore } = await import(new URL("../src/model/store.js", import.meta.url).href);

console.log(`Benchmarking ${file}\n`);

const { ms: readMs, result: text } = timeMs(() => readFileSync(file, "utf8"));
console.log(`file read           ${fmt(readMs)}  (${(text.length / 1_000_000).toFixed(1)} MB string)`);

const { ms: parseMs, result: json } = timeMs(() => JSON.parse(text));
console.log(`JSON.parse          ${fmt(parseMs)}  (${json.folders.length} folders)`);

const store = createStore();
const { ms: initMs } = timeMs(() => store.init(json));
console.log(`store.init()        ${fmt(initMs)}  (byId/srcChildren build + computeSourceHash + newPlan)`);

// Simulate a facts/extlong CSV merge landing on an already-loaded source: build a byPath
// Map from the data already on each folder (idempotent -- values don't matter, only that
// every folder has an entry, so mergeFacts/mergeExtensions do real work for all of them).
const factsByPath = new Map();
const extByPath = new Map();
for (const id of store.sourceIds()) {
  const path = store.srcPath(id);
  const f = store.folderFacts(id);
  if (f) factsByPath.set(path, f);
  const ext = store.folderExtensions(id);
  if (ext) extByPath.set(path, ext);
}
const { ms: mergeFactsMs } = timeMs(() => store.mergeFacts(factsByPath, { hasSubtree: true }));
console.log(`mergeFacts()        ${fmt(mergeFactsMs)}  (${factsByPath.size} rows, incl. per-folder srcPath() walk)`);

const { ms: mergeExtMs } = timeMs(() => store.mergeExtensions(extByPath));
console.log(`mergeExtensions()   ${fmt(mergeExtMs)}  (${extByPath.size} rows, incl. per-folder srcPath() walk)`);

const { ms: exportMs, result: exported } = timeMs(() => store.exportSourceJson());
console.log(`exportSourceJson()  ${fmt(exportMs)}`);

// saveSource() writes compact JSON (no pretty-print -- see io.js); keep the pretty
// variant printed too, purely so the saved-bytes/speed difference stays visible.
const { ms: stringifyMs, result: saved } = timeMs(() => JSON.stringify(exported));
console.log(`JSON.stringify()    ${fmt(stringifyMs)}  (${(saved.length / 1_000_000).toFixed(1)} MB output -- actual saveSource() behavior)`);

const { ms: stringifyPrettyMs, result: savedPretty } = timeMs(() => JSON.stringify(exported, null, 2));
console.log(`JSON.stringify(,,2) ${fmt(stringifyPrettyMs)}  (${(savedPretty.length / 1_000_000).toFixed(1)} MB -- for comparison only, no longer what saveSource() writes)`);

console.log(`\nTotal "open file" cost (read + parse + init):           ${fmt(readMs + parseMs + initMs)}`);
console.log(`Total "merge + save" cost (merge + export + stringify): ${fmt(mergeFactsMs + mergeExtMs + exportMs + stringifyMs)}`);
