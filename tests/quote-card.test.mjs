import test from "node:test";
import assert from "node:assert/strict";
import {
  cardDimensions,
  defaultCard,
  surpriseCard,
  wrapCardText,
  fitCardText,
  quoteFilename,
  CARD_PRESETS,
  CARD_PRESET_CATEGORIES,
  allCardBackgrounds,
  isPhotoBackground,
  presetThumb,
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
test("photo background registry registers fifteen local preset backgrounds", () => {
  assert.equal(CARD_PRESETS.length, 15);
  const expected = [
    "starry-sky",
    "aurora",
    "moonlit-sea",
    "misty-mountains",
    "pine-lake",
    "sunset-dunes",
    "cloud-sea",
    "lavender-field",
    "rain-window",
    "autumn-forest",
    "snow-peaks",
    "tropical-shore",
    "cosmic-nebula",
    "botanical-light",
    "rose-dawn",
  ];
  assert.deepEqual(
    CARD_PRESETS.map((preset) => preset.id),
    expected,
  );
  for (const preset of CARD_PRESETS) {
    assert.equal(preset.url, `/quote-backgrounds/${preset.id}.webp`);
    assert.equal(typeof preset.name, "string");
    assert.ok(preset.name.length > 0);
    assert.equal(preset.photo, true);
  }
  assert.equal(
    CARD_PRESETS.find((preset) => preset.id === "autumn-forest").name,
    "Bosque otoñal",
  );
  assert.equal(
    CARD_PRESETS.find((preset) => preset.id === "botanical-light").name,
    "Luz botánica",
  );
  assert.equal(
    CARD_PRESETS.find((preset) => preset.id === "rose-dawn").name,
    "Amanecer rosado",
  );
  for (const preset of CARD_PRESETS) {
    assert.equal(preset.thumb, `/quote-backgrounds/${preset.id}-thumb.webp`);
    assert.ok(
      CARD_PRESET_CATEGORIES.includes(preset.category),
      `invalid category for ${preset.id}`,
    );
    assert.equal(presetThumb(preset.id), preset.thumb);
  }
  assert.equal(presetThumb("no-existe"), null);
});
test("preset categories are the five offline groups", () => {
  assert.deepEqual(CARD_PRESET_CATEGORIES, [
    "Todos",
    "Paisajes",
    "Cielos",
    "Texturas",
    "Colores",
  ]);
  const byCategory = {};
  for (const preset of CARD_PRESETS) {
    (byCategory[preset.category] ??= []).push(preset.id);
  }
  assert.ok(byCategory.Paisajes.length > 0);
  assert.ok(byCategory.Cielos.length > 0);
  assert.ok(byCategory.Texturas.length > 0);
  assert.ok(byCategory.Colores.length > 0);
  const categories = new Set(CARD_PRESETS.map((p) => p.category));
  assert.deepEqual([...categories].sort(), [
    "Cielos",
    "Colores",
    "Paisajes",
    "Texturas",
  ]);
});
test("background registry combines the eight procedural backgrounds with presets", () => {
  assert.equal(allCardBackgrounds().length, 23);
  assert.ok(allCardBackgrounds().some((b) => b.id === "paper"));
  assert.ok(allCardBackgrounds().some((b) => b.id === "starry-sky"));
  assert.ok(isPhotoBackground("custom"));
  assert.ok(isPhotoBackground("starry-sky"));
  assert.ok(isPhotoBackground("rose-dawn"));
  assert.ok(!isPhotoBackground("midnight"));
  assert.ok(!isPhotoBackground("paper"));
});
test("default card accepts blank freeform values without a book", () => {
  const card = defaultCard({ quote: "", title: "", author: "" });
  assert.equal(card.quote, "");
  assert.equal(card.title, "");
  assert.equal(card.author, "");
  assert.equal(card.attribution, true);
  assert.equal(card.format, "vertical");
});
test("surprise works across photo presets and keeps the source text", () => {
  const source = { quote: "Cita libre.", title: "", author: "" };
  const card = surpriseCard(defaultCard(source), () => 0.8);
  assert.equal(card.quote, source.quote);
  assert.equal(card.title, source.title);
  assert.equal(card.author, source.author);
  const backgrounds = new Set(allCardBackgrounds().map((b) => b.id));
  assert.ok(backgrounds.has(card.background));
  if (CARD_PRESETS.some((preset) => preset.id === card.background)) {
    assert.equal(card.color, "#eef2ff");
  }
});
test("surprise is deterministic for a fixed random source", () => {
  const card = defaultCard({ quote: "Q", title: "T", author: "A" });
  assert.equal(surpriseCard(card, () => 0.8).background, "snow-peaks");
  assert.equal(surpriseCard(card, () => 0.8).font, "typewriter");
  assert.equal(surpriseCard(card, () => 0.8).align, "center");
});
