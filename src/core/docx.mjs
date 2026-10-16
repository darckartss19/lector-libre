import { zipSync } from "fflate";
import { archiveReader, imageType } from "./document-archive.mjs";
import {
  contentBook,
  parseXml,
  safeDocument,
  splitContent,
  xmlValue,
} from "./document-content.mjs";
import { readArchive } from "./archive-resource.mjs";

export async function parseDocx(bytes, filename, options = {}) {
  const archive = archiveReader(bytes);
  if (!archive.names.includes("word/document.xml")) {
    archive.dispose();
    throw new Error(
      "Este archivo no contiene un documento DOCX legible. Puede estar cifrado.",
    );
  }
  const coreBytes = archive.read("docProps/core.xml");
  const core = coreBytes ? parseXml(coreBytes, "coreProperties") : null;
  const metadata = {
    title: (core && xmlValue(core, "title")) || filename,
    author: (core && xmlValue(core, "creator")) || "",
    language: (core && xmlValue(core, "language")) || "",
    genres:
      core && xmlValue(core, "subject") ? [xmlValue(core, "subject")] : [],
    series: "",
    seriesIndex: null,
    cover: null,
  };
  if (options.metadataOnly) {
    const image = archive.names.find(
      (path) => path.startsWith("docProps/thumbnail.") && imageType(path),
    );
    if (image) metadata.cover = archive.image(image);
    archive.dispose();
    return { ...metadata, chapters: [] };
  }
  // Mammoth receives only bounded, normalized entries: ZIP name aliases and
  // parser differences cannot reintroduce an unverified compressed member.
  let verified;
  try {
    verified = zipSync(readArchive(bytes), { level: 0 });
  } catch (error) {
    archive.dispose();
    throw error;
  }
  // Mammoth preserves document structure, lists, tables and notes; image bytes are read on demand.
  const module = await import("mammoth/mammoth.browser.js");
  const mammoth = module.default ?? module;
  const images = new Map();
  const buffer = verified.buffer.slice(
    verified.byteOffset,
    verified.byteOffset + verified.byteLength,
  );
  let result;
  try {
    result = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      {
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement((image) => {
          if (!/^image\/(png|jpeg|gif|webp)$/.test(image.contentType))
            return {};
          const reference = `#asset-${images.size}`;
          images.set(reference, image);
          return { src: reference };
        }),
      },
    );
  } catch {
    archive.dispose();
    throw new Error(
      "No se pudo abrir el DOCX. Comprueba que el archivo no esté dañado ni cifrado.",
    );
  }
  archive.dispose();
  const content = safeDocument(result.value, { imageReferences: true });
  const sections = splitContent(content, "docx");
  return contentBook(metadata, sections, {
    ...options,
    async resolveImage(reference) {
      const image = images.get(reference);
      if (!image) return null;
      try {
        return `data:${image.contentType};base64,${await image.readAsBase64String()}`;
      } catch {
        return null;
      }
    },
    dispose() {
      images.clear();
    },
  });
}
