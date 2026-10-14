// Position and bounded text requests. The native service, rather than a reader
// screen, owns this queue. No audio file is generated or retained here.
export function speechChunk(text, offset = 0, maxChars = 1500) {
  if (
    typeof text !== "string" ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > text.length
  )
    throw new TypeError("Texto o posición no válidos.");
  if (!Number.isSafeInteger(maxChars) || maxChars < 2)
    throw new TypeError("El tamaño del fragmento no es válido.");
  // Offsets use UTF-16, like JS strings and the native Windows speech callbacks.
  if (
    offset > 0 &&
    /[\uDC00-\uDFFF]/u.test(text[offset]) &&
    /[\uD800-\uDBFF]/u.test(text[offset - 1])
  )
    offset--;
  let start = offset;
  while (start < text.length && /\s/u.test(text[start])) start++;
  if (start === text.length) return null;
  let end = Math.min(start + maxChars, text.length);
  if (end < text.length) {
    if (
      /[\uD800-\uDBFF]/u.test(text[end - 1]) &&
      /[\uDC00-\uDFFF]/u.test(text[end])
    )
      end--;
    const candidate = text.slice(start, end);
    // Prefer sentence/paragraph boundaries, then a word boundary. Extremely
    // long unbroken words are still bounded by the native engine input limit.
    const sentences = [...candidate.matchAll(/[.!?…](?:["»”’])?\s+|\n+/gu)];
    const sentence = sentences.at(-1);
    if (sentence && sentence.index + sentence[0].length > candidate.length / 2)
      end = start + sentence.index + sentence[0].length;
    else {
      const spaces = [...candidate.matchAll(/\s+/gu)];
      const space = spaces.at(-1);
      if (space && space.index > candidate.length / 2)
        end = start + space.index + space[0].length;
    }
  }
  return { text: text.slice(start, end), start, end };
}

function checkedOffset(text, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    throw new TypeError("Posición de voz no válida.");
  // A saved or selected position can land between the two halves of an emoji.
  return offset > 0 &&
    /[\uDC00-\uDFFF]/u.test(text[offset]) &&
    /[\uD800-\uDBFF]/u.test(text[offset - 1])
    ? offset - 1
    : offset;
}

/** Fragments for navigation are sentences or paragraphs, rather than seconds. */
export function speechFragmentStarts(text) {
  if (typeof text !== "string") throw new TypeError("Texto de voz no válido.");
  const starts = [];
  const add = (offset) => {
    while (offset < text.length && /\s/u.test(text[offset])) offset++;
    if (offset < text.length && starts.at(-1) !== offset) starts.push(offset);
  };
  add(0);
  for (const boundary of text.matchAll(/[.!?…]+(?:["»”’')\]]+)?\s+|\r?\n+/gu))
    add(boundary.index + boundary[0].length);
  return starts;
}

export class SpeechQueue {
  constructor({ bookId, chapters, voice, rate = 1, position = null }) {
    if (
      typeof bookId !== "string" ||
      !bookId.trim() ||
      typeof voice !== "string" ||
      !voice.trim()
    )
      throw new TypeError("Falta el libro o la voz.");
    if (
      !Array.isArray(chapters) ||
      !chapters.length ||
      chapters.some(
        (ch) =>
          !ch ||
          typeof ch.id !== "string" ||
          !ch.id ||
          typeof ch.text !== "string",
      ) ||
      new Set(chapters.map((ch) => ch.id)).size !== chapters.length
    )
      throw new TypeError("Capítulos no válidos.");
    if (!Number.isFinite(rate) || rate <= 0)
      throw new TypeError("Velocidad no válida.");
    this.bookId = bookId;
    this.chapters = structuredClone(chapters);
    this.voice = voice;
    this.rate = rate;
    this.index = 0;
    this.offset = 0;
    this.status = "idle";
    this.active = null;
    this.serial = 0;
    this.sessionId = globalThis.crypto.randomUUID();
    this.fragmentStarts = new Map();
    if (position) {
      this.index = this.chapters.findIndex((ch) => ch.id === position.chapter);
      if (
        this.index < 0 ||
        !Number.isSafeInteger(position.offset) ||
        position.offset < 0 ||
        position.offset > this.chapters[this.index].text.length
      )
        throw new TypeError("Posición guardada no válida.");
      this.offset = checkedOffset(
        this.chapters[this.index].text,
        position.offset,
      );
    }
  }

  next(maxChars = 1500) {
    if (this.active) return structuredClone(this.active);
    let chunk = null;
    while (this.index < this.chapters.length) {
      chunk = speechChunk(
        this.chapters[this.index].text,
        this.offset,
        maxChars,
      );
      if (chunk) break;
      if (this.index === this.chapters.length - 1) {
        this.offset = this.chapters[this.index].text.length;
        this.status = "finished";
        return null;
      }
      this.index++;
      this.offset = 0;
    }
    this.offset = chunk.start;
    this.status = "playing";
    this.active = {
      id: this.bookId + ":" + this.sessionId + ":" + ++this.serial,
      chapter: this.chapters[this.index].id,
      ...chunk,
      voice: this.voice,
      rate: this.rate,
    };
    return structuredClone(this.active);
  }

  progress(id, relativeOffset) {
    if (!this.active || this.active.id !== id || this.status !== "playing")
      return false;
    if (
      !Number.isSafeInteger(relativeOffset) ||
      relativeOffset < 0 ||
      relativeOffset > this.active.text.length
    )
      throw new TypeError("Progreso de voz no válido.");
    // Save the current word start, so resuming can repeat a word but cannot
    // silently skip the remainder of an unfinished phrase.
    this.offset = Math.max(
      this.offset,
      checkedOffset(
        this.chapters[this.index].text,
        this.active.start + relativeOffset,
      ),
    );
    return true;
  }

  complete(id, { cancelled = false, error = null } = {}) {
    if (!this.active || this.active.id !== id) return false;
    if (!cancelled && !error) this.offset = this.active.end;
    this.active = null;
    this.status = error ? "error" : cancelled ? "paused" : "idle";
    return true;
  }

  pause() {
    this.active = null;
    this.status = "paused";
    return this.checkpoint();
  }

  /** The caller cancels the native motor before starting audio at this position. */
  seek(position) {
    const index = this.chapters.findIndex((ch) => ch.id === position?.chapter);
    if (index < 0) throw new TypeError("Capítulo de voz no válido.");
    const offset = checkedOffset(this.chapters[index].text, position.offset);
    // Clearing active invalidates callbacks already queued by a cancelled motor.
    this.active = null;
    this.index = index;
    this.offset = offset;
    this.status = "paused";
    return this.checkpoint();
  }

  skipFragment(direction) {
    if (direction !== -1 && direction !== 1)
      throw new TypeError("Dirección de voz no válida.");
    for (
      let index = this.index;
      index >= 0 && index < this.chapters.length;
      index += direction
    ) {
      const chapter = this.chapters[index];
      if (!this.fragmentStarts.has(chapter.id))
        this.fragmentStarts.set(chapter.id, speechFragmentStarts(chapter.text));
      const starts = this.fragmentStarts.get(chapter.id);
      const offset =
        index === this.index
          ? this.offset
          : direction === 1
            ? -1
            : chapter.text.length;
      const target =
        direction === 1
          ? starts.find((start) => start > offset)
          : starts.findLast((start) => start < offset);
      if (target !== undefined)
        return this.seek({ chapter: chapter.id, offset: target });
    }
    // At either edge leave a stable checkpoint, including books of empty chapters.
    const edge = direction === 1 ? this.chapters.at(-1) : this.chapters[0];
    return this.seek({
      chapter: edge.id,
      offset: direction === 1 ? edge.text.length : 0,
    });
  }

  previousFragment() {
    return this.skipFragment(-1);
  }

  nextFragment() {
    return this.skipFragment(1);
  }

  checkpoint() {
    return {
      chapter: this.chapters[this.index].id,
      offset: this.offset,
      voice: this.voice,
      rate: this.rate,
    };
  }
}
