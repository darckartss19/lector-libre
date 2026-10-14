import test from "node:test";
import assert from "node:assert/strict";
import {
  createLibrary,
  addBook,
  editBook,
  editBooks,
  collectionGroups,
  queryBooks,
  normalizeAnnotation,
  upsertAnnotation,
  deleteAnnotation,
  visibleAnnotations,
  exportLibrary,
  importLibrary,
  markRead,
} from "../src/core/library.mjs";
import { stampChanges, mergeSnapshots } from "../src/core/sync.mjs";

function sample() {
  let library = createLibrary();
  for (const id of ["one", "two", "three"])
    library = addBook(
      library,
      {
        id,
        title: "Libro " + id,
        format: "epub",
        author: "Autora",
        genres: ["Aventuras, Juvenil"],
        cover: "data:image/png;base64,cHJ1ZWJh",
      },
      10,
    );
  return library;
}
const annotation = (id, overrides = {}) => ({
  id,
  type: "highlight",
  chapter: "chapter1",
  start: 10,
  end: 25,
  quote: "Texto del libro",
  note: "",
  label: "",
  color: "yellow",
  createdAt: 20,
  updatedAt: 20,
  deleted: false,
  ...overrides,
});
const seed = () => stampChanges(createLibrary(), sample(), "A", 10);

test("Editar varios libros es atómico, conserva progreso y reutiliza libros ajenos y portadas", () => {
  const original = markRead(
    sample(),
    "one",
    {
      progress: 0.5,
      locator: { chapter: "chapter1", fraction: 0.5 },
    },
    15,
  );
  const serialized = exportLibrary(original);
  const result = editBooks(original, ["one", "two"], {
    author: "Otra autora",
    genres: ["Misterio", "Juvenil"],
    series: "Una saga",
    collections: ["Por leer", "Favoritos"],
  });
  assert.equal(exportLibrary(original), serialized);
  assert.equal(result.books[2], original.books[2]);
  assert.equal(result.books[0].cover, original.books[0].cover);
  assert.equal(result.books[0].progress, 0.5);
  assert.deepEqual(result.books[0].locator, original.books[0].locator);
  assert.equal(result.books[1].author, "Otra autora");
  assert.notEqual(result.books[0].genres, result.books[1].genres);
  assert.notEqual(result.books[0].collections, result.books[1].collections);
  result.books[0].collections.push("Solo en uno");
  assert.deepEqual(result.books[1].collections, ["Por leer", "Favoritos"]);
  for (const [ids, patch] of [
    [["one", "missing"], { author: "No guardar" }],
    [["one", "one"], { author: "No guardar" }],
    [[], { author: "No guardar" }],
    [["one", "two"], { author: "No guardar", genres: [""] }],
    [["one", "two"], { annotations: [] }],
    [["one"], null],
  ])
    assert.throws(() => editBooks(original, ids, patch));
  assert.equal(exportLibrary(original), serialized);
  assert.equal(editBooks(original, ["one"], {}), original);
});

test("Las colecciones permiten varias pertenencias y agrupan acentos y mayúsculas", () => {
  let library = editBook(sample(), "one", {
    collections: [
      "Favoritos",
      "FAVORITOS",
      " Ciencia ficción ",
      "ciencia ficcion",
    ],
  });
  library = editBook(library, "two", { collections: ["Ciencia Ficción"] });
  assert.deepEqual(library.books[0].collections, [
    "Favoritos",
    "Ciencia ficción",
  ]);
  const groups = collectionGroups(library, { clone: false });
  assert.deepEqual(
    groups.map((group) => [group.name, group.books.length]),
    [
      ["Ciencia ficción", 2],
      ["Favoritos", 1],
    ],
  );
  assert.equal(groups[0].books[0], library.books[0]);
  assert.deepEqual(
    queryBooks(library, { collection: "CIENCIA FICCION" }).map((b) => b.id),
    ["one", "two"],
  );
  assert.equal(queryBooks(library, { search: "favoritos" }).length, 1);
  collectionGroups(library)[0].books[0].collections.push("No guardar");
  assert.equal(library.books[0].collections.length, 2);
  assert.deepEqual(
    editBook(library, "one", { collections: [] }).books[0].collections,
    [],
  );
  assert.throws(() => editBook(library, "one", { collections: [" "] }));
  assert.throws(() => editBook(library, "one", { collections: "Favoritos" }));
});

test("Marcadores, resaltados y notas conservan texto y se consultan sin exponer el estado", () => {
  let library = sample();
  library = upsertAnnotation(
    library,
    "one",
    annotation("note-1", {
      type: "note",
      chapter: "chapter2",
      quote: "\n Texto exacto \n",
      note: "Mi nota",
    }),
  );
  library = upsertAnnotation(
    library,
    "one",
    annotation("bookmark-1", {
      type: "bookmark",
      start: 4,
      end: 4,
      quote: "",
      label: "Volver aquí",
    }),
  );
  library = upsertAnnotation(library, "one", annotation("highlight-1"));
  const book = library.books[0];
  assert.deepEqual(
    visibleAnnotations(book).map((item) => item.id),
    ["bookmark-1", "highlight-1", "note-1"],
  );
  assert.equal(visibleAnnotations(book, { chapter: "chapter1" }).length, 2);
  visibleAnnotations(book)[0].label = "No guardar";
  assert.equal(visibleAnnotations(book)[0].label, "Volver aquí");
  assert.equal(
    visibleAnnotations(book, { chapter: "chapter2" })[0].quote,
    "\n Texto exacto \n",
  );
  const updated = annotation("note-1", {
    type: "note",
    chapter: "chapter2",
    note: "Otra nota",
    updatedAt: 30,
  });
  library = upsertAnnotation(library, "one", updated);
  assert.equal(library.books[0].annotations.length, 3);
  assert.equal(
    visibleAnnotations(library.books[0], { chapter: "chapter2" })[0].note,
    "Otra nota",
  );
  assert.throws(() =>
    upsertAnnotation(library, "one", { ...updated, createdAt: 29 }),
  );
  const removed = deleteAnnotation(library, "one", "note-1", 40);
  assert.equal(visibleAnnotations(removed.books[0]).length, 2);
  assert.equal(removed.books[0].annotations.length, 3);
  assert.equal(
    removed.books[0].annotations.find((item) => item.id === "note-1").updatedAt,
    40,
  );
  assert.equal(deleteAnnotation(removed, "one", "note-1", 50), removed);
  assert.equal(visibleAnnotations(library.books[0]).length, 3);
});

test("Las anotaciones invalidas nunca modifican la biblioteca", () => {
  const library = sample(),
    serialized = exportLibrary(library);
  for (const patch of [
    { id: "../unsafe" },
    { id: "" },
    { type: "other" },
    { start: -1 },
    { start: 1.5 },
    { end: 5 },
    { end: 10 },
    { end: Infinity },
    { chapter: " " },
    { quote: null },
    { color: "purple" },
    { deleted: "false" },
    { createdAt: -1 },
    { updatedAt: 19 },
  ])
    assert.throws(() =>
      upsertAnnotation(library, "one", annotation("mark", patch)),
    );
  assert.throws(() => upsertAnnotation(library, "missing", annotation("mark")));
  assert.throws(() => deleteAnnotation(library, "one", "unknown"));
  assert.throws(() => deleteAnnotation(library, "missing", "mark"));
  assert.equal(exportLibrary(library), serialized);
  assert.equal(
    normalizeAnnotation(
      annotation("bookmark", {
        type: "bookmark",
        start: 0,
        end: 0,
      }),
    ).start,
    0,
  );
});

test("La copia y la reimportación conservan colecciones, anotaciones y tombstones", () => {
  let library = editBook(sample(), "one", { collections: ["Favoritos"] });
  library = upsertAnnotation(
    library,
    "one",
    annotation("note", { type: "note" }),
  );
  library = upsertAnnotation(library, "one", annotation("highlight"));
  library = deleteAnnotation(library, "one", "highlight", 25);
  assert.deepEqual(importLibrary(exportLibrary(library)), library);
  assert.equal(
    addBook(
      library,
      {
        id: "one",
        title: "Original",
        format: "epub",
        collections: [],
        annotations: [],
      },
      50,
    ),
    library,
  );
  const legacy = JSON.parse(exportLibrary(library));
  for (const book of legacy.books) {
    delete book.collections;
    delete book.annotations;
  }
  const restored = importLibrary(JSON.stringify(legacy));
  assert.deepEqual(restored.books[0].collections, []);
  assert.deepEqual(restored.books[0].annotations, []);
  const invalid = JSON.parse(exportLibrary(library));
  invalid.books[0].annotations.push(invalid.books[0].annotations[0]);
  assert.throws(() => importLibrary(JSON.stringify(invalid)), /repetido/);
});

test("Dos dispositivos añaden notas independientes sin perder ninguna", () => {
  const base = seed();
  const a = stampChanges(
    base,
    upsertAnnotation(
      base,
      "one",
      annotation("device-a", { type: "note", note: "A" }),
    ),
    "A",
    30,
  );
  const b = stampChanges(
    base,
    upsertAnnotation(
      base,
      "one",
      annotation("device-b", { type: "note", note: "B" }),
    ),
    "B",
    30,
  );
  const merged = mergeSnapshots(a, [b]);
  assert.equal(visibleAnnotations(merged.books[0]).length, 2);
  assert.deepEqual(mergeSnapshots(b, [a]).books, merged.books);
  assert.equal(
    Object.keys(merged.registers).filter((key) =>
      JSON.parse(key)[1].startsWith("annotation:"),
    ).length,
    2,
  );
  assert.equal(
    Object.keys(merged.registers).some(
      (key) => JSON.parse(key)[1] === "annotations",
    ),
    false,
  );
  const fresh = mergeSnapshots(createLibrary(), [
    JSON.parse(JSON.stringify(merged)),
  ]);
  assert.deepEqual(fresh.books, merged.books);
});

test("Borrar un resaltado vence a snapshots antiguos y no elimina otras notas concurrentes", () => {
  const base = seed();
  const withNote = stampChanges(
    base,
    upsertAnnotation(base, "one", annotation("mark")),
    "A",
    30,
  );
  const deleted = stampChanges(
    withNote,
    deleteAnnotation(withNote, "one", "mark", 50),
    "A",
    50,
  );
  const anotherDevice = stampChanges(
    withNote,
    upsertAnnotation(
      withNote,
      "one",
      annotation("other", { type: "note", note: "B" }),
    ),
    "B",
    40,
  );
  const merged = mergeSnapshots(deleted, [withNote, anotherDevice]);
  assert.deepEqual(
    visibleAnnotations(merged.books[0]).map((a) => a.id),
    ["other"],
  );
  assert.equal(
    merged.books[0].annotations.find((a) => a.id === "mark").deleted,
    true,
  );
  assert.deepEqual(
    mergeSnapshots(anotherDevice, [deleted]).books,
    merged.books,
  );
  const recovered = mergeSnapshots(createLibrary(), [
    JSON.parse(JSON.stringify(merged)),
  ]);
  assert.equal(visibleAnnotations(recovered.books[0]).length, 1);
  assert.equal(mergeSnapshots(recovered, [withNote]), recovered);
});

test("Colecciones y notas se sincronizan aparte del progreso y sobreviven la nube antigua", () => {
  const base = seed();
  let next = editBooks(base, ["one", "two"], {
    collections: ["Lecturas del año"],
  });
  next = upsertAnnotation(
    next,
    "one",
    annotation("note", { type: "note", note: "Guardar" }),
  );
  const a = stampChanges(base, next, "A", 30);
  const legacy = structuredClone(base);
  for (const book of legacy.books) {
    delete book.collections;
    delete book.annotations;
  }
  for (const key of Object.keys(legacy.registers))
    if (JSON.parse(key)[1] === "collections") delete legacy.registers[key];
  const b = stampChanges(
    legacy,
    markRead(
      legacy,
      "one",
      {
        progress: 0.6,
        locator: { chapter: "chapter1", fraction: 0.6 },
      },
      40,
    ),
    "B",
    40,
  );
  b.registers[JSON.stringify(["one", "annotations"])] = {
    time: 99,
    counter: 0,
    device: "B",
    value: [],
  };
  const merged = mergeSnapshots(a, [b]);
  assert.equal(merged.books[0].progress, 0.6);
  assert.deepEqual(merged.books[0].collections, ["Lecturas del año"]);
  assert.equal(visibleAnnotations(merged.books[0])[0].note, "Guardar");
  const fresh = mergeSnapshots(createLibrary(), [
    JSON.parse(JSON.stringify(merged)),
  ]);
  assert.deepEqual(fresh.books, merged.books);
});

test("Registros de anotaciones corruptos se rechazan sin mutar el estado local", () => {
  const local = seed(),
    serialized = JSON.stringify(local);
  for (const [field, value] of [
    ["annotation:one", annotation("different")],
    ["annotation:unsafe/../", annotation("one")],
    ["annotation:one", annotation("one", { end: -1 })],
    ["annotations", [annotation("one")]],
    ["unknown", []],
  ]) {
    const snapshot = structuredClone(local);
    snapshot.registers[JSON.stringify(["one", field])] = {
      time: 40,
      counter: 0,
      device: "B",
      value,
    };
    assert.throws(() => mergeSnapshots(local, [snapshot]));
  }
  const invalidKey = structuredClone(local);
  invalidKey.registers['["one","title","extra"]'] = {
    time: 40,
    counter: 0,
    device: "B",
    value: "Otro",
  };
  assert.throws(() => mergeSnapshots(local, [invalidKey]));
  assert.equal(JSON.stringify(local), serialized);
});
