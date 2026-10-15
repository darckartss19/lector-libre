import assert from "node:assert/strict";
import { preview } from "vite";
import { createLibrary } from "../src/core/library.mjs";
import { installStateBridge } from "./helpers/state-bridge.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const platform of ["windows", "android"]) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await installStateBridge(page);
    await page.addInitScript(
      ({ platform, initial }) => {
        window.saved = initial;
        window.calls = [];
        window.__TAURI_INTERNALS__ = {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main" },
          },
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (command, args) => {
            window.calls.push(command);
            if (command === "platform_info")
              return {
                platform,
                mobile: platform === "android",
                drive: false,
                publicPreview: true,
                speech: false,
                imageClipboard: false,
              };
            if (command === "load_state") return structuredClone(window.saved);
            if (command === "book_availability") return [];
            if (command === "speech_timer_status") return { deadline: null };
            if (command === "plugin:event|listen") return args.handler;
            if (
              [
                "diagnostic_event",
                "mobile_background",
                "mobile_chrome",
              ].includes(command)
            )
              return;
            throw new Error(`Unexpected command ${command}`);
          },
        };
      },
      { platform, initial: createLibrary() },
    );
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('.sidebar [data-action="settings"]').click();
    await page
      .getByText(
        "La sincronización con Drive está desactivada en esta versión pública.",
        { exact: false },
      )
      .waitFor();
    assert.equal(
      await page.locator('[data-action="connect-google"]').count(),
      0,
    );
    assert.equal(await page.locator('[data-action="sync-google"]').count(), 0);
    assert.deepEqual(
      await page.evaluate(() =>
        window.calls.filter((command) => command.startsWith("drive_")),
      ),
      [],
    );
    await page.close();
  }
  console.log(
    "Public Windows and Android: Drive disabled, notice visible, no Drive calls.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
