import test from "node:test";
import assert from "node:assert/strict";
import {
  addBook,
  createLibrary,
  editBook,
  exportLibrary,
  importLibrary,
  markRead,
  pinBook,
  queryBooks,
} from "../src/core/library.mjs";
import {
  availabilitySets,
  bookAvailability,
  deleteLibraryView,
  libraryFilterOptions,
  normalizeLibraryFilters,
  normalizeSavedViews,
  saveLibraryView,
} from "../src/core/library-filters.mjs";
import { libraryFiltersMarkup } from "../src/library-filters.mjs";
import { mergeSnapshots, stampChanges } from "../src/core/sync.mjs";

function sample() {
  let library = createLibrary();
  for (const [id, author, language, format, genres, series, collections] of [
    [
      "one",
      "Ángela",
      "es_MX",
      "epub",
      ["Aventura, Juvenil"],
      "Viajes",
      ["Verano"],
    ],
    ["two", "ANGELA", "en", "txt", ["Aventura"], "Viajes", ["Verano"]],
    ["three", "Otra autora", "", "epub", ["Misterio"], "", []],
    ["four", "Ángela", "es-MX", "epub", ["Aventura"], "Viajes", ["Verano"]],
  ])
    library = addBook(
      library,
      {
        id,
        title: "Libro " + id,
        author,
        language,
        format,
        genres,
        series,
        collections,
      },
      10,
    );
  library = markRead(
    library,
    "one",
    { progress: 0.25, locator: { chapter: "1", fraction: 0.25 } },
    20,
  );
  library = markRead(
    library,
    "four",
    { progress: 1, locator: { chapter: "2", fraction: 1 } },
    30,
  );
  return library;
}
const ids = (books) => books.map((book) => book.id);

test("Los filtros se intersectan con búsqueda, estante, saga, colección y sección", () => {
  const library = pinBook(pinBook(sample(), "one"), "four");
  assert.deepEqual(
    ids(
      queryBooks(library, {
        section: "pinned",
        genre: "aventura",
        series: "viajes",
        collection: "verano",
        search: "Libro",
        author: "angela",
        language: "es-mx",
        format: "EPUB",
        readingState: "reading",
        availability: "local",
        localIds: ["one", "two"],
        cloudIds: ["one", "four"],
      }),
    ),
    ["one"],
  );
  assert.deepEqual(
    ids(queryBooks(library, { author: "ángela", language: "en" })),
    ["two"],
  );
  assert.deepEqual(
    ids(queryBooks(library, { format: "txt", readingState: "finished" })),
    [],
  );
  assert.deepEqual(
    ids(queryBooks(library, { collection: "Verano", language: "unknown" })),
    [],
  );
});

test("Historial incluye terminados y Leyendo solo abiertos sin terminar; Por leer incluye los no abiertos", () => {
  const library = sample();
  assert.deepEqual(ids(queryBooks(library, { section: "recentlyRead" })), [
    "four",
    "one",
  ]);
  assert.deepEqual(ids(queryBooks(library, { section: "reading" })), ["one"]);
  assert.deepEqual(ids(queryBooks(library, { section: "unread" })), [
    "three",
    "two",
  ]);
  assert.deepEqual(ids(queryBooks(library, { readingState: "unread" })), [
    "three",
    "two",
  ]);
  assert.deepEqual(
    ids(
      queryBooks(library, {
        section: "recentlyRead",
        readingState: "finished",
      }),
    ),
    ["four"],
  );
});

test("La disponibilidad depende de los archivos del dispositivo y distingue local, solo nube y ausente", () => {
  const library = sample();
  const files = {
    localIds: new Set(["one"]),
    cloudIds: new Set(["one", "two"]),
  };
  assert.deepEqual(
    ids(queryBooks(library, { availability: "local", ...files })),
    ["one"],
  );
  assert.deepEqual(
    ids(queryBooks(library, { availability: "cloud", ...files })),
    ["two"],
  );
  assert.deepEqual(
    ids(queryBooks(library, { availability: "missing", ...files })),
    ["four", "three"],
  );
  const sets = availabilitySets(files);
  assert.equal(bookAvailability(library.books[0], sets), "local");
  assert.throws(
    () => queryBooks(library, { availability: "local", localIds: "one" }),
    /Disponibilidad/,
  );
  assert.throws(
    () => queryBooks(library, { availability: "local", cloudIds: [false] }),
    /Disponibilidad/,
  );
});

test("Las opciones se obtienen de metadatos reales y agrupan nombres equivalentes sin inventar idiomas", () => {
  const options = libraryFilterOptions(sample(), {
    localIds: ["one"],
    cloudIds: ["one", "two"],
  });
  assert.deepEqual(options.authors, ["Ángela", "Otra autora"]);
  assert.deepEqual(options.languages, ["en", "es-MX"]);
  assert.deepEqual(options.formats, ["epub", "txt"]);
  assert.deepEqual(options.genres, ["Aventura", "Misterio"]);
  assert.deepEqual(options.series, ["Viajes"]);
  assert.deepEqual(options.collections, ["Verano"]);
  assert.equal(options.hasUnknownLanguage, true);
  assert.deepEqual(options.availability, ["local", "cloud", "missing"]);
  assert.equal(libraryFilterOptions(createLibrary()).hasUnknownLanguage, false);
});

test("Nombres completos de metadatos no quedan fuera del filtro por longitud o espacios de edición", () => {
  const author =
    "Autoras de una antología " + "Nombre ".repeat(60) + "\nInvitada";
  const library = addBook(
    createLibrary(),
    { id: "long-author", title: "Antología", author, format: "epub" },
    1,
  );
  const value = libraryFilterOptions(library).authors[0];
  assert.deepEqual(ids(queryBooks(library, { author: value })), [
    "long-author",
  ]);
  const saved = saveLibraryView(library, {
    id: "long-view",
    name: "Antología",
    filters: { author: value },
  });
  assert.deepEqual(importLibrary(exportLibrary(saved)), saved);
});

test("Idioma declarado sobrevive importación/exportación y libros antiguos mantienen Sin indicar", () => {
  const original = sample();
  assert.equal(original.books[0].language, "es-MX");
  assert.deepEqual(importLibrary(exportLibrary(original)), original);
  const legacy = JSON.parse(exportLibrary(original));
  delete legacy.books[0].language;
  const imported = importLibrary(JSON.stringify(legacy));
  assert.equal(imported.books[0].language, "");
  assert.deepEqual(ids(queryBooks(imported, { language: "unknown" })), [
    "one",
    "three",
  ]);
  assert.equal(
    editBook(imported, "one", { language: "pt_BR" }).books[0].language,
    "pt-BR",
  );
  assert.equal(addBook(original, { id: "one", language: "de" }), original);
  assert.throws(() => editBook(imported, "one", { language: 5 }), /Idioma/);
});

test("Las vistas guardadas preservan otras preferencias y combinaciones, pero nunca registran IDs locales", () => {
  const original = {
    ...sample(),
    preferences: { view: "spines", uiLanguage: "en", theme: "midnight" },
  };
  const filters = {
    section: "all",
    genre: "Aventura",
    author: "Ángela",
    readingState: "unread",
    availability: "local",
  };
  const saved = saveLibraryView(original, {
    id: "view-1",
    name: "  Mis aventuras  ",
    filters,
  });
  filters.author = "Cambió después";
  assert.deepEqual(saved.preferences.savedViews[0], {
    id: "view-1",
    name: "Mis aventuras",
    filters: {
      section: "all",
      genre: "Aventura",
      author: "Ángela",
      readingState: "unread",
      availability: "local",
    },
  });
  assert.equal(saved.books, original.books);
  assert.equal(saved.preferences.theme, "midnight");
  assert.equal(original.preferences.savedViews, undefined);
  const firstDevice = queryBooks(saved, {
    ...saved.preferences.savedViews[0].filters,
    localIds: ["two"],
  });
  const secondDevice = queryBooks(saved, {
    ...saved.preferences.savedViews[0].filters,
    localIds: [],
  });
  assert.deepEqual(ids(firstDevice), ["two"]);
  assert.deepEqual(ids(secondDevice), []);
  assert.deepEqual(importLibrary(exportLibrary(saved)), saved);
  const changed = saveLibraryView(saved, {
    id: "view-1",
    name: "Otro nombre",
    filters: {},
  });
  assert.equal(changed.preferences.savedViews.length, 1);
  const removed = deleteLibraryView(changed, "view-1");
  assert.equal(removed.books, changed.books);
  assert.deepEqual(removed.preferences.savedViews, []);
  assert.equal(deleteLibraryView(removed, "absent"), removed);
});

test("Validación de vistas rechaza filtros desconocidos, valores corruptos y metadatos extra sin tocar biblioteca", () => {
  const original = sample();
  const before = exportLibrary(original);
  for (const filters of [
    { localIds: ["one"] },
    { author: false },
    { author: 0 },
    { language: null },
    { availability: "offline" },
    { format: "exe" },
    { section: "anything" },
    { readingState: "begun" },
    { sort: "random" },
    JSON.parse('{"__proto__":{"x":true}}'),
  ]) {
    assert.throws(() =>
      saveLibraryView(original, { id: "view", name: "Prueba", filters }),
    );
    assert.throws(() => normalizeLibraryFilters(filters));
  }
  assert.throws(
    () => saveLibraryView(original, { id: "view", name: " ", filters: {} }),
    /Vista/,
  );
  assert.throws(
    () =>
      saveLibraryView(original, {
        id: "view",
        name: "Prueba",
        filters: {},
        secret: "x",
      }),
    /Vista/,
  );
  assert.throws(
    () =>
      normalizeSavedViews([
        { id: "view", name: "A", filters: {} },
        { id: "view", name: "B", filters: {} },
      ]),
    /repetido/,
  );
  assert.throws(() => queryBooks(original, { author: false }), /Filtro/);
  assert.equal(exportLibrary(original), before);
});

test("Idioma y vistas guardadas viajan en sincronización y conservan validación", () => {
  const seed = stampChanges(createLibrary(), sample(), "device-A", 10);
  const changed = saveLibraryView(editBook(seed, "one", { language: "fr" }), {
    id: "view-1",
    name: "Francés",
    filters: { language: "fr", availability: "local" },
  });
  const snapshot = stampChanges(seed, changed, "device-B", 20);
  const merged = mergeSnapshots(seed, [snapshot]);
  assert.equal(merged.books.find((book) => book.id === "one").language, "fr");
  assert.deepEqual(
    merged.preferences.savedViews,
    changed.preferences.savedViews,
  );
  const corrupt = structuredClone(snapshot);
  corrupt.registers['["","preferences"]'].value.savedViews[0].filters.filePath =
    "C:/private";
  assert.throws(() => mergeSnapshots(seed, [corrupt]), /Filtro/);
});

test("Lectura por páginas valida preferencia y offset sin romper posiciones anteriores", () => {
  for (const readingMode of ["scroll", "page", "spread"]) {
    const library = {
      ...sample(),
      preferences: { view: "covers", readingMode },
    };
    const moved = markRead(
      library,
      "one",
      { progress: 0.5, locator: { chapter: "1", fraction: 0.5, offset: 42 } },
      40,
    );
    assert.deepEqual(importLibrary(exportLibrary(moved)), moved);
  }
  for (const offset of [-1, 1.5, NaN, Infinity, "10"])
    assert.throws(
      () =>
        markRead(sample(), "one", {
          progress: 0.5,
          locator: { chapter: "1", offset },
        }),
      /Desplazamiento/,
    );
  assert.throws(
    () =>
      importLibrary(
        JSON.stringify({
          ...sample(),
          preferences: { view: "covers", readingMode: "three" },
        }),
      ),
    /Preferencia/,
  );
  assert.equal(
    markRead(sample(), "one", { progress: 0.5, locator: "old-position" }, 40)
      .books[0].locator,
    "old-position",
  );
});

test("El panel escapa nombres de libros y vistas y marca como contenido los nombres del usuario", () => {
  const library = saveLibraryView(
    addBook(
      createLibrary(),
      {
        id: "html",
        title: "Prueba",
        author: '<img src=x onerror="x">',
        language: "",
        format: "epub",
        genres: ["<Aventura>"],
        series: '"Saga"',
        collections: ["<Colección>"],
      },
      1,
    ),
    { id: "view", name: '<img src=x onerror="x">', filters: {} },
  );
  const markup = libraryFiltersMarkup({
    library,
    selectedView: "view",
    localIds: ["html"],
  });
  assert.ok(!markup.includes("<img"));
  assert.ok(markup.includes("&lt;img src=x onerror=&quot;x&quot;&gt;"));
  assert.ok(markup.includes('value="view" selected data-content'));
  assert.ok(markup.includes('data-library-filter="availability"'));
  assert.ok(markup.includes("Sin indicar"));
  assert.ok(!markup.includes("Solo en Drive"));
});
