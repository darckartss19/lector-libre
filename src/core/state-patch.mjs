// Immutable snapshots let reading checkpoints send only changed fields over IPC.
const equal = (a, b) =>
  a === b ||
  (a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    JSON.stringify(a) === JSON.stringify(b));
function changes(before = {}, after = {}) {
  const set = {},
    remove = [];
  for (const key of Object.keys(before)) if (!(key in after)) remove.push(key);
  for (const [key, value] of Object.entries(after))
    if (!equal(before[key], value)) set[key] = value;
  return { set, remove };
}
export function statePatch(before, after) {
  const old = new Map(before.books.map((book) => [book.id, book]));
  const books = [];
  for (const book of after.books) {
    const previous = old.get(book.id);
    if (previous === book) continue;
    const change = changes(previous, book);
    if (Object.keys(change.set).length || change.remove.length)
      books.push({ id: book.id, ...change });
  }
  const beforeIds = before.books.map((book) => book.id),
    afterIds = after.books.map((book) => book.id);
  const topBefore = { ...before },
    topAfter = { ...after };
  delete topBefore.books;
  delete topBefore.registers;
  delete topAfter.books;
  delete topAfter.registers;
  return {
    top: changes(topBefore, topAfter),
    books,
    order:
      beforeIds.length === afterIds.length &&
      beforeIds.every((id, i) => id === afterIds[i])
        ? null
        : afterIds,
    registers: changes(before.registers, after.registers),
  };
}
export function applyStatePatch(before, patch) {
  const apply = (old, change) => {
    const next = { ...old, ...change.set };
    for (const key of change.remove) delete next[key];
    return next;
  };
  const books = new Map(before.books.map((book) => [book.id, book]));
  for (const change of patch.books)
    books.set(change.id, apply(books.get(change.id), change));
  return {
    ...apply(before, patch.top),
    books: (patch.order ?? before.books.map((book) => book.id)).map((id) =>
      books.get(id),
    ),
    registers: apply(before.registers, patch.registers),
  };
}
export function hydrateLocalCovers(state) {
  const assets = state.localCoverAssets;
  if (!assets) return state;
  const resolve = (value) => {
    if (typeof value !== "string" || !value.startsWith("@lector-cover:"))
      return value;
    const cover = assets[value.slice(14)];
    if (typeof cover !== "string")
      throw new Error("No se pudo recuperar una portada local.");
    return cover;
  };
  const result = { ...state };
  delete result.localCoverAssets;
  result.books = state.books.map((book) => ({
    ...book,
    cover: resolve(book.cover),
  }));
  result.registers = Object.fromEntries(
    Object.entries(state.registers ?? {}).map(([key, record]) => [
      key,
      JSON.parse(key)[1] === "cover"
        ? { ...record, value: resolve(record.value) }
        : record,
    ]),
  );
  return result;
}
