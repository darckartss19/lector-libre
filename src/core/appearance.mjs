export const THEMES = [
  {
    id: "light",
    name: "Papel claro",
    dark: false,
    colors: [
      "#f4f2ed",
      "#fcfbf7",
      "#eae7df",
      "#30332f",
      "#62665d",
      "#d6d3c9",
      "#3f624e",
      "#e2e8df",
    ],
    page: ["#f8f5ed", "#38362f", "#d4cec0"],
  },
  {
    id: "sepia",
    name: "Sepia",
    dark: false,
    colors: [
      "#ede2cf",
      "#f5ecdc",
      "#e3d5bc",
      "#443c30",
      "#645640",
      "#d3c1a3",
      "#755735",
      "#e8d8bc",
    ],
    page: ["#f1e5cf", "#493d2e", "#d3c09e"],
  },
  {
    id: "mist",
    name: "Niebla",
    dark: false,
    colors: [
      "#edf0ef",
      "#f7f9f7",
      "#e0e6e3",
      "#313c38",
      "#5b6962",
      "#cbd5cf",
      "#3f635b",
      "#dce7e2",
    ],
    page: ["#f0f4f0", "#343e38", "#cad5cc"],
  },
  {
    id: "dark",
    name: "Noche",
    dark: true,
    colors: [
      "#1e2324",
      "#282e2f",
      "#181d1e",
      "#d6d8d2",
      "#adb4ae",
      "#3e4747",
      "#9ab7a4",
      "#323e38",
    ],
    page: ["#222829", "#cdd0c9", "#414947"],
  },
  {
    id: "graphite",
    name: "Grafito",
    dark: true,
    colors: [
      "#202123",
      "#2b2c2f",
      "#191a1c",
      "#d8d6d0",
      "#b1b0a9",
      "#424346",
      "#b3babc",
      "#393e40",
    ],
    page: ["#252629", "#cfcdc7", "#46474a"],
  },
  {
    id: "midnight",
    name: "Medianoche",
    dark: true,
    colors: [
      "#18212b",
      "#222e3a",
      "#131b24",
      "#d4dbe0",
      "#adbcc7",
      "#374b5a",
      "#a6c0d0",
      "#2e4250",
    ],
    page: ["#1d2934", "#cad4d9", "#3b4d5b"],
  },
  {
    id: "forest",
    name: "Bosque nocturno",
    dark: true,
    colors: [
      "#19251f",
      "#233229",
      "#142019",
      "#d4ded1",
      "#b0bfad",
      "#3d5140",
      "#a4c39a",
      "#354c38",
    ],
    page: ["#202d24", "#cbd7c7", "#405541"],
  },
  {
    id: "plum",
    name: "Ciruela",
    dark: true,
    colors: [
      "#271f28",
      "#342a35",
      "#201922",
      "#dfd3dc",
      "#c0adbd",
      "#534154",
      "#cfafc6",
      "#4b374b",
    ],
    page: ["#2b232d", "#d7cad2", "#503f50"],
  },
  {
    id: "ember",
    name: "Noche cálida",
    dark: true,
    colors: [
      "#28221c",
      "#352d25",
      "#211b16",
      "#e3d6c2",
      "#c3b29a",
      "#544636",
      "#d2b88d",
      "#4d3f2e",
    ],
    page: ["#2b251e", "#d8cbb5", "#534735"],
  },
  {
    id: "amoled",
    name: "Negro profundo",
    dark: true,
    colors: [
      "#000000",
      "#121414",
      "#080909",
      "#cbcfc9",
      "#a7b0a8",
      "#303936",
      "#a3b9ad",
      "#273a30",
    ],
    page: ["#000000", "#bfc6bf", "#303936"],
  },
];
export const FONTS = [
  { id: "serif", name: "Literaria", css: 'Georgia, "Times New Roman", serif' },
  { id: "book", name: "Libro clásico", css: "Cambria, Georgia, serif" },
  { id: "sans", name: "Sin remates", css: '"Segoe UI", Arial, sans-serif' },
  {
    id: "wide",
    name: "Lectura amplia",
    css: 'Verdana, "Segoe UI", sans-serif',
  },
  {
    id: "mono",
    name: "Monoespaciada",
    css: 'Consolas, "Courier New", monospace',
  },
];
export const APPEARANCE_DEFAULTS = {
  readingMode: "scroll",
  theme: "light",
  pageTheme: "auto",
  font: "serif",
  fontSize: 20,
  lineHeight: 1.8,
  pageWidth: 760,
  pagePadding: 28,
  paragraphSpacing: 1.3,
  letterSpacing: 0,
  textAlign: "left",
  firstLineIndent: false,
};
export const NUMBER_PREFERENCES = {
  fontSize: [12, 40],
  lineHeight: [1.2, 2.6],
  pageWidth: [480, 1200],
  pagePadding: [8, 80],
  paragraphSpacing: [0.3, 2.5],
  letterSpacing: [0, 0.12],
  rate: [0.5, 3],
};
export function themeFor(id) {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
export function applyAppearance(element, preferences = {}) {
  const p = { ...APPEARANCE_DEFAULTS, ...preferences };
  const theme = themeFor(p.theme);
  const page = themeFor(p.pageTheme === "auto" ? theme.id : p.pageTheme);
  element.dataset.theme = theme.id;
  element.style.colorScheme = theme.dark ? "dark" : "light";
  ["bg", "panel", "side", "ink", "muted", "line", "accent", "hover"].forEach(
    (name, i) => element.style.setProperty(`--${name}`, theme.colors[i]),
  );
  element.style.setProperty("--accent-ink", theme.dark ? "#101512" : "#ffffff");
  element.style.setProperty("--danger", theme.dark ? "#e5aaa1" : "#94483f");
  element.style.setProperty("--danger-ink", theme.dark ? "#281c19" : "#ffffff");
  ["bg", "ink", "line"].forEach((name, i) =>
    element.style.setProperty(`--page-${name}`, page.page[i]),
  );
  element.style.setProperty("--page-accent", page.colors[6]);
  element.style.setProperty("--page-selection", page.colors[7]);
  element.style.setProperty(
    "--reading-font",
    (FONTS.find((f) => f.id === p.font) ?? FONTS[0]).css,
  );
  for (const [name, css, unit] of [
    ["fontSize", "reading-size", "px"],
    ["lineHeight", "reading-line", ""],
    ["pageWidth", "page-width", "px"],
    ["pagePadding", "page-padding", "px"],
    ["paragraphSpacing", "paragraph-space", "em"],
    ["letterSpacing", "letter-space", "em"],
  ]) {
    const [min, max] = NUMBER_PREFERENCES[name];
    const value =
      typeof p[name] === "number" && Number.isFinite(p[name])
        ? Math.max(min, Math.min(max, p[name]))
        : APPEARANCE_DEFAULTS[name];
    element.style.setProperty(`--${css}`, `${value}${unit}`);
  }
  element.style.setProperty(
    "--reading-align",
    p.textAlign === "justify" ? "justify" : "left",
  );
  element.style.setProperty(
    "--reading-indent",
    p.firstLineIndent === true ? "1.5em" : "0",
  );
}
