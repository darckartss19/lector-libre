import {
  archiveReader,
  imageType,
  safeArchivePath,
} from "./document-archive.mjs";
import { chapterCache } from "./chapter-cache.mjs";
import { parseXml, xmlValue } from "./document-content.mjs";

const pageOrder = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "variant",
});

export async function parseComic(bytes, filename, options = {}) {
  const archive = archiveReader(bytes);
  const pages = archive.names
    .filter(
      (path) =>
        safeArchivePath(path) &&
        imageType(path) &&
        !path.startsWith("__MACOSX/") &&
        !path.split("/").some((part) => part.startsWith(".")),
    )
    .sort(pageOrder.compare);
  if (!pages.length) {
    archive.dispose();
    throw new Error("El CBZ no contiene páginas en PNG, JPEG, GIF o WebP.");
  }
  const infoBytes = archive.read("ComicInfo.xml");
  let info = null;
  if (infoBytes) {
    try {
      info = parseXml(infoBytes, "ComicInfo");
    } catch {
      /* Optional catalog metadata must not prevent image reading. */
    }
  }
  const number = info && xmlValue(info, "Number");
  const metadata = {
    title: (info && xmlValue(info, "Title")) || filename,
    author: (info && xmlValue(info, "Writer")) || "",
    language: (info && xmlValue(info, "LanguageISO")) || "",
    genres: info
      ? xmlValue(info, "Genre")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    series: (info && xmlValue(info, "Series")) || "",
    seriesIndex:
      number && Number.isFinite(Number(number)) && Number(number) >= 0
        ? Number(number)
        : null,
    cover: null,
    imageBook: true,
    hasText: false,
  };
  if (options.metadataOnly) {
    metadata.cover = archive.image(pages[0]);
    archive.dispose();
    return { ...metadata, chapters: [] };
  }
  const chapters = pages.map((path, index) => ({
    id: `cbz-${path}`,
    title: `Página ${index + 1}`,
  }));
  const load = (index, { textOnly = false } = {}) => {
    const image = textOnly ? null : archive.image(pages[index]);
    return {
      text: "",
      html: image
        ? `<figure><img src="${image}" alt="Página ${index + 1}"></figure>`
        : "",
    };
  };
  if (!options.lazy) {
    chapters.forEach((chapter, index) => Object.assign(chapter, load(index)));
    archive.dispose();
    return { ...metadata, chapters };
  }
  const cache = chapterCache(chapters, load);
  return {
    ...metadata,
    chapters,
    ...cache,
    async dispose() {
      cache.disposeChapters();
      archive.dispose();
    },
  };
}
