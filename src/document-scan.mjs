const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function documentScanDialog({
  root,
  invoke,
  localize,
  onImport,
  onChoose,
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "document-scan-dialog";
  dialog.innerHTML = `<h2>Buscar libros en el teléfono</h2><p>Busca documentos visibles y dentro de las carpetas que autorices, incluidas sus subcarpetas. Android puede limitar el acceso a algunas ubicaciones.</p><div class="button-row"><button data-scan="choose">Elegir archivos</button><button data-scan="folder">Añadir carpeta</button><button data-scan="search">Buscar documentos</button><button data-scan="cancel" hidden>Detener búsqueda</button></div><p class="scan-sources quiet" data-content></p><p class="scan-status" role="status"></p><label>Filtrar por nombre<input class="scan-filter" type="search"></label><div class="button-row"><button data-scan="all">Seleccionar resultados</button><button data-scan="none">Quitar selección</button></div><div class="scan-files"></div><div class="library-pagination"><button data-scan="previous">← Anterior</button><span class="scan-page" data-content></span><button data-scan="next">Siguiente →</button></div><div class="button-row"><button data-scan="close">Cerrar</button><button data-scan="import" class="primary">Importar seleccionados</button></div>`;
  root.append(dialog);
  let files = [],
    sources = [],
    selected = new Set(),
    page = 0,
    working = false,
    closed = false;
  const status = dialog.querySelector(".scan-status");
  const message = (text) => {
    status.textContent = text;
    localize(status);
  };
  const filtered = () => {
    const query = dialog
      .querySelector(".scan-filter")
      .value.trim()
      .toLocaleLowerCase();
    return files.filter((file) =>
      file.name.toLocaleLowerCase().includes(query),
    );
  };
  const render = () => {
    if (closed) return;
    const rows = filtered(),
      pages = Math.max(1, Math.ceil(rows.length / 100));
    page = Math.min(page, pages - 1);
    dialog.querySelector(".scan-sources").textContent = sources
      .map((source) => source.name)
      .join(" · ");
    dialog.querySelector(".scan-files").innerHTML = rows
      .slice(page * 100, (page + 1) * 100)
      .map(
        (file) =>
          `<label class="check-label"><input type="checkbox" data-scan-key="${esc(file.key)}" ${selected.has(file.key) ? "checked" : ""} ${working ? "disabled" : ""}><span data-content>${esc(file.name)}<small>${esc(file.format.toUpperCase())} · ${(file.size / 1048576).toFixed(1)} MB · ${esc(file.location)}</small></span></label>`,
      )
      .join("");
    dialog.querySelector(".scan-page").textContent =
      `${page + 1} / ${pages} · ${rows.length}`;
    for (const button of dialog.querySelectorAll("[data-scan]"))
      button.disabled =
        working && !["cancel", "close"].includes(button.dataset.scan);
    dialog.querySelector('[data-scan="previous"]').disabled =
      working || page === 0;
    dialog.querySelector('[data-scan="next"]').disabled =
      working || page === pages - 1;
    dialog.querySelector('[data-scan="import"]').disabled =
      working || !selected.size;
    dialog.querySelector('[data-scan="import"]').textContent =
      `Importar seleccionados (${selected.size})`;
    dialog.querySelector('[data-scan="cancel"]').hidden = !working;
    localize(dialog);
  };
  const close = () => dialog.close();
  dialog.addEventListener(
    "close",
    () => {
      closed = true;
      invoke("mobile_scan", { command: { action: "cancel" } }).catch(() => {});
      dialog.remove();
    },
    { once: true },
  );
  dialog.querySelector(".scan-filter").oninput = () => {
    page = 0;
    render();
  };
  dialog.onchange = (event) => {
    const key = event.target.dataset.scanKey;
    if (key) {
      event.target.checked ? selected.add(key) : selected.delete(key);
      render();
    }
  };
  dialog.onclick = async (event) => {
    const action = event.target.closest("[data-scan]")?.dataset.scan;
    if (!action) return;
    if (action === "close") return close();
    if (action === "cancel")
      return invoke("mobile_scan", { command: { action: "cancel" } }).catch(
        (error) => message(String(error)),
      );
    if (working) return;
    if (action === "choose") {
      close();
      return onChoose();
    }
    if (action === "previous" || action === "next") {
      page += action === "next" ? 1 : -1;
      return render();
    }
    if (action === "all") {
      filtered().forEach((file) => selected.add(file.key));
      return render();
    }
    if (action === "none") {
      selected.clear();
      return render();
    }
    working = true;
    render();
    try {
      if (action === "folder") {
        const result = await invoke("mobile_scan", {
          command: { action: "folder" },
        });
        if (result.sources) sources = result.sources;
        message(
          "Pulsa Buscar documentos para revisar las carpetas autorizadas.",
        );
      } else if (action === "search") {
        message("Buscando documentos…");
        const result = await invoke("mobile_scan", {
          command: { action: "scan" },
        });
        if (closed) return;
        files = result.files;
        sources = result.sources;
        selected.clear();
        page = 0;
        message(
          result.cancelled
            ? "Búsqueda detenida. Puedes importar los resultados encontrados."
            : files.length
              ? "Selecciona los documentos que quieras importar."
              : "No se encontraron libros. Añade una carpeta para ampliar la búsqueda.",
        );
        if (result.unreadableFolders)
          message(
            "Algunas carpetas no se pudieron leer. Revisa sus permisos y vuelve a buscar.",
          );
      } else if (action === "import") {
        message("Preparando documentos…");
        await onImport([...selected]);
        close();
      }
    } catch (error) {
      if (!closed) message(String(error));
    } finally {
      working = false;
      render();
    }
  };
  render();
  dialog.showModal();
  invoke("mobile_scan", { command: { action: "sources" } })
    .then((result) => {
      sources = result.sources;
      render();
    })
    .catch((error) => message(String(error)));
  return dialog;
}
