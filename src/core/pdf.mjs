import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  TextLayer,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { chapterCache } from "./chapter-cache.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { pdfPageText, pdfPageIds, pdfTextHtml } from "./pdf-text.mjs";

GlobalWorkerOptions.workerSrc = workerUrl;
const baseMetadata = (filename) => ({
  title: filename || "PDF",
  author: "",
  language: "",
  genres: [],
  series: "",
  seriesIndex: null,
  cover: null,
  chapters: [],
});

export async function parsePdf(
  bytes,
  filename,
  { metadataOnly = false, requestPassword, onProgress, lazy = false } = {},
) {
  const task = getDocument({
    data: bytes,
    cMapUrl: new URL("pdfjs/cmaps/", document.baseURI).href,
    standardFontDataUrl: new URL("pdfjs/standard_fonts/", document.baseURI)
      .href,
    wasmUrl: new URL("pdfjs/wasm/", document.baseURI).href,
    iccUrl: new URL("pdfjs/iccs/", document.baseURI).href,
    cMapPacked: true,
    isEvalSupported: false,
    enableXfa: false,
    verbosity: 0,
  });
  // The PDF password is used only in this loading task and never stored/synced.
  if (!metadataOnly && requestPassword)
    task.onPassword = (update, reason) => {
      Promise.resolve(
        requestPassword(reason === PasswordResponses.INCORRECT_PASSWORD),
      )
        .then((password) => {
          if (password === null) return task.destroy();
          update(password);
        })
        .catch(() => task.destroy());
    };
  let pdf;
  try {
    pdf = await task.promise;
    const { info = {}, metadata } = await pdf.getMetadata();
    const result = baseMetadata(filename);
    const title = metadata?.get("dc:title") || info.Title;
    if (
      typeof title === "string" &&
      title.trim() &&
      title.toLowerCase() !== "untitled"
    )
      result.title = title.trim();
    const author = metadata?.get("dc:creator") || info.Author;
    result.author = Array.isArray(author)
      ? author.join(", ")
      : typeof author === "string"
        ? author.trim()
        : "";
    const language = metadata?.get("dc:language") || info.Language || "";
    const declaredLanguage = Array.isArray(language) ? language[0] : language;
    if (
      typeof declaredLanguage === "string" &&
      declaredLanguage.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(declaredLanguage)
    )
      result.language = declaredLanguage;
    result.genres =
      typeof info.Keywords === "string"
        ? info.Keywords.split(/[,;]+/)
            .map((word) => word.trim())
            .filter(Boolean)
        : [];
    const first = await pdf.getPage(1);
    if (metadataOnly || !lazy) {
      const viewport = first.getViewport({ scale: 1 });
      const coverViewport = first.getViewport({
        scale: Math.min(240 / viewport.width, 360 / viewport.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(coverViewport.width));
      canvas.height = Math.max(1, Math.ceil(coverViewport.height));
      await first.render({
        canvas,
        canvasContext: canvas.getContext("2d"),
        viewport: coverViewport,
        background: "rgb(255,255,255)",
      }).promise;
      result.cover = canvas.toDataURL("image/webp", 0.82);
      canvas.width = canvas.height = 0;
    }
    const firstContent = await first.getTextContent();
    if (
      !result.language &&
      typeof firstContent.lang === "string" &&
      firstContent.lang.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(firstContent.lang)
    )
      result.language = firstContent.lang;
    if (metadataOnly) {
      await task.destroy();
      return result;
    }
    const labels = await pdf.getPageLabels();
    const chapters = pdfPageIds(pdf.numPages, labels ?? []);
    if (lazy) {
      let disposed = false;
      const cache = chapterCache(chapters, async (index) => {
        const page = await pdf.getPage(index + 1);
        const content =
          index === 0 ? firstContent : await page.getTextContent();
        const text = pdfPageText(content);
        page.cleanup();
        return { text, html: pdfTextHtml(text) };
      });
      return {
        ...result,
        chapters,
        ...cache,
        pdfDocument: pdf,
        // Unknown until all pages are checked; a scanned first page may precede text.
        hasText: firstContent.items.some((item) => item.str?.trim())
          ? true
          : null,
        async detectText() {
          if (firstContent.items.some((item) => item.str?.trim())) return true;
          for (let index = 1; index < pdf.numPages; index++) {
            if (disposed) return null;
            const page = await pdf.getPage(index + 1);
            const content = await page.getTextContent();
            page.cleanup();
            if (content.items.some((item) => item.str?.trim())) return true;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          return false;
        },
        textLayerFactory: (page, container, viewport) =>
          new TextLayer({
            textContentSource: page.streamTextContent(),
            container,
            viewport,
          }),
        async dispose() {
          disposed = true;
          cache.disposeChapters();
          await task.destroy();
        },
      };
    }
    for (const chapter of chapters) {
      const page = await pdf.getPage(chapter.pageNumber);
      const content =
        chapter.pageNumber === 1 ? firstContent : await page.getTextContent();
      chapter.text = pdfPageText(content);
      chapter.html = pdfTextHtml(chapter.text);
      page.cleanup();
      onProgress?.(chapter.pageNumber, pdf.numPages);
      if (chapter.pageNumber % 8 === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return {
      ...result,
      chapters,
      pdfDocument: pdf,
      textLayerFactory: (page, container, viewport) =>
        new TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport,
        }),
      hasText: chapters.some((chapter) => chapter.text.trim()),
    };
  } catch (error) {
    await task.destroy().catch(() => {});
    if (metadataOnly && error.name === "PasswordException")
      return baseMetadata(filename);
    if (error.name === "PasswordException")
      throw new Error("El PDF necesita una contraseña válida.");
    if (/destroyed|cancelled/i.test(error.message))
      throw new Error("Se canceló la apertura del PDF.");
    throw new Error(
      "No se pudo leer el PDF. Puede estar dañado o no ser un PDF válido.",
    );
  }
}
