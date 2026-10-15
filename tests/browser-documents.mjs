import assert from "node:assert/strict";
import { createServer, preview } from "vite";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { documentFixtures } from "./fixtures/document-fixtures.mjs";
import { makePdf } from "./fixtures/pdf-fixtures.mjs";
import { addBook, createLibrary } from "../src/core/library.mjs";
import { installStateBridge } from "./helpers/state-bridge.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const csp = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).app
  .security.csp;
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
page.setDefaultTimeout(20000);
const errors = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => requests.push(request.url()));
const passed = [];
let production;
try {
  await page.route(`${origin}__documents`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><head><meta charset='utf-8'></head><body>Document fixtures</body></html>",
    }),
  );
  await page.goto(`${origin}__documents`);
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 420;
    const context = canvas.getContext("2d");
    context.fillStyle = "#16506a";
    context.fillRect(0, 0, 300, 420);
    context.fillStyle = "#fff";
    context.font = "30px serif";
    context.fillText("Lectura", 40, 180);
    return canvas.toDataURL("image/png");
  });
  const documents = documentFixtures(image);
  documents.pdf = [...makePdf({ count: 30 })];
  const results = await page.evaluate(async (documents) => {
    const { parseDocument } = await import("/src/core/document.mjs");
    const { searchBook } = await import("/src/core/reader-tools.mjs");
    const result = [];
    for (const [format, source] of Object.entries(documents)) {
      const bytes = new Uint8Array(source),
        meta = await parseDocument(bytes.slice(), format, "Fixture", {
          metadataOnly: true,
        });
      const book = await parseDocument(bytes.slice(), format, "Fixture", {
        lazy: true,
      });
      const initial = book.loadedCount?.();
      await book.ensureChapter?.(book.chapters.length - 1);
      const last = book.chapters.at(-1),
        html = last.html;
      for (let index = 0; index < Math.min(7, book.chapters.length); index++)
        await book.ensureChapter?.(index);
      const speech = await book.allChapters({ textOnly: true });
      const matches = [];
      await book.visitChapters((chapter, index) => {
        if (searchBook([chapter], "café y música").length) matches.push(index);
      });
      result.push({
        format,
        title: meta.title,
        author: meta.author,
        language: meta.language,
        metaChapters: meta.chapters.length,
        cover: !!meta.cover,
        count: book.chapters.length,
        initial,
        bounded: book.loadedCount(),
        hasText: book.hasText,
        html,
        matches,
        speech: speech.map((ch) => ({ text: ch.text, hasHtml: "html" in ch })),
        ids: book.chapters.map((ch) => ch.id),
      });
      await book.dispose();
    }
    const invalid = [];
    for (const format of ["fb2", "docx", "odt", "cbz"]) {
      try {
        await parseDocument(new TextEncoder().encode("damaged"), format, "bad");
      } catch {
        invalid.push(format);
      }
    }
    try {
      await parseDocument(
        new TextEncoder().encode(
          '<!DOCTYPE FictionBook [<!ENTITY x "bad">]><FictionBook/>',
        ),
        "fb2",
        "bad",
      );
    } catch {
      invalid.push("xml-entity");
    }
    return { result, invalid, executed: !!window.documentExecuted };
  }, documents);
  for (const result of results.result) {
    assert.equal(result.metaChapters, 0);
    assert.equal(result.initial, 0);
    assert.ok(result.bounded <= 4);
    if (result.format !== "pdf") {
      if (result.format !== "md")
        assert.equal(result.author, "Ana Pérez", result.format);
      if (result.format !== "md")
        assert.equal(result.language, "es", result.format);
    }
    assert.ok(result.speech.every((ch) => !ch.hasHtml));
    assert.doesNotMatch(
      result.html,
      /script|onclick|onerror|example.invalid|javascript:/i,
    );
    if (result.format !== "cbz" && result.format !== "pdf")
      assert.ok(result.matches.length >= 8, result.format);
    if (result.format === "cbz") {
      assert.equal(result.count, 20);
      assert.equal(result.hasText, false);
      assert.match(result.ids[1], /page-2/);
      assert.match(result.ids[9], /page-10/);
    }
  }
  assert.deepEqual(results.invalid, [
    "fb2",
    "docx",
    "odt",
    "cbz",
    "xml-entity",
  ]);
  assert.equal(results.executed, false);
  assert.equal(
    requests.some((url) => url.includes("example.invalid")),
    false,
  );
  passed.push(
    "Six new formats: structured text, images, metadata, bounded chapters, text-only voice and inert links",
  );
  passed.push(
    "Invalid archives/XML and external resource references never execute or fetch content",
  );

  const epubEntries = {
    "META-INF/container.xml": strToU8(
      '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    ),
    "book.opf": strToU8(
      `<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Vertical EPUB</dc:title><dc:language>es</dc:language></metadata><manifest>${Array.from({ length: 8 }, (_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${Array.from({ length: 8 }, (_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`,
    ),
  };
  for (let i = 0; i < 8; i++)
    epubEntries[`c${i}.xhtml`] = strToU8(
      `<html><head><title>Chapter ${i}</title></head><body><h1>Chapter ${i}</h1>${"<p>Una lectura continua con varios párrafos.</p>".repeat(30)}</body></html>`,
    );
  documents.epub = [...zipSync(epubEntries)];
  documents.txt = [
    ...strToU8("Una lectura continua con varios párrafos.\n\n".repeat(500)),
  ];
  let fixture = createLibrary();
  fixture.preferences = {
    ...fixture.preferences,
    readingMode: "vertical",
    theme: "midnight",
  };
  const keys = {
    fb2: "a",
    docx: "b",
    odt: "c",
    html: "d",
    md: "e",
    cbz: "f",
    pdf: "9",
    epub: "8",
    txt: "7",
  };
  for (const [format, key] of Object.entries(keys))
    fixture = addBook(
      fixture,
      { id: key.repeat(64), title: `Document ${format}`, format },
      1,
    );
  await installStateBridge(page, { platform: "windows" });
  await page.addInitScript(
    ({ fixture, documents, keys }) => {
      window.saved =
        JSON.parse(sessionStorage.getItem("documents-library") || "null") ||
        fixture;
      window.calls = [];
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: () => 1,
        invoke: async (command, args) => {
          window.calls.push(command);
          if (command === "load_state") return structuredClone(window.saved);
          if (command === "save_state") {
            window.saved = structuredClone(args.value);
            sessionStorage.setItem(
              "documents-library",
              JSON.stringify(window.saved),
            );
            return;
          }
          if (command === "book_availability")
            return args.books.map((book) => book.id);
          if (command === "read_book")
            return new Uint8Array(
              documents[
                Object.entries(keys).find(([, key]) => args.id[0] === key)[0]
              ],
            ).buffer;
          if (command === "drive_config")
            return { configured: false, connected: false };
          if (command === "speech_command" || command === "neural_catalog")
            return [];
          if (command === "speech_timer_status") return {};
          return null;
        },
      };
    },
    { fixture, documents, keys },
  );
  production = await preview({
    preview: {
      host: "127.0.0.1",
      port: 0,
      headers: { "Content-Security-Policy": csp },
    },
  });
  await page.goto(production.resolvedUrls.local[0]);
  for (const format of Object.keys(keys)) {
    await page
      .locator(`.book-title[data-open="${keys[format].repeat(64)}"]`)
      .click();
    await page
      .locator(".vertical-slot .prose,.vertical-slot canvas")
      .first()
      .waitFor();
    const selector = page.locator("#chapter");
    await selector.selectOption(
      format === "txt" ? "0" : format === "cbz" || format === "pdf" ? "9" : "4",
    );
    await page
      .waitForFunction(
        (index) => document.querySelector("#chapter").value === String(index),
        format === "txt" ? 0 : format === "cbz" || format === "pdf" ? 9 : 4,
      )
      .catch(async (error) => {
        console.log(
          await page.locator(".vertical-reading-pane").evaluate((pane) => ({
            value: document.querySelector("#chapter").value,
            top: pane.scrollTop,
            height: pane.clientHeight,
            slots: [...pane.children].map((slot) => ({
              index: slot.dataset.verticalIndex,
              top: slot.offsetTop,
              height: slot.offsetHeight,
              children: slot.childElementCount,
            })),
          })),
        );
        await page.screenshot({ path: "work/vertical-failure.png" });
        throw error;
      });
    await page.waitForTimeout(450);
    if (format === "txt")
      await page.locator(".vertical-reading-pane").evaluate((pane) => {
        pane.scrollTop = 1000;
      });
    assert.ok((await page.locator(".vertical-surface").count()) <= 5);
    const frame = await page
      .locator(".vertical-slot .prose,.vertical-slot canvas")
      .first()
      .evaluate((node) => ({
        border: getComputedStyle(node).borderRadius,
        shadow: getComputedStyle(node).boxShadow,
      }));
    assert.equal(frame.shadow, "none");
    assert.equal(frame.border, "0px");
    if (format === "pdf") {
      const quote = await page
        .locator('[data-vertical-index="9"] .textLayer span')
        .first()
        .evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
          return selection.toString();
        });
      await page.locator('[data-action="create-quote"]').click();
      assert.equal(
        await page.locator('textarea[name="quote"]').inputValue(),
        quote,
      );
      await page.locator("[data-quote-close]").first().click();
    }
    if (format === "cbz") {
      assert.equal(
        await page.locator('[data-action="start-audio"]').isDisabled(),
        true,
      );
      await page.locator('[data-action="create-quote"]').click();
      await page.locator("dialog").waitFor();
      await page.locator("[data-quote-close]").first().click();
    }
    await page.locator('[data-action="back"]').click();
    await page.locator(".book-title").first().waitFor();
    const saved = await page.evaluate(
      (key) => window.saved.books.find((book) => book.id === key.repeat(64)),
      keys[format],
    );
    assert.ok(saved.progress > 0);
    assert.ok(saved.locator.chapter);
  }
  passed.push(
    "Borderless vertical reading across all formats: five mounted surfaces, chapter jumps, PDF text layer and saved progress",
  );
  await page.locator(`.book-title[data-open="${keys.cbz.repeat(64)}"]`).click();
  await page.locator(".vertical-slot img").first().waitFor();
  await page.reload();
  await page.locator(`.book-title[data-open="${keys.cbz.repeat(64)}"]`).click();
  await page.waitForFunction(
    () => document.querySelector("#chapter")?.value === "9",
  );
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(300);
  await page.waitForFunction(
    () => document.querySelector("#chapter")?.value === "9",
  );
  const dimensions = await page
    .locator(".vertical-reading-pane")
    .evaluate((pane) => ({
      width: pane.clientWidth,
      scroll: pane.scrollWidth,
    }));
  assert.ok(dimensions.scroll <= dimensions.width + 1);
  await page.locator(".vertical-reading-pane").evaluate((pane) => {
    pane.scrollTop = pane.querySelector('[data-vertical-index="14"]').offsetTop;
  });
  await page.waitForFunction(
    () => document.querySelector("#chapter")?.value === "14",
  );
  assert.ok((await page.locator(".vertical-surface").count()) <= 5);
  await page.locator("#chapter").selectOption("19");
  await page.locator(".vertical-reading-pane").evaluate((pane) => {
    pane.scrollTop = pane.scrollHeight;
  });
  await page.waitForFunction(
    () => Number(document.querySelector("#book-progress").value) === 100,
  );
  passed.push(
    "Continuous comic position survives restart/resize, scrolling updates progress, book end reaches 100% and the narrow view has no horizontal overflow",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed,
      results: results.result.map(({ format, count, bounded, cover }) => ({
        format,
        count,
        bounded,
        cover,
      })),
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
  await production?.httpServer.close();
}
