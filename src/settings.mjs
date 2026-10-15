import { THEMES, FONTS, APPEARANCE_DEFAULTS } from "./core/appearance.mjs";
import { UI_LANGUAGES } from "./core/i18n.mjs";
import {
  SPEECH_LANGUAGES,
  languageName,
  voicesForLanguage,
  selectVoice,
} from "./core/voice-selection.mjs";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const options = (items, selected) =>
  items
    .map(
      ({ id, name }) =>
        `<option value="${esc(id)}" ${id === selected ? "selected" : ""}>${esc(name)}</option>`,
    )
    .join("");
function range(p, name, label, min, max, step, unit) {
  return `<label>${label}<input type="range" data-preference="${name}" min="${min}" max="${max}" step="${step}" value="${p[name]}"><output data-output="${name}">${p[name]}${unit}</output></label>`;
}
export function settingsMarkup(
  preferences,
  voices,
  catalog,
  {
    downloading = false,
    hasReading = false,
    bookLanguage = "",
    previewing = false,
    speechAvailable = true,
    android = false,
  } = {},
) {
  const p = {
    ...APPEARANCE_DEFAULTS,
    uiLanguage: "es",
    speechLanguage: "auto",
    rate: 1,
    ...preferences,
  };
  const installed = voicesForLanguage(voices, p.speechLanguage);
  const chosen = selectVoice(voices, p, bookLanguage);
  const languages = [
    { id: "auto", name: "Automático según el libro" },
    ...SPEECH_LANGUAGES.map((id) => ({
      id,
      name: languageName(id, p.uiLanguage),
    })),
  ];
  const available = voicesForLanguage(catalog, p.speechLanguage);
  const downloads = available.filter((v) => !v.installed);
  return `<header class="settings-heading"><div><p class="eyebrow">QUE SE SIENTA TUYO</p><h1>Personalizar y sincronizar</h1><p class="subtitle">Tu lectura, tu voz y tus preferencias.</p></div>${hasReading ? '<button data-action="resume-reading">Volver a la lectura</button>' : ""}</header>
  <div class="settings-grid">
    <section class="panel appearance-panel"><h2>Apariencia e idioma</h2>
      <div class="setting-columns"><label>Idioma de la aplicación<select data-preference="uiLanguage">${options(UI_LANGUAGES, p.uiLanguage)}</select></label>
      <label>Tema<select data-preference="theme"><optgroup label="Temas claros">${options(
        THEMES.filter((t) => !t.dark),
        p.theme,
      )}</optgroup><optgroup label="Temas nocturnos">${options(
        THEMES.filter((t) => t.dark),
        p.theme,
      )}</optgroup></select></label></div>
      <div class="theme-palettes">${THEMES.map((theme) => `<button data-theme="${theme.id}" aria-label="${esc(theme.name)}" aria-pressed="${theme.id === p.theme}" style="--swatch-page:${theme.page[0]};--swatch-ink:${theme.page[1]};--swatch-side:${theme.colors[2]};--swatch-accent:${theme.colors[6]}"><span class="palette-preview" aria-hidden="true"><i></i><b>Aa</b></span><span>${esc(theme.name)}</span></button>`).join("")}</div>
      <label>Diseño de los lomos<select data-preference="spineStyle">${options(
        [
          { id: "illustrated", name: "Colores e ilustración de la portada" },
          { id: "color", name: "Solo colores de la portada" },
          { id: "classic", name: "Clásico" },
        ],
        p.spineStyle ?? "illustrated",
      )}</select></label>
    </section>
    ${
      speechAvailable
        ? `<section class="panel voice-panel"><h2>Lectura en voz alta</h2>
      <label>Idioma de la voz<select data-preference="speechLanguage">${options(languages, p.speechLanguage)}</select></label>
      <label>Voz de lectura<select data-preference="voice" aria-label="Voz de lectura">${installed.length ? installed.map((v) => `<option value="${esc(v.id)}" ${chosen?.id === v.id ? "selected" : ""}>${esc(v.name ?? v.id)} · ${esc(languageName(v.language, p.uiLanguage))}</option>`).join("") : '<option value="">Sin voz instalada para este idioma</option>'}</select></label>
      <label>Velocidad<select data-preference="rate">${[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3].map((rate) => `<option value="${rate}" ${p.rate === rate ? "selected" : ""}>${rate}×</option>`).join("")}</select></label>
      <div class="button-row"><button data-action="preview-voice" ${!chosen ? "disabled" : ""}>${previewing ? "Detener" : "Probar voz"}</button><button data-action="refresh-voices">Actualizar voces</button></div>
      <p class="quiet">Elige una voz y escúchala antes de empezar. La preferencia se aplica al iniciar o continuar la lectura.</p>
      <h3>Voces para descargar</h3><p class="quiet">Descarga cada voz una vez. Después funciona sin internet; el texto del libro se procesa en tu equipo.</p>
      <div class="voice-downloads">${android ? '<button data-action="voice-settings">Descargar voces en Android</button><p class="quiet">Instala los datos de voz desde el motor de texto a voz del teléfono y pulsa Actualizar voces. Se muestran las voces instaladas que funcionan sin conexión.</p>' : downloads.map((v) => `<div class="voice-option"><div><strong data-content>${esc(v.name)}</strong><small>${esc(languageName(v.language, p.uiLanguage))} · ${Math.ceil(v.size / 1048576)} MB</small></div><button data-install-voice="${esc(v.id)}" ${downloading ? "disabled" : ""}>Descargar voz</button></div>`).join("") || (available.length ? "<p>Instalada</p>" : "<p>No hay una voz descargable para este idioma. Puedes usar una voz compatible instalada en Windows.</p>")}</div>
      <p id="voice-download-progress" role="status" class="quiet">${downloading ? "Preparando la descarga de voz…" : ""}</p>
      <p class="quiet">${android ? "La voz continúa con la pantalla apagada o al cambiar de aplicación. Puedes controlarla desde la notificación. Quitar Lector libre de las aplicaciones recientes detiene la voz y guarda la posición." : "La voz sigue leyendo al minimizar la aplicación o cambiar de ventana. Cerrar Lector libre detiene la voz y conserva la posición."}</p>
      <p class="quiet">No se crean archivos de audiolibro.</p>
    </section>`
        : `<section class="panel voice-panel"><h2>Lectura en voz alta</h2><p>La voz para Android estará disponible en una próxima versión. Puedes probar la lectura y la organización sin conexión.</p></section>`
    }
    <section class="panel page-panel"><div class="page-panel-heading"><h2>Personalización de páginas</h2><button data-action="reset-page" class="small">Restablecer página</button></div>
      <div class="page-customization"><div class="page-controls">
        <label>Modo de lectura<select data-preference="readingMode">${options(
          [
            { id: "scroll", name: "Desplazamiento continuo" },
            { id: "vertical", name: "Vertical sin marcos" },
            { id: "page", name: "Una página" },
            { id: "spread", name: "Dos páginas" },
          ],
          p.readingMode,
        )}</select></label>
        <div class="setting-columns"><label>Color de la página<select data-preference="pageTheme">${options([{ id: "auto", name: "Seguir el tema" }, ...THEMES], p.pageTheme)}</select></label><label>Tipografía<select data-preference="font">${options(FONTS, p.font)}</select></label></div>
        <div class="setting-columns">${range(p, "fontSize", "Tamaño del texto", 12, 40, 1, " px")}${range(p, "lineHeight", "Espacio entre líneas", 1.2, 2.6, 0.1, "")}</div>
        <div class="setting-columns">${range(p, "pageWidth", "Ancho de la página", 480, 1200, 20, " px")}${range(p, "pagePadding", "Márgenes interiores", 8, 80, 4, " px")}</div>
        <div class="setting-columns">${range(p, "paragraphSpacing", "Espacio entre párrafos", 0.3, 2.5, 0.1, " em")}${range(p, "letterSpacing", "Espacio entre letras", 0, 0.12, 0.01, " em")}</div>
        <label>Alineación<select data-preference="textAlign">${options(
          [
            { id: "left", name: "A la izquierda" },
            { id: "justify", name: "Justificada" },
          ],
          p.textAlign,
        )}</select></label>
        <label class="check-label"><input type="checkbox" data-preference="firstLineIndent" ${p.firstLineIndent ? "checked" : ""}>Sangría al empezar los párrafos</label>
      </div><div class="page-preview"><p class="eyebrow">Vista previa de página</p><div class="page-sample"><div class="preview-prose"><p class="reading-sample">A veces, lo único que hace falta es encontrar un momento para seguir leyendo.</p><p>Las palabras encuentran su propio ritmo. Ajusta la página hasta que leer resulte cómodo para ti.</p></div></div></div></div>
    </section>`;
}
