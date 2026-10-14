import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { resolveResource, unzipBook } from "../src/core/epub.mjs";
test("EPUB paths resolve inside the archive and reject remote references", () => {
  assert.equal(
    resolveResource("OPS/Text/chapter.xhtml", "../Images/cover.jpg"),
    "OPS/Images/cover.jpg",
  );
  assert.throws(() => resolveResource("a.xhtml", "../../private"), /fuera/);
  assert.throws(
    () => resolveResource("a.xhtml", "https://example.com/image"),
    /externa/,
  );
});
test("EPUB extraction accepts large entries and only expands selected resources", () => {
  assert.equal(
    Object.keys(unzipBook(zipSync({ "test.txt": strToU8("texto") }))).length,
    1,
  );
  const archive = zipSync({
    large: new Uint8Array(20_000_001),
    text: strToU8("Capítulo"),
  });
  assert.equal(unzipBook(archive)["large"].length, 20_000_001);
  const selected = unzipBook(archive, ["text"]);
  assert.deepEqual(Object.keys(selected), ["text"]);
  assert.equal(new TextDecoder().decode(selected.text), "Capítulo");
});
test("EPUB archives are not capped at 5000 resources", () => {
  const resources = Object.fromEntries(
    Array.from({ length: 5001 }, (_, i) => [`${i}.txt`, strToU8("a")]),
  );
  assert.equal(Object.keys(unzipBook(zipSync(resources))).length, 5001);
});
