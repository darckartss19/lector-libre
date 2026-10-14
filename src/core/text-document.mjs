import {
  contentBook,
  decodeText,
  localImage,
  safeDocument,
  splitContent,
} from "./document-content.mjs";

export async function parseTextDocument(bytes, format, filename, options = {}) {
  const text = decodeText(bytes);
  let html = text;
  const markdown = ["md", "markdown"].includes(format);
  if (markdown) {
    const { marked } = await import("marked");
    html = marked.parse(text, { async: false });
  }
  // Template parsing is inert: metadata inspection cannot load referenced images or execute scripts.
  const raw = document.createElement("template");
  raw.innerHTML = html;
  const meta = (name) =>
    raw.content
      .querySelector(`meta[name="${name}"]`)
      ?.getAttribute("content")
      ?.trim() ?? "";
  const title =
    raw.content.querySelector("title")?.textContent?.trim() ||
    raw.content.querySelector("h1")?.textContent?.trim() ||
    filename;
  const metadata = {
    title,
    author: meta("author"),
    language:
      meta("language") ||
      (markdown
        ? ""
        : (text.match(/<html[^>]+\blang\s*=\s*["']([^"']+)/i)?.[1] ?? "")),
    genres: meta("keywords")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    series: "",
    seriesIndex: null,
    cover: null,
  };
  const template = safeDocument(html);
  if (options.metadataOnly) {
    const image = template.content.querySelector("img")?.getAttribute("src");
    metadata.cover = localImage(image) ? image : null;
    return { ...metadata, chapters: [] };
  }
  return contentBook(
    metadata,
    splitContent(template, markdown ? "markdown" : "html"),
    options,
  );
}
