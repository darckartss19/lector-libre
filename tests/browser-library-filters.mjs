import { installStateBridge } from "./helpers/state-bridge.mjs";
// Isolated Edge instance with synthetic books and a fake native/Drive bridge.
// No installed library, browser profile, real files or accounts are accessed.
import assert from "node:assert/strict";
import { createServer } from "vite";
import {
  addBook,
  createLibrary,
  markRead,
  pinBook,
} from "../src/core/library.mjs";
import { stampChanges } from "../src/core/sync.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: "node_modules/.vite-browser-library-filters",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const id = (number) => String(number).repeat(64);
let initial = createLibrary();
const special = '<img src=x onerror="window.injected=true">';
for (const [number, title, author, language, format, genre] of [
  [1, "Aventura de mañana", "Ángela", "es", "epub", "Aventuras, Juvenil"],
  [2, "Aventura de tarde", "Ángela", "es", "epub", "Aventuras"],
  [3, "Aventura final", "Ángela", "es", "epub", "Aventuras"],
  [4, "An English adventure", "Otra autora", "en", "txt", "Aventuras"],
  [5, "Un misterio", "Otra autora", "", "epub", "Misterio"],
  [6, "Un archivo ausente", "Otro autor", "", "txt", "Misterio"],
  [7, "Metadatos especiales", special, "pt", "txt", "Misterio"],
])
  initial = addBook(
    initial,
    {
      id: id(number),
      title,
      author,
      language,
      format,
      genres: [genre],
      series: genre.startsWith("Aventuras") ? "Caminos" : "",
      collections: genre.startsWith("Aventuras") ? ["Lecturas"] : [],
    },
    number,
  );
initial = pinBook(pinBook(initial, id(1)), id(2));
initial = markRead(
  initial,
  id(1),
  { progress: 0.4, locator: { chapter: "first", fraction: 0.4 } },
  10,
);
initial = markRead(
  initial,
  id(3),
  { progress: 1, locator: { chapter: "last", fraction: 1 } },
  20,
);
initial.preferences = { view: "list", theme: "midnight", uiLanguage: "es" };
initial = stampChanges(createLibrary(), initial, "fixture-device", 30);
const initialBooks = structuredClone(initial.books);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installStateBridge(page);
  await page.addInitScript(
    ({ initial, local, cloud }) => {
      window.saved = structuredClone(initial);
      window.localFixture = [...local];
      window.cloudFixture = [...cloud];
      window.calls = [];
      window.unexpectedCalls = [];
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
              return [...window.localFixture];
            case "drive_config":
              return {
                configured: true,
                connected: true,
                booksEnabled: true,
                canImport: false,
              };
            case "drive_sync":
              return [];
            case "drive_books_sync":
              return {
                uploaded: 0,
                downloaded: 0,
                cloud: [...window.cloudFixture],
                errors: [],
                bindings: [],
                folderUrl: "",
              };
            case "neural_catalog":
              return [];
            case "speech_command":
              return args.command.action === "voices"
                ? [
                    {
                      id: "fixture:es",
                      name: "Voz de prueba",
                      language: "es-ES",
                      engine: "windows",
                    },
                  ]
                : null;
            case "speech_timer_status":
              return { deadline: null };
            case "diagnostic_event":
              return;
            case "plugin:event|listen":
              listeners.set(args.event, callbacks.get(args.handler));
              return args.handler;
            default:
              window.unexpectedCalls.push(command);
              throw new Error("Unexpected command " + command);
          }
        },
      };
      const interval = window.setInterval;
      window.setInterval = (callback, ms, ...args) =>
        ms === 60000 ? 1 : interval(callback, ms, ...args);
    },
    {
      initial,
      local: [id(1), id(2), id(5), id(7)],
      cloud: [id(1), id(3), id(4)],
    },
  );
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "speech_timer_status"),
  );
  const visibleIds = () =>
    page
      .locator(".book-card")
      .evaluateAll((cards) => cards.map((card) => card.dataset.id));
  const showFilters = async () => {
    if (
      !(await page
        .locator("[data-library-filters]")
        .evaluate((element) => element.open))
    )
      await page.locator("[data-library-filters] summary").click();
  };
  const select = async (field, value) => {
    await showFilters();
    await page.locator("#filter-" + field).selectOption(value);
  };
  const clear = async () => {
    await showFilters();
    await page.locator('[data-filter-action="clear"]').click();
  };
  const section = async (name) => {
    await page.locator('[data-section="' + name + '"]').click();
  };

  assert.equal((await visibleIds()).length, 7);
  assert.equal(await page.locator("#screen img").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  results.push("Escapes reales de autor y metadatos");

  await section("recentlyRead");
  assert.deepEqual(await visibleIds(), [id(3), id(1)]);
  assert.equal(await page.locator("h1").textContent(), "Historial");
  assert.match(
    await page.locator(".subtitle").textContent(),
    /incluidos los terminados/,
  );
  await section("reading");
  assert.deepEqual(await visibleIds(), [id(1)]);
  assert.equal(await page.locator("h1").textContent(), "Leyendo");
  await section("unread");
  assert.equal((await visibleIds()).length, 5);
  assert.ok(!(await visibleIds()).includes(id(1)));
  assert.ok(!(await visibleIds()).includes(id(3)));
  await section("finished");
  assert.deepEqual(await visibleIds(), [id(3)]);
  results.push("Historial, Leyendo, Por leer y Terminados diferenciados");

  await section("all");
  await select("genre", "Aventuras");
  assert.equal((await visibleIds()).length, 4);
  await select("series", "Caminos");
  await select("collection", "Lecturas");
  await select("author", "Ángela");
  assert.equal((await visibleIds()).length, 3);
  await select("language", "es");
  await select("format", "epub");
  await select("readingState", "unread");
  await select("availability", "local");
  assert.deepEqual(await visibleIds(), [id(2)]);
  await page.locator("#search").fill("tarde");
  assert.deepEqual(await visibleIds(), [id(2)]);
  const selected = await page
    .locator("[data-library-filter]")
    .evaluateAll((fields) =>
      Object.fromEntries(
        fields.map((field) => [field.dataset.libraryFilter, field.value]),
      ),
    );
  assert.deepEqual(selected, {
    genre: "Aventuras",
    series: "Caminos",
    collection: "Lecturas",
    author: "Ángela",
    language: "es",
    format: "epub",
    readingState: "unread",
    availability: "local",
  });
  results.push("Ocho filtros combinados con búsqueda");

  await page.locator('[name="view-name"]').fill("Mis aventuras " + special);
  // Keep within the intentional 100-character view name field.
  const viewName = await page.locator('[name="view-name"]').inputValue();
  await page.locator('.save-library-view button[type="submit"]').click();
  await page.waitForFunction(
    () => window.saved.preferences.savedViews?.length === 1,
  );
  const savedView = await page.evaluate(() =>
    structuredClone(window.saved.preferences.savedViews[0]),
  );
  assert.equal(savedView.name, viewName);
  assert.equal(savedView.filters.search, "tarde");
  assert.equal(savedView.filters.genre, "Aventuras");
  assert.equal(savedView.filters.availability, "local");
  assert.equal("localIds" in savedView.filters, false);
  assert.equal(await page.locator("#screen img").count(), 0);
  await clear();
  assert.equal((await visibleIds()).length, 7);
  assert.equal(await page.locator("#search").inputValue(), "");
  await showFilters();
  await page.locator("#saved-library-view").selectOption(savedView.id);
  await page.locator('[data-filter-action="open"]').click();
  assert.deepEqual(await visibleIds(), [id(2)]);
  assert.equal(await page.locator("#search").inputValue(), "tarde");
  assert.equal(await page.locator("#filter-author").inputValue(), "Ángela");
  results.push("Guardar, limpiar y reabrir vista sin IDs del dispositivo");

  // Mock synchronization changes only availability; the saved view is unchanged.
  await page.evaluate((removed) => {
    window.localFixture = window.localFixture.filter((id) => id !== removed);
  }, id(2));
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-action="sync"]').click();
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "drive_books_sync"),
  );
  await section("all");
  await showFilters();
  await page.locator("#saved-library-view").selectOption(savedView.id);
  await page.locator('[data-filter-action="open"]').click();
  assert.equal((await visibleIds()).length, 0);
  assert.equal(
    await page.locator(".empty h2").textContent(),
    "Aún no hay libros aquí",
  );
  assert.deepEqual(
    await page.evaluate(() => window.saved.preferences.savedViews[0]),
    savedView,
  );
  await page.locator('[data-filter-action="delete"]').click();
  await page.waitForFunction(
    () => window.saved.preferences.savedViews?.length === 0,
  );
  assert.deepEqual(await page.evaluate(() => window.saved.books), initialBooks);
  assert.equal(
    await page.locator('[data-filter-action="delete"]').isDisabled(),
    true,
  );
  results.push(
    "Vista reevalúa archivos disponibles y eliminarla conserva libros",
  );

  await clear();
  await select("availability", "cloud");
  assert.deepEqual(await visibleIds(), [id(4), id(3)]);
  await select("readingState", "finished");
  assert.deepEqual(await visibleIds(), [id(3)]);
  await clear();
  await select("availability", "missing");
  assert.deepEqual(await visibleIds(), [id(2), id(6)]);
  await clear();
  await select("language", "unknown");
  assert.deepEqual(await visibleIds(), [id(6), id(5)]);
  assert.equal(
    (await page.locator("#filter-language option").allTextContents()).includes(
      "Sin indicar",
    ),
    true,
  );
  await clear();
  await select("author", special);
  assert.deepEqual(await visibleIds(), [id(7)]);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  results.push("Disponibilidad local/nube/ausente e idioma sin indicar");

  // Empty intersection of extra filters should not claim that no library exists.
  await clear();
  await select("author", "Ángela");
  await select("language", "en");
  assert.equal((await visibleIds()).length, 0);
  assert.equal(
    await page.locator(".empty h2").textContent(),
    "Aún no hay libros aquí",
  );
  results.push("Vacío por filtros distingue biblioteca vacía");

  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-preference="uiLanguage"]').selectOption("en");
  await page.waitForFunction(
    () => window.saved.preferences.uiLanguage === "en",
  );
  await section("all");
  await showFilters();
  assert.equal(
    await page.locator("[data-library-filters] summary").innerText(),
    "Filters",
  );
  assert.match(
    await page.locator("#filter-readingState").textContent(),
    /Reading/,
  );
  assert.match(await page.locator("#filter-language").textContent(), /Spanish/);
  assert.match(
    await page.locator("#filter-language").textContent(),
    /Unspecified/,
  );
  assert.equal(
    await page.locator('[data-filter-action="clear"]').textContent(),
    "Clear filters",
  );
  await select("author", "Ángela");
  assert.match(await page.locator("#filter-author").textContent(), /Ángela/);
  await clear();
  await section("recentlyRead");
  assert.equal(await page.locator("h1").textContent(), "History");
  await section("reading");
  assert.equal(await page.locator("h1").textContent(), "Reading");
  await section("unread");
  assert.equal(await page.locator("h1").textContent(), "To read");
  results.push("Traducción inglesa de filtros y secciones mantiene metadatos");

  await page.setViewportSize({ width: 980, height: 700 });
  await showFilters();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal(await page.locator("#filter-author").isVisible(), true);
  assert.equal(
    await page.locator('.save-library-view button[type="submit"]').isVisible(),
    true,
  );
  results.push(
    "Filtros accesibles en ventana compacta sin desbordamiento horizontal",
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.unexpectedCalls), []);
  assert.equal(await page.locator(".toast.error").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.saved.books), initialBooks);
  results.push("Sin errores y biblioteca fixture intacta");
  console.log(
    JSON.stringify({ passed: results.length, checks: results }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
