// Isolated DOM regressions: synthetic metadata only, no app or account access.
import assert from "node:assert/strict";
import { createServer } from "vite";
const { chromium } = await import(
  process.env.LECTOR_PLAYWRIGHT_PATH || "playwright"
);
const server = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "i18n-fixture",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== "/i18n-fixture") return next();
          response.setHeader("Content-Type", "text/html");
          response.end(
            '<!DOCTYPE html><html><body><div id="fixture"></div></body></html>',
          );
        });
      },
    },
  ],
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0] + "i18n-fixture");
  const result = await page.evaluate(async () => {
    const { localizeUI } = await import("/src/core/i18n.mjs");
    const { settingsMarkup } = await import("/src/settings.mjs");
    const fixture = document.querySelector("#fixture");
    fixture.innerHTML = `
      <h1>Biblioteca</h1><button id="action">Importar seleccionados (2)</button>
      <select><optgroup label="Temas nocturnos"><option>Noche</option></optgroup></select>
      <input id="search" placeholder="Título, autor o género" aria-label="Buscar libros" value="Biblioteca">
      <article class="book-card"><button class="cover" data-open="fixture" aria-label="Leer Biblioteca" title="Biblioteca — Noche"><img alt="Portada de Biblioteca"><span>Biblioteca</span></button><div class="book-info"><button class="book-title">Tema</button><p>Noche</p><span class="book-bottom">En Drive · 75% leído</span><button data-pin="fixture" aria-label="Desfijar Biblioteca"></button><button data-edit="fixture" aria-label="Editar Tema"></button></div></article>
      <nav class="genres"><button>Noche</button></nav><h2 data-content>Tema</h2>
      <div class="reader-header"><h2>Biblioteca</h2><small data-content>Noche</small></div><select id="chapter"><option>Biblioteca</option></select>
      <div class="prose"><p>Biblioteca</p><button data-open="fixture" aria-label="Leer Tema">Tema</button><img alt="Biblioteca"></div>
      <div class="drive-file-list"><label><input type="checkbox"><span>Biblioteca<small>EPUB · 1 MB</small></span></label><p>No hay EPUB o TXT en esta selección.</p></div>
      <select data-preference="voice"><option value="voice">Noche</option></select>
      <div id="audio-bar"><strong data-content>Tema</strong><small>Leyendo · Noche · 1×</small></div>
      <textarea>Biblioteca</textarea><div contenteditable="true">Tema</div>
      <div id="whitespace">\n  Personalizar y sincronizar  \n</div>`;
    localizeUI(fixture, "en");
    localizeUI(fixture, "en");
    const english = {
      heading: fixture.querySelector("h1").textContent,
      optgroup: fixture.querySelector("optgroup").label,
      option: fixture.querySelector("optgroup option").textContent,
      search: fixture.querySelector("#search").getAttribute("placeholder"),
      searchValue: fixture.querySelector("#search").value,
      book: fixture.querySelector(".cover span").textContent,
      tooltip: fixture.querySelector(".cover").title,
      readLabel: fixture.querySelector(".cover").getAttribute("aria-label"),
      coverAlt: fixture.querySelector(".cover img").alt,
      unpin: fixture.querySelector("[data-pin]").getAttribute("aria-label"),
      edit: fixture.querySelector("[data-edit]").getAttribute("aria-label"),
      author: fixture.querySelector(".book-info p").textContent,
      genre: fixture.querySelector(".genres button").textContent,
      chapter: fixture.querySelector("#chapter option").textContent,
      prose: fixture.querySelector(".prose").textContent,
      proseAction: fixture
        .querySelector(".prose button")
        .getAttribute("aria-label"),
      file: fixture.querySelector(".drive-file-list label span").firstChild
        .textContent,
      voice: fixture.querySelector('[data-preference="voice"] option')
        .textContent,
      audio: fixture.querySelector("#audio-bar small").textContent,
      status: fixture.querySelector(".book-bottom").textContent,
      whitespace: fixture.querySelector("#whitespace").textContent,
      editable: fixture.querySelector('[contenteditable="true"]').textContent,
    };
    localizeUI(fixture, "pt");
    const portuguese = [
      fixture.querySelector("h1").textContent,
      fixture.querySelector("optgroup").label,
      fixture.querySelector(".cover").getAttribute("aria-label"),
    ];
    localizeUI(fixture, "es");
    const spanish = [
      fixture.querySelector("h1").textContent,
      fixture.querySelector("optgroup").label,
      fixture.querySelector(".cover").getAttribute("aria-label"),
    ];
    // A caller can replace a status after localization; the new source must win.
    fixture.querySelector("#action").textContent = "Importar seleccionados (9)";
    localizeUI(fixture, "en");
    const newStatus = fixture.querySelector("#action").textContent;
    const settings = {};
    for (const language of ["es", "en", "pt"]) {
      fixture.innerHTML = settingsMarkup(
        { uiLanguage: language, speechLanguage: "es" },
        [{ id: "voice", name: "Noche", language: "es-ES" }],
        [],
      );
      localizeUI(fixture, language);
      settings[language] = [
        fixture.querySelector("h1").textContent,
        fixture.querySelector(".page-panel h2").textContent,
        fixture.querySelector('select[data-preference="voice"] option')
          .textContent,
        fixture.querySelector('select[data-preference="theme"] optgroup').label,
      ];
    }
    // The root element's accessibility label also needs localization.
    fixture.setAttribute("aria-label", "Buscar libros");
    localizeUI(fixture, "en");
    return {
      english,
      portuguese,
      spanish,
      newStatus,
      settings,
      rootLabel: fixture.getAttribute("aria-label"),
    };
  });
  assert.deepEqual(result.english, {
    heading: "Library",
    optgroup: "Night themes",
    option: "Night",
    search: "Title, author or genre",
    searchValue: "Biblioteca",
    book: "Biblioteca",
    tooltip: "Biblioteca — Noche",
    readLabel: "Read Biblioteca",
    coverAlt: "Cover of Biblioteca",
    unpin: "Unpin Biblioteca",
    edit: "Edit Tema",
    author: "Noche",
    genre: "Noche",
    chapter: "Biblioteca",
    prose: "BibliotecaTema",
    proseAction: "Leer Tema",
    file: "Biblioteca",
    voice: "Noche",
    audio: "Reading aloud · Noche · 1×",
    status: "On Drive · 75% read",
    whitespace: "\n  Customize and sync  \n",
    editable: "Tema",
  });
  assert.deepEqual(result.portuguese, [
    "Biblioteca",
    "Temas noturnos",
    "Ler Biblioteca",
  ]);
  assert.deepEqual(result.spanish, [
    "Biblioteca",
    "Temas nocturnos",
    "Leer Biblioteca",
  ]);
  assert.equal(result.newStatus, "Import selected (9)");
  assert.equal(result.rootLabel, "Search books");
  assert.deepEqual(result.settings.en, [
    "Customize and sync",
    "Page customization",
    "Noche · Spanish (Spain)",
    "Light themes",
  ]);
  assert.deepEqual(result.settings.pt, [
    "Personalizar e sincronizar",
    "Personalização de páginas",
    "Noche · espanhol (Espanha)",
    "Temas claros",
  ]);
  assert.equal(result.settings.es[0], "Personalizar y sincronizar");
  console.log(
    "PASS: English/Portuguese UI, language switching, live status, accessibility, settings; book text and metadata unchanged.",
  );
} finally {
  if (browser) await browser.close();
  await server.close();
}
