import { parseBook } from "./epub.mjs";
import { READABLE_FORMATS } from "./document-formats.mjs";

// PDF code and its worker are loaded only when opening or importing a PDF.
export async function parseDocument(bytes, format, filename, options = {}) {
  if (format === "pdf") {
    const { parsePdf } = await import("./pdf.mjs");
    return parsePdf(bytes, filename, options);
  }
  if (!READABLE_FORMATS.has(format))
    throw new Error("Este formato todavía no se puede leer.");
  if (["epub", "txt"].includes(format))
    return parseBook(bytes, format, filename, options);
  const adapters = {
    fb2: () => import("./fb2.mjs"),
    docx: () => import("./docx.mjs"),
    odt: () => import("./odt.mjs"),
    cbz: () => import("./comic.mjs"),
  };
  if (adapters[format]) {
    const module = await adapters[format]();
    const parser = {
      fb2: module.parseFb2,
      docx: module.parseDocx,
      odt: module.parseOdt,
      cbz: module.parseComic,
    }[format];
    return parser(bytes, filename, options);
  }
  const { parseTextDocument } = await import("./text-document.mjs");
  return parseTextDocument(bytes, format, filename, options);
}
