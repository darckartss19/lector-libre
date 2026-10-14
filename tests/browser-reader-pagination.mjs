// Real column layout in an isolated browser; no native bridge or personal library.
import assert from "node:assert/strict";
import { createServer } from "vite";
const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: `node_modules/.vite-browser-pagination-${process.pid}`,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1320, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const filler = Array.from(
    { length: 80 },
    (_, i) =>
      `<p id="p${i}">Párrafo ${i}. ${"El camino transcurre entre árboles, un café y la casa azul. ".repeat(6)}</p>`,
  ).join("");
  const content = `<h2>CAPÍTULO \u{1f989}</h2><p>La casa <em>azul</em> tiene un <a id="original-link" href="#end"><strong>café</strong></a> y cafe\u0301.</p>${filler}<p id="end">El último párrafo conserva todos los caracteres.</p>`;
  await page.route(`${origin}/__pagination_fixture`, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html><head><meta charset="utf-8"><link rel="stylesheet" href="${origin}/src/style.css"><link rel="stylesheet" href="${origin}/src/reader-pagination.css"><style>html{--page-bg:#fefcf2;--page-ink:#222;--bg:#eed;--panel:#fff;--page-width:760px;--page-padding:28px;--reading-size:20px;--reading-line:1.6}body{margin:0;padding:20px}.reading-pane{width:1200px;height:560px;flex:none;outline:1px solid #ccc}</style></head><body><div class="reading-pane"><article class="prose">${content}</article></div></body></html>`,
    }),
  );
  await page.goto(`${origin}/__pagination_fixture`);
  await page.evaluate(async (origin) => {
    window.pagination = await import(`${origin}/src/reader-pagination.mjs`);
    window.tools = await import(`${origin}/src/core/reader-tools.mjs`);
    window.pane = document.querySelector(".reading-pane");
    window.prose = pane.querySelector(".prose");
    window.originalHTML = prose.innerHTML;
    window.originalText = prose.textContent;
    window.link = document.getElementById("original-link");
    window.changes = [];
    window.reader = pagination.createReaderPagination(pane, {
      mode: "page",
      onChange: (state) => changes.push(state),
    });
  }, origin);
  await page.waitForTimeout(100);
  let result = await page.evaluate(() => ({
    state: reader.snapshot(),
    same: prose.innerHTML === originalHTML,
    textSame: prose.textContent === originalText,
    originalLink: link === document.getElementById("original-link"),
    height: document.querySelector(".reader-page-frame").scrollHeight,
    client: document.querySelector(".reader-page-frame").clientHeight,
  }));
  assert.equal(result.state.mode, "page");
  assert.equal(result.state.page, 1);
  assert.ok(result.state.pageCount > 15, JSON.stringify(result));
  assert.equal(result.same, true);
  assert.equal(result.textSame, true);
  assert.equal(result.originalLink, true);
  assert.equal(result.height, result.client);

  result = await page.evaluate(() => {
    const first = reader.capture();
    const previous = reader.previous();
    reader.next();
    reader.next();
    reader.next();
    const fourth = reader.capture();
    const state = reader.snapshot();
    return {
      first,
      previous,
      fourth,
      state,
      html: prose.innerHTML === originalHTML,
    };
  });
  assert.equal(result.previous, false);
  assert.equal(result.state.page, 4);
  assert.ok(result.fourth.offset > result.first.offset);
  assert.equal(result.html, true);
  const savedOffset = result.fourth.offset;

  // Automatic observers preserve the exact anchor without an explicit refresh.
  const observerOffset = await page.evaluate(() => reader.capture().offset);
  await page.evaluate(() => {
    pane.style.width = "1100px";
    reader.setMode("spread");
  });
  await page.waitForFunction(
    () => reader.snapshot().effectiveMode === "spread",
  );
  const countBefore = await page.evaluate(() => reader.snapshot().pageCount);
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--reading-size", "32px"),
  );
  await page.waitForFunction(
    (countBefore) => reader.snapshot().pageCount !== countBefore,
    countBefore,
  );
  await page.evaluate(() => {
    pane.style.width = "580px";
  });
  await page.waitForFunction(() => reader.snapshot().effectiveMode === "page");
  result = await page.evaluate(() => ({
    state: reader.snapshot(),
    capture: reader.capture(),
    anchor: reader.viewportAnchor(),
  }));
  assert.equal(result.capture.offset, observerOffset);
  assert.equal(result.state.locator.offset, observerOffset);
  assert.ok(result.anchor.start <= observerOffset);

  // Font reflow, a side-panel sized viewport, and mode changes retain the passage.
  result = await page.evaluate((savedOffset) => {
    pane.style.width = "1200px";
    reader.setMode("page");
    const target = originalText.slice(savedOffset, savedOffset + 20);
    document.documentElement.style.setProperty("--reading-size", "25px");
    reader.refresh();
    const frame = document.querySelector(".reader-page-frame");
    const before = reader.snapshot();
    const range = (() => {
      const walker = document.createTreeWalker(prose, 4);
      let node,
        offset = 0;
      while ((node = walker.nextNode())) {
        if (offset + node.length > savedOffset) {
          const r = document.createRange();
          r.setStart(node, savedOffset - offset);
          r.setEnd(node, savedOffset - offset + 1);
          return r;
        }
        offset += node.length;
      }
    })();
    const rect = range.getBoundingClientRect(),
      box = frame.getBoundingClientRect();
    const visible = rect.left >= box.left && rect.right <= box.right;
    reader.setMode("spread");
    const spread = reader.snapshot();
    pane.style.width = "600px";
    reader.refresh();
    const narrow = reader.snapshot();
    reader.setMode("scroll");
    const scroll = reader.snapshot();
    return {
      target,
      visible,
      before,
      spread,
      narrow,
      scroll,
      html: prose.innerHTML === originalHTML,
    };
  }, savedOffset);
  assert.equal(result.visible, true, JSON.stringify(result));
  assert.equal(result.spread.effectiveMode, "spread");
  assert.equal(result.spread.visiblePages, 2);
  assert.equal(result.before.locator.offset, savedOffset);
  assert.equal(result.spread.locator.offset, savedOffset);
  assert.equal(result.narrow.locator.offset, savedOffset);
  assert.equal(result.narrow.mode, "spread");
  assert.equal(result.narrow.effectiveMode, "page");
  assert.equal(result.scroll.mode, "scroll");
  assert.equal(result.scroll.locator.offset, savedOffset);
  assert.equal(result.html, true);

  // Search and annotations use the same UTF-16 offsets inside columns.
  result = await page.evaluate(() => {
    pane.style.width = "1200px";
    reader.setMode("spread");
    window.hit = tools.searchBook(
      [{ id: "fixture", html: originalHTML }],
      "último párrafo",
    )[0];
    tools.annotateChapter(prose, [
      { id: "saved", type: "highlight", ...hit, color: "green" },
    ]);
    const revealed = tools.revealAnchor(prose, hit);
    reader.revealOffset(hit.start);
    const frame = document.querySelector(".reader-page-frame"),
      rect = revealed.getBoundingClientRect(),
      box = frame.getBoundingClientRect();
    const visible =
      rect.right > box.left &&
      rect.left < box.right &&
      rect.bottom > box.top &&
      rect.top < box.bottom;
    const range = document.createRange();
    range.selectNodeContents(revealed);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const selection = tools.selectionAnchor(prose);
    const bookmark = reader.viewportAnchor();
    const state = reader.snapshot();
    const next = reader.next();
    return {
      visible,
      selection,
      bookmark,
      state,
      next,
      text: prose.textContent === originalText,
      savedMarks: prose.querySelectorAll("[data-reader-annotation]").length,
      originalLink: link === document.getElementById("original-link"),
    };
  });
  assert.equal(result.visible, true);
  assert.equal(result.selection.quote, "último párrafo");
  assert.ok(result.bookmark.start > 0);
  assert.equal(result.state.atEnd, true);
  assert.equal(result.next, false);
  assert.equal(result.text, true);
  assert.ok(result.savedMarks > 0);
  assert.equal(result.originalLink, true);

  // End-of-chapter fallback and legacy saved fraction both work without an offset.
  result = await page.evaluate(() => {
    reader.restore({ fraction: 1 });
    const ending = reader.snapshot();
    reader.restore({ fraction: 0.5 });
    const middle = reader.snapshot();
    reader.restore({ offset: -1, fraction: 0 });
    const beginning = reader.snapshot();
    const invalid = reader.revealOffset(-10);
    reader.destroy();
    return {
      ending,
      middle,
      beginning,
      invalid,
      proseRestored: pane.querySelector(":scope > .prose") === prose,
      frameRemoved: !pane.querySelector(".reader-page-frame"),
      textSame: prose.textContent === originalText,
    };
  });
  assert.equal(result.ending.atEnd, true);
  assert.ok(result.middle.page > 1);
  assert.equal(result.beginning.page, 1);
  assert.equal(result.invalid, false);
  assert.equal(result.proseRestored, true);
  assert.equal(result.frameRemoved, true);
  assert.equal(result.textSame, true);

  // One-page short chapters never invent a second blank page in a spread.
  result = await page.evaluate(() => {
    prose.innerHTML = "<p>Un capítulo breve.</p>";
    window.shortReader = pagination.createReaderPagination(pane, {
      mode: "spread",
    });
    const state = shortReader.snapshot();
    shortReader.destroy();
    return state;
  });
  assert.equal(result.pageCount, 1);
  assert.equal(result.atStart, true);
  assert.equal(result.atEnd, true);

  // A single text node can cross many columns: its vertical coordinate resets
  // on each page, but text anchors and reflow still select the intended page.
  result = await page.evaluate(() => {
    prose.innerHTML = `<p>${"Un mismo párrafo largo avanza sin separarse, con café y \u{1f989}. ".repeat(1500)}</p>`;
    window.longReader = pagination.createReaderPagination(pane, {
      mode: "spread",
    });
    const text = prose.textContent;
    const offset = Math.floor(text.length * 0.7);
    longReader.revealOffset(offset);
    const state = longReader.snapshot();
    const before = longReader.viewportAnchor();
    document.documentElement.style.setProperty("--reading-size", "28px");
    longReader.refresh();
    const after = longReader.snapshot();
    const range = document.createRange();
    range.setStart(prose.firstChild.firstChild, offset);
    range.setEnd(prose.firstChild.firstChild, offset + 1);
    const rect = range.getBoundingClientRect(),
      box = document
        .querySelector(".reader-page-frame")
        .getBoundingClientRect();
    const visible =
      rect.left >= box.left &&
      rect.right <= box.right &&
      rect.top >= box.top &&
      rect.bottom <= box.bottom;
    let viewed = 0;
    while (longReader.next()) viewed++;
    const ending = longReader.snapshot();
    const textSame = prose.textContent === text;
    longReader.destroy();
    return { state, before, after, offset, visible, viewed, ending, textSame };
  });
  assert.ok(result.state.page > 30);
  assert.ok(result.before.start > 0);
  assert.equal(result.after.locator.offset, result.offset);
  assert.equal(result.visible, true);
  assert.ok(result.viewed > 0);
  assert.equal(result.ending.atEnd, true);
  assert.equal(result.textSame, true);

  // Oversized images fit the column height instead of creating unreachable
  // vertical overflow, and retain the original image node through all modes.
  result = await page.evaluate(async () => {
    prose.innerHTML = `<p>Antes de la ilustración.</p><p><img id="large-image" width="1000" height="2200" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1000' height='2200'%3E%3Crect width='1000' height='2200' fill='blue'/%3E%3C/svg%3E"></p><p>Después de la ilustración.</p>`;
    const picture = prose.querySelector("img");
    await picture.decode();
    window.imageReader = pagination.createReaderPagination(pane, {
      mode: "page",
    });
    const frame = document.querySelector(".reader-page-frame");
    const size = {
      image: picture.getBoundingClientRect().height,
      viewport: frame.clientHeight,
      scroll: frame.scrollHeight,
    };
    const target = prose.textContent.indexOf("Después");
    imageReader.revealOffset(target);
    const state = imageReader.snapshot();
    imageReader.setMode("scroll");
    imageReader.destroy();
    return { size, state, same: picture === prose.querySelector("img") };
  });
  assert.ok(result.size.image <= result.size.viewport);
  assert.equal(result.size.scroll, result.size.viewport);
  assert.ok(result.state.page > 1);
  assert.equal(result.same, true);

  // At the chapter beginning, restoring the first text offset must retain the
  // original top margins/padding instead of scrolling the first glyph to y=0.
  result = await page.evaluate(() => {
    prose.innerHTML = `\n\n${originalHTML}`;
    pane.scrollTop = 0;
    window.startReader = pagination.createReaderPagination(pane, {
      mode: "scroll",
      locator: { fraction: 0 },
    });
    const initial = pane.scrollTop,
      saved = startReader.capture();
    startReader.refresh();
    startReader.refresh();
    const refreshed = pane.scrollTop;
    document.documentElement.style.setProperty("--reading-size", "34px");
    pane.style.width = "900px";
    return { initial, saved, refreshed };
  });
  assert.equal(result.initial, 0);
  assert.ok(result.saved.offset >= 2);
  assert.equal(result.saved.fraction, 0);
  assert.equal(result.refreshed, 0);
  await page.waitForTimeout(100);
  result = await page.evaluate(() => {
    const observed = pane.scrollTop,
      state = startReader.snapshot();
    startReader.destroy();
    return { observed, state, destroyed: pane.scrollTop };
  });
  assert.equal(result.observed, 0);
  assert.equal(result.state.fraction, 0);
  assert.equal(result.destroyed, 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      casesPassed: 10,
      pages: true,
      spread: true,
      reflow: true,
      anchors: true,
      longParagraph: true,
      images: true,
      preservedDOM: true,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
