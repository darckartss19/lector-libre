import test from "node:test";
import assert from "node:assert/strict";
import { UI_LANGUAGES, translate } from "../src/core/i18n.mjs";

test("Interface languages localize settings, Drive actions, state and errors", () => {
  assert.deepEqual(
    UI_LANGUAGES.map((language) => language.id),
    ["es", "en", "pt"],
  );
  const phrases = [
    "Temas nocturnos",
    "Personalización de páginas",
    "Descargar voz",
    "Progreso conectado",
    "Desconectar y revocar permiso",
    "Detener transferencias",
    "La biblioteca funciona sin cuenta.",
    "No se pudo guardar en Drive.",
  ];
  for (const phrase of phrases) {
    assert.equal(translate(phrase, "es"), phrase);
    assert.notEqual(translate(phrase, "en"), phrase, phrase + " en");
    assert.notEqual(translate(phrase, "pt"), phrase, phrase + " pt");
  }
  assert.equal(translate("Progreso conectado", "en"), "Progress connected");
  assert.equal(translate("Motor de voz", "en"), "Voice engine");
  assert.equal(translate("Motor de voz", "pt"), "Motor de voz");
  assert.equal(
    translate("No se pudo guardar en Drive.", "pt"),
    "Não foi possível salvar no Drive.",
  );
  assert.equal(
    translate(
      "No hay una voz descargable para este idioma. Puedes usar una voz compatible instalada en Windows.",
      "en",
    ),
    "No downloadable voice is available for this language. You can use a compatible voice installed in Windows.",
  );
  assert.equal(
    translate(
      "No hay una voz descargable para este idioma. Puedes usar una voz compatible instalada en Windows.",
      "pt",
    ),
    "Não há uma voz para baixar neste idioma. Você pode usar uma voz compatível instalada no Windows.",
  );
});

test("Dynamic interface messages retain titles and filenames verbatim", () => {
  assert.equal(translate("Fijar Noche", "en"), "Pin Noche");
  assert.equal(translate("Desfijar Biblioteca", "en"), "Unpin Biblioteca");
  assert.equal(translate("Leer Tema", "pt"), "Ler Tema");
  assert.equal(
    translate("Importando 2 de 10 · Biblioteca.epub", "en"),
    "Importing 2 of 10 · Biblioteca.epub",
  );
  assert.equal(
    translate("Biblioteca · 3 libros compatibles", "pt"),
    "Biblioteca · 3 livros compatíveis",
  );
  assert.equal(
    translate(
      "Carpeta guardada: Noche. La sincronización reutilizará sus libros.",
      "en",
    ),
    "Folder saved: Noche. Sync will reuse its books.",
  );
  assert.equal(
    translate("Leyendo · Voz Noche · 1×", "en"),
    "Reading aloud · Voz Noche · 1×",
  );
  assert.equal(translate("Leyendo", "en"), "Reading");
  assert.equal(translate("Leyendo", "pt"), "Lendo");
  assert.equal(translate("Subiendo Biblioteca…", "pt"), "Enviando Biblioteca…");
  assert.equal(
    translate("Última sincronización: ", "en") + "10/12/2026, 8:30 PM",
    "Last sync: 10/12/2026, 8:30 PM",
  );
  assert.equal(
    translate("Última sincronización: ", "pt") + "12/10/2026, 20:30",
    "Última sincronização: 12/10/2026, 20:30",
  );
  assert.equal(translate("Un título inventado", "en"), "Un título inventado");
});

test("Plural counts and combined library status are localized", () => {
  assert.equal(
    translate("1 libro · tu próxima lectura empieza aquí", "en"),
    "1 book · your next read starts here",
  );
  assert.equal(
    translate("2 libros · tu próxima lectura empieza aquí", "pt"),
    "2 livros · sua próxima leitura começa aqui",
  );
  assert.equal(translate("En Drive · 75% leído", "en"), "On Drive · 75% read");
  assert.equal(
    translate("Archivo pendiente · EPUB", "pt"),
    "Arquivo pendente · EPUB",
  );
  assert.equal(
    translate(
      "7 libros añadidos, 2 duplicados reconocidos. Importación detenida.",
      "en",
    ),
    "7 books added, 2 duplicates recognized. Import stopped.",
  );
  assert.equal(
    translate("1 libro añadido. Los duplicados conservan tu progreso.", "pt"),
    "1 livro adicionado. Duplicados mantêm seu progresso.",
  );
  assert.equal(
    translate("2 libros subidos, 3 recuperados. 1 pendientes.", "en"),
    "2 books uploaded, 3 retrieved. 1 pending.",
  );
  assert.equal(
    translate("No se pudo abrir el libro: No se pudo leer Drive.", "en"),
    "Could not open the book: Could not read Drive.",
  );
  assert.equal(
    translate("La descarga de voz devolvió 503.", "pt"),
    "O download da voz retornou 503.",
  );
});

test("Unsupported languages use Spanish consistently, including dynamic messages", () => {
  for (const phrase of [
    "Biblioteca",
    "Personalización de páginas",
    "Importar seleccionados (3)",
    "Fijar Noche",
  ]) {
    assert.equal(translate(phrase, "unknown"), phrase);
  }
});
