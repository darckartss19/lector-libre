import DOMPurify from "dompurify";
import { chapterCache } from "./chapter-cache.mjs";

const CONTENT_TAGS = [
  "p",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
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
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "sup",
  "sub",
  "pre",
  "code",
  "a",
];

export function decodeText(bytes, { xml = false } = {}) {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  else {
    const header = new TextDecoder("ascii").decode(bytes.subarray(0, 1024));
    const declared = xml
      ? header.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)/i)
      : header.match(/<meta[^>]*charset\s*=\s*["']?([\w-]+)/i);
    if (declared) encoding = declared[1];
  }
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error("No se pudo leer la codificación del documento.");
  }
}

export function parseXml(bytes, expectedRoot) {
  const source =
    typeof bytes === "string" ? bytes : decodeText(bytes, { xml: true });
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("El documento contiene una definición XML no compatible.");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (
    doc.querySelector("parsererror") ||
    (expectedRoot && doc.documentElement.localName !== expectedRoot)
  )
    throw new Error("El documento no contiene XML válido para este formato.");
  return doc;
}

export const xmlElements = (node, name) => [
  ...node.getElementsByTagNameNS("*", name),
];
export const xmlValue = (node, name) =>
  xmlElements(node, name)[0]?.textContent?.trim() ?? "";

export function localImage(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value)
  );
}

export function imageUri(bytes, type) {
  if (!bytes || !/^image\/(png|jpeg|gif|webp)$/.test(type)) return null;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${type};base64,${btoa(binary)}`;
}

// Sanitize before constructing document nodes; inert parsing must not fetch remote images.
export function safeDocument(html, { imageReferences = false } = {}) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: CONTENT_TAGS,
    ALLOWED_ATTR: ["src", "alt", "colspan", "rowspan"],
    FORBID_CONTENTS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "svg",
      "math",
    ],
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const image of template.content.querySelectorAll("img")) {
    const source = image.getAttribute("src");
    if (
      !localImage(source) &&
      !(imageReferences && /^#asset-[\w.-]+$/.test(source ?? ""))
    )
      image.remove();
  }
  return template;
}

export function htmlChapter(html) {
  const safe = safeDocument(html);
  const display = safe.innerHTML;
  for (const node of safe.content.querySelectorAll(
    "p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr",
  ))
    node.append(document.createTextNode("\n"));
  return { html: display, text: safe.content.textContent ?? "" };
}

export function splitContent(template, prefix = "section") {
  const sections = [];
  let nodes = [],
    title = "";
  const flush = () => {
    if (!nodes.length) return;
    const container = document.createElement("div");
    container.append(...nodes);
    if (container.textContent.trim() || container.querySelector("img"))
      sections.push({
        id: `${prefix}-${sections.length + 1}`,
        title: title || `Sección ${sections.length + 1}`,
        source: container.innerHTML,
      });
    nodes = [];
    title = "";
  };
  // Use the highest heading level present as chapter boundaries. Cap long unheaded sections.
  const headings = [...template.content.children].filter((node) =>
    /^H[1-6]$/.test(node.tagName),
  );
  const level = headings.reduce(
    (best, node) => Math.min(best, Number(node.tagName[1])),
    7,
  );
  let characters = 0;
  for (const node of [...template.content.childNodes]) {
    const startsSection =
      node.nodeType === Node.ELEMENT_NODE && node.tagName === `H${level}`;
    if (startsSection || (characters > 24000 && nodes.length)) {
      flush();
      characters = 0;
    }
    if (startsSection) title = node.textContent.trim();
    nodes.push(node);
    characters += node.textContent.length;
  }
  flush();
  return sections;
}

export async function contentBook(
  metadata,
  sections,
  { lazy = false, dispose, resolveImage } = {},
) {
  if (!sections.length)
    throw new Error("El documento no contiene texto ni imágenes legibles.");
  let sources = sections;
  const chapters = sections.map(({ id, title }) => ({ id, title }));
  const load = async (index, { textOnly = false } = {}) => {
    if (!sources) throw new Error("El libro ya está cerrado.");
    let html = sources[index].source;
    if (resolveImage) {
      const template = safeDocument(html, { imageReferences: true });
      for (const image of template.content.querySelectorAll("img")) {
        const reference = image.getAttribute("src");
        if (!reference?.startsWith("#asset-")) continue;
        const uri = textOnly ? null : await resolveImage(reference);
        if (localImage(uri)) image.src = uri;
        else image.remove();
      }
      html = template.innerHTML;
    }
    return htmlChapter(html);
  };
  if (!lazy) {
    for (let index = 0; index < chapters.length; index++)
      Object.assign(chapters[index], await load(index));
    await dispose?.();
    sources = null;
    return { ...metadata, chapters };
  }
  const cache = chapterCache(chapters, load);
  return {
    ...metadata,
    chapters,
    ...cache,
    async dispose() {
      cache.disposeChapters();
      sources = null;
      await dispose?.();
    },
  };
}
