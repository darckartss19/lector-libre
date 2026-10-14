import { importLibrary } from "./library.mjs";
export function restoreLibrary(
  current,
  snapshot,
  { mode = "missing", preferences = false } = {},
) {
  if (
    !["missing", "replace"].includes(mode) ||
    typeof preferences !== "boolean"
  )
    throw new TypeError("Restauración no válida.");
  const restored = importLibrary(JSON.stringify(snapshot));
  const existing = new Map(current.books.map((book) => [book.id, book]));
  const received = new Map(restored.books.map((book) => [book.id, book]));
  const books = current.books.map((book) => {
    if (mode !== "replace" || !received.has(book.id)) return book;
    const recovered = received.get(book.id);
    const annotationIds = new Set(
      (recovered.annotations ?? []).map((annotation) => annotation.id),
    );
    const removed = (book.annotations ?? [])
      .filter((annotation) => !annotationIds.has(annotation.id))
      .map((annotation) => ({
        ...annotation,
        deleted: true,
        updatedAt: Date.now(),
      }));
    return {
      ...recovered,
      annotations: [...(recovered.annotations ?? []), ...removed],
    };
  });
  let highest = Math.max(-1, ...books.map((book) => book.pinOrder ?? -1));
  for (const book of restored.books)
    if (!existing.has(book.id))
      books.push({
        ...book,
        pinOrder: book.pinOrder === null ? null : ++highest,
      });
  const pinned = books.filter((book) => book.pinOrder !== null);
  if (new Set(pinned.map((book) => book.pinOrder)).size !== pinned.length) {
    const order = new Map(
      pinned
        .sort((a, b) => a.pinOrder - b.pinOrder || a.id.localeCompare(b.id))
        .map((book, index) => [book.id, index]),
    );
    for (let index = 0; index < books.length; index++)
      if (order.has(books[index].id))
        books[index] = {
          ...books[index],
          pinOrder: order.get(books[index].id),
        };
  }
  // Preserve the device identity and local revisions; commit will stamp restored fields.
  return {
    ...current,
    books,
    preferences: preferences ? restored.preferences : current.preferences,
    ...(!current.driveFolder && restored.driveFolder
      ? { driveFolder: restored.driveFolder }
      : {}),
  };
}
