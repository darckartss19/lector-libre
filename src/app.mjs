import { createVerticalReader } from "./vertical-reader.mjs";
import { icon } from "./icons.mjs";
import "./style.css";
import "./reader-pagination.css";
import "./quote-card.css";
import "./mobile.css";
import { mobileNavigation } from "./mobile-navigation.mjs";
import { runtimePolicy } from "./core/runtime-policy.mjs";
import { documentScanDialog } from "./document-scan.mjs";
import { nativeAudioQueue } from "./core/native-audio.mjs";
import { quoteCardDialog } from "./quote-card.mjs";
import { CoverCache, coverHash } from "./core/cover-cache.mjs";
import { statePatch, hydrateLocalCovers } from "./core/state-patch.mjs";
import { createPdfReader, selectedPdfQuote } from "./pdf-reader.mjs";
import { createReaderPagination } from "./reader-pagination.mjs";
import {
  libraryFiltersMarkup,
  bindLibraryFilters,
} from "./library-filters.mjs";
import { saveLibraryView, deleteLibraryView } from "./core/library-filters.mjs";
import {
  speechPositionForAnchor,
  speechPositionForParagraph,
  highlightSpeechFragment,
  clearSpeechHighlight,
} from "./speech-navigation.mjs";
import { settingsMarkup } from "./settings.mjs";
import {
  THEMES,
  FONTS,
  APPEARANCE_DEFAULTS,
  NUMBER_PREFERENCES,
  applyAppearance,
  themeFor,
} from "./core/appearance.mjs";
import { UI_LANGUAGES, translate, localizeUI } from "./core/i18n.mjs";
import {
  SPEECH_LANGUAGES,
  languageName,
  voicesForLanguage,
  selectVoice,
} from "./core/voice-selection.mjs";
import { CloudSnapshot } from "./core/cloud-snapshot.mjs";
import { SyncSchedule } from "./core/sync-schedule.mjs";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createLibrary,
  addBook,
  editBook,
  editBooks,
  collectionGroups,
  importLibrary,
  upsertAnnotation,
  deleteAnnotation,
  visibleAnnotations,
  pinBook,
  reorderPins,
  markRead,
  setAudioPosition,
  setView,
  queryBooks,
  genreShelves,
  seriesGroups,
  setDriveFolder,
  linkDriveBooks,
} from "./core/library.mjs";
import {
  metadataDialog,
  bulkDialog,
  collectionDialog,
  restoreDialog,
} from "./library-actions.mjs";
import { restoreLibrary } from "./core/backup-restore.mjs";
import {
  searchBook,
  selectionAnchor,
  viewportAnchor,
  annotateChapter,
  revealAnchor,
} from "./core/reader-tools.mjs";
import { readerPanelMarkup, annotationDialog } from "./reader-actions.mjs";
import { parseBook } from "./core/epub.mjs";
import { parseDocument } from "./core/document.mjs";
import { SpeechQueue } from "./core/speech.mjs";
import { stampChanges, mergeSnapshots } from "./core/sync.mjs";
import {
  designSpine,
  fallbackSpine,
  applySpine,
  isLocalCover,
} from "./core/spines.mjs";
import {
  preserveInteraction,
  sameMembers,
  transferBooks,
} from "./core/ui-state.mjs";

const diagnostic = (event, number = null) =>
  invoke("diagnostic_event", { event, number }).catch(() => {});
window.addEventListener("error", () => diagnostic("frontend.error"));
window.addEventListener("unhandledrejection", () =>
  diagnostic("frontend.rejection"),
);

const root = document.querySelector("#app");
const platform = (await invoke("platform_info").catch(() => null)) ?? {
  mobile: false,
  speech: true,
  drive: true,
  imageClipboard: true,
};
const android = platform.platform === "android";
const policy = runtimePolicy({
  mobile: platform.mobile,
  deviceMemory: navigator.deviceMemory,
});
document.documentElement.dataset.platform = platform.platform ?? "desktop";
let mobileNav;
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let library = createLibrary(),
  section = "all",
  genre = "",
  series = "",
  collection = "",
  search = "",
  sort = "",
  route = "library",
  current = null,
  parsed = null,
  chapterIndex = 0,
  voices = [],
  queue = null,
  voiceStatus = "idle",
  drive = { configured: false, connected: false },
  busy = false,
  syncing = false,
  saveChain = Promise.resolve(),
  saveTimer,
  lastSpeechSave = 0,
  dirty = false;
let localBooks = new Set(),
  cloudBooks = new Set(),
  driveJob = "",
  driveErrors = [],
  driveCancelled = false,
  folderSource = "",
  folderRecursive = false,
  folderPreview = null,
  previewPage = 0,
  selectedDriveFiles = new Set();
let pendingCloudRender = false;
let storageReady = false;
let lastPersisted = null,
  libraryPage = 0,
  libraryPageKey = "";
const LIBRARY_PAGE_SIZE = policy.libraryPageSize;
let neuralVoices = [],
  voiceDownloading = false,
  syncError = "";
let voicePreview = false;
let seriesDetection = "";
let selectionMode = false,
  selectedBooks = new Set(),
  visibleBooks = [];
let readerPanel = "",
  readerQuery = "",
  readerResults = [],
  readerResultLimit = 100,
  pendingSelection = null;
let focusMode = false,
  sleepMode = "off",
  sleepDeadline = null,
  sleepChapter = null;
let backupRequested = false;
let readerPagination = null;
let verticalReader = null;
let pdfReader = null,
  pdfRotation = 0;
let audioActionChain = Promise.resolve();
let extraFilters = {},
  selectedFilterView = "",
  pendingSpeechPosition = null;
let readerResizeObserver = null,
  readerProgressFrame = 0;
const coverCache = new CoverCache((hash) => invoke("cover_asset", { hash }), {
  maxBytes: policy.coverBytes,
  maxEntries: policy.coverEntries,
});
const cloudSnapshot = new CloudSnapshot(undefined, (cover) =>
  coverCache.original(cover),
);
const startupStarted = performance.now();
let coverObserver = null,
  spineObserver = null,
  spineWork = Promise.resolve(),
  readerLoadGeneration = 0,
  readerLoading = false,
  searchGeneration = 0;
let importJob = null,
  importRunning = false,
  importPaused = true,
  importPreparing = false;
let readerSearchTimer;
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      diagnostic("performance.long_task_ms", Math.round(entry.duration));
  }).observe({ type: "longtask", buffered: true });
} catch {}
setInterval(() => {
  if (performance.memory?.usedJSHeapSize)
    diagnostic("performance.heap_bytes", performance.memory.usedJSHeapSize);
  diagnostic("performance.cover_cache_bytes", coverCache.bytes);
}, 60000);
function releaseBook(force = false) {
  if (!parsed || (!force && queue?.bookId === current)) return;
  const previous = parsed;
  parsed = null;
  current = null;
  readerLoadGeneration++;
  searchGeneration++;
  clearReaderObserver();
  previous.dispose?.().catch(() => {});
}
function coverMarkup(book, alt = "") {
  if (isLocalCover(book.cover))
    return `<img src="${book.cover}" loading="lazy" decoding="async" alt="${escape(alt)}">`;
  if (coverHash(book.cover))
    return `<img data-cover-source="${escape(book.cover)}" loading="lazy" decoding="async" alt="${escape(alt)}">`;
  return "";
}
function observeCovers() {
  coverObserver?.disconnect();
  coverObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const image = entry.target,
          source = image.dataset.coverSource;
        coverObserver.unobserve(image);
        coverCache
          .url(source)
          .then((url) => {
            if (image.isConnected && image.dataset.coverSource === source)
              image.src = url;
          })
          .catch(() => {
            if (image.isConnected) image.alt = t("Portada no disponible");
          });
      }
    },
    { rootMargin: "120px" },
  );
  root
    .querySelectorAll("[data-cover-source]")
    .forEach((image) => coverObserver.observe(image));
}
function renderImportJob() {
  let el = root.querySelector("#import-job");
  if (!el) {
    el = document.createElement("section");
    el.id = "import-job";
    el.className = "import-job";
    root.append(el);
  }
  el.hidden = !importJob;
  if (!importJob) return;
  const remaining = importJob.files.length;
  el.innerHTML = `<div><strong>${importRunning ? "Importando biblioteca" : "Importación en pausa"}</strong><span data-content>${t("Libros pendientes")}: ${remaining}${importJob.failed?.length ? ` · ${t("Con error")}: ${importJob.failed.length}` : ""}</span></div><button data-action="${importRunning ? "pause-import" : "resume-import"}">${importRunning ? "Pausar" : "Continuar"}</button><button data-action="discard-import" ${importRunning ? "disabled" : ""}>Finalizar</button>`;
  ui(el);
}
async function saveImportJob() {
  await invoke("import_queue", { value: importJob, clear: !importJob });
}
async function runImportJob() {
  if (
    !importJob ||
    importRunning ||
    importPreparing ||
    syncing ||
    backupRequested
  )
    return;
  if (importJob.kind === "drive" && !drive.connected) {
    notify("Conecta Google para continuar la importación.", true);
    return;
  }
  if (
    importJob.kind === "drive" &&
    library.driveFolder?.id !== importJob.folderId
  ) {
    notify("Vuelve a seleccionar la carpeta original para continuar.", true);
    return;
  }
  const job = importJob,
    started = performance.now();
  importRunning = true;
  importPaused = false;
  renderImportJob();
  let count = 0;
  try {
    while (job.files.length && !importPaused) {
      const file = job.files[0];
      try {
        const known =
          job.kind === "drive" &&
          file.sha256 &&
          library.books.find(
            (book) =>
              book.id === file.sha256 &&
              book.format === file.format &&
              localBooks.has(book.id),
          );
        const saved = known
          ? {
              id: known.id,
              format: known.format,
              driveSource: {
                fileId: file.id,
                folderId: file.folderId,
                sha256: known.id,
              },
            }
          : job.kind === "drive"
            ? await invoke("drive_import_file", { fileId: file.id })
            : file.source
              ? await invoke("import_local_file", { source: file.source })
              : file;
        const existing = library.books.find((b) => b.id === saved.id);
        if (existing) {
          if (saved.driveSource)
            await commit(
              linkDriveBooks(library, [
                { id: saved.id, driveSource: saved.driveSource },
              ]),
            );
        } else {
          const data = await invoke("read_book", {
            id: saved.id,
            format: saved.format,
          });
          const book = await parseDocument(
            new Uint8Array(data),
            saved.format,
            saved.filename,
            { metadataOnly: true },
          );
          if (isLocalCover(book.cover)) {
            const reference = await invoke("store_cover", {
              cover: book.cover,
            });
            if (coverHash(reference)) book.cover = reference;
          }
          await commit(
            addBook(library, {
              id: saved.id,
              format: saved.format,
              ...book,
              ...(saved.driveSource ? { driveSource: saved.driveSource } : {}),
            }),
          );
          count++;
        }
        localBooks.add(saved.id);
        job.files.shift();
        job.done = (job.done ?? 0) + 1;
      } catch (error) {
        diagnostic("import.failed");
        // Keep a failed item available for retry, without retrying forever.
        (job.failed ??= []).push({ file, message: String(error) });
        job.files.shift();
      }
      await saveImportJob();
      renderImportJob();
      if (count % 5 === 0 && route === "library") preserveInteraction(shell);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!job.files.length && job.failed?.length) {
      job.files = job.failed.map((entry) => entry.file);
      job.failed = [];
      importPaused = true;
      notify(
        "Algunos libros quedaron pendientes. Puedes continuar para reintentarlos.",
        true,
      );
    } else if (!job.files.length) {
      importJob = null;
      await saveImportJob();
      notify("Importación terminada. Los duplicados conservan tu progreso.");
    }
  } catch (error) {
    importPaused = true;
    notify(String(error), true);
  } finally {
    importRunning = false;
    showDriveProgress("");
    if (importJob) await saveImportJob().catch(() => {});
    diagnostic(
      "performance.import_ms",
      Math.round(performance.now() - started),
    );
    if (route === "library") preserveInteraction(shell);
    renderImportJob();
  }
}

const syncSchedule = new SyncSchedule();
let lastMobileChrome = "";
function syncMobileChrome() {
  if (platform.platform !== "android") return;
  const theme = themeFor(library.preferences.theme);
  const background = theme.colors[route === "reader" ? 0 : 2];
  const key = `${background}:${theme.dark}`;
  if (lastMobileChrome === key) return;
  lastMobileChrome = key;
  invoke("mobile_chrome", { background, darkIcons: !theme.dark }).catch(() => {
    lastMobileChrome = "";
    diagnostic("mobile.chrome.error");
  });
}
const ui = (element = root) => {
  localizeUI(element, library.preferences.uiLanguage ?? "es");
  if (element === root || element.id === "screen") {
    mobileNav?.decorate();
    syncMobileChrome();
  }
};
mobileNav = mobileNavigation(root, {
  localize: (element) =>
    localizeUI(element, library.preferences.uiLanguage ?? "es"),
  speech: platform.speech,
});
const t = (text) => translate(text, library.preferences.uiLanguage ?? "es");
function appearance() {
  applyAppearance(document.documentElement, library.preferences);
  document.documentElement.lang = library.preferences.uiLanguage ?? "es";
  syncMobileChrome();
}
async function refreshVoices() {
  if (!platform.speech) {
    voices = [];
    neuralVoices = [];
    return;
  }
  const installed = await invoke("speech_command", {
    command: { action: "voices" },
  });
  neuralVoices = await invoke("neural_catalog");
  voices = [
    ...new Map(
      [...installed, ...neuralVoices.filter((v) => v.installed)].map((v) => [
        v.id,
        v,
      ]),
    ).values(),
  ];
}
async function changePreference(name, value) {
  if (voicePreview && ["voice", "speechLanguage", "rate"].includes(name)) {
    await invoke("speech_command", { command: { action: "cancel" } });
    voicePreview = false;
  }
  if (route === "reader") captureReading();
  const next = { ...library.preferences, [name]: value };
  if (name === "speechLanguage") {
    const selected = selectVoice(voices, next, parsed?.language);
    next.voice = selected?.id ?? "";
  }
  const save = commit({ ...library, preferences: next });
  appearance();
  if (name === "uiLanguage") preserveInteraction(shell);
  else if (["theme", "speechLanguage", "voice"].includes(name))
    preserveInteraction(renderSettings);
  else {
    const output = root.querySelector(`[data-output="${name}"]`);
    if (output)
      output.textContent = `${value}${["fontSize", "pageWidth", "pagePadding"].includes(name) ? " px" : ["paragraphSpacing", "letterSpacing"].includes(name) ? " em" : ""}`;
  }
  await save;
}
async function installVoice(id) {
  if (voiceDownloading) return;
  voiceDownloading = true;
  preserveInteraction(renderSettings);
  try {
    await invoke("neural_install", { voiceId: id });
    await refreshVoices();
    const voice = voices.find((v) => v.id === id);
    if (voice)
      await commit({
        ...library,
        preferences: {
          ...library.preferences,
          voice: voice.id,
          speechLanguage: voice.language.split("-")[0],
        },
      });
    notify("La voz se descargó y está lista para escuchar.");
  } catch (error) {
    notify(String(error), true);
  } finally {
    voiceDownloading = false;
    if (route === "settings") preserveInteraction(renderSettings);
  }
}
async function previewVoice() {
  if (android) {
    if (voicePreview) return nativeAudioCommand({ action: "cancel" });
    const voice = selectVoice(voices, library.preferences, parsed?.language);
    if (!voice) return;
    const samples = {
      es: "Un buen libro puede acompañarte a cualquier lugar. Elige cómo prefieres escuchar.",
      en: "A good book can keep you company anywhere. Choose how you prefer to listen.",
      pt: "Um bom livro pode acompanhar você em qualquer lugar. Escolha como prefere ouvir.",
    };
    return nativeAudioCommand({
      action: "speak",
      voice: voice.id,
      rate: library.preferences.rate ?? 1,
      text: samples[voice.language.split("-")[0]] ?? samples.en,
    });
  }
  if (voicePreview) {
    await invoke("speech_command", { command: { action: "cancel" } });
    voicePreview = false;
  } else {
    const voice = selectVoice(
      voices,
      library.preferences,
      library.books.find((book) => book.id === queue?.bookId)?.language ??
        parsed?.language,
    );
    if (!voice) return;
    if (queue && !android) {
      queue.pause();
      voiceStatus = "paused";
      checkpointSpeech();
      renderAudio();
    }
    await invoke("speech_command", { command: { action: "cancel" } });
    const samples = {
      es: "Un buen libro puede acompañarte a cualquier lugar. Esta es una muestra de mi voz, para que elijas cómo prefieres escuchar.",
      en: "A good book can keep you company anywhere. This is a sample of my voice, so you can choose how you prefer to listen.",
      pt: "Um bom livro pode acompanhar você em qualquer lugar. Esta é uma amostra da minha voz, para escolher como prefere ouvir.",
      fr: "Un bon livre peut vous accompagner partout. Voici un exemple de ma voix, pour choisir comment vous préférez écouter.",
    };
    voicePreview = true;
    try {
      await invoke("speech_command", {
        command: {
          action: "speak",
          id: "preview:" + crypto.randomUUID(),
          text: samples[voice.language.split("-")[0]] ?? samples.en,
          voice: voice.id,
          rate: library.preferences.rate ?? 1,
        },
      });
    } catch (error) {
      voicePreview = false;
      throw error;
    }
  }
  const button = root.querySelector('[data-action="preview-voice"]');
  if (button) button.textContent = t(voicePreview ? "Detener" : "Probar voz");
}
const spineCache = new Map();
let spineGeneration = 0;
async function cachedSpine(book) {
  const hash = coverHash(book.cover);
  if (hash) {
    const saved = await invoke("spine_asset", { hash, design: null }).catch(
      () => null,
    );
    if (
      saved &&
      [saved.background, saved.ink, saved.accent].every((color) =>
        /^#[a-f0-9]{6}$/i.test(color),
      ) &&
      (!saved.art || isLocalCover(saved.art))
    )
      return saved;
  }
  const original = await coverCache.original(book.cover);
  const design = await designSpine(original, fallbackSpine(book.id));
  if (hash) await invoke("spine_asset", { hash, design }).catch(() => {});
  return design;
}
async function decorateSpines(books) {
  const generation = ++spineGeneration;
  spineObserver?.disconnect();
  const known = new Set(library.books.map((book) => book.id));
  for (const id of spineCache.keys()) if (!known.has(id)) spineCache.delete(id);
  const byId = new Map(books.map((book) => [book.id, book]));
  spineObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target,
          book = byId.get(element.closest("[data-id]")?.dataset.id);
        spineObserver.unobserve(element);
        if (!book) continue;
        spineWork = spineWork
          .catch(() => {})
          .then(async () => {
            if (
              generation !== spineGeneration ||
              route !== "library" ||
              !element.isConnected ||
              library.preferences.view !== "spines"
            )
              return;
            let cached = spineCache.get(book.id);
            if (library.preferences.spineStyle === "classic")
              cached = { design: fallbackSpine(book.id) };
            else if (!cached || cached.cover !== book.cover) {
              cached = { cover: book.cover, design: await cachedSpine(book) };
              if (
                library.books.find((b) => b.id === book.id)?.cover ===
                book.cover
              )
                spineCache.set(book.id, cached);
              while (spineCache.size > policy.spineEntries)
                spineCache.delete(spineCache.keys().next().value);
            }
            if (
              generation === spineGeneration &&
              route === "library" &&
              element.isConnected
            )
              applySpine(element, cached.design);
          });
      }
    },
    { rootMargin: "120px" },
  );
  root
    .querySelectorAll(".books.spines .cover")
    .forEach((element) => spineObserver.observe(element));
}
async function refreshAvailability() {
  localBooks = new Set(
    await invoke("book_availability", {
      books: library.books.map(({ id, format }) => ({ id, format })),
    }),
  );
}
function showDriveProgress(message) {
  driveJob = message;
  const el = document.querySelector("#drive-progress");
  if (el) {
    el.textContent = t(message);
    el.closest(".transfer-status").hidden = !message;
  }
}
setInterval(() => {
  if (
    drive.connected &&
    syncSchedule.ready() &&
    !busy &&
    !importRunning &&
    !importPreparing &&
    !syncing &&
    !backupRequested &&
    !document.querySelector("dialog[open]") &&
    document.activeElement?.id !== "drive-folder"
  )
    syncDrive(true);
}, 60000);
function notify(message, error = false) {
  const el = document.querySelector("#notice");
  if (!el) return;
  el.textContent = t(message);
  el.className = "notice" + (error ? " error" : "");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => (el.className = "notice hidden"), 6000);
}
function persist() {
  if (!storageReady)
    return Promise.reject(new Error("Primero recupera la biblioteca local."));
  const value = library;
  const job = saveChain
    .catch(() => {})
    .then(async () => {
      if (value === lastPersisted) return;
      if (lastPersisted)
        await invoke("save_state", { patch: statePatch(lastPersisted, value) });
      else await invoke("save_state", { value });
      lastPersisted = value;
    });
  saveChain = job;
  job.catch((e) => notify("No se pudo guardar: " + e, true));
  return job;
}

function commit(next) {
  if (next === library) return Promise.resolve();
  dirty = true;
  library = stampChanges(library, next, library.deviceId);
  return persist();
}
const labels = {
  all: "Tu biblioteca",
  pinned: "Lectura rápida",
  recent: "Añadidos recientemente",
  recentlyRead: "Historial",
  reading: "Leyendo",
  unread: "Por leer",
  finished: "Terminados",
};
function shell() {
  clearReaderObserver();
  if (route === "library" || route === "series" || route === "collections")
    releaseBook(true);
  const shelves = genreShelves(library, { clone: false });
  const sagas = seriesGroups(library, { clone: false });
  const collections = collectionGroups(library, { clone: false });
  root.innerHTML = `<aside class="sidebar"><div class="brand">${icon("book")}<span>Lector libre<small>TU ESPACIO PARA LEER</small></span></div><button class="import primary" data-action="import">${icon("plus")} Añadir libros</button><nav>${[
    ["all", "book", "Biblioteca"],
    ["pinned", "star", "Lectura rápida"],
    ["recent", "plus", "Añadidos recientemente"],
    ["recentlyRead", "clock", "Historial"],
    ["unread", "book", "Por leer"],
    ["reading", "book", "Leyendo"],
    ["finished", "book", "Terminados"],
  ]
    .map(
      ([id, i, label]) =>
        `<button data-section="${id}" class="${section === id && !genre && !series && !collection && route === "library" ? "active" : ""}">${icon(i)}${label}<span>${queryBooks(library, { section: id, clone: false }).length}</span></button>`,
    )
    .join(
      "",
    )}<button data-action="create-free-quote">${icon("image")}Crear imagen</button><button data-action="series-groups" class="${route === "series" || (series && route === "library") ? "active" : ""}">${icon("spines")}Sagas<span>${sagas.length}</span></button><button data-action="collections-groups" class="${route === "collections" || (collection && route === "library") ? "active" : ""}">${icon("grid")}Colecciones<span>${collections.length}</span></button></nav><div class="genre-label">ESTANTERÍAS <span>${shelves.length}</span></div><nav class="genres">${
    shelves
      .map(
        (g) =>
          `<button data-genre="${escape(g.name)}" class="${genre === g.name && route === "library" ? "active" : ""}"><i></i>${escape(g.name)}<span>${g.books.length}</span></button>`,
      )
      .join("") ||
    '<p class="quiet">Añade géneros a tus libros para crear estanterías.</p>'
  }</nav><button class="settings-link ${route === "settings" ? "active" : ""}" data-action="settings">${icon("settings")} Personalizar y sincronizar</button><div class="local-status"><i></i> Biblioteca en este dispositivo</div></aside><main class="workspace"><div id="screen"></div></main><div id="notice" class="notice hidden" role="status"></div><footer id="audio-bar" class="hidden"></footer>`;
  renderScreen();
  renderAudio();
  renderImportJob();
  observeCovers();
  ui();
}
function card(book) {
  const fallback = fallbackSpine(book.id);
  const color = fallback.background;
  const spineStyle = library.preferences.spineStyle ?? "illustrated";
  const design =
    spineStyle === "classic"
      ? fallback
      : spineCache.get(book.id)?.cover === book.cover
        ? spineCache.get(book.id).design
        : fallback;
  const portrait =
    library.preferences.view === "spines"
      ? ""
      : isLocalCover(book.cover) || coverHash(book.cover)
        ? coverMarkup(book, `Portada de ${book.title}`)
        : `<div class="generated-cover"><span class="cover-line"></span><span>${escape(book.title)}</span><small>${escape(book.author || "Biblioteca personal")}</small>${icon("book")}</div>`;
  return `<article class="book-card ${selectedBooks.has(book.id) ? "selected" : ""}" data-id="${book.id}">${selectionMode ? `<label class="book-select"><input type="checkbox" data-select-book="${book.id}" ${selectedBooks.has(book.id) ? "checked" : ""} aria-label="Seleccionar ${escape(book.title)}"></label>` : ""}<button class="cover" data-open="${book.id}" aria-label="Leer ${escape(book.title)}" title="${escape(book.title)}${book.author ? " — " + escape(book.author) : ""}" style="--book-color:${color};--spine-color:${design.background};--spine-ink:${design.ink};--spine-accent:${design.accent};--spine-font:${book.title.length > 70 ? 12 : book.title.length > 40 ? 15 : 18}px">${portrait}<span class="spine-design" aria-hidden="true"><span class="spine-rule"></span><span class="spine-title">${escape(book.title)}</span><span class="spine-art"></span><span class="spine-author">${escape(book.author || "Biblioteca personal")}</span></span></button><div class="book-info"><button class="book-title" data-open="${book.id}">${escape(book.title)}</button><p>${escape(book.author || "Autor sin indicar")}</p>${book.series ? `<button class="series-badge" data-series="${escape(book.series)}" data-content>${escape(book.series)}${book.seriesIndex !== null && book.seriesIndex !== undefined ? ` · ${book.seriesIndex}` : ""}</button>` : ""}<div class="book-bottom"><span>${localBooks.has(book.id) ? "" : cloudBooks.has(book.id) ? "En Drive · " : "Archivo pendiente · "}${book.lastReadAt === null ? book.format.toUpperCase() : Math.round(book.progress * 100) + "% leído"}</span><button data-pin="${book.id}" class="pin ${book.pinOrder !== null ? "pinned" : ""}" aria-label="${book.pinOrder === null ? "Fijar" : "Desfijar"} ${escape(book.title)}">${icon("star")}</button><button class="text-button" data-edit="${book.id}" aria-label="Editar ${escape(book.title)}">•••</button></div>${book.lastReadAt !== null ? `<div class="progress-track"><i style="width:${book.progress * 100}%"></i></div>` : ""}${section === "pinned" ? `<div class="pin-order"><button data-move="${book.id}" data-step="-1">← Antes</button><button data-move="${book.id}" data-step="1">Después →</button></div>` : ""}</div></article>`;
}
function renderScreen() {
  const renderStarted = performance.now();
  spineObserver?.disconnect();
  spineGeneration++;
  clearReaderObserver();
  if (route !== "reader" && focusMode) {
    focusMode = false;
    root.classList.remove("reader-focus");
    if (!platform.mobile)
      getCurrentWindow()
        .setFullscreen(false)
        .catch((error) => notify(String(error), true));
  }
  document
    .querySelector(".workspace")
    .classList.toggle("reading-workspace", route === "reader");
  spineGeneration++;
  appearance();
  const screen = document.querySelector("#screen");
  if (route === "reader") {
    renderReader();
    return;
  }
  if (route === "settings") {
    renderSettings();
    return;
  }
  if (route === "collections") {
    renderCollections();
    return;
  }
  if (route === "series") {
    renderSeries();
    return;
  }
  const books = queryBooks(library, {
    ...extraFilters,
    localIds: localBooks,
    cloudIds: cloudBooks,
    clone: false,
    section,
    genre: genre || undefined,
    series: series || undefined,
    collection: collection || undefined,
    search,
    sort: sort || (series ? "series" : undefined),
  });
  const pageKey = JSON.stringify(currentLibraryFilters());
  if (libraryPageKey !== pageKey) {
    libraryPage = 0;
    libraryPageKey = pageKey;
  }
  const pageCount = Math.max(1, Math.ceil(books.length / LIBRARY_PAGE_SIZE));
  libraryPage = Math.min(libraryPage, pageCount - 1);
  const pageBooks = books.slice(
    libraryPage * LIBRARY_PAGE_SIZE,
    (libraryPage + 1) * LIBRARY_PAGE_SIZE,
  );
  visibleBooks = pageBooks;
  const pagination =
    pageCount > 1
      ? `<nav class="library-pages" aria-label="Páginas de la biblioteca"><button data-library-page="${libraryPage - 1}" ${libraryPage === 0 ? "disabled" : ""}>← Anterior</button><span>${libraryPage + 1} / ${pageCount} · ${libraryPage * LIBRARY_PAGE_SIZE + 1}–${Math.min(books.length, (libraryPage + 1) * LIBRARY_PAGE_SIZE)} / ${books.length}</span><button data-library-page="${libraryPage + 1}" ${libraryPage + 1 === pageCount ? "disabled" : ""}>Siguiente →</button></nav>`
      : "";
  screen.innerHTML = `<header class="library-header"><div><p class="eyebrow">UN LIBRO, A TU RITMO</p><h1 ${genre || series || collection ? "data-content" : ""}>${escape(collection || series || genre || labels[section])}</h1><p class="subtitle">${library.books.length ? `${books.length} ${books.length === 1 ? "libro" : "libros"} · ${t(section === "recentlyRead" ? "Todos los libros abiertos, incluidos los terminados." : section === "reading" ? "Libros empezados que aún no has terminado." : section === "unread" ? "Libros que todavía no has abierto." : section === "recent" ? "Ordenados por la fecha en que los añadiste." : "tu próxima lectura empieza aquí")}` : "Un espacio tranquilo para todos tus libros."}</p></div><label class="search">${icon("search")}<input id="search" aria-label="Buscar libros" placeholder="Título, autor, género o saga" value="${escape(search)}"></label></header><div class="library-toolbar"><button data-action="toggle-selection">${selectionMode ? "Terminar selección" : "Seleccionar"}</button><span>${collection ? "Organizados por colección" : series ? "Organizados por saga" : section === "pinned" ? "Tus favoritos, sin límite de fijados" : genre ? "Organizados por género principal" : "A tu manera, siempre"}${series ? `<button class="text-button series-back" data-action="series-groups">Todas las sagas</button>` : ""}</span><div><select id="sort" aria-label="Ordenar biblioteca"><option value="">Orden de esta sección</option value="title" ${sort === "title" ? "selected" : ""}>Título</option><option value="author" ${sort === "author" ? "selected" : ""}>Autor</option><option value="series" ${sort === "series" ? "selected" : ""}>Saga y número</option><option value="added" ${sort === "added" ? "selected" : ""}>Fecha de incorporación</option></select><div class="view-toggle">${["covers", "spines", "list"].map((v) => `<button data-view="${v}" class="${library.preferences.view === v ? "active" : ""}" aria-label="Vista ${v === "covers" ? "portadas" : v === "spines" ? "lomos" : "lista"}" aria-pressed="${library.preferences.view === v}">${icon(v === "covers" ? "grid" : v)}</button>`).join("")}</div></div></div>${libraryFiltersMarkup({ library, filters: currentLibraryFilters(), localIds: localBooks, cloudIds: cloudBooks, uiLanguage: library.preferences.uiLanguage ?? "es", selectedView: selectedFilterView })}${selectionMode ? selectionMarkup() : ""}${books.length ? `${pagination}<div class="books ${library.preferences.view}">${pageBooks.map(card).join("")}</div>${pagination}` : `<div class="empty"><div class="empty-books"><span></span><span></span><span></span>${icon("book")}</div><h2>${library.books.length ? "Aún no hay libros aquí" : "Tu biblioteca está por comenzar"}</h2><p>${library.books.length ? "Prueba otro filtro o añade un libro a esta estantería." : "Añade tus libros y documentos compatibles. Conservaremos una copia local y recordarás dónde te quedaste."}</p><button data-action="import" class="primary">${icon("plus")} Añadir mis primeros libros</button><small>EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown y CBZ · Lectura sin conexión</small></div>`}`;
  diagnostic(
    "performance.library_ms",
    Math.round(performance.now() - renderStarted),
  );
  observeCovers();
  const shelf = root.querySelector(".books.spines");
  if (shelf) {
    shelf.dataset.spineStyle = library.preferences.spineStyle ?? "illustrated";
    decorateSpines(pageBooks).catch(() => {});
  }
  ui(screen);
  bindLibraryFilters(screen, {
    filters: currentLibraryFilters(),
    localize: ui,
    onError: (error) => notify(String(error), true),
    onChange: (filters) => {
      applyLibraryFilters(filters);
      selectedFilterView = "";
      preserveInteraction(renderScreen);
    },
    onSave: async (name) => {
      const id = crypto.randomUUID();
      await commit(
        saveLibraryView(library, {
          id,
          name,
          filters: currentLibraryFilters(),
        }),
      );
      selectedFilterView = id;
      preserveInteraction(renderScreen);
      notify("Vista guardada.");
    },
    onOpen: (id) => {
      const view = library.preferences.savedViews?.find(
        (view) => view.id === id,
      );
      if (!view) return;
      applyLibraryFilters(view.filters);
      selectedFilterView = id;
      preserveInteraction(shell);
    },
    onDelete: async (id) => {
      await commit(deleteLibraryView(library, id));
      if (selectedFilterView === id) selectedFilterView = "";
      preserveInteraction(renderScreen);
      notify("Vista eliminada.");
    },
  });
}
function currentLibraryFilters() {
  return { ...extraFilters, section, genre, series, collection, search, sort };
}
function applyLibraryFilters(filters) {
  ({
    section = "all",
    genre = "",
    series = "",
    collection = "",
    search = "",
    sort = "",
  } = filters);
  extraFilters = Object.fromEntries(
    ["author", "language", "format", "readingState", "availability"].map(
      (key) => [key, filters[key] || ""],
    ),
  );
  route = "library";
}
function renderSeries() {
  const matching = new Set(
    queryBooks(library, { clone: false, search }).map((book) => book.id),
  );
  const groups = seriesGroups(library, { clone: false }).filter((group) =>
    group.books.some((book) => matching.has(book.id)),
  );
  const candidates = library.books.filter(
    (book) => !book.series && book.format === "epub" && localBooks.has(book.id),
  );
  const screen = document.querySelector("#screen");
  screen.innerHTML = `<header class="library-header"><div><p class="eyebrow">LIBROS QUE VAN JUNTOS</p><h1>Sagas</h1><p class="subtitle">Reúne cada saga y lee sus libros en orden.</p></div><label class="search">${icon("search")}<input id="search" aria-label="Buscar libros" placeholder="Título, autor, género o saga" value="${escape(search)}"></label></header><div class="series-detection"><div><p>Las sagas se toman del EPUB o del campo Saga al editar un libro.</p><small id="series-detection-status" role="status">${escape(seriesDetection || "Busca sagas en los EPUB de este dispositivo. Conserva las que ya has elegido.")}</small></div><button data-action="detect-series" ${busy || !candidates.length ? "disabled" : ""}>${icon("search")}Detectar sagas</button></div>${
    groups.length
      ? `<div class="series-groups">${groups
          .map(
            (group) =>
              `<button class="series-group" data-series="${escape(group.name)}"><span class="series-covers" aria-hidden="true" data-content>${group.books
                .slice(0, 3)
                .map((book) =>
                  isLocalCover(book.cover) || coverHash(book.cover)
                    ? coverMarkup(book)
                    : `<span class="series-cover" style="--book-color:${fallbackSpine(book.id).background}">${icon("book")}</span>`,
                )
                .join(
                  "",
                )}</span><strong data-content>${escape(group.name)}</strong><span>${group.books.length} ${group.books.length === 1 ? "libro" : "libros"}</span></button>`,
          )
          .join("")}</div>`
      : `<div class="empty"><h2>${search ? "Aún no hay libros aquí" : "Tus sagas aparecerán aquí"}</h2><p>${search ? "Prueba otro filtro o añade un libro a esta estantería." : "Pulsa Detectar sagas o añade el nombre de la saga desde Editar libro."}</p></div>`
  }`;
  observeCovers();
  ui(screen);
}
async function detectSeries() {
  if (busy) return;
  const candidates = library.books.filter(
    (book) => !book.series && book.format === "epub" && localBooks.has(book.id),
  );
  if (!candidates.length) return;
  busy = true;
  let failed = 0;
  const changes = [];
  const progress = (count) => {
    seriesDetection = `Leyendo sagas: ${count} de ${candidates.length}…`;
    const status = document.querySelector("#series-detection-status");
    if (status) status.textContent = t(seriesDetection);
  };
  progress(0);
  if (route === "series") preserveInteraction(renderSeries);
  try {
    for (const [index, book] of candidates.entries()) {
      try {
        const bytes = await invoke("read_book", {
          id: book.id,
          format: book.format,
        });
        const metadata = parseBook(
          new Uint8Array(bytes),
          book.format,
          book.title,
          { metadataOnly: true, seriesOnly: true },
        );
        if (metadata.series)
          changes.push({
            book,
            series: metadata.series,
            seriesIndex: metadata.seriesIndex,
          });
      } catch {
        failed++;
      }
      progress(index + 1);
    }
    let next = library;
    let added = 0;
    for (const change of changes) {
      // An edit or reading update made during the scan takes precedence.
      if (next.books.find((book) => book.id === change.book.id) !== change.book)
        continue;
      next = editBook(next, change.book.id, {
        series: change.series,
        seriesIndex: change.seriesIndex,
      });
      added++;
    }
    await commit(next);
    seriesDetection = `${added} libros agrupados en sagas.${failed ? ` No se pudieron revisar ${failed} libros.` : ""}`;
    notify(seriesDetection, failed > 0);
  } catch (error) {
    seriesDetection =
      "No se pudo completar la detección de sagas. Puedes reintentar.";
    notify(seriesDetection, true);
  } finally {
    busy = false;
    if (route === "series" || route === "library") preserveInteraction(shell);
  }
}
async function importFiles(providedFiles = null) {
  if (busy || importJob || importPreparing) {
    notify("Termina o pausa la importación pendiente antes de añadir otra.");
    return;
  }
  importPreparing = true;
  try {
    const files =
      providedFiles ?? (await invoke("import_files", { deferred: true }));
    if (!files.length) return;
    importJob = { kind: "local", files, done: 0, failed: [] };
    await saveImportJob();
  } catch (error) {
    notify(String(error), true);
  } finally {
    importPreparing = false;
  }
  await runImportJob();
}
function scanDocuments() {
  if (busy || importJob || importPreparing)
    return notify(
      "Termina o pausa la importación pendiente antes de añadir otra.",
    );
  documentScanDialog({
    root,
    invoke,
    localize: ui,
    onChoose: () => importFiles(),
    onImport: async (keys) => {
      importPreparing = true;
      let result;
      try {
        result = await invoke("mobile_import_scanned", { keys });
      } finally {
        importPreparing = false;
      }
      if (result.errors.length)
        notify(
          `${result.errors.length} documentos no se pudieron copiar.`,
          true,
        );
      await importFiles(result.files);
    },
  });
}
async function openBook(id) {
  if (busy) return;
  const openStarted = performance.now();
  captureReading();
  busy = true;
  try {
    const book = library.books.find((b) => b.id === id);
    if (!book) return;
    if (!localBooks.has(id)) {
      if (!drive.booksEnabled)
        throw new Error(
          platform.drive
            ? "Este archivo no está en el dispositivo. Activa la biblioteca en Drive o importa el archivo original."
            : "El archivo de este libro no está en el dispositivo. Importa el original para poder leerlo.",
        );
      driveCancelled = false;
      showDriveProgress("Recuperando el libro de Drive…");
      const result = await invoke("drive_books_sync", {
        books: transferBooks([book]),
        download: true,
        folder: library.driveFolder ?? null,
      });
      if (result.bindings?.length)
        await commit(linkDriveBooks(library, result.bindings));
      if (result.errors.length) throw new Error(result.errors[0].message);
      result.cloud.forEach((id) => cloudBooks.add(id));
      await refreshAvailability();
      if (!localBooks.has(id))
        throw new Error("El libro aún no fue subido desde el equipo original.");
    }
    const data = await invoke("read_book", {
      id: book.id,
      format: book.format,
    });
    await diagnostic("book.parse.start", data.byteLength);
    releaseBook(true);
    const opened = await parseDocument(
      new Uint8Array(data),
      book.format,
      book.title,
      { requestPassword: requestPdfPassword, lazy: true },
    );
    parsed = opened;
    pdfRotation = 0;
    if (!book.language && parsed.language)
      await commit(editBook(library, book.id, { language: parsed.language }));
    await diagnostic("book.parse.end", parsed.chapters.length);
    if (current !== book.id) {
      readerQuery = "";
      readerPanel = "";
      readerResultLimit = 100;
    }
    current = book.id;
    pendingSelection = null;
    chapterIndex = Math.max(
      0,
      parsed.chapters.findIndex((c) => c.id === book.locator?.chapter),
    );
    await parsed.ensureChapter?.(chapterIndex);
    if (
      parsed.pdfDocument &&
      parsed.hasText === null &&
      parsed.chapters.length === 1
    )
      parsed.hasText = !!parsed.chapters[0].text.trim();
    route = "reader";
    shell();
    diagnostic(
      "performance.open_ms",
      Math.round(performance.now() - openStarted),
    );
    if (opened.hasText === null)
      opened
        .detectText?.()
        .then((hasText) => {
          if (hasText === null) return;
          opened.hasText = hasText;
          if (parsed === opened) refreshPdfTextStatus();
        })
        .catch(() => {});
    (verticalReader ?? readerPagination ?? pdfReader)?.restore(
      book.locator ?? { fraction: 0 },
    );
    captureReading();
  } catch (e) {
    notify("No se pudo abrir el libro: " + e, true);
  } finally {
    busy = false;
    driveJob = "";
  }
}
function drivePanel() {
  const preview = folderPreview;
  const pages = Math.max(1, Math.ceil((preview?.files.length ?? 0) / 100));
  const visibleFiles =
    preview?.files.slice(previewPage * 100, (previewPage + 1) * 100) ?? [];
  return `<section class="panel cloud-panel"><h2>${icon("cloud")} Tu biblioteca en Google Drive</h2>
    <span class="status-chip">${drive.connected ? (drive.booksEnabled ? "Biblioteca conectada" : "Progreso conectado") : drive.configured ? "Listo para conectar" : "Configurar cuenta"}</span>
    <p>Guarda títulos, géneros, fijados, progreso y preferencias en tu cuenta. La primera carpeta que importes queda como tu biblioteca de Drive. Se reutilizan sus archivos y los libros nuevos se suben a esa misma carpeta.</p>
    <div class="button-row"><button data-action="drive-config" ${android ? "hidden" : ""} ${busy || syncing ? "disabled" : ""}>Importar configuración OAuth</button><button class="primary" data-action="drive-connect" ${!drive.configured || busy || syncing ? "disabled" : ""}>${drive.connected ? "Reconectar" : "Conectar Google"}</button><button data-action="sync" ${!drive.connected || busy || syncing ? "disabled" : ""}>Sincronizar ahora</button></div>
    ${drive.connected && !drive.booksEnabled ? `<p>Activa los archivos para recuperar tus libros en otro equipo. Google pedirá permiso para los archivos creados por el lector.</p><button data-action="drive-library" class="primary" ${busy || syncing ? "disabled" : ""}>Activar biblioteca en Drive</button>` : ""}
    ${drive.booksEnabled ? `<label class="check-label"><input type="checkbox" data-preference="downloadCloud" ${(library.preferences.downloadCloud ?? true) ? "checked" : ""}> Descargar automáticamente los libros de la biblioteca para leer sin conexión</label><p class="quiet">Si desactivas la descarga automática, cada libro se descargará al abrirlo. Las copias locales que ya tienes se conservan.</p>${library.driveFolder || drive.folderUrl ? `<p class="quiet">Carpeta de biblioteca${library.driveFolder ? ": " + escape(library.driveFolder.name) : ""}<br><span class="folder-url">${escape(library.driveFolder ? "https://drive.google.com/drive/folders/" + library.driveFolder.id : drive.folderUrl)}</span></p>` : ""}` : ""}
    <div class="drive-import"><h3>Importar una carpeta existente</h3><p>Elige sus EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown y CBZ, con sus subcarpetas si quieres. Los libros importados mantienen la referencia a su original, sin copiarse de nuevo a Drive.</p>
    ${!drive.canImport ? `<p class="quiet">Para leer una carpeta existente, Google concede acceso de lectura a los archivos de tu Drive. El lector consultará las carpetas que elijas. Los originales se conservan.</p><button data-action="drive-import-permission" ${!drive.configured || busy || syncing ? "disabled" : ""}>Permitir lectura de carpetas</button>` : `<label>Enlace de la carpeta<input id="drive-folder" type="text" placeholder="https://drive.google.com/drive/folders/…" value="${escape(folderSource)}" ${busy || syncing ? "disabled" : ""}></label><label class="check-label"><input id="drive-recursive" type="checkbox" ${folderRecursive ? "checked" : ""} ${busy || syncing ? "disabled" : ""}> Incluir subcarpetas</label><div class="button-row"><button data-action="drive-preview" ${busy || syncing ? "disabled" : ""}>Revisar carpeta</button><button data-action="drive-use-folder" ${busy || syncing || !folderSource.trim() ? "disabled" : ""}>Usar como carpeta de biblioteca</button></div>`}
    ${preview ? `<h4>${escape(preview.name)} · ${preview.files.length} libros compatibles</h4><div class="button-row"><button data-action="drive-select-all" ${busy || syncing ? "disabled" : ""}>Seleccionar todos</button><button data-action="drive-select-none" ${busy || syncing ? "disabled" : ""}>Quitar selección</button></div><div class="drive-file-list">${visibleFiles.map((f) => `<label class="check-label"><input type="checkbox" data-drive-file="${escape(f.id)}" ${selectedDriveFiles.has(f.id) ? "checked" : ""} ${busy || syncing ? "disabled" : ""}><span>${escape(f.name)}<small>${f.format.toUpperCase()} · ${(f.size / 1048576).toFixed(1)} MB</small></span></label>`).join("") || "<p>No hay documentos compatibles en esta selección.</p>"}</div>${pages > 1 ? `<div class="button-row"><button data-action="drive-page-prev" ${busy || previewPage === 0 ? "disabled" : ""}>← Anterior</button><span>Página ${previewPage + 1} de ${pages}</span><button data-action="drive-page-next" ${busy || previewPage === pages - 1 ? "disabled" : ""}>Siguiente →</button></div>` : ""}<button data-action="drive-import-selected" class="primary" ${busy || syncing || !selectedDriveFiles.size ? "disabled" : ""}>Importar seleccionados (${selectedDriveFiles.size})</button>${preview.skipped ? `<p class="quiet">${preview.skipped} archivos omitidos: formatos no compatibles.</p>` : ""}` : ""}</div>
    <div class="transfer-status" ${driveJob ? "" : "hidden"}><p id="drive-progress" role="status">${escape(driveJob)}</p><button data-action="drive-cancel">Detener transferencias</button></div>
    ${
      driveErrors.length
        ? `<details open><summary>${driveErrors.length} archivos pendientes</summary><ul>${driveErrors
            .slice(0, 20)
            .map((e) => `<li>${escape(e.title)}: ${escape(e.message)}</li>`)
            .join(
              "",
            )}</ul><p>Los demás libros se conservan. Puedes reintentar la operación.</p></details>`
        : ""
    }
    <p class="sync-error" ${syncError ? "" : "hidden"}><span>Pendiente de sincronizar. Tus cambios siguen guardados en este dispositivo.</span><br>${escape(t(syncError))}</p><p class="quiet">${library.lastSync ? t("Última sincronización: ") + new Date(library.lastSync).toLocaleString(library.preferences.uiLanguage ?? "es") : "La biblioteca funciona sin cuenta."}</p>
    ${drive.connected ? `<button data-action="disconnect" class="text-button" ${busy || syncing ? "disabled" : ""}>Desconectar y revocar permiso</button>` : ""}
    ${library.conflicts?.length ? `<details><summary>${library.conflicts.length} posiciones anteriores conservadas</summary><p>Se usa la posición más reciente. Las anteriores permanecen en la copia local.</p></details>` : ""}
    <p class="quiet">EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown y CBZ · Sin topes de tamaño, libros o subcarpetas · OneDrive llegará después.</p></section>`;
}

async function connectDrive(mode) {
  if (busy || syncing) return;
  busy = true;
  renderSettings();
  notify(
    android
      ? "Completa el permiso de Google en la pantalla de tu cuenta."
      : "Completa el permiso de Google en el navegador.",
  );
  try {
    drive = await invoke("drive_connect", { mode });
    dirty = true;
    notify(
      mode === "import" && !drive.canImport
        ? "No se concedió la lectura de carpetas. Tu conexión anterior sigue disponible."
        : mode === "library" && !drive.booksEnabled
          ? "No se concedió el acceso a los libros."
          : "Cuenta de Google conectada.",
    );
  } finally {
    busy = false;
    renderSettings();
  }
  if (drive.booksEnabled) await syncDrive();
}
async function previewDriveFolder() {
  if (busy || syncing) return;
  busy = true;
  driveCancelled = false;
  driveErrors = [];
  showDriveProgress("Revisando carpeta…");
  renderSettings();
  try {
    folderPreview = await invoke("drive_list_folder", {
      folder: folderSource,
      recursive: folderRecursive,
    });
    previewPage = 0;
    selectedDriveFiles = new Set(folderPreview.files.map((f) => f.id));
  } finally {
    busy = false;
    driveJob = "";
    renderSettings();
  }
}
async function useDriveFolder() {
  if (busy || syncing || !folderSource.trim()) return;
  busy = true;
  renderSettings();
  try {
    const folder = await invoke("drive_use_folder", { folder: folderSource });
    await commit(setDriveFolder(library, folder));
    drive.folderUrl = "https://drive.google.com/drive/folders/" + folder.id;
    folderSource = drive.folderUrl;
    notify(
      "Carpeta guardada: " +
        folder.name +
        ". La sincronización reutilizará sus libros.",
    );
  } finally {
    busy = false;
    renderSettings();
  }
}
async function importDriveSelection() {
  if (
    busy ||
    syncing ||
    importJob ||
    !folderPreview ||
    !selectedDriveFiles.size
  )
    return;
  if (!library.driveFolder) {
    const folder = await invoke("drive_use_folder", {
      folder: folderPreview.id,
    });
    await commit(setDriveFolder(library, folder));
  }
  importJob = {
    kind: "drive",
    folderId: library.driveFolder.id,
    files: folderPreview.files.filter((file) =>
      selectedDriveFiles.has(file.id),
    ),
    done: 0,
    failed: [],
  };
  await saveImportJob();
  selectedDriveFiles.clear();
  await runImportJob();
}
function isOriginalPdf() {
  return (
    !!parsed?.pdfDocument &&
    (parsed.hasText === false ||
      (library.preferences.pdfView ?? "original") === "original")
  );
}
function refreshPdfTextStatus() {
  if (!parsed?.pdfDocument || route !== "reader") return;
  for (const action of ["start-audio", "audio-from-here", "book-search"])
    root
      .querySelector(`[data-action="${action}"]`)
      ?.toggleAttribute("disabled", parsed.hasText === false);
  const option = root.querySelector('#pdf-view option[value="text"]');
  if (option) option.disabled = parsed.hasText === false;
  const tools = root.querySelector(".reader-tools");
  if (
    parsed.hasText === false &&
    tools &&
    !root.querySelector(".pdf-text-notice")
  ) {
    const notice = document.createElement("p");
    notice.className = "pdf-text-notice";
    notice.textContent = t(
      "Este PDF no tiene texto reconocible. Puedes leer sus páginas; la voz y la búsqueda necesitan reconocimiento de texto.",
    );
    tools.after(notice);
  }
}
function activeProse(surface = root) {
  return (
    surface.querySelector(`[data-vertical-index="${chapterIndex}"] .prose`) ??
    surface.querySelector(".prose")
  );
}
function activePdfSurface() {
  return (
    root.querySelector(`[data-vertical-index="${chapterIndex}"] .pdf-pages`) ??
    root.querySelector(".pdf-pages")
  );
}
function readingModeControls() {
  const mode = library.preferences.readingMode ?? "scroll";
  return `<label class="reader-mode-label">Modo de lectura<select id="reading-mode">${[
    ["scroll", "Continuo"],
    ["vertical", "Vertical sin marcos"],
    ["page", "Una página"],
    ["spread", "Dos páginas"],
  ]
    .map(
      ([value, name]) =>
        `<option value="${value}" ${value === mode ? "selected" : ""}>${name}</option>`,
    )
    .join("")}</select></label>`;
}
async function mountVerticalReader(pane, book) {
  const source = parsed;
  const originalPdf = isOriginalPdf();
  const controller = createVerticalReader(pane, {
    chapters: source.chapters,
    initialIndex: chapterIndex,
    locator:
      book.locator?.chapter === source.chapters[chapterIndex].id
        ? book.locator
        : {},
    async renderChapter(index, surface) {
      if (originalPdf) {
        const reader = createPdfReader(surface, {
          document: source.pdfDocument,
          textLayerFactory: source.textLayerFactory,
          pageNumber: index + 1,
          zoom: "fit-width",
          rotation: pdfRotation,
          borderless: true,
          onError: (error) => notify(String(error), true),
        });
        await reader.ready;
        surface.addEventListener("pointerup", () => {
          chapterIndex = index;
        });
        return reader;
      }
      const chapter = source.ensureChapter
        ? await source.ensureChapter(index)
        : source.chapters[index];
      const prose = document.createElement("article");
      prose.className = `prose ${library.preferences.font ?? "serif"} ${source.imageBook ? "comic-prose" : ""}`;
      prose.lang = source.language || "es";
      prose.innerHTML = chapter.html;
      annotateChapter(prose, visibleAnnotations(book, { chapter: chapter.id }));
      surface.replaceChildren(prose);
      await Promise.all(
        [...prose.querySelectorAll("img")].map((image) =>
          image.decode().catch(() => {}),
        ),
      );
      prose.addEventListener("pointerup", (event) => {
        chapterIndex = index;
        const anchor = selectionAnchor(prose);
        pendingSpeechPosition = anchor
          ? speechPositionForAnchor(prose, chapter, anchor)
          : speechPositionForParagraph(prose, chapter, event.target);
      });
      return {
        destroy() {
          clearSpeechHighlight(prose);
          prose.replaceChildren();
        },
      };
    },
    onChange(position) {
      if (parsed !== source || route !== "reader") return;
      chapterIndex = position.index;
      refreshReadingProgress();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(captureReading, 600);
    },
    onError: (error) => notify(String(error), true),
  });
  verticalReader = controller;
  renderReaderPanel();
  await controller.ready;
  if (verticalReader === controller) {
    updateSpeechHighlight();
    updateReadingProgress();
  }
}
function pdfViewControls() {
  if (!parsed?.pdfDocument) return "";
  return `<label class="reader-mode-label">Vista PDF<select id="pdf-view"><option value="original" ${isOriginalPdf() ? "selected" : ""}>Diseño original</option><option value="text" ${!isOriginalPdf() ? "selected" : ""} ${parsed.hasText === false ? "disabled" : ""}>Texto</option></select></label>`;
}
function requestPdfPassword(incorrect) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "book-dialog";
    dialog.innerHTML = `<form><h2>Contraseña del PDF</h2><p>${incorrect ? "La contraseña no es correcta. Inténtalo otra vez." : "Este PDF está protegido. Introduce su contraseña para abrirlo."}</p><label>Contraseña<input type="password" name="pdfPassword" required autocomplete="off"></label><p class="quiet">La contraseña no se guarda ni se sincroniza.</p><div class="button-row"><button type="button" data-password-cancel>Cancelar</button><button type="submit" class="primary">Abrir PDF</button></div></form>`;
    root.append(dialog);
    ui(dialog);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.querySelector("[data-password-cancel]").onclick = () => finish(null);
    dialog.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      finish(dialog.querySelector("input").value);
    };
    dialog.showModal();
    dialog.querySelector("input").focus();
  });
}
async function renderPdfReader() {
  const book = library.books.find((b) => b.id === current);
  appearance();
  const zoom = library.preferences.pdfZoom ?? "fit-page",
    layout = library.preferences.pdfLayout ?? "page";
  root.querySelector("#screen").innerHTML =
    `<div class="reader reader-pdf"><header class="reader-header"><button data-action="back" class="text-button">${icon("arrow")} Biblioteca</button><div><h2>${escape(book.title)}</h2><small data-content>${escape(book.author)}</small></div><button data-action="settings" class="text-button">${icon("settings")} Ajustes</button></header><div class="reader-tools"><select id="chapter" aria-label="Página">${parsed.chapters.map((chapter, index) => `<option value="${index}" ${index === chapterIndex ? "selected" : ""}>${index + 1}. ${escape(chapter.title)}</option>`).join("")}</select>${pdfViewControls()}${readingModeControls()}<label class="reader-mode-label">Zoom<select id="pdf-zoom">${[
      ["fit-page", "Ajustar página"],
      ["fit-width", "Ajustar ancho"],
      ["1", "100%"],
      ["1.25", "125%"],
      ["1.5", "150%"],
      ["2", "200%"],
      ["3", "300%"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${zoom === value ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="reader-mode-label">Páginas<select id="pdf-layout"><option value="page" ${layout === "page" ? "selected" : ""}>Una página</option><option value="spread" ${layout === "spread" ? "selected" : ""}>Dos páginas</option></select></label><button data-action="pdf-rotate">Girar</button><button data-action="start-audio" class="primary small" ${parsed.hasText === false ? "disabled" : ""}>${icon("audio")} Escuchar</button><button data-action="audio-from-here" ${parsed.hasText === false ? "disabled" : ""}>Escuchar desde aquí</button><button data-action="book-search" ${parsed.hasText === false ? "disabled" : ""}>Buscar</button><button data-action="book-notes">Notas</button><button data-action="create-quote">Crear tarjeta</button><button data-action="focus-mode" aria-label="Pantalla completa">${icon("fullscreen")}</button></div>${parsed.hasText === false ? '<p class="pdf-text-notice">Este PDF no tiene texto reconocible. Puedes leer sus páginas; la voz y la búsqueda necesitan reconocimiento de texto.</p>' : ""}<div class="reader-body"><div class="reading-pane pdf-reading-pane" tabindex="0"><p class="quiet" role="status">Preparando página…</p></div><aside id="reader-panel" class="reader-panel" ${readerPanel ? "" : "hidden"}></aside></div><footer class="reader-footer"><div class="chapter-controls"><button data-chapter-step="-1">← Anterior</button><span id="reading-page-label" aria-live="polite"></span><button data-chapter-step="1">Siguiente →</button></div><div class="book-progress"><div class="book-progress-meta"><span>Progreso del libro</span><output id="book-progress-label"></output></div><progress id="book-progress" value="0" max="100" aria-label="Progreso del libro"></progress></div></footer></div>`;
  ui(root.querySelector("#screen"));
  renderReaderPanel();
  if (library.preferences.readingMode === "vertical") {
    await mountVerticalReader(root.querySelector(".reading-pane"), book);
    return;
  }
  pdfReader = createPdfReader(root.querySelector(".reading-pane"), {
    document: parsed.pdfDocument,
    textLayerFactory: parsed.textLayerFactory,
    pageNumber: chapterIndex + 1,
    zoom,
    layout,
    rotation: pdfRotation,
    pageLabel: (number) => `${t("Página")} ${number}`,
    onChange: () => {
      refreshReadingProgress();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(captureReading, 600);
    },
    onError: () => notify("No se pudo mostrar esta página del PDF.", true),
  });
  const locator =
    book.locator?.chapter === parsed.chapters[chapterIndex].id
      ? book.locator
      : { fraction: 0 };
  pdfReader.restore(locator);
  updateReadingProgress();
}
async function renderReader() {
  const bookDocument = parsed,
    index = chapterIndex,
    generation = ++readerLoadGeneration;
  if (!bookDocument || route !== "reader") return;
  const started = performance.now();
  if (bookDocument.ensureChapter && !bookDocument.isChapterLoaded(index)) {
    readerLoading = true;
    clearReaderObserver();
    const pane = root.querySelector(".reading-pane");
    if (pane)
      pane.innerHTML = `<p class="quiet" role="status">${t("Preparando capítulo…")}</p>`;
    try {
      await bookDocument.ensureChapter(index);
    } catch (error) {
      if (generation === readerLoadGeneration) {
        readerLoading = false;
        notify(String(error), true);
      }
      return;
    }
    if (
      generation !== readerLoadGeneration ||
      parsed !== bookDocument ||
      route !== "reader"
    )
      return;
  }
  readerLoading = false;
  diagnostic("performance.chapter_ms", Math.round(performance.now() - started));
  clearReaderObserver();
  pendingSpeechPosition = null;
  if (isOriginalPdf()) {
    await renderPdfReader();
    return;
  }
  const book = library.books.find((b) => b.id === current);
  const chapter = parsed.chapters[chapterIndex];
  appearance();
  const font = library.preferences.font ?? "serif";
  document.querySelector("#screen").innerHTML =
    `<div class="reader"><header class="reader-header"><button data-action="back" class="text-button">${icon("arrow")} Biblioteca</button><div><h2>${escape(book.title)}</h2><small data-content>${escape(book.author)}</small></div><button data-action="settings" class="text-button">${icon("settings")} Ajustes</button></header><div class="reader-tools"><select id="chapter" aria-label="Capítulo">${parsed.chapters.map((ch, i) => `<option value="${i}" ${i === chapterIndex ? "selected" : ""}>${i + 1}. ${escape(ch.title)}</option>`).join("")}</select>${pdfViewControls()}<button data-action="start-audio" class="primary small" ${parsed.hasText === false ? "disabled" : ""}>${icon("audio")} Escuchar</button><button data-action="audio-from-here" class="small" ${parsed.hasText === false ? "disabled" : ""}>Escuchar desde aquí</button>${readingModeControls()}<button data-action="book-search" ${parsed.hasText === false ? "disabled" : ""}>Buscar</button><button data-action="book-notes">Notas</button><button data-action="create-quote">Crear tarjeta</button><button data-action="focus-mode" aria-label="Pantalla completa">${icon("fullscreen")}</button></div><div class="reader-body"><div class="reading-pane" tabindex="0"><article class="prose ${font} ${parsed.imageBook ? "comic-prose" : ""}" lang="${escape(parsed.language || (library.preferences.speechLanguage !== "auto" ? library.preferences.speechLanguage : "") || "es")}">${chapter.html}</article>${parsed.pdfDocument && !chapter.text.trim() ? '<p class="pdf-text-notice">Esta página no tiene texto reconocible. Puedes verla en Diseño original.</p>' : ""}</div><aside id="reader-panel" class="reader-panel" ${readerPanel ? "" : "hidden"}></aside></div><footer class="reader-footer"><div class="chapter-controls"><button data-chapter-step="-1" ${chapterIndex === 0 ? "disabled" : ""}>← Anterior</button><span id="reading-page-label" aria-live="polite"></span><button data-chapter-step="1" ${chapterIndex === parsed.chapters.length - 1 ? "disabled" : ""}>Siguiente →</button></div><div class="book-progress"><div class="book-progress-meta"><span>Progreso del libro</span><output id="book-progress-label"></output></div><progress id="book-progress" value="0" max="100" aria-label="Progreso del libro"></progress></div></footer></div>`;
  ui(document.querySelector("#screen"));
  const pane = document.querySelector(".reading-pane");
  if (library.preferences.readingMode === "vertical") {
    await mountVerticalReader(pane, book);
    return;
  }
  pane.addEventListener("scroll", () => {
    refreshReadingProgress();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(captureReading, 600);
  });
  readerResizeObserver = new ResizeObserver(refreshReadingProgress);
  readerResizeObserver.observe(pane);
  readerResizeObserver.observe(activeProse(pane));
  annotateChapter(
    activeProse(pane),
    visibleAnnotations(book, { chapter: chapter.id }),
  );
  renderReaderPanel();
  readerPagination = createReaderPagination(pane, {
    mode: library.preferences.readingMode ?? "scroll",
    locator:
      book.locator?.chapter === chapter.id ? book.locator : { fraction: 0 },
    onChange: () => {
      refreshReadingProgress();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(captureReading, 600);
    },
  });
  activeProse(pane).addEventListener("pointerup", (event) => {
    const prose = activeProse(pane);
    const anchor = selectionAnchor(prose);
    pendingSpeechPosition = anchor
      ? speechPositionForAnchor(prose, chapter, anchor)
      : speechPositionForParagraph(prose, chapter, event.target);
  });
  updateSpeechHighlight();
  updateReadingProgress();
}
function clearReaderObserver() {
  verticalReader?.destroy();
  verticalReader = null;
  pdfReader?.destroy();
  pdfReader = null;
  readerPagination?.destroy();
  readerPagination = null;
  clearSpeechHighlight(activeProse());
  readerResizeObserver?.disconnect();
  readerResizeObserver = null;
  cancelAnimationFrame(readerProgressFrame);
  readerProgressFrame = 0;
}
function readingPosition() {
  const pane = document.querySelector(".reading-pane");
  if (
    route !== "reader" ||
    !pane ||
    !parsed ||
    readerLoading ||
    (!verticalReader &&
      parsed.isChapterLoaded &&
      !parsed.isChapterLoaded(chapterIndex))
  )
    return null;
  if (verticalReader) {
    const position = verticalReader.capture();
    if (!position) return null;
    chapterIndex = position.index;
    return {
      fraction: position.fraction,
      offset: position.offset,
      progress: (position.index + position.fraction) / parsed.chapters.length,
    };
  }
  if (isOriginalPdf()) {
    const fraction = pdfReader?.capture().fraction ?? 0;
    return {
      fraction,
      progress: Math.min(
        1,
        (chapterIndex + (pdfReader?.visiblePages ?? 1) - 1 + fraction) /
          parsed.chapters.length,
      ),
    };
  }
  const locator = readerPagination?.capture();
  const distance = pane.scrollHeight - pane.clientHeight;
  const fraction =
    locator?.fraction ??
    (distance <= 0 ? 1 : Math.min(1, Math.max(0, pane.scrollTop / distance)));
  return {
    fraction,
    offset: locator?.offset,
    progress: (chapterIndex + fraction) / parsed.chapters.length,
  };
}
function updateReadingProgress() {
  const position = readingPosition();
  if (verticalReader) {
    const selector = root.querySelector("#chapter");
    if (selector) selector.value = String(chapterIndex);
  }
  const bar = document.querySelector("#book-progress");
  const label = document.querySelector("#book-progress-label");
  if (!position || !bar || !label) return;
  if (isOriginalPdf()) {
    const count = verticalReader ? 1 : (pdfReader?.visiblePages ?? 1);
    root.querySelector("#reading-page-label").textContent =
      `${t("Página")} ${chapterIndex + 1}${count > 1 ? "–" + (chapterIndex + count) : ""} / ${parsed.chapters.length}`;
    root.querySelector('[data-chapter-step="-1"]').disabled =
      chapterIndex === 0;
    root.querySelector('[data-chapter-step="1"]').disabled =
      chapterIndex + count >= parsed.chapters.length;
    bar.value = position.progress * 100;
    label.textContent = new Intl.NumberFormat(
      library.preferences.uiLanguage ?? "es",
      { style: "percent", maximumFractionDigits: 1 },
    ).format(position.progress);
    return;
  }
  const state = readerPagination?.snapshot();
  const pageLabel = root.querySelector("#reading-page-label");
  if (pageLabel)
    pageLabel.textContent =
      state?.mode !== "scroll" && state
        ? `${t("Página")} ${state.page}${state.pageEnd > state.page ? "–" + state.pageEnd : ""} / ${state.pageCount} · ${t("Capítulo")} ${chapterIndex + 1} / ${parsed.chapters.length}`
        : `${t("Capítulo")} ${chapterIndex + 1} / ${parsed.chapters.length}`;
  const previous = root.querySelector('[data-chapter-step="-1"]'),
    next = root.querySelector('[data-chapter-step="1"]');
  if (previous)
    previous.disabled =
      chapterIndex === 0 &&
      (!state || state.mode === "scroll" || state.atStart);
  if (next)
    next.disabled =
      chapterIndex === parsed.chapters.length - 1 &&
      (!state || state.mode === "scroll" || state.atEnd);
  bar.value = position.progress * 100;
  label.textContent = new Intl.NumberFormat(
    library.preferences.uiLanguage ?? "es",
    { style: "percent", maximumFractionDigits: 1 },
  ).format(position.progress);
}
function refreshReadingProgress() {
  if (readerProgressFrame) return;
  readerProgressFrame = requestAnimationFrame(() => {
    readerProgressFrame = 0;
    updateReadingProgress();
  });
}
function captureReading() {
  clearTimeout(saveTimer);
  if (route !== "reader" || !current || !parsed) return;
  const position = readingPosition();
  if (!position) return;
  const { fraction, progress, offset } = position;
  updateReadingProgress();
  commit(
    markRead(library, current, {
      progress,
      locator: {
        chapter: parsed.chapters[chapterIndex].id,
        fraction,
        ...(Number.isSafeInteger(offset) ? { offset } : {}),
      },
    }),
  );
}
function renderSettings() {
  appearance();
  const screen = document.querySelector("#screen");
  screen.innerHTML =
    settingsMarkup(library.preferences, voices, neuralVoices, {
      downloading: voiceDownloading,
      previewing: voicePreview,
      hasReading: !!current && !!parsed,
      bookLanguage: parsed?.language ?? "",
      speechAvailable: platform.speech,
      android,
    }) +
    backupPanel() +
    (platform.drive
      ? drivePanel()
      : '<section class="panel"><h2>Sincronización con Drive</h2><p>La sincronización con Drive está desactivada en esta versión pública. Estará disponible en una versión futura.</p><p>Tu biblioteca, progreso y ajustes se guardan en este dispositivo. Puedes trasladarlos con una copia ZIP.</p></section>') +
    "</div>";
  ui(screen);
}
function renderAudio() {
  root.classList.toggle("with-audio", !!queue);
  const bar = document.querySelector("#audio-bar");
  if (!bar) return;
  if (!queue) {
    bar.className = "hidden";
    return;
  }
  const book = library.books.find((b) => b.id === queue.bookId);
  bar.className = "audio-bar";
  bar.innerHTML = `${icon("audio")}<div><strong data-content>${escape(book?.title ?? "Lectura con voz")}</strong><small>${voiceStatus === "playing" ? "Leyendo" : voiceStatus === "paused" ? "En pausa" : voiceStatus === "finished" ? "Lectura terminada" : "Preparando voz"} · ${escape(voices.find((v) => v.id === queue.voice)?.name ?? queue.voice)} · ${queue.rate}×</small></div><label class="sleep-timer-label">Temporizador<select id="sleep-timer">${[
    ["off", "Sin temporizador"],
    ["15", "15 minutos"],
    ["30", "30 minutos"],
    ["60", "60 minutos"],
    ["chapter", "Fin del capítulo"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}" ${sleepMode === value ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select><small id="sleep-remaining"></small></label><div class="voice-steps"><button data-action="audio-previous" aria-label="Frase anterior">← Frase</button><button data-action="audio-next" aria-label="Frase siguiente">Frase →</button></div><button data-action="pause-audio">${voiceStatus === "playing" ? "Pausar" : "Continuar"}</button><button data-action="stop-audio">Detener</button>`;
  ui(bar);
  updateSpeechHighlight();
}
function updateSpeechHighlight() {
  const prose = activeProse();
  if (!prose) return;
  const chapter = parsed?.chapters[chapterIndex];
  if (
    route === "reader" &&
    queue?.bookId === current &&
    chapter &&
    queue.active &&
    voiceStatus === "playing" &&
    queue.active.chapter === chapter.id
  )
    highlightSpeechFragment(prose, chapter, queue.active);
  else clearSpeechHighlight(prose);
}
async function audioFromHere() {
  const prose = activeProse(),
    chapter = parsed?.chapters[chapterIndex];
  if (!chapter) return;
  if (isOriginalPdf()) {
    await startAudio({ chapter: chapter.id, offset: 0 });
    return;
  }
  if (!prose) return;
  const anchor = selectionAnchor(prose);
  const visible = readerPagination?.capture();
  const position =
    (anchor && speechPositionForAnchor(prose, chapter, anchor)) ||
    (pendingSpeechPosition?.chapter === chapter.id && pendingSpeechPosition) ||
    (visible &&
      speechPositionForAnchor(prose, chapter, {
        start: visible.offset,
        end: visible.offset,
      }));
  pendingSpeechPosition = null;
  if (!position) {
    notify("No se pudo localizar el fragmento para escucharlo.", true);
    return;
  }
  await startAudio(position);
}
async function skipAudio(direction) {
  if (!queue) return;
  if (android) return nativeAudioCommand({ action: "skip", direction });
  const active = queue,
    wasPlaying = voiceStatus === "playing";
  active.pause();
  voiceStatus = "paused";
  await invoke("speech_command", { command: { action: "cancel" } });
  if (queue !== active) return;
  active.skipFragment(direction);
  if (sleepMode === "chapter") sleepChapter = active.chapters[active.index].id;
  checkpointSpeech();
  updateSpeechHighlight();
  if (wasPlaying) await speakNext();
  else renderAudio();
}
let nativeAudioBusy = false;
let nativeAudioSignature = "";
let lastNativeError = "";
function applyNativeAudio(state) {
  if (!state) return;
  const book = library.books.find((book) => book.id === state.bookId);
  if (
    book &&
    typeof state.chapter === "string" &&
    Number.isInteger(state.offset) &&
    state.offset >= 0
  ) {
    const position = {
      chapter: state.chapter,
      offset: state.offset,
      voice: state.voice,
      rate: state.rate,
    };
    if (JSON.stringify(book.audioPosition) !== JSON.stringify(position))
      commit(setAudioPosition(library, book.id, position));
  }
  queue = nativeAudioQueue(state);
  voiceStatus = state.status === "preview" ? "paused" : state.status;
  voicePreview = !!state.previewing;
  sleepMode = state.sleepMode ?? "off";
  sleepDeadline = state.deadline ?? null;
  const signature = JSON.stringify([
    queue?.bookId,
    queue?.voice,
    queue?.rate,
    voiceStatus,
    sleepMode,
    voicePreview,
  ]);
  if (signature !== nativeAudioSignature) {
    nativeAudioSignature = signature;
    renderAudio();
    const button = root.querySelector('[data-action="preview-voice"]');
    if (button) button.textContent = t(voicePreview ? "Detener" : "Probar voz");
  } else updateSpeechHighlight();
  if (state.error && state.error !== lastNativeError) notify(state.error, true);
  lastNativeError = state.error ?? "";
}
async function nativeAudioCommand(command) {
  while (nativeAudioBusy)
    await new Promise((resolve) => setTimeout(resolve, 20));
  nativeAudioBusy = true;
  try {
    const state = await invoke("mobile_speech", { command });
    applyNativeAudio(state);
    return state;
  } finally {
    nativeAudioBusy = false;
  }
}
async function pullNativeAudio() {
  if (!android || !storageReady || nativeAudioBusy || document.hidden) return;
  return nativeAudioCommand({ action: "state" });
}
if (android) {
  setInterval(() => pullNativeAudio().catch(() => {}), 1000);
  window.addEventListener("reader-mobile-resume", () =>
    pullNativeAudio().catch(() => {}),
  );
}
function runAudioAction(action) {
  const pending = audioActionChain.catch(() => {}).then(action);
  audioActionChain = pending;
  return pending;
}
function checkpointSpeech() {
  if (queue)
    commit(setAudioPosition(library, queue.bookId, queue.checkpoint()));
}
async function speakNext() {
  const active = queue;
  if (!active) return;
  if (sleepDeadline && Date.now() >= sleepDeadline) {
    await expireSleepTimer();
    return;
  }
  const beforeIndex = active.index,
    beforeOffset = active.offset;
  const request = active.next(active.voice.startsWith("piper:") ? 350 : 1500);
  if (
    request &&
    sleepMode === "chapter" &&
    sleepChapter &&
    request.chapter !== sleepChapter
  ) {
    active.pause();
    active.index = beforeIndex;
    active.offset = beforeOffset;
    voiceStatus = "paused";
    await setSleepTimer("off");
    checkpointSpeech();
    renderAudio();
    notify("La voz se detuvo al terminar el capítulo.");
    return;
  }
  if (!request) {
    voiceStatus = "finished";
    if (sleepMode !== "off") await setSleepTimer("off");
    checkpointSpeech();
    renderAudio();
    return;
  }
  voiceStatus = "playing";
  renderAudio();
  updateSpeechHighlight();
  try {
    await invoke("speech_command", {
      command: { action: "speak", ...request },
    });
  } catch (e) {
    if (queue === active && active.active?.id === request.id) {
      voiceStatus = "error";
      checkpointSpeech();
      renderAudio();
      notify(String(e), true);
    }
  }
}
async function startAudio(position = null) {
  if (!current || !parsed) return;
  if (parsed.hasText === false) {
    notify("Este documento no contiene texto para leer en voz alta.", true);
    return;
  }
  const audioDocument = parsed,
    audioBook = current;
  const chapters = parsed.allChapters
    ? await parsed.allChapters({ textOnly: true })
    : parsed.chapters;
  if (parsed !== audioDocument || current !== audioBook) return;
  if (parsed.pdfDocument) {
    parsed.hasText = chapters.some((ch) => ch.text.trim());
    refreshPdfTextStatus();
  }
  if (parsed.pdfDocument && parsed.hasText === false) {
    notify("Este PDF no tiene texto reconocible para leer en voz alta.", true);
    return;
  }
  if (!selectVoice(voices, library.preferences, parsed.language)) {
    notify(
      "No hay una voz instalada para ese idioma. Descarga una en los ajustes.",
      true,
    );
    return;
  }
  if (queue && !android) {
    queue.pause();
    await invoke("speech_command", { command: { action: "cancel" } });
    checkpointSpeech();
  }
  const book = library.books.find((b) => b.id === current);
  const voice = selectVoice(voices, library.preferences, parsed.language).id;
  if (android) {
    await invoke("mobile_speech", {
      command: { action: "notificationPermission" },
    });
    return nativeAudioCommand({
      action: "program",
      bookId: current,
      title: book.title,
      chapters: chapters.map(({ id, text }) => ({ id, text })),
      voice,
      rate: library.preferences.rate ?? 1,
      position: position ?? book.audioPosition ?? null,
    });
  }
  queue = new SpeechQueue({
    bookId: current,
    chapters: chapters.map(({ id, text }) => ({ id, text })),
    voice,
    rate: library.preferences.rate ?? 1,
    position: position ?? book.audioPosition,
  });
  if (sleepMode === "chapter") sleepChapter = queue.chapters[queue.index].id;
  await speakNext();
}
async function pauseAudio() {
  if (!queue) return;
  if (android) {
    if (voiceStatus === "playing")
      return nativeAudioCommand({ action: "pause" });
    const voice = selectVoice(voices, library.preferences, parsed?.language);
    return nativeAudioCommand({
      action: "resume",
      voice: voice?.id ?? queue.voice,
      rate: library.preferences.rate ?? 1,
    });
  }
  if (voiceStatus === "playing") {
    queue.pause();
    voiceStatus = "paused";
    checkpointSpeech();
    renderAudio();
    await invoke("speech_command", { command: { action: "cancel" } });
  } else {
    const voice = selectVoice(voices, library.preferences, parsed?.language);
    if (!voice) {
      notify(
        "No hay una voz instalada para ese idioma. Descarga una en los ajustes.",
        true,
      );
      return;
    }
    queue.voice = voice.id;
    queue.rate = library.preferences.rate ?? 1;
    await speakNext();
  }
}
async function stopAudio() {
  if (android) return nativeAudioCommand({ action: "stop" });
  if (queue) {
    queue.pause();
    checkpointSpeech();
    queue = null;
    const cancelled = invoke("speech_command", {
      command: { action: "cancel" },
    });
    voiceStatus = "idle";
    renderAudio();
    await Promise.all([cancelled, setSleepTimer("off")]);
    if (route !== "reader" && route !== "settings") releaseBook();
  }
}
async function syncDrive(silent = false) {
  if (
    busy ||
    syncing ||
    importRunning ||
    importPreparing ||
    backupRequested ||
    !drive.connected
  )
    return;
  syncing = true;
  driveCancelled = false;
  driveErrors = [];
  const started = performance.now();
  let contentChanged = false;
  const beforeLocal = localBooks,
    beforeCloud = cloudBooks;
  diagnostic("sync.start");
  showDriveProgress("Sincronizando con tu Drive…");
  if (!silent) notify("Sincronizando con tu Drive…");
  try {
    await saveChain;
    const sent = library;
    const copies = await invoke("drive_sync", {
      snapshot: await cloudSnapshot.create(sent),
    });
    const next = mergeSnapshots(library, copies);
    contentChanged = next !== library;
    library = { ...next, lastSync: Date.now() };
    if (library.driveFolder && !folderSource) {
      folderSource =
        "https://drive.google.com/drive/folders/" + library.driveFolder.id;
      folderRecursive = true;
    }
    dirty = sent.registers !== library.registers;
    await persist();
    driveErrors = [];
    let result;
    if (drive.booksEnabled && !driveCancelled) {
      result = await invoke("drive_books_sync", {
        books: transferBooks(library.books),
        download: library.preferences.downloadCloud ?? true,
        folder: library.driveFolder ?? null,
      });
      if (result.bindings?.length) {
        const linked = linkDriveBooks(library, result.bindings);
        if (linked !== library) {
          await commit(linked);
          // Save recovered original references now so another device can reuse them immediately.
          await invoke("drive_sync", {
            snapshot: await cloudSnapshot.create(library),
          });
        }
      }
      cloudBooks = new Set(result.cloud);
      driveErrors = result.errors;
      drive.folderUrl = result.folderUrl;
      if (driveErrors.length) dirty = true;
    }
    syncSchedule.success();
    syncError = "";
    await refreshAvailability();
    contentChanged ||=
      !sameMembers(beforeLocal, localBooks) ||
      !sameMembers(beforeCloud, cloudBooks);
    contentChanged ||= pendingCloudRender;
    if (contentChanged && route === "library") {
      pendingCloudRender = !!document.querySelector("dialog[open]");
      if (!pendingCloudRender) preserveInteraction(shell);
    }
    if (contentChanged && route === "settings") {
      preserveInteraction(renderSettings);
      pendingCloudRender = false;
    }
    if (!silent || result?.uploaded || result?.downloaded || driveErrors.length)
      notify(
        result
          ? `${result.uploaded} libros subidos, ${result.downloaded} recuperados. ${driveErrors.length ? driveErrors.length + " pendientes." : "Biblioteca sincronizada."}`
          : "Progreso y preferencias sincronizados.",
        driveErrors.length > 0,
      );
  } catch (e) {
    diagnostic("sync.failed");
    syncError = String(e);
    const firstFailure = syncSchedule.failed();
    if (!silent || firstFailure) notify(syncError, true);
  } finally {
    syncing = false;
    showDriveProgress("");
    if (route === "settings")
      preserveInteraction(() => {
        const panel = document.querySelector(".cloud-panel");
        if (panel) {
          panel.outerHTML = drivePanel();
          ui(document.querySelector(".cloud-panel"));
        }
      });
    diagnostic("sync.end", Math.round(performance.now() - started));
  }
}
function selectionMarkup() {
  return `<div id="selection-bar" class="selection-bar" role="toolbar"><strong>${selectedBooks.size} libros seleccionados</strong><button data-action="select-visible">Seleccionar visibles</button><button data-action="bulk-edit" ${!selectedBooks.size ? "disabled" : ""}>Editar selección</button><button data-action="add-to-collection" ${!selectedBooks.size ? "disabled" : ""}>Añadir a colección</button><button data-action="end-selection">Cancelar</button></div>`;
}
function updateSelectionBar() {
  const bar = root.querySelector("#selection-bar");
  if (bar) {
    bar.outerHTML = selectionMarkup();
    ui(root.querySelector("#selection-bar"));
  }
  for (const card of root.querySelectorAll(".book-card"))
    card.classList.toggle("selected", selectedBooks.has(card.dataset.id));
}
function renderCollections() {
  const matching = new Set(
    queryBooks(library, { clone: false, search }).map((book) => book.id),
  );
  const groups = collectionGroups(library, { clone: false }).filter((group) =>
    group.books.some((book) => matching.has(book.id)),
  );
  const screen = root.querySelector("#screen");
  screen.innerHTML = `<header class="library-header"><div><p class="eyebrow">TU BIBLIOTECA, TUS GRUPOS</p><h1>Colecciones</h1><p class="subtitle">Un libro puede pertenecer a varias colecciones.</p></div><label class="search">${icon("search")}<input id="search" aria-label="Buscar libros" placeholder="Buscar colecciones o libros" value="${escape(search)}"></label></header><div class="library-toolbar"><span>Crea una colección seleccionando libros o desde Editar libro.</span><button data-action="create-collection">Crear colección</button></div><div class="collection-groups">${groups.map((group) => `<button class="series-group" data-collection="${escape(group.name)}">${icon("grid")}<strong data-content>${escape(group.name)}</strong><span>${group.books.length} ${group.books.length === 1 ? "libro" : "libros"}</span></button>`).join("") || `<p>Tus colecciones aparecerán aquí.</p>`}</div>`;
  ui(screen);
}
async function renderReaderPanel() {
  const panel = root.querySelector("#reader-panel");
  if (!panel || !current || !parsed) return;
  const input = panel.querySelector("#reader-search");
  const focused = document.activeElement === input,
    caret = input?.selectionStart;
  const bookDocument = parsed,
    query = readerQuery,
    limit = readerResultLimit + 1,
    run = ++searchGeneration;
  let results = [];
  if (readerPanel === "search" && query.trim()) {
    if (bookDocument.visitChapters) {
      await bookDocument
        .visitChapters((chapter, index) => {
          if (
            run !== searchGeneration ||
            parsed !== bookDocument ||
            readerPanel !== "search"
          )
            return false;
          results.push(
            ...searchBook([chapter], query, {
              limit: limit - results.length,
            }).map((result) => ({ ...result, chapterIndex: index })),
          );
          return results.length < limit;
        })
        .catch((error) => {
          if (run === searchGeneration) notify(String(error), true);
        });
      if (
        run !== searchGeneration ||
        parsed !== bookDocument ||
        readerPanel !== "search"
      )
        return;
    } else results = searchBook(bookDocument.chapters, query, { limit });
  }
  readerResults = results.slice(0, readerResultLimit);
  panel.hidden = !readerPanel;
  panel.innerHTML = readerPanelMarkup({
    type: readerPanel,
    book: library.books.find((book) => book.id === current),
    chapters: parsed.chapters,
    query: readerQuery,
    results: readerResults,
    more: results.length > readerResultLimit,
  });
  ui(panel);
  if (focused) {
    const next = panel.querySelector("#reader-search");
    next?.focus();
    next?.setSelectionRange(caret, caret);
  }
}
function repaintAnnotations() {
  const pane = root.querySelector(".reading-pane");
  if (!pane || !current || !parsed) return;
  if (isOriginalPdf()) {
    renderReaderPanel();
    return;
  }
  const top = pane.scrollTop;
  const locator = readerPagination?.capture();
  clearSpeechHighlight(activeProse(pane));
  annotateChapter(
    activeProse(pane),
    visibleAnnotations(
      library.books.find((book) => book.id === current),
      { chapter: parsed.chapters[chapterIndex].id },
    ),
  );
  if (locator) readerPagination?.refresh(locator);
  else pane.scrollTop = top;
  updateSpeechHighlight();
  renderReaderPanel();
}
function addAnnotation(type) {
  if (!current || !parsed || route !== "reader") return;
  if (isOriginalPdf() && type !== "bookmark") {
    notify("Cambia a Texto para seleccionar y anotar un fragmento del PDF.");
    return;
  }
  const prose = activeProse();
  const anchor = pendingSelection || (prose && selectionAnchor(prose));
  pendingSelection = null;
  if (type !== "bookmark" && !anchor) {
    notify("Selecciona primero un fragmento del texto.");
    return;
  }
  const position =
    anchor ||
    (isOriginalPdf() || parsed.imageBook
      ? { start: 0, end: 0, quote: "" }
      : readerPagination?.viewportAnchor() || viewportAnchor(prose));
  if (!position) {
    notify("No hay texto visible para guardar un marcador.");
    return;
  }
  const now = Date.now();
  const annotation = {
    id: crypto.randomUUID(),
    type,
    chapter: parsed.chapters[chapterIndex].id,
    start: position.start,
    end: type === "bookmark" ? position.start : position.end,
    quote: type === "bookmark" ? position.quote.slice(0, 120) : position.quote,
    note: "",
    label: "",
    color: "yellow",
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  editAnnotation(annotation);
}
function createQuoteCard() {
  if (!current || !parsed || route !== "reader") return;
  const originalPdf = isOriginalPdf();
  const anchor =
    pendingSelection ||
    (originalPdf
      ? { quote: selectedPdfQuote(activePdfSurface()) }
      : selectionAnchor(activeProse()));
  pendingSelection = null;
  if (!originalPdf && !parsed.imageBook && !anchor?.quote.trim()) {
    notify("Selecciona una frase o un párrafo para crear tu tarjeta.");
    return;
  }
  const book = library.books.find((book) => book.id === current);
  openQuoteCard({
    quote: anchor?.quote ?? "",
    hint:
      originalPdf && !anchor?.quote
        ? "Si la página es un escaneo, escribe la cita aquí para crear tu tarjeta."
        : parsed.imageBook && !anchor?.quote
          ? "Estas páginas son imágenes. Escribe la cita aquí para crear tu tarjeta."
          : "",
    title: book.title,
    author: book.author,
  });
}
function openQuoteCard(content = {}) {
  quoteCardDialog({
    root,
    ...content,
    localize: ui,
    onBackground: () => invoke("select_quote_background"),
    onSave: (value) => invoke("save_quote_image", value),
    onCopy: (value) => invoke("copy_quote_image", value),
    onShare: android ? (value) => invoke("share_quote_image", value) : null,
    copyAvailable: platform.imageClipboard,
  });
}
function editAnnotation(annotation) {
  const bookId = current;
  annotationDialog({
    root,
    annotation,
    localize: ui,
    onError: (error) => notify(String(error), true),
    onSave: async (value) => {
      await commit(upsertAnnotation(library, bookId, value));
      if (current === bookId) {
        repaintAnnotations();
        readerPanel = "notes";
        renderReaderPanel();
      }
    },
  });
}
async function navigateAnchor(anchor) {
  const index = parsed?.chapters.findIndex(
    (chapter) => chapter.id === anchor.chapter,
  );
  if (index === undefined || index < 0) return;
  captureReading();
  chapterIndex = index;
  if (parsed.pdfDocument && (anchor.end > anchor.start || anchor.quote))
    commit({
      ...library,
      preferences: { ...library.preferences, pdfView: "text" },
    });
  await renderReader();
  if (route !== "reader" || chapterIndex !== index) return;
  if (isOriginalPdf() || parsed.imageBook) {
    await verticalReader?.goTo(index);
    pdfReader?.restore({ fraction: 0 });
    captureReading();
    return;
  }
  if (!revealAnchor(activeProse(), anchor))
    notify("El fragmento guardado ya no coincide con este capítulo.");
  readerPagination?.reveal(anchor);
  captureReading();
}
async function toggleFocusMode() {
  const next = !focusMode;
  if (!platform.mobile) await getCurrentWindow().setFullscreen(next);
  focusMode = next;
  root.classList.toggle("reader-focus", focusMode);
  refreshReadingProgress();
}
async function setSleepTimer(mode) {
  if (!["off", "15", "30", "60", "chapter"].includes(mode)) return;
  if (android) return nativeAudioCommand({ action: "timer", mode });
  const status = await invoke("speech_timer", {
    minutes: ["off", "chapter"].includes(mode) ? null : Number(mode),
  });
  sleepMode = mode;
  sleepDeadline = status?.deadline ?? null;
  sleepChapter =
    mode === "chapter" && queue ? queue.chapters[queue.index].id : null;
  renderAudio();
  updateSleepRemaining();
}
async function expireSleepTimer() {
  if (android) return pullNativeAudio();
  if (queue) {
    queue.pause();
    voiceStatus = "paused";
    checkpointSpeech();
  }
  sleepDeadline = null;
  sleepMode = "off";
  sleepChapter = null;
  await invoke("speech_command", { command: { action: "cancel" } });
  renderAudio();
  notify("La voz se detuvo por el temporizador.");
}
function updateSleepRemaining() {
  const remaining = root.querySelector("#sleep-remaining");
  if (remaining)
    remaining.textContent = sleepDeadline
      ? `${Math.max(0, Math.ceil((sleepDeadline - Date.now()) / 60000))} ${t("minutos restantes")}`
      : "";
}
setInterval(updateSleepRemaining, 1000);
function backupPanel() {
  return `${android ? '<section class="panel"><h2>Documentos del teléfono</h2><button data-action="scan-documents">Buscar libros en el teléfono</button></section>' : ""}<section class="panel backup-panel"><h2>Copia de seguridad</h2><p>Guarda tus libros, organización, notas, ajustes y progreso en un archivo ZIP.</p><div class="button-row"><button data-action="export-backup">Exportar copia</button><button data-action="import-backup">Restaurar copia</button></div><p class="quiet">Incluye los libros descargados. Los libros que solo están en Drive conservan su referencia. Las credenciales y las voces descargadas no se incluyen.</p></section><section class="panel shortcuts-panel"><h2>Atajos de lectura</h2><p>F11: pantalla completa · Esc: volver · Ctrl+F: buscar en el libro · Ctrl+M: marcador · Ctrl+Mayús+H: subrayar · Ctrl+Mayús+N: nota · ←/→: capítulo anterior/siguiente · Ctrl+Espacio: pausar o continuar la voz.</p></section>`;
}
async function reserveBackup() {
  if (backupRequested) return false;
  backupRequested = true;
  if (busy || syncing)
    notify("La copia comenzará al terminar la operación en curso.");
  while (busy || syncing || importRunning || importPreparing)
    await new Promise((resolve) => setTimeout(resolve, 200));
  return true;
}
async function handleExtraAction(button) {
  if (button.dataset.collection) {
    extraFilters = {};
    selectedFilterView = "";
    captureReading();
    collection = button.dataset.collection;
    section = "all";
    genre = series = search = sort = "";
    route = "library";
    shell();
    return true;
  }
  if (button.dataset.searchResult) {
    const result = readerResults[Number(button.dataset.searchResult)];
    if (result) navigateAnchor(result);
    return true;
  }
  const book = current
    ? library.books.find((book) => book.id === current)
    : null;
  const annotationId =
    button.dataset.goAnnotation ||
    button.dataset.editAnnotation ||
    button.dataset.deleteAnnotation;
  if (annotationId && book) {
    const annotation = visibleAnnotations(book).find(
      (value) => value.id === annotationId,
    );
    if (annotation) {
      if (button.dataset.goAnnotation) navigateAnchor(annotation);
      if (button.dataset.editAnnotation) editAnnotation(annotation);
      if (button.dataset.deleteAnnotation) {
        await commit(deleteAnnotation(library, current, annotationId));
        repaintAnnotations();
      }
    }
    return true;
  }
  switch (button.dataset.action) {
    case "pause-import":
      importPaused = true;
      notify("La importación se pausará al terminar este libro.");
      break;
    case "resume-import":
      await runImportJob();
      break;
    case "discard-import":
      if (!importRunning) {
        importJob = null;
        await saveImportJob();
        renderImportJob();
      }
      break;
    case "toggle-selection":
      selectionMode = !selectionMode;
      if (!selectionMode) selectedBooks.clear();
      preserveInteraction(renderScreen);
      break;
    case "end-selection":
      selectionMode = false;
      selectedBooks.clear();
      preserveInteraction(renderScreen);
      break;
    case "select-visible":
      visibleBooks.forEach((book) => selectedBooks.add(book.id));
      preserveInteraction(renderScreen);
      break;
    case "bulk-edit": {
      const ids = [...selectedBooks];
      if (!ids.length) break;
      bulkDialog({
        root,
        count: ids.length,
        localize: ui,
        onError: (error) => notify(String(error), true),
        onSave: async (patch) => {
          await commit(editBooks(library, ids, patch));
          preserveInteraction(shell);
        },
      });
      break;
    }
    case "add-to-collection": {
      const ids = [...selectedBooks];
      if (!ids.length) break;
      collectionDialog({
        root,
        count: ids.length,
        names: collectionGroups(library, { clone: false }).map(
          (group) => group.name,
        ),
        localize: ui,
        onError: (error) => notify(String(error), true),
        onSave: async (name) => {
          let next = library;
          for (const id of ids) {
            const book = next.books.find((book) => book.id === id);
            next = editBook(next, id, {
              collections: [...(book.collections ?? []), name],
            });
          }
          await commit(next);
          preserveInteraction(shell);
        },
      });
      break;
    }
    case "collections-groups":
      captureReading();
      route = "collections";
      search = "";
      shell();
      break;
    case "create-collection":
      route = "library";
      section = "all";
      genre = series = collection = search = sort = "";
      selectionMode = true;
      selectedBooks.clear();
      shell();
      notify("Selecciona libros y pulsa Añadir a colección.");
      break;
    case "book-search":
      readerPanel = readerPanel === "search" ? "" : "search";
      renderReaderPanel();
      root.querySelector("#reader-search")?.focus();
      break;
    case "book-notes":
      readerPanel = readerPanel === "notes" ? "" : "notes";
      renderReaderPanel();
      break;
    case "close-reader-panel":
      readerPanel = "";
      renderReaderPanel();
      break;
    case "more-search-results":
      readerResultLimit += 100;
      renderReaderPanel();
      break;
    case "add-bookmark":
      addAnnotation("bookmark");
      break;
    case "add-highlight":
      addAnnotation("highlight");
      break;
    case "add-note":
      addAnnotation("note");
      break;
    case "create-quote":
      createQuoteCard();
      break;
    case "create-free-quote":
      openQuoteCard({ freeform: true });
      break;
    case "focus-mode":
      await toggleFocusMode();
      break;
    case "export-backup": {
      if (!(await reserveBackup())) break;
      busy = true;
      try {
        captureReading();
        checkpointSpeech();
        await saveChain;
        notify("Preparando la copia de seguridad…");
        const result = await invoke("export_backup", { value: library });
        if (result)
          notify(
            result.remoteBooks
              ? `Copia guardada con ${result.filesExported} archivos. ${result.remoteBooks} libros conservan solo su referencia de Drive; necesitarás Drive para abrirlos.`
              : "Copia de seguridad guardada.",
          );
      } finally {
        busy = false;
        backupRequested = false;
      }
      break;
    }
    case "import-backup": {
      if (!(await reserveBackup())) break;
      busy = true;
      try {
        const result = await invoke("import_backup");
        if (result) {
          result.library = importLibrary(result.library);
          await refreshAvailability();
          restoreDialog({
            root,
            result,
            localize: ui,
            onError: (error) => notify(String(error), true),
            onSave: async (options) => {
              await commit(restoreLibrary(library, result.library, options));
              await refreshAvailability();
              appearance();
              preserveInteraction(shell);
              notify("Copia restaurada. Se conservaron los demás libros.");
            },
          });
        }
      } finally {
        busy = false;
        backupRequested = false;
      }
      break;
    }
    default:
      return false;
  }
  return true;
}
root.addEventListener("pointerdown", (event) => {
  if (event.target.closest('[data-action="audio-from-here"]')) {
    const prose = activeProse(),
      chapter = parsed?.chapters[chapterIndex],
      anchor = selectionAnchor(prose);
    if (prose && chapter && anchor)
      pendingSpeechPosition = speechPositionForAnchor(prose, chapter, anchor);
  }
  if (
    event.target.closest(
      '[data-action="add-highlight"],[data-action="add-note"],[data-action="add-bookmark"],[data-action="create-quote"]',
    )
  )
    pendingSelection =
      isOriginalPdf() && event.target.closest('[data-action="create-quote"]')
        ? { quote: selectedPdfQuote(activePdfSurface()) }
        : selectionAnchor(activeProse());
});
document.addEventListener("keydown", async (event) => {
  if (root.querySelector("dialog[open]")) return;
  try {
    if (event.key === "Escape") {
      if (focusMode) {
        event.preventDefault();
        await toggleFocusMode();
      } else if (readerPanel) {
        event.preventDefault();
        readerPanel = "";
        renderReaderPanel();
        root.querySelector(".reading-pane")?.focus();
      }
      return;
    }
    if (route !== "reader") return;
    const control = event.ctrlKey || event.metaKey;
    if (event.key === "F11") {
      event.preventDefault();
      await toggleFocusMode();
    } else if (
      event.target.closest("input,textarea,select,[contenteditable=true]")
    )
      return;
    else if (control && event.key.toLowerCase() === "f") {
      event.preventDefault();
      readerPanel = "search";
      renderReaderPanel();
      root.querySelector("#reader-search")?.focus();
    } else if (control && event.key.toLowerCase() === "m") {
      event.preventDefault();
      addAnnotation("bookmark");
    } else if (
      control &&
      event.shiftKey &&
      ["h", "n"].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      addAnnotation(event.key.toLowerCase() === "h" ? "highlight" : "note");
    } else if (control && event.code === "Space") {
      event.preventDefault();
      await runAudioAction(() => (queue ? pauseAudio() : startAudio()));
    } else if (
      !control &&
      !event.altKey &&
      ["ArrowLeft", "ArrowRight"].includes(event.key) &&
      !document.getSelection()?.toString()
    ) {
      event.preventDefault();
      root
        .querySelector(
          `[data-chapter-step="${event.key === "ArrowLeft" ? -1 : 1}"]`,
        )
        ?.click();
    }
  } catch (error) {
    notify(String(error), true);
  }
});
async function editMetadata(id) {
  const book = library.books.find((b) => b.id === id);
  if (!book) return;
  metadataDialog({
    root,
    book,
    previewCover: await coverCache.url(book.cover).catch(() => null),
    seriesNames: seriesGroups(library, { clone: false }).map((g) => g.name),
    collectionNames: collectionGroups(library, { clone: false }).map(
      (g) => g.name,
    ),
    onCover: () => invoke("select_cover"),
    localize: ui,
    onError: (e) => notify(String(e), true),
    onSave: async (patch) => {
      await commit(editBook(library, id, patch));
      spineCache.delete(id);
      preserveInteraction(shell);
    },
  });
}
root.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  if (mobileNav.handle(button)) return;
  try {
    if (button.dataset.libraryPage !== undefined) {
      libraryPage = Math.max(0, Number(button.dataset.libraryPage));
      renderScreen();
      root.querySelector(".workspace").scrollTop = 0;
      return;
    }
    if (button.dataset.theme) {
      await changePreference("theme", button.dataset.theme);
      return;
    }
    if (button.dataset.installVoice) {
      await installVoice(button.dataset.installVoice);
      return;
    }
    if (button.dataset.open) {
      await openBook(button.dataset.open);
      return;
    }
    if (button.dataset.pin) {
      const book = library.books.find((b) => b.id === button.dataset.pin);
      await commit(pinBook(library, book.id, book.pinOrder === null));
      shell();
      return;
    }
    if (button.dataset.edit) {
      editMetadata(button.dataset.edit);
      return;
    }
    if (button.dataset.move) {
      const ids = queryBooks(library, { section: "pinned" }).map((b) => b.id),
        i = ids.indexOf(button.dataset.move),
        j = i + Number(button.dataset.step);
      if (j >= 0 && j < ids.length) {
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await commit(reorderPins(library, ids));
        shell();
      }
      return;
    }
    if (button.dataset.view) {
      await commit(setView(library, button.dataset.view));
      renderScreen();
      return;
    }
    if (button.dataset.section || button.dataset.genre) {
      extraFilters = {};
      selectedFilterView = "";
      captureReading();
      section = button.dataset.section || "all";
      genre = button.dataset.genre || "";
      series = collection = "";
      search = "";
      sort = "";
      route = "library";
      shell();
      return;
    }
    if (button.dataset.series) {
      extraFilters = {};
      selectedFilterView = "";
      captureReading();
      series = button.dataset.series;
      section = "all";
      genre = collection = search = sort = "";
      route = "library";
      shell();
      return;
    }
    if (await handleExtraAction(button)) return;
    if (button.dataset.chapterStep) {
      pendingSpeechPosition = null;
      captureReading();
      const direction = Number(button.dataset.chapterStep);
      if (verticalReader) {
        await verticalReader.goTo(chapterIndex + direction);
        captureReading();
        return;
      }
      if (isOriginalPdf()) {
        const paired =
          library.preferences.pdfLayout === "spread" &&
          root.querySelector(".reading-pane").clientWidth >= 720;
        const next =
          direction > 0
            ? chapterIndex + (pdfReader?.visiblePages ?? 1)
            : Math.max(0, chapterIndex - (paired ? 2 : 1));
        if (next < 0 || next >= parsed.chapters.length) return;
        chapterIndex = next;
        await renderReader();
        captureReading();
        return;
      }
      if (
        readerPagination?.snapshot().mode !== "scroll" &&
        (direction > 0 ? readerPagination.next() : readerPagination.previous())
      ) {
        captureReading();
        return;
      }
      const nextChapter = chapterIndex + direction;
      if (nextChapter < 0 || nextChapter >= parsed.chapters.length) return;
      chapterIndex = nextChapter;
      await renderReader();
      if (direction < 0 && readerPagination?.snapshot().mode !== "scroll")
        readerPagination?.restore({ fraction: 1 });
      captureReading();
      return;
    }
    switch (button.dataset.action) {
      case "series-groups":
        captureReading();
        route = "series";
        search = "";
        shell();
        break;
      case "detect-series":
        await detectSeries();
        break;
      case "scan-documents":
        scanDocuments();
        break;
      case "voice-settings":
        await invoke("mobile_speech", { command: { action: "voiceSettings" } });
        break;
      case "import":
        if (android) scanDocuments();
        else await importFiles();
        break;
      case "back":
        captureReading();
        route = "library";
        shell();
        break;
      case "settings":
        captureReading();
        route = "settings";
        shell();
        break;
      case "resume-reading":
        if (current && parsed) {
          route = "reader";
          shell();
          const book = library.books.find((b) => b.id === current);
          (verticalReader ?? readerPagination ?? pdfReader)?.restore(
            book.locator ?? { fraction: 0 },
          );
        }
        break;
      case "reset-page":
        await commit({
          ...library,
          preferences: {
            ...library.preferences,
            ...Object.fromEntries(
              Object.entries(APPEARANCE_DEFAULTS).filter(
                ([key]) => key !== "theme",
              ),
            ),
          },
        });
        preserveInteraction(renderSettings);
        break;
      case "refresh-voices":
        await refreshVoices();
        preserveInteraction(renderSettings);
        break;
      case "preview-voice":
        await previewVoice();
        break;
      case "start-audio":
        await runAudioAction(() => startAudio());
        break;
      case "pdf-rotate":
        captureReading();
        pdfRotation = (pdfRotation + 90) % 360;
        renderReader();
        break;
      case "audio-from-here":
        await runAudioAction(audioFromHere);
        break;
      case "audio-previous":
        await runAudioAction(() => skipAudio(-1));
        break;
      case "audio-next":
        await runAudioAction(() => skipAudio(1));
        break;
      case "pause-audio":
        await runAudioAction(pauseAudio);
        break;
      case "stop-audio":
        await runAudioAction(stopAudio);
        break;
      case "drive-config":
        drive = await invoke("drive_config", { import: true });
        renderSettings();
        notify(
          drive.configured
            ? "Configuración importada en el almacén seguro de Windows."
            : "Configuración pendiente.",
        );
        break;
      case "drive-connect":
        await connectDrive("progress");
        break;
      case "drive-library":
        await connectDrive("library");
        break;
      case "drive-import-permission":
        await connectDrive("import");
        break;
      case "drive-preview":
        await previewDriveFolder();
        break;
      case "drive-use-folder":
        await useDriveFolder();
        break;
      case "drive-page-prev":
        previewPage--;
        renderSettings();
        break;
      case "drive-page-next":
        previewPage++;
        renderSettings();
        break;
      case "drive-select-all":
        selectedDriveFiles = new Set(folderPreview.files.map((f) => f.id));
        renderSettings();
        break;
      case "drive-select-none":
        selectedDriveFiles.clear();
        renderSettings();
        break;
      case "drive-import-selected":
        await importDriveSelection();
        break;
      case "drive-cancel":
        driveCancelled = true;
        if (importRunning) importPaused = true;
        await invoke("drive_cancel");
        showDriveProgress(
          "Deteniendo las transferencias. Se conservan los libros ya guardados.",
        );
        break;
      case "sync":
        await syncDrive();
        break;
      case "disconnect":
        await invoke("drive_disconnect");
        drive = await invoke("drive_config", { import: false });
        cloudBooks.clear();
        renderSettings();
        notify("Permiso de Google revocado.");
        break;
    }
  } catch (e) {
    notify(String(e), true);
  }
});
root.addEventListener("input", (event) => {
  if (event.target.type === "range" && event.target.dataset.preference) {
    const name = event.target.dataset.preference;
    const value = Number(event.target.value);
    applyAppearance(document.documentElement, {
      ...library.preferences,
      [name]: value,
    });
    const output = root.querySelector(`[data-output="${name}"]`);
    if (output)
      output.textContent = `${value}${["fontSize", "pageWidth", "pagePadding"].includes(name) ? " px" : ["paragraphSpacing", "letterSpacing"].includes(name) ? " em" : ""}`;
  }
  if (event.target.id === "drive-folder") {
    folderSource = event.target.value;
    const choose = root.querySelector('[data-action="drive-use-folder"]');
    if (choose) choose.disabled = busy || !folderSource.trim();
  }
  if (event.target.id === "reader-search") {
    readerQuery = event.target.value;
    readerResultLimit = 100;
    searchGeneration++;
    clearTimeout(readerSearchTimer);
    readerSearchTimer = setTimeout(
      () => renderReaderPanel().catch((error) => notify(String(error), true)),
      180,
    );
  }
  if (event.target.id === "search") {
    const pos = event.target.selectionStart;
    search = event.target.value;
    renderScreen();
    const input = document.querySelector("#search");
    input.focus();
    input.setSelectionRange(pos, pos);
  }
});
root.addEventListener("change", async (event) => {
  const el = event.target;
  if (["pdf-view", "pdf-zoom", "pdf-layout"].includes(el.id)) {
    captureReading();
    const key = {
      "pdf-view": "pdfView",
      "pdf-zoom": "pdfZoom",
      "pdf-layout": "pdfLayout",
    }[el.id];
    await commit({
      ...library,
      preferences: { ...library.preferences, [key]: el.value },
    });
    await renderReader();
    if (key === "pdfView")
      (verticalReader ?? readerPagination ?? pdfReader)?.restore({
        fraction: 0,
      });
    captureReading();
  }
  if (el.id === "drive-recursive") folderRecursive = el.checked;
  if (el.dataset.driveFile) {
    el.checked
      ? selectedDriveFiles.add(el.dataset.driveFile)
      : selectedDriveFiles.delete(el.dataset.driveFile);
    const action = root.querySelector('[data-action="drive-import-selected"]');
    action.textContent = t(
      `Importar seleccionados (${selectedDriveFiles.size})`,
    );
    action.disabled = !selectedDriveFiles.size || busy;
  }
  if (el.dataset.selectBook) {
    el.checked
      ? selectedBooks.add(el.dataset.selectBook)
      : selectedBooks.delete(el.dataset.selectBook);
    updateSelectionBar();
  }
  if (el.id === "reading-mode") {
    captureReading();
    await commit({
      ...library,
      preferences: { ...library.preferences, readingMode: el.value },
    });
    await renderReader();
    updateReadingProgress();
  }
  if (el.id === "sleep-timer") await setSleepTimer(el.value);
  if (el.id === "sort") {
    sort = el.value;
    renderScreen();
  }
  if (el.id === "chapter") {
    const requestedIndex = Number(el.value);
    captureReading();
    chapterIndex = requestedIndex;
    pendingSpeechPosition = null;
    if (verticalReader) await verticalReader.goTo(chapterIndex);
    else await renderReader();
    captureReading();
  }
  if (el.dataset.preference) {
    const name = el.dataset.preference;
    const value =
      el.type === "checkbox"
        ? el.checked
        : name in NUMBER_PREFERENCES
          ? Number(el.value)
          : el.value;
    await changePreference(name, value);
  }
});
if (!platform.mobile)
  await getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    captureReading();
    checkpointSpeech();
    importPaused = true;
    try {
      while (importRunning || importPreparing)
        await new Promise((resolve) => setTimeout(resolve, 50));
      await saveChain;
      if (importJob) await saveImportJob();
      await getCurrentWindow().destroy();
    } catch (e) {
      notify("No se pudo guardar antes de cerrar. " + e, true);
    }
  });
async function saveOnBackground() {
  if (!storageReady) return;
  captureReading();
  checkpointSpeech();
  importPaused = true;
  if (importJob) await saveImportJob();
  await saveChain;
}
if (platform.mobile) {
  window.addEventListener("reader-mobile-pause", () =>
    saveOnBackground().catch((error) => notify(String(error), true)),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden)
      saveOnBackground().catch((error) => notify(String(error), true));
  });
  window.addEventListener("reader-mobile-back", async () => {
    const dialog = root.querySelector("dialog[open]");
    if (dialog) {
      dialog.close();
      return;
    }
    if (mobileNav.close()) return;
    if (focusMode) {
      await toggleFocusMode();
      return;
    }
    if (readerPanel) {
      readerPanel = "";
      renderReaderPanel();
      return;
    }
    if (route !== "library") {
      captureReading();
      route = "library";
      root.classList.remove("mobile-tools-open");
      shell();
      return;
    }
    try {
      await saveOnBackground();
      await invoke("mobile_background");
    } catch (error) {
      notify(String(error), true);
    }
  });
}
await listen("drive-transfer", ({ payload }) =>
  showDriveProgress(payload.message),
);
await listen("voice-download", ({ payload }) => {
  const progress = root.querySelector("#voice-download-progress");
  if (progress)
    progress.textContent = `${t(payload.phase === "engine" ? "Motor de voz" : "Voz")} · ${Math.min(100, Math.round((payload.bytes / payload.total) * 100))}%`;
});
await listen("sleep-timer", async ({ payload }) => {
  if (payload?.expired) await expireSleepTimer();
});
await listen("speech-event", ({ payload: event }) => {
  if (android) return;
  if (event.id?.startsWith("preview:") && event.type === "completed") {
    voicePreview = false;
    const button = root.querySelector('[data-action="preview-voice"]');
    if (button) button.textContent = t("Probar voz");
    if (event.error) notify(event.error, true);
  }
  if (!queue) return;
  if (event.type === "progress" && queue.progress(event.id, event.offset)) {
    if (Date.now() - lastSpeechSave > 8000) {
      checkpointSpeech();
      lastSpeechSave = Date.now();
    }
  }
  if (event.type === "completed" && queue.complete(event.id, event)) {
    checkpointSpeech();
    if (!event.cancelled && !event.error) speakNext();
    else {
      voiceStatus = event.error ? "error" : "paused";
      renderAudio();
    }
  }
  if (event.type === "fault" && (!event.id || event.id === queue.active?.id)) {
    voiceStatus = "error";
    queue.pause();
    checkpointSpeech();
    renderAudio();
    notify(event.error, true);
  }
});
try {
  library = hydrateLocalCovers(
    await invoke("load_state", { lazyCovers: true }),
  );
  lastPersisted = library;
  storageReady = true;
  if (library.driveFolder) {
    folderSource =
      "https://drive.google.com/drive/folders/" + library.driveFolder.id;
    folderRecursive = true;
  }
  if (!library.deviceId)
    library = { ...library, deviceId: crypto.randomUUID() };
  if (!Object.keys(library.registers ?? {}).length)
    library = stampChanges(createLibrary(), library, library.deviceId);
  await persist();
  await refreshAvailability();
  shell();
  diagnostic("frontend.ready", library.books.length);
  diagnostic(
    "performance.startup_ms",
    Math.round(performance.now() - startupStarted),
  );
  importJob = await invoke("import_queue", { value: null }).catch(() => null);
  renderImportJob();
  if (platform.drive) drive = await invoke("drive_config", { import: false });
  dirty = drive.connected;
  await refreshVoices();
  if (android) await pullNativeAudio();
  else
    sleepDeadline =
      (await invoke("speech_timer_status").catch(() => null))?.deadline ?? null;
  if (route === "settings") renderSettings();
} catch (e) {
  shell();
  notify(String(e), true);
}
