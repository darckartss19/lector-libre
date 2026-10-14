import { installStateBridge } from "./helpers/state-bridge.mjs";
import assert from "node:assert/strict";
import { preview } from "vite";
import { readFileSync } from "node:fs";
import { makePdf } from "./fixtures/pdf-fixtures.mjs";
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
const url = server.resolvedUrls.local[0];
const documents = {
  a: [...makePdf()],
  b: [...makePdf({ scanned: true })],
  c: [...makePdf({ password: "fixture-password" })],
  d: [...new TextEncoder().encode("Un libro de texto conservado.")],
  e: [...new TextEncoder().encode("PDF dañado")],
};
let fixture = createLibrary();
for (const [letter, title, format] of [
  ["a", "PDF normal", "pdf"],
  ["b", "PDF escaneado", "pdf"],
  ["c", "PDF protegido", "pdf"],
  ["d", "Libro TXT", "txt"],
  ["e", "PDF dañado", "pdf"],
])
  fixture = addBook(
    fixture,
    { id: letter.repeat(64), title, author: "Prueba", genres: [], format },
    1,
  );
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.setDefaultTimeout(12000);
const errors = [],
  violations = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => requests.push(r.url()));
await installStateBridge(page);
await page.addInitScript(
  ({ fixture, documents }) => {
    let id = 0;
    const callbacks = new Map();
    window.saved = fixture;
    window.calls = [];
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.cspViolations.push([e.violatedDirective, e.blockedURI]),
    );
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: (cb) => {
        callbacks.set(++id, cb);
        return id;
      },
      invoke: async (command, args) => {
        window.calls.push({ command, args });
        if (command === "load_state") return structuredClone(window.saved);
        if (command === "save_state") {
          window.saved = structuredClone(args.value);
          return;
        }
        if (command === "book_availability") return args.books.map((b) => b.id);
        if (command === "read_book")
          return new Uint8Array(documents[args.id[0]]).buffer;
        if (command === "import_files")
          return [
            {
              id: "f".repeat(64),
              name: "muestra.pdf",
              filename: "muestra.pdf",
              format: "pdf",
            },
            { id: "g".repeat(64), filename: "protegido.pdf", format: "pdf" },
            { id: "e".repeat(64), filename: "dañado.pdf", format: "pdf" },
          ];
        if (command === "drive_config")
          return {
            configured: false,
            connected: false,
            booksEnabled: false,
            canImport: false,
          };
        if (command === "neural_catalog") return [];
        if (command === "speech_command")
          return args.command.action === "voices"
            ? [
                {
                  id: "test:es",
                  name: "Prueba",
                  language: "es-ES",
                  engine: "windows",
                },
              ]
            : null;
        if (command === "speech_timer_status" || command === "speech_timer")
          return { deadline: null };
        if (command === "diagnostic_event") return;
        if (command === "plugin:event|listen") return args.handler;
        throw Error("Unexpected command " + command);
      },
    };
    documents.f = documents.a;
    documents.g = documents.c;
    const interval = window.setInterval;
    window.setInterval = (cb, ms, ...args) =>
      ms === 60000 ? 1 : interval(cb, ms, ...args);
  },
  { fixture, documents },
);
const passed = [];
let current = "bootstrap";
const open = async (letter) => {
  await page.locator(`.book-title[data-open="${letter.repeat(64)}"]`).click();
};
const canvas = async () => {
  await page.locator(".pdf-pages canvas").first().waitFor();
  await page.waitForFunction(
    () => document.querySelector(".pdf-pages canvas")?.width > 0,
  );
};
const back = async () => {
  await page.locator('[data-action="back"]').click();
  await page.locator(".books").waitFor();
};
try {
  await page.goto(url);
  await page.waitForFunction(() =>
    window.calls.some((c) => c.command === "neural_catalog"),
  );
  current = "original pages, local fonts and saved progress";
  await open("a");
  await canvas();
  assert.equal(await page.locator("#chapter option").count(), 5);
  assert.ok(
    await page
      .locator("canvas")
      .first()
      .evaluate((c) => {
        const p = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let colored = 0;
        for (let i = 0; i < p.length; i += 4)
          if (p[i] < 220 && p[i + 2] > p[i] + 30) colored++;
        return colored > 100;
      }),
  );
  await page.locator('[data-chapter-step="1"]').click();
  await canvas();
  assert.equal(await page.locator("#chapter").inputValue(), "1");
  await page.locator("#pdf-zoom").selectOption("2");
  await canvas();
  await page.locator(".reading-pane").evaluate((p) => (p.scrollTop = 200));
  await page.waitForFunction(() => window.saved.books[0].locator?.fraction > 0);
  await back();
  const position = await page.evaluate(() => window.saved.books[0].locator);
  await open("a");
  await canvas();
  assert.equal(await page.locator("#chapter").inputValue(), "1");
  await page.waitForFunction(
    (f) =>
      Math.abs(
        document.querySelector(".reading-pane").scrollTop /
          (document.querySelector(".reading-pane").scrollHeight -
            document.querySelector(".reading-pane").clientHeight) -
          f,
      ) < 0.02,
    position.fraction,
  );
  const width = await page
    .locator("canvas")
    .first()
    .evaluate((c) => c.width);
  await page.locator('[data-action="pdf-rotate"]').click();
  await canvas();
  assert.notEqual(
    await page
      .locator("canvas")
      .first()
      .evaluate((c) => c.width),
    width,
  );
  passed.push(current);
  current = "spread bounds, footer and progress";
  await page.locator("#pdf-zoom").selectOption("fit-page");
  await page.locator("#chapter").selectOption("0");
  await page.locator("#pdf-layout").selectOption("spread");
  await canvas();
  await page.waitForFunction(
    () => document.querySelectorAll(".pdf-pages canvas").length === 2,
  );
  await page.locator('[data-chapter-step="1"]').click();
  await canvas();
  assert.equal(await page.locator("#chapter").inputValue(), "2");
  await page.locator('[data-chapter-step="1"]').click();
  await canvas();
  assert.equal(await page.locator("#chapter").inputValue(), "4");
  assert.equal(
    await page.locator('[data-chapter-step="1"]').isDisabled(),
    true,
  );
  await page.waitForFunction(
    () => document.querySelector("#book-progress").value === 100,
  );
  await page.locator('[data-chapter-step="-1"]').click();
  await canvas();
  assert.equal(await page.locator("#chapter").inputValue(), "2");
  const footer = await page.locator(".reader-footer").boundingBox();
  assert.ok(footer.y + footer.height <= 1001);
  passed.push(current);
  current =
    "original PDF text selects directly and quote cards retain the selection";
  await page.locator("#chapter").selectOption("0");
  await canvas();
  await page.locator(".pdf-pages .textLayer span").first().waitFor();
  const span = page.locator(".pdf-pages .textLayer span").first();
  const bounds = await span.boundingBox();
  const sheet = await page.locator(".pdf-pages canvas").first().boundingBox();
  assert.ok(bounds.x >= sheet.x - 2 && bounds.y >= sheet.y - 2);
  assert.ok(bounds.x + bounds.width <= sheet.x + sheet.width + 2);
  assert.ok(bounds.y + bounds.height <= sheet.y + sheet.height + 2);
  // Exercise a real pointer selection after page rotation, not only DOM ranges.
  const vertical = bounds.height > bounds.width;
  await page.mouse.move(
    bounds.x + (vertical ? bounds.width / 2 : 1),
    bounds.y + (vertical ? 1 : bounds.height / 2),
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + (vertical ? bounds.width / 2 : bounds.width - 1),
    bounds.y + (vertical ? bounds.height - 1 : bounds.height / 2),
    { steps: 12 },
  );
  await page.mouse.up();
  assert.match(await page.evaluate(() => getSelection().toString()), /gina/);
  const exactQuote = await page
    .locator(".pdf-pages .textLayer")
    .first()
    .evaluate((layer) => {
      const spans = [...layer.querySelectorAll("span")].filter(
        (span) => span.firstChild?.nodeType === Node.TEXT_NODE,
      );
      const range = document.createRange();
      range.setStart(spans[0].firstChild, 0);
      range.setEnd(spans.at(-1).firstChild, spans.at(-1).textContent.length);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString().trim();
    });
  assert.ok(exactQuote);
  await page.locator('[data-action="create-quote"]').click();
  assert.equal(
    await page.locator('.quote-card-dialog [name="quote"]').inputValue(),
    exactQuote,
  );
  assert.equal(
    await page.locator(".quote-card-dialog [data-quote-save]").isEnabled(),
    true,
  );
  await page.keyboard.press("Escape");
  passed.push(current);
  current = "search switches to extracted text, notes and voice";
  await page.locator('[data-action="book-search"]').click();
  await page.locator("#reader-search").fill("Señal");
  await page.locator("[data-search-result]").first().click();
  assert.equal(await page.locator("#pdf-view").inputValue(), "text");
  assert.ok(
    (await page.locator(".prose").textContent()).includes("Señal del camino."),
  );
  await page.keyboard.press("Escape");
  await page.locator(".prose").evaluate((prose) => {
    const node = prose.querySelector("p")?.firstChild;
    if (!node) throw Error("Missing PDF selection");
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.locator('[data-action="create-quote"]').click();
  await page.locator(".quote-card-dialog").waitFor();
  assert.ok(
    (
      await page.locator('.quote-card-dialog [name="quote"]').inputValue()
    ).trim(),
  );
  assert.equal(
    await page.locator(".quote-card-dialog [data-quote-save]").isEnabled(),
    true,
  );
  await page.keyboard.press("Escape");
  await page.locator('[data-action="audio-from-here"]').click();
  await page.waitForFunction(() =>
    window.calls.some(
      (c) =>
        c.command === "speech_command" && c.args.command.action === "speak",
    ),
  );
  assert.ok(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.command === "speech_command" &&
          c.args.command.action === "speak" &&
          JSON.stringify(c.args).includes("Señal"),
      ),
    ),
  );
  await page.locator('[data-action="stop-audio"]').click();
  await page.locator('[data-action="book-notes"]').click();
  await page.locator('[data-action="add-bookmark"]').click();
  await page.locator('dialog [name="label"]').fill("PDF marcado");
  await page.locator('dialog button[value="save"]').click();
  await page.waitForFunction(() =>
    window.saved.books[0].annotations?.some((n) => n.label === "PDF marcado"),
  );
  passed.push(current);
  current = "scanned and mixed pages remain visible, OCR not implied";
  await page.locator("#pdf-view").selectOption("original");
  await back();
  await open("b");
  await canvas();
  assert.equal(
    await page.locator('[data-action="start-audio"]').isDisabled(),
    true,
  );
  assert.equal(
    await page
      .locator('#pdf-view option[value="text"]')
      .evaluate((o) => o.disabled),
    true,
  );
  assert.match(
    await page.locator(".pdf-text-notice").textContent(),
    /reconocimiento/,
  );
  passed.push(current);
  current =
    "scanned PDF quote cards accept manually transcribed text without OCR";
  await page.locator('[data-action="create-quote"]').click();
  assert.equal(
    await page.locator('.quote-card-dialog [name="quote"]').inputValue(),
    "",
  );
  assert.equal(
    await page.locator(".quote-card-dialog [data-quote-save]").isDisabled(),
    true,
  );
  assert.match(
    await page.locator(".quote-card-dialog").textContent(),
    /escaneo/,
  );
  await page
    .locator('.quote-card-dialog [name="quote"]')
    .fill("Una cita transcrita de esta página.");
  assert.equal(
    await page.locator(".quote-card-dialog [data-quote-save]").isEnabled(),
    true,
  );
  await page.keyboard.press("Escape");
  passed.push(current);
  current = "PDF passwords retry, cancel and never persist";
  await back();
  await open("c");
  await page.locator('[name="pdfPassword"]').fill("wrong");
  await page.locator('dialog button[type="submit"]').click();
  await page
    .getByText("La contraseña no es correcta. Inténtalo otra vez.")
    .waitFor();
  await page.locator('[name="pdfPassword"]').fill("fixture-password");
  await page.locator('dialog button[type="submit"]').click();
  await canvas();
  assert.ok(
    !(await page.evaluate(() => JSON.stringify(window.saved))).includes(
      "fixture-password",
    ),
  );
  await back();
  await open("c");
  await page.locator("[data-password-cancel]").click();
  await page.waitForFunction(() => !document.querySelector("dialog"));
  await page.locator('.book-title[data-open="' + "d".repeat(64) + '"]').click();
  await page.locator(".prose").waitFor();
  assert.match(await page.locator(".prose").textContent(), /conservado/);
  passed.push(current);
  current = "bad PDF is recoverable and local PDF import retains metadata";
  await back();
  await open("e");
  await page.waitForFunction(() =>
    document.querySelector("#notice").textContent.includes("No se pudo"),
  );
  assert.ok(await page.locator(".books").count());
  await page.locator('[data-action="import"]').first().click();
  await page.waitForFunction(() => window.saved.books.length === 7);
  assert.equal(await page.locator("dialog").count(), 0);
  assert.equal(
    await page.evaluate(
      () => window.saved.books.find((b) => b.id[0] === "g").title,
    ),
    "protegido.pdf",
  );
  assert.equal(
    await page.evaluate(
      () => window.saved.books.find((b) => b.id[0] === "f").title,
    ),
    "Lectura PDF de prueba",
  );
  assert.equal(
    await page.evaluate(
      () => window.saved.books.find((b) => b.id[0] === "f").author,
    ),
    "Autora de prueba",
  );
  assert.ok(
    await page.evaluate(() =>
      window.saved.books
        .find((b) => b.id[0] === "f")
        .cover.startsWith("data:image/webp"),
    ),
  );
  passed.push(current);
  current = "localized PDF controls and narrow native-size viewport";
  await open("f");
  await canvas();
  await page.locator('[data-action="settings"]').last().click();
  await page.locator('[data-preference="uiLanguage"]').selectOption("en");
  await page.locator('[data-action="resume-reading"]').click();
  await canvas();
  assert.equal(
    await page.locator('#pdf-view option[value="original"]').textContent(),
    "Original layout",
  );
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForFunction(
    () => document.querySelectorAll(".pdf-pages canvas").length === 1,
  );
  const smallFooter = await page.locator(".reader-footer").boundingBox();
  assert.ok(smallFooter.y + smallFooter.height <= 601);
  assert.ok(
    await page.locator(".reading-pane").evaluate((p) => p.clientHeight > 20),
  );
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".pdf-pages canvas").length === 2,
  );
  passed.push(current);
  violations.push(...(await page.evaluate(() => window.cspViolations)));
  assert.deepEqual(violations, []);
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every(
      (r) =>
        r.startsWith(url) || r.startsWith("blob:") || r.startsWith("data:"),
    ),
  );
  passed.push("production CSP and completely local renderer resources");
  await page.screenshot({ path: "work/pdf-reader-preview.png" });
  console.log(JSON.stringify({ passed }));
} catch (e) {
  await page.screenshot({ path: "work/pdf-reader-failure.png" });
  console.error(
    JSON.stringify({
      current,
      errors,
      violations,
      notices: await page.locator("#notice").textContent(),
      details: await page.evaluate(() => ({
        saved: window.saved.books[0].locator,
        pane: document.querySelector(".reading-pane") && {
          top: document.querySelector(".reading-pane").scrollTop,
          height: document.querySelector(".reading-pane").scrollHeight,
          client: document.querySelector(".reading-pane").clientHeight,
        },
        chapter: document.querySelector("#chapter")?.value,
      })),
    }),
  );
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
