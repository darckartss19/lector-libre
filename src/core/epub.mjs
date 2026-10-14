import { unzipSync, strFromU8 } from "fflate";
import DOMPurify from "dompurify";
import { chapterCache } from "./chapter-cache.mjs";

export function resolveResource(base, href) {
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href))
    throw new Error("El libro contiene una referencia externa.");
  const parts = (
    base.slice(0, base.lastIndexOf("/") + 1) +
    decodeURIComponent(href.split("#")[0])
  ).split("/");
  const result = [];
  for (const part of parts) {
    if (part === "..") {
      if (!result.length) throw new Error("Ruta fuera del libro.");
      result.pop();
    } else if (part && part !== ".") result.push(part);
  }
  return result.join("/");
}
export function unzipBook(bytes, paths = null) {
  const selected = paths === null ? null : new Set(paths);
  return unzipSync(bytes, {
    filter: (file) => selected === null || selected.has(file.name),
  });
}
const xml = (text) => {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("EPUB con XML no válido.");
  return doc;
};
const elements = (doc, name) => [...doc.getElementsByTagNameNS("*", name)];
const value = (doc, name) => elements(doc, name)[0]?.textContent?.trim() ?? "";
const seriesIndex = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
function seriesMetadata(opf) {
  const metadata = elements(opf, "meta");
  const named = (name) =>
    metadata
      .find((node) => node.getAttribute("name")?.toLowerCase() === name)
      ?.getAttribute("content")
      ?.trim() ?? "";
  const calibre = named("calibre:series");
  if (calibre)
    return {
      series: calibre,
      seriesIndex: seriesIndex(named("calibre:series_index")),
    };
  for (const collection of metadata.filter(
    (node) => node.getAttribute("property") === "belongs-to-collection",
  )) {
    const id = collection.getAttribute("id");
    if (!id || !collection.textContent?.trim()) continue;
    const refined = (property) =>
      metadata
        .find(
          (node) =>
            node.getAttribute("refines") === "#" + id &&
            node.getAttribute("property") === property,
        )
        ?.textContent?.trim() ?? "";
    if (refined("collection-type").toLowerCase() !== "series") continue;
    return {
      series: collection.textContent.trim(),
      seriesIndex: seriesIndex(refined("group-position")),
    };
  }
  return { series: "", seriesIndex: null };
}
const imageData = (files, path, type) => {
  if (!/^image\/(png|jpeg|gif|webp)$/i.test(type ?? "") || !files[path])
    return null;
  const bytes = files[path];
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${type};base64,${btoa(binary)}`;
};
function chapterContent(files, item, resources, ordinal) {
  const source = new DOMParser().parseFromString(
    strFromU8(files[item.path]),
    "text/html",
  );
  source
    .querySelectorAll("script,style,iframe,object,embed,form,nav")
    .forEach((n) => n.remove());
  for (const img of source.querySelectorAll("img")) {
    try {
      const path = resolveResource(item.path, img.getAttribute("src") ?? "");
      const data = imageData(files, path, resources.get(path)?.type);
      if (data) img.setAttribute("src", data);
      else img.remove();
    } catch {
      img.remove();
    }
  }
  source.querySelectorAll("a").forEach((a) => a.removeAttribute("href"));
  const html = DOMPurify.sanitize(source.body.innerHTML, {
    ALLOWED_TAGS: [
      "p",
      "div",
      "span",
      "h1",
      "h2",
      "h3",
      "h4",
      "blockquote",
      "em",
      "strong",
      "i",
      "b",
      "u",
      "s",
      "br",
      "hr",
      "ul",
      "ol",
      "li",
      "img",
      "figure",
      "figcaption",
      "table",
      "tbody",
      "tr",
      "td",
      "th",
      "sup",
      "sub",
    ],
    ALLOWED_ATTR: ["src", "alt", "colspan", "rowspan"],
  });
  const holder = document.createElement("div");
  holder.innerHTML = html;
  // TTS gets paragraph boundaries rather than concatenated words.
  holder
    .querySelectorAll("p,div,h1,h2,h3,h4,li,blockquote")
    .forEach((n) => n.append(document.createTextNode("\n")));
  const text = holder.textContent;
  return {
    title:
      source.querySelector("h1,h2,h3,title")?.textContent?.trim() ||
      `Sección ${ordinal + 1}`,
    html,
    text: text ?? "",
  };
}
export function parseBook(
  bytes,
  format,
  filename,
  { metadataOnly = false, seriesOnly = false, lazy = false } = {},
) {
  if (format === "txt") {
    if (metadataOnly || seriesOnly)
      return {
        title: filename,
        author: "",
        genres: [],
        series: "",
        seriesIndex: null,
        cover: null,
        chapters: [],
      };
    const text = new TextDecoder().decode(bytes);
    const paragraphs = text.split(/\r?\n\s*\r?\n/).filter((p) => p.trim());
    const node = document.createElement("div");
    for (const p of paragraphs) {
      const el = document.createElement("p");
      el.textContent = p;
      node.append(el);
    }
    return {
      title: filename,
      author: "",
      genres: [],
      series: "",
      seriesIndex: null,
      cover: null,
      chapters: [
        {
          id: "text",
          title: filename,
          html: node.innerHTML,
          text: paragraphs.join("\n\n"),
        },
      ],
    };
  }
  let files = unzipBook(bytes, ["META-INF/container.xml"]);
  const container = xml(
    strFromU8(files["META-INF/container.xml"] ?? new Uint8Array()),
  );
  const opfPath = elements(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("No se encontró el índice del EPUB.");
  files = unzipBook(bytes, [opfPath]);
  if (!files[opfPath]) throw new Error("No se encontró el índice del EPUB.");
  const opf = xml(strFromU8(files[opfPath]));
  const metadata = {
    language: value(opf, "language"),
    title: value(opf, "title") || filename,
    author: elements(opf, "creator")
      .map((n) => n.textContent.trim())
      .join(", "),
    genres: elements(opf, "subject")
      .map((n) => n.textContent.trim())
      .filter(Boolean),
    ...seriesMetadata(opf),
  };
  // Scanning existing files only needs the OPF, not covers or chapter resources.
  if (seriesOnly) return { ...metadata, cover: null, chapters: [] };
  const items = new Map(
    elements(opf, "item").map((el) => [
      el.getAttribute("id"),
      {
        path: resolveResource(opfPath, el.getAttribute("href") ?? ""),
        type: el.getAttribute("media-type"),
        properties: el.getAttribute("properties") ?? "",
      },
    ]),
  );
  let coverItem = [...items.values()].find((i) =>
    i.properties.split(" ").includes("cover-image"),
  );
  if (!coverItem) {
    const meta = elements(opf, "meta").find(
      (el) => el.getAttribute("name") === "cover",
    );
    coverItem = items.get(meta?.getAttribute("content"));
  }
  if (metadataOnly) {
    // Importing needs no chapter DOM or illustration buffers, regardless of book size.
    const covers = coverItem ? unzipBook(bytes, [coverItem.path]) : {};
    return {
      ...metadata,
      cover: coverItem
        ? imageData(covers, coverItem.path, coverItem.type)
        : null,
      chapters: [],
    };
  }
  const resources = new Map([...items.values()].map((i) => [i.path, i]));
  if (lazy) {
    const entries = elements(opf, "itemref")
      .filter((ref) => ref.getAttribute("linear") !== "no")
      .map((ref) => ({
        id: ref.getAttribute("idref"),
        item: items.get(ref.getAttribute("idref")),
      }))
      .filter((entry) => entry.item);
    if (!entries.length)
      throw new Error("El EPUB no tiene capítulos legibles.");
    const titles = new Map();
    const navigation = [...items.values()].filter(
      (item) =>
        item.properties.split(" ").includes("nav") ||
        item.type === "application/x-dtbncx+xml",
    );
    for (const item of navigation) {
      try {
        const content = unzipBook(bytes, [item.path])[item.path];
        if (!content) continue;
        const nav = new DOMParser().parseFromString(
          strFromU8(content),
          item.type === "application/x-dtbncx+xml"
            ? "application/xml"
            : "text/html",
        );
        const links =
          item.type === "application/x-dtbncx+xml"
            ? elements(nav, "navPoint").map((point) => [
                elements(point, "content")[0]?.getAttribute("src"),
                elements(point, "navLabel")[0]?.textContent,
              ])
            : [...nav.querySelectorAll("a[href]")].map((link) => [
                link.getAttribute("href"),
                link.textContent,
              ]);
        for (const [href, title] of links) {
          if (!href || !title?.trim()) continue;
          const path = resolveResource(item.path, href);
          if (!titles.has(path)) titles.set(path, title.trim());
        }
      } catch {
        /* A damaged optional TOC must not prevent chapter reading. */
      }
    }
    const chapters = entries.map((entry, index) => ({
      id: entry.id,
      title: titles.get(entry.item.path) ?? `Sección ${index + 1}`,
    }));
    let archive = bytes;
    const load = (index, { textOnly = false } = {}) => {
      if (!archive) throw new Error("El libro ya está cerrado.");
      const { item } = entries[index];
      const files = unzipBook(archive, [item.path]);
      if (!files[item.path])
        throw new Error("No se encontró este capítulo del EPUB.");
      const source = new DOMParser().parseFromString(
        strFromU8(files[item.path]),
        "text/html",
      );
      const images = [...source.querySelectorAll("img")].flatMap((img) => {
        try {
          return [resolveResource(item.path, img.getAttribute("src") ?? "")];
        } catch {
          return [];
        }
      });
      if (!textOnly) Object.assign(files, unzipBook(archive, images));
      return chapterContent(files, item, resources, index);
    };
    const cache = chapterCache(chapters, load);
    return {
      ...metadata,
      cover: null,
      chapters,
      ...cache,
      async dispose() {
        cache.disposeChapters();
        archive = null;
      },
    };
  }
  const paths = elements(opf, "itemref")
    .filter((ref) => ref.getAttribute("linear") !== "no")
    .map((ref) => items.get(ref.getAttribute("idref"))?.path)
    .filter(Boolean);
  if (coverItem) paths.push(coverItem.path);
  // Leave unrelated fonts, audio, video and attachments compressed.
  for (const item of items.values())
    if (/^image\//i.test(item.type ?? "")) paths.push(item.path);
  files = unzipBook(bytes, paths);
  const chapters = [];
  for (const ref of elements(opf, "itemref")) {
    if (ref.getAttribute("linear") === "no") continue;
    const id = ref.getAttribute("idref"),
      item = items.get(id);
    if (!item || !files[item.path]) continue;
    const { title, html, text } = chapterContent(
      files,
      item,
      resources,
      chapters.length,
    );
    if (text?.trim())
      chapters.push({
        id,
        title,
        html,
        text,
      });
  }
  if (!chapters.length)
    throw new Error(
      "El EPUB no tiene texto legible. Puede necesitar otro formato o incluir DRM.",
    );
  return {
    ...metadata,
    cover: coverItem ? imageData(files, coverItem.path, coverItem.type) : null,
    chapters,
  };
}
