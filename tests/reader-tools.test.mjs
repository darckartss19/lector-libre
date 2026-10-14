import test from "node:test";
import assert from "node:assert/strict";
import { searchBook } from "../src/core/reader-tools.mjs";

test("la búsqueda conserva offsets originales al ignorar acentos y mayúsculas", () => {
  const text = "\u{1f989} Un café. Cafe\u0301, CAFÉ y cáfe.";
  const hits = searchBook([{ id: "one", text }], "cafe");
  assert.equal(hits.length, 4);
  assert.deepEqual(
    hits.map((hit) => hit.quote),
    ["café", "Cafe\u0301", "CAFÉ", "cáfe"],
  );
  for (const hit of hits) {
    assert.equal(text.slice(hit.start, hit.end), hit.quote);
    assert.equal(hit.chapter, "one");
    assert.equal(hit.chapterIndex, 0);
  }
  assert.equal(hits[0].start, text.indexOf("café"));
});

test("busca frases entre espacios consecutivos y mantiene el rango completo", () => {
  const hits = searchBook(
    [{ id: "one", text: "La CASA\n \tAZUL y casa\u00a0azul." }],
    "casa azul",
  );
  assert.deepEqual(
    hits.map((hit) => hit.quote),
    ["CASA\n \tAZUL", "casa\u00a0azul"],
  );
});

test("ordena capítulos y aplica el límite global sin cambiar sus contenidos", () => {
  const chapters = [
    { id: "a", text: "sol sol" },
    { id: "b", text: "Sol" },
  ];
  const saved = structuredClone(chapters);
  const hits = searchBook(chapters, "sol", { limit: 3 });
  assert.deepEqual(
    hits.map((hit) => [hit.chapter, hit.start]),
    [
      ["a", 0],
      ["a", 4],
      ["b", 0],
    ],
  );
  assert.equal(searchBook(chapters, "sol", { limit: 2 }).length, 2);
  assert.equal(searchBook(chapters, "sol", { limit: 0 }).length, 0);
  assert.equal(searchBook(chapters, "sol", { limit: -2 }).length, 0);
  assert.deepEqual(chapters, saved);
});

test("conserva emojis completos y evita duplicar una ligadura tipográfica", () => {
  const text = "Antes \u{1f469}‍\u{1f4bb} y después. Oﬁcina, ﬃ.";
  assert.equal(
    searchBook([{ id: "a", text }], "\u{1f469}‍\u{1f4bb}")[0].quote,
    "\u{1f469}‍\u{1f4bb}",
  );
  assert.equal(searchBook([{ id: "a", text }], "oficina")[0].quote, "Oﬁcina");
  assert.equal(searchBook([{ id: "a", text: "ﬃ" }], "f").length, 1);
});

test("ignora consulta vacía y produce contexto acotado", () => {
  assert.deepEqual(searchBook([{ id: "a", text: "algo" }], " \t\n"), []);
  const text = "a".repeat(200) + " aguja " + "b".repeat(200);
  const hit = searchBook([{ id: "a", text }], "aguja")[0];
  assert.equal(hit.context.length, 137);
  assert.ok(hit.context.startsWith("…"));
  assert.ok(hit.context.endsWith("…"));
  assert.equal(searchBook([{ id: "a", text }], "ausente").length, 0);
});

test("no usa texto de voz como ancla de capítulos HTML fuera del navegador", () => {
  assert.throws(
    () =>
      searchBook(
        [{ id: "a", html: "<p>uno</p><p>dos</p>", text: "uno\n\ndos" }],
        "dos",
      ),
    /HTML requieren/,
  );
});
