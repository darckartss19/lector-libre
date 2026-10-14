import {
  contentBook,
  imageUri,
  parseXml,
  safeDocument,
  splitContent,
  xmlElements,
  xmlValue,
} from "./document-content.mjs";

export async function parseFb2(bytes, filename, options = {}) {
  const doc = parseXml(bytes, "FictionBook");
  const info = xmlElements(doc, "title-info")[0];
  if (!info) throw new Error("No se encontró la descripción del FB2.");
  const authors = xmlElements(info, "author")
    .map(
      (author) =>
        ["first-name", "middle-name", "last-name"]
          .map((name) => xmlValue(author, name))
          .filter(Boolean)
          .join(" ") || xmlValue(author, "nickname"),
    )
    .filter(Boolean);
  const sequence = xmlElements(info, "sequence")[0];
  const position = sequence?.getAttribute("number");
  const metadata = {
    title: xmlValue(info, "book-title") || filename,
    author: authors.join(", "),
    language: xmlValue(info, "lang"),
    genres: xmlElements(info, "genre")
      .map((node) => node.textContent.trim())
      .filter(Boolean),
    series: sequence?.getAttribute("name") ?? "",
    seriesIndex:
      position?.trim() &&
      Number.isFinite(Number(position)) &&
      Number(position) >= 0
        ? Number(position)
        : null,
    cover: null,
  };
  const binary = new Map(
    xmlElements(doc, "binary").map((node) => [
      node.getAttribute("id"),
      {
        type: node.getAttribute("content-type"),
        data: node.textContent.replace(/\s/g, ""),
      },
    ]),
  );
  const references = new Map();
  const href = (node) =>
    [...node.attributes].find((attribute) => attribute.localName === "href")
      ?.value ?? "";
  const readImage = (id) => {
    const node = binary.get(id);
    if (!node) return null;
    try {
      const decoded = atob(node.data);
      return imageUri(
        Uint8Array.from(decoded, (character) => character.charCodeAt(0)),
        node.type,
      );
    } catch {
      return null;
    }
  };
  if (options.metadataOnly) {
    const cover = xmlElements(info, "coverpage")[0];
    const reference = cover && xmlElements(cover, "image")[0];
    metadata.cover = reference
      ? readImage(href(reference).replace(/^#/, ""))
      : null;
    return { ...metadata, chapters: [] };
  }
  const tags = {
    p: "p",
    section: "div",
    title: "h2",
    subtitle: "h3",
    epigraph: "blockquote",
    cite: "blockquote",
    poem: "blockquote",
    stanza: "div",
    v: "p",
    "text-author": "p",
    emphasis: "em",
    strong: "strong",
    strikethrough: "s",
    sub: "sub",
    sup: "sup",
    code: "code",
    a: "span",
    table: "table",
    tr: "tr",
    td: "td",
    th: "th",
  };
  function convert(node) {
    if (node.nodeType === Node.TEXT_NODE)
      return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE)
      return document.createDocumentFragment();
    if (node.localName === "empty-line") return document.createElement("br");
    if (node.localName === "image") {
      const id = href(node);
      if (!id.startsWith("#") || !binary.has(id.slice(1)))
        return document.createDocumentFragment();
      const reference = `#asset-${references.size}`;
      references.set(reference, id.slice(1));
      const image = document.createElement("img");
      image.setAttribute("src", reference);
      image.alt = node.getAttribute("alt") ?? "";
      return image;
    }
    if (!tags[node.localName]) return document.createDocumentFragment();
    const element = document.createElement(tags[node.localName]);
    if (["td", "th"].includes(node.localName))
      for (const name of ["colspan", "rowspan"])
        if (/^\d{1,3}$/.test(node.getAttribute(name) ?? ""))
          element.setAttribute(name, node.getAttribute(name));
    for (const child of node.childNodes) element.append(convert(child));
    return element;
  }
  const sections = [];
  const bodies = [...doc.documentElement.children].filter(
    (node) => node.localName === "body",
  );
  for (const [bodyIndex, body] of bodies.entries()) {
    for (const [index, node] of [...body.children].entries()) {
      const holder = document.createElement("div");
      holder.append(convert(node));
      const content = safeDocument(holder.innerHTML, { imageReferences: true });
      if (node.localName === "section") {
        if (
          content.content.textContent.trim() ||
          content.content.querySelector("img")
        )
          sections.push({
            id: `fb2-${bodyIndex + 1}-${index + 1}`,
            title: xmlValue(node, "title") || `Sección ${sections.length + 1}`,
            source: content.innerHTML,
          });
      } else
        sections.push(
          ...splitContent(content, `fb2-${bodyIndex + 1}-${index + 1}`),
        );
    }
  }
  return contentBook(metadata, sections, {
    ...options,
    resolveImage: (reference) => readImage(references.get(reference)),
    dispose() {
      binary.clear();
      references.clear();
    },
  });
}
