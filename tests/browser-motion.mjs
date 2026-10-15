import assert from "node:assert/strict";
import { createServer } from "vite";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const origin = server.resolvedUrls.local[0];
  const route = (request) =>
    request.fulfill({
      contentType: "text/html",
      body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${origin}src/style.css"><link rel="stylesheet" href="${origin}src/mobile.css"></head><body><div id="app"><header class="mobile-header"><button data-mobile-menu>Menú</button></header><aside class="sidebar"><button>Biblioteca</button></aside><main class="workspace"><button class="cover" style="width:150px">Un libro</button></main></div><script type="module">import { mobileNavigation } from "${origin}src/mobile-navigation.mjs"; const root=document.querySelector('#app'); window.nav=mobileNavigation(root); document.addEventListener('click',event=>{const button=event.target.closest('button');if(button)window.nav.handle(button)});</script></body></html>`,
    });
  const desktop = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });
  await desktop.route("**/motion-check", route);
  await desktop.goto(`${origin}motion-check`);
  await desktop.locator(".cover").hover();
  await desktop.mouse.move(1100, 750);
  const exit = await desktop.locator(".cover").evaluate((el) => ({
    duration: getComputedStyle(el).transitionDuration,
    properties: getComputedStyle(el).transitionProperty,
  }));
  assert.ok(
    parseFloat(exit.duration) > 0 && parseFloat(exit.duration) <= 0.2,
    "Cover return must have a short transition",
  );
  assert.equal(exit.properties, "transform");
  await desktop.emulateMedia({ reducedMotion: "reduce" });
  await desktop.locator(".cover").hover();
  assert.equal(
    await desktop
      .locator(".cover")
      .evaluate((el) => getComputedStyle(el).transform),
    "none",
  );

  const mobile = await browser.newPage({
    viewport: { width: 900, height: 540 },
    hasTouch: true,
    isMobile: true,
  });
  await mobile.route("**/motion-check", route);
  await mobile.goto(`${origin}motion-check`);
  await mobile.waitForFunction(() => window.nav);
  await mobile.locator(".cover").hover();
  assert.equal(
    await mobile
      .locator(".cover")
      .evaluate((el) => getComputedStyle(el).transform),
    "none",
    "Touch must not keep a raised cover",
  );
  await mobile.locator("[data-mobile-menu]").focus();
  await mobile.keyboard.press("Enter");
  assert.equal(
    await mobile
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
    "Keyboard menu opens immediately",
  );
  await mobile.keyboard.press("Escape");
  await mobile.locator("[data-mobile-menu]").blur();
  await mobile.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await mobile
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
    "Landscape touch drawer honors reduced motion",
  );
  console.log(
    JSON.stringify({
      coverReturn: true,
      noTouchHover: true,
      reducedMotionDesktopAndLandscape: true,
      instantKeyboardMenu: true,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
