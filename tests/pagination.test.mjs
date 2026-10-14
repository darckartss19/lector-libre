import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeReadingMode,
  paginationGeometry,
  paginationPosition,
} from "../src/reader-pagination.mjs";

test("Only supported reading modes survive restored preferences", () => {
  for (const mode of ["scroll", "page", "spread"])
    assert.equal(normalizeReadingMode(mode), mode);
  for (const mode of ["columns", null, {}, undefined])
    assert.equal(normalizeReadingMode(mode), "scroll");
});
test("Spread keeps page edges aligned and collapses when the reader narrows", () => {
  const wide = paginationGeometry({
    width: 1200,
    height: 600,
    mode: "spread",
    pageWidth: 760,
    padding: 30,
  });
  assert.equal(wide.columns, 2);
  assert.equal(wide.proseWidth, wide.frameWidth - 2 * wide.padding);
  assert.equal(wide.viewStride, 2 * wide.columnStride);
  const narrow = paginationGeometry({
    width: 600,
    height: 500,
    mode: "spread",
  });
  assert.equal(narrow.columns, 1);
  assert.equal(narrow.effectiveMode, "page");
  assert.equal(narrow.frameWidth, 600);
  const tiny = paginationGeometry({ width: 8, height: 5, padding: 80 });
  assert.ok(tiny.columnWidth > 0);
  assert.ok(tiny.proseHeight > 0);
});
test("An odd final spread counts real pages and navigates one spread at a time", () => {
  assert.deepEqual(paginationPosition(5, 2, 2), {
    page: 5,
    pageEnd: 5,
    pageCount: 5,
    visiblePages: 2,
    view: 2,
    viewCount: 3,
    atStart: false,
    atEnd: true,
    fraction: 1,
  });
  assert.equal(paginationPosition(5, 2, 500).page, 5);
  assert.equal(paginationPosition(5, 2, -500).page, 1);
  assert.equal(paginationPosition(8, 1, 3).fraction, 3 / 7);
  assert.equal(paginationPosition(1, 2).fraction, 1);
});
