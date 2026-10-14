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
  const bg = pick(CARD_BACKGROUNDS),
    font = pick(CARD_FONTS);
  return {
    ...card,
    background: bg.id,
    color: bg.ink,
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
