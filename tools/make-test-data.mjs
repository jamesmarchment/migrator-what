#!/usr/bin/env node
// Generates a small synthetic source.json for exercising the review tool's edge cases
// (deep nesting, wide fan-out, name collisions, illegal names) at a scale that's fast
// to build/reload during development -- NOT a full-scale (~100k) realism simulation.
//
// Usage:
//   node tools/make-test-data.mjs [--count 3000] [--maxDepth 12] [--wideFanoutFolders 3]
//                                  [--collisionRate 0.02] [--illegalNameRate 0.01]
//                                  [--seed 1] [--out test-source.json]

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

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function makeName(rng, i) {
  const base = `${pick(rng, WORDS)} ${pick(rng, WORDS)}`;
  return rng() < 0.3 ? `${base} ${i}` : base;
}

function makeTestData({ count, maxDepth, wideFanoutFolders, collisionRate, illegalNameRate, seed }) {
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

  return {
    version: 1,
    root: "\\\\test-server\\share",
    separator: "\\",
    rootFiles: 0,
    folders,
  };
}

const args = parseArgs(process.argv.slice(2));
const source = makeTestData(args);
writeFileSync(args.out, JSON.stringify(source, null, 2));
console.log(`Generated ${source.folders.length} folders -> ${args.out}`);
console.log(
  `count=${args.count} maxDepth=${args.maxDepth} wideFanoutFolders=${args.wideFanoutFolders} ` +
    `collisionRate=${args.collisionRate} illegalNameRate=${args.illegalNameRate} seed=${args.seed}`
);
