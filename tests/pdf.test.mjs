import test from "node:test";
import assert from "node:assert/strict";
import { pdfPageText, pdfTextHtml, pdfPageIds } from "../src/core/pdf-text.mjs";
import {
  createLibrary,
  importLibrary,
  exportLibrary,
} from "../src/core/library.mjs";
test("PDF extraction preserves lines and accents, ignoring marked-content records", () => {
  const text = pdfPageText({
    items: [
      { str: "Señal" },
      { type: "beginMarkedContent" },
      { str: "del camino.", hasEOL: true },
      { str: "Segundo párrafo.", hasEOL: true },
    ],
  });
  assert.equal(text, "Señal del camino.\nSegundo párrafo.");
  assert.equal(pdfPageText({ items: [] }), "");
});
test("PDF text never becomes active HTML", () => {
  assert.equal(
    pdfTextHtml('<script>alert("x")</script>\n& siguiente'),
    "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p><p>&amp; siguiente</p>",
  );
});
test("PDF page IDs remain physical and stable when labels differ", () => {
  assert.deepEqual(pdfPageIds(2, ["iv", "5"]), [
    { id: "pdf-page-1", pageNumber: 1, title: "iv" },
    { id: "pdf-page-2", pageNumber: 2, title: "5" },
  ]);
  assert.throws(() => pdfPageIds(0));
});
test("PDF view preferences survive export and import", () => {
  const library = createLibrary();
  library.preferences = {
    ...library.preferences,
    pdfView: "text",
    pdfZoom: "1.5",
    pdfLayout: "spread",
  };
  const imported = importLibrary(exportLibrary(library));
  assert.equal(imported.preferences.pdfView, "text");
  assert.equal(imported.preferences.pdfZoom, "1.5");
  assert.equal(imported.preferences.pdfLayout, "spread");
});
