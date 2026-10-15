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
  const page = await browser.newPage();
  const origin = server.resolvedUrls.local[0];
  await page.route(`${origin}__vertical`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<main></main>" }),
  );
  await page.goto(`${origin}__vertical`);
  const result = await page.evaluate(async () => {
    const NativeObserver = window.ResizeObserver;
    const pending = [];
    let hold = false;
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback) {
        super((entries, observer) => {
          if (hold) pending.push(() => callback(entries, observer));
          else callback(entries, observer);
        });
      }
    };
    const { createVerticalReader } = await import("/src/vertical-reader.mjs");
    const pane = document.createElement("div");
    pane.style.cssText =
      "position:relative;width:600px;height:450px;overflow:auto;overflow-anchor:none";
    document.querySelector("main").append(pane);
    const chapters = Array.from({ length: 20 }, (_, index) => ({
      id: `page-${index}`,
      title: `Página ${index + 1}`,
    }));
    const positions = [];
    const reader = createVerticalReader(pane, {
      chapters,
      initialIndex: 9,
      renderChapter: async (_index, surface) => {
        surface.innerHTML =
          '<div style="width:100%;aspect-ratio:1 / 1.4"></div>';
      },
      onChange: (position) => positions.push(position),
    });
    await reader.ready;
    await new Promise((resolve) => setTimeout(resolve, 40));
    const before = reader.capture();
    hold = true;
    pane.style.width = "400px";
    await new Promise((resolve) => requestAnimationFrame(resolve));
    pane.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const during = reader.capture();
    hold = false;
    pending.splice(0).forEach((callback) => callback());
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = reader.capture();
    pane.style.width = "500px";
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await reader.goTo(14);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const navigated = reader.capture();
    reader.destroy();
    pane.style.width = "600px";
    let release;
    const loading = new Promise((resolve) => {
      release = resolve;
    });
    const loadingPositions = [];
    const deferred = createVerticalReader(pane, {
      chapters,
      initialIndex: 9,
      locator: { fraction: 0.35 },
      renderChapter: async (index, surface) => {
        if (index === 9) await loading;
        surface.innerHTML =
          '<div style="width:100%;aspect-ratio:1 / 1.4"></div>';
      },
      onChange: (position) => loadingPositions.push(position),
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    pane.style.width = "400px";
    await new Promise((resolve) => setTimeout(resolve, 180));
    release();
    await deferred.ready;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const afterLoading = deferred.capture();
    deferred.destroy();
    return {
      before,
      during,
      after,
      navigated,
      announced: positions.at(-1),
      active: reader.activeCount,
      afterLoading,
      loadingPositions,
    };
  });
  assert.equal(result.before.chapter, "page-9");
  assert.equal(result.after.chapter, "page-9");
  assert.equal(result.during.chapter, "page-9");
  assert.equal(result.navigated.chapter, "page-14");
  assert.equal(result.announced.chapter, "page-14");
  assert.ok(Math.abs(result.after.fraction - result.before.fraction) < 0.01);
  assert.equal(result.active, 0);
  assert.equal(result.afterLoading.chapter, "page-9");
  assert.ok(Math.abs(result.afterLoading.fraction - 0.35) < 0.01);
  assert.ok(result.loadingPositions.length > 0);
  assert.ok(
    result.loadingPositions.every((position) => position.chapter === "page-9"),
  );
  console.log(
    "Vertical reading preserves its anchor when scroll precedes resize delivery.",
  );
} finally {
  await browser.close();
  await server.close();
}
