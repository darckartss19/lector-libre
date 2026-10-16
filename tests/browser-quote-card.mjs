import { installStateBridge } from "./helpers/state-bridge.mjs";
// Integrated reading tools in a fresh browser with a fake native bridge.
// No installed library, user account, audio engine or user browser is touched.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { preview } from "vite";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { CARD_PRESETS } from "../src/core/quote-card.mjs";
import { createLibrary, addBook } from "../src/core/library.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const csp = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).app
  .security.csp;
const server = await preview({
  preview: {
    host: "127.0.0.1",
    port: 0,
    headers: { "Content-Security-Policy": csp },
  },
});
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
    `<p>La casa <em>azul</em> guarda un cafÃ© y cafe\u0301. Esta idea merece una nota.</p>${filler(30)}`,
  ),
  "OEBPS/second.xhtml": chapter(
    "DespuÃ©s del camino",
    `${filler(45)}<p>Otro CAFÃ‰, al final del camino.</p>`,
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
            case "select_quote_background":
              return window.photoResult ?? null;
            case "save_quote_image":
              if (window.failSave)
                throw Error(
                  "No se pudo guardar la tarjeta. Comprueba la carpeta de destino.",
                );
              if (window.holdSave)
                return await new Promise(
                  (resolve) => (window.resolveSave = resolve),
                );
              window.exported = args.png;
              return window.saveResult === undefined ? true : window.saveResult;
            case "copy_quote_image":
              window.copied = args.png;
              return;
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
  // The same editor is available without opening or changing a book.
  await page.locator('[data-action="create-free-quote"]').click();
  const standalone = page.locator(".quote-card-dialog");
  assert.equal(await standalone.locator('[name="quote"]').inputValue(), "");
  assert.equal(await standalone.locator('[name="title"]').inputValue(), "");
  assert.equal(
    await standalone.locator('[name="attribution"]').isChecked(),
    false,
  );
  assert.equal(
    await standalone.locator("[data-quote-save]").isDisabled(),
    true,
  );
  await standalone
    .locator('[name="quote"]')
    .fill("Mis palabras.\n\nMi propio poema.");
  await standalone.locator("[data-quote-save]").click();
  await page.waitForFunction(() => !!window.exported);
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.findLast((call) => call.command === "save_quote_image")
          .args.filename,
    ),
    "Cita - Lectura.png",
  );
  await page.keyboard.press("Escape");
  await page.locator(".book-title").click();
  await page.locator(".reader-footer").waitFor();

  const contentBefore = await page.locator(".prose").textContent();
  const open = async () => {
    const tools = page.locator("[data-mobile-tools]");
    if (
      (await tools.isVisible()) &&
      (await tools.getAttribute("aria-expanded")) === "false"
    )
      await tools.click();
    await page.evaluate(() => window.selectQuote("casa azul"));
    await page.locator('[data-action="create-quote"]').click();
    await page.locator(".quote-card-dialog").waitFor();
  };
  const dialog = page.locator(".quote-card-dialog");
  const tab = (id) => dialog.locator(`[data-quote-tab="${id}"]`).click();
  const save = dialog.locator("[data-quote-save]"),
    copy = dialog.locator("[data-quote-copy]");
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator('[data-action="create-quote"]').click();
  assert.equal(await dialog.count(), 0);
  await open();
  assert.equal(
    await dialog.locator('[name="quote"]').inputValue(),
    "casa azul",
  );
  assert.equal(
    await dialog.locator('[name="title"]').inputValue(),
    "Un libro para recordar",
  );
  assert.equal(
    await dialog.locator('[name="author"]').inputValue(),
    "Autor de prueba",
  );
  assert.equal(await dialog.locator('select[name="background"]').count(), 0);
  assert.equal(await dialog.locator("[data-quote-preset]").count(), 23);
  assert.deepEqual(
    await dialog.locator("canvas").evaluate((c) => [c.width, c.height]),
    [1080, 1920],
  );
  await tab("estilo");
  await dialog.locator('[name="format"]').selectOption("square");
  assert.deepEqual(
    await dialog.locator("canvas").evaluate((c) => [c.width, c.height]),
    [1080, 1080],
  );
  await tab("texto");
  await dialog
    .locator('[name="quote"]')
    .fill("Una lectura puede guardar un instante.\n\nY dejarnos volver a él.");
  await tab("fondo");
  await dialog.locator('[data-quote-chip="Colores"]').click();
  // Colores includes eight color styles and three photographic presets.
  assert.equal(await dialog.locator("[data-quote-preset]:visible").count(), 11);
  await dialog.locator('[data-quote-preset="forest"]').press("Enter");
  assert.equal(
    await dialog
      .locator('[data-quote-preset="forest"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await tab("estilo");
  await dialog.locator('[name="font"]').selectOption("clean");
  await dialog.locator('[name="align"]').selectOption("left");
  await copy.click();
  await page.waitForFunction(() => !!window.copied);
  await save.click();
  await page.waitForFunction(() => !!window.exported);
  const image = await page.evaluate(() => window.exported);
  assert.equal(image, await page.evaluate(() => window.copied));
  const png = Buffer.from(image.split(",")[1], "base64");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1080]);
  await mkdir("work", { recursive: true });
  await writeFile("work/quote-card-example.png", png);
  // Save failure/cancel preserve the editor and allow retry, without false success.
  await page.evaluate(() => {
    window.failSave = true;
  });
  await save.click();
  await page.waitForFunction(() =>
    document.querySelector(".quote-status").textContent.includes("Comprueba"),
  );
  assert.equal(await save.isEnabled(), true);
  await page.evaluate(() => {
    window.failSave = false;
    window.saveResult = null;
  });
  await tab("texto");
  await dialog
    .locator('[name="quote"]')
    .fill("Una lectura puede guardar un instante.");
  await save.click();
  await page.waitForFunction(
    () => !document.querySelector("[data-quote-save]").disabled,
  );
  assert.equal(await dialog.locator(".quote-status").textContent(), "");
  await page.evaluate(() => {
    window.saveResult = true;
    window.holdSave = true;
  });
  await save.click();
  assert.equal(await copy.isDisabled(), true);
  const countBefore = await page.evaluate(
    () =>
      window.calls.filter((call) => call.command === "save_quote_image").length,
  );
  await save.evaluate((button) => button.click());
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.command === "save_quote_image")
          .length,
    ),
    countBefore,
  );
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 1);
  await page.evaluate(() => {
    window.holdSave = false;
    window.resolveSave(true);
  });
  await page.waitForFunction(
    () => !document.querySelector("[data-quote-save]").disabled,
  );
  // A canceled image picker retains the preset. Only local image data is accepted.
  await tab("fondo");
  await dialog.locator("[data-quote-background]").click();
  await page.waitForFunction(
    () => !document.querySelector("[data-quote-save]").disabled,
  );
  assert.equal(
    await dialog
      .locator('[data-quote-preset="forest"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 400;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffa040";
    ctx.fillRect(0, 0, 600, 400);
    window.photoResult = c.toDataURL("image/png");
  });
  await tab("fondo");
  await dialog.locator("[data-quote-background]").click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".quote-photo-controls").hidden &&
      !document.querySelector("[data-quote-save]").disabled,
  );
  assert.equal(
    await dialog.locator('[data-quote-preset][aria-pressed="true"]').count(),
    0,
  );
  assert.equal(await dialog.locator(".quote-photo-controls").isVisible(), true);
  const pixel = () =>
    dialog
      .locator("canvas")
      .evaluate((c) => [...c.getContext("2d").getImageData(5, 5, 1, 1).data]);
  const dark = await pixel();
  await dialog.locator('[name="overlay"]').selectOption("light");
  const light = await pixel();
  assert.ok(light[0] > dark[0] && light[1] > dark[1]);
  const quote = await dialog.locator('[name="quote"]').inputValue();
  await dialog.locator("[data-quote-surprise]").click();
  assert.equal(
    await dialog.locator('[data-quote-preset][aria-pressed="true"]').count(),
    1,
  );
  assert.equal(await dialog.locator('[name="quote"]').inputValue(), quote);
  assert.equal(
    await dialog.locator('[name="title"]').inputValue(),
    "Un libro para recordar",
  );
  await tab("texto");
  await dialog.locator('[name="quote"]').fill("Lectura ".repeat(4000));
  assert.equal(await save.isDisabled(), true);
  assert.equal(await copy.isDisabled(), true);
  assert.match(
    await dialog.locator(".quote-fit").textContent(),
    /demasiado largo/,
  );
  await dialog.locator('[name="quote"]').fill("");
  assert.equal(await save.isDisabled(), true);
  await dialog.locator('[name="quote"]').fill(quote);
  await page.setViewportSize({ width: 800, height: 600 });
  const bounds = await save.boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 600);
  await page.screenshot({ path: "work/quote-card-preview.png" });
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.locator(".prose").textContent(), contentBefore);
  assert.equal(await page.evaluate(() => window.saved.books.length), 1);
  assert.ok(
    !JSON.stringify(await page.evaluate(() => window.saved)).includes(
      "data:image/png",
    ),
  );
  // Each bundled background decodes under the release CSP, and export uses it.
  await open();
  for (const preset of CARD_PRESETS) {
    const response = await page.request.get(
      new URL(preset.url, server.resolvedUrls.local[0]).href,
    );
    assert.equal(response.status(), 200, preset.id);
    await dialog.locator(`[data-quote-preset="${preset.id}"]`).click();
    await page.waitForFunction(
      () => !document.querySelector("[data-quote-save]").disabled,
    );
    assert.equal(await dialog.locator(".quote-status").textContent(), "");
    await save.click();
    await page.waitForFunction(
      () => !document.querySelector("[data-quote-save]").disabled,
    );
  }
  await page.route("**/quote-backgrounds/aurora.webp", (route) =>
    route.abort(),
  );
  await dialog.locator('[data-quote-preset="aurora"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector(".quote-status")
      .textContent.includes("No se pudo cargar"),
  );
  assert.equal(await save.isDisabled(), true);
  await page.unroute("**/quote-backgrounds/aurora.webp");
  let release, finish;
  const waiting = new Promise((resolve) => (release = resolve));
  const completed = new Promise((resolve) => (finish = resolve));
  await page.route("**/quote-backgrounds/aurora.webp", async (route) => {
    await waiting;
    await route.continue();
    finish();
  });
  await dialog.locator('[data-quote-preset="aurora"]').click();
  assert.equal(await save.isDisabled(), true);
  await dialog.locator('[data-quote-preset="forest"]').click();
  assert.equal(await save.isEnabled(), true);
  release();
  await completed;
  await page.unroute("**/quote-backgrounds/aurora.webp", undefined, {
    behavior: "wait",
  });
  assert.equal(
    await dialog
      .locator('[data-quote-preset="forest"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.keyboard.press("Escape");
  // The editor keeps export controls on screen at phone, small-phone and landscape sizes.
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [844, 390],
    [1280, 850],
  ]) {
    await page.setViewportSize({ width, height });
    await open();
    const bounds = await save.boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
    assert.equal(
      await page.evaluate(() => document.body.scrollWidth > innerWidth),
      false,
    );
    await page.keyboard.press("Escape");
  }
  // Translate controls while retaining the selected passage and book metadata.
  await page.locator('.reader-header [data-action="settings"]').click();
  await page.locator('[data-preference="uiLanguage"]').selectOption("en");
  await page.locator('[data-section="all"]').click();
  await page.locator(".book-title").click();
  await open();
  assert.equal(await dialog.locator("h2").textContent(), "Create quote card");
  assert.equal(
    await dialog.locator('[name="quote"]').inputValue(),
    "casa azul",
  );
  assert.equal(
    await dialog.locator('[name="title"]').inputValue(),
    "Un libro para recordar",
  );
  assert.equal(await save.textContent(), "Save PNG");
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      casesPassed: 16,
      standalone: true,
      offlineBackgrounds: CARD_PRESETS.length,
      phoneAndDesktopLayouts: true,
      selectionAcrossMarkup: true,
      fullResolution: true,
      clipboardPayload: true,
      customPhoto: true,
      exportRecovery: true,
      noLibraryChanges: true,
      translation: true,
      errors,
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
