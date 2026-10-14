import { archiveReader } from "./document-archive.mjs";
import {
  contentBook,
  parseXml,
  safeDocument,
  splitContent,
  xmlElements,
  xmlValue,
} from "./document-content.mjs";

const TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const STYLE_NS = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
const FO_NS = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
const DRAW_NS = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";
const TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const XLINK_NS = "http://www.w3.org/1999/xlink";

export async function parseOdt(bytes, filename, options = {}) {
  const archive = archiveReader(bytes);
  const source = archive.read("content.xml");
  if (!source) {
    archive.dispose();
    throw new Error(
      "No se encontró el contenido del ODT. Puede estar cifrado.",
    );
  }
  const doc = parseXml(source, "document-content");
  const metaBytes = archive.read("meta.xml");
  const meta = metaBytes ? parseXml(metaBytes, "document-meta") : null;
  const metadata = {
    title: (meta && xmlValue(meta, "title")) || filename,
    author:
      (meta &&
        (xmlValue(meta, "initial-creator") || xmlValue(meta, "creator"))) ||
      "",
    language: (meta && xmlValue(meta, "language")) || "",
    genres: meta
      ? xmlElements(meta, "keyword")
          .map((node) => node.textContent.trim())
          .filter(Boolean)
      : [],
    series: "",
    seriesIndex: null,
    cover: null,
  };
  if (options.metadataOnly) {
    metadata.cover = archive.image("Thumbnails/thumbnail.png");
    archive.dispose();
    return { ...metadata, chapters: [] };
  }
  const body = doc.getElementsByTagNameNS(
    "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "text",
  )[0];
  if (!body) {
    archive.dispose();
    throw new Error("El ODT no contiene un documento de texto.");
  }
  const stylesBytes = archive.read("styles.xml");
  const styleDocs = stylesBytes
    ? [doc, parseXml(stylesBytes, "document-styles")]
    : [doc];
  const styles = new Map(
    styleDocs
      .flatMap((source) => [
        ...source.getElementsByTagNameNS(STYLE_NS, "style"),
      ])
      .map((node) => {
        const properties = node.getElementsByTagNameNS(
          STYLE_NS,
          "text-properties",
        )[0];
        return [
          node.getAttributeNS(STYLE_NS, "name"),
          {
            parent: node.getAttributeNS(STYLE_NS, "parent-style-name"),
            bold: properties?.getAttributeNS(FO_NS, "font-weight") === "bold",
            italic:
              properties?.getAttributeNS(FO_NS, "font-style") === "italic",
          },
        ];
      }),
  );
  const listStyles = new Map(
    styleDocs
      .flatMap((source) => [
        ...source.getElementsByTagNameNS(TEXT_NS, "list-style"),
      ])
      .map((node) => [
        node.getAttributeNS(STYLE_NS, "name"),
        node.querySelector("list-level-style-number") ||
        node.getElementsByTagNameNS(TEXT_NS, "list-level-style-number")[0]
          ? "ol"
          : "ul",
      ]),
  );
  const images = new Map();
  function styled(element, name) {
    const seen = new Set();
    while (name && !seen.has(name)) {
      seen.add(name);
      const style = styles.get(name);
      if (!style) break;
      if (style.bold) {
        const strong = document.createElement("strong");
        strong.append(element);
        element = strong;
      }
      if (style.italic) {
        const emphasis = document.createElement("em");
        emphasis.append(element);
        element = emphasis;
      }
      name = style.parent;
    }
    return element;
  }
  function convert(node) {
    if (node.nodeType === Node.TEXT_NODE)
      return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE)
      return document.createDocumentFragment();
    const namespace = node.namespaceURI,
      name = node.localName;
    if (namespace === TEXT_NS && name === "s") {
      const count = Number(node.getAttributeNS(TEXT_NS, "c") || 1);
      if (!Number.isSafeInteger(count) || count < 1 || count > 100000)
        throw new Error("El ODT contiene un espacio de texto no válido.");
      return document.createTextNode(" ".repeat(count));
    }
    if (namespace === TEXT_NS && name === "tab")
      return document.createTextNode("\t");
    if (namespace === TEXT_NS && name === "line-break")
      return document.createElement("br");
    if (namespace === DRAW_NS && name === "image") {
      let path = node.getAttributeNS(XLINK_NS, "href") ?? "";
      if (path.startsWith("./")) path = path.slice(2);
      if (!archive.names.includes(path))
        return document.createDocumentFragment();
      const reference = `#asset-${images.size}`;
      images.set(reference, path);
      const image = document.createElement("img");
      image.src = reference;
      image.alt = "";
      return image;
    }
    let tag = "";
    if (namespace === TEXT_NS)
      tag =
        {
          p: "p",
          h: `h${Math.min(6, Math.max(1, Number(node.getAttributeNS(TEXT_NS, "outline-level")) || 1))}`,
          span: "span",
          a: "span",
          list:
            listStyles.get(node.getAttributeNS(TEXT_NS, "style-name")) || "ul",
          "list-item": "li",
          section: "div",
          "note-body": "div",
          "note-citation": "sup",
        }[name] ?? "";
    if (namespace === TABLE_NS)
      tag =
        {
          table: "table",
          "table-row": "tr",
          "table-cell": "td",
          "table-header-rows": "thead",
        }[name] ?? "";
    const element = tag
      ? document.createElement(tag)
      : document.createDocumentFragment();
    if (
      [
        "script",
        "annotation",
        "tracked-changes",
        "deletion",
        "binary-data",
      ].includes(name)
    )
      return element;
    for (const child of node.childNodes) element.append(convert(child));
    return tag === "span"
      ? styled(element, node.getAttributeNS(TEXT_NS, "style-name"))
      : element;
  }
  const holder = document.createElement("div");
  for (const node of body.childNodes) holder.append(convert(node));
  const sections = splitContent(
    safeDocument(holder.innerHTML, { imageReferences: true }),
    "odt",
  );
  return contentBook(metadata, sections, {
    ...options,
    resolveImage: (reference) => archive.image(images.get(reference)),
    dispose() {
      archive.dispose();
      images.clear();
      styles.clear();
    },
  });
}
