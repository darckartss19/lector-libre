import { installStateBridge } from "./helpers/state-bridge.mjs";
// Integrated reading tools in a fresh browser with a fake native bridge.
// No installed library, user account, audio engine or user browser is touched.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { zipSync, strToU8 } from "fflate";
import { createLibrary, addBook } from "../src/core/library.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: `node_modules/.vite-browser-reading-actions-${process.pid}`,
  optimizeDeps: { holdUntilCrawlEnd: false },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const filler = (count) =>
  Array.from(
    { length: count },
    (_, index) =>
      `<p>Camino ${index + 1}. Un relato conserva las palabras y el recuerdo de una tarde tranquila.</p>`,
  ).join("");
const chapter = (title, body) =>
  strToU8(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`,
  );
const bookBytes = zipSync({
  mimetype: strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8(
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
  ),
  "OEBPS/content.opf": strToU8(
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">reading-tools-fixture</dc:identifier><dc:title>Un libro para recordar</dc:title><dc:creator>Autor de prueba</dc:creator><dc:language>es</dc:language></metadata><manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml" /><item id="second" href="second.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="first" /><itemref idref="second" /></spine></package>',
  ),
  "OEBPS/first.xhtml": chapter(
    "El principio",
    `<p>La casa <em>azul</em> guarda un café y cafe\u0301. Esta idea merece una nota.</p>${filler(30)}`,
  ),
  "OEBPS/second.xhtml": chapter(
    "Después del camino",
    `${filler(45)}<p>Otro CAFÉ, al final del camino.</p>`,
  ),
});
const fixture = addBook(
  createLibrary(),
  {
    id: "e".repeat(64),
    title: "Un libro para recordar",
    author: "Autor de prueba",
    genres: ["Aventuras"],
    format: "epub",
  },
  1,
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installStateBridge(page, { platform: "windows" });
  await page.addInitScript(
    ({ initial, bytes }) => {
      let callbackId = 0;
      const callbacks = new Map(),
        listeners = new Map();
      window.saved = structuredClone(initial);
      window.calls = [];
      window.deadline = null;
      window.fullscreen = false;
      window.emitNative = (event, payload) =>
        listeners.get(event)?.({ event, id: 1, payload });
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
                configured: false,
                connected: false,
                booksEnabled: false,
                canImport: false,
              };
            case "read_book":
              return new Uint8Array(bytes).buffer;
            case "neural_catalog":
              return [];
            case "speech_command":
              return args.command.action === "voices"
                ? [
                    {
                      id: "test:es",
                      name: "Voz de prueba",
                      language: "es-ES",
                      engine: "windows",
                    },
                  ]
                : null;
            case "speech_timer":
              window.deadline =
                args.minutes === null
                  ? null
                  : Date.now() + args.minutes * 60000;
              return { deadline: window.deadline };
            case "speech_timer_status":
              return { deadline: window.deadline };
            case "plugin:window|set_fullscreen":
              window.fullscreen = args.value;
              return;
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
      window.selectQuote = (quote) => {
        const prose = document.querySelector(".prose");
        const start = prose.textContent.indexOf(quote);
        if (start < 0) throw new Error("Missing selection text " + quote);
        const end = start + quote.length,
          parts = [];
        const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
        let node,
          cursor = 0;
        while ((node = walker.nextNode())) {
          parts.push({ node, start: cursor, end: cursor + node.data.length });
          cursor += node.data.length;
        }
        const first = parts.find((part) => part.end > start),
          last = parts.find((part) => part.end >= end);
        const range = document.createRange();
        range.setStart(first.node, start - first.start);
        range.setEnd(last.node, end - last.start);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      };
    },
    { initial: fixture, bytes: [...bookBytes] },
  );
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "speech_timer_status"),
  );
  await page.locator(".book-title").click();
  await page.locator(".reader-footer").waitFor();

  // Ctrl+F finds all chapters, without confusing DOM offsets with speech offsets.
  await page.keyboard.press("Control+f");
  await page.locator("#reader-search").fill("cafe");
  await page.waitForFunction(
    () => document.querySelectorAll("[data-search-result]").length === 3,
  );
  await page.locator("[data-search-result]").last().click();
  await page.waitForFunction(
    () => document.querySelector("#chapter").value === "1",
  );
  assert.ok(await page.locator(".prose [data-search-hit]").count());
  assert.ok(
    await page.locator(".reading-pane").evaluate((pane) => pane.scrollTop > 0),
  );
  await page.locator("#reader-search").fill("palabra inexistente");
  await page.waitForFunction(
    () => document.querySelectorAll("[data-search-result]").length === 0,
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelector("#reader-panel").hidden,
  );

  // Highlights can span markup; edited notes persist and render on reopening.
  await page.locator("#chapter").selectOption("0");
  await page.locator('[data-action="book-notes"]').click();
  await page.evaluate(() => selectQuote("casa azul"));
  await page.locator('[data-action="add-highlight"]').click();
  await page.locator('dialog [name="label"]').fill("La casa");
  await page.locator('dialog [name="color"]').selectOption("green");
  await page.locator('dialog button[value="save"]').click();
  await page.waitForFunction(
    () =>
      window.saved.books[0].annotations?.filter((item) => !item.deleted)
        .length === 1,
  );
  assert.ok(await page.locator('.prose [data-color="green"]').count());
  const originalText = await page.locator(".prose").textContent();
  await page.evaluate(() => selectQuote("café"));
  await page.locator('[data-action="add-note"]').click();
  await page.locator('dialog [name="label"]').fill("Una idea");
  await page.locator('dialog [name="note"]').fill("Volver a esta escena.");
  await page.locator('dialog [name="color"]').selectOption("pink");
  await page.locator('dialog button[value="save"]').click();
  await page.waitForFunction(
    () =>
      window.saved.books[0].annotations?.filter((item) => !item.deleted)
        .length === 2,
  );
  let noteId = await page.evaluate(
    () =>
      window.saved.books[0].annotations.find((item) => item.type === "note").id,
  );
  await page.locator(`[data-edit-annotation="${noteId}"]`).click();
  await page
    .locator('dialog [name="note"]')
    .fill("Recordar el detalle del café.");
  await page.locator('dialog button[value="save"]').click();
  await page.waitForFunction(() =>
    window.saved.books[0].annotations.some(
      (item) => item.note === "Recordar el detalle del café.",
    ),
  );
  assert.equal(await page.locator(".prose").textContent(), originalText);

  // A bookmark stores the visible place, independent of font/re-rendering.
  await page.evaluate(() => {
    getSelection().removeAllRanges();
    const pane = document.querySelector(".reading-pane");
    pane.scrollTop = pane.scrollHeight / 2;
    pane.focus();
  });
  await page.keyboard.press("Control+m");
  await page.locator('dialog [name="label"]').fill("Mi lugar");
  await page.locator('dialog button[value="save"]').click();
  await page.waitForFunction(
    () =>
      window.saved.books[0].annotations?.filter((item) => !item.deleted)
        .length === 3,
  );
  const bookmark = await page.evaluate(() =>
    window.saved.books[0].annotations.find((item) => item.type === "bookmark"),
  );
  assert.ok(bookmark.start > 0);
  assert.equal(bookmark.end, bookmark.start);
  await page.locator('.reader-header [data-action="back"]').click();
  await page.locator(".book-title").click();
  await page.locator(".reader-footer").waitFor();
  await page.locator('[data-action="book-notes"]').click();
  await page.locator(`[data-go-annotation="${bookmark.id}"]`).click();
  assert.ok(
    await page.locator(".reading-pane").evaluate((pane) => pane.scrollTop > 0),
  );
  assert.ok(await page.locator('.prose [data-color="green"]').count());
  await page.locator(`[data-delete-annotation="${noteId}"]`).click();
  await page.waitForFunction(
    (id) =>
      window.saved.books[0].annotations.find((item) => item.id === id).deleted,
    noteId,
  );
  assert.equal(
    await page.locator(`.prose [data-annotation="${noteId}"]`).count(),
    0,
  );
  assert.equal(
    await page.locator(`[data-go-annotation="${noteId}"]`).count(),
    0,
  );

  // Fullscreen and chapter shortcuts leave input fields and selected text alone.
  await page.locator('[data-action="close-reader-panel"]').click();
  await page.evaluate(() => {
    getSelection().removeAllRanges();
    document.querySelector(".reading-pane").focus();
  });
  await page.keyboard.press("F11");
  await page.waitForFunction(() =>
    document.getElementById("app").classList.contains("reader-focus"),
  );
  assert.equal(await page.evaluate(() => window.fullscreen), true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.getElementById("app").classList.contains("reader-focus"),
  );
  assert.equal(await page.evaluate(() => window.fullscreen), false);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector("#chapter").value === "1",
  );
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    () => document.querySelector("#chapter").value === "0",
  );

  // Finishing a chapter pauses before any next-chapter speech is submitted.
  await page.locator('[data-action="start-audio"]').click();
  await page.locator("#sleep-timer").selectOption("chapter");
  let paused = false;
  for (let index = 0; index < 15; index++) {
    const before = await page.evaluate(
      () =>
        window.calls.filter(
          (call) =>
            call.command === "speech_command" &&
            call.args.command.action === "speak",
        ).length,
    );
    await page.evaluate(() => {
      const request = window.calls
        .filter(
          (call) =>
            call.command === "speech_command" &&
            call.args.command.action === "speak",
        )
        .at(-1).args.command;
      emitNative("speech-event", {
        type: "completed",
        id: request.id,
        cancelled: false,
        error: null,
      });
    });
    await page.waitForFunction(
      (before) =>
        document.querySelector('[data-action="pause-audio"]').textContent ===
          "Continuar" ||
        window.calls.filter(
          (call) =>
            call.command === "speech_command" &&
            call.args.command.action === "speak",
        ).length > before,
      before,
    );
    paused =
      (await page.locator('[data-action="pause-audio"]').textContent()) ===
      "Continuar";
    if (paused) break;
  }
  assert.equal(paused, true);
  assert.deepEqual(
    await page.evaluate(() => [
      ...new Set(
        window.calls
          .filter(
            (call) =>
              call.command === "speech_command" &&
              call.args.command.action === "speak",
          )
          .map((call) => call.args.command.chapter),
      ),
    ]),
    ["first"],
  );
  assert.equal(await page.locator("#sleep-timer").inputValue(), "off");

  // Timed expiry cancels active voice; stop clears timers; pausing resumes safely.
  await page.evaluate(() => document.querySelector(".reading-pane").focus());
  await page.keyboard.press("Control+Space");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="pause-audio"]').textContent ===
      "Pausar",
  );
  await page.locator("#sleep-timer").selectOption("15");
  assert.ok(await page.evaluate(() => window.deadline > Date.now()));
  await page.setViewportSize({ width: 800, height: 600 });
  await page.locator('[data-action="book-notes"]').click();
  const footer = await page.locator(".reader-footer").boundingBox();
  const audio = await page.locator("#audio-bar").boundingBox();
  const pane = await page.locator(".reading-pane").boundingBox();
  assert.ok(
    footer.y + footer.height <= audio.y + 1,
    "Footer stays above voice controls in a small window",
  );
  assert.ok(pane.height > 70, "Notes and voice retain a usable text viewport");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: "work/reading-tools-preview.png" });
  await page.locator('[data-action="close-reader-panel"]').click();
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.evaluate(() => document.querySelector(".reading-pane").focus());
  await page.keyboard.press("Control+Space");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="pause-audio"]').textContent ===
      "Continuar",
  );
  await page.keyboard.press("Control+Space");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="pause-audio"]').textContent ===
      "Pausar",
  );
  await page.evaluate(() => {
    window.deadline = null;
    emitNative("sleep-timer", { expired: true });
  });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="pause-audio"]').textContent ===
      "Continuar",
  );
  assert.equal(await page.locator("#sleep-timer").inputValue(), "off");
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.command === "speech_command").at(-1)
          .args.command.action,
    ),
    "cancel",
  );
  await page.locator("#sleep-timer").selectOption("30");
  await page.locator('[data-action="stop-audio"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#audio-bar").classList.contains("hidden"),
  );
  assert.equal(await page.evaluate(() => window.deadline), null);
  assert.equal(await page.evaluate(() => window.saved.books.length), 1);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      casesPassed: 7,
      chapters: 2,
      search: true,
      annotations: true,
      bookmarks: true,
      fullscreen: true,
      shortcuts: true,
      timer: true,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
