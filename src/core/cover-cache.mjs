export const coverHash = (value) =>
  typeof value === "string" && /^@lector-cover:[a-f0-9]{64}$/.test(value)
    ? value.slice(14)
    : null;
export class CoverCache {
  constructor(read, { maxBytes = 24 * 1024 * 1024, maxEntries = 72 } = {}) {
    this.read = read;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.pending = new Map();
    this.bytes = 0;
  }
  async original(value) {
    return coverHash(value) ? this.read(coverHash(value)) : value;
  }
  async url(value) {
    if (!coverHash(value)) return value;
    if (this.entries.has(value)) {
      const entry = this.entries.get(value);
      this.entries.delete(value);
      this.entries.set(value, entry);
      return entry.url;
    }
    if (this.pending.has(value)) return this.pending.get(value);
    const job = this.original(value)
      .then((data) => {
        const match =
          /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(
            data,
          );
        if (!match) throw new Error("Portada local no válida.");
        const raw = atob(match[2]),
          bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
        const entry = {
          url: URL.createObjectURL(new Blob([bytes], { type: match[1] })),
          size: bytes.length,
        };
        this.entries.set(value, entry);
        this.bytes += entry.size;
        while (
          this.entries.size > 1 &&
          (this.entries.size > this.maxEntries || this.bytes > this.maxBytes)
        ) {
          const key = this.entries.keys().next().value,
            old = this.entries.get(key);
          URL.revokeObjectURL(old.url);
          this.bytes -= old.size;
          this.entries.delete(key);
        }
        return entry.url;
      })
      .finally(() => this.pending.delete(value));
    this.pending.set(value, job);
    return job;
  }
  clear() {
    for (const entry of this.entries.values()) URL.revokeObjectURL(entry.url);
    this.entries.clear();
    this.bytes = 0;
  }
}
