import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_FORMATS,
  READABLE_FORMATS,
  formatLabel,
} from "../src/core/document-formats.mjs";
import {
  addBook,
  createLibrary,
  importLibrary,
  exportLibrary,
  markRead,
  upsertAnnotation,
} from "../src/core/library.mjs";
import { saveLibraryView } from "../src/core/library-filters.mjs";
import { stampChanges, mergeSnapshots } from "../src/core/sync.mjs";

test("New formats preserve metadata, saved filters, progress and notes across export and sync", () => {
  for (const format of [
    "fb2",
    "docx",
    "odt",
    "html",
    "htm",
    "md",
    "markdown",
    "cbz",
  ]) {
    let library = createLibrary();
    const old = structuredClone(library);
    library = addBook(
      library,
      {
        id: "a".repeat(64),
        format,
        title: "Documento",
        author: "Autora",
        language: "es",
        series: "Saga",
        seriesIndex: 2,
      },
      1,
    );
    library = markRead(
      library,
      "a".repeat(64),
      {
        progress: 0.2,
        locator: { chapter: "section-2", fraction: 0.3, offset: 20 },
      },
      2,
    );
    library = upsertAnnotation(library, "a".repeat(64), {
      id: "note-1",
      type: "note",
      chapter: "section-2",
      start: 3,
      end: 8,
      quote: "texto",
      note: "Comentario",
      label: "",
      color: "yellow",
      createdAt: 3,
      updatedAt: 3,
      deleted: false,
    });
    library = saveLibraryView(
      library,
      { id: "view", name: "Documentos", filters: { format } },
      4,
    );
    assert.deepEqual(importLibrary(exportLibrary(library)), library);
    const stamped = stampChanges(old, library, "device-a", 5);
    const merged = mergeSnapshots(createLibrary(), [stamped]);
    assert.equal(merged.books[0].format, format);
    assert.equal(merged.books[0].locator.chapter, "section-2");
    assert.equal(merged.books[0].annotations[0].note, "Comentario");
    assert.equal(merged.preferences.savedViews[0].filters.format, format);
  }
});

test("Registry separates readable formats from legacy catalog-only formats", () => {
  assert.equal(
    new Set(DOCUMENT_FORMATS.map((entry) => entry.id)).size,
    DOCUMENT_FORMATS.length,
  );
  assert.ok(
    [...READABLE_FORMATS].every((format) => /^[a-z0-9]+$/.test(format)),
  );
  assert.equal(READABLE_FORMATS.has("mobi"), false);
  assert.equal(READABLE_FORMATS.has("azw3"), false);
  assert.equal(formatLabel("md"), "Markdown");
  assert.equal(formatLabel("htm"), "HTML");
});
