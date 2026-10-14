// Shared domain logic for the native reader. No browser, account or UI dependency.
import { THEMES, FONTS, NUMBER_PREFERENCES } from "./appearance.mjs";
import { SPEECH_LANGUAGES } from "./voice-selection.mjs";
import { UI_LANGUAGES } from "./i18n.mjs";
import { CATALOG_FORMATS as FORMATS } from "./document-formats.mjs";
import {
  normalizeBookLanguage,
  normalizeLibraryFilters,
  matchesExtraFilters,
  availabilitySets,
  normalizeSavedViews,
} from "./library-filters.mjs";
const VIEWS = new Set(["covers", "spines", "list"]);
const normalize = (value) => String(value).normalize("NFKC").trim();
const fold = (value) => normalize(value).toLocaleLowerCase("es");
const groupKey = (value) => fold(value).normalize("NFD").replace(/\p{M}/gu, "");
const collator = new Intl.Collator("es", {
  numeric: true,
  sensitivity: "base",
});
const compare = (a, b) => collator.compare(a, b);
const copy = (value) => structuredClone(value);

function text(value, field) {
  if (typeof value !== "string" || !normalize(value))
    throw new TypeError(field + " debe tener texto.");
  return normalize(value);
}
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError("Fecha no válida.");
  return value;
}
function genres(values = []) {
  if (!Array.isArray(values))
    throw new TypeError("Los géneros deben ser una lista.");
  const unique = new Map();
  for (const value of values) {
    const name = text(value, "El género");
    if (!unique.has(fold(name))) unique.set(fold(name), name);
  }
  return [...unique.values()];
}
function seriesName(value = "") {
  if (typeof value !== "string") throw new TypeError("Saga no válida.");
  return normalize(value);
}
function seriesPosition(value = null) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new TypeError("Posición de saga no válida.");
  return value;
}
function collections(values = []) {
  if (!Array.isArray(values))
    throw new TypeError("Las colecciones deben ser una lista.");
  const unique = new Map();
  for (const value of values) {
    const name = text(value, "La colección");
    if (!unique.has(groupKey(name))) unique.set(groupKey(name), name);
  }
  return [...unique.values()];
}

const annotationId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
export function normalizeAnnotation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Anotación no válida.");
  if (
    !annotationId(value.id) ||
    !["bookmark", "highlight", "note"].includes(value.type) ||
    !Number.isSafeInteger(value.start) ||
    value.start < 0 ||
    !Number.isSafeInteger(value.end) ||
    value.end < value.start ||
    (value.type !== "bookmark" && value.end === value.start) ||
    !["yellow", "green", "blue", "pink"].includes(value.color) ||
    typeof value.deleted !== "boolean" ||
    ["quote", "note", "label"].some((field) => typeof value[field] !== "string")
  )
    throw new TypeError("Anotación no válida.");
  const createdAt = timestamp(value.createdAt),
    updatedAt = timestamp(value.updatedAt);
  if (updatedAt < createdAt)
    throw new TypeError("Fecha de anotación no válida.");
  return {
    id: value.id,
    type: value.type,
    chapter: text(value.chapter, "El capítulo"),
    start: value.start,
    end: value.end,
    quote: value.quote,
    note: value.note,
    label: value.label,
    color: value.color,
    createdAt,
    updatedAt,
    deleted: value.deleted,
  };
}
function annotations(values = []) {
  if (!Array.isArray(values))
    throw new TypeError("Las anotaciones deben ser una lista.");
  const unique = new Map();
  for (const value of values) {
    const item = normalizeAnnotation(value);
    if (unique.has(item.id))
      throw new TypeError("Identificador de anotación repetido.");
    unique.set(item.id, item);
  }
  return [...unique.values()].sort((a, b) => compare(a.id, b.id));
}

export function primaryGenre(book) {
  for (const entry of book.genres ?? []) {
    const name = String(entry).split(",").map(normalize).find(Boolean);
    if (name) return name;
  }
  return "";
}
function replace(library, id, change) {
  if (!library.books.some((book) => book.id === id))
    throw new Error("No se encontró el libro.");
  return {
    ...library,
    books: library.books.map((book) =>
      book.id === id ? change({ ...book }) : book,
    ),
  };
}

export function createLibrary() {
  return { version: 1, preferences: { view: "covers" }, books: [] };
}

const driveId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
export function setDriveFolder(library, folder) {
  if (!folder || !driveId(folder.id) || typeof folder.name !== "string")
    throw new TypeError("Carpeta de Drive no válida.");
  return { ...library, driveFolder: { id: folder.id, name: folder.name } };
}
export function linkDriveBooks(library, bindings) {
  const updates = new Map();
  for (const binding of bindings) {
    const book = library.books.find((b) => b.id === binding.id);
    if (!book) continue;
    const source = binding.driveSource;
    if (
      !source ||
      !driveId(source.fileId) ||
      !driveId(source.folderId) ||
      source.sha256 !== book.id
    )
      throw new TypeError("Referencia de Drive no válida.");
    updates.set(book.id, {
      fileId: source.fileId,
      folderId: source.folderId,
      sha256: source.sha256,
    });
  }
  let changed = false;
  const books = library.books.map((book) => {
    const source = updates.get(book.id);
    if (
      !source ||
      (book.driveSource?.fileId === source.fileId &&
        book.driveSource?.folderId === source.folderId &&
        book.driveSource?.sha256 === source.sha256)
    )
      return book;
    changed = true;
    return { ...book, driveSource: source };
  });
  return changed ? { ...library, books } : library;
}

export function addBook(library, input, now = Date.now()) {
  const id = text(input.id, "El identificador");
  // A repeated import must preserve customization, progress and pin placement.
  if (library.books.some((book) => book.id === id))
    return input.driveSource
      ? linkDriveBooks(library, [{ id, driveSource: input.driveSource }])
      : library;
  const format = fold(input.format);
  if (!FORMATS.has(format)) throw new TypeError("Formato no reconocido.");
  const title = text(input.title, "El título");
  const author =
    typeof input.author === "string" ? normalize(input.author) : "";
  const book = {
    id,
    title,
    author,
    format,
    language: normalizeBookLanguage(input.language),
    genres: genres(input.genres),
    series: seriesName(input.series),
    seriesIndex: seriesPosition(input.seriesIndex),
    collections: collections(input.collections),
    annotations: annotations(input.annotations),
    cover: typeof input.cover === "string" ? input.cover : null,
    importedMetadata: { title, author },
    addedAt: timestamp(now),
    lastReadAt: null,
    pinOrder: null,
    progress: 0,
    locator: null,
    audioPosition: null,
  };
  const next = { ...library, books: [...library.books, book] };
  return input.driveSource
    ? linkDriveBooks(next, [{ id, driveSource: input.driveSource }])
    : next;
}

export function editBook(library, id, patch) {
  return editBooks(library, [id], patch);
}

function metadataPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new TypeError("Cambios de metadatos no válidos.");
  const allowed = new Set([
    "title",
    "author",
    "genres",
    "cover",
    "series",
    "seriesIndex",
    "collections",
    "language",
  ]);
  for (const key of Object.keys(patch))
    if (!allowed.has(key)) throw new TypeError("Campo no editable: " + key);
  const changes = {};
  if ("title" in patch) changes.title = text(patch.title, "El título");
  if ("author" in patch) {
    if (typeof patch.author !== "string")
      throw new TypeError("Autor no válido.");
    changes.author = normalize(patch.author);
  }
  if ("genres" in patch) changes.genres = genres(patch.genres);
  if ("language" in patch)
    changes.language = normalizeBookLanguage(patch.language);
  if ("series" in patch) changes.series = seriesName(patch.series);
  if ("seriesIndex" in patch)
    changes.seriesIndex = seriesPosition(patch.seriesIndex);
  if ("collections" in patch)
    changes.collections = collections(patch.collections);
  if ("cover" in patch) {
    if (patch.cover !== null && typeof patch.cover !== "string")
      throw new TypeError("Portada no válida.");
    changes.cover = patch.cover;
  }
  return changes;
}

export function editBooks(library, ids, patch) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== "string" || !id) ||
    new Set(ids).size !== ids.length
  )
    throw new TypeError("Selección de libros no válida.");
  const selected = new Set(ids);
  if (
    library.books.filter((book) => selected.has(book.id)).length !==
    selected.size
  )
    throw new Error("No se encontró el libro.");
  const changes = metadataPatch(patch);
  if (!Object.keys(changes).length) return library;
  return {
    ...library,
    books: library.books.map((book) =>
      selected.has(book.id)
        ? {
            ...book,
            ...changes,
            // Each edited book owns its arrays; untouched books and full covers are reused.
            ...("genres" in changes ? { genres: [...changes.genres] } : {}),
            ...("collections" in changes
              ? { collections: [...changes.collections] }
              : {}),
          }
        : book,
    ),
  };
}

export function upsertAnnotation(library, bookId, annotation) {
  const item = normalizeAnnotation(annotation);
  const book = library.books.find((entry) => entry.id === bookId);
  if (!book) throw new Error("No se encontró el libro.");
  const previous = (book.annotations ?? []).find(
    (entry) => entry.id === item.id,
  );
  if (previous && previous.createdAt !== item.createdAt)
    throw new TypeError("La fecha original de la anotación no puede cambiar.");
  if (previous && JSON.stringify(previous) === JSON.stringify(item))
    return library;
  const items = previous
    ? book.annotations.map((entry) => (entry.id === item.id ? item : entry))
    : [...(book.annotations ?? []), item];
  items.sort((a, b) => compare(a.id, b.id));
  return {
    ...library,
    books: library.books.map((entry) =>
      entry.id === bookId ? { ...entry, annotations: items } : entry,
    ),
  };
}

export function deleteAnnotation(library, bookId, id, now = Date.now()) {
  if (!annotationId(id))
    throw new TypeError("Identificador de anotación no válido.");
  const book = library.books.find((entry) => entry.id === bookId);
  if (!book) throw new Error("No se encontró el libro.");
  const item = (book.annotations ?? []).find((entry) => entry.id === id);
  if (!item) throw new Error("No se encontró la anotación.");
  if (item.deleted) return library;
  return upsertAnnotation(library, bookId, {
    ...item,
    deleted: true,
    updatedAt: Math.max(timestamp(now), item.updatedAt),
  });
}

export function visibleAnnotations(book, { chapter } = {}) {
  return (book.annotations ?? [])
    .filter(
      (entry) => !entry.deleted && (!chapter || entry.chapter === chapter),
    )
    .sort(
      (a, b) =>
        compare(a.chapter, b.chapter) ||
        a.start - b.start ||
        a.end - b.end ||
        a.createdAt - b.createdAt ||
        compare(a.id, b.id),
    )
    .map(copy);
}

export function pinBook(library, id, pinned = true) {
  if (typeof pinned !== "boolean")
    throw new TypeError("Estado de fijado no válido.");
  const next =
    library.books.reduce(
      (highest, book) => Math.max(highest, book.pinOrder ?? -1),
      -1,
    ) + 1;
  return replace(library, id, (book) => {
    book.pinOrder = pinned ? (book.pinOrder ?? next) : null;
    return book;
  });
}

export function reorderPins(library, ids) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length)
    throw new TypeError("Orden de fijados no válido.");
  const pinned = library.books
    .filter((book) => book.pinOrder !== null)
    .sort((a, b) => a.pinOrder - b.pinOrder);
  if (ids.some((id) => !pinned.some((book) => book.id === id)))
    throw new Error("Solo se pueden ordenar libros fijados.");
  const order = [
    ...ids,
    ...pinned.map((book) => book.id).filter((id) => !ids.includes(id)),
  ];
  const positions = new Map(order.map((id, index) => [id, index]));
  return {
    ...library,
    books: library.books.map((book) =>
      book.pinOrder === null
        ? book
        : { ...book, pinOrder: positions.get(book.id) },
    ),
  };
}

export function markRead(library, id, { progress, locator }, now = Date.now()) {
  if (
    typeof progress !== "number" ||
    !Number.isFinite(progress) ||
    progress < 0 ||
    progress > 1
  )
    throw new TypeError("El progreso debe estar entre 0 y 1.");
  if (locator === undefined)
    throw new TypeError("Falta la posición de lectura.");
  if (
    locator &&
    typeof locator === "object" &&
    "offset" in locator &&
    (!Number.isSafeInteger(locator.offset) || locator.offset < 0)
  )
    throw new TypeError("Desplazamiento de lectura no válido.");
  const position = JSON.parse(JSON.stringify(locator));
  return replace(library, id, (book) => ({
    ...book,
    progress,
    locator: position,
    lastReadAt: timestamp(now),
  }));
}

export function setAudioPosition(
  library,
  id,
  { chapter, offset, voice, rate = 1 },
) {
  const chapterId = text(chapter, "El capítulo");
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    typeof rate !== "number" ||
    !Number.isFinite(rate) ||
    rate <= 0
  )
    throw new TypeError("Posición de audio no válida.");
  const voiceId = text(voice, "La voz");
  return replace(library, id, (book) => ({
    ...book,
    audioPosition: { chapter: chapterId, offset, voice: voiceId, rate },
  }));
}

export function setView(library, view) {
  if (!VIEWS.has(view)) throw new TypeError("Vista no válida.");
  return { ...library, preferences: { ...library.preferences, view } };
}

export function queryBooks(
  library,
  {
    section = "all",
    genre,
    series,
    collection,
    search = "",
    sort,
    author,
    language,
    format,
    readingState,
    availability,
    localIds,
    cloudIds,
    clone = true,
  } = {},
) {
  if (
    ![
      "all",
      "pinned",
      "recent",
      "reading",
      "finished",
      "recentlyRead",
      "unread",
    ].includes(section)
  )
    throw new TypeError("Sección no válida.");
  const filters = normalizeLibraryFilters(
    Object.fromEntries(
      Object.entries({
        author,
        language,
        format,
        readingState,
        availability,
      }).filter(([, value]) => value !== undefined),
    ),
  );
  const files = availabilitySets({ localIds, cloudIds });
  const query = fold(search);
  const result = library.books.filter((book) => {
    if (section === "pinned" && book.pinOrder === null) return false;
    if (
      section === "reading" &&
      (book.lastReadAt === null || book.progress >= 1)
    )
      return false;
    if (section === "finished" && book.progress !== 1) return false;
    if (section === "recentlyRead" && book.lastReadAt === null) return false;
    if (
      section === "unread" &&
      (book.lastReadAt !== null || book.progress !== 0)
    )
      return false;
    if (!matchesExtraFilters(book, filters, files)) return false;
    if (genre && groupKey(primaryGenre(book)) !== groupKey(genre)) return false;
    if (series && groupKey(book.series ?? "") !== groupKey(series))
      return false;
    if (
      collection &&
      !(book.collections ?? []).some(
        (name) => groupKey(name) === groupKey(collection),
      )
    )
      return false;
    return (
      !query ||
      fold(
        [
          book.title,
          book.author,
          book.series ?? "",
          ...book.genres,
          ...(book.collections ?? []),
        ].join(" "),
      ).includes(query)
    );
  });
  const ordering =
    sort ||
    (section === "pinned"
      ? "pin"
      : section === "recentlyRead"
        ? "read"
        : section === "recent"
          ? "added"
          : series
            ? "series"
            : "title");
  if (!["pin", "read", "added", "title", "author", "series"].includes(ordering))
    throw new TypeError("Orden no válido.");
  return result
    .sort((a, b) => {
      const difference =
        ordering === "pin"
          ? (a.pinOrder ?? Infinity) - (b.pinOrder ?? Infinity)
          : ordering === "read"
            ? (b.lastReadAt ?? -1) - (a.lastReadAt ?? -1)
            : ordering === "added"
              ? b.addedAt - a.addedAt
              : ordering === "series"
                ? compare(groupKey(a.series ?? ""), groupKey(b.series ?? "")) ||
                  (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity)
                : ordering === "author"
                  ? compare(a.author, b.author)
                  : compare(a.title, b.title);
      return difference || compare(a.title, b.title) || compare(a.id, b.id);
    })
    .map((book) => (clone ? copy(book) : book));
}

function groups(library, namesForBook, { clone = true } = {}, series = false) {
  const grouped = new Map();
  for (const book of library.books) {
    for (const name of namesForBook(book)) {
      if (!name) continue;
      const key = groupKey(name);
      if (!grouped.has(key)) grouped.set(key, { name, books: [] });
      grouped.get(key).books.push(book);
    }
  }
  return [...grouped.values()]
    .sort((a, b) => compare(a.name, b.name))
    .map((group) => ({
      name: group.name,
      books: group.books
        .sort(
          (a, b) =>
            (series
              ? (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity)
              : 0) ||
            compare(a.title, b.title) ||
            compare(a.id, b.id),
        )
        .map((book) => (clone ? copy(book) : book)),
    }));
}
export function genreShelves(library, options) {
  return groups(library, (book) => [primaryGenre(book)], options);
}
export function seriesGroups(library, options) {
  return groups(
    library,
    (book) => [normalize(book.series ?? "")],
    options,
    true,
  );
}
export function collectionGroups(library, options) {
  return groups(library, (book) => book.collections ?? [], options);
}

export function exportLibrary(library) {
  return JSON.stringify(library, null, 2);
}

export function importLibrary(json) {
  const input = typeof json === "string" ? JSON.parse(json) : json;
  if (!input || input.version !== 1 || !Array.isArray(input.books))
    throw new TypeError("Copia de biblioteca no compatible.");
  let library = setView(createLibrary(), input.preferences?.view ?? "covers");
  if (input.driveFolder) library = setDriveFolder(library, input.driveFolder);
  const preferences = input.preferences ?? {};
  if ("savedViews" in preferences)
    library.preferences.savedViews = normalizeSavedViews(
      preferences.savedViews,
    );
  for (const [key, options] of [
    ["theme", THEMES.map((t) => t.id)],
    ["pageTheme", ["auto", ...THEMES.map((t) => t.id)]],
    ["font", FONTS.map((f) => f.id)],
    ["textAlign", ["left", "justify"]],
    ["uiLanguage", UI_LANGUAGES.map((l) => l.id)],
    ["speechLanguage", ["auto", ...SPEECH_LANGUAGES]],
    ["spineStyle", ["illustrated", "color", "classic"]],
    ["readingMode", ["scroll", "page", "spread", "vertical"]],
    ["pdfView", ["original", "text"]],
    ["pdfZoom", ["fit-page", "fit-width", "1", "1.25", "1.5", "2", "3"]],
    ["pdfLayout", ["page", "spread"]],
  ]) {
    if (key in preferences) {
      if (!options.includes(preferences[key]))
        throw new TypeError("Preferencia no válida.");
      library.preferences[key] = preferences[key];
    }
  }
  for (const [key, [min, max]] of Object.entries(NUMBER_PREFERENCES)) {
    if (key in preferences) {
      const n = preferences[key];
      if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
        throw new TypeError("Preferencia no válida.");
      library.preferences[key] = n;
    }
  }
  if ("voice" in preferences) {
    if (typeof preferences.voice !== "string")
      throw new TypeError("Voz no válida.");
    library.preferences.voice = preferences.voice;
  }
  if ("downloadCloud" in preferences) {
    if (typeof preferences.downloadCloud !== "boolean")
      throw new TypeError("Preferencia de descarga no válida.");
    library.preferences.downloadCloud = preferences.downloadCloud;
  }
  if ("firstLineIndent" in preferences) {
    if (typeof preferences.firstLineIndent !== "boolean")
      throw new TypeError("Preferencia de página no válida.");
    library.preferences.firstLineIndent = preferences.firstLineIndent;
  }
  for (const record of input.books) {
    if (library.books.some((book) => book.id === record.id))
      throw new TypeError("Identificador repetido en la copia.");
    library = addBook(library, record, record.addedAt);
    if (record.lastReadAt !== null)
      library = markRead(
        library,
        record.id,
        { progress: record.progress, locator: record.locator },
        record.lastReadAt,
      );
    else if (record.progress !== 0 || record.locator !== null)
      throw new TypeError("Posición de lectura no válida en la copia.");
    if (record.audioPosition !== null)
      library = setAudioPosition(library, record.id, record.audioPosition);
    if (
      record.pinOrder !== null &&
      (!Number.isSafeInteger(record.pinOrder) || record.pinOrder < 0)
    )
      throw new TypeError("Orden de fijados no válido.");
    library = replace(library, record.id, (book) => ({
      ...book,
      pinOrder: record.pinOrder,
      importedMetadata: {
        title: text(record.importedMetadata?.title, "El título original"),
        author:
          typeof record.importedMetadata?.author === "string"
            ? normalize(record.importedMetadata.author)
            : "",
      },
    }));
  }
  const pins = library.books
    .filter((book) => book.pinOrder !== null)
    .map((book) => book.pinOrder);
  if (new Set(pins).size !== pins.length)
    throw new TypeError("Orden de fijados repetido.");
  return library;
}
