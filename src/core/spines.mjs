const rgb = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((part) => parseInt(part, 16));
const hex = (channels) =>
  "#" +
  channels.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
const luminance = (color) =>
  rgb(color)
    .map((n) => {
      const c = n / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i],
      0,
    );

export function contrastRatio(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
export function readableInk(background) {
  return ["#fff8e9", "#172820", "#ffffff", "#000000"].find(
    (ink) => contrastRatio(background, ink) >= 4.5,
  );
}
export function fallbackSpine(id) {
  const colors = ["#395b4b", "#815945", "#646784", "#987744", "#49747d"];
  const index =
    [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) %
    colors.length;
  const background = colors[index];
  return {
    background,
    ink: readableInk(background),
    accent: "#d4b87b",
    art: null,
  };
}
export function paletteFromPixels(pixels, fallback = fallbackSpine("")) {
  const clusters = new Map();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const key =
      (pixels[i] >> 4) * 256 + (pixels[i + 1] >> 4) * 16 + (pixels[i + 2] >> 4);
    const entry = clusters.get(key) ?? { count: 0, sums: [0, 0, 0] };
    entry.count++;
    entry.sums.forEach(
      (_, channel) => (entry.sums[channel] += pixels[i + channel]),
    );
    clusters.set(key, entry);
  }
  const colors = [...clusters.values()]
    .sort((a, b) => b.count - a.count)
    .map((entry) => entry.sums.map((sum) => sum / entry.count));
  if (!colors.length) return fallback;
  const background = hex(colors[0]);
  const contrastColor = colors
    .slice(1)
    .find(
      (color) =>
        color.reduce((sum, n, i) => sum + (n - colors[0][i]) ** 2, 0) > 6400,
    );
  return {
    background,
    ink: readableInk(background),
    accent: contrastColor ? hex(contrastColor) : fallback.accent,
    art: null,
  };
}
export function isLocalCover(cover) {
  return (
    typeof cover === "string" &&
    /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(cover)
  );
}
export async function designSpine(cover, fallback = fallbackSpine("")) {
  if (!isLocalCover(cover)) return fallback;
  let bitmap;
  const canvas = document.createElement("canvas");
  try {
    const comma = cover.indexOf(",");
    const binary = atob(cover.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: cover.slice(5, cover.indexOf(";")),
    });
    // Only one small bitmap is retained; no network, model or full-size copy in the cache.
    bitmap = await createImageBitmap(blob, {
      resizeWidth: 48,
      resizeHeight: 72,
      resizeQuality: "low",
    });
    canvas.width = 48;
    canvas.height = 72;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const result = paletteFromPixels(
      context.getImageData(0, 0, 48, 72).data,
      fallback,
    );
    // A small illustration band complements the palette without squeezing the cover into a spine.
    context.clearRect(0, 0, 48, 72);
    context.drawImage(bitmap, 0, 36, 48, 28, 0, 0, 48, 28);
    const band = document.createElement("canvas");
    band.width = 48;
    band.height = 28;
    band.getContext("2d").drawImage(canvas, 0, 0);
    result.art = band.toDataURL("image/webp", 0.75);
    band.width = 0;
    band.height = 0;
    return result;
  } catch {
    return fallback;
  } finally {
    bitmap?.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function applySpine(element, design) {
  element.style.setProperty("--spine-color", design.background);
  element.style.setProperty("--spine-ink", design.ink);
  element.style.setProperty("--spine-accent", design.accent);
  const band = element.querySelector(".spine-art");
  if (band) {
    band.style.backgroundImage = design.art ? `url("${design.art}")` : "none";
    band.classList.toggle("has-art", !!design.art);
  }
}
