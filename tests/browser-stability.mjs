import { installStateBridge } from "./helpers/state-bridge.mjs";
// Isolated browser regression tests; no real account, library writes or existing browser session.
// Run with Playwright available, or set LECTOR_PLAYWRIGHT_PATH to its index.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { zipSync, strToU8 } from "fflate";
import { createLibrary, addBook } from "../src/core/library.mjs";
import { stampChanges } from "../src/core/sync.mjs";
const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const container = strToU8(
  '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
);
const opf = strToU8(
  '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Prueba grande</dc:title><dc:creator>Autor</dc:creator></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="image" href="large.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="c"/></spine></package>',
);
const corrupted = zipSync({
  "META-INF/container.xml": container,
  "OPS/book.opf": opf,
  "OPS/c.xhtml": strToU8("<h1>Capítulo</h1><p>Texto de prueba</p>"),
  "OPS/large.jpg": new Uint8Array(40_000_000),
});
// A broken unneeded illustration must not prevent metadata import.
const dataView = new DataView(corrupted.buffer);
for (
  let offset = 0;
  offset < corrupted.length && dataView.getUint32(offset, true) === 0x04034b50;
) {
  const nameLength = dataView.getUint16(offset + 26, true),
    extra = dataView.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extra;
  const name = new TextDecoder().decode(
    corrupted.subarray(offset + 30, offset + 30 + nameLength),
  );
  if (name === "OPS/large.jpg") {
    corrupted[start] = 7;
    break;
  }
  offset = start + dataView.getUint32(offset + 18, true);
}
const fixtureMiddleware = async (req, res, next) => {
  if (req.url === "/fixture.epub") {
    res.end(corrupted);
    return;
  }
  if (req.url === "/large-private.epub" && process.env.LECTOR_TEST_EPUB) {
    res.end(await readFile(process.env.LECTOR_TEST_EPUB));
    return;
  }
  next();
};
const server = await createServer({
  cacheDir: "node_modules/.vite-browser-stability",
  optimizeDeps: { holdUntilCrawlEnd: false },
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [
    {
      name: "stability-fixtures",
      configureServer(server) {
        server.middlewares.use(fixtureMiddleware);
      },
    },
  ],
});
await server.listen();
const url = server.resolvedUrls.local[0];
let initial = createLibrary();
for (let i = 1; i <= 96; i++)
  initial = addBook(
    initial,
    {
      id: i.toString(16).padStart(64, "0"),
      title: `Libro ${i}`,
      format: "txt",
      genres: ["Pruebas"],
    },
    i,
  );
initial = stampChanges(
  createLibrary(),
  initial,
  "11111111-1111-4111-8111-111111111111",
  100,
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installStateBridge(page, { platform: "windows" });
  await page.addInitScript((fixture) => {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 72;
    const ctx = canvas.getContext("2d");
    ["#cc3322", "#244c9b", "#f4ddaf"].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 48, 72);
      ctx.fillStyle = "#efe1bd";
      ctx.fillRect(0, 46, 48, 20);
      fixture.books[i].cover = canvas.toDataURL("image/png");
      fixture.books[i].author = "Autora de prueba";
    });
    fixture.registers = {};
    window.calls = [];
    window.remoteCopies = [];
    window.saved = fixture;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => 1,
      invoke: async (command, args) => {
        window.calls.push({ command, args });
        switch (command) {
          case "load_state":
            return fixture;
          case "save_state":
            window.saved = args.value;
            return;
          case "book_availability":
            return args.books.map((b) => b.id);
          case "drive_config":
            return {
              configured: true,
              connected: true,
              booksEnabled: true,
              canImport: true,
            };
          case "drive_sync":
            return window.remoteCopies;
          case "drive_books_sync":
            return {
              bindings: [],
              cloud: fixture.books.map((b) => b.id),
              errors: [],
              uploaded: 0,
              downloaded: 0,
            };
          case "speech_command":
            return args.command.action === "voices"
              ? [
                  {
                    id: "windows:es",
                    name: "Sabina",
                    language: "es-MX",
                    engine: "windows",
                    installed: true,
                  },
                ]
              : null;
          case "neural_catalog":
            return [];
          case "read_book":
            return new TextEncoder().encode(
              "Texto ágil con tildes y ñ.\n\n".repeat(300),
            ).buffer;
          case "diagnostic_event":
            return;
          case "plugin:event|listen":
            return 1;
          default:
            throw new Error("Unexpected command " + command);
        }
      },
    };
    const interval = window.setInterval;
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 60000) {
        window.syncTick = fn;
        return 1;
      }
      return interval(fn, ms, ...args);
    };
  }, initial);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    window.calls.some((c) => c.command === "speech_command"),
  );
  await page.locator('[data-view="spines"]').click();
  await page.waitForFunction(() =>
    document.querySelector(".spine-art")?.classList.contains("has-art"),
  );
  const design = await page
    .locator(".cover")
    .first()
    .evaluate((el) => ({
      background: el.style.getPropertyValue("--spine-color"),
      author: el.querySelector(".spine-author").textContent,
      picture: el.querySelector("img"),
      strip: el.querySelector(".spine-art").style.backgroundImage,
    }));
  assert.equal(design.background, "#cc3322");
  assert.equal(design.author, "Autora de prueba");
  assert.equal(design.picture, null);
  assert.match(design.strip, /data:image\/webp/);
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-preference="spineStyle"]').selectOption("color");
  await page.locator('[data-section="all"]').click();
  assert.equal(
    await page.locator(".books").getAttribute("data-spine-style"),
    "color",
  );
  assert.equal(await page.locator(".spine-art").first().isVisible(), false);
  await page.locator('[data-view="covers"]').click();
  const sync = async () => {
    const previous = await page.evaluate(
      () => window.calls.filter((c) => c.args?.event === "sync.end").length,
    );
    await page.evaluate(() => {
      if (window.testClock) window.testClock += 301000;
      window.syncTick();
    });
    await page.waitForFunction(
      (n) =>
        window.calls.filter((c) => c.args?.event === "sync.end").length > n,
      previous,
    );
  };
  await sync();
  await page.evaluate(() => {
    window.testClock = Date.now();
    Date.now = () => window.testClock;
    document.querySelector(".workspace").scrollTop = 500;
    window.keptScreen = document.querySelector("#screen");
    window.keptCover = document.querySelector(".cover");
  });
  await sync();
  assert.deepEqual(
    await page.evaluate(() => ({
      scroll: document.querySelector(".workspace").scrollTop,
      screen: window.keptScreen === document.querySelector("#screen"),
      cover: window.keptCover === document.querySelector(".cover"),
    })),
    { scroll: 500, screen: true, cover: true },
  );
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-preference="fontSize"]').focus();
  await page.evaluate(
    () => (document.querySelector(".workspace").scrollTop = 500),
  );
  await sync();
  assert.deepEqual(
    await page.evaluate(() => ({
      scroll: document.querySelector(".workspace").scrollTop,
      focus: document.activeElement.dataset.preference,
    })),
    { scroll: 500, focus: "fontSize" },
  );
  await page.locator('[data-section="all"]').click();
  await page.evaluate(async () => {
    const { stampChanges } = await import("/src/core/sync.mjs");
    const { editBook } = await import("/src/core/library.mjs");
    window.remoteCopies = [
      stampChanges(
        window.saved,
        editBook(window.saved, window.saved.books[0].id, {
          title: "Cambio remoto",
        }),
        "B",
        Date.now(),
      ),
    ];
    document.querySelector(".workspace").scrollTop = 500;
  });
  await sync();
  assert.equal(
    await page
      .locator(".book-title")
      .filter({ hasText: "Cambio remoto" })
      .count(),
    1,
  );
  assert.equal(
    await page.evaluate(() => document.querySelector(".workspace").scrollTop),
    500,
  );
  const metadata = await page.evaluate(async () => {
    const { parseBook } = await import("/src/core/epub.mjs");
    const bytes = new Uint8Array(
      await (await fetch("/fixture.epub")).arrayBuffer(),
    );
    const result = parseBook(bytes, "epub", "Archivo", { metadataOnly: true });
    let fullFailed = false;
    try {
      parseBook(bytes, "epub", "Archivo");
    } catch {
      fullFailed = true;
    }
    return {
      title: result.title,
      author: result.author,
      chapters: result.chapters.length,
      fullFailed,
    };
  });
  assert.deepEqual(metadata, {
    title: "Prueba grande",
    author: "Autor",
    chapters: 0,
    fullFailed: true,
  });
  await page.locator(".book-title").first().click();
  await page.waitForSelector(".reading-pane");
  assert.match(await page.locator(".prose").innerText(), /ágil con tildes y ñ/);
  await page.evaluate(() => {
    window.keptReadingPane = document.querySelector(".reading-pane");
    window.keptReadingPane.scrollTop = 300;
  });
  await sync();
  assert.deepEqual(
    await page.evaluate(() => ({
      same: window.keptReadingPane === document.querySelector(".reading-pane"),
      scroll: document.querySelector(".reading-pane").scrollTop,
    })),
    { same: true, scroll: 300 },
  );
  const result = { casesPassed: 7, errors };
  if (process.env.LECTOR_TEST_EPUB) {
    result.largeBook = await page.evaluate(async () => {
      const { parseBook } = await import("/src/core/epub.mjs");
      const bytes = new Uint8Array(
        await (await fetch("/large-private.epub")).arrayBuffer(),
      );
      const started = performance.now();
      const parsed = parseBook(bytes, "epub", "Archivo", {
        metadataOnly: true,
      });
      return {
        bytes: bytes.byteLength,
        elapsedMs: Math.round(performance.now() - started),
        hasTitle: !!parsed.title,
        hasCover: !!parsed.cover,
        chaptersBuilt: parsed.chapters.length,
      };
    });
    result.casesPassed++;
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await server.close();
}
