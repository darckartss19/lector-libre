import test from "node:test";
import assert from "node:assert/strict";
import {
  createLibrary,
  addBook,
  editBook,
  pinBook,
  reorderPins,
  queryBooks,
  genreShelves,
  primaryGenre,
  seriesGroups,
  setView,
  markRead,
  setAudioPosition,
  exportLibrary,
  importLibrary,
} from "../src/core/library.mjs";

const book = (id) => ({
  id,
  title: "Libro " + id,
  author: "Autor de prueba",
  format: "epub",
  genres: ["Fantasía"],
});
function sample(count = 12) {
  let lib = createLibrary();
  for (let i = 1; i <= count; i++)
    lib = addBook(lib, book(String(i)), i * 1000);
  return lib;
}

test("Se pueden fijar más de cinco libros sin perderlos ni limitar la consulta", () => {
  let lib = sample();
  for (const item of lib.books) lib = pinBook(lib, item.id);
  assert.equal(queryBooks(lib, { section: "pinned" }).length, 12);
  lib = reorderPins(lib, ["12", "1"]);
  assert.deepEqual(
    queryBooks(lib, { section: "pinned" })
      .slice(0, 3)
      .map((b) => b.id),
    ["12", "1", "2"],
  );
  assert.equal(
    queryBooks(pinBook(lib, "12", false), { section: "pinned" }).length,
    11,
  );
});

test("Reimportar un libro conserva metadatos personalizados, fijados y progreso", () => {
  let lib = editBook(sample(1), "1", { title: "Mi título" });
  lib = pinBook(lib, "1");
  lib = markRead(
    lib,
    "1",
    { progress: 0.4, locator: { cfi: "epubcfi(/6/2)" } },
    7000,
  );
  assert.deepEqual(addBook(lib, book("1"), 9999), lib);
  assert.equal(lib.books[0].importedMetadata.title, "Libro 1");
});

test("Los recientes usan la fecha de incorporación, distinta a la de última lectura", () => {
  let lib = sample(3);
  lib = markRead(lib, "1", { progress: 0.5, locator: "cap-1" }, 9999);
  assert.deepEqual(
    queryBooks(lib, { section: "recent" }).map((b) => b.id),
    ["3", "2", "1"],
  );
  assert.deepEqual(
    queryBooks(lib, { section: "recentlyRead" }).map((b) => b.id),
    ["1"],
  );
  assert.deepEqual(
    queryBooks(lib, { section: "reading" }).map((b) => b.id),
    ["1"],
  );
});

test("Las estanterías usan el primer género y conservan los secundarios para buscar", () => {
  let lib = editBook(sample(2), "1", {
    genres: ["Fantasía", " fantasía ", "Misterio"],
  });
  lib = editBook(lib, "2", { genres: ["FANTASIA, Aventuras, Juvenil"] });
  assert.equal(genreShelves(lib).length, 1);
  assert.equal(genreShelves(lib)[0].name, "Fantasía");
  assert.equal(queryBooks(lib, { genre: " fantasia " }).length, 2);
  assert.equal(queryBooks(lib, { genre: "misterio" }).length, 0);
  assert.equal(queryBooks(lib, { search: "misterio" }).length, 1);
  assert.equal(queryBooks(lib, { search: "juvenil" }).length, 1);
  assert.deepEqual(lib.books[0].genres, ["Fantasía", "Misterio"]);
  assert.deepEqual(lib.books[1].genres, ["FANTASIA, Aventuras, Juvenil"]);
});

test("Los géneros combinados no crean estantes adicionales y no pierden metadatos", () => {
  let lib = sample(3);
  lib = editBook(lib, "1", {
    genres: ["Aventuras, Fantástico, Juvenil", "Drama"],
  });
  lib = editBook(lib, "2", { genres: ["AVENTURAS", "Misterio"] });
  lib = editBook(lib, "3", { genres: ["Misterio, Aventuras"] });
  const shelves = genreShelves(lib, { clone: false });
  assert.deepEqual(
    shelves.map((s) => [s.name, s.books.length]),
    [
      ["Aventuras", 2],
      ["Misterio", 1],
    ],
  );
  assert.equal(shelves[0].books[0], lib.books[0]);
  assert.equal(primaryGenre({ genres: [] }), "");
  assert.equal(
    primaryGenre({ genres: [", , Aventuras, Juvenil"] }),
    "Aventuras",
  );
  assert.equal(queryBooks(lib, { search: "aventuras" }).length, 3);
});

test("Las sagas agrupan nombres equivalentes y ordenan números antes que títulos o posiciones ausentes", () => {
  let lib = sample(5);
  for (const [id, series, seriesIndex, title] of [
    ["1", "Crónicas", 10, "A final"],
    ["2", "cronicas", 2, "Z segundo"],
    ["3", "CRÓNICAS", 0.5, "Precuela"],
    ["4", " Crónicas ", null, "Sin número"],
    ["5", "Otra saga", 1, "Otro"],
  ])
    lib = editBook(lib, id, { series, seriesIndex, title });
  const groups = seriesGroups(lib, { clone: false });
  assert.deepEqual(
    groups.map((g) => g.name),
    ["Crónicas", "Otra saga"],
  );
  assert.deepEqual(
    groups[0].books.map((b) => b.id),
    ["3", "2", "1", "4"],
  );
  assert.deepEqual(
    queryBooks(lib, { series: " cronicas " }).map((b) => b.id),
    ["3", "2", "1", "4"],
  );
  assert.equal(queryBooks(lib, { search: "crónicas" }).length, 3);
  assert.equal(groups[0].books[0], lib.books[2]);
  seriesGroups(lib)[0].books[0].series = "No guardar";
  assert.equal(lib.books[2].series, "CRÓNICAS");
});

test("Saga y orden sobreviven la copia y la reimportación, y los libros antiguos tienen valores vacíos", () => {
  let lib = addBook(
    createLibrary(),
    { ...book("1"), series: "Original", seriesIndex: 1 },
    1,
  );
  lib = editBook(lib, "1", { series: "Mi saga", seriesIndex: 1.5 });
  assert.deepEqual(importLibrary(exportLibrary(lib)), lib);
  assert.equal(
    addBook(lib, { ...book("1"), series: "Otra", seriesIndex: 9 }, 10),
    lib,
  );
  const legacy = JSON.parse(exportLibrary(lib));
  delete legacy.books[0].series;
  delete legacy.books[0].seriesIndex;
  const recovered = importLibrary(JSON.stringify(legacy));
  assert.equal(recovered.books[0].series, "");
  assert.equal(recovered.books[0].seriesIndex, null);
  assert.deepEqual(seriesGroups(recovered), []);
});

test("Los índices de saga rechazan valores inválidos sin modificar la biblioteca", () => {
  const lib = sample(1);
  for (const seriesIndex of [-1, NaN, Infinity, "1", false]) {
    assert.throws(() => editBook(lib, "1", { seriesIndex }), /saga/);
    assert.throws(
      () => addBook(createLibrary(), { ...book("2"), seriesIndex }, 1),
      /saga/,
    );
  }
  for (const series of [null, 1, {}])
    assert.throws(() => editBook(lib, "1", { series }), /Saga/);
  const invalidCopy = JSON.parse(exportLibrary(lib));
  invalidCopy.books[0].seriesIndex = -0.5;
  assert.throws(() => importLibrary(JSON.stringify(invalidCopy)), /saga/);
  assert.equal(
    editBook(lib, "1", { series: "Serie", seriesIndex: 0 }).books[0]
      .seriesIndex,
    0,
  );
  assert.equal(lib.books[0].series, "");
  assert.equal(lib.books[0].seriesIndex, null);
});

test("Cambiar la vista conserva la biblioteca; editar o consultar no modifica el estado original", () => {
  const lib = sample(1),
    snapshot = exportLibrary(lib);
  const changed = setView(
    editBook(lib, "1", { title: "Otro título" }),
    "spines",
  );
  assert.equal(changed.preferences.view, "spines");
  assert.equal(changed.books.length, 1);
  queryBooks(lib)[0].genres.push("No debe guardarse");
  assert.equal(exportLibrary(lib), snapshot);
});

test("La copia recupera organización, lectura, audio y metadatos originales", () => {
  let lib = setView(sample(2), "spines");
  lib = pinBook(lib, "2");
  lib = editBook(lib, "1", { title: "Personalizado", cover: "cover-local-1" });
  lib = markRead(
    lib,
    "1",
    { progress: 0.65, locator: { chapter: 2, offset: 120 } },
    20000,
  );
  lib = setAudioPosition(lib, "1", {
    chapter: "2",
    offset: 120,
    voice: "voz-es",
    rate: 1.2,
  });
  assert.deepEqual(importLibrary(exportLibrary(lib)), lib);
});

test("No se aceptan posiciones inválidas ni copias de formato desconocido o con identificadores repetidos", () => {
  const lib = sample(1);
  for (const progress of [NaN, -1, 1.1])
    assert.throws(() => markRead(lib, "1", { progress, locator: "a" }));
  assert.throws(() =>
    setAudioPosition(lib, "1", { chapter: "a", offset: -1, voice: "voz" }),
  );
  assert.throws(() => editBook(lib, "1", { id: "otro" }));
  assert.throws(() => importLibrary(JSON.stringify({ ...lib, version: 2 })));
  assert.throws(() =>
    importLibrary(
      JSON.stringify({ ...lib, books: [lib.books[0], lib.books[0]] }),
    ),
  );
});
