import assert from "node:assert/strict";
import { preview } from "vite";
import { addBook, createLibrary } from "../src/core/library.mjs";
import { installStateBridge } from "./helpers/state-bridge.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const initial = addBook(createLibrary(), {
    id: "a".repeat(64),
    title: "Prueba Android",
    format: "txt",
    language: "es",
  });
  await installStateBridge(page);
  await page.addInitScript(
    ({ initial }) => {
      window.saved = initial;
      window.calls = [];
      window.audio = { hasProgram: false, status: "idle" };
      let callbackId = 0;
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => ++callbackId,
        unregisterCallback: () => {},
        invoke: async (command, args) => {
          window.calls.push({ command, args });
          if (command === "platform_info")
            return {
              platform: "android",
              mobile: true,
              speech: true,
              drive: true,
              imageClipboard: true,
            };
          if (command === "load_state") return structuredClone(window.saved);
          if (command === "save_state") {
            window.saved = structuredClone(args.value);
            return;
          }
          if (command === "book_availability")
            return args.books.map((book) => book.id);
          if (command === "read_book")
            return new TextEncoder().encode(
              "Primera frase. Segunda frase.\n\nUn párrafo para escuchar y compartir.",
            ).buffer;
          if (command === "drive_config")
            return { configured: true, connected: false };
          if (command === "speech_command" && args.command.action === "voices")
            return [
              {
                id: "android:offline",
                name: "Español",
                language: "es-ES",
                installed: true,
              },
            ];
          if (command === "neural_catalog") return [];
          if (command === "mobile_speech") {
            const action = args.command.action;
            if (action === "notificationPermission") return { granted: true };
            if (action === "program")
              window.audio = {
                ...args.command,
                chapter: args.command.chapters[0].id,
                offset: 0,
                hasProgram: true,
                status: "playing",
                previewing: false,
              };
            if (action === "pause") window.audio.status = "paused";
            if (action === "resume") window.audio.status = "playing";
            if (action === "stop") {
              window.audio.status = "idle";
              window.audio.hasProgram = false;
            }
            if (action === "timer") window.audio.sleepMode = args.command.mode;
            return structuredClone(window.audio);
          }
          if (command === "mobile_scan") {
            if (args.command.action === "scan")
              return {
                files: Array.from({ length: 205 }, (_, i) => ({
                  key: String(i),
                  name:
                    i === 0
                      ? '<img src=x onerror="throw Error()">.pdf'
                      : `Libro ${i}.epub`,
                  format: i === 0 ? "pdf" : "epub",
                  size: 42,
                  location: "Documentos / Novelas",
                })),
                sources: [{ name: "Documentos" }],
              };
            return { sources: [{ name: "Documentos" }] };
          }
          if (
            [
              "copy_quote_image",
              "share_quote_image",
              "diagnostic_event",
              "mobile_chrome",
              "mobile_background",
            ].includes(command)
          )
            return {};
          if (command === "plugin:event|listen") return args.handler;
          throw new Error(`Unexpected command ${command}`);
        },
      };
    },
    { initial },
  );
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator(".book-card").first().waitFor();
  await page.locator(".mobile-header [data-action='import']").click();
  await page.locator('[data-scan="search"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-scan-key]").length === 100,
  );
  assert.equal(await page.locator(".scan-files img").count(), 0);
  await page.locator('[data-scan="next"]').click();
  assert.equal(await page.locator('[data-scan-key="100"]').count(), 1);
  await page.locator(".scan-filter").fill("Libro 204");
  assert.equal(await page.locator("[data-scan-key]").count(), 1);
  await page.locator('[data-scan="all"]').click();
  assert.equal(
    await page.locator('[data-scan="import"]').textContent(),
    "Importar seleccionados (1)",
  );
  await page.locator('[data-scan="close"]').click();
  await page.locator("[data-mobile-menu]").click();
  await page.locator('.sidebar [data-action="settings"]').click();
  assert.equal(
    await page.locator('[data-action="drive-config"]').isVisible(),
    false,
  );
  assert.equal(
    await page.locator('[data-action="drive-connect"]').isEnabled(),
    true,
  );
  assert.equal(
    await page.locator('[data-action="voice-settings"]').isVisible(),
    true,
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("reader-mobile-back")),
  );
  await page.locator(".book-title").first().click();
  await page.locator("[data-mobile-tools]").click();
  await page.locator('[data-action="start-audio"]').click();
  await page.waitForFunction(() =>
    window.calls.some(
      (call) =>
        call.command === "mobile_speech" &&
        call.args.command.action === "program",
    ),
  );
  assert.equal(
    await page.locator('[data-action="pause-audio"]').textContent(),
    "Pausar",
  );
  await page.locator('[data-action="pause-audio"]').click();
  assert.equal(
    await page.locator('[data-action="pause-audio"]').textContent(),
    "Continuar",
  );
  await page.locator('[data-action="pause-audio"]').click();
  await page.locator("#sleep-timer").selectOption("chapter");
  await page.locator('[data-action="stop-audio"]').click();
  assert.equal(await page.locator(".audio-bar").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      window.calls.some(
        (call) =>
          call.command === "speech_command" &&
          call.args.command.action === "speak",
      ),
    ),
    false,
  );
  await page.evaluate(() => {
    const paragraph = document.querySelector(".prose p");
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator('[data-action="create-quote"]').click();
  await page.locator("[data-quote-share]").click();
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "share_quote_image"),
  );
  await page.locator("[data-quote-copy]").click();
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === "copy_quote_image"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS Android scanner pagination, filtering, escaping and selection; Drive and offline voice settings; native audio start/pause/resume/timer/stop.",
  );
} finally {
  await browser.close();
  await server.httpServer.close();
}
