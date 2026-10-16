import {
  CARD_BACKGROUNDS,
  CARD_FONTS,
  CARD_PRESETS,
  CARD_PRESET_CATEGORIES,
  cardDimensions,
  defaultCard,
  isPhotoBackground,
  presetById,
  presetThumb,
  surpriseCard,
  fitCardText,
  quoteFilename,
} from "./core/quote-card.mjs";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function drawBackground(ctx, width, height, card, photo) {
  const photoBackground =
    photo &&
    (card.background === "custom" ||
      CARD_PRESETS.some((preset) => preset.id === card.background));
  if (photoBackground) {
    const scale = Math.max(width / photo.width, height / photo.height);
    ctx.drawImage(
      photo,
      (width - photo.width * scale) / 2,
      (height - photo.height * scale) / 2,
      photo.width * scale,
      photo.height * scale,
    );
    ctx.fillStyle =
      card.overlay === "light"
        ? `rgba(255,255,255,${card.shade / 100})`
        : `rgba(0,0,0,${card.shade / 100})`;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const bg =
    CARD_BACKGROUNDS.find((b) => b.id === card.background) ??
    CARD_BACKGROUNDS[0];
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, bg.colors[0]);
  gradient.addColorStop(1, bg.colors[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = bg.ink;
  ctx.fillStyle = bg.ink;
  ctx.lineWidth = 2;
  if (bg.style === "paper") {
    for (let y = 24; y < height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y + 18);
      ctx.stroke();
    }
  }
  if (bg.style === "waves") {
    for (let y = height * 0.7; y < height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(
        width * 0.3,
        y - 180,
        width * 0.7,
        y + 180,
        width,
        y - 30,
      );
      ctx.stroke();
    }
  }
  if (bg.style === "glow") {
    ctx.beginPath();
    ctx.arc(width * 0.95, height * 0.1, width * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, height, width * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  if (bg.style === "leaves") {
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.ellipse(
        width - 30 - i * 15,
        80 + i * 65,
        75,
        24,
        -0.7,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}
export function renderQuoteCard(canvas, card, photo = null) {
  const { width, height } = cardDimensions(card.format);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, width, height, card, photo);
  const family = (CARD_FONTS.find((f) => f.id === card.font) ?? CARD_FONTS[0])
    .family;
  const margin = 108,
    textWidth = width - margin * 2;
  const source = card.attribution
    ? [card.title, card.author].filter(Boolean).join("\n")
    : "";
  const attribution = fitCardText(source, {
    width: textWidth,
    height: height * 0.15,
    preferredSize: 32,
    minimum: 20,
    lineHeight: 1.4,
    measure: (text, size) => {
      ctx.font = `${size}px "Segoe UI", Arial, sans-serif`;
      return ctx.measureText(text).width;
    },
  });
  const sourceHeight = source
    ? attribution.lines.length * attribution.lineHeight + 60
    : 0;
  const available = height - margin * 2 - 100 - sourceHeight;
  const layout = fitCardText(card.quote, {
    width: textWidth,
    height: available,
    preferredSize: card.fontSize,
    measure: (text, size) => {
      ctx.font = `${size}px ${family}`;
      return ctx.measureText(text).width;
    },
  });
  // Never cut a long selection silently. The editor blocks export if it cannot fit.
  if (!layout.fits || !attribution.fits) return { ...layout, fits: false };
  const x =
    card.align === "left"
      ? margin
      : card.align === "right"
        ? width - margin
        : width / 2;
  const top =
    margin +
    50 +
    Math.max(0, (available - layout.lines.length * layout.lineHeight) / 2);
  ctx.fillStyle = card.color;
  ctx.textAlign = card.align;
  ctx.textBaseline = "top";
  ctx.font = `${layout.size}px ${family}`;
  layout.lines.forEach((line, index) =>
    ctx.fillText(line, x, top + index * layout.lineHeight),
  );
  if (source) {
    const start =
      height - margin - attribution.lines.length * attribution.lineHeight;
    ctx.font = `${attribution.size}px "Segoe UI", Arial, sans-serif`;
    ctx.globalAlpha = 0.82;
    attribution.lines.forEach((line, index) =>
      ctx.fillText(line, x, start + index * attribution.lineHeight),
    );
    ctx.globalAlpha = 1;
    ctx.strokeStyle = card.color;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(margin, start - 30);
    ctx.lineTo(width - margin, start - 30);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = card.color;
  ctx.globalAlpha = 0.3;
  ctx.strokeRect(42, 42, width - 84, height - 84);
  ctx.globalAlpha = 1;
  return { ...layout, fits: true };
}
async function loadPhoto(data) {
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(data))
    throw Error("Elige una imagen PNG, JPEG o WebP válida.");
  return decodePhoto(data);
}
async function decodePhoto(data) {
  const source = new Image();
  source.src = data;
  await source.decode();
  const image = await createImageBitmap(source);
  const scale = Math.min(1, 2048 / Math.max(image.width, image.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvas;
}
async function loadPresetImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("No se pudo cargar el fondo.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await decodePhoto(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
export function quoteCardDialog({
  root,
  quote,
  hint = "",
  title,
  author,
  localize = () => {},
  onBackground,
  onSave,
  onCopy,
  onShare = null,
  copyAvailable = true,
  freeform = false,
}) {
  // Freeform mode creates a standalone card: no book, blank defaults.
  const initialCard = defaultCard({
    quote: freeform ? "" : String(quote ?? ""),
    title: freeform ? "" : String(title ?? ""),
    author: freeform ? "" : String(author ?? ""),
  });
  let card = { ...initialCard },
    photo = null,
    photoSource = null,
    working = false,
    closed = false,
    loadingBackground = false,
    ready = false;
  let backgroundGeneration = 0;
  let activeTab = freeform || !card.quote.trim() ? "texto" : "fondo";
  const dialog = document.createElement("dialog");
  dialog.className = "quote-card-dialog";
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "quote-card-title");
  dialog.innerHTML = `<form>
<header>
  <div>
    <h2 id="quote-card-title">${freeform ? "Crear imagen" : "Crear tarjeta de cita"}</h2>
    <p class="quiet" id="quote-card-subtitle">${esc(
      freeform
        ? "Diseña una imagen con tus propias palabras."
        : "Diseña una imagen para compartir tu lectura.",
    )}</p>
  </div>
  <button type="button" data-quote-close aria-label="Cerrar">×</button>
</header>
<nav class="quote-tabs" role="tablist" aria-label="Editor">
  <button type="button" role="tab" data-quote-tab="fondo" aria-controls="quote-panel-fondo">Fondo</button>
  <button type="button" role="tab" data-quote-tab="texto" aria-controls="quote-panel-texto">Texto</button>
  <button type="button" role="tab" data-quote-tab="estilo" aria-controls="quote-panel-estilo">Estilo</button>
</nav>
<div class="quote-editor">
  <div class="quote-preview" data-quote-region="preview">
    <canvas class="quote-card-canvas" aria-label="Vista previa de la tarjeta" role="img"></canvas>
    <p class="quiet quote-status" role="status"></p>
    <p class="quiet quote-fit" aria-live="polite"></p>
  </div>
  <div class="quote-controls" data-quote-region="controls">
    ${hint ? `<p class="quiet">${esc(hint)}</p>` : ""}
    <div class="quote-panel" id="quote-panel-fondo" data-quote-panel="fondo">
      <div class="quote-gallery" role="group" aria-label="Fondos">
        <div class="quote-chip-bar">
          ${CARD_PRESET_CATEGORIES.map(
            (category) =>
              `<button type="button" class="quote-chip" data-quote-chip="${esc(category)}" ${
                category === "Todos" ? 'aria-pressed="true"' : ""
              }>${esc(category)}</button>`,
          ).join("")}
        </div>
        <div class="quote-preset-list" role="group" aria-label="Fondos">
          ${CARD_BACKGROUNDS.map((background) => `<button type="button" class="quote-preset" data-quote-preset="${background.id}" data-quote-category="Colores"><span class="quote-color-sample" style="background:linear-gradient(${background.colors[0]},${background.colors[1]})" aria-hidden="true"></span><span>${esc(background.name)}</span></button>`).join("")}
          ${CARD_PRESETS.map(
            (preset) =>
              `<button type="button" class="quote-preset" data-quote-preset="${preset.id}" data-quote-category="${preset.category}" ${
                preset.id === card.background ? 'aria-pressed="true"' : ""
              }><img src="${presetThumb(
                preset.id,
              )}" alt="" loading="lazy" decoding="async"><span>${esc(
                preset.name,
              )}</span></button>`,
          ).join("")}
        </div>
      </div>
      <div class="button-row">
        <button type="button" data-quote-background>Elegir mi imagen</button>
        <button type="button" data-quote-surprise>Sorpréndeme</button>
      </div>
      <div class="quote-photo-controls" hidden>
        <label>
          Capa sobre la imagen
          <select name="overlay">
            <option value="dark">Oscurecer</option>
            <option value="light">Aclarar</option>
          </select>
        </label>
        <label>
          Intensidad
          <input name="shade" type="range" min="0" max="90" value="${card.shade}">
        </label>
        <p class="quiet">La imagen se recorta al centro para llenar la tarjeta.</p>
      </div>
    </div>
    <div class="quote-panel" id="quote-panel-texto" data-quote-panel="texto" hidden>
      <label>
        Cita
        <textarea name="quote" rows="5" data-content>${esc(card.quote)}</textarea>
      </label>
      <label class="check-label">
        <input name="attribution" type="checkbox" ${freeform ? "" : "checked"}>
        Incluir título y autor
      </label>
      <div class="quote-source">
        <label>
          Título
          <input name="title" value="${esc(card.title)}">
        </label>
        <label>
          Autor
          <input name="author" value="${esc(card.author)}">
        </label>
      </div>
    </div>
    <div class="quote-panel" id="quote-panel-estilo" data-quote-panel="estilo" hidden>
      <label>
        Formato
        <select name="format">
          <option value="vertical">Vertical · 1080 × 1920</option>
          <option value="square">Cuadrado · 1080 × 1080</option>
        </select>
      </label>
      <label>
        Tipografía
        <select name="font">${CARD_FONTS.map(
          (font) => `<option value="${font.id}">${font.name}</option>`,
        ).join("")}</select>
      </label>
      <label>
        Tamaño de la letra
        <input name="fontSize" type="range" min="32" max="110" value="${card.fontSize}">
      </label>
      <label>
        Color del texto
        <input name="color" type="color" value="${card.color}">
      </label>
      <label>
        Alineación
        <select name="align">
          <option value="center">Centrado</option>
          <option value="left">Izquierda</option>
          <option value="right">Derecha</option>
        </select>
      </label>
    </div>
  </div>
</div>
  <footer class="quote-footer">
    <div class="button-row">
      <button type="button" data-quote-save>Guardar PNG</button>
      <button type="button" data-quote-copy ${!copyAvailable ? "hidden" : ""}>Copiar imagen</button>
      <button type="button" data-quote-share ${!onShare ? "hidden" : ""}>Compartir</button>
    </div>
  </footer>
</form>`;
  root.append(dialog);
  dialog.querySelector("[data-quote-share]").hidden = !onShare;
  dialog.querySelector("[data-quote-copy]").hidden = !copyAvailable;
  localize(dialog);
  const form = dialog.querySelector("form"),
    canvas = dialog.querySelector("canvas"),
    status = dialog.querySelector(".quote-status"),
    fit = dialog.querySelector(".quote-fit");
  const tabs = dialog.querySelectorAll('[role="tab"]');
  const panels = dialog.querySelectorAll("[data-quote-panel]");
  const showPanel = (id) => {
    activeTab = id;
    for (const tab of tabs) {
      const active = tab.dataset.quoteTab === id;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.quotePanel !== id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute(
        "aria-labelledby",
        `quote-tab-${panel.dataset.quotePanel}`,
      );
    }
  };
  let tabPosition = [...tabs].findIndex(
    (tab) => tab.dataset.quoteTab === activeTab,
  );
  if (tabPosition < 0) tabPosition = 0;
  const moveTabFocus = (step) => {
    tabPosition = (tabPosition + step + tabs.length) % tabs.length;
    tabs[tabPosition].focus();
    showPanel(tabs[tabPosition].dataset.quoteTab);
  };
  for (const tab of tabs) {
    tab.id = `quote-tab-${tab.dataset.quoteTab}`;
    tab.addEventListener("click", () => {
      showPanel(tab.dataset.quoteTab);
      tabPosition = [...tabs].indexOf(tab);
    });
    tab.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveTabFocus(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveTabFocus(-1);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        tabPosition = event.key === "Home" ? 0 : tabs.length - 1;
        tabs[tabPosition].focus();
        showPanel(tabs[tabPosition].dataset.quoteTab);
      }
    });
  }
  showPanel(activeTab);
  const message = (text) => {
    status.textContent = text;
    localize(status);
  };
  const sync = () => {
    for (const key of [
      "quote",
      "title",
      "author",
      "format",
      "font",
      "color",
      "align",
      "overlay",
    ])
      card[key] = form.elements.namedItem(key).value;
    card.fontSize = Number(form.elements.fontSize.value);
    card.shade = Number(form.elements.shade.value);
    card.attribution = form.elements.attribution.checked;
  };
  const syncBackgroundUI = () => {
    for (const button of dialog.querySelectorAll(".quote-preset"))
      button.setAttribute(
        "aria-pressed",
        button.dataset.quotePreset === card.background ? "true" : "false",
      );
  };
  const filterPresets = (category) => {
    for (const button of dialog.querySelectorAll(".quote-preset"))
      button.hidden =
        category !== "Todos" && button.dataset.quoteCategory !== category;
    for (const chip of dialog.querySelectorAll(".quote-chip"))
      chip.setAttribute(
        "aria-pressed",
        chip.dataset.quoteChip === category ? "true" : "false",
      );
  };
  const selectBackground = async (id) => {
    if (closed || working) return;
    const generation = ++backgroundGeneration;
    const preset = presetById(id);
    card.background = id;
    photo = null;
    photoSource = null;
    loadingBackground = !!preset;
    const background = CARD_BACKGROUNDS.find((item) => item.id === id);
    if (background) form.elements.color.value = background.ink;
    if (preset) form.elements.color.value = preset.ink ?? "#ffffff";
    message(preset ? "Cargando fondo…" : "");
    update();
    if (!preset) return;
    try {
      const decoded = await loadPresetImage(preset.url);
      if (closed || generation !== backgroundGeneration) return;
      photo = decoded;
      photoSource = id;
      message("");
    } catch {
      if (closed || generation !== backgroundGeneration) return;
      message("No se pudo cargar el fondo.");
    } finally {
      if (!closed && generation === backgroundGeneration) {
        loadingBackground = false;
        update();
      }
    }
  };
  const update = () => {
    if (closed) return;
    sync();
    const layout = renderQuoteCard(
      canvas,
      card,
      photoSource === card.background ? photo : null,
    );
    const backgroundReady =
      !isPhotoBackground(card.background) ||
      (!!photo && photoSource === card.background);
    ready =
      !!card.quote.trim() &&
      !loadingBackground &&
      backgroundReady &&
      layout.fits;
    fit.textContent = !card.quote.trim()
      ? "Escribe o selecciona una cita."
      : !layout.fits
        ? "El fragmento es demasiado largo para esta tarjeta. Acórtalo o usa el formato vertical."
        : "";
    localize(fit);
    dialog.querySelector(".quote-photo-controls").hidden = !isPhotoBackground(
      card.background,
    );
    dialog.querySelector(".quote-source").hidden = !card.attribution;
    syncBackgroundUI();
    for (const button of dialog.querySelectorAll(
      "[data-quote-copy],[data-quote-save],[data-quote-share]",
    ))
      button.disabled = !ready || working || loadingBackground;
  };
  const close = () => {
    if (working) return;
    closed = true;
    backgroundGeneration++;
    dialog.close();
    dialog.remove();
    photo = null;
    photoSource = null;
    canvas.width = canvas.height = 0;
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  form.onsubmit = (event) => event.preventDefault();
  for (const button of dialog.querySelectorAll("[data-quote-close]"))
    button.onclick = close;
  form.addEventListener("input", () => {
    if (!loadingBackground) message("");
    update();
  });
  form.addEventListener("change", update);
  dialog.querySelector(".quote-chip-bar").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-quote-chip]");
    if (chip) filterPresets(chip.dataset.quoteChip);
  });
  dialog
    .querySelector(".quote-preset-list")
    .addEventListener("click", (event) => {
      const button = event.target.closest("[data-quote-preset]");
      if (button) void selectBackground(button.dataset.quotePreset);
    });
  const operation = async (callback) => {
    if (working || closed) return;
    working = true;
    for (const control of form.querySelectorAll("button,input,textarea,select"))
      control.disabled = true;
    try {
      await callback();
    } catch (error) {
      message(error?.message || String(error));
    } finally {
      if (!closed) {
        working = false;
        for (const control of form.querySelectorAll(
          "button,input,textarea,select",
        ))
          control.disabled = false;
        update();
      }
    }
  };
  dialog.querySelector("[data-quote-background]").onclick = () =>
    operation(async () => {
      const data = await onBackground();
      if (!data) return;
      const next = await loadPhoto(data);
      backgroundGeneration++;
      loadingBackground = false;
      photo = next;
      photoSource = "custom";
      card.background = "custom";
      form.elements.color.value = "#ffffff";
      message("");
    });
  dialog.querySelector("[data-quote-surprise]").onclick = () => {
    if (working) return;
    sync();
    const next = surpriseCard(card);
    for (const key of ["color", "font", "align"])
      form.elements.namedItem(key).value = next[key];
    void selectBackground(next.background);
  };
  dialog.querySelector("[data-quote-save]").onclick = () => {
    if (!ready) return;
    operation(async () => {
      const result = await onSave({
        png: canvas.toDataURL("image/png"),
        filename: quoteFilename(card.title),
      });
      if (result) message("Tarjeta guardada.");
    });
  };
  dialog.querySelector("[data-quote-copy]").onclick = () => {
    if (!ready) return;
    operation(async () => {
      await onCopy({ png: canvas.toDataURL("image/png") });
      message("Imagen copiada. Ya puedes pegarla donde quieras compartirla.");
    });
  };
  dialog.querySelector("[data-quote-share]").onclick = () => {
    if (ready && onShare)
      operation(() => onShare({ png: canvas.toDataURL("image/png") }));
  };
  update();
  dialog.showModal();
  return dialog;
}
