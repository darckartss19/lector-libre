import test from "node:test";
import assert from "node:assert/strict";
import { chapterCache } from "../src/core/chapter-cache.mjs";
import { CoverCache } from "../src/core/cover-cache.mjs";
import { CloudSnapshot } from "../src/core/cloud-snapshot.mjs";

test("Chapters load on demand, coalesce requests and retain a bounded reading window", async () => {
  const chapters = Array.from({ length: 30 }, (_, i) => ({
    id: `c${i}`,
    title: `Chapter ${i}`,
  }));
  const requests = [];
  const cache = chapterCache(chapters, async (index) => {
    requests.push(index);
    return { text: `Text ${index}`, html: `<p>Text ${index}</p>` };
  });
  assert.equal(requests.length, 0);
  await Promise.all([cache.ensureChapter(20), cache.ensureChapter(20)]);
  assert.deepEqual(requests, [20]);
  for (let i = 21; i < 28; i++) await cache.ensureChapter(i);
  assert.equal(cache.loadedCount(), 4);
  assert.equal(chapters[20].html, undefined);
  const all = await cache.allChapters({ textOnly: true });
  assert.equal(all.length, 30);
  assert.ok(all.every((ch) => !("html" in ch)));
  assert.equal(cache.loadedCount(), 4);
  const found = [];
  await cache.visitChapters((chapter, index) => {
    if (chapter.text.includes("Text 29")) found.push(index);
  });
  assert.deepEqual(found, [29]);
  cache.disposeChapters();
  await assert.rejects(cache.ensureChapter(0), /cerrado/);
});
test("Late chapter requests cannot evict the currently requested chapter; errors can retry", async () => {
  const chapters = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}` }));
  const releases = new Map();
  const cache = chapterCache(
    chapters,
    (index) => new Promise((resolve) => releases.set(index, resolve)),
    { limit: 2 },
  );
  const jobs = [0, 1, 2, 3].map((index) => cache.ensureChapter(index));
  await Promise.resolve();
  releases.get(3)({ text: "current", html: "current" });
  await jobs[3];
  for (let i = 0; i < 3; i++) {
    releases.get(i)({ text: `old ${i}` });
    await jobs[i];
  }
  assert.equal(chapters[3].text, "current");
  let fails = true;
  const retry = chapterCache([{ id: "retry" }], () => {
    if (fails) throw Error("read failed");
    return { text: "ok" };
  });
  await assert.rejects(retry.ensureChapter(0));
  fails = false;
  assert.equal((await retry.ensureChapter(0)).text, "ok");
});
test("Cover URLs are bounded and originals remain independent of eviction", async () => {
  const originals = new Map(
    Array.from({ length: 5 }, (_, i) => [
      String(i).repeat(64),
      `data:image/png;base64,${Buffer.from(`picture-${i}`).toString("base64")}`,
    ]),
  );
  let reads = 0;
  const cache = new CoverCache(
    (hash) => {
      reads++;
      return originals.get(hash);
    },
    { maxEntries: 2 },
  );
  const ref = (i) => `@lector-cover:${String(i).repeat(64)}`;
  const [first, second] = await Promise.all([
    cache.url(ref(0)),
    cache.url(ref(0)),
  ]);
  assert.equal(first, second);
  assert.equal(reads, 1);
  for (let i = 1; i < 5; i++) await cache.url(ref(i));
  assert.equal(cache.entries.size, 2);
  assert.equal(await cache.original(ref(0)), originals.get("0".repeat(64)));
  cache.clear();
  assert.equal(cache.bytes, 0);
});
test("Cloud snapshots never expose local cover references and retain revisions", async () => {
  const ref = "@lector-cover:" + "a".repeat(64),
    cover = "data:image/png;base64,example";
  const library = {
    version: 1,
    books: [{ id: "book", cover: ref, progress: 0.4 }],
    registers: {
      '["book","cover"]': { value: ref, time: 1, counter: 0, device: "device" },
    },
  };
  const snapshot = new CloudSnapshot(
    async (value) => value,
    async (value) => (value === ref ? cover : value),
  );
  const wire = await snapshot.create(library);
  assert.equal(wire.books[0].cover, cover);
  assert.equal(wire.registers['["book","cover"]'].value, cover);
  assert.equal(library.books[0].cover, ref);
  assert.equal(JSON.stringify(wire).includes("@lector-cover:"), false);
});
