export const THEMES = [
  {
    id: "light",
    name: "Papel claro",
    dark: false,
    colors: [
      "#f8f7f2",
      "#fffef9",
      "#eeeee5",
      "#263d32",
      "#626a60",
      "#dddfd3",
      "#375e47",
      "#e1e5d7",
    ],
  },
  {
    id: "sepia",
    name: "Sepia",
    dark: false,
    colors: [
      "#f0e4ce",
      "#f5ead6",
      "#e6d8be",
      "#51462e",
      "#68583c",
      "#d2c3a7",
      "#796537",
      "#dfd2b5",
    ],
  },
  {
    id: "mist",
    name: "Niebla",
    dark: false,
    colors: [
      "#eef2f5",
      "#f9fbfc",
      "#e2e8ed",
      "#293846",
      "#4d5e6c",
      "#cbd6df",
      "#365c79",
      "#d5e2ec",
    ],
  },
  {
    id: "dark",
    name: "Noche",
    dark: true,
    colors: [
      "#1e2723",
      "#27332c",
      "#19241d",
      "#dfebdc",
      "#b0bcb0",
      "#3b4a3f",
      "#719575",
      "#344a37",
    ],
  },
  {
    id: "graphite",
    name: "Grafito",
    dark: true,
    colors: [
      "#191b20",
      "#22252c",
      "#14161a",
      "#e3e5eb",
      "#afb4c0",
      "#383d48",
      "#8292bc",
      "#333b50",
    ],
  },
  {
    id: "midnight",
    name: "Medianoche",
    dark: true,
    colors: [
      "#101827",
      "#172338",
      "#0c1320",
      "#dfe7f3",
      "#a5b7ce",
      "#2e405d",
      "#7094b9",
      "#243c57",
    ],
  },
  {
    id: "forest",
    name: "Bosque nocturno",
    dark: true,
    colors: [
      "#10201d",
      "#192d27",
      "#0c1916",
      "#dce9df",
      "#a2bbad",
      "#2c493f",
      "#719782",
      "#294a3d",
    ],
  },
  {
    id: "plum",
    name: "Ciruela",
    dark: true,
    colors: [
      "#211822",
      "#302334",
      "#19121c",
      "#eee0ef",
      "#c2abc4",
      "#503951",
      "#a07b9f",
      "#48334b",
    ],
  },
  {
    id: "ember",
    name: "Noche cálida",
    dark: true,
    colors: [
      "#241c18",
      "#322822",
      "#1b1512",
      "#eedfc9",
      "#c5ad96",
      "#514237",
      "#aa8963",
      "#4c3a2d",
    ],
  },
  {
    id: "amoled",
    name: "Negro profundo",
    dark: true,
    colors: [
      "#000000",
      "#101112",
      "#050505",
      "#d9dadc",
      "#a5a9ae",
      "#2c2e32",
      "#7d9792",
      "#20312d",
    ],
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
  element.style.setProperty("--page-bg", page.colors[1]);
  element.style.setProperty("--page-ink", page.colors[3]);
  element.style.setProperty("--page-line", page.colors[5]);
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
