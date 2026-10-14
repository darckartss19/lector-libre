import test from "node:test";
import assert from "node:assert/strict";
import {
  createLibrary,
  addBook,
  editBook,
  markRead,
  pinBook,
  upsertAnnotation,
  importLibrary,
  exportLibrary,
} from "../src/core/library.mjs";
import { restoreLibrary } from "../src/core/backup-restore.mjs";
import { stampChanges, mergeSnapshots } from "../src/core/sync.mjs";

const book = (id) => ({
  id,
  title: "Libro " + id,
  author: "Autor",
  format: "txt",
});
function fixtures() {
  let current = addBook(createLibrary(), book("shared"), 1);
  current = addBook(current, book("local-only"), 2);
  current = editBook(current, "shared", {
    title: "Título local",
    collections: ["Favoritos"],
  });
  current = markRead(
    current,
    "shared",
    { progress: 0.7, locator: { chapter: "text", fraction: 0.7 } },
    30,
  );
  current = pinBook(current, "shared");
  current = pinBook(current, "local-only");
  current.preferences = { view: "spines", theme: "dark", fontSize: 25 };
  current = stampChanges(createLibrary(), current, "local-device", 40);
  let backup = addBook(createLibrary(), book("shared"), 1);
  backup = addBook(backup, book("backup-only"), 3);
  backup = editBook(backup, "shared", {
    title: "Título de la copia",
    collections: ["Por leer"],
  });
  backup = markRead(
    backup,
    "shared",
    { progress: 0.2, locator: { chapter: "text", fraction: 0.2 } },
    15,
  );
  backup = pinBook(backup, "backup-only");
  backup = pinBook(backup, "shared");
  backup.preferences = { view: "covers", theme: "light", fontSize: 18 };
  backup = upsertAnnotation(backup, "backup-only", {
    id: "from-backup",
    type: "note",
    chapter: "text",
    start: 1,
    end: 5,
    quote: "Texto",
    note: "Anotación recuperada",
    label: "",
    color: "green",
    createdAt: 10,
    updatedAt: 10,
    deleted: false,
  });
  backup = stampChanges(createLibrary(), backup, "old-device", 20);
  return { current, backup };
}

test("Añadir una copia conserva los libros locales, su progreso y las preferencias", () => {
  const { current, backup } = fixtures();
  const before = exportLibrary(current);
  const result = restoreLibrary(current, backup);
  assert.equal(exportLibrary(current), before);
  assert.deepEqual(
    result.books.map((b) => b.id),
    ["shared", "local-only", "backup-only"],
  );
  assert.equal(result.books[0], current.books[0]);
  assert.equal(result.books[1], current.books[1]);
  assert.equal(result.books[0].title, "Título local");
  assert.equal(result.books[0].progress, 0.7);
  assert.equal(result.books[2].annotations[0].note, "Anotación recuperada");
  assert.deepEqual(result.preferences, current.preferences);
  assert.equal(result.deviceId, "local-device");
  assert.equal(result.registers, current.registers);
  assert.deepEqual(importLibrary(exportLibrary(result)).books, result.books);
});

test("Restaurar una copia en un lector vacío recupera posiciones, portadas, notas y organización", () => {
  const { backup } = fixtures();
  const empty = { ...createLibrary(), deviceId: "new-device", registers: {} };
  const result = restoreLibrary(empty, backup, { preferences: true });
  assert.deepEqual(
    result.books.map((b) => b.id),
    ["shared", "backup-only"],
  );
  assert.equal(result.books[0].title, "Título de la copia");
  assert.equal(result.books[0].progress, 0.2);
  assert.equal(result.books[0].locator.fraction, 0.2);
  assert.deepEqual(result.books[0].collections, ["Por leer"]);
  assert.equal(result.books[1].annotations.length, 1);
  assert.deepEqual(result.preferences, backup.preferences);
  assert.equal(result.deviceId, "new-device");
  assert.deepEqual(result.registers, {});
});

test("Reemplazar coincidencias conserva los libros adicionales y produce fijados válidos", () => {
  const { current, backup } = fixtures();
  const result = restoreLibrary(current, backup, {
    mode: "replace",
    preferences: true,
  });
  assert.equal(
    result.books.find((b) => b.id === "shared").title,
    "Título de la copia",
  );
  assert.equal(result.books.find((b) => b.id === "shared").progress, 0.2);
  assert.equal(
    result.books.find((b) => b.id === "local-only").title,
    "Libro local-only",
  );
  assert.equal(result.books.length, 3);
  assert.deepEqual(result.preferences, backup.preferences);
  assert.equal(result.deviceId, current.deviceId);
  const pins = result.books
    .filter((b) => b.pinOrder !== null)
    .map((b) => b.pinOrder);
  assert.equal(
    new Set(pins).size,
    pins.length,
    "Restored pin numbers cannot collide with retained local books",
  );
  assert.deepEqual(importLibrary(exportLibrary(result)).books, result.books);
});

test("Copias corruptas y opciones inválidas fallan sin mutar los libros actuales", () => {
  const { current, backup } = fixtures();
  const before = exportLibrary(current);
  for (const options of [{ mode: "other" }, { preferences: "yes" }])
    assert.throws(() => restoreLibrary(current, backup, options));
  assert.throws(() => restoreLibrary(current, { ...backup, version: 2 }));
  const duplicate = structuredClone(backup);
  duplicate.books.push(duplicate.books[0]);
  assert.throws(() => restoreLibrary(current, duplicate));
  assert.equal(exportLibrary(current), before);
});

test("Una restauración no resucita notas excluidas al volver a sincronizar", () => {
  let { current, backup } = fixtures();
  const annotation = (id) => ({
    id,
    type: "note",
    chapter: "text",
    start: 0,
    end: 5,
    quote: "Texto",
    note: id,
    label: "",
    color: "yellow",
    createdAt: 10,
    updatedAt: 10,
    deleted: false,
  });
  const before = current;
  current = upsertAnnotation(current, "shared", annotation("new-note"));
  current = upsertAnnotation(current, "local-only", annotation("keep-note"));
  current = stampChanges(before, current, "local-device", 50);
  const oldCloud = structuredClone(current);
  backup = upsertAnnotation(backup, "shared", annotation("backup-note"));
  const restored = stampChanges(
    current,
    restoreLibrary(current, backup, { mode: "replace" }),
    "local-device",
    100,
  );
  const merged = mergeSnapshots(restored, [oldCloud, backup]);
  const shared = merged.books.find((book) => book.id === "shared");
  assert.equal(
    shared.annotations.find((note) => note.id === "new-note").deleted,
    true,
  );
  assert.equal(
    shared.annotations.find((note) => note.id === "backup-note").deleted,
    false,
  );
  assert.equal(
    merged.books
      .find((book) => book.id === "local-only")
      .annotations.find((note) => note.id === "keep-note").deleted,
    false,
  );
  assert.equal(mergeSnapshots(merged, [oldCloud]), merged);
});
