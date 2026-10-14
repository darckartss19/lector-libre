// Saved filters describe books, never paths or the files on a particular device.
import { CATALOG_FORMATS as FORMATS } from "./document-formats.mjs";
const SECTIONS = new Set([
  "all",
  "pinned",
  "recent",
  "reading",
  "finished",
  "recentlyRead",
  "unread",
]);
const SORTS = new Set(["pin", "read", "added", "title", "author", "series"]);
const STATES = new Set(["unread", "reading", "finished"]);
const AVAILABILITY = new Set(["local", "cloud", "missing"]);
const FILTERS = new Set([
  "section",
  "genre",
  "series",
  "collection",
  "search",
  "sort",
  "author",
  "language",
  "format",
  "readingState",
  "availability",
]);
const normalize = (value) => String(value).normalize("NFKC").trim();
const key = (value) =>
  normalize(value)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
const compare = (a, b) =>
  a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });

export function normalizeBookLanguage(value = "") {
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new TypeError("Idioma del libro no válido.");
  const language = normalize(value);
  if (!language) return "";
  try {
    return Intl.getCanonicalLocales(language.replaceAll("_", "-"))[0];
  } catch {
    // Some EPUB publishers use a language name instead of a BCP 47 tag.
    // Preserve that metadata; do not guess the language from the title or voice.
    return language;
  }
}

export function bookReadingState(book) {
  if (book.progress >= 1) return "finished";
  return book.lastReadAt !== null && book.lastReadAt !== undefined
    ? "reading"
    : "unread";
}

function idSet(values, field) {
  if (values === undefined) return new Set();
  if (!(values instanceof Set) && !Array.isArray(values))
    throw new TypeError("Disponibilidad de archivos no válida: " + field);
  if ([...values].some((value) => typeof value !== "string" || !value))
    throw new TypeError("Disponibilidad de archivos no válida: " + field);
  return values instanceof Set ? values : new Set(values);
}

export function availabilitySets({ localIds, cloudIds } = {}) {
  return { local: idSet(localIds, "local"), cloud: idSet(cloudIds, "cloud") };
}

export function bookAvailability(book, sets) {
  if (sets.local.has(book.id)) return "local";
  if (sets.cloud.has(book.id)) return "cloud";
  return "missing";
}

export function normalizeLibraryFilters(input = {}) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new TypeError("Filtros no válidos.");
  const result = {};
  for (const [field, value] of Object.entries(input)) {
    if (!FILTERS.has(field))
      throw new TypeError("Filtro no reconocido: " + field);
    if (
      typeof value !== "string" ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    )
      throw new TypeError("Filtro no válido: " + field);
    const clean = normalize(value);
    if (!clean) continue;
    if (field === "section" && !SECTIONS.has(clean))
      throw new TypeError("Sección no válida.");
    if (field === "sort" && !SORTS.has(clean))
      throw new TypeError("Orden no válido.");
    if (field === "format" && !FORMATS.has(clean.toLowerCase()))
      throw new TypeError("Formato no reconocido.");
    if (field === "readingState" && !STATES.has(clean))
      throw new TypeError("Estado de lectura no válido.");
    if (field === "availability" && !AVAILABILITY.has(clean))
      throw new TypeError("Disponibilidad no válida.");
    result[field] =
      field === "format"
        ? clean.toLowerCase()
        : field === "language" && clean !== "unknown"
          ? normalizeBookLanguage(clean)
          : clean;
  }
  return result;
}

export function matchesExtraFilters(book, filters, sets) {
  if (filters.author && key(book.author ?? "") !== key(filters.author))
    return false;
  if (
    filters.language === "unknown" &&
    normalizeBookLanguage(book.language ?? "")
  )
    return false;
  if (
    filters.language &&
    filters.language !== "unknown" &&
    key(normalizeBookLanguage(book.language ?? "")) !== key(filters.language)
  )
    return false;
  if (filters.format && book.format !== filters.format) return false;
  if (filters.readingState && bookReadingState(book) !== filters.readingState)
    return false;
  if (
    filters.availability &&
    bookAvailability(book, sets) !== filters.availability
  )
    return false;
  return true;
}

function names(values) {
  const unique = new Map();
  for (const value of values) {
    const name = normalize(value ?? "");
    if (name && !unique.has(key(name))) unique.set(key(name), name);
  }
  return [...unique.values()].sort(compare);
}

export function libraryFilterOptions(library, availability = {}) {
  const sets = availabilitySets(availability);
  const books = library.books;
  return {
    genres: names(
      books.map((book) =>
        (book.genres ?? [])
          .map((entry) => String(entry).split(",").map(normalize).find(Boolean))
          .find(Boolean),
      ),
    ),
    series: names(books.map((book) => book.series)),
    collections: names(books.flatMap((book) => book.collections ?? [])),
    authors: names(books.map((book) => book.author)),
    languages: names(
      books.map((book) => normalizeBookLanguage(book.language ?? "")),
    ),
    hasUnknownLanguage: books.some(
      (book) => !normalizeBookLanguage(book.language ?? ""),
    ),
    formats: names(books.map((book) => book.format)),
    readingStates: [...STATES].filter((state) =>
      books.some((book) => bookReadingState(book) === state),
    ),
    availability: [...AVAILABILITY].filter((state) =>
      books.some((book) => bookAvailability(book, sets) === state),
    ),
  };
}

function normalizedView(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.keys(input).some(
      (field) => !["id", "name", "filters"].includes(field),
    )
  )
    throw new TypeError("Vista guardada no válida.");
  if (
    typeof input.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(input.id) ||
    typeof input.name !== "string" ||
    input.name.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(input.name) ||
    !normalize(input.name)
  )
    throw new TypeError("Vista guardada no válida.");
  return {
    id: input.id,
    name: normalize(input.name),
    filters: normalizeLibraryFilters(input.filters),
  };
}

export function normalizeSavedViews(input = []) {
  if (!Array.isArray(input))
    throw new TypeError("Vistas guardadas no válidas.");
  const ids = new Set();
  return input.map((view) => {
    const result = normalizedView(view);
    if (ids.has(result.id))
      throw new TypeError("Identificador de vista repetido.");
    ids.add(result.id);
    return result;
  });
}

export function saveLibraryView(library, input) {
  const view = normalizedView(input);
  const previous = normalizeSavedViews(library.preferences.savedViews ?? []);
  const exists = previous.some((item) => item.id === view.id);
  const savedViews = exists
    ? previous.map((item) => (item.id === view.id ? view : item))
    : [...previous, view];
  return { ...library, preferences: { ...library.preferences, savedViews } };
}

export function deleteLibraryView(library, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id))
    throw new TypeError("Identificador de vista no válido.");
  const views = normalizeSavedViews(library.preferences.savedViews ?? []);
  if (!views.some((view) => view.id === id)) return library;
  return {
    ...library,
    preferences: {
      ...library.preferences,
      savedViews: views.filter((view) => view.id !== id),
    },
  };
}
