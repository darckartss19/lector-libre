import assert from "node:assert/strict";
import { preview } from "vite";
import { createLibrary } from "../src/core/library.mjs";
import { installStateBridge } from "./helpers/state-bridge.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const passed = [];
const book = {
  key: "one",
  name: "Novela.epub",
  format: "epub",
  size: 100,
  location: "Libros / Novelas",
};
const root = { name: "Libros", readable: true };
const authorized = { sources: [root], scopedStorage: true, needsFolder: false };
const missing = {
  sources: [],
  scopedStorage: true,
  needsFolder: true,
  files: [],
};

async function scenario(name, responses, check) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installStateBridge(page);
  await page.addInitScript(
    ({ initial, responses }) => {
      window.saved = initial;
      window.scanCalls = [];
      window.scanResponses = responses;
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command, args) => {
          if (command === "platform_info")
            return {
              platform: "android",
              mobile: true,
              drive: false,
              speech: false,
            };
          if (command === "load_state") return structuredClone(window.saved);
          if (command === "book_availability") return [];
          if (command === "speech_timer_status") return { deadline: null };
          if (command === "plugin:event|listen") return args.handler;
          if (
            ["diagnostic_event", "mobile_chrome", "mobile_background"].includes(
              command,
            )
          )
            return;
          if (command === "mobile_scan") {
            const action = args.command.action;
            window.scanCalls.push(action);
            if (action === "cancel") return {};
            const result = window.scanResponses[action]?.shift();
            if (!result) throw new Error(`Unexpected scanner action ${action}`);
            if (result.error) throw new Error(result.error);
            return structuredClone(result);
          }
          throw new Error(`Unexpected command ${command}`);
        },
      };
    },
    { initial: createLibrary(), responses },
  );
  try {
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('.mobile-header [data-action="import"]').click();
    await page.waitForFunction(() => window.scanCalls.includes("sources"));
    await check(page);
    assert.deepEqual(errors, []);
    passed.push(name);
  } finally {
    await page.close();
  }
}

try {
  await scenario(
    "first search asks for a folder and scans it immediately",
    {
      sources: [missing],
      scan: [missing, { ...authorized, files: [book] }],
      folder: [authorized],
    },
    async (page) => {
      await page.locator('[data-scan="search"]').click();
      await page.locator('[data-scan-key="one"]').waitFor();
      assert.deepEqual(await page.evaluate(() => window.scanCalls), [
        "sources",
        "scan",
        "folder",
        "scan",
      ]);
      assert.match(
        await page.locator(".scan-access").innerText(),
        /subcarpetas/,
      );
    },
  );
  await scenario(
    "folder cancellation stays explicit and does not scan again",
    {
      sources: [missing],
      scan: [missing],
      folder: [{ cancelled: true }],
    },
    async (page) => {
      await page.locator('[data-scan="search"]').click();
      await page
        .getByText(
          "No se autorizó ninguna carpeta. Puedes volver a intentarlo o elegir archivos.",
        )
        .waitFor();
      assert.equal(
        await page.locator('[data-scan="import"]').isEnabled(),
        false,
      );
      assert.deepEqual(await page.evaluate(() => window.scanCalls), [
        "sources",
        "scan",
        "folder",
      ]);
      assert.equal(
        await page.locator('[data-scan="search"]').isEnabled(),
        true,
      );
    },
  );
  await scenario(
    "adding a folder starts searching without a second click",
    {
      sources: [missing],
      folder: [authorized],
      scan: [{ ...authorized, files: [book] }],
    },
    async (page) => {
      await page.locator('[data-scan="folder"]').click();
      await page.locator('[data-scan-key="one"]').waitFor();
      assert.deepEqual(await page.evaluate(() => window.scanCalls), [
        "sources",
        "folder",
        "scan",
      ]);
    },
  );
  await scenario(
    "saved grants are reused without prompting",
    {
      sources: [authorized],
      scan: [{ ...authorized, files: [book] }],
    },
    async (page) => {
      await page.locator('[data-scan="search"]').click();
      await page.locator('[data-scan-key="one"]').waitFor();
      assert.deepEqual(await page.evaluate(() => window.scanCalls), [
        "sources",
        "scan",
      ]);
    },
  );
  await scenario(
    "revoked grants are authorized again",
    {
      sources: [{ ...missing, sources: [{ ...root, readable: false }] }],
      scan: [missing, { ...authorized, files: [book] }],
      folder: [authorized],
    },
    async (page) => {
      await page.locator('[data-scan="search"]').click();
      await page.locator('[data-scan-key="one"]').waitFor();
      assert.equal(
        await page.evaluate(
          () => window.scanCalls.filter((action) => action === "folder").length,
        ),
        1,
      );
    },
  );
  await scenario(
    "legacy denial explains access instead of claiming no books",
    {
      sources: [{ sources: [], scopedStorage: false }],
      scan: [{ files: [], sources: [], legacyPermissionDenied: true }],
    },
    async (page) => {
      await page.locator('[data-scan="search"]').click();
      await page
        .getByText(
          "Android no concedió acceso a los archivos. Autoriza una carpeta con Añadir carpeta o usa Elegir archivos.",
        )
        .waitFor();
      assert.equal(
        await page.locator('[data-scan="folder"]').isEnabled(),
        true,
      );
    },
  );
  await scenario(
    "partial failures preserve readable results and all warnings",
    {
      sources: [authorized],
      scan: [
        {
          ...authorized,
          files: [book],
          unreadableFolders: 1,
          limitedIndex: true,
        },
      ],
    },
    async (page) => {
      await page.locator('[data-scan="search"]').click();
      await page.locator('[data-scan-key="one"]').waitFor();
      const text = await page.locator(".scan-status").innerText();
      assert.match(text, /Selecciona/);
      assert.match(text, /Algunas carpetas/);
      assert.match(text, /Android limitó/);
    },
  );
  await scenario(
    "unusable permission does not start a prompt loop",
    {
      sources: [missing],
      scan: [missing, missing],
      folder: [authorized],
    },
    async (page) => {
      await page.locator('[data-scan="search"]').click();
      await page
        .getByText(
          "No se pudo acceder a la carpeta. Vuelve a autorizarla o usa Elegir archivos.",
        )
        .waitFor();
      assert.deepEqual(await page.evaluate(() => window.scanCalls), [
        "sources",
        "scan",
        "folder",
        "scan",
      ]);
    },
  );
  await scenario(
    "picker errors leave the dialog usable",
    {
      sources: [missing],
      scan: [missing],
      folder: [{ error: "Selector no disponible" }],
    },
    async (page) => {
      await page.locator('[data-scan="search"]').click();
      await page.getByText("Error: Selector no disponible").waitFor();
      assert.equal(
        await page.locator('[data-scan="choose"]').isEnabled(),
        true,
      );
      assert.equal(
        await page.locator('[data-scan="search"]').isEnabled(),
        true,
      );
    },
  );
  console.log(JSON.stringify({ passed }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
