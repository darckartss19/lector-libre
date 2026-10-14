import assert from "node:assert/strict";
import test from "node:test";
import {
  statePatch,
  applyStatePatch,
  hydrateLocalCovers,
} from "../src/core/state-patch.mjs";
import {
  createLibrary,
  addBook,
  markRead,
  genreShelves,
  seriesGroups,
  collectionGroups,
  queryBooks,
} from "../src/core/library.mjs";
import { stampChanges } from "../src/core/sync.mjs";
test("Heavy covers are excluded from progress checkpoints; deltas preserve books and revisions", () => {
  let base = createLibrary();
  const cover = "data:image/png;base64," + "A".repeat(150000);
  for (let i = 0; i < 825; i++)
    base = addBook(
      base,
      { id: `book-${i}`, format: "epub", title: `Book ${i}`, cover },
      1,
    );
  base = stampChanges(createLibrary(), base, "test", 1);
  const before = base.books[10];
  const next = stampChanges(
    base,
    markRead(
      base,
      before.id,
      { progress: 0.25, locator: { chapter: "one", offset: 20 } },
      2,
    ),
    "test",
    2,
  );
  const patch = statePatch(base, next);
  assert.ok(JSON.stringify(patch).length < 2500);
  assert.equal(patch.books.length, 1);
  assert.equal(patch.books[0].set.cover, undefined);
  assert.equal(next.books[10].annotations, before.annotations);
  assert.deepEqual(applyStatePatch(base, patch), next);
});
test("Delta order, removals, new covers and preferences round-trip exactly", () => {
  let a = addBook(createLibrary(), { id: "a", format: "epub", title: "A" }, 1);
  let b = addBook(
    a,
    { id: "b", format: "pdf", title: "B", cover: "data:image/png;base64,test" },
    2,
  );
  b = {
    ...b,
    books: [b.books[1]],
    preferences: { ...b.preferences, theme: "night" },
    registers: { new: { value: "updated" } },
  };
  assert.deepEqual(applyStatePatch(a, statePatch(a, b)), b);
});
test("Local cover pools hydrate exact originals and reject missing assets", () => {
  const key = "a".repeat(64),
    cover = "data:image/png;base64,original";
  const state = {
    version: 1,
    books: [{ id: "a", cover: "@lector-cover:" + key }],
    registers: { '["a","cover"]': { value: "@lector-cover:" + key } },
    localCoverAssets: { [key]: cover },
  };
  const full = hydrateLocalCovers(state);
  assert.equal(full.books[0].cover, cover);
  assert.equal(full.registers['["a","cover"]'].value, cover);
  assert.equal(full.localCoverAssets, undefined);
  assert.throws(() => hydrateLocalCovers({ ...state, localCoverAssets: {} }));
});
test("Single-pass groups retain the full query order and membership", () => {
  let state = createLibrary();
  for (let i = 0; i < 70; i++)
    state = addBook(
      state,
      {
        id: `b${i}`,
        title: `Title ${70 - i}`,
        format: "epub",
        genres: [i % 2 ? "Áventura, Fantasía" : "aventura"],
        series: i % 3 ? "Sága" : "Otra",
        seriesIndex: i % 6,
        collections: [i % 2 ? "Favorítos" : "favoritos", "Todos"],
      },
      i,
    );
  for (const group of genreShelves(state, { clone: false }))
    assert.deepEqual(
      group.books,
      queryBooks(state, { genre: group.name, clone: false }),
    );
  for (const group of seriesGroups(state, { clone: false }))
    assert.deepEqual(
      group.books,
      queryBooks(state, { series: group.name, clone: false }),
    );
  for (const group of collectionGroups(state, { clone: false }))
    assert.deepEqual(
      group.books,
      queryBooks(state, { collection: group.name, clone: false }),
    );
});
