import assert from "node:assert/strict";
import { createServer } from "vite";
import { zipSync, strToU8 } from "fflate";
import { chromium } from "playwright";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const text = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const style = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
const fo = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
const odt = (body, { prefix = "text", utf16 = false, styles = "" } = {}) => {
  const xml = `<?xml version="1.0" encoding="${utf16 ? "UTF-16" : "UTF-8"}"?><office:document-content xmlns:office="${office}" xmlns:${prefix}="${text}" xmlns:style="${style}" xmlns:fo="${fo}"><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  return [
    ...zipSync({
      "content.xml": utf16
        ? new Uint8Array(Buffer.from("\ufeff" + xml, "utf16le"))
        : strToU8(xml),
    }),
  ];
};
const cases = [
  {
    name: "ordinary spaces",
    bytes: odt('<text:p>A<text:s text:c="3"/>B</text:p>'),
    expected: "A   B",
  },
  {
    name: "valid maximum single spacing node",
    bytes: odt('<text:p>A<text:s text:c="100000"/>B</text:p>'),
    length: 100002,
  },
  {
    name: "cumulative siblings",
    bytes: odt('<text:p>A<text:s text:c="100000"/>B</text:p>'.repeat(90)),
    error: "presupuesto de texto",
  },
  {
    name: "namespace and numeric attribute alias",
    bytes: odt('<t:p>A<t:s t:c="&#51;"/>B</t:p>', { prefix: "t" }),
    options: { maxGeneratedText: 4 },
    error: "presupuesto de texto",
  },
  {
    name: "UTF16 alias in lazy mode",
    bytes: odt('<t:p>A<t:s t:c="&#51;"/>B</t:p>', { prefix: "t", utf16: true }),
    options: { lazy: true },
    expected: "A   B",
  },
  {
    name: "lazy cumulative budget",
    bytes: odt('<text:p>A<text:s text:c="100"/>B</text:p>'.repeat(4)),
    options: { lazy: true, maxGeneratedText: 300 },
    error: "presupuesto de texto",
  },
  {
    name: "metadata never expands spacing nodes",
    bytes: odt('<text:p>A<text:s text:c="100000"/>B</text:p>'.repeat(90)),
    options: { metadataOnly: true, maxGeneratedText: 2 },
    metadata: true,
  },
  {
    name: "converted node budget",
    bytes: odt("<text:p><text:span>A</text:span></text:p>".repeat(20)),
    options: { maxConvertedNodes: 15 },
    error: "presupuesto de nodos",
  },
  {
    name: "nested output depth",
    bytes: odt(
      "<text:p>" +
        "<text:span>".repeat(30) +
        "A" +
        "</text:span>".repeat(30) +
        "</text:p>",
    ),
    options: { maxNestingDepth: 20 },
    error: "profundidad",
  },
  {
    name: "style-generated wrappers",
    bytes: odt(
      '<text:p><text:span text:style-name="s0">A</text:span></text:p>',
      {
        styles: Array.from(
          { length: 30 },
          (_, i) =>
            `<style:style style:name="s${i}" ${i < 29 ? `style:parent-style-name="s${i + 1}"` : ""}><style:text-properties fo:font-weight="bold"/></style:style>`,
        ).join(""),
      },
    ),
    options: { maxConvertedNodes: 15 },
    error: "presupuesto de nodos",
  },
];
try {
  const page = await browser.newPage();
  await page.route(`${origin}__resource_security`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body>Resource boundary fixtures</body></html>",
    }),
  );
  await page.goto(`${origin}__resource_security`);
  const results = await page.evaluate(async (cases) => {
    const { parseOdt } = await import("/src/core/odt.mjs");
    const results = [];
    for (const item of cases) {
      let book;
      try {
        book = await parseOdt(
          new Uint8Array(item.bytes),
          "Fixture.odt",
          item.options ?? {},
        );
        await book.ensureChapter?.(0);
        results.push({
          name: item.name,
          text: book.chapters[0]?.text?.trim(),
          chapters: book.chapters.length,
        });
      } catch (error) {
        results.push({ name: item.name, error: String(error) });
      } finally {
        await book?.dispose?.();
      }
    }
    return results;
  }, cases);
  for (let i = 0; i < cases.length; i++) {
    const item = cases[i],
      result = results[i];
    if (item.error)
      assert.ok(
        result.error?.includes(item.error),
        `${item.name}: ${JSON.stringify(result)}`,
      );
    else {
      assert.equal(result.error, undefined, item.name);
      if (item.expected) assert.equal(result.text, item.expected, item.name);
      if (item.length) assert.equal(result.text.length, item.length, item.name);
      if (item.metadata) assert.equal(result.chapters, 0, item.name);
    }
  }
  const limits = { perEntry: 2000, perOperation: 2000 };
  const image = new Uint8Array(800);
  image.set(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const imageEntries = Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [`image-${i}.png`, image]),
  );
  const imageOdt = [
    ...zipSync({
      ...imageEntries,
      "content.xml": strToU8(
        `<office:document-content xmlns:office="${office}" xmlns:text="${text}" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><office:body><office:text><text:p>Images${[0, 1, 2].map((i) => `<draw:image xlink:href="image-${i}.png"/>`).join("")}</text:p></office:text></office:body></office:document-content>`,
      ),
    }),
  ];
  const comic = [...zipSync(imageEntries)];
  const epub = [
    ...zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
      ),
      "book.opf": strToU8(
        '<package><manifest><item id="chapter" href="chapter.html" media-type="application/xhtml+xml"/>' +
          [0, 1, 2]
            .map(
              (i) =>
                `<item id="nav${i}" href="nav${i}.html" media-type="application/xhtml+xml" properties="nav"/>`,
            )
            .join("") +
          '</manifest><spine><itemref idref="chapter"/></spine></package>',
      ),
      "chapter.html": strToU8("<p>Chapter</p>"),
      ...Object.fromEntries(
        [0, 1, 2].map((i) => [
          `nav${i}.html`,
          strToU8("<nav>" + " ".repeat(790) + "</nav>"),
        ]),
      ),
    }),
  ];
  const aggregates = await page.evaluate(
    async ({ imageOdt, comic, epub, limits }) => {
      const { parseOdt } = await import("/src/core/odt.mjs");
      const { parseComic } = await import("/src/core/comic.mjs");
      const { parseBook } = await import("/src/core/epub.mjs");
      const failures = [];
      for (const [name, parse] of [
        [
          "odt lazy chapter images",
          () =>
            parseOdt(new Uint8Array(imageOdt), "Images.odt", {
              lazy: true,
              archiveLimits: limits,
            }),
        ],
        [
          "cbz eager pages",
          () =>
            parseComic(new Uint8Array(comic), "Images.cbz", {
              archiveLimits: limits,
            }),
        ],
        [
          "epub navigation",
          () =>
            parseBook(new Uint8Array(epub), "epub", "Navigation", {
              lazy: true,
              archiveLimits: limits,
            }),
        ],
      ]) {
        let book;
        try {
          book = await parse();
          await book.ensureChapter?.(0);
          failures.push({ name, error: null });
        } catch (error) {
          failures.push({ name, error: String(error) });
        } finally {
          await book?.dispose?.();
        }
      }
      const book = await parseComic(new Uint8Array(comic), "Images.cbz", {
        lazy: true,
        archiveLimits: limits,
      });
      for (let round = 0; round < 2; round++)
        for (let i = 0; i < book.chapters.length; i++)
          await book.ensureChapter(i);
      const independent = book.chapters.length;
      await book.dispose();
      return { failures, independent };
    },
    { imageOdt, comic, epub, limits },
  );
  for (const result of aggregates.failures)
    assert.ok(result.error?.includes("presupuesto"), JSON.stringify(result));
  assert.equal(aggregates.independent, 6);
  console.log(
    JSON.stringify({
      passed: results.map((result) => result.name),
      aggregates,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
