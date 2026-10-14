export function runtimePolicy({ mobile = false, deviceMemory = 8 } = {}) {
  const compact = mobile || deviceMemory <= 4;
  return Object.freeze({
    coverBytes: (compact ? 8 : 24) * 1024 * 1024,
    coverEntries: compact ? 24 : 72,
    spineEntries: compact ? 40 : 120,
    libraryPageSize: mobile ? 24 : 60,
    pdfPixels: compact ? 3_000_000 : 8_000_000,
  });
}
