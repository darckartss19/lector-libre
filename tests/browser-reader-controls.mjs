import { installStateBridge } from "./helpers/state-bridge.mjs";
// Reader navigation geometry and live book progress in a fresh, isolated browser.
// The fake native bridge never touches the installed app, user books or accounts.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { zipSync, strToU8 } from "fflate";
import { createLibrary, addBook, markRead } from "../src/core/library.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: "node_modules/.vite-browser-reader-controls",
  optimizeDeps: { holdUntilCrawlEnd: false },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const chapter = (title, paragraphs) =>
  strToU8(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${paragraphs}</body></html>`,
  );
const longText = (count) =>
  Array.from(
    { length: count },
    (_, index) =>
      `<p>Párrafo ${index + 1}. Una página conserva su lugar aunque cambie la ventana. La tarde sigue tranquila mientras el libro avanza entre palabras, recuerdos y caminos nuevos.</p>`,
  ).join("");
const bookBytes = zipSync({
  mimetype: strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8(
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
  ),
  "OEBPS/content.opf": strToU8(
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">reader-controls-fixture</dc:identifier><dc:title>El camino de lectura</dc:title><dc:creator>Autor de prueba</dc:creator><dc:language>es</dc:language></metadata><manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml" /><item id="short" href="short.xhtml" media-type="application/xhtml+xml" /><item id="last" href="last.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="first" /><itemref idref="short" /><itemref idref="last" /></spine></package>',
  ),
  "OEBPS/first.xhtml": chapter("El comienzo", longText(90)),
  "OEBPS/short.xhtml": chapter(
    "Un intermedio breve",
    "<p>Esta sección cabe entera en la ventana.</p>",
  ),
  "OEBPS/last.xhtml": chapter("El final", longText(70)),
});
let fixture = addBook(
  createLibrary(),
  {
    id: "d".repeat(64),
    title: "El camino de lectura",
    author: "Autor de prueba",
    genres: [],
    format: "epub",
  },
  1,
);
fixture = markRead(fixture, fixture.books[0].id, {
  progress: 0.25 / 3,
  locator: { chapter: "first", fraction: 0.25 },
});
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
    ({ initial, bytes }) => {
      let callbackId = 0;
      const callbacks = new Map(),
        listeners = new Map();
      window.saved = structuredClone(initial);
      window.calls = [];
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
    { initial: fixture, bytes: [...bookBytes] },
  );
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "neural_catalog"),
  );
  await page.locator(".book-title").click();
  await page.locator(".reader-footer").waitFor();

  const metrics = () =>
    page.evaluate(() => {
      const pane = document.querySelector(".reading-pane"),
        progress = document.querySelector("#book-progress");
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
          height: box.height,
        };
      };
      const scrollable = pane.scrollHeight - pane.clientHeight;
      return {
        footer: rect(".reader-footer"),
        controls: rect(".chapter-controls"),
        pane: rect(".reading-pane"),
        fraction: scrollable <= 0 ? 1 : pane.scrollTop / scrollable,
        index: Number(document.querySelector("#chapter").value),
        progress: Number(progress.value),
        max: Number(progress.max),
        label: document.querySelector("#book-progress-label").textContent,
        ownsFooter: pane.contains(document.querySelector(".reader-footer")),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        viewport: { width: innerWidth, height: innerHeight },
        audio: document.querySelector("#audio-bar").classList.contains("hidden")
          ? null
          : rect("#audio-bar"),
      };
    });
  const closeTo = (actual, expected, message) =>
    assert.ok(
      Math.abs(actual - expected) < 0.15,
      `${message}: ${actual} != ${expected}`,
    );
  const correctProgress = async () => {
    await page.waitForFunction(() => {
      const pane = document.querySelector(".reading-pane");
      const fraction =
        pane.scrollHeight <= pane.clientHeight
          ? 1
          : pane.scrollTop / (pane.scrollHeight - pane.clientHeight);
      const index = Number(document.querySelector("#chapter").value);
      return (
        Math.abs(
          Number(document.querySelector("#book-progress").value) -
            ((index + fraction) / 3) * 100,
        ) < 0.15
      );
    });
    const state = await metrics();
    closeTo(
      state.progress,
      ((state.index + state.fraction) / 3) * 100,
      "Live progress matches chapter and scroll",
    );
    assert.equal(state.max, 100);
    assert.match(state.label, /%/);
    return state;
  };
  const visibleFooter = (state) => {
    assert.equal(
      state.ownsFooter,
      false,
      "Navigation must be outside the scrolling book",
    );
    assert.ok(
      state.footer.top >= 0 && state.footer.bottom <= state.viewport.height + 1,
      "Footer remains in the viewport",
    );
    assert.ok(
      state.controls.top >= state.footer.top &&
        state.controls.bottom <= state.footer.bottom + 1,
    );
    assert.ok(
      state.pane.bottom <= state.footer.top + 1,
      "Book text must not be obscured by navigation",
    );
    assert.equal(state.horizontalOverflow, false);
    if (state.audio)
      assert.ok(
        state.footer.bottom <= state.audio.top + 1,
        "Audio bar must not cover reader controls",
      );
  };
  const scrollToFraction = async (fraction) => {
    // Let the resize observer and its layout frame finish before simulating user scroll.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.locator(".reading-pane").evaluate((pane, fraction) => {
      pane.scrollTop =
        fraction * Math.max(0, pane.scrollHeight - pane.clientHeight);
    }, fraction);
    await page.waitForFunction((fraction) => {
      const pane = document.querySelector(".reading-pane"),
        index = Number(document.querySelector("#chapter").value);
      const actualFraction =
        pane.scrollHeight <= pane.clientHeight
          ? 1
          : pane.scrollTop / (pane.scrollHeight - pane.clientHeight);
      return (
        Math.abs(
          Number(document.querySelector("#book-progress").value) -
            ((index + actualFraction) / 3) * 100,
        ) < 0.15 && Math.abs(actualFraction - fraction) < 0.001
      );
    }, fraction);
  };

  // Saved locations show correct progress immediately on opening, without extra input.
  let state = await correctProgress();
  closeTo(state.fraction, 0.25, "Opening restores scroll location");
  visibleFooter(state);
  assert.equal(
    await page.locator('[data-chapter-step="-1"]').isDisabled(),
    true,
  );
  const originalTop = state.footer.top;
  for (const fraction of [0, 0.5, 1]) {
    await scrollToFraction(fraction);
    state = await correctProgress();
    visibleFooter(state);
    closeTo(
      state.footer.top,
      originalTop,
      "Footer position stays fixed while scrolling",
    );
  }

  // Chapter navigation stays reachable; a chapter with no scroll is fully read.
  await page.locator('[data-chapter-step="1"]').click();
  state = await correctProgress();
  assert.equal(state.index, 1);
  assert.equal(state.fraction, 1);
  closeTo(
    state.progress,
    200 / 3,
    "Short middle chapter counts toward full-book progress",
  );
  visibleFooter(state);
  await page.locator('[data-chapter-step="-1"]').click();
  state = await correctProgress();
  assert.equal(state.index, 0);
  closeTo(state.progress, 0, "Previous chapter opens at its start");

  // Selecting the final chapter and reading to its end reaches exactly 100%.
  await page.locator("#chapter").selectOption("2");
  state = await correctProgress();
  assert.equal(state.index, 2);
  assert.equal(
    await page.locator('[data-chapter-step="1"]').isDisabled(),
    true,
  );
  closeTo(
    state.progress,
    200 / 3,
    "Last chapter starts at its full-book position",
  );
  await scrollToFraction(1);
  state = await correctProgress();
  assert.equal(state.progress, 100);
  await page.waitForFunction(() => window.saved.books[0].progress === 1);

  // Leaving the reader or visiting page settings retains and restores the fraction.
  await scrollToFraction(0.37);
  await page.locator('[data-action="back"]').click();
  await page.locator(".book-title").click();
  state = await correctProgress();
  closeTo(state.fraction, 0.37, "Reopening retains the reading position");
  await page.locator('.reader-header [data-action="settings"]').click();
  await page.locator('[data-preference="fontSize"]').evaluate((input) => {
    input.value = 28;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => window.saved.preferences.fontSize === 28);
  await page.locator('[data-action="resume-reading"]').click();
  state = await correctProgress();
  closeTo(
    state.fraction,
    0.37,
    "Resuming after typography changes retains the reading position",
  );
  visibleFooter(state);

  // Audio and the smallest supported desktop size leave both controls accessible.
  await page.locator('[data-action="start-audio"]').click();
  await page.locator("#audio-bar:not(.hidden)").waitFor();
  state = await correctProgress();
  visibleFooter(state);
  for (const viewport of [
    { width: 800, height: 600 },
    { width: 1200, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    for (const fraction of [0, 0.5, 1]) {
      await scrollToFraction(fraction);
      visibleFooter(await correctProgress());
    }
  }
  await page.locator('[data-action="stop-audio"]').click();

  // The progress control has an accessible name in each interface language.
  for (const [language, accessibleLabel] of [
    ["en", "Book progress"],
    ["pt", "Progresso do livro"],
    ["es", "Progreso del libro"],
  ]) {
    await page.locator('.reader-header [data-action="settings"]').click();
    await page.locator('[data-preference="uiLanguage"]').selectOption(language);
    await page.locator('[data-action="resume-reading"]').click();
    const label = await page
      .locator("#book-progress")
      .evaluate(
        (progress) =>
          progress.getAttribute("aria-label") ||
          document.getElementById(progress.getAttribute("aria-labelledby"))
            ?.textContent,
      );
    assert.match(label, new RegExp(accessibleLabel));
    visibleFooter(await correctProgress());
  }
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1280, height: 800 });
  await scrollToFraction(0.37);
  await page.screenshot({ path: "work/reader-footer-preview.png" });
  console.log(
    JSON.stringify({
      casesPassed: 7,
      chapters: 3,
      viewports: 2,
      languages: 3,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
