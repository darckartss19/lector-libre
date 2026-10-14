// DOM anchor tests in a fresh browser; no native bridge, real books or accounts.
import assert from "node:assert/strict";
import { createServer } from "vite";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: `node_modules/.vite-browser-reader-tools-${process.pid}`,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const filler = Array.from(
    { length: 40 },
    (_, index) =>
      `<p>Camino ${index + 1}. Seguimos leyendo mientras la luz se mueve entre las hojas.</p>`,
  ).join("");
  const html = `<h2>CAPÍTULO \u{1f989}</h2><p>La casa <em>azul</em> guarda un <a id="link" href="#note"><strong>café</strong></a> y cafe\u0301. <mark id="foreign">Marca original</mark></p><p>Repetición: luz y <em>luz</em>.</p><p><img id="picture" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" alt="Imagen conservada">Otro párrafo.</p>${filler}<p>Destino <em>distante</em>, después del camino.</p>`;
  await page.route(`${origin}/__reader_tools_fixture`, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html><head><meta charset="utf-8"><style>body{font:18px/1.6 sans-serif}.reading-pane{height:250px;overflow:auto;width:650px;border:2px solid #888}.prose{padding:20px}p{margin:24px 0}mark{background:#ffc}</style></head><body><p id="outside-before">Fuera antes</p><div class="reading-pane"><article class="prose">${html}</article></div><p id="outside-after">Fuera después</p></body></html>`,
    }),
  );
  await page.goto(`${origin}/__reader_tools_fixture`);
  await page.evaluate(async (origin) => {
    window.tools = await import(`${origin}/src/core/reader-tools.mjs`);
    window.prose = document.querySelector(".prose");
    window.original = prose.textContent;
    window.originalHTML = prose.innerHTML;
    window.originalImage = document.getElementById("picture");
    window.linkClicks = 0;
    document.getElementById("link").addEventListener("click", (event) => {
      event.preventDefault();
      window.linkClicks++;
    });
    window.selectOffsets = (start, end) => {
      const nodes = [];
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
      let node,
        cursor = 0;
      while ((node = walker.nextNode())) {
        nodes.push({ node, start: cursor, end: cursor + node.data.length });
        cursor += node.data.length;
      }
      const first = nodes.find((part) => part.end > start);
      const last = nodes.find((part) => part.end >= end);
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    };
  }, origin);

  // Search uses actual HTML text, not the speech representation with separators.
  let result = await page.evaluate(() => {
    const chapters = [
      {
        id: "one",
        html: originalHTML,
        text: "Un prefijo que sólo existe en la voz.",
      },
      {
        id: "two",
        html: "<p>Otro CAFÉ, y otro café.</p>",
        text: "Otro\n\nCAFÉ",
      },
    ];
    return {
      cafe: tools.searchBook(chapters, "cafe"),
      phrase: tools.searchBook(chapters, "casa azul"),
      capped: tools.searchBook(chapters, "cafe", { limit: 3 }),
      html: prose.innerHTML,
    };
  });
  assert.deepEqual(
    result.cafe.map((hit) => hit.quote),
    ["café", "cafe\u0301", "CAFÉ", "café"],
  );
  assert.deepEqual(
    result.cafe.map((hit) => hit.chapterIndex),
    [0, 0, 1, 1],
  );
  assert.equal(result.capped.length, 3);
  assert.equal(result.phrase[0].quote, "casa azul");
  assert.equal(result.html, html);

  // A selection across inline elements remains anchored to canonical text.
  result = await page.evaluate(() => {
    const hit = tools.searchBook(
      [{ id: "one", html: originalHTML }],
      "casa azul",
    )[0];
    selectOffsets(hit.start, hit.end);
    window.crossAnchor = tools.selectionAnchor(prose);
    return { anchor: crossAnchor, expected: hit };
  });
  assert.deepEqual(result.anchor, {
    start: result.expected.start,
    end: result.expected.end,
    quote: "casa azul",
  });

  // Overlap a note with a multi-element highlight without replacing link/image nodes.
  result = await page.evaluate(() => {
    const cafe = tools.searchBook(
      [{ id: "one", html: originalHTML }],
      "cafe",
    )[0];
    window.annotations = [
      {
        id: "wide",
        type: "highlight",
        start: crossAnchor.start,
        end: cafe.end,
        quote: original.slice(crossAnchor.start, cafe.end),
        color: "green",
      },
      {
        id: "note",
        type: "note",
        start: cafe.start,
        end: cafe.end,
        quote: cafe.quote,
        color: "pink",
      },
      { id: "bookmark", type: "bookmark", ...crossAnchor },
      { id: "deleted", type: "highlight", ...crossAnchor, deleted: true },
      {
        id: "stale",
        type: "highlight",
        ...crossAnchor,
        quote: "Texto cambiado",
      },
      { id: "invalid", type: "highlight", start: -1, end: 4 },
    ];
    const painted = tools.annotateChapter(prose, annotations);
    const count = prose.querySelectorAll("[data-reader-annotation]").length;
    tools.annotateChapter(prose, annotations);
    document.getElementById("link").click();
    selectOffsets(crossAnchor.start, crossAnchor.end);
    return {
      painted,
      count,
      secondCount: prose.querySelectorAll("[data-reader-annotation]").length,
      ids: [
        ...new Set(
          [...prose.querySelectorAll("[data-annotation]")].map(
            (node) => node.dataset.annotation,
          ),
        ),
      ],
      text: prose.textContent,
      imageSame: originalImage === document.getElementById("picture"),
      clicks: linkClicks,
      href: document.getElementById("link").getAttribute("href"),
      foreign: document.getElementById("foreign").textContent,
      selection: tools.selectionAnchor(prose),
    };
  });
  assert.equal(result.painted, 2);
  assert.equal(result.count, result.secondCount);
  assert.deepEqual(result.ids.sort(), ["note", "wide"]);
  assert.equal(result.imageSame, true);
  assert.equal(result.clicks, 1);
  assert.equal(result.href, "#note");
  assert.equal(result.foreign, "Marca original");
  assert.equal(result.selection.quote, "casa azul");
  const original = await page.evaluate(() => window.original);
  assert.equal(result.text, original);

  // Out-of-chapter and empty selections never yield saveable anchors.
  result = await page.evaluate(() => {
    const range = document.createRange();
    range.setStart(prose.querySelector("h2").firstChild, 0);
    range.setEnd(document.getElementById("outside-after").firstChild, 5);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const outside = tools.selectionAnchor(prose);
    range.selectNodeContents(prose.querySelector("h2"));
    range.collapse();
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return { outside, collapsed: tools.selectionAnchor(prose) };
  });
  assert.deepEqual(result, { outside: null, collapsed: null });

  // Viewport bookmarks advance with scrolling and work through saved markup.
  result = await page.evaluate(() => {
    const pane = document.querySelector(".reading-pane");
    pane.scrollTop = 0;
    const beginning = tools.viewportAnchor(prose);
    pane.scrollTop = pane.scrollHeight / 2;
    const middle = tools.viewportAnchor(prose);
    pane.scrollTop = pane.scrollHeight;
    const ending = tools.viewportAnchor(prose);
    return { beginning, middle, ending, text: original };
  });
  assert.equal(result.beginning.start, 0);
  assert.ok(result.middle.start > result.beginning.start);
  assert.ok(result.ending.start > result.middle.start);
  for (const anchor of [result.beginning, result.middle, result.ending]) {
    assert.equal(anchor.end, anchor.start);
    assert.equal(
      result.text.slice(anchor.start, anchor.start + anchor.quote.length),
      anchor.quote,
    );
    assert.ok(anchor.quote.trim());
  }

  // Revealing scrolls the pane and its temporary marks retain saved annotations.
  result = await page.evaluate(() => {
    const pane = document.querySelector(".reading-pane");
    pane.scrollTop = 0;
    const target = tools.searchBook(
      [{ id: "one", html: originalHTML }],
      "destino distante",
    )[0];
    const count = prose.querySelectorAll("[data-reader-annotation]").length;
    const revealed = tools.revealAnchor(prose, target);
    return {
      count,
      revealed: revealed?.dataset.searchHit,
      scroll: pane.scrollTop,
      text: prose.textContent,
      after: prose.querySelectorAll("[data-reader-annotation]").length,
    };
  });
  assert.equal(result.revealed, "true");
  assert.ok(result.scroll > 0);
  assert.equal(result.count, result.after);
  assert.equal(result.text, original);
  await page.waitForFunction(
    () => document.querySelectorAll("[data-reader-search-hit]").length === 0,
    null,
    { timeout: 5000 },
  );
  assert.equal(
    await page.locator("[data-reader-annotation]").count(),
    result.count,
  );

  // A zero-length viewport bookmark reveals its context without losing marks.
  result = await page.evaluate(() => {
    const anchor = tools.viewportAnchor(prose);
    document.querySelector(".reading-pane").scrollTop = 0;
    const hit = tools.revealAnchor(prose, anchor);
    return {
      revealed: !!hit,
      scroll: document.querySelector(".reading-pane").scrollTop,
      text: prose.textContent,
    };
  });
  assert.equal(result.revealed, true);
  assert.ok(result.scroll > 0);
  assert.equal(result.text, original);

  // Invalid ranges are rejected; clearing annotations preserves original markup.
  result = await page.evaluate(() => {
    const invalid = tools.revealAnchor(prose, {
      start: 10,
      end: 15,
      quote: "distinta",
    });
    tools.clearAnnotations(prose);
    return {
      invalid,
      managed: prose.querySelectorAll("[data-reader-annotation]").length,
      foreign: document.getElementById("foreign").textContent,
      text: prose.textContent,
      imageSame: originalImage === document.getElementById("picture"),
    };
  });
  assert.equal(result.invalid, null);
  assert.equal(result.managed, 0);
  assert.equal(result.foreign, "Marca original");
  assert.equal(result.imageSame, true);
  assert.equal(result.text, original);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      casesPassed: 7,
      unicode: true,
      overlap: true,
      selection: true,
      viewport: true,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
