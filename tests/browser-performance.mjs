import assert from "node:assert/strict";
import { preview } from "vite";
import { readFileSync } from "node:fs";
import { addBook, createLibrary } from "../src/core/library.mjs";
import { stampChanges } from "../src/core/sync.mjs";
import { installStateBridge } from "./helpers/state-bridge.mjs";
const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
let fixture = createLibrary();
const cover =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
for (let i = 0; i < 825; i++)
  fixture = addBook(
    fixture,
    {
      id: `b${String(i).padStart(63, "0")}`,
      title: `Libro ${String(i).padStart(4, "0")}`,
      format: "txt",
      cover,
      genres: [`Género ${i % 41}`, "Otro"],
      series: `Saga ${i % 77}`,
      seriesIndex: i,
    },
    1,
  );
fixture = stampChanges(createLibrary(), fixture, "performance-test", 1);
const server = await preview({
  preview: {
    host: "127.0.0.1",
    port: 0,
    headers: {
      "Content-Security-Policy": JSON.parse(
        readFileSync("src-tauri/tauri.conf.json"),
      ).app.security.csp,
    },
  },
});
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await installStateBridge(page, { platform: "windows" });
await page.addInitScript(
  ({ fixture }) => {
    window.saved = fixture;
    window.calls = [];
    window.syncRuns = 0;
    const nativeInterval = window.setInterval;
    window.setInterval = (cb, ms, ...args) =>
      ms === 60000
        ? ((window.syncTick = cb), 1)
        : nativeInterval(cb, ms, ...args);
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => 1,
      invoke: async (command, args) => {
        window.calls.push(command);
        if (command === "load_state") return window.saved;
        if (command === "save_state") {
          window.saved = args.value;
          return;
        }
        if (command === "read_book")
          return new TextEncoder().encode(
            "Un párrafo para leer sin bloquear la biblioteca.\n\nSegundo párrafo.",
          ).buffer;
        if (command === "book_availability")
          return args.books.map((book) => book.id);
        if (command === "drive_config")
          return { connected: true, booksEnabled: true };
        if (command === "drive_sync") {
          window.syncRuns++;
          return new Promise(
            (resolve) => (window.finishSync = () => resolve([])),
          );
        }
        if (command === "drive_books_sync")
          return {
            cloud: [],
            errors: [],
            bindings: [],
            uploaded: 0,
            downloaded: 0,
          };
        if (command === "neural_catalog") return [];
        if (command === "speech_command")
          return args.command.action === "voices" ? [] : null;
        if (command === "speech_timer_status") return { deadline: null };
        if (command === "diagnostic_event") return;
        if (command === "plugin:event|listen") return 1;
        throw new Error(command);
      },
    };
  },
  { fixture },
);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const started = performance.now();
try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.calls.includes("neural_catalog"));
  const startupMs = Math.round(performance.now() - started);
  assert.equal(await page.locator(".book-card").count(), 60);
  assert.match(await page.locator(".subtitle").textContent(), /825/);
  await page.locator('[data-library-page="1"]').first().click();
  assert.equal(
    await page.locator(".book-title").first().textContent(),
    "Libro 0060",
  );
  await page.locator('[data-action="toggle-selection"]').click();
  await page.locator('[data-action="select-visible"]').click();
  assert.equal(await page.locator("[data-select-book]:checked").count(), 60);
  await page.locator('[data-library-page="2"]').first().click();
  assert.equal(await page.locator("[data-select-book]:checked").count(), 0);
  assert.match(await page.locator("#selection-bar").textContent(), /60 libros/);
  await page.locator('[data-action="end-selection"]').click();
  await page.locator("#search").fill("Libro 0824");
  assert.equal(await page.locator(".book-card").count(), 1);
  await page.locator("#search").fill("");
  assert.equal(await page.locator(".book-card").count(), 60);
  await page.locator('[data-library-page="1"]').first().click();
  await page.locator(".book-title").first().click();
  await page.locator(".prose").waitFor();
  await page.locator('[data-action="back"]').click();
  assert.equal(
    await page.locator(".book-title").first().textContent(),
    "Libro 0060",
  );
  assert.ok(
    (await page.evaluate(() => window.patchSizes)).every(
      (bytes) => bytes < 5000,
    ),
  );
  await page.evaluate(() => window.syncTick());
  await page.waitForFunction(() => window.syncRuns === 1);
  await page.locator(".book-title").first().click();
  await page.locator(".prose").waitFor();
  await page.evaluate(() => window.finishSync());
  await page.waitForFunction(() => window.calls.includes("drive_books_sync"));
  await page.evaluate(() => window.syncTick());
  assert.equal(await page.evaluate(() => window.syncRuns), 1);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      books: 825,
      renderedAtOnce: 60,
      startupMs,
      maxCheckpointBytes: Math.max(
        ...(await page.evaluate(() => window.patchSizes)),
      ),
      pagingAndGlobalSearch: true,
      selectionAcrossPages: true,
      canReadDuringSync: true,
      backgroundCooldown: true,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
