import {
  CARD_BACKGROUNDS,
  CARD_FONTS,
  cardDimensions,
  defaultCard,
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
  const bg =
    CARD_BACKGROUNDS.find((b) => b.id === card.background) ??
    CARD_BACKGROUNDS[0];
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, bg.colors[0]);
  gradient.addColorStop(1, bg.colors[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  if (card.background === "custom" && photo) {
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
  } else {
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
  // Use the allowed local image surface; no fetch or network access is needed.
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
export function quoteCardDialog({
  root,
  quote,
  hint = "",
  title,
  author,
  localize,
  onBackground,
  onSave,
  onCopy,
  onShare = null,
  copyAvailable = true,
}) {
  let card = defaultCard({ quote, title, author }),
    photo = null,
    working = false,
    closed = false;
  const dialog = document.createElement("dialog");
  dialog.className = "quote-card-dialog";
  dialog.innerHTML = `<form><header><div><h2>Crear tarjeta de cita</h2><p class="quiet">Diseña una imagen para compartir tu lectura.</p></div><button type="button" data-quote-close aria-label="Cerrar">×</button></header><div class="quote-editor"><section class="quote-options">${hint ? `<p class="quiet">${esc(hint)}</p>` : ""}<label>Cita<textarea name="quote" rows="5" data-content>${esc(quote)}</textarea></label><label>Formato<select name="format"><option value="vertical">Vertical · 1080 × 1920</option><option value="square">Cuadrado · 1080 × 1080</option></select></label><label>Fondo<select name="background">${CARD_BACKGROUNDS.map((b) => `<option value="${b.id}" ${b.id === card.background ? "selected" : ""}>${b.name}</option>`).join("")}<option value="custom" disabled>Mi imagen</option></select></label><div class="button-row"><button type="button" data-quote-background>Elegir mi imagen</button><button type="button" data-quote-surprise>Sorpréndeme</button></div><div class="quote-photo-controls" hidden><label>Capa sobre la imagen<select name="overlay"><option value="dark">Oscurecer</option><option value="light">Aclarar</option></select></label><label>Intensidad<input name="shade" type="range" min="0" max="90" value="45"></label><p class="quiet">La imagen se recorta al centro para llenar la tarjeta.</p></div><label>Tipografía<select name="font">${CARD_FONTS.map((f) => `<option value="${f.id}">${f.name}</option>`).join("")}</select></label><label>Tamaño de la letra<input name="fontSize" type="range" min="32" max="110" value="64"></label><label>Color del texto<input name="color" type="color" value="${card.color}"></label><label>Alineación<select name="align"><option value="center">Centrado</option><option value="left">Izquierda</option><option value="right">Derecha</option></select></label><label class="check-label"><input name="attribution" type="checkbox" checked> Incluir título y autor</label><div class="quote-source"><label>Título<input name="title" value="${esc(title)}" data-content></label><label>Autor<input name="author" value="${esc(author)}" data-content></label></div></section><section class="quote-preview"><canvas aria-label="Vista previa de la tarjeta"></canvas><p class="quote-fit quiet" role="status"></p><p class="quiet">El tamaño de la letra se ajusta para conservar el fragmento completo.</p></section></div><footer><p class="quote-status quiet" role="status"></p><div class="button-row"><button type="button" data-quote-close>Cerrar</button><button type="button" data-quote-copy>Copiar imagen</button><button type="button" data-quote-share>Compartir imagen</button><button type="button" data-quote-save class="primary">Guardar PNG</button></div></footer></form>`;
  root.append(dialog);
  dialog.querySelector("[data-quote-share]").hidden = !onShare;
  dialog.querySelector("[data-quote-copy]").hidden = !copyAvailable;
  localize(dialog);
  const form = dialog.querySelector("form"),
    canvas = dialog.querySelector("canvas"),
    status = dialog.querySelector(".quote-status"),
    fit = dialog.querySelector(".quote-fit");
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
      "background",
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
  let ready = false;
  const update = () => {
    if (closed) return;
    sync();
    const layout = renderQuoteCard(canvas, card, photo);
    ready = !!card.quote.trim() && layout.fits;
    fit.textContent = !card.quote.trim()
      ? "Escribe o selecciona una cita."
      : !layout.fits
        ? "El fragmento es demasiado largo para esta tarjeta. Acórtalo o usa el formato vertical."
        : "";
    localize(fit);
    dialog.querySelector(".quote-photo-controls").hidden =
      card.background !== "custom";
    dialog.querySelector(".quote-source").hidden = !card.attribution;
    for (const button of dialog.querySelectorAll(
      "[data-quote-copy],[data-quote-save],[data-quote-share]",
    ))
      button.disabled = !ready || working;
  };
  const close = () => {
    if (working) return;
    closed = true;
    dialog.close();
    dialog.remove();
    photo = null;
    canvas.width = canvas.height = 0;
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  form.onsubmit = (e) => e.preventDefault();
  for (const button of dialog.querySelectorAll("[data-quote-close]"))
    button.onclick = close;
  form.addEventListener("input", (e) => {
    if (e.target.name === "background") {
      const bg = CARD_BACKGROUNDS.find((b) => b.id === e.target.value);
      if (bg) form.elements.color.value = bg.ink;
    }
    message("");
    update();
  });
  form.addEventListener("change", update);
  const operation = async (callback) => {
    if (working || closed) return;
    working = true;
    for (const control of form.querySelectorAll("button,input,textarea,select"))
      control.disabled = true;
    try {
      await callback();
    } catch (e) {
      message(e?.message || String(e));
    } finally {
      if (!closed) {
        working = false;
        for (const control of form.querySelectorAll(
          "button,input,textarea,select",
        ))
          control.disabled = false;
        form.elements.background.querySelector('[value="custom"]').disabled =
          !photo;
        update();
      }
    }
  };
  dialog.querySelector("[data-quote-background]").onclick = () =>
    operation(async () => {
      const data = await onBackground();
      if (!data) return;
      const next = await loadPhoto(data);
      photo = next;
      form.elements.background.querySelector('[value="custom"]').disabled =
        false;
      form.elements.background.value = "custom";
      form.elements.color.value = "#ffffff";
      message("");
    });
  dialog.querySelector("[data-quote-surprise]").onclick = () => {
    sync();
    card = surpriseCard(card);
    for (const key of ["background", "color", "font", "align"])
      form.elements.namedItem(key).value = card[key];
    message("");
    update();
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
