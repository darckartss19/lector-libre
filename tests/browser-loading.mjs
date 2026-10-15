import assert from "node:assert/strict";
import { createServer } from "vite";
import { zipSync, strToU8 } from "fflate";
import { makePdf } from "./fixtures/pdf-fixtures.mjs";
import { addBook, createLibrary } from "../src/core/library.mjs";
import { installStateBridge } from "./helpers/state-bridge.mjs";
const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: `node_modules/.vite-loading-${process.pid}`,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
const files = {
  "META-INF/container.xml": strToU8(
    '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
  ),
};
files["book.opf"] = strToU8(
  `<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Large fixture</dc:title><dc:language>es</dc:language></metadata><manifest>${Array.from({ length: 80 }, (_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}<item id="picture" href="picture.png" media-type="image/png"/></manifest><spine>${Array.from({ length: 80 }, (_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`,
);
for (let i = 0; i < 80; i++)
  files[`c${i}.xhtml`] = strToU8(
    `<html><head><title>Chapter ${i}</title></head><body><h1>Chapter ${i}</h1><p>Texto ${i}, una <em>frase</em> con \u{1f989}.</p><img src="picture.png"><p>Final ${i}.</p></body></html>`,
  );
files["picture.png"] = Uint8Array.from(
  Buffer.from(image.split(",")[1], "base64"),
);
const epub = [...zipSync(files)],
  pdf = [...makePdf({ count: 300 })];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const passed = [];
try {
  await page.route(`${origin}/__loading`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><head><meta charset="utf-8"></head><body>Loading tests</body></html>',
    }),
  );
  await page.goto(`${origin}/__loading`);
  const loading = await page.evaluate(
    async ({ epub, pdf }) => {
      const { parseDocument } = await import("/src/core/document.mjs");
      const { searchBook } = await import("/src/core/reader-tools.mjs");
      const eager = await parseDocument(
        new Uint8Array(epub),
        "epub",
        "fixture",
      );
      const lazy = await parseDocument(
        new Uint8Array(epub),
        "epub",
        "fixture",
        { lazy: true },
      );
      const before = lazy.loadedCount();
      await lazy.ensureChapter(65);
      const same =
        lazy.chapters[65].html === eager.chapters[65].html &&
        lazy.chapters[65].text === eager.chapters[65].text;
      for (let i = 66; i < 75; i++) await lazy.ensureChapter(i);
      const bounded = lazy.loadedCount();
      const found = [];
      await lazy.visitChapters((chapter, index) => {
        const result = searchBook([chapter], "Final 79");
        if (result.length) found.push(index);
      });
      const speech = await lazy.allChapters({ textOnly: true });
      const hasImages = speech.some((ch) => "html" in ch);
      await lazy.dispose();
      const opened = await parseDocument(
        new Uint8Array(pdf),
        "pdf",
        "fixture",
        { lazy: true },
      );
      const untouched = opened.chapters.filter(
        (ch) => typeof ch.text === "string",
      ).length;
      await opened.ensureChapter(250);
      const pdfOne = opened.loadedCount();
      const pdfText = opened.chapters[250].text;
      await opened.ensureChapter(299);
      const pdfLast = opened.chapters[299].text;
      await opened.dispose();
      return {
        before,
        same,
        bounded,
        found,
        speechCount: speech.length,
        hasImages,
        untouched,
        pdfOne,
        pdfText,
        pdfLast,
      };
    },
    { epub, pdf },
  );
  assert.equal(loading.before, 0);
  assert.equal(loading.same, true);
  assert.equal(loading.bounded, 4);
  assert.deepEqual(loading.found, [79]);
  assert.equal(loading.speechCount, 80);
  assert.equal(loading.hasImages, false);
  assert.equal(loading.untouched, 0);
  assert.equal(loading.pdfOne, 1);
  assert.match(loading.pdfText, /Página 251/);
  assert.match(loading.pdfLast, /Página 300/);
  passed.push(
    "80-chapter EPUB: exact offsets, bounded content, full search and text-only voice",
  );
  passed.push(
    "300-page PDF opens without extracting all pages and can jump directly to saved pages",
  );
  let fixture = createLibrary();
  for (let i = 0; i < 825; i++)
    fixture = addBook(
      fixture,
      {
        id: i.toString(16).padStart(64, "0"),
        format: "txt",
        title: `Libro ${String(i).padStart(4, "0")}`,
        cover: `@lector-cover:${i.toString(16).padStart(64, "0")}`,
      },
      1,
    );
  const goodImage = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    context.fillStyle = "#793eaa";
    context.fillRect(0, 0, 100, 160);
    context.fillStyle = "#eeaa32";
    context.fillRect(0, 60, 100, 30);
    return canvas.toDataURL("image/png");
  });
  await installStateBridge(page, { platform: "windows" });
  await page.addInitScript(
    ({ fixture, image }) => {
      window.saved =
        JSON.parse(sessionStorage.getItem("loading-library") || "null") ||
        fixture;
      window.coverReads = [];
      window.queueSaves = [];
      window.reads = [];
      window.blockRead = false;
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: () => 1,
        invoke: async (command, args) => {
          if (command === "load_state") return window.saved;
          if (command === "save_state") {
            window.saved = args.value;
            sessionStorage.setItem(
              "loading-library",
              JSON.stringify(window.saved),
            );
            return;
          }
          if (command === "cover_asset") {
            window.coverReads.push(args.hash);
            return image;
          }
          if (command === "book_availability")
            return args.books.map((b) => b.id);
          if (command === "read_book") {
            window.reads.push(args.id);
            if (window.blockRead && args.id.startsWith("f"))
              await new Promise((resolve) => (window.releaseRead = resolve));
            return new TextEncoder().encode("Un libro para seguir leyendo.")
              .buffer;
          }
          if (command === "import_files")
            return Array.from({ length: 20 }, (_, i) => ({
              id: "f" + String(i).padStart(63, "0"),
              format: "txt",
              filename: `Importado ${i}`,
            }));
          if (command === "drive_config")
            return { connected: false, configured: false };
          if (command === "neural_catalog") return [];
          if (command === "speech_command") return [];
          if (command === "speech_timer_status") return {};
          return null;
        },
      };
    },
    { fixture, image: goodImage },
  );
  await page.goto(origin);
  await page.locator(".book-card").first().waitFor();
  await page.waitForFunction(() => window.coverReads.length > 0);
  assert.equal(await page.locator(".book-card").count(), 60);
  assert.ok((await page.evaluate(() => window.coverReads.length)) < 60);
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(window.saved).includes("data:image"),
    ),
    false,
  );
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("[data-cover-source]")).some(
      (image) => image.naturalWidth > 0,
    ),
  );
  passed.push(
    "825 cover references: only visible covers are requested and state remains small",
  );
  const readsBeforeSpines = await page.evaluate(() => window.coverReads.length);
  await page.locator('[data-view="spines"]').click();
  await page.waitForTimeout(700);
  const spineReads =
    (await page.evaluate(() => window.coverReads.length)) - readsBeforeSpines;
  assert.ok(spineReads > 0 && spineReads < 60);
  assert.ok((await page.locator(".spine-art.has-art").count()) > 0);
  await page.locator('[data-view="covers"]').click();
  passed.push(
    "Spine designs only process visible books and show cover-derived artwork",
  );

  await page.evaluate(() => (window.blockRead = true));
  await page.locator('.sidebar [data-action="import"]').click();
  await page.waitForFunction(() => typeof window.releaseRead === "function");
  await page.locator('[data-action="pause-import"]').click();
  await page.locator(".book-title").first().click();
  await page.locator(".prose").waitFor();
  assert.match(await page.locator(".prose").textContent(), /seguir leyendo/);
  await page.evaluate(() => {
    window.blockRead = false;
    window.releaseRead();
  });
  await page.locator('[data-action="resume-import"]').waitFor();
  const pending = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("import_queue", { value: null }),
  );
  assert.equal(pending.files.length, 19);
  await page.reload();
  await page.locator('[data-action="resume-import"]').waitFor();
  assert.equal(await page.locator('[data-action="pause-import"]').count(), 0);
  await page.locator('[data-action="resume-import"]').click();
  await page.waitForFunction(() => window.saved.books.length === 845);
  await page.waitForFunction(
    () => document.getElementById("import-job").hidden,
  );
  assert.equal(
    await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("import_queue", { value: null }),
    ),
    null,
  );
  passed.push(
    "Import pauses after the current book, permits reading, resumes after reload and clears completed queue",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, loading, errors }));
} finally {
  await browser.close();
  await server.close();
}
