const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const values = (value) =>
  value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
function modal(root, markup, localize) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = markup;
  root.append(dialog);
  localize(dialog);
  dialog.showModal();
  return dialog;
}
export async function normalizeCover(data) {
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(data))
    throw new Error("Portada no válida.");
  const [header, encoded] = data.split(",", 2);
  const bytes = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0),
  );
  const blob = new Blob([bytes], {
    type: header.slice(5, header.indexOf(";")),
  });
  const image = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 600 / image.width, 900 / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.85);
  } finally {
    image.close();
  }
}
export function metadataDialog({
  root,
  book,
  previewCover = book.cover,
  seriesNames,
  collectionNames,
  onSave,
  onCover,
  localize,
  onError,
}) {
  let cover = book.cover;
  const dialog = modal(
    root,
    `<form method="dialog"><h2>Editar libro</h2><div class="cover-editor"><div id="cover-preview" data-content>${previewCover ? `<img src="${esc(previewCover)}" alt="">` : ""}</div><div><button type="button" data-cover="choose">Cambiar portada</button><button type="button" data-cover="remove">Quitar portada</button><small>La imagen se usa también para el lomo.</small></div></div><label>Título<input name="title" value="${esc(book.title)}" required></label><label>Autor<input name="author" value="${esc(book.author)}"></label><label>Géneros, separados por comas<input name="genres" value="${esc(book.genres.join(", "))}"></label><small class="metadata-hint">El primer género determina la estantería. Los demás se conservan para buscar.</small><div class="series-fields"><label>Saga<input name="series" list="series-names" value="${esc(book.series || "")}" autocomplete="off"><datalist id="series-names">${seriesNames.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist></label><label>Número en la saga (opcional)<input name="seriesIndex" type="number" min="0" step="any" value="${book.seriesIndex ?? ""}"></label></div><label>Colecciones, separadas por comas<input name="collections" list="collection-names" value="${esc((book.collections ?? []).join(", "))}"><datalist id="collection-names">${collectionNames.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist></label><div class="button-row"><button value="cancel" formnovalidate>Cancelar</button><button class="primary" value="save">Guardar cambios</button></div></form>`,
    localize,
  );
  dialog.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-cover]");
    if (!action) return;
    const save = dialog.querySelector('[value="save"]');
    action.disabled = save.disabled = true;
    try {
      if (action.dataset.cover === "remove") cover = null;
      else {
        const chosen = await onCover();
        if (chosen) cover = await normalizeCover(chosen);
      }
      dialog.querySelector("#cover-preview").innerHTML = cover
        ? `<img src="${esc(cover)}" alt="">`
        : "";
    } catch (error) {
      onError(error);
    } finally {
      action.disabled = save.disabled = false;
    }
  });
  dialog.addEventListener("close", async () => {
    try {
      if (dialog.returnValue === "save") {
        const form = dialog.querySelector("form");
        const read = (name) => form.elements.namedItem(name).value;
        const patch = {
          title: read("title"),
          author: read("author"),
          series: read("series"),
          seriesIndex:
            !read("series").trim() || !read("seriesIndex")
              ? null
              : Number(read("seriesIndex")),
        };
        if (read("genres") !== book.genres.join(", "))
          patch.genres = values(read("genres"));
        if (read("collections") !== (book.collections ?? []).join(", "))
          patch.collections = values(read("collections"));
        if (cover !== book.cover) patch.cover = cover;
        await onSave(patch);
      }
    } catch (error) {
      onError(error);
    } finally {
      dialog.remove();
    }
  });
  return dialog;
}
export function bulkDialog({ root, count, onSave, localize, onError }) {
  const dialog = modal(
    root,
    `<form method="dialog"><h2>Editar selección</h2><p>${count} libros seleccionados</p><p class="quiet">Solo se cambian los campos que marques.</p><label class="check-label"><input type="checkbox" name="applyAuthor">Cambiar autor</label><input name="author" aria-label="Autor"><label class="check-label"><input type="checkbox" name="applyGenres">Reemplazar géneros</label><input name="genres" aria-label="Géneros, separados por comas"><label class="check-label"><input type="checkbox" name="applySeries">Cambiar saga</label><input name="series" aria-label="Saga"><small class="metadata-hint">Al cambiar la saga se borra su número anterior. Puedes ordenar cada libro después.</small><label class="check-label"><input type="checkbox" name="applyCollections">Reemplazar colecciones</label><input name="collections" aria-label="Colecciones, separadas por comas"><div class="button-row"><button value="cancel" formnovalidate>Cancelar</button><button value="save" class="primary">Guardar cambios</button></div></form>`,
    localize,
  );
  dialog.addEventListener("close", async () => {
    try {
      if (dialog.returnValue === "save") {
        const form = dialog.querySelector("form");
        const read = (name) => form.elements.namedItem(name);
        const patch = {};
        if (read("applyAuthor").checked) patch.author = read("author").value;
        if (read("applyGenres").checked)
          patch.genres = values(read("genres").value);
        if (read("applySeries").checked)
          Object.assign(patch, {
            series: read("series").value,
            seriesIndex: null,
          });
        if (read("applyCollections").checked)
          patch.collections = values(read("collections").value);
        if (Object.keys(patch).length) await onSave(patch);
      }
    } catch (error) {
      onError(error);
    } finally {
      dialog.remove();
    }
  });
}
export function collectionDialog({
  root,
  names,
  count,
  onSave,
  localize,
  onError,
}) {
  const dialog = modal(
    root,
    `<form method="dialog"><h2>Añadir a colección</h2><p>${count} libros seleccionados</p><label>Nombre de la colección<input name="collection" list="existing-collections" required autocomplete="off"><datalist id="existing-collections">${names.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist></label><p class="quiet">Conserva las demás colecciones de cada libro.</p><div class="button-row"><button value="cancel" formnovalidate>Cancelar</button><button value="save" class="primary">Añadir</button></div></form>`,
    localize,
  );
  dialog.addEventListener("close", async () => {
    try {
      if (dialog.returnValue === "save")
        await onSave(dialog.querySelector('[name="collection"]').value);
    } catch (error) {
      onError(error);
    } finally {
      dialog.remove();
    }
  });
}
export function restoreDialog({ root, result, onSave, localize, onError }) {
  const dialog = modal(
    root,
    `<form method="dialog"><h2>Restaurar copia</h2><p>${result.library.books.length} libros en la copia</p><label>Cómo recuperar la biblioteca<select name="mode"><option value="missing">Añadir libros faltantes y conservar datos actuales</option><option value="replace">Recuperar metadatos y progreso de la copia</option></select></label><p class="quiet">Los libros que ya tienes y no aparecen en la copia se conservan.</p><label class="check-label"><input name="preferences" type="checkbox">También restaurar ajustes</label><div class="button-row"><button value="cancel" formnovalidate>Cancelar</button><button value="save" class="primary">Restaurar</button></div></form>`,
    localize,
  );
  dialog.addEventListener("close", async () => {
    try {
      if (dialog.returnValue === "save")
        await onSave({
          mode: dialog.querySelector('[name="mode"]').value,
          preferences: dialog.querySelector('[name="preferences"]').checked,
        });
    } catch (error) {
      onError(error);
    } finally {
      dialog.remove();
    }
  });
}
