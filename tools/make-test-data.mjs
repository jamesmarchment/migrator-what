#!/usr/bin/env node
// Generates a small synthetic source.json for exercising the review tool's edge cases
// (deep nesting, wide fan-out, name collisions, illegal names) at a scale that's fast
// to build/reload during development -- NOT a full-scale (~100k) realism simulation,
// unless --withFacts is used (see below) to reproduce the large-scale, facts-enriched
// scenario in handoff.md §10 for local load/save benchmarking.
//
// Usage:
//   node tools/make-test-data.mjs [--count 3000] [--maxDepth 12] [--wideFanoutFolders 3]
//                                  [--collisionRate 0.02] [--illegalNameRate 0.01]
//                                  [--seed 1] [--out test-source.json] [--withFacts 0]
//
// --withFacts 1 attaches a `.facts`/`.extensions` pair to every folder, in exactly the
// shape store.js's exportSourceJson() writes and folderFacts.js's parseDirFactsRecords/
// parseExtLongRecords produce -- i.e. this simulates an already-merged, already-saved
// source.json, not a fresh CSV import. Combine with a large --count/--maxDepth (e.g.
// --count 105000 --maxDepth 15) to approximate the office share's ~54MB file for
// tools/bench-load.mjs.

import { writeFileSync } from "node:fs";

function parseArgs(argv) {
  const args = {
    count: 3000,
    maxDepth: 12,
    wideFanoutFolders: 3,
    collisionRate: 0.02,
    illegalNameRate: 0.01,
    seed: 1,
    out: "test-source.json",
    withFacts: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const key = a.replace(/^--/, "");
    if (!(key in args)) throw new Error(`Unknown argument: ${a}`);
    const val = argv[++i];
    args[key] = key === "out" ? val : Number(val);
  }
  return args;
}

// Small deterministic PRNG (mulberry32) so --seed gives reproducible datasets.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "Marketing", "Finance", "Legal", "Compliance", "Archive", "Projects", "Clients",
  "Reports", "Templates", "Photos", "Videos", "Assets", "Brand", "Admin", "Events",
  "Training", "Surveys", "Contracts", "Invoices", "Old", "Backup", "Copy", "Draft",
  "Final", "Review", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "Q1",
  "Q2", "Q3", "Q4", "Team", "Notes", "Misc", "Shared", "Personal", "~Archive",
];

const RESERVED_NAMES = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"];
const ILLEGAL_CHARS = ["<", ">", ":", '"', "|", "?", "*"];

// Common office-share extensions, roughly in realistic frequency order (used with a
// power-law-ish pick below so most folders get 0-3 of these, a long tail gets many more).
const EXTENSIONS = [
  "pdf", "docx", "xlsx", "pptx", "jpg", "png", "msg", "txt", "csv", "zip",
  "doc", "xls", "ppt", "mp4", "mov", "dwg", "html", "xml", "json", "bak",
];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Random ISO-UTC timestamp between `minMs` and `maxMs` (epoch ms), truncated to whole
// seconds -- matches the "no sub-millisecond precision needed" note in folderFacts.js.
function randomIsoBetween(rng, minMs, maxMs) {
  const ms = minMs + Math.floor(rng() * (maxMs - minMs));
  return new Date(ms).toISOString();
}

// Attaches `.facts`/`.extensions` to every folder, in exactly the shape store.js's
// exportSourceJson() writes (facts: {directFiles, directBytes, subtreeFiles, subtreeBytes,
// subtreeOldestWriteUtc, subtreeNewestWriteUtc}; extensions: [{extension, count, bytes}]).
// Subtree numbers are rough (direct + a random multiple), not an exact rollup -- fine for
// a load/save performance benchmark, which only cares about realistic shape and byte size.
function attachFacts(folders, rng) {
  const now = Date.now();
  const fiveYearsMs = 5 * 365 * 24 * 60 * 60 * 1000;

  for (const f of folders) {
    const directFiles = f.files ?? 0;
    const directBytes = directFiles === 0 ? 0 : Math.floor(rng() * directFiles * 2_000_000);
    const subtreeMultiplier = 1 + Math.floor(rng() ** 2 * 50); // most folders near 1x, some much larger
    const subtreeFiles = directFiles * subtreeMultiplier;
    const subtreeBytes = directBytes * subtreeMultiplier;

    let subtreeOldestWriteUtc = null;
    let subtreeNewestWriteUtc = null;
    if (subtreeFiles > 0) {
      const oldestMs = now - fiveYearsMs + Math.floor(rng() * fiveYearsMs);
      subtreeOldestWriteUtc = randomIsoBetween(rng, oldestMs, now);
      subtreeNewestWriteUtc = randomIsoBetween(rng, Date.parse(subtreeOldestWriteUtc), now);
    }

    f.facts = {
      directFiles,
      directBytes,
      subtreeFiles,
      subtreeBytes,
      subtreeOldestWriteUtc,
      subtreeNewestWriteUtc,
    };

    // Most folders: 0-2 distinct extensions (biased low via rng()**2); a long tail goes
    // up to ~10. Tuned so ~105k folders lands near the office share's ~54MB (handoff.md
    // §10) -- see tools/bench-load.mjs's printed file size if re-tuning this.
    const extCount = directFiles === 0 ? 0 : Math.floor(rng() ** 2 * 7);
    if (extCount > 0) {
      const chosen = new Set();
      while (chosen.size < Math.min(extCount, EXTENSIONS.length)) chosen.add(pick(rng, EXTENSIONS));
      f.extensions = [...chosen].map((extension) => ({
        extension,
        count: 1 + Math.floor(rng() * Math.max(1, directFiles)),
        bytes: Math.floor(rng() * 50_000_000),
      }));
    } else {
      f.extensions = [];
    }
  }
}

function makeName(rng, i) {
  const base = `${pick(rng, WORDS)} ${pick(rng, WORDS)}`;
  return rng() < 0.3 ? `${base} ${i}` : base;
}

function makeTestData({ count, maxDepth, wideFanoutFolders, collisionRate, illegalNameRate, seed, withFacts }) {
  const rng = makeRng(seed);
  const folders = [];
  // frontier: ids eligible to receive new children, paired with their current depth.
  const frontier = [{ id: null, depth: 0 }];
  const wideFanoutTargets = new Set();

  let nextSeq = 1;
  while (folders.length < count) {
    // Bias toward shallower/earlier nodes so the tree stays broadly branchy, but
    // occasionally pick from anywhere to get some very deep chains too.
    const parent =
      rng() < 0.85 ? frontier[Math.floor(rng() ** 2 * frontier.length)] : pick(rng, frontier);
    if (parent.depth >= maxDepth) continue;

    const id = `T${String(nextSeq++).padStart(6, "0")}`;
    let name = makeName(rng, folders.length);

    if (rng() < illegalNameRate) {
      const kind = rng();
      if (kind < 0.4) name = pick(rng, RESERVED_NAMES);
      else if (kind < 0.7) name = `${name}${pick(rng, ILLEGAL_CHARS)}`;
      else name = `${name}.`; // trailing dot
    } else if (rng() < collisionRate) {
      // Force a case-variant duplicate of an existing sibling by reusing a recent name.
      const recent = folders[folders.length - 1];
      if (recent) name = recent.name.toUpperCase();
    }

    const files = rng() < 0.13 ? 0 : Math.floor(rng() * 40);
    folders.push({ id, parentId: parent.id, name, files });

    const depth = parent.depth + 1;
    frontier.push({ id, depth });

    // Designate a few early folders as forced wide-fan-out parents.
    if (wideFanoutTargets.size < wideFanoutFolders && depth <= 3 && rng() < 0.02) {
      wideFanoutTargets.add(id);
    }
  }

  // Give each wide-fan-out target a large batch of direct children (beyond `count`,
  // since these exist specifically to stress virtualization/rendering).
  for (const targetId of wideFanoutTargets) {
    const childCount = 500 + Math.floor(rng() * 1500);
    for (let i = 0; i < childCount; i++) {
      const id = `T${String(nextSeq++).padStart(6, "0")}`;
      folders.push({ id, parentId: targetId, name: `Item ${i + 1}`, files: Math.floor(rng() * 5) });
    }
  }

  if (withFacts) attachFacts(folders, rng);

  const source = {
    version: 1,
    root: "\\\\test-server\\share",
    separator: "\\",
    rootFiles: 0,
    folders,
  };
  if (withFacts) {
    source.factsStamp = "20260929-233732";
    source.factsPartial = false;
    source.factsHasSubtree = true;
    source.extensionsStamp = "20260929-233732";
    source.extensionsPartial = false;
  }
  return source;
}

const args = parseArgs(process.argv.slice(2));
const source = makeTestData(args);
const json = JSON.stringify(source, null, 2);
writeFileSync(args.out, json);
console.log(`Generated ${source.folders.length} folders -> ${args.out} (${(json.length / 1_000_000).toFixed(1)} MB)`);
console.log(
  `count=${args.count} maxDepth=${args.maxDepth} wideFanoutFolders=${args.wideFanoutFolders} ` +
    `collisionRate=${args.collisionRate} illegalNameRate=${args.illegalNameRate} seed=${args.seed} ` +
    `withFacts=${args.withFacts}`
);
