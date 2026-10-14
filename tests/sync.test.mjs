import test from "node:test";
import assert from "node:assert/strict";
import {
  createLibrary,
  addBook,
  markRead,
  editBook,
  pinBook,
  setAudioPosition,
  setDriveFolder,
  linkDriveBooks,
} from "../src/core/library.mjs";
import { stampChanges, mergeSnapshots } from "../src/core/sync.mjs";
const seed = () =>
  stampChanges(
    createLibrary(),
    addBook(
      createLibrary(),
      { id: "book", format: "epub", title: "Libro", author: "Autora" },
      1,
    ),
    "A",
    10,
  );
test("two offline devices keep both an edited title and a reading position", () => {
  const original = seed();
  const a = stampChanges(
    original,
    editBook(original, "book", { title: "Mi título" }),
    "A",
    20,
  );
  const b = stampChanges(
    original,
    markRead(
      original,
      "book",
      { progress: 0.6, locator: { chapter: "2", fraction: 0.3 } },
      22,
    ),
    "B",
    22,
  );
  const result = mergeSnapshots(a, [b]);
  assert.equal(result.books[0].title, "Mi título");
  assert.equal(result.books[0].progress, 0.6);
  assert.deepEqual(result.books[0].locator, { chapter: "2", fraction: 0.3 });
  assert.deepEqual(mergeSnapshots(b, [a]).books, result.books);
});
test("series and numeric order synchronize independently from reading and survive fresh-device recovery", () => {
  const base = seed();
  const a = stampChanges(
    base,
    editBook(base, "book", { series: "Crónicas", seriesIndex: 0.5 }),
    "A",
    20,
  );
  const b = stampChanges(
    base,
    markRead(base, "book", { progress: 0.8, locator: { chapter: "c2" } }, 25),
    "B",
    25,
  );
  const merged = mergeSnapshots(a, [b]);
  assert.equal(merged.books[0].series, "Crónicas");
  assert.equal(merged.books[0].seriesIndex, 0.5);
  assert.equal(merged.books[0].progress, 0.8);
  assert.deepEqual(mergeSnapshots(b, [a]).books, merged.books);
  const fresh = mergeSnapshots(createLibrary(), [
    JSON.parse(JSON.stringify(merged)),
  ]);
  assert.deepEqual(fresh.books, merged.books);
  const cleared = stampChanges(
    merged,
    editBook(merged, "book", { series: "", seriesIndex: null }),
    "A",
    30,
  );
  assert.equal(mergeSnapshots(merged, [cleared]).books[0].series, "");
  assert.equal(mergeSnapshots(merged, [cleared]).books[0].seriesIndex, null);
});
test("legacy cloud snapshots without series recover safely and cannot erase a newer series assignment", () => {
  const legacy = seed();
  delete legacy.books[0].series;
  delete legacy.books[0].seriesIndex;
  for (const key of Object.keys(legacy.registers))
    if (["series", "seriesIndex"].includes(JSON.parse(key)[1]))
      delete legacy.registers[key];
  const recovered = mergeSnapshots(createLibrary(), [legacy]);
  assert.equal(recovered.books[0].series, "");
  assert.equal(recovered.books[0].seriesIndex, null);
  const updated = stampChanges(
    recovered,
    editBook(recovered, "book", { series: "Nueva saga", seriesIndex: 2 }),
    "B",
    20,
  );
  const olderDevice = stampChanges(
    legacy,
    editBook(legacy, "book", { title: "Título desde versión anterior" }),
    "A",
    30,
  );
  const result = mergeSnapshots(updated, [olderDevice]);
  assert.equal(result.books[0].title, "Título desde versión anterior");
  assert.equal(result.books[0].series, "Nueva saga");
  assert.equal(result.books[0].seriesIndex, 2);
});
test("invalid cloud series positions are rejected without changing the saved local state", () => {
  const local = seed();
  const snapshot = structuredClone(local);
  snapshot.registers[JSON.stringify(["book", "seriesIndex"])] = {
    time: 20,
    counter: 0,
    device: "B",
    value: -1,
  };
  assert.throws(() => mergeSnapshots(local, [snapshot]), /saga/);
  assert.equal(local.books[0].seriesIndex, null);
  assert.equal(
    local.registers[JSON.stringify(["book", "seriesIndex"])].value,
    null,
  );
});
test("newer backwards reading wins rather than highest percentage", () => {
  const first = seed(),
    forward = stampChanges(
      first,
      markRead(first, "book", { progress: 0.9, locator: { chapter: "9" } }, 30),
      "A",
      30,
    );
  const back = stampChanges(
    forward,
    markRead(forward, "book", { progress: 0.2, locator: { chapter: "2" } }, 40),
    "B",
    40,
  );
  const result = mergeSnapshots(forward, [back]);
  assert.equal(result.books[0].progress, 0.2);
  assert.equal(result.books[0].locator.chapter, "2");
  assert.equal(result.conflicts.length, 1);
});
test("preferences and repeated merges survive portable serialization", () => {
  const old = seed();
  const a = stampChanges(
    old,
    {
      ...old,
      preferences: {
        view: "spines",
        theme: "dark",
        font: "sans",
        fontSize: 24,
        lineHeight: 2,
        voice: "Voz",
        rate: 1.25,
      },
    },
    "A",
    20,
  );
  const b = mergeSnapshots(seed(), [JSON.parse(JSON.stringify(a))]);
  assert.deepEqual(b.preferences, a.preferences);
  assert.deepEqual(mergeSnapshots(b, [a]).books, b.books);
});
test("offline pin collisions converge to a stable order", () => {
  let base = seed();
  base = stampChanges(
    base,
    addBook(base, { id: "other", title: "Segundo", format: "txt" }, 2),
    "A",
    15,
  );
  const a = stampChanges(base, pinBook(base, "book"), "A", 30),
    b = stampChanges(base, pinBook(base, "other"), "B", 30);
  assert.deepEqual(mergeSnapshots(a, [b]).books, mergeSnapshots(b, [a]).books);
  assert.deepEqual(
    mergeSnapshots(a, [b])
      .books.map((b) => b.pinOrder)
      .sort(),
    [0, 1],
  );
});
test("malformed cloud records fail without changing the local library", () => {
  const local = seed();
  const snapshot = structuredClone(local);
  const record = Object.values(snapshot.registers)[0];
  record.time = -1;
  assert.throws(() => mergeSnapshots(local, [snapshot]), /válido/);
  assert.equal(local.books[0].title, "Libro");
});
test("a fresh device recovers preferences, metadata, pins and voice without replacing them with defaults", () => {
  let source = seed();
  let next = editBook(source, "book", {
    title: "Título personalizado",
    genres: ["Novela"],
  });
  next = pinBook(next, "book");
  next = markRead(
    next,
    "book",
    { progress: 0.4, locator: { chapter: "c2", fraction: 0.1 } },
    30,
  );
  next = setAudioPosition(next, "book", {
    chapter: "c2",
    offset: 120,
    voice: "Sabina",
    rate: 1.25,
  });
  next = {
    ...next,
    preferences: {
      view: "spines",
      theme: "sepia",
      downloadCloud: false,
      voice: "Sabina",
      rate: 1.25,
    },
  };
  source = stampChanges(source, next, "A", 30);
  const fresh = stampChanges(createLibrary(), createLibrary(), "B", 1000);
  const recovered = mergeSnapshots(fresh, [source]);
  assert.equal(recovered.deviceId, "B");
  assert.deepEqual(recovered.books, source.books);
  assert.deepEqual(recovered.preferences, source.preferences);
  // Reimporting bytes from Drive must keep personalized fields and both positions.
  const repeated = addBook(
    recovered,
    { id: "book", title: "Original", format: "epub", author: "Original" },
    2000,
  );
  assert.deepEqual(repeated, recovered);
});
test("the chosen Drive folder and original file survive syncing to a fresh device and repeated import", () => {
  const base = seed();
  let next = setDriveFolder(base, {
    id: "original-library",
    name: "Biblioteca organizada",
  });
  next = linkDriveBooks(next, [
    {
      id: "book",
      driveSource: {
        fileId: "original-book",
        folderId: "nested-author",
        sha256: "book",
      },
    },
  ]);
  next = markRead(
    next,
    "book",
    { progress: 0.3, locator: { chapter: "c2" } },
    30,
  );
  const source = stampChanges(base, next, "A", 40);
  const recovered = mergeSnapshots(
    stampChanges(createLibrary(), createLibrary(), "B", 1000),
    [JSON.parse(JSON.stringify(source))],
  );
  assert.deepEqual(recovered.driveFolder, next.driveFolder);
  assert.deepEqual(recovered.books[0].driveSource, next.books[0].driveSource);
  const reimported = addBook(recovered, {
    id: "book",
    title: "Original",
    format: "epub",
    driveSource: next.books[0].driveSource,
  });
  assert.equal(reimported.books[0].progress, 0.3);
  assert.equal(reimported.books[0].title, "Libro");
  assert.deepEqual(
    mergeSnapshots(source, [recovered]).driveFolder,
    source.driveFolder,
  );
});
test("original references cannot be assigned to a different book or unsafe Drive ID", () => {
  const base = seed();
  assert.throws(
    () =>
      linkDriveBooks(base, [
        {
          id: "book",
          driveSource: {
            fileId: "file",
            folderId: "root",
            sha256: "different",
          },
        },
      ]),
    /válida/,
  );
  assert.throws(
    () =>
      setDriveFolder(base, { id: "root' or trashed=true", name: "Carpeta" }),
    /válida/,
  );
  assert.equal(base.books[0].driveSource, undefined);
});
