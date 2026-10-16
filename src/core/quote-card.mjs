export const CARD_BACKGROUNDS = [
  {
    id: "paper",
    name: "Papel",
    colors: ["#f4e7cf", "#e9d5b3"],
    ink: "#3d3026",
    style: "paper",
  },
  {
    id: "midnight",
    name: "Medianoche",
    colors: ["#0c142b", "#24335b"],
    ink: "#eef2ff",
    style: "glow",
  },
  {
    id: "forest",
    name: "Bosque",
    colors: ["#142c26", "#396355"],
    ink: "#f2f5e7",
    style: "leaves",
  },
  {
    id: "plum",
    name: "Ciruela",
    colors: ["#28152f", "#684066"],
    ink: "#fff0fc",
    style: "glow",
  },
  {
    id: "sunset",
    name: "Atardecer",
    colors: ["#f7d6b0", "#ce8892"],
    ink: "#3e2332",
    style: "glow",
  },
  {
    id: "ocean",
    name: "Océano",
    colors: ["#122f4b", "#3e778a"],
    ink: "#edfaff",
    style: "waves",
  },
  {
    id: "mist",
    name: "Niebla",
    colors: ["#f1f3ef", "#cfd8d4"],
    ink: "#233b36",
    style: "paper",
  },
  {
    id: "warm",
    name: "Noche cálida",
    colors: ["#241b17", "#76553d"],
    ink: "#fff1d5",
    style: "paper",
  },
];
// Offline photo backgrounds bundled with the app. The parent creates the
// actual files in public/quote-backgrounds/<id>.webp; this registry only
// documents the local asset URLs and their Spanish display names.
export const CARD_PRESETS = [
  {
    id: "starry-sky",
    name: "Cielo estrellado",
    category: "Cielos",
    url: "/quote-backgrounds/starry-sky.webp",
    thumb: "/quote-backgrounds/starry-sky-thumb.webp",
    photo: true,
  },
  {
    id: "aurora",
    name: "Aurora",
    category: "Cielos",
    url: "/quote-backgrounds/aurora.webp",
    thumb: "/quote-backgrounds/aurora-thumb.webp",
    photo: true,
  },
  {
    id: "moonlit-sea",
    name: "Mar de luna",
    category: "Paisajes",
    url: "/quote-backgrounds/moonlit-sea.webp",
    thumb: "/quote-backgrounds/moonlit-sea-thumb.webp",
    photo: true,
  },
  {
    id: "misty-mountains",
    name: "Montañas en niebla",
    category: "Paisajes",
    url: "/quote-backgrounds/misty-mountains.webp",
    thumb: "/quote-backgrounds/misty-mountains-thumb.webp",
    photo: true,
  },
  {
    id: "pine-lake",
    name: "Lago entre pinos",
    category: "Paisajes",
    url: "/quote-backgrounds/pine-lake.webp",
    thumb: "/quote-backgrounds/pine-lake-thumb.webp",
    photo: true,
  },
  {
    id: "sunset-dunes",
    name: "Dunas al atardecer",
    category: "Paisajes",
    url: "/quote-backgrounds/sunset-dunes.webp",
    thumb: "/quote-backgrounds/sunset-dunes-thumb.webp",
    photo: true,
  },
  {
    id: "cloud-sea",
    name: "Mar de nubes",
    category: "Cielos",
    url: "/quote-backgrounds/cloud-sea.webp",
    thumb: "/quote-backgrounds/cloud-sea-thumb.webp",
    photo: true,
  },
  {
    id: "lavender-field",
    name: "Lavanda",
    category: "Colores",
    url: "/quote-backgrounds/lavender-field.webp",
    thumb: "/quote-backgrounds/lavender-field-thumb.webp",
    photo: true,
  },
  {
    id: "rain-window",
    name: "Lluvia en la ventana",
    category: "Texturas",
    url: "/quote-backgrounds/rain-window.webp",
    thumb: "/quote-backgrounds/rain-window-thumb.webp",
    photo: true,
  },
  {
    id: "autumn-forest",
    name: "Bosque otoñal",
    category: "Paisajes",
    url: "/quote-backgrounds/autumn-forest.webp",
    thumb: "/quote-backgrounds/autumn-forest-thumb.webp",
    photo: true,
  },
  {
    id: "snow-peaks",
    name: "Cumbres nevadas",
    category: "Paisajes",
    url: "/quote-backgrounds/snow-peaks.webp",
    thumb: "/quote-backgrounds/snow-peaks-thumb.webp",
    photo: true,
  },
  {
    id: "tropical-shore",
    name: "Costa tropical",
    category: "Paisajes",
    url: "/quote-backgrounds/tropical-shore.webp",
    thumb: "/quote-backgrounds/tropical-shore-thumb.webp",
    photo: true,
  },
  {
    id: "cosmic-nebula",
    name: "Nebulosa",
    category: "Cielos",
    url: "/quote-backgrounds/cosmic-nebula.webp",
    thumb: "/quote-backgrounds/cosmic-nebula-thumb.webp",
    photo: true,
  },
  {
    id: "botanical-light",
    name: "Luz botánica",
    category: "Colores",
    url: "/quote-backgrounds/botanical-light.webp",
    thumb: "/quote-backgrounds/botanical-light-thumb.webp",
    photo: true,
  },
  {
    id: "rose-dawn",
    name: "Amanecer rosado",
    category: "Colores",
    url: "/quote-backgrounds/rose-dawn.webp",
    thumb: "/quote-backgrounds/rose-dawn-thumb.webp",
    photo: true,
  },
];
export const CARD_PRESET_CATEGORIES = [
  "Todos",
  "Paisajes",
  "Cielos",
  "Texturas",
  "Colores",
];
export const allCardBackgrounds = () => [...CARD_BACKGROUNDS, ...CARD_PRESETS];
export const presetById = (id) =>
  CARD_PRESETS.find((preset) => preset.id === id);
export const isPhotoBackground = (id) =>
  id === "custom" || CARD_PRESETS.some((preset) => preset.id === id);
export const presetThumb = (id) => {
  const preset = presetById(id);
  return preset ? preset.thumb : null;
};
export const CARD_FONTS = [
  {
    id: "literary",
    name: "Literaria",
    family: 'Georgia, "Times New Roman", serif',
  },
  {
    id: "classic",
    name: "Clásica",
    family: '"Palatino Linotype", "Book Antiqua", Georgia, serif',
  },
  { id: "clean", name: "Limpia", family: '"Segoe UI", Arial, sans-serif' },
  {
    id: "rounded",
    name: "Redondeada",
    family: '"Trebuchet MS", Arial, sans-serif',
  },
  {
    id: "typewriter",
    name: "Máquina de escribir",
    family: '"Courier New", monospace',
  },
];
export const cardDimensions = (format) =>
  format === "square"
    ? { width: 1080, height: 1080 }
    : { width: 1080, height: 1920 };
export const defaultCard = ({ quote, title, author }) => ({
  quote,
  title,
  author,
  format: "vertical",
  background: "midnight",
  font: "literary",
  fontSize: 64,
  color: "#eef2ff",
  align: "center",
  shade: 45,
  overlay: "dark",
  attribution: true,
});
export function surpriseCard(card, random = Math.random) {
  const pick = (choices) =>
    choices[
      Math.min(
        choices.length - 1,
        Math.max(0, Math.floor(random() * choices.length)),
      )
    ];
  const backgrounds = allCardBackgrounds();
  const bg = pick(backgrounds),
    font = pick(CARD_FONTS);
  return {
    ...card,
    background: bg.id,
    color: bg.ink ?? card.color,
    font: font.id,
    align: pick(["left", "center"]),
  };
}
// Wrap measured text without dropping words, blank lines or Unicode clusters.
export function wrapCardText(text, width, measure) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const lines = [];
  for (const paragraph of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const { segment } of segmenter.segment(word)) {
        if (line && measure(line + segment) > width) {
          lines.push(line);
          line = "";
        }
        line += segment;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
export function fitCardText(
  text,
  { width, height, preferredSize, minimum = 24, measure, lineHeight = 1.4 },
) {
  for (let size = preferredSize; size >= minimum; size--) {
    const lines = wrapCardText(text, width, (value) => measure(value, size));
    if (lines.length * size * lineHeight <= height)
      return { lines, size, lineHeight: size * lineHeight, fits: true };
  }
  const lines = wrapCardText(text, width, (value) => measure(value, minimum));
  return {
    lines,
    size: minimum,
    lineHeight: minimum * lineHeight,
    fits: false,
  };
}
export function quoteFilename(title) {
  const name = String(title || "Lectura")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70)
    .replace(/[. ]+$/g, "");
  return `Cita - ${name || "Lectura"}.png`;
}
