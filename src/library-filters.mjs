import {
  libraryFilterOptions,
  normalizeLibraryFilters,
  normalizeSavedViews,
} from "./core/library-filters.mjs";
import { formatLabel } from "./core/document-formats.mjs";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const FIELDS = [
  "genre",
  "series",
  "collection",
  "author",
  "language",
  "format",
  "readingState",
  "availability",
];
const STATE_NAMES = {
  unread: "Por leer",
  reading: "Leyendo",
  finished: "Terminados",
};
const FILE_NAMES = {
  local: "En este dispositivo",
  cloud: "Solo en Drive",
  missing: "Sin archivo disponible",
};
function languageLabel(code, uiLanguage) {
  try {
    return (
      new Intl.DisplayNames([uiLanguage], { type: "language" }).of(code) || code
    );
  } catch {
    return code;
  }
}
function select(
  field,
  label,
  values,
  selected,
  describe = (value) => value,
  metadata = true,
) {
  const options = [...values];
  if (selected && !options.includes(selected)) options.push(selected);
  return `<label>${label}<select id="filter-${field}" data-library-filter="${field}" aria-label="${label}"><option value="">Todos</option>${options.map((value) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""} ${(typeof metadata === "function" ? metadata(value) : metadata) ? "data-content" : ""}>${esc(describe(value))}</option>`).join("")}</select></label>`;
}

export function libraryFiltersMarkup({
  library,
  filters = {},
  localIds,
  cloudIds,
  uiLanguage = "es",
  selectedView = "",
  open = false,
}) {
  const current = normalizeLibraryFilters(filters);
  const options = libraryFilterOptions(library, { localIds, cloudIds });
  const saved = normalizeSavedViews(library.preferences.savedViews ?? []);
  const count = FIELDS.filter((field) => current[field]).length;
  return `<details class="library-filters" data-library-filters ${open || count ? "open" : ""}><summary>Filtros <span class="filter-count" data-content>${count || ""}</span></summary><div class="library-filter-grid">${[
    select("genre", "Género principal", options.genres, current.genre),
    select("series", "Saga", options.series, current.series),
    select("collection", "Colección", options.collections, current.collection),
    select("author", "Autor", options.authors, current.author),
    select(
      "language",
      "Idioma del libro",
      [
        ...options.languages,
        ...(options.hasUnknownLanguage ? ["unknown"] : []),
      ],
      current.language,
      (value) =>
        value === "unknown" ? "Sin indicar" : languageLabel(value, uiLanguage),
      (value) => value !== "unknown",
    ),
    select("format", "Formato", options.formats, current.format, formatLabel),
    select(
      "readingState",
      "Estado de lectura",
      options.readingStates,
      current.readingState,
      (value) => STATE_NAMES[value],
      false,
    ),
    select(
      "availability",
      "Disponibilidad",
      options.availability,
      current.availability,
      (value) => FILE_NAMES[value],
      false,
    ),
  ].join(
    "",
  )}</div><p class="filter-hint">Se combinan con la búsqueda y la sección actual. El idioma se toma del libro; los que no lo indican aparecen en «Sin indicar».</p><div class="filter-actions"><button type="button" data-filter-action="clear">Limpiar filtros</button></div><div class="saved-library-views"><div class="saved-view-picker"><label>Vistas guardadas<select id="saved-library-view" aria-label="Vistas guardadas"><option value="">Elegir vista</option>${saved.map((view) => `<option value="${esc(view.id)}" ${view.id === selectedView ? "selected" : ""} data-content>${esc(view.name)}</option>`).join("")}</select></label><button type="button" data-filter-action="open" ${saved.some((view) => view.id === selectedView) ? "" : "disabled"}>Abrir vista</button><button type="button" data-filter-action="delete" ${saved.some((view) => view.id === selectedView) ? "" : "disabled"}>Eliminar vista</button></div><form class="save-library-view"><label>Nombre de la vista<input name="view-name" placeholder="Por ejemplo: Aventuras por leer" maxlength="100" required autocomplete="off"></label><button type="submit">Guardar vista</button></form><small>Las vistas se sincronizan. La disponibilidad se comprueba en cada dispositivo. Eliminar una vista conserva los libros.</small></div></details>`;
}

// Bind to the newly rendered panel, rather than the persistent screen element.
// A library render discards these listeners together with its old controls.
export function bindLibraryFilters(
  container,
  {
    filters = {},
    onChange,
    onSave,
    onOpen,
    onDelete,
    onError = () => {},
    localize = () => {},
  },
) {
  const panel = container.querySelector("[data-library-filters]");
  if (!panel) return null;
  const current = normalizeLibraryFilters(filters);
  localize(panel);
  const call = async (callback, ...args) => {
    try {
      await callback?.(...args);
    } catch (error) {
      onError(error);
    }
  };
  panel.addEventListener("change", (event) => {
    if (event.target.matches("[data-library-filter]")) {
      const next = { ...current };
      for (const control of panel.querySelectorAll("[data-library-filter]"))
        next[control.dataset.libraryFilter] = control.value;
      void call(() => onChange?.(normalizeLibraryFilters(next)));
    } else if (event.target.id === "saved-library-view") {
      const enabled = !!event.target.value;
      for (const control of panel.querySelectorAll(
        '[data-filter-action="open"],[data-filter-action="delete"]',
      ))
        control.disabled = !enabled;
    }
  });
  panel.addEventListener("click", (event) => {
    const control = event.target.closest("[data-filter-action]");
    if (!control || control.disabled) return;
    const selected = panel.querySelector("#saved-library-view").value;
    if (control.dataset.filterAction === "clear") {
      const next = { ...current };
      for (const field of [...FIELDS, "search"]) delete next[field];
      void call(() => onChange?.(normalizeLibraryFilters(next)));
    } else if (control.dataset.filterAction === "open" && selected)
      void call(onOpen, selected);
    else if (control.dataset.filterAction === "delete" && selected)
      void call(onDelete, selected);
  });
  panel
    .querySelector(".save-library-view")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = event.target.elements.namedItem("view-name").value.trim();
      if (!name) return;
      const button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await onSave?.(name);
      } catch (error) {
        onError(error);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
  return panel;
}
