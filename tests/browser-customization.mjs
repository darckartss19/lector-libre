import { installStateBridge } from "./helpers/state-bridge.mjs";
// Real DOM/canvas regressions in a new, headless browser with a fake native bridge.
// This script never opens a user browser/account or writes to the installed reader.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createLibrary, addBook } from "../src/core/library.mjs";
import { THEMES } from "../src/core/appearance.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: "node_modules/.vite-browser-customization",
  optimizeDeps: { holdUntilCrawlEnd: false },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
let fixture = addBook(
  createLibrary(),
  {
    id: "a".repeat(64),
    title: "Añadir libros",
    author: "Biblioteca",
    genres: ["Recientes"],
    format: "txt",
  },
  1,
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installStateBridge(page);
  await page.addInitScript((initial) => {
    let callbackId = 0;
    const callbacks = new Map(),
      listeners = new Map();
    window.calls = [];
    window.saved = initial;
    window.syncFailure = false;
    window.mockNow = Date.now();
    Date.now = () => window.mockNow;
    window.catalog = [
      {
        id: "piper:es",
        name: "Dave",
        language: "es-ES",
        engine: "piper",
        installed: true,
        size: 63201294,
      },
      {
        id: "piper:pt",
        name: "Faber",
        language: "pt-BR",
        engine: "piper",
        installed: false,
        size: 63201294,
      },
      {
        id: "piper:fr",
        name: "Siwis",
        language: "fr-FR",
        engine: "piper",
        installed: false,
        size: 63201294,
      },
    ];
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
            return initial;
          case "save_state":
            window.saved = args.value;
            return;
          case "book_availability":
            return args.books.map((book) => book.id);
          case "drive_config":
            return {
              configured: true,
              connected: true,
              booksEnabled: true,
              canImport: true,
            };
          case "drive_sync":
            if (window.syncFailure) throw "No se pudo guardar en Drive.";
            return [];
          case "drive_books_sync":
            return {
              bindings: [],
              cloud: initial.books.map((b) => b.id),
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
                  },
                  {
                    id: "windows:en",
                    name: "David",
                    language: "en-US",
                    engine: "windows",
                  },
                ]
              : null;
          case "neural_catalog":
            return window.catalog.map((voice) => ({ ...voice }));
          case "neural_install":
            window.catalog.find(
              (voice) => voice.id === args.voiceId,
            ).installed = true;
            return;
          case "read_book":
            return new TextEncoder().encode(
              "Añadir libros\n\nBiblioteca\n\n" +
                "Texto ágil con tildes y ñ. Las palabras conservan su idioma.\n\n".repeat(
                  350,
                ),
            ).buffer;
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
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 60000) {
        window.syncTick = fn;
        return 1;
      }
      return interval(fn, ms, ...args);
    };
  }, fixture);
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() =>
    window.calls.some((c) => c.command === "neural_catalog"),
  );
  await page.locator('[data-action="settings"]').click();

  // All ten palettes apply immediately; page color can remain independently sepia.
  assert.equal(await page.locator("button[data-theme]").count(), 10);
  for (const theme of THEMES) {
    await page.locator(`button[data-theme="${theme.id}"]`).click();
    await page.waitForFunction(
      (id) => window.saved.preferences.theme === id,
      theme.id,
    );
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      theme.id,
    );
    assert.equal(
      await page
        .locator(`button[data-theme="${theme.id}"]`)
        .getAttribute("aria-pressed"),
      "true",
    );
  }
  await page.locator('[data-preference="pageTheme"]').selectOption("sepia");
  assert.equal(
    await page
      .locator(".page-sample")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(245, 234, 214)",
  );
  await page.locator('button[data-theme="midnight"]').click();
  assert.equal(
    await page
      .locator(".page-sample")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(245, 234, 214)",
  );

  // Range values and typography update the existing preview without a screen reset.
  await page.evaluate(
    () => (window.keptSample = document.querySelector(".preview-prose")),
  );
  for (const [name, value] of [
    ["fontSize", 26],
    ["lineHeight", 2.1],
    ["pageWidth", 900],
    ["pagePadding", 44],
    ["paragraphSpacing", 1.7],
    ["letterSpacing", 0.04],
  ]) {
    const previous = await page.evaluate(
      (name) => window.saved.preferences[name],
      name,
    );
    await page
      .locator(`[data-preference="${name}"]`)
      .evaluate((input, value) => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    assert.equal(
      await page.locator(`[data-output="${name}"]`).innerText(),
      `${value}${["fontSize", "pageWidth", "pagePadding"].includes(name) ? " px" : ["paragraphSpacing", "letterSpacing"].includes(name) ? " em" : ""}`,
    );
    assert.equal(
      await page.evaluate((name) => window.saved.preferences[name], name),
      previous,
    );
    await page
      .locator(`[data-preference="${name}"]`)
      .evaluate((input) =>
        input.dispatchEvent(new Event("change", { bubbles: true })),
      );
    await page.waitForFunction(
      ({ name, value }) => window.saved.preferences[name] === value,
      { name, value },
    );
  }
  await page.locator('[data-preference="font"]').selectOption("wide");
  await page.locator('[data-preference="textAlign"]').selectOption("justify");
  await page.locator('[data-preference="firstLineIndent"]').check();
  const preview = await page.locator(".preview-prose").evaluate((el) => ({
    same: el === window.keptSample,
    size: getComputedStyle(el).fontSize,
    line: getComputedStyle(el).lineHeight,
    font: getComputedStyle(el).fontFamily,
    align: getComputedStyle(el).textAlign,
    letter: getComputedStyle(el).letterSpacing,
    indent: getComputedStyle(el.querySelector("p")).textIndent,
  }));
  assert.equal(preview.same, true);
  assert.equal(preview.size, "26px");
  assert.equal(preview.line, "54.6px");
  assert.match(preview.font, /Verdana/);
  assert.equal(preview.align, "justify");
  assert.equal(preview.letter, "1.04px");
  assert.equal(preview.indent, "39px");

  // Interface languages must never rename titles, authors, genres or prose.
  for (const [language, heading, settings] of [
    ["en", "Your library", "Customize and sync"],
    ["pt", "Sua biblioteca", "Personalizar e sincronizar"],
    ["es", "Tu biblioteca", "Personalizar y sincronizar"],
  ]) {
    await page.locator('[data-preference="uiLanguage"]').selectOption(language);
    await page.waitForFunction(
      (language) => document.documentElement.lang === language,
      language,
    );
    assert.match(
      await page.locator('[data-action="settings"]').innerText(),
      new RegExp(settings),
    );
    await page.locator('[data-section="all"]').click();
    assert.equal(await page.locator("h1").innerText(), heading);
    assert.equal(
      await page.locator(".book-title").innerText(),
      "Añadir libros",
    );
    assert.equal(await page.locator(".book-info p").innerText(), "Biblioteca");
    assert.match(await page.locator(".genres button").innerText(), /Recientes/);
    await page.locator(".book-title").click();
    assert.equal(
      await page.locator(".reader-header h2").innerText(),
      "Añadir libros",
    );
    assert.equal(
      await page.locator(".reader-header small").innerText(),
      "Biblioteca",
    );
    assert.match(
      await page.locator(".prose").innerText(),
      /^Añadir libros\n\nBiblioteca/,
    );
    await page.locator('[data-action="settings"]').last().click();
  }

  // Voice language filtering never silently substitutes an unrelated language.
  await page.locator('[data-preference="speechLanguage"]').selectOption("en");
  assert.deepEqual(
    await page
      .locator('[data-preference="voice"] option')
      .evaluateAll((options) => options.map((option) => option.value)),
    ["windows:en"],
  );
  assert.equal(await page.locator("[data-install-voice]").count(), 0);
  await page.locator('[data-preference="speechLanguage"]').selectOption("fr");
  assert.equal(
    await page.locator('[data-action="preview-voice"]').isDisabled(),
    true,
  );
  assert.equal(
    await page.locator('[data-install-voice="piper:fr"]').count(),
    1,
  );
  await page.locator('[data-install-voice="piper:fr"]').click();
  await page.waitForFunction(
    () => window.saved.preferences.voice === "piper:fr",
  );
  assert.equal(
    await page.locator('[data-preference="voice"]').inputValue(),
    "piper:fr",
  );
  assert.equal(
    await page.locator('[data-action="preview-voice"]').isEnabled(),
    true,
  );
  await page.locator('[data-preference="speechLanguage"]').selectOption("es");

  // Leaving reading for settings restores the same fraction with updated page settings.
  await page.locator('[data-action="resume-reading"]').click();
  await page
    .locator(".reading-pane")
    .evaluate((pane) => (pane.scrollTop = 400));
  await page.locator('[data-action="settings"]').last().click();
  const fraction = await page.evaluate(
    () => window.saved.books[0].locator.fraction,
  );
  assert.ok(fraction > 0);
  await page.locator('[data-preference="fontSize"]').evaluate((input) => {
    input.value = 30;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator('[data-action="resume-reading"]').click();
  const resumed = await page
    .locator(".reading-pane")
    .evaluate(
      (pane) => pane.scrollTop / (pane.scrollHeight - pane.clientHeight),
    );
  assert.ok(Math.abs(fraction - resumed) < 0.001);
  assert.equal(
    await page
      .locator(".prose")
      .evaluate((el) => getComputedStyle(el).fontSize),
    "30px",
  );

  // A voice preview cancels live playback but retains its actual reading checkpoint.
  await page.locator('[data-action="start-audio"]').click();
  await page.waitForFunction(() =>
    window.calls.some(
      (c) =>
        c.command === "speech_command" && c.args.command.action === "speak",
    ),
  );
  const bookRequest = await page.evaluate(
    () =>
      window.calls.filter((c) => c.args?.command?.action === "speak").at(-1)
        .args.command,
  );
  assert.equal(bookRequest.voice, "piper:es");
  assert.ok(bookRequest.text.length <= 350);
  await page.evaluate(
    (id) =>
      window.emitNative("speech-event", { id, type: "progress", offset: 64 }),
    bookRequest.id,
  );
  await page.waitForFunction(
    () => window.saved.books[0].audioPosition?.offset === 64,
  );
  await page.locator('[data-action="settings"]').last().click();
  const beforePreview = await page.evaluate(() => ({
    ...window.saved.books[0].audioPosition,
  }));
  await page.locator('[data-action="preview-voice"]').click();
  const voicePreview = await page.evaluate(
    () =>
      window.calls.filter((c) => c.args?.command?.action === "speak").at(-1)
        .args.command,
  );
  assert.match(voicePreview.id, /^preview:/);
  assert.match(voicePreview.text, /Un buen libro/);
  assert.deepEqual(
    await page.evaluate(() => window.saved.books[0].audioPosition),
    beforePreview,
  );
  await page.evaluate(
    (id) => window.emitNative("speech-event", { id, type: "completed" }),
    voicePreview.id,
  );
  assert.equal(
    await page.locator('[data-action="preview-voice"]').innerText(),
    "Probar voz",
  );
  await page.locator('[data-action="pause-audio"]').click();
  const continued = await page.evaluate(
    () =>
      window.calls.filter((c) => c.args?.command?.action === "speak").at(-1)
        .args.command,
  );
  assert.equal(continued.start, 64);
  await page.locator('[data-action="stop-audio"]').click();

  // Real canvas/image decoding shrinks cloud covers and keeps the local originals intact.
  const thumbnail = await page.evaluate(async () => {
    const { CloudSnapshot } = await import("/src/core/cloud-snapshot.mjs");
    const { stampChanges } = await import("/src/core/sync.mjs");
    const { createLibrary, addBook } = await import("/src/core/library.mjs");
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1080;
    const context = canvas.getContext("2d"),
      pixels = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = (i * 73) % 251;
      pixels.data[i + 1] = (i >> 9) % 251;
      pixels.data[i + 2] = ((i * 29) >> 7) % 251;
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const cover = canvas.toDataURL("image/png");
    let local = addBook(
      createLibrary(),
      { id: "b".repeat(64), title: "Portada privada", format: "txt", cover },
      1,
    );
    local = addBook(
      local,
      {
        id: "c".repeat(64),
        title: "Portada dañada",
        format: "txt",
        cover: "data:image/png;base64," + "A".repeat(8192),
      },
      2,
    );
    local = stampChanges(createLibrary(), local, "fixture-device", 1);
    const originalJSON = JSON.stringify(local);
    const cloud = await new CloudSnapshot().create(local);
    const preview = cloud.books[0].cover;
    const bitmap = await createImageBitmap(await (await fetch(preview)).blob());
    const record = Object.entries(cloud.registers).find(
      ([key]) => JSON.parse(key)[1] === "cover",
    )[1];
    const result = {
      original: cover.length,
      thumbnail: preview.length,
      mime: preview.slice(0, 23),
      width: bitmap.width,
      height: bitmap.height,
      originalUnchanged: JSON.stringify(local) === originalJSON,
      matchingRegister: record.value === preview,
      damagedCoverOmitted: cloud.books[1].cover === null,
    };
    bitmap.close();
    return result;
  });
  assert.equal(thumbnail.originalUnchanged, true);
  assert.equal(thumbnail.matchingRegister, true);
  assert.equal(thumbnail.damagedCoverOmitted, true);
  assert.equal(thumbnail.width, 128);
  assert.equal(thumbnail.height, 192);
  assert.match(thumbnail.mime, /^data:image\/webp;base64,/);
  assert.ok(thumbnail.thumbnail < thumbnail.original / 5);

  // A failed automatic sync is visible and backs off; manual retry remains available.
  const sync = async () => {
    const previous = await page.evaluate(
      () =>
        window.calls.filter((call) => call.args?.event === "sync.end").length,
    );
    await page.evaluate(() => window.syncTick());
    await page.waitForFunction(
      (n) =>
        window.calls.filter((call) => call.args?.event === "sync.end").length >
        n,
      previous,
    );
  };
  await page.evaluate(() => (window.syncFailure = true));
  await sync();
  assert.match(
    await page.locator(".sync-error").innerText(),
    /No se pudo guardar en Drive/,
  );
  const failed = await page.evaluate(
    () => window.calls.filter((call) => call.command === "drive_sync").length,
  );
  await page.evaluate(() => {
    window.mockNow += 60000;
    window.syncTick();
  });
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.command === "drive_sync").length,
    ),
    failed,
  );
  await page.evaluate(() => {
    window.mockNow += 60000;
    window.noticeUpdates = 0;
    window.noticeObserver = new MutationObserver(
      (records) => (window.noticeUpdates += records.length),
    );
    window.noticeObserver.observe(document.querySelector("#notice"), {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });
  });
  await sync();
  assert.equal(await page.evaluate(() => window.noticeUpdates), 0);
  await page.evaluate(() => window.noticeObserver.disconnect());
  await page.evaluate(() => (window.syncFailure = false));
  await page.locator('[data-action="sync"]').click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".sync-error") ||
      document.querySelector(".sync-error").hidden,
  );

  // Small desktop width keeps every settings panel within the window.
  await page.setViewportSize({ width: 800, height: 600 });
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    window: innerWidth,
    panels: [...document.querySelectorAll(".settings-grid > .panel")].map(
      (el) => el.getBoundingClientRect().right,
    ),
  }));
  assert.ok(overflow.doc <= overflow.window);
  assert.ok(overflow.panels.every((right) => right <= overflow.window + 1));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      casesPassed: 9,
      themes: THEMES.length,
      languages: 3,
      cloudCover: thumbnail,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
