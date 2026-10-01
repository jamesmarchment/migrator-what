// Makes the editor pane's width adjustable by dragging the resizer bars either
// side of it (see index.html's #resize-before-editor / #resize-editor-after
// and their .pane-resizer styling). Before/After stay `flex: 1` (styles.css)
// -- only the editor pane's flex-basis is ever touched here, so whichever
// side isn't the one being dragged still shares in the space change the same
// way it already would on a plain window resize.

const STORAGE_KEY = "folderMigrator.editorWidthPx";
const MIN_WIDTH = 360;
const MAX_WIDTH = 1400;

function clamp(px) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px));
}

function loadSavedWidth() {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null; // localStorage can be unavailable/throw on some file:// setups -- fall back to the CSS default
  }
}

function saveWidth(px) {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(px)));
  } catch {
    // best-effort -- losing this preference is harmless, unlike the plan data in io.js
  }
}

// `sign` says which way this particular handle grows the editor pane: -1 for
// the left handle (dragging right shrinks the editor, handing space to
// Before), +1 for the right handle (dragging right grows the editor, taking
// space from After).
function mountHandle(handle, editorPane, sign) {
  handle.addEventListener("mousedown", (downEvent) => {
    if (downEvent.button !== 0) return;
    downEvent.preventDefault();
    const startX = downEvent.clientX;
    const startWidth = editorPane.getBoundingClientRect().width;
    document.body.classList.add("pane-resizing");
    handle.classList.add("resizing");

    function onMove(moveEvent) {
      const dx = moveEvent.clientX - startX;
      editorPane.style.flexBasis = `${clamp(startWidth + sign * dx)}px`;
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("pane-resizing");
      handle.classList.remove("resizing");
      saveWidth(editorPane.getBoundingClientRect().width);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

export function mountEditorPaneResize({ editorPane, leftHandle, rightHandle }) {
  const saved = loadSavedWidth();
  if (saved !== null) editorPane.style.flexBasis = `${clamp(saved)}px`;
  mountHandle(leftHandle, editorPane, -1);
  mountHandle(rightHandle, editorPane, 1);
}
