import { installStateBridge } from "./helpers/state-bridge.mjs";
// Isolated application tests: books and native file dialogs are synthetic mocks.
// This process never touches the installed library, real browser or cloud account.
import assert from "node:assert/strict";
import { createServer } from "vite";
import {
  createLibrary,
  addBook,
  editBook,
  markRead,
  pinBook,
} from "../src/core/library.mjs";
import { stampChanges } from "../src/core/sync.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: "node_modules/.vite-browser-library-tools",
  optimizeDeps: { holdUntilCrawlEnd: false },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const id = (digit) => digit.repeat(64);
let initial = createLibrary();
for (const [digit, title, collections, series] of [
  ["1", "Libro primero", ["Favoritos", "Biblioteca"], "Mi saga"],
  ["2", "Libro segundo", ["Por leer"], "Otra saga"],
  ["3", "Libro tercero", [], ""],
])
  initial = addBook(
    initial,
    {
      id: id(digit),
      title,
      author: "Autora original",
      format: "txt",
      genres: ["Aventuras, Juvenil"],
      collections,
      series,
      seriesIndex: series ? Number(digit) : null,
    },
    Number(digit),
  );
initial = pinBook(initial, id("1"));
initial = markRead(
  initial,
  id("1"),
  {
    progress: 0.42,
    locator: { chapter: "text", fraction: 0.42 },
  },
  10,
);
initial.preferences = { view: "list", theme: "dark", uiLanguage: "es" };
initial = stampChanges(createLibrary(), initial, "fixture-device", 20);
let backup = addBook(
  createLibrary(),
  {
    id: id("1"),
    title: "Título desde copia",
    author: "Autor anterior",
    format: "txt",
    collections: ["De la copia"],
    genres: ["Misterio"],
  },
  1,
);
backup = addBook(
  backup,
  {
    id: id("4"),
    title: "Libro recuperado",
    author: "Autor de copia",
    format: "txt",
    collections: ["De la copia"],
    genres: ["Misterio"],
  },
  4,
);
backup.preferences = { view: "covers", theme: "light", uiLanguage: "es" };
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
    ({ initial, backup }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 48;
      canvas.height = 72;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#2555aa";
      ctx.fillRect(0, 0, 48, 72);
      const originalCover = canvas.toDataURL("image/png");
      ctx.fillStyle = "#aa3322";
      ctx.fillRect(0, 0, 48, 72);
      window.nextCover = canvas.toDataURL("image/webp");
      initial.books[0].cover = originalCover;
      const coverKey = JSON.stringify([initial.books[0].id, "cover"]);
      initial.registers[coverKey].value = originalCover;
      window.originalCover = originalCover;
      window.saved = structuredClone(initial);
      window.backup = structuredClone(backup);
      window.calls = [];
      window.failCover = false;
      window.cancelCover = false;
      window.failExport = false;
      window.failImport = false;
      window.cancelImport = false;
      const callbacks = new Map(),
        listeners = new Map();
      let callbackId = 0;
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
              return args.books.map((book) => book.id);
            case "drive_config":
              return {
                configured: true,
                connected: false,
                booksEnabled: false,
                canImport: false,
              };
            case "drive_connect":
              await new Promise((resolve) => {
                window.releaseConnect = resolve;
              });
              return {
                configured: true,
                connected: false,
                booksEnabled: false,
                canImport: false,
              };
            case "read_book":
              return new TextEncoder().encode(
                "Texto sintético de prueba. ".repeat(100),
              ).buffer;
            case "select_cover":
              if (window.failCover)
                throw new Error("No se pudo abrir la imagen de prueba.");
              return window.cancelCover ? null : window.nextCover;
            case "export_backup":
              if (window.holdExport)
                await new Promise((resolve) => {
                  window.releaseExport = resolve;
                });
              if (window.failExport)
                throw new Error("No se pudo crear la copia de prueba.");
              return {
                books: args.value.books.length,
                filesExported: args.value.books.length,
                remoteBooks: 0,
                bytes: 12000,
              };
            case "import_backup":
              if (window.failImport)
                throw new Error("La copia de prueba está dañada.");
              if (window.cancelImport) return null;
              return {
                library: structuredClone(window.backup),
                filesImported: 1,
                filesReused: 1,
                remoteBooks: 0,
              };
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
    { initial, backup },
  );
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "neural_catalog"),
  );
  const allBooks = () => page.locator('.sidebar [data-section="all"]').click();
  const titles = () => page.locator(".books .book-title").allTextContents();
  const savedBook = (digit) =>
    page.evaluate(
      (bookId) => window.saved.books.find((book) => book.id === bookId),
      id(digit),
    );
  const edit = async (digit) => {
    await allBooks();
    await page.locator(`[data-edit="${id(digit)}"]`).click();
  };
  const saveDialog = async () => {
    await page.locator('dialog button[value="save"]').click();
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  };
  const groups = () =>
    page.locator('.sidebar [data-action="collections-groups"]').click();
  const group = (name) =>
    page.locator(`.collection-groups [data-collection="${name}"]`);
  const select = async (digits) => {
    await allBooks();
    await page.locator('[data-action="toggle-selection"]').click();
    for (const digit of digits)
      await page.locator(`[data-select-book="${id(digit)}"]`).check();
  };
  const endSelection = async () => {
    if (await page.locator('[data-action="end-selection"]').count())
      await page.locator('[data-action="end-selection"]').click();
  };

  // A book can belong to several collections; their display names remain metadata.
  await groups();
  assert.equal(
    await page.locator(".collection-groups [data-collection]").count(),
    3,
  );
  await group("Biblioteca").click();
  assert.equal(await page.locator("#screen h1").innerText(), "Biblioteca");
  assert.deepEqual(await titles(), ["Libro primero"]);
  await page.locator('.sidebar [data-section="pinned"]').click();
  assert.deepEqual(await titles(), ["Libro primero"]);
  await allBooks();
  assert.equal((await titles()).length, 3);

  // A metadata dialog can update collections and a WebP cover without changing reading state.
  const beforeCover = await savedBook("1");
  await edit("1");
  await page
    .locator('dialog [name="collections"]')
    .fill("Favoritos, Biblioteca, Ciencia ficción, ciencia ficcion");
  await page.locator('dialog [data-cover="choose"]').click();
  await saveDialog();
  await page.waitForFunction(
    (bookId) =>
      window.saved.books.find((book) => book.id === bookId).cover !==
      window.originalCover,
    id("1"),
  );
  const withCover = await savedBook("1");
  assert.deepEqual(withCover.collections, [
    "Favoritos",
    "Biblioteca",
    "Ciencia ficción",
  ]);
  assert.match(withCover.cover, /^data:image\/(png|jpeg|webp);base64,/);
  for (const field of [
    "id",
    "title",
    "author",
    "genres",
    "series",
    "seriesIndex",
    "format",
    "progress",
    "locator",
    "pinOrder",
    "importedMetadata",
  ])
    assert.deepEqual(
      withCover[field],
      beforeCover[field],
      `Changing the cover preserves ${field}`,
    );
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((call) => /write_book|replace_book/.test(call.command)),
    ),
    false,
    "A custom cover must not overwrite original book bytes",
  );

  // Cancelling the metadata dialog or native image picker preserves the old cover.
  await edit("1");
  await page.evaluate(() => {
    window.nextCover = window.originalCover;
  });
  await page.locator('dialog [data-cover="choose"]').click();
  await page.locator('dialog button[value="cancel"]').click();
  assert.equal((await savedBook("1")).cover, withCover.cover);
  await edit("1");
  await page.evaluate(() => {
    window.cancelCover = true;
  });
  await page.locator('dialog [data-cover="choose"]').click();
  await saveDialog();
  assert.equal((await savedBook("1")).cover, withCover.cover);
  await edit("1");
  await page.evaluate(() => {
    window.cancelCover = false;
    window.failCover = true;
  });
  await page.locator('dialog [data-cover="choose"]').click();
  await page.locator('dialog button[value="cancel"]').click();
  assert.equal((await savedBook("1")).cover, withCover.cover);
  await page.evaluate(() => {
    window.failCover = false;
  });

  // Bulk editing changes checked fields only; unselected books and progress stay intact.
  const protectedBooks = await page.evaluate(() =>
    structuredClone(window.saved.books),
  );
  await select(["1", "2"]);
  await page.locator('[data-action="bulk-edit"]').click();
  await page.locator('dialog [name="applyAuthor"]').check();
  await page.locator('dialog [name="author"]').fill("Autora compartida");
  await page.locator('dialog [name="applyGenres"]').check();
  await page.locator('dialog [name="genres"]').fill("Cambio descartado");
  await page.locator('dialog [name="applyGenres"]').uncheck();
  await saveDialog();
  await page.waitForFunction(
    (bookId) =>
      window.saved.books.find((book) => book.id === bookId).author ===
      "Autora compartida",
    id("2"),
  );
  for (const digit of ["1", "2"]) {
    const actual = await savedBook(digit);
    assert.equal(actual.author, "Autora compartida");
    const old = protectedBooks.find((book) => book.id === id(digit));
    for (const field of [
      "title",
      "genres",
      "series",
      "seriesIndex",
      "collections",
      "cover",
      "progress",
      "locator",
      "pinOrder",
    ])
      assert.deepEqual(
        actual[field],
        old[field],
        `Unchecked bulk fields preserve ${field}`,
      );
  }
  assert.deepEqual(
    await savedBook("3"),
    protectedBooks.find((book) => book.id === id("3")),
  );
  await endSelection();

  // Adding a collection in bulk preserves previous memberships and gives one deduplicated group.
  await select(["1", "2"]);
  await page.locator('[data-action="add-to-collection"]').click();
  await page.locator('dialog [name="collection"]').fill("Lecturas de este año");
  await saveDialog();
  await page.waitForFunction(
    (bookId) =>
      window.saved.books
        .find((book) => book.id === bookId)
        .collections.includes("Lecturas de este año"),
    id("2"),
  );
  assert.ok((await savedBook("1")).collections.includes("Favoritos"));
  assert.ok((await savedBook("2")).collections.includes("Por leer"));
  assert.equal((await savedBook("3")).collections.length, 0);
  await endSelection();
  await groups();
  await group("Lecturas de este año").click();
  assert.deepEqual(await titles(), ["Libro primero", "Libro segundo"]);
  await allBooks();
  await page.locator("#search").fill("Lecturas de este año");
  assert.deepEqual(await titles(), ["Libro primero", "Libro segundo"]);
  await page.locator("#search").fill("");
  await page.locator('[data-action="toggle-selection"]').click();
  await page.locator('[data-action="select-visible"]').click();
  assert.equal(await page.locator("[data-select-book]:checked").count(), 3);
  await endSelection();

  // Exporting supplies the current library; native backend owns file selection and filtering.
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-action="export-backup"]').click();
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "export_backup"),
  );
  const exported = await page.evaluate(
    () =>
      window.calls.filter((call) => call.command === "export_backup").at(-1)
        .args.value,
  );
  assert.equal(exported.books.length, 3);
  assert.ok(
    exported.books
      .find((book) => book.title === "Libro primero")
      .collections.includes("Lecturas de este año"),
  );
  // A requested backup waits for another native operation and repeated clicks
  // do not open several save dialogs. This mocks native delay, not an account.
  const copiesBefore = await page.evaluate(
    () =>
      window.calls.filter((call) => call.command === "export_backup").length,
  );
  await page.locator('[data-action="drive-connect"]').click();
  await page.waitForFunction(() => typeof window.releaseConnect === "function");
  await page.locator('[data-action="export-backup"]').click();
  await page.locator('[data-action="export-backup"]').click();
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.command === "export_backup").length,
    ),
    copiesBefore,
  );
  await page.evaluate(() => window.releaseConnect());
  await page.waitForFunction(
    (count) =>
      window.calls.filter((call) => call.command === "export_backup").length ===
      count + 1,
    copiesBefore,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.command === "export_backup").length,
    ),
    copiesBefore + 1,
  );
  const beforeFailures = await page.evaluate(() =>
    JSON.stringify(window.saved),
  );
  await page.evaluate(() => {
    window.failExport = true;
  });
  await page.locator('[data-action="export-backup"]').click();
  await page.evaluate(() => {
    window.failExport = false;
    window.failImport = true;
  });
  await page.locator('[data-action="import-backup"]').click();
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.saved)),
    beforeFailures,
  );
  await page.evaluate(() => {
    window.failImport = false;
    window.cancelImport = true;
  });
  await page.locator('[data-action="import-backup"]').click();
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.saved)),
    beforeFailures,
  );
  await page.evaluate(() => {
    window.cancelImport = false;
  });

  // Cancelling restore is harmless; additive restore keeps existing preferences and progress.
  await page.locator('[data-action="import-backup"]').click();
  await page.locator('dialog button[value="cancel"]').click();
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.saved)),
    beforeFailures,
  );
  await page.locator('[data-action="import-backup"]').click();
  await page.locator('dialog [name="mode"]').selectOption("missing");
  await page.locator('dialog [name="preferences"]').uncheck();
  await saveDialog();
  await page.waitForFunction(() => window.saved.books.length === 4);
  assert.equal((await savedBook("1")).title, "Libro primero");
  assert.equal((await savedBook("1")).progress, 0.42);
  assert.equal((await savedBook("4")).title, "Libro recuperado");
  assert.equal(
    await page.evaluate(() => window.saved.preferences.theme),
    "dark",
  );
  assert.equal(
    await page.evaluate(() => window.saved.deviceId),
    "fixture-device",
  );

  // Explicit replacement updates shared books without deleting local extras.
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-action="import-backup"]').click();
  await page.locator('dialog [name="mode"]').selectOption("replace");
  await page.locator('dialog [name="preferences"]').uncheck();
  await saveDialog();
  await page.waitForFunction(
    (bookId) =>
      window.saved.books.find((book) => book.id === bookId).title ===
      "Título desde copia",
    id("1"),
  );
  assert.equal(await page.evaluate(() => window.saved.books.length), 4);
  assert.equal((await savedBook("2")).title, "Libro segundo");
  assert.equal(
    await page.evaluate(() => window.saved.preferences.theme),
    "dark",
  );

  // Three interface languages and a narrow window never translate a user's collection name.
  await edit("2");
  await page.locator('dialog [name="collections"]').fill("Biblioteca");
  await saveDialog();
  for (const [language, label] of [
    ["en", "Collections"],
    ["pt", "Coleções"],
    ["es", "Colecciones"],
  ]) {
    await page.locator('[data-action="settings"]').click();
    await page.locator('[data-preference="uiLanguage"]').selectOption(language);
    await groups();
    assert.match(
      await page
        .locator('.sidebar [data-action="collections-groups"]')
        .innerText(),
      new RegExp(label),
    );
    await group("Biblioteca").click();
    assert.equal(await page.locator("#screen h1").innerText(), "Biblioteca");
  }
  await page.setViewportSize({ width: 800, height: 600 });
  await allBooks();
  await page.locator('[data-action="toggle-selection"]').click();
  await page.locator('[data-action="select-visible"]').click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.locator('[data-action="bulk-edit"]').click();
  const dialog = await page.locator("dialog[open]").boundingBox();
  assert.ok(
    dialog &&
      dialog.x >= 0 &&
      dialog.x + dialog.width <= 801 &&
      dialog.y >= 0 &&
      dialog.y + dialog.height <= 601,
    "Bulk edit dialog fits the 800×600 window",
  );
  await page.locator('dialog button[value="cancel"]').click();
  await endSelection();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ casesPassed: 11, fixtureBooks: 4, languages: 3, errors }),
  );
} finally {
  await browser.close();
  await server.close();
}
