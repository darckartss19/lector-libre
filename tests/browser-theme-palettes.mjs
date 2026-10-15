import assert from "node:assert/strict";
import { createServer } from "vite";
import { THEMES } from "../src/core/appearance.mjs";
import { contrastRatio } from "../src/core/spines.mjs";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = server.resolvedUrls.local[0];
  await page.route("**/palette-check", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><link rel="stylesheet" href="${origin}src/style.css"></head><body>
      <button class="primary">Añadir libros</button><button class="active">Biblioteca</button>
      <span class="status-chip">En lectura</span><div class="notice error">No se pudo guardar</div>
      <div class="page-sample"><div class="preview-prose"><p>Un momento para leer.</p></div></div>
      <article class="prose"><p>Las palabras encuentran su propio ritmo. <a href="#nota">Una nota al margen.</a></p></article>
      <script type="module">import { applyAppearance } from "${origin}src/core/appearance.mjs"; window.applyPalette = (theme, pageTheme = "auto") => applyAppearance(document.documentElement, { theme, pageTheme });</script>
    </body></html>`,
    }),
  );
  await page.goto(`${origin}palette-check`);
  await page.waitForFunction(() => window.applyPalette);
  const contrast = async (selector, expected = 4.5) => {
    const pair = await page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      const hex = (rgb) =>
        "#" +
        rgb
          .match(/\d+/g)
          .slice(0, 3)
          .map((n) => Number(n).toString(16).padStart(2, "0"))
          .join("");
      return {
        ink: hex(style.color),
        background: hex(style.backgroundColor),
        filter: style.filter,
      };
    });
    assert.ok(
      contrastRatio(pair.ink, pair.background) >= expected,
      `${selector}: ${JSON.stringify(pair)}`,
    );
    assert.equal(
      pair.filter,
      "none",
      "Contrast must not be changed by a brightness filter",
    );
  };
  for (const theme of THEMES) {
    await page.evaluate((id) => window.applyPalette(id), theme.id);
    await page.mouse.move(1100, 700);
    await contrast(".primary");
    await page.locator(".primary").hover();
    await contrast(".primary");
    await contrast(".active");
    await contrast(".status-chip");
    await contrast(".notice.error");
    for (const reading of THEMES) {
      await page.evaluate(
        ([ui, reading]) => window.applyPalette(ui, reading),
        [theme.id, reading.id],
      );
      await contrast(".page-sample", 7);
      await contrast(".prose", 7);
      const link = await page.locator(".prose a").evaluate((element) => ({
        color: getComputedStyle(element).color,
        pageColor: getComputedStyle(element.parentElement.parentElement)
          .backgroundColor,
      }));
      const toHex = (rgb) =>
        "#" +
        rgb
          .match(/\d+/g)
          .slice(0, 3)
          .map((n) => Number(n).toString(16).padStart(2, "0"))
          .join("");
      assert.ok(
        contrastRatio(toHex(link.color), toHex(link.pageColor)) >= 4.5,
        `${theme.id}/${reading.id} link`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      themes: THEMES.length,
      pageCombinations: THEMES.length ** 2,
      hoverAndStatusContrast: true,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
