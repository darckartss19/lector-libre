import test from "node:test";
import assert from "node:assert/strict";
import {
  paletteFromPixels,
  readableInk,
  contrastRatio,
  fallbackSpine,
  isLocalCover,
} from "../src/core/spines.mjs";
import { createLibrary, addBook, importLibrary } from "../src/core/library.mjs";
import { stampChanges, mergeSnapshots } from "../src/core/sync.mjs";

test("spines take their dominant and accent colors from visible cover pixels", () => {
  const pixels = new Uint8ClampedArray([
    220, 40, 30, 255, 220, 40, 30, 255, 20, 40, 200, 255, 0, 0, 0, 0,
  ]);
  const design = paletteFromPixels(pixels);
  assert.equal(design.background, "#dc281e");
  assert.equal(design.accent, "#1428c8");
  assert.ok(contrastRatio(design.background, design.ink) >= 4.5);
  const fallback = fallbackSpine("book");
  assert.equal(paletteFromPixels(new Uint8Array(4), fallback), fallback);
});
test("title contrast remains readable across dark, light and intermediate cover colors", () => {
  for (const r of [0, 51, 102, 153, 204, 255])
    for (const g of [0, 51, 102, 153, 204, 255])
      for (const b of [0, 51, 102, 153, 204, 255]) {
        const color =
          "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
        assert.ok(contrastRatio(color, readableInk(color)) >= 4.5, color);
      }
});
test("missing covers get stable designs and remote or active content is never analyzed", () => {
  assert.deepEqual(fallbackSpine("book"), fallbackSpine("book"));
  assert.equal(isLocalCover("https://example.com/cover.jpg"), false);
  assert.equal(isLocalCover("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(isLocalCover('data:image/png;base64,aaa\" onerror=\"x'), false);
  assert.equal(isLocalCover("data:image/png;base64,AQID"), true);
});
test("spine preferences synchronize while original covers and progress stay intact", () => {
  const empty = createLibrary();
  const source = addBook(
    empty,
    {
      id: "book",
      title: "Libro",
      format: "epub",
      cover: "data:image/png;base64,AQID",
    },
    1,
  );
  const selected = {
    ...source,
    preferences: { ...source.preferences, spineStyle: "color" },
  };
  const registered = stampChanges(empty, selected, "A", 2);
  const merged = mergeSnapshots(stampChanges(empty, empty, "B", 1), [
    registered,
  ]);
  assert.equal(merged.preferences.spineStyle, "color");
  assert.equal(merged.books[0].cover, source.books[0].cover);
  assert.equal(merged.books[0].progress, 0);
  assert.throws(
    () =>
      importLibrary(
        JSON.stringify({ ...selected, preferences: { spineStyle: "unknown" } }),
      ),
    /válida/,
  );
});
