import { isLocalCover } from "./spines.mjs";
async function thumbnail(cover) {
  if (!isLocalCover(cover) || cover.length < 4096) return cover;
  let bitmap;
  let canvas;
  try {
    const comma = cover.indexOf(",");
    const decoded = atob(cover.slice(comma + 1));
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    bitmap = await createImageBitmap(new Blob([bytes]), {
      resizeWidth: 128,
      resizeHeight: 192,
      resizeQuality: "high",
    });
    canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 192;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, 128, 192);
    return canvas.toDataURL("image/webp", 0.7);
  } catch {
    // A broken image must not block progress synchronization. Only the wire
    // preview is omitted; the full local cover and original EPUB stay intact.
    return null;
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
export class CloudSnapshot {
  #covers = new Map();
  constructor(encodeCover = thumbnail, resolveCover = (value) => value) {
    this.encodeCover = encodeCover;
    this.resolveCover = resolveCover;
  }
  async create(library) {
    const known = new Set(library.books.map((book) => book.id));
    for (const id of this.#covers.keys())
      if (!known.has(id)) this.#covers.delete(id);
    const covers = new Map();
    for (const book of library.books) {
      let cached = this.#covers.get(book.id);
      if (!cached || cached.original !== book.cover) {
        cached = {
          original: book.cover,
          preview: await this.encodeCover(await this.resolveCover(book.cover)),
        };
        this.#covers.set(book.id, cached);
      }
      covers.set(book.id, cached);
    }
    const registers = Object.fromEntries(
      await Promise.all(
        Object.entries(library.registers ?? {}).map(async ([key, record]) => {
          const [id, field] = JSON.parse(key);
          const cached = covers.get(id);
          return [
            key,
            field === "cover" && cached && record.value === cached.original
              ? { ...record, value: cached.preview }
              : field === "cover" &&
                  typeof record.value === "string" &&
                  record.value.startsWith("@lector-cover:")
                ? {
                    ...record,
                    value: await this.encodeCover(
                      await this.resolveCover(record.value),
                    ),
                  }
                : record,
          ];
        }),
      ),
    );
    return {
      ...library,
      books: library.books.map((book) => ({
        ...book,
        cover: covers.get(book.id).preview,
      })),
      registers,
    };
  }
}
