import test from "node:test";
import assert from "node:assert/strict";
import {
  cardDimensions,
  defaultCard,
  surpriseCard,
  wrapCardText,
  fitCardText,
  quoteFilename,
} from "../src/core/quote-card.mjs";
test("cards keep exact source text and attribution without modifying a book", () => {
  const source = {
      quote: "Un café.\nOtra línea.",
      title: "Título",
      author: "Autora",
    },
    before = structuredClone(source);
  assert.deepEqual(source, before);
  const card = defaultCard(source);
  assert.equal(card.quote, source.quote);
  assert.equal(card.attribution, true);
  assert.deepEqual(cardDimensions("square"), { width: 1080, height: 1080 });
  assert.deepEqual(cardDimensions("vertical"), { width: 1080, height: 1920 });
  assert.equal(surpriseCard(card, () => 0.8).quote, card.quote);
  assert.equal(surpriseCard(card, () => 0.8).title, card.title);
});
test("line wrapping retains words, paragraphs and complete Unicode clusters", () => {
  const text =
    "Una frase larga.\n\n\u{1f468}‍\u{1f469}‍\u{1f467}‍\u{1f466}caféabcdefghi";
  const lines = wrapCardText(text, 6, (value) => [...value].length);
  assert.equal(lines.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  assert.ok(lines.includes(""));
  assert.ok(
    lines.some((line) =>
      line.includes("\u{1f468}‍\u{1f469}‍\u{1f467}‍\u{1f466}"),
    ),
  );
});
test("auto-fit reduces size, while excessive text is reported instead of truncated", () => {
  const opts = {
    width: 100,
    height: 100,
    preferredSize: 64,
    minimum: 24,
    measure: (text, size) => text.length * size * 0.5,
  };
  const fitted = fitCardText("Una frase", opts);
  assert.ok(fitted.fits);
  assert.ok(fitted.size < 64);
  const long = fitCardText("larguísima ".repeat(300), opts);
  assert.equal(long.fits, false);
  assert.equal(
    long.lines.join(" ").replace(/\s/g, ""),
    "larguísima".repeat(300),
  );
});
test("export filenames preserve readable titles and remove path/control characters", () => {
  assert.equal(
    quoteFilename("../Una: lectura?\n"),
    "Cita - .. Una lectura.png",
  );
  assert.equal(quoteFilename("..."), "Cita - Lectura.png");
});
