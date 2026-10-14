// Speech anchors/highlights in an isolated browser; no books, accounts or motor.
import assert from "node:assert/strict";
import { createServer } from "vite";

const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  cacheDir: `node_modules/.vite-browser-speech-navigation-${process.pid}`,
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
  await page.route(`${origin}/__speech_navigation_fixture`, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html><head><meta charset="utf-8"><style>body{font:18px/1.6 sans-serif}.reading-pane{height:180px;overflow:auto;width:600px}p{margin:20px 0}::highlight(lector-speech),.reader-speech-fragment{background:#b7d9e8;color:#102733}</style></head><body><p id="outside">Texto exterior.</p><div class="reading-pane"><article id="epub"><h2>Comienzo \u{1f989}</h2><div><p id="first">Primero <em>texto</em> repetido.</p><p id="second">Primero <a id="link" href="#note"><strong>texto</strong></a> repetido. <img id="picture" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" alt="Ilustración"><mark id="foreign">Original</mark></p><p id="third">\u{1f600} Un final. Otra frase.</p></div>${Array.from({ length: 20 }, (_, i) => `<p>Camino ${i}. Seguimos leyendo.</p>`).join("")}</article></div><article id="txt"></article></body></html>`,
    }),
  );
  await page.goto(`${origin}/__speech_navigation_fixture`);
  await page.evaluate(async (origin) => {
    window.navigation = await import(`${origin}/src/speech-navigation.mjs`);
    window.annotations = await import(`${origin}/src/core/reader-tools.mjs`);
    const { parseBook } = await import(`${origin}/src/core/epub.mjs`);
    window.prose = document.getElementById("epub");
    window.original = prose.textContent;
    window.picture = document.getElementById("picture");
    window.link = document.getElementById("link");
    window.foreign = document.getElementById("foreign");
    window.linkClicks = 0;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.linkClicks++;
    });
    const holder = prose.cloneNode(true);
    holder
      .querySelectorAll("p,div,h1,h2,h3,h4,li,blockquote")
      .forEach((node) => node.append(document.createTextNode("\n")));
    window.chapter = { id: "epub", text: holder.textContent };
    const txt = parseBook(
      new TextEncoder().encode("Uno \u{1f600}.\n\nDos <texto>.\n\nTres."),
      "txt",
      "Prueba",
    );
    window.txtChapter = txt.chapters[0];
    document.getElementById("txt").innerHTML = txtChapter.html;
    window.selectText = (node, start, end) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    };
  }, origin);

  // Repeated phrases resolve by offsets, not by the first quote occurrence.
  let result = await page.evaluate(() => {
    const position = navigation.speechPositionForParagraph(
      prose,
      chapter,
      link.querySelector("strong"),
    );
    const expected = chapter.text.indexOf(
      "Primero",
      chapter.text.indexOf("Primero") + 1,
    );
    const range = document.createRange();
    range.setStart(document.getElementById("second").firstChild, 2);
    range.setEnd(link.querySelector("strong").firstChild, 3);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const selection = navigation.speechPositionFromSelection(prose, chapter);
    return {
      position,
      expected,
      selected: selection.offset,
      foreign: navigation.speechPositionForParagraph(
        prose,
        chapter,
        document.getElementById("outside"),
      ),
    };
  });
  assert.deepEqual(result.position, {
    chapter: "epub",
    offset: result.expected,
  });
  assert.equal(result.selected, result.expected + 2);
  assert.equal(result.foreign, null);

  // Real TXT paragraph separators and literal angle brackets also map correctly.
  result = await page.evaluate(() => {
    const txt = document.getElementById("txt");
    const position = navigation.speechPositionForParagraph(
      txt,
      txtChapter,
      txt.querySelectorAll("p")[1],
    );
    selectText(txt.firstChild.firstChild, 5, 7); // A position inside the emoji backs up one code unit.
    const emoji = navigation.speechPositionFromSelection(txt, txtChapter);
    return {
      position,
      expected: txtChapter.text.indexOf("Dos"),
      emoji: emoji.offset,
    };
  });
  assert.equal(result.position.offset, result.expected);
  assert.equal(result.emoji, 4);

  result = await page.evaluate(() => {
    selectText(document.getElementById("outside").firstChild, 0, 4);
    const outside = navigation.speechPositionFromSelection(prose, chapter);
    const mismatch = navigation.speechPositionForParagraph(
      prose,
      { ...chapter, text: "Texto cambiado" },
      document.getElementById("first"),
    );
    return { outside, mismatch };
  });
  assert.equal(result.outside, null);
  assert.equal(result.mismatch, null);

  // TTS marks can overlap saved annotations without deleting existing markup/nodes.
  result = await page.evaluate(() => {
    const start = original.indexOf("texto", original.indexOf("texto") + 1);
    annotations.annotateChapter(prose, [
      {
        id: "note",
        type: "note",
        start,
        end: start + 5,
        quote: "texto",
        color: "pink",
      },
    ]);
    window.annotationNode = prose.querySelector("[data-reader-annotation]");
    const offset = chapter.text.indexOf(
      "Primero",
      chapter.text.indexOf("Primero") + 1,
    );
    window.request = {
      chapter: "epub",
      start: offset,
      end: offset + "Primero texto repetido.".length,
      text: "Primero texto repetido.",
    };
    const pane = prose.closest(".reading-pane");
    pane.scrollTop = 300;
    const top = pane.scrollTop;
    const painted = navigation.highlightSpeechFragment(prose, chapter, request);
    const cssText = CSS.highlights.get("lector-speech")
      ? [...CSS.highlights.get("lector-speech")][0].toString()
      : null;
    const unchangedTop = pane.scrollTop;
    navigation.clearSpeechHighlight(prose);
    return {
      mode: painted.mode,
      cssText,
      top,
      unchangedTop,
      cleared: !CSS.highlights.has("lector-speech"),
      annotation:
        prose.querySelector("[data-reader-annotation]") === annotationNode,
      sameText: prose.textContent === original,
    };
  });
  assert.equal(result.mode, "highlight");
  assert.equal(result.cssText, "Primero texto repetido.");
  assert.equal(result.unchangedTop, result.top);
  assert.equal(result.cleared, true);
  assert.equal(result.annotation, true);
  assert.equal(result.sameText, true);

  result = await page.evaluate(() => {
    const highlighted = navigation.highlightSpeechFragment(
      prose,
      chapter,
      request,
      { useHighlights: false },
    );
    const markedText = [...prose.querySelectorAll("[data-reader-speech]")]
      .map((node) => node.textContent)
      .join("");
    link.click();
    navigation.clearSpeechHighlight(prose);
    return {
      mode: highlighted.mode,
      markedText,
      clicks: linkClicks,
      annotations: prose.querySelectorAll("[data-reader-annotation]").length,
      sameAnnotation:
        prose.querySelector("[data-reader-annotation]") === annotationNode,
      sameNodes:
        picture === document.getElementById("picture") &&
        link === document.getElementById("link") &&
        foreign === document.getElementById("foreign"),
      text: prose.textContent,
      ownedMarks: prose.querySelectorAll("[data-reader-speech]").length,
    };
  });
  assert.equal(result.mode, "marks");
  assert.equal(result.markedText, "Primero texto repetido.");
  assert.equal(result.clicks, 1);
  assert.equal(result.annotations, 1);
  assert.equal(result.sameAnnotation, true);
  assert.equal(result.sameNodes, true);
  assert.equal(result.ownedMarks, 0);
  assert.equal(result.text, await page.evaluate(() => original));

  result = await page.evaluate(() => {
    const wrongChapter = navigation.highlightSpeechFragment(prose, chapter, {
      ...request,
      chapter: "another",
    });
    const changedText = navigation.highlightSpeechFragment(prose, chapter, {
      ...request,
      text: "Texto cambiado",
    });
    const anchor = navigation.speechPositionForAnchor(prose, chapter, {
      start: 0,
      end: 4,
      quote: "incorrecto",
    });
    return {
      wrongChapter,
      changedText,
      anchor,
      marks: prose.querySelectorAll("[data-reader-speech]").length,
      css: CSS.highlights.has("lector-speech"),
    };
  });
  assert.deepEqual(result, {
    wrongChapter: null,
    changedText: null,
    anchor: null,
    marks: 0,
    css: false,
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ casesPassed: 6, errors }));
} finally {
  await browser.close();
  await server.close();
}
