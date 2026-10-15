import { installStateBridge } from "./helpers/state-bridge.mjs";
// Series metadata, grouping and primary-genre shelves in an isolated browser.
// The fake native bridge never reads installed books, files or user accounts.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { zipSync, strToU8 } from "fflate";
import {
  createLibrary,
  addBook,
  markRead,
  pinBook,
} from "../src/core/library.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: "node_modules/.vite-browser-series",
  optimizeDeps: { holdUntilCrawlEnd: false },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const id = (digit) => digit.repeat(64);
const epub = (metadata) =>
  zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
    ),
    "book.opf": strToU8(
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">series-fixture</dc:identifier><dc:title>Título original del EPUB</dc:title><dc:creator>Autor original</dc:creator><dc:language>es</dc:language>${metadata}</metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" /><item id="cover" href="cover.png" media-type="image/png" properties="cover-image" /></manifest><spine><itemref idref="chapter" /></spine></package>`,
    ),
    "chapter.xhtml": strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Inicio</title></head><body><p>Una historia de prueba.</p></body></html>',
    ),
    "cover.png": new Uint8Array([137, 80, 78, 71]),
  });
const calibre = epub(
  '<meta name="calibre:series" content="Calibre Saga" /><meta name="calibre:series_index" content="1.5" />',
);
const epub3 = epub(
  '<meta property="belongs-to-collection" id="series">EPUB Saga</meta><meta refines="#series" property="collection-type">series</meta><meta refines="#series" property="group-position">2</meta>',
);
const editorial = epub(
  '<meta property="belongs-to-collection" id="collection">Edición completa</meta><meta refines="#collection" property="collection-type">set</meta><meta refines="#collection" property="group-position">4</meta>',
);
const records = [
  [
    "1",
    "Libro segundo",
    ["Aventuras, Fantástico, Juvenil"],
    "Biblioteca",
    2,
    "txt",
  ],
  ["2", "Libro primero", ["AVENTURAS", "Misterio"], "Biblioteca", 1, "txt"],
  ["3", "Libro sin número", ["Aventuras, Misterio"], "Biblioteca", null, "txt"],
  ["4", "Libro editable", ["Ciencia ficción, Aventuras"], "", null, "txt"],
  ["5", "Archivo de Calibre", ["Aventuras"], "", null, "epub"],
  ["6", "Archivo EPUB3", ["Ciencia ficción"], "", null, "epub"],
  ["7", "Colección editorial", ["Aventuras"], "", null, "epub"],
  ["8", "Archivo dañado", ["Aventuras"], "", null, "epub"],
  ["9", "Libro remoto", ["Aventuras"], "", null, "epub"],
  ["a", "Saga manual", ["Aventuras"], "Elección personal", 9, "epub"],
];
let fixture = createLibrary();
for (const [digit, title, genres, series, seriesIndex, format] of records) {
  fixture = addBook(
    fixture,
    {
      id: id(digit),
      title,
      author: "Autor de prueba",
      genres,
      series,
      seriesIndex,
      format,
    },
    1,
  );
  Object.assign(fixture.books.at(-1), { series, seriesIndex });
}
fixture.preferences.view = "list";
fixture = markRead(fixture, id("4"), {
  progress: 0.42,
  locator: { chapter: "text", fraction: 0.42 },
});
fixture = pinBook(fixture, id("4"), true);
fixture.books.find((book) => book.id === id("4")).audioPosition = {
  chapter: "text",
  paragraph: 2,
  offset: 8,
};
const protectedMetadata = structuredClone(
  fixture.books.find((book) => book.id === id("4")),
);
// This is an older library record, without the newly introduced optional fields.
delete fixture.books.find((book) => book.id === id("4")).series;
delete fixture.books.find((book) => book.id === id("4")).seriesIndex;
const bytes = {
  [id("5")]: [...calibre],
  [id("6")]: [...epub3],
  [id("7")]: [...editorial],
  [id("8")]: [0, 1, 2, 3],
  [id("9")]: [...calibre],
  [id("a")]: [...calibre],
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installStateBridge(page, { platform: "windows" });
  await page.addInitScript(
    ({ initial, bytes, remote }) => {
      let callbackId = 0;
      const callbacks = new Map(),
        listeners = new Map();
      window.saved = structuredClone(initial);
      window.calls = [];
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: (callback) => {
          callbacks.set(++callbackId, callback);
          return callbackId;
        },
        invoke: async (command, args) => {
          window.calls.push({ command, args });
          switch (command) {
            case "load_state":
              return structuredClone(window.saved);
            case "save_state":
              window.saved = structuredClone(args.value);
              return;
            case "book_availability":
              return args.books
                .filter((book) => book.id !== remote)
                .map((book) => book.id);
            case "drive_config":
              return {
                configured: false,
                connected: false,
                booksEnabled: false,
                canImport: false,
              };
            case "read_book": {
              if (!bytes[args.id])
                throw new Error("No existe el archivo de prueba.");
              if (window.pauseReadId === args.id)
                await new Promise((resolve) => {
                  window.resumeRead = resolve;
                });
              return new Uint8Array(bytes[args.id]).buffer;
            }
            case "neural_catalog":
              return [];
            case "speech_command":
              return args.command.action === "voices" ? [] : null;
            case "diagnostic_event":
              return;
            case "plugin:event|listen":
              listeners.set(args.event, callbacks.get(args.handler));
              return args.handler;
            default:
              throw new Error("Unexpected command " + command);
          }
        },
      };
      const interval = window.setInterval;
      window.setInterval = (callback, ms, ...args) =>
        ms === 60000 ? 1 : interval(callback, ms, ...args);
    },
    { initial: fixture, bytes, remote: id("9") },
  );
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "neural_catalog"),
  );
  const titles = () => page.locator(".books .book-title").allTextContents();
  const allBooks = () => page.locator('[data-section="all"]').click();
  const groups = () =>
    page.locator('.sidebar [data-action="series-groups"]').click();
  const group = (name) =>
    page
      .locator(".series-groups")
      .locator("[data-series]")
      .filter({ hasText: name });
  const openGroup = async (name) => {
    await groups();
    await group(name).click();
  };

  // The primary genre defines one shelf, while all genres remain searchable.
  assert.equal(await page.locator(".sidebar [data-genre]").count(), 2);
  const adventure = page.locator('.sidebar [data-genre="Aventuras"]');
  assert.match(await adventure.innerText(), /8\s*$/);
  await adventure.click();
  assert.equal((await titles()).length, 8);
  assert.equal((await titles()).includes("Libro editable"), false);
  await page.locator('.sidebar [data-genre="Ciencia ficción"]').click();
  assert.deepEqual((await titles()).sort(), [
    "Archivo EPUB3",
    "Libro editable",
  ]);
  await allBooks();
  await page.locator("#search").fill("Misterio");
  assert.deepEqual((await titles()).sort(), [
    "Libro primero",
    "Libro sin número",
  ]);
  await page.locator("#search").fill("Biblioteca");
  assert.equal((await titles()).length, 3);
  await page.locator("#search").fill("");
  await page.locator("#sort").selectOption("series");
  assert.deepEqual(
    (await titles()).filter((title) =>
      ["Libro primero", "Libro segundo", "Libro sin número"].includes(title),
    ),
    ["Libro primero", "Libro segundo", "Libro sin número"],
  );

  // Series groups use numerical positions, with an unnumbered book placed last.
  await groups();
  assert.equal(await page.locator(".series-groups [data-series]").count(), 2);
  await group("Biblioteca").click();
  assert.equal(await page.locator("#screen h1").innerText(), "Biblioteca");
  assert.deepEqual(await titles(), [
    "Libro primero",
    "Libro segundo",
    "Libro sin número",
  ]);
  await page.locator('[data-section="pinned"]').click();
  assert.deepEqual(await titles(), ["Libro editable"]);
  await adventure.click();
  assert.equal(
    (await titles()).length,
    8,
    "Selecting a shelf clears the previous series and section",
  );
  await allBooks();
  assert.equal((await titles()).length, 10);

  // Editing a legacy book introduces optional series data without losing reading state.
  await page.locator(`[data-edit="${id("4")}"]`).click();
  assert.equal(await page.locator('dialog [name="series"]').inputValue(), "");
  await page.locator('dialog [name="series"]').fill("Biblioteca");
  await page.locator('dialog [name="seriesIndex"]').fill("0.5");
  assert.ok(
    await page.locator('dialog datalist option[value="Biblioteca"]').count(),
  );
  await page.locator('dialog button[value="save"]').click();
  await page.waitForFunction(
    (bookId) =>
      window.saved.books.find((book) => book.id === bookId).seriesIndex === 0.5,
    id("4"),
  );
  const edited = await page.evaluate(
    (bookId) => window.saved.books.find((book) => book.id === bookId),
    id("4"),
  );
  assert.equal(edited.series, "Biblioteca");
  for (const field of [
    "id",
    "title",
    "author",
    "format",
    "cover",
    "progress",
    "locator",
    "audioPosition",
    "lastReadAt",
    "pinOrder",
    "addedAt",
  ])
    assert.deepEqual(
      edited[field],
      protectedMetadata[field],
      `${field} is preserved when editing series`,
    );
  await openGroup("Biblioteca");
  assert.deepEqual(await titles(), [
    "Libro editable",
    "Libro primero",
    "Libro segundo",
    "Libro sin número",
  ]);
  await allBooks();
  await page.locator(`[data-edit="${id("4")}"]`).click();
  await page.locator('dialog [name="series"]').fill("Cambio descartado");
  await page.locator('dialog button[value="cancel"]').click();
  assert.equal(
    await page.evaluate(
      (bookId) => window.saved.books.find((book) => book.id === bookId).series,
      id("4"),
    ),
    "Biblioteca",
  );

  // EPUB2/Calibre and EPUB3 series are extracted; an editorial set is not a saga.
  const metadata = await page.evaluate(
    async ({ calibre, epub3, editorial }) => {
      const { parseBook } = await import("/src/core/epub.mjs");
      return [calibre, epub3, editorial].map((bytes) =>
        parseBook(new Uint8Array(bytes), "epub", "fixture.epub", {
          metadataOnly: true,
          seriesOnly: true,
        }),
      );
    },
    { calibre: [...calibre], epub3: [...epub3], editorial: [...editorial] },
  );
  assert.equal(metadata[0].series, "Calibre Saga");
  assert.equal(metadata[0].seriesIndex, 1.5);
  assert.equal(metadata[1].series, "EPUB Saga");
  assert.equal(metadata[1].seriesIndex, 2);
  assert.equal(metadata[2].series || "", "");
  for (const parsed of metadata) {
    assert.equal(
      parsed.cover,
      null,
      "Series detection does not load cover buffers",
    );
    assert.deepEqual(
      parsed.chapters,
      [],
      "Series detection does not parse chapters",
    );
  }

  // One batch updates local EPUBs, skips unavailable/manual books and survives a bad EPUB.
  await groups();
  const beforeScan = await page.evaluate(() => ({
    reads: window.calls.filter((call) => call.command === "read_book").length,
    saves: window.calls.filter((call) => call.command === "save_state").length,
  }));
  await page.locator('[data-action="detect-series"]').click();
  await page.waitForFunction(
    (bookId) =>
      window.saved.books.find((book) => book.id === bookId).series ===
      "EPUB Saga",
    id("6"),
  );
  const scanned = await page.evaluate(
    ({ beforeScan }) => ({
      books: window.saved.books,
      readIds: window.calls
        .filter((call) => call.command === "read_book")
        .slice(beforeScan.reads)
        .map((call) => call.args.id),
      saves:
        window.calls.filter((call) => call.command === "save_state").length -
        beforeScan.saves,
    }),
    { beforeScan },
  );
  assert.deepEqual(scanned.readIds.sort(), [
    id("5"),
    id("6"),
    id("7"),
    id("8"),
  ]);
  assert.equal(
    scanned.saves,
    1,
    "The detection batch saves once, rather than once per book",
  );
  const byId = (digit) => scanned.books.find((book) => book.id === id(digit));
  assert.equal(byId("5").series, "Calibre Saga");
  assert.equal(byId("5").seriesIndex, 1.5);
  assert.equal(byId("6").series, "EPUB Saga");
  assert.equal(byId("6").seriesIndex, 2);
  assert.equal(byId("a").series, "Elección personal");
  assert.equal(byId("a").seriesIndex, 9);
  for (const digit of ["7", "8", "9"])
    assert.equal(byId(digit).series || "", "");
  for (const record of fixture.books) {
    const saved = scanned.books.find((book) => book.id === record.id);
    assert.equal(saved.title, record.title, "Detection preserves user titles");
    assert.equal(
      saved.author,
      record.author,
      "Detection preserves user authors",
    );
  }
  assert.equal(await page.locator(".series-groups [data-series]").count(), 4);

  // Interface translation must never translate a user-provided series name.
  for (const [language, label] of [
    ["en", "Series"],
    ["pt", "Sagas"],
    ["es", "Sagas"],
  ]) {
    await page.locator('[data-action="settings"]').click();
    await page.locator('[data-preference="uiLanguage"]').selectOption(language);
    await groups();
    assert.match(
      await page.locator('.sidebar [data-action="series-groups"]').innerText(),
      new RegExp(label),
    );
    assert.match(await group("Biblioteca").innerText(), /Biblioteca/);
    await group("Biblioteca").click();
    assert.equal(await page.locator("#screen h1").innerText(), "Biblioteca");
    assert.deepEqual(await titles(), [
      "Libro editable",
      "Libro primero",
      "Libro segundo",
      "Libro sin número",
    ]);
  }
  await page.setViewportSize({ width: 800, height: 600 });
  await groups();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  // A user edit made while another EPUB is being inspected wins over detection.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "neural_catalog"),
  );
  await page.evaluate((bookId) => {
    window.pauseReadId = bookId;
  }, id("7"));
  await groups();
  await page.locator('[data-action="detect-series"]').click();
  await page.waitForFunction(() => typeof window.resumeRead === "function");
  await allBooks();
  await page.locator(`[data-edit="${id("5")}"]`).click();
  await page
    .locator('dialog [name="series"]')
    .fill("Decisión durante revisión");
  await page.locator('dialog [name="seriesIndex"]').fill("");
  await page.locator('dialog button[value="save"]').click();
  await page.waitForFunction(
    (bookId) =>
      window.saved.books.find((book) => book.id === bookId).series ===
      "Decisión durante revisión",
    id("5"),
  );
  await page.evaluate(() => window.resumeRead());
  await page.waitForFunction(
    (bookId) =>
      window.saved.books.find((book) => book.id === bookId).series ===
      "EPUB Saga",
    id("6"),
  );
  const concurrent = await page.evaluate(
    (bookId) => window.saved.books.find((book) => book.id === bookId),
    id("5"),
  );
  assert.equal(concurrent.series, "Decisión durante revisión");
  assert.equal(concurrent.seriesIndex, null);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      casesPassed: 8,
      fixtureBooks: records.length,
      languages: 3,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
