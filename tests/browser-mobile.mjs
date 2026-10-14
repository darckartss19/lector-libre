import assert from "node:assert/strict";
import { preview } from "vite";
import { addBook, createLibrary } from "../src/core/library.mjs";
import { documentFixtures } from "./fixtures/document-fixtures.mjs";
import { makePdf } from "./fixtures/pdf-fixtures.mjs";
import { zipSync, strToU8 } from "fflate";
import { installStateBridge } from "./helpers/state-bridge.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await preview({
  preview: { host: "127.0.0.1", port: 0 },
});
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
page.setDefaultTimeout(20000);
const errors = [],
  passed = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==";
  const documents = documentFixtures(image);
  documents.pdf = [...makePdf({ count: 12 })];
  documents.txt = [
    ...new TextEncoder().encode(
      Array.from(
        { length: 70 },
        (_, i) =>
          `Párrafo ${i}. La lectura guarda su lugar al cerrar y volver al libro.\n\n`,
      ).join(""),
    ),
  ];
  documents.epub = [
    ...zipSync({
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
      "book.opf": strToU8(
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">mobile-fixture</dc:identifier><dc:title>Lectura móvil</dc:title><dc:language>es</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
      ),
      "chapter.xhtml": strToU8(
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Lectura móvil</title></head><body>${Array.from({ length: 70 }, (_, i) => `<p>Párrafo ${i}. La biblioteca conserva el lugar al salir del lector.</p>`).join("")}</body></html>`,
      ),
    }),
  ];
  let fixture = createLibrary();
  const formats = Object.keys(documents);
  for (let i = 0; i < 30; i++)
    fixture = addBook(
      fixture,
      {
        id: (i + 1).toString(16).padStart(64, "0"),
        title: `Libro ${i + 1}`,
        format: formats[i % formats.length],
        author: "Prueba",
        genres: ["Aventura"],
      },
      i + 1,
    );
  fixture.preferences.readingMode = "vertical";
  await installStateBridge(page);
  await page.addInitScript(
    ({ initial, documents }) => {
      window.saved = initial;
      window.calls = [];
      const callbacks = new Map();
      let callbackId = 0;
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(callback) {
          callbacks.set(++callbackId, callback);
          return callbackId;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        invoke: async (command, args) => {
          window.calls.push({ command, args });
          if (command === "platform_info")
            return {
              platform: "android",
              mobile: true,
              speech: false,
              drive: false,
              imageClipboard: false,
            };
          if (command === "load_state") return structuredClone(window.saved);
          if (command === "save_state") {
            window.saved = structuredClone(args.value);
            return;
          }
          if (command === "book_availability")
            return args.books.map((b) => b.id);
          if (command === "read_book")
            return new Uint8Array(documents[args.format]).buffer;
          if (command === "speech_timer_status") return { deadline: null };
          if (command === "plugin:event|listen") return args.handler;
          if (
            ["diagnostic_event", "mobile_background", "mobile_chrome"].includes(
              command,
            )
          )
            return;
          throw new Error(`Unexpected mobile command ${command}`);
        },
      };
    },
    { initial: fixture, documents },
  );
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator(".book-card").first().waitFor();
  assert.equal(await page.locator(".book-card").count(), 24);
  assert.ok(await page.locator(".mobile-header").isVisible());
  const noOverflow = async () =>
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  await noOverflow();
  await page.locator("[data-mobile-menu]").click();
  assert.equal(
    await page.locator(".workspace").evaluate((el) => el.inert),
    true,
  );
  await page.locator(".sidebar [data-section='reading']").click();
  assert.equal(
    await page.locator(".workspace").evaluate((el) => el.inert),
    false,
  );
  await page.locator("[data-mobile-menu]").click();
  await page.locator(".sidebar [data-section='all']").click();
  passed.push("library pagination and accessible drawer");

  for (const format of formats) {
    const index = formats.indexOf(format);
    const id = (index + 1).toString(16).padStart(64, "0");
    await page.locator(`.book-title[data-open='${id}']`).click();
    await page.locator(".reader-footer").waitFor();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          ".vertical-surface img,.vertical-surface canvas,.vertical-surface .prose",
        ).length > 0,
    );
    await noOverflow();
    assert.ok(!(await page.locator(".reader-tools").isVisible()));
    await page.locator("[data-mobile-tools]").click();
    assert.ok(await page.locator(".reader-tools").isVisible());
    assert.ok(!(await page.locator('[data-action="start-audio"]').isVisible()));
    await page.locator("[data-mobile-tools]").click();
    const footer = await page.locator(".reader-footer").boundingBox();
    assert.ok(footer.y + footer.height <= 844);
    assert.ok(
      await page
        .locator(".reading-pane")
        .evaluate((el) => el.clientHeight >= 350),
    );
    if (format === "pdf")
      assert.ok(
        await page
          .locator("canvas")
          .first()
          .evaluate((el) => el.width * el.height <= 3_000_000),
      );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("reader-mobile-pause")),
    );
    await page.waitForFunction(
      (id) =>
        window.saved.books.some((b) => b.id === id && b.lastReadAt !== null),
      id,
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("reader-mobile-back")),
    );
    await page.locator(".library-header").waitFor();
    passed.push(`${format} reading and background checkpoint`);
  }
  await page.locator("[data-mobile-menu]").click();
  await page.locator('.sidebar [data-action="settings"]').click();
  assert.ok(!(await page.locator('[data-action="connect-google"]').count()));
  assert.ok(!(await page.locator('[data-action="refresh-voices"]').count()));
  await noOverflow();
  await page.locator('[data-preference="theme"]').selectOption("midnight");
  await page.waitForFunction(() =>
    window.calls.some(
      ({ command, args }) =>
        command === "mobile_chrome" &&
        args.background === "#0c1320" &&
        args.darkIcons === false,
    ),
  );
  await page.locator('[data-preference="theme"]').selectOption("light");
  await page.waitForFunction(() =>
    window.calls.some(
      ({ command, args }) =>
        command === "mobile_chrome" &&
        args.background === "#eeeee5" &&
        args.darkIcons === true,
    ),
  );
  await page.locator('[data-preference="uiLanguage"]').selectOption("en");
  assert.equal(
    await page.locator("[data-mobile-menu]").getAttribute("aria-label"),
    "Open menu",
  );
  await noOverflow();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("reader-mobile-back")),
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await noOverflow();
  assert.ok(await page.locator(".mobile-header").isVisible());
  const landscapeHeader = await page.locator(".mobile-header").boundingBox();
  assert.ok(landscapeHeader.height <= 56);
  const firstCover = await page
    .locator(".books.covers .book-card")
    .first()
    .boundingBox();
  assert.ok(firstCover.width < 200 && firstCover.width >= 140);
  await page.setViewportSize({ width: 360, height: 640 });
  await noOverflow();
  await page.screenshot({ path: "work/mobile-library-preview.png" });
  passed.push("settings, languages, landscape and narrow screens");
  assert.deepEqual(errors, []);
  assert.ok(
    !(await page.evaluate(() =>
      window.calls.some((c) =>
        ["drive_config", "speech_command", "neural_catalog"].includes(
          c.command,
        ),
      ),
    )),
  );
  console.log(JSON.stringify({ passed, errors }));
} catch (error) {
  await page.screenshot({ path: "work/mobile-test-failure.png" });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
