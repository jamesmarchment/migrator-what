// Parses the target-structure markdown format (see tools/target-structure-
// example.md for the full spec + a worked example) into the same nested
// {name, children} tree store.loadTargetStructure() expects. Pure string-in/
// object-out, no file I/O -- same reasoning as robocopyImport.js: keeps this
// usable from both the Node CLI (tools/build-target-structure-from-
// markdown.mjs) and, if it's ever wanted, a browser import button, without
// two implementations to keep in sync.
//
// Format, in short: a heading line ("#" through "######", level ignored)
// starts a new top-level department; every deeper folder is a "/ Name" line,
// indented with spaces only -- 2 spaces for a direct child of the department,
// 4 for a grandchild, and so on (2 per level, no level 0 -- a "/" line always
// sits under some heading). Bold/italic markup around a name is cosmetic and
// stripped; blank lines and anything that isn't a heading or a "/ Name" line
// are ignored. Indentation must climb by exactly one level at a time and be a
// clean multiple of 2, and sibling names must be unique under their parent --
// both are checked, reporting the offending line number, rather than silently
// misplacing a folder.

const INDENT_UNIT = 2;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
// Indent group matches tabs too, even though only spaces are ever valid --
// otherwise a tab-indented line just fails to match at all and silently falls
// through to "ignored prose" below, dropping a folder with no error raised.
const ITEM_RE = /^([ \t]*)\/\s*(.+?)\s*$/;

function stripEmphasis(s) {
  return s.replace(/\*\*/g, "").replace(/__/g, "").replace(/^\*|\*$/g, "").trim();
}

// Recursively drops empty `children` arrays so leaves come out as plain
// {name}, matching the style of the hand-authored example JSON in this repo.
function pruneEmptyChildren(node) {
  if (node.children.length === 0) {
    const { children, ...rest } = node;
    return rest;
  }
  return { ...node, children: node.children.map(pruneEmptyChildren) };
}

export function parseTargetStructureMarkdown(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const roots = [];
  // stack[i] = { node, depth }: the chain of currently-open ancestors, top ->
  // deepest. A heading resets it to just itself at depth 0.
  const stack = [];
  let skippedLines = 0;
  let itemCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    if (!line.trim()) continue;

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const name = stripEmphasis(heading[2]);
      if (!name) throw new Error(`Line ${lineNo}: heading has no name.`);
      if (roots.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`Line ${lineNo}: duplicate top-level department name "${name}".`);
      }
      const node = { name, children: [] };
      roots.push(node);
      stack.length = 0;
      stack.push({ node, depth: 0 });
      continue;
    }

    const item = ITEM_RE.exec(line);
    if (!item) {
      skippedLines++;
      continue; // stray prose/comments -- not an error, just not structural
    }
    const [, indentStr] = item;
    if (/\t/.test(line.slice(0, indentStr.length))) {
      throw new Error(`Line ${lineNo}: indentation uses a tab -- use spaces only (${INDENT_UNIT} per level).`);
    }
    if (indentStr.length % INDENT_UNIT !== 0) {
      throw new Error(
        `Line ${lineNo}: indentation is ${indentStr.length} space(s), not a clean multiple of ${INDENT_UNIT}.`
      );
    }
    if (indentStr.length === 0) {
      throw new Error(
        `Line ${lineNo}: "/" lines must be indented at least ${INDENT_UNIT} spaces under their department heading.`
      );
    }
    const depth = indentStr.length / INDENT_UNIT; // depth 1 = 2 spaces = direct child of the department
    const name = stripEmphasis(item[2]);
    if (!name) throw new Error(`Line ${lineNo}: folder has no name.`);

    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length === 0) {
      throw new Error(`Line ${lineNo}: "${name}" has no enclosing department heading above it.`);
    }
    const parentEntry = stack[stack.length - 1];
    if (parentEntry.depth !== depth - 1) {
      throw new Error(
        `Line ${lineNo}: "${name}" jumps from depth ${parentEntry.depth} straight to ${depth - 1} -- ` +
          `indent one level (${INDENT_UNIT} spaces) at a time.`
      );
    }
    const parent = parentEntry.node;
    const lower = name.toLowerCase();
    if (parent.children.some((c) => c.name.toLowerCase() === lower)) {
      throw new Error(`Line ${lineNo}: "${name}" duplicates an existing sibling under "${parent.name}".`);
    }

    const node = { name, children: [] };
    parent.children.push(node);
    stack.push({ node, depth });
    itemCount++;
  }

  if (roots.length === 0) {
    throw new Error("No department headings ('#' through '######') found in the file.");
  }

  return {
    json: { name: "ignored", children: roots.map(pruneEmptyChildren) },
    stats: { departmentCount: roots.length, folderCount: roots.length + itemCount, skippedLines },
  };
}

// Flattens the parsed tree into the full backslash-joined path list, purely
// for eyeballing the result against what you expected -- not used by
// store.loadTargetStructure(), which walks the nested form directly.
export function flattenPaths(json) {
  const paths = [];
  function walk(node, prefix) {
    const path = prefix ? `${prefix}\\${node.name}` : node.name;
    paths.push(path);
    for (const child of node.children ?? []) walk(child, path);
  }
  for (const top of json.children ?? []) walk(top, "");
  return paths;
}
