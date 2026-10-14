import { installStateBridge } from "./helpers/state-bridge.mjs";
// Integrated paginated reading + native voice commands in an isolated fixture.
// No installed app, user library, account or real audio engine is touched.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { zipSync, strToU8 } from "fflate";
import { addBook, createLibrary } from "../src/core/library.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: `node_modules/.vite-browser-reader-v050-${process.pid}`,
  optimizeDeps: { holdUntilCrawlEnd: false },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const chapter = (title, html) =>
  strToU8(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${html}</body></html>`,
  );
const longText = (count) =>
  Array.from({ length: count }, (_, index) =>
    index === 34
      ? "<p>Señal profunda. <em>La segunda frase exacta.</em> Tercera frase para seguir.</p>"
      : `<p>Párrafo ${index + 1}. Una página conserva su lugar aunque cambie la ventana. La tarde sigue tranquila mientras el libro avanza entre palabras, recuerdos y caminos nuevos.</p>`,
  ).join("");
const bookBytes = zipSync({
  mimetype: strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8(
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
  ),
  "OEBPS/content.opf": strToU8(
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">reader-v050-fixture</dc:identifier><dc:title>El camino de lectura</dc:title><dc:creator>Autor de prueba</dc:creator><dc:language>es</dc:language></metadata><manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml" /><item id="short" href="short.xhtml" media-type="application/xhtml+xml" /><item id="last" href="last.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="first" /><itemref idref="short" /><itemref idref="last" /></spine></package>',
  ),
  "OEBPS/first.xhtml": chapter("El comienzo", longText(60)),
  "OEBPS/short.xhtml": chapter(
    "Un intermedio breve",
    "<p>Esta sección cabe entera en la ventana.</p>",
  ),
  "OEBPS/last.xhtml": chapter("El final", longText(45)),
});
const primaryId = "a".repeat(64),
  secondaryId = "b".repeat(64);
let fixture = addBook(
  createLibrary(),
  {
    id: primaryId,
    title: "El camino de lectura",
    author: "Autor de prueba",
    genres: [],
    format: "epub",
  },
  1,
);
fixture = addBook(
  fixture,
  {
    id: secondaryId,
    title: "Otro libro",
    author: "Otro autor",
    genres: [],
    format: "epub",
  },
  2,
);
fixture.preferences = {
  ...fixture.preferences,
  readingMode: "page",
  uiLanguage: "es",
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
let page,
  currentCase = "bootstrap";
const passed = [];
try {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installStateBridge(page);
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
            case "speech_timer_status":
              return { deadline: null };
            case "speech_timer":
              if (window.holdTimer)
                return new Promise((resolve) => {
                  window.releaseHeldTimer = resolve;
                });
              return { deadline: null };
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
  await page.locator(`.book-title[data-open="${primaryId}"]`).click();
  await page.locator(".reader-footer").waitFor();
  await page.evaluate(() => {
    window.rangeAt = (offset) => {
      const prose = document.querySelector(".prose"),
        range = document.createRange();
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
      let node,
        cursor = 0;
      while ((node = walker.nextNode())) {
        if (cursor + node.length > offset) {
          range.setStart(node, offset - cursor);
          range.setEnd(node, Math.min(node.length, offset - cursor + 1));
          return range;
        }
        cursor += node.length;
      }
      return null;
    };
    window.visibleOffset = (offset) => {
      const range = rangeAt(offset),
        frame =
          document.querySelector(".reader-page-frame") ||
          document.querySelector(".reading-pane");
      if (!range) return false;
      const rect = range.getBoundingClientRect(),
        box = frame.getBoundingClientRect();
      return (
        rect.height > 0 &&
        rect.right > box.left &&
        rect.left < box.right &&
        rect.bottom > box.top &&
        rect.top < box.bottom
      );
    };
  });
  const metrics = () =>
    page.evaluate(() => {
      const text = document.querySelector("#reading-page-label").textContent;
      const match = text.match(
        /Página (\d+)(?:–(\d+))? \/ (\d+) · Capítulo (\d+) \/ (\d+)/,
      );
      const pane = document.querySelector(".reading-pane"),
        frame = document.querySelector(".reader-page-frame");
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
        };
      };
      return {
        label: text,
        mode: document.querySelector("#reading-mode").value,
        page: match ? Number(match[1]) : null,
        pageEnd: match ? Number(match[2] || match[1]) : null,
        count: match ? Number(match[3]) : null,
        chapter: Number(document.querySelector("#chapter").value),
        progress: document.querySelector("#book-progress").value,
        frame: frame ? rect(frame) : null,
        pane: rect(pane),
        footer: rect(document.querySelector(".reader-footer")),
        audio: document.querySelector("#audio-bar").classList.contains("hidden")
          ? null
          : rect(document.querySelector("#audio-bar")),
        width: innerWidth,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
        scrollLeft: frame?.scrollLeft || 0,
      };
    });
  const pageAt = async (expected, chapterIndex = null) => {
    await page.waitForFunction(
      ({ expected, chapterIndex }) => {
        const match = document
          .querySelector("#reading-page-label")
          ?.textContent.match(/Página (\d+)/);
        return (
          match &&
          Number(match[1]) === expected &&
          (chapterIndex === null ||
            Number(document.querySelector("#chapter").value) === chapterIndex)
        );
      },
      { expected, chapterIndex },
    );
    return metrics();
  };
  const next = page.locator('[data-chapter-step="1"]'),
    previous = page.locator('[data-chapter-step="-1"]');
  const chooseChapter = async (index) => {
    await page.locator("#chapter").selectOption(String(index));
    await page.waitForFunction(
      (index) => Number(document.querySelector("#chapter").value) === index,
      index,
    );
    await page.waitForTimeout(60);
  };
  const savedBook = () =>
    page.evaluate(
      (id) => window.saved.books.find((book) => book.id === id),
      primaryId,
    );
  const spoken = () =>
    page.evaluate(() =>
      window.calls
        .filter(
          (call) =>
            call.command === "speech_command" &&
            call.args.command.action === "speak",
        )
        .map((call) => call.args.command),
    );
  const waitSpoken = (count) =>
    page.waitForFunction(
      (count) =>
        window.calls.filter(
          (call) =>
            call.command === "speech_command" &&
            call.args.command.action === "speak",
        ).length > count,
      count,
    );
  const visibleLayout = (state) => {
    assert.ok(
      state.footer.top >= 0 && state.footer.bottom <= state.height + 1,
      "Reader navigation is inside the window",
    );
    assert.ok(
      state.pane.bottom <= state.footer.top + 1,
      "Navigation does not obscure book text",
    );
    assert.equal(
      state.overflow,
      false,
      "Pages do not widen the application window",
    );
    if (state.audio)
      assert.ok(
        state.footer.bottom <= state.audio.top + 1,
        "Voice controls leave navigation accessible",
      );
  };

  currentCase = "page navigation and full-book progress";
  let state = await pageAt(1, 0);
  assert.ok(state.count > 5);
  assert.equal(await previous.isDisabled(), true);
  visibleLayout(state);
  const initialProgress = state.progress;
  await next.click();
  state = await pageAt(2, 0);
  assert.ok(state.progress > initialProgress);
  assert.equal(await previous.isDisabled(), false);
  await previous.click();
  state = await pageAt(1, 0);
  assert.equal(state.progress, initialProgress);
  passed.push(currentCase);

  currentCase = "chapter edges return to the prior chapter's final page";
  for (let i = 1; i < state.count; i++) {
    await next.click();
    state = await pageAt(i + 1, 0);
  }
  assert.ok(Math.abs(state.progress - 100 / 3) < 0.01);
  const finalFirstPage = state.page;
  await next.click();
  state = await pageAt(1, 1);
  assert.equal(state.count, 1);
  assert.ok(Math.abs(state.progress - 200 / 3) < 0.01);
  await previous.click();
  state = await pageAt(finalFirstPage, 0);
  assert.equal(state.page, state.count);
  passed.push(currentCase);

  currentCase = "spread navigation, resize and settings preserve text offsets";
  await chooseChapter(1);
  await chooseChapter(0);
  await pageAt(1, 0);
  await next.click();
  await pageAt(2, 0);
  await next.click();
  await pageAt(3, 0);
  await page.locator("#reading-mode").selectOption("spread");
  await page.waitForFunction(
    () =>
      document.querySelector(".reading-pane").dataset.readingMode === "spread",
  );
  state = await metrics();
  assert.equal(state.pageEnd, state.page + 1);
  const beforeSpread = state.page;
  await next.click();
  state = await pageAt(beforeSpread + 2, 0);
  await page.locator('.reader-header [data-action="settings"]').click();
  const anchorBeforeResize = (await savedBook()).locator.offset;
  assert.ok(anchorBeforeResize > 0);
  await page.locator('[data-action="resume-reading"]').click();
  await page.setViewportSize({ width: 800, height: 700 });
  await page.waitForTimeout(150);
  state = await metrics();
  assert.equal(state.mode, "spread");
  assert.equal(
    state.pageEnd,
    state.page,
    "Narrow windows show one page without changing the preference",
  );
  assert.equal(
    await page.evaluate((offset) => visibleOffset(offset), anchorBeforeResize),
    true,
  );
  visibleLayout(state);
  await page.locator('.reader-header [data-action="settings"]').click();
  assert.equal((await savedBook()).locator.offset, anchorBeforeResize);
  await page.locator('[data-preference="fontSize"]').evaluate((input) => {
    input.value = 27;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => window.saved.preferences.fontSize === 27);
  await page.locator('[data-action="resume-reading"]').click();
  assert.equal(
    await page.evaluate((offset) => visibleOffset(offset), anchorBeforeResize),
    true,
  );
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate((offset) => visibleOffset(offset), anchorBeforeResize),
    true,
  );
  passed.push(currentCase);

  currentCase =
    "bookmarks and search reveal their semantic text offsets in pages";
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator('[data-action="book-notes"]').click();
  await page.locator('[data-action="add-bookmark"]').click();
  await page.locator('dialog input[name="label"]').fill("Paso de prueba");
  await page.locator('dialog button[value="save"]').click();
  await page.waitForFunction(
    (id) =>
      window.saved.books
        .find((book) => book.id === id)
        .annotations?.some((item) => item.label === "Paso de prueba"),
    primaryId,
  );
  const bookmark = (await savedBook()).annotations.find(
    (item) => item.label === "Paso de prueba",
  );
  assert.ok(bookmark.start > 0);
  await chooseChapter(2);
  await page.locator(`[data-go-annotation="${bookmark.id}"]`).click();
  await page.waitForFunction(
    () => Number(document.querySelector("#chapter").value) === 0,
  );
  await page.waitForTimeout(100);
  assert.equal((await savedBook()).locator.offset, bookmark.start);
  assert.equal(
    await page.evaluate((offset) => visibleOffset(offset), bookmark.start),
    true,
  );
  await page.locator('[data-action="book-search"]').click();
  await page.locator("#reader-search").fill("señal profunda");
  await page.locator('[data-search-result="0"]').click();
  await page.waitForTimeout(100);
  const searchOffset = (await savedBook()).locator.offset;
  assert.equal(
    await page.evaluate(
      (offset) =>
        document.querySelector(".prose").textContent.slice(offset, offset + 14),
      searchOffset,
    ),
    "Señal profunda",
  );
  assert.equal(
    await page.evaluate((offset) => visibleOffset(offset), searchOffset),
    true,
  );
  await page.locator('[data-action="close-reader-panel"]').click();
  passed.push(currentCase);

  currentCase =
    "listen from selected phrase sends the exact native UTF-16 position";
  const selected = await page.evaluate(() => {
    const prose = document.querySelector(".prose"),
      target = [...prose.querySelectorAll("em")].find(
        (node) => node.textContent === "La segunda frase exacta.",
      );
    const holder = prose.cloneNode(true);
    holder
      .querySelectorAll(
        "mark[data-reader-search-hit],mark[data-reader-annotation],mark[data-reader-speech]",
      )
      .forEach((node) => node.replaceWith(...node.childNodes));
    holder
      .querySelectorAll("p,div,h1,h2,h3,h4,li,blockquote")
      .forEach((node) => node.append(document.createTextNode("\n")));
    window.expectedSpeechText = holder.textContent;
    const range = document.createRange();
    range.selectNodeContents(target);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return {
      offset: expectedSpeechText.indexOf(target.textContent),
      following: expectedSpeechText.indexOf("Tercera frase para seguir."),
    };
  });
  let requests = await spoken();
  await page.locator('[data-action="audio-from-here"]').click();
  await waitSpoken(requests.length);
  requests = await spoken();
  const selectedRequest = requests.at(-1);
  assert.equal(selectedRequest.start, selected.offset);
  assert.equal(selectedRequest.chapter, "first");
  assert.ok(selectedRequest.text.startsWith("La segunda frase exacta."));
  assert.equal(
    await page.evaluate(() =>
      [...CSS.highlights.get("lector-speech")][0]
        .toString()
        .startsWith("La segunda frase exacta."),
    ),
    true,
  );
  visibleLayout(await metrics());
  passed.push(currentCase);

  currentCase =
    "phrase jumps ignore old native progress, completion and faults";
  await page.locator('[data-action="audio-next"]').click();
  await waitSpoken(requests.length);
  requests = await spoken();
  const followingRequest = requests.at(-1);
  assert.equal(followingRequest.start, selected.following);
  assert.notEqual(followingRequest.id, selectedRequest.id);
  const requestCount = requests.length;
  await page.evaluate((id) => {
    emitNative("speech-event", { type: "progress", id, offset: 10 });
    emitNative("speech-event", { type: "completed", id, cancelled: false });
    emitNative("speech-event", {
      type: "fault",
      id,
      error: "Fallo atrasado de prueba",
    });
  }, selectedRequest.id);
  await page.waitForTimeout(100);
  assert.equal(
    (await spoken()).length,
    requestCount,
    "Old completion never schedules another fragment",
  );
  assert.match(
    await page.locator("#audio-bar small").first().textContent(),
    /Leyendo/,
  );
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("lector-speech")),
    true,
  );
  passed.push(currentCase);

  currentCase =
    "paused phrase navigation remains paused and resumes at its chosen offset";
  await page.locator('[data-action="pause-audio"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="pause-audio"]').textContent ===
      "Continuar",
  );
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("lector-speech")),
    false,
  );
  await page.locator('[data-action="audio-next"]').click();
  await page.waitForTimeout(70);
  const skippedOffset = (await savedBook()).audioPosition.offset;
  assert.ok(skippedOffset > followingRequest.start);
  assert.equal((await spoken()).length, requestCount);
  assert.match(
    await page.locator("#audio-bar small").first().textContent(),
    /En pausa/,
  );
  await page.locator('[data-action="audio-previous"]').click();
  await page.waitForTimeout(70);
  assert.equal(
    (await savedBook()).audioPosition.offset,
    followingRequest.start,
  );
  assert.equal((await spoken()).length, requestCount);
  await page.locator('[data-action="pause-audio"]').click();
  await waitSpoken(requestCount);
  assert.equal((await spoken()).at(-1).start, followingRequest.start);
  passed.push(currentCase);

  currentCase =
    "rapid voice actions advance twice without reviving stale requests";
  const beforeRapid = await spoken();
  await page.evaluate(() => {
    document.querySelector('[data-action="audio-next"]').click();
    document.querySelector('[data-action="audio-next"]').click();
  });
  await page.waitForFunction(
    (count) =>
      window.calls.filter(
        (call) =>
          call.command === "speech_command" &&
          call.args.command.action === "speak",
      ).length ===
      count + 2,
    beforeRapid.length,
  );
  const afterRapid = await spoken(),
    firstRapid = afterRapid.at(-2),
    secondRapid = afterRapid.at(-1);
  assert.ok(firstRapid.start > beforeRapid.at(-1).start);
  assert.ok(secondRapid.start > firstRapid.start);
  assert.notEqual(secondRapid.id, firstRapid.id);
  await page.evaluate(
    (id) =>
      emitNative("speech-event", { type: "completed", id, cancelled: true }),
    firstRapid.id,
  );
  await page.waitForTimeout(50);
  assert.match(
    await page.locator("#audio-bar small").first().textContent(),
    /Leyendo/,
  );
  assert.equal((await spoken()).length, afterRapid.length);
  passed.push(currentCase);

  currentCase =
    "audio for one book never paints another reader's same chapter id";
  await page.locator('.sidebar [data-section="all"]').click();
  await page.locator(`.book-title[data-open="${secondaryId}"]`).click();
  await page.locator(".reader-footer").waitFor();
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("lector-speech")),
    false,
  );
  assert.equal(await page.locator(".prose [data-reader-speech]").count(), 0);
  assert.equal(
    await page.locator("#audio-bar strong").textContent(),
    "El camino de lectura",
  );
  const currentRequest = (await spoken()).at(-1);
  await page.evaluate(
    (request) =>
      emitNative("speech-event", {
        type: "progress",
        id: request.id,
        offset: 5,
      }),
    currentRequest,
  );
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("lector-speech")),
    false,
  );
  assert.deepEqual(errors, []);
  passed.push(currentCase);

  currentCase =
    "stop cancels audio before waiting for timer cleanup and ignores old completion";
  const beforeStop = await page.evaluate(
    () =>
      window.calls.filter(
        (call) =>
          call.command === "speech_command" &&
          call.args.command.action === "cancel",
      ).length,
  );
  await page.evaluate(() => {
    window.holdTimer = true;
  });
  await page.locator('[data-action="stop-audio"]').click();
  await page.waitForFunction(
    (count) =>
      window.calls.filter(
        (call) =>
          call.command === "speech_command" &&
          call.args.command.action === "cancel",
      ).length > count && typeof window.releaseHeldTimer === "function",
    beforeStop,
  );
  const stoppedCount = (await spoken()).length;
  await page.evaluate(
    (id) =>
      emitNative("speech-event", { type: "completed", id, cancelled: false }),
    currentRequest.id,
  );
  assert.equal((await spoken()).length, stoppedCount);
  assert.equal(await page.locator("#audio-bar").isVisible(), false);
  await page.evaluate(() => {
    window.holdTimer = false;
    window.releaseHeldTimer({ deadline: null });
  });
  passed.push(currentCase);
  await page.screenshot({ path: "work/reader-v050-preview.png" });
  console.log(
    JSON.stringify({ casesPassed: passed.length, cases: passed, errors }),
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: "work/reader-v050-failure.png" })
      .catch(() => {});
    console.error(
      JSON.stringify({
        failingCase: currentCase,
        passed,
        screenshot: "work/reader-v050-failure.png",
        details: await page
          .evaluate(() => ({
            label: document.querySelector("#reading-page-label")?.textContent,
            toast: document.querySelector("#toast")?.textContent,
            errors: [...document.querySelectorAll(".toast")].map(
              (item) => item.textContent,
            ),
          }))
          .catch(() => null),
      }),
    );
  }
  throw error;
} finally {
  await browser.close();
  await server.close();
}
