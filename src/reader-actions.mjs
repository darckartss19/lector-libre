import { visibleAnnotations } from "./core/library.mjs";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function readerPanelMarkup({
  type,
  book,
  chapters,
  query,
  results,
  more,
}) {
  if (!type) return "";
  const names = new Map(chapters.map((chapter) => [chapter.id, chapter.title]));
  return `<div class="reader-panel-heading"><h3>${type === "search" ? "Buscar en el libro" : "Notas y marcadores"}</h3><button data-action="close-reader-panel" aria-label="Cerrar panel">×</button></div>${
    type === "search"
      ? `<label class="reader-search-label">Buscar una palabra o frase<input id="reader-search" value="${esc(query)}" autocomplete="off"></label><div class="reader-results">${!query.trim() ? `<p class="quiet">Los resultados aparecen mientras escribes.</p>` : results.length ? results.map((result, index) => `<button data-search-result="${index}"><strong data-content>${esc(names.get(result.chapter))}</strong><span data-content>${esc(result.context)}</span></button>`).join("") : `<p>No se encontraron coincidencias.</p>`}${more ? `<button data-action="more-search-results">Mostrar más resultados</button>` : ""}</div>`
      : `<p class="quiet">Selecciona un fragmento para subrayarlo o añadir una nota.</p><div class="button-row"><button data-action="add-bookmark">Guardar marcador</button><button data-action="add-highlight">Subrayar</button><button data-action="add-note">Añadir nota</button></div><div class="reader-results">${
          visibleAnnotations(book)
            .map(
              (annotation) =>
                `<div class="annotation-entry"><button data-go-annotation="${esc(annotation.id)}"><small>${annotation.type === "bookmark" ? "Marcador" : annotation.type === "note" ? "Nota" : "Subrayado"}</small><strong data-content>${esc(annotation.label || names.get(annotation.chapter) || annotation.chapter)}</strong>${annotation.quote ? `<span data-content>${esc(annotation.quote.slice(0, 180))}</span>` : ""}${annotation.note ? `<span class="annotation-note" data-content>${esc(annotation.note)}</span>` : ""}</button><div class="button-row"><button data-edit-annotation="${esc(annotation.id)}">Editar</button><button data-delete-annotation="${esc(annotation.id)}">Eliminar</button></div></div>`,
            )
            .join("") || `<p>Aún no hay notas o marcadores.</p>`
        }</div>`
  }`;
}
export function annotationDialog({
  root,
  annotation,
  onSave,
  localize,
  onError,
}) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<form method="dialog"><h2>${annotation.type === "bookmark" ? "Guardar marcador" : annotation.type === "note" ? "Añadir nota" : "Subrayar"}</h2>${annotation.quote ? `<blockquote data-content>${esc(annotation.quote.slice(0, 800))}</blockquote>` : ""}<label>Nombre (opcional)<input name="label" value="${esc(annotation.label)}"></label>${
    annotation.type !== "bookmark"
      ? `<label>Color<select name="color">${[
          ["yellow", "Amarillo"],
          ["green", "Verde"],
          ["blue", "Azul"],
          ["pink", "Rosa"],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}" ${annotation.color === value ? "selected" : ""}>${label}</option>`,
          )
          .join(
            "",
          )}</select></label><label>Nota (opcional)<textarea name="note" rows="4">${esc(annotation.note)}</textarea></label>`
      : ""
  }<div class="button-row"><button value="cancel" formnovalidate>Cancelar</button><button class="primary" value="save">Guardar</button></div></form>`;
  root.append(dialog);
  localize(dialog);
  dialog.showModal();
  dialog.addEventListener("close", async () => {
    try {
      if (dialog.returnValue === "save")
        await onSave({
          ...annotation,
          label: dialog.querySelector('[name="label"]').value,
          note: dialog.querySelector('[name="note"]')?.value ?? annotation.note,
          color:
            dialog.querySelector('[name="color"]')?.value ?? annotation.color,
          updatedAt: Date.now(),
        });
    } catch (error) {
      onError(error);
    } finally {
      dialog.remove();
    }
  });
}
