// Keep the reading window small; full-book tools receive temporary snapshots.
export function chapterCache(chapters, load, { limit = 4 } = {}) {
  const cache = new Map(),
    pending = new Map();
  let disposed = false,
    pinned = null;
  const ensureChapter = async (index) => {
    if (disposed) throw new Error("El libro ya está cerrado.");
    if (!chapters[index]) throw new Error("Capítulo no válido.");
    pinned = index;
    if (cache.has(index)) {
      const entry = cache.get(index);
      cache.delete(index);
      cache.set(index, entry);
      return entry;
    }
    if (pending.has(index)) return pending.get(index);
    const job = Promise.resolve()
      .then(() => load(index))
      .then((content) => {
        if (disposed) throw new Error("El libro ya está cerrado.");
        const entry = Object.assign(chapters[index], content);
        cache.set(index, entry);
        while (cache.size > limit) {
          const oldest = [...cache.keys()].find((key) => key !== pinned);
          cache.delete(oldest);
          delete chapters[oldest].text;
          delete chapters[oldest].html;
        }
        return entry;
      })
      .finally(() => pending.delete(index));
    pending.set(index, job);
    return job;
  };
  const allChapters = async ({ textOnly = false, onProgress } = {}) => {
    const result = [];
    for (let index = 0; index < chapters.length; index++) {
      if (disposed) throw new Error("El libro ya está cerrado.");
      const content = cache.get(index) ?? (await load(index, { textOnly }));
      result.push({
        id: chapters[index].id,
        title: content.title ?? chapters[index].title,
        text: content.text ?? "",
        ...(textOnly ? {} : { html: content.html ?? "" }),
      });
      onProgress?.(index + 1, chapters.length);
      if (index % 8 === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return result;
  };
  const visitChapters = async (visitor) => {
    for (let index = 0; index < chapters.length; index++) {
      if (disposed) throw new Error("El libro ya está cerrado.");
      const content =
        cache.get(index) ?? (await load(index, { textOnly: true }));
      if ((await visitor({ ...chapters[index], ...content }, index)) === false)
        break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return {
    ensureChapter,
    allChapters,
    visitChapters,
    isChapterLoaded: (index) => cache.has(index),
    loadedCount: () => cache.size,
    disposeChapters() {
      disposed = true;
      cache.clear();
      for (const ch of chapters) {
        delete ch.text;
        delete ch.html;
      }
    },
  };
}
