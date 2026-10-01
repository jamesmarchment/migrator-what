// Pure validation helpers -- no DOM, no Wunderbaum. Per the prototype's reduced
// scope (see plan), only two checks are implemented: sibling name collisions and
// illegal Windows folder names. Path-length and cycle checks are deferred.

const ILLEGAL_CHARS_RE = /[<>:"/\\|?*\x00-\x1F]/;
const TRAILING_DOT_OR_SPACE_RE = /[ .]$/;
const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export function checkIllegalName(name) {
  if (!name || name.length === 0) return "Name cannot be empty.";
  if (ILLEGAL_CHARS_RE.test(name)) return 'Name contains an illegal character (< > : " / \\ | ? *).';
  if (TRAILING_DOT_OR_SPACE_RE.test(name)) return "Name cannot end with a space or a period.";
  const base = name.split(".")[0].toUpperCase();
  if (RESERVED_NAMES.has(base)) return `"${base}" is a reserved Windows device name.`;
  return null;
}

export function checkSiblingCollision(store, parentKey, name, excludeId) {
  const lower = name.toLocaleLowerCase();
  for (const siblingId of store.getDestChildren(parentKey)) {
    if (siblingId === excludeId) continue;
    if (store.effName(siblingId).toLocaleLowerCase() === lower) {
      return `A folder named "${name}" already exists here.`;
    }
  }
  return null;
}

// Returns a list of error strings for a proposed (name, parent) on folder `id`.
// Either argument can be omitted to check only the other.
export function getErrors(store, id, proposedName, proposedParentKey) {
  const errors = [];
  const name = proposedName ?? store.effName(id);
  const parentKey = proposedParentKey ?? store.effParentKey(id);

  const illegal = checkIllegalName(name);
  if (illegal) errors.push(illegal);

  const collision = checkSiblingCollision(store, parentKey, name, id);
  if (collision) errors.push(collision);

  return errors;
}
