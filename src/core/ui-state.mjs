// Reconcile cloud changes without losing the reader's place or active input.
export function preserveInteraction(render, doc = document) {
  const selectors = [".workspace", ".sidebar", ".genres", ".drive-file-list"];
  const positions = selectors.map((selector) => {
    const el = doc.querySelector(selector);
    return [selector, el?.scrollTop ?? 0, el?.scrollLeft ?? 0];
  });
  const active = doc.activeElement;
  let selector = active?.id ? "#" + CSS.escape(active.id) : null;
  for (const attr of ["data-preference", "data-action", "data-drive-file"])
    if (!selector && active?.hasAttribute(attr))
      selector = `[${attr}="${CSS.escape(active.getAttribute(attr))}"]`;
  const selection =
    typeof active?.selectionStart === "number"
      ? [active.selectionStart, active.selectionEnd]
      : null;
  render();
  const replacement = selector && doc.querySelector(selector);
  replacement?.focus({ preventScroll: true });
  if (selection && replacement?.setSelectionRange)
    replacement.setSelectionRange(...selection);
  for (const [selector, top, left] of positions) {
    const el = doc.querySelector(selector);
    if (el) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
  }
}

export function sameMembers(a, b) {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

export const transferBooks = (books) =>
  books.map(({ id, format, title, driveSource }) => ({
    id,
    format,
    title,
    driveSource,
  }));
