import test from "node:test";
import assert from "node:assert/strict";
import {
  createLibrary,
  addBook,
  linkDriveBooks,
  editBook,
} from "../src/core/library.mjs";
import { stampChanges, mergeSnapshots } from "../src/core/sync.mjs";
import { sameMembers, transferBooks } from "../src/core/ui-state.mjs";

test("unchanged cloud merges and original references retain the local snapshot", () => {
  const id = "a".repeat(64);
  const empty = createLibrary();
  const linked = linkDriveBooks(
    addBook(empty, { id, title: "Libro", format: "epub" }, 1),
    [{ id, driveSource: { fileId: "file", folderId: "folder", sha256: id } }],
  );
  const local = stampChanges(empty, linked, "A", 2);
  assert.equal(mergeSnapshots(local, []), local);
  assert.equal(mergeSnapshots(local, [structuredClone(local)]), local);
  assert.equal(
    linkDriveBooks(local, [{ id, driveSource: local.books[0].driveSource }]),
    local,
  );
  const remote = stampChanges(
    local,
    editBook(local, id, { title: "Nuevo título" }),
    "B",
    3,
  );
  const merged = mergeSnapshots(local, [remote]);
  assert.equal(merged.books[0].title, "Nuevo título");
  assert.equal(local.books[0].title, "Libro");
  assert.equal(
    local.registers[JSON.stringify([id, "cover"])],
    remote.registers[JSON.stringify([id, "cover"])],
  );
});

test("book transfer requests exclude covers and the availability comparison ignores order", () => {
  const request = transferBooks([
    {
      id: "book",
      format: "epub",
      title: "Libro",
      cover: "private-image",
      locator: { chapter: "c" },
    },
  ]);
  assert.deepEqual(Object.keys(request[0]), [
    "id",
    "format",
    "title",
    "driveSource",
  ]);
  assert.equal(sameMembers(new Set(["a", "b"]), new Set(["b", "a"])), true);
  assert.equal(sameMembers(new Set(["a"]), new Set(["b"])), false);
});
