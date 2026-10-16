import { Inflate, strFromU8 } from "fflate";
import { imageUri } from "./document-content.mjs";

const MiB = 1024 * 1024;
const KiB = 1024;
const DEFAULT_PER_ENTRY = 64 * MiB;
const DEFAULT_PER_OPERATION = 128 * MiB;
const INPUT_CHUNK = 4 * KiB;
const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SCAN = 65558;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;

export class ArchiveResourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArchiveResourceError";
  }
}

function readU16(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
}
function readU32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}
function readU64(bytes, offset) {
  const low = readU32(bytes, offset);
  const high = readU32(bytes, offset + 4);
  if (high > 0x1fffff) return Number.POSITIVE_INFINITY;
  return high * 0x100000000 + low;
}

function requireBytes(bytes, offset, length, what) {
  if (offset < 0 || offset + length > bytes.length) {
    throw new ArchiveResourceError(
      `El archivo ZIP está truncado o dañado (${what}).`,
    );
  }
}

// Lee el registro de fin de directorio central ZIP64 cuando los campos del
// EOCD de 32 bits usan el centinela 0xFFFF/0xFFFFFFFF. Devuelve los recuentos
// y tamaños reales de 64 bits sin imponer un límite de 65535 entradas.
function readZip64EndOfCentralDirectory(bytes, eocd) {
  let zip64EocdOffset = -1;
  const locatorOffset = eocd - 20;
  if (
    locatorOffset >= 0 &&
    readU32(bytes, locatorOffset) === ZIP64_LOCATOR_SIG
  ) {
    requireBytes(bytes, locatorOffset, 20, "localizador ZIP64");
    zip64EocdOffset = readU64(bytes, locatorOffset + 8);
  } else {
    for (let e = eocd - 2; e >= 0; e--) {
      if (readU32(bytes, e) === ZIP64_EOCD_SIG) {
        zip64EocdOffset = e;
        break;
      }
    }
  }
  if (zip64EocdOffset === -1 || zip64EocdOffset + 56 > bytes.length) {
    throw new ArchiveResourceError("Directorio ZIP ZIP64 no válido.");
  }
  if (readU32(bytes, zip64EocdOffset) !== ZIP64_EOCD_SIG) {
    throw new ArchiveResourceError("Directorio ZIP ZIP64 no válido.");
  }
  return {
    totalEntries: readU64(bytes, zip64EocdOffset + 32),
    centralSize: readU64(bytes, zip64EocdOffset + 40),
    centralOffset: readU64(bytes, zip64EocdOffset + 48),
  };
}

// Lee el campo ZIP64 extra (tag 0x0001) para los tamaños cuyo marcador de 32
// bits es 0xFFFFFFFF.
function readZip64Extra(bytes, start, length, csize, usize, loffset) {
  let p = start;
  const end = start + length;
  while (p + 4 <= end) {
    const tag = readU16(bytes, p);
    const size = readU16(bytes, p + 2);
    p += 4;
    if (p + size > end) break;
    if (tag === 0x0001) {
      const data = bytes.subarray(p, p + size);
      let q = 0;
      const read64 = () => {
        const value = readU64(data, q);
        q += 8;
        return value;
      };
      if (usize === 0xffffffff) usize = read64();
      if (csize === 0xffffffff) csize = read64();
      if (loffset === 0xffffffff) loffset = read64();
    }
    p += size;
  }
  return { compressedSize: csize, originalSize: usize, localOffset: loffset };
}

// Inventa el directorio central sin descomprimir miembros. Valida firmas,
// límites y marcas ZIP64, y descodifica nombres según la bandera UTF-8 como
// hace fflate (UTF-8 cuando el bit 11 de la bandera está activo, CP437/latin1
// en otro caso).
function readCentralDirectory(bytes) {
  if (bytes.length < 22) {
    throw new ArchiveResourceError("Directorio ZIP no válido.");
  }
  let endSearch = bytes.length - CENTRAL_SCAN;
  if (endSearch < 0) endSearch = 0;
  let eocd = -1;
  for (let e = bytes.length - 22; e >= endSearch; e--) {
    if (readU32(bytes, e) === EOCD_SIG) {
      eocd = e;
      break;
    }
  }
  if (eocd === -1) {
    throw new ArchiveResourceError("Directorio ZIP no válido.");
  }
  requireBytes(bytes, eocd, 22, "EOCD");
  const disk = readU16(bytes, eocd + 4);
  const diskCd = readU16(bytes, eocd + 6);
  const entriesOnDisk = readU16(bytes, eocd + 8);
  let totalEntries = readU16(bytes, eocd + 10);
  let centralSize = readU32(bytes, eocd + 12);
  let centralOffset = readU32(bytes, eocd + 16);
  const commentLength = readU16(bytes, eocd + 20);
  requireBytes(bytes, eocd + 22, commentLength, "comentario EOCD");
  if (eocd + 22 + commentLength !== bytes.length) {
    throw new ArchiveResourceError("Directorio ZIP no válido.");
  }
  const zip64 =
    ((entriesOnDisk === 0xffff || totalEntries === 0xffff) &&
      eocd >= 20 &&
      readU32(bytes, eocd - 20) === ZIP64_LOCATOR_SIG) ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
      ? readZip64EndOfCentralDirectory(bytes, eocd)
      : null;
  if (zip64) {
    totalEntries = zip64.totalEntries;
    centralSize = zip64.centralSize;
    centralOffset = zip64.centralOffset;
  }
  if (disk !== 0 || diskCd !== 0) {
    throw new ArchiveResourceError("Archivos ZIP spanned no soportados.");
  }
  requireBytes(bytes, centralOffset, Number(centralSize), "directorio central");
  const entries = [];
  let p = centralOffset;
  const end = centralOffset + Number(centralSize);
  for (let i = 0; i < totalEntries; i++) {
    requireBytes(bytes, p, 46, "cabecera central");
    if (readU32(bytes, p) !== CENTRAL_SIG) {
      throw new ArchiveResourceError("Directorio ZIP no válido.");
    }
    const flag = readU16(bytes, p + 8);
    const compression = readU16(bytes, p + 10);
    let compressedSize = readU32(bytes, p + 20);
    let originalSize = readU32(bytes, p + 24);
    const filenameLength = readU16(bytes, p + 28);
    const extraLength = readU16(bytes, p + 30);
    const commentLength2 = readU16(bytes, p + 32);
    const localOffset = readU32(bytes, p + 42);
    const nameStart = p + 46;
    requireBytes(
      bytes,
      nameStart,
      filenameLength + extraLength + commentLength2,
      "nombre central",
    );
    const utf8 = (flag & FLAG_UTF8) !== 0;
    const name = strFromU8(
      bytes.subarray(nameStart, nameStart + filenameLength),
      !utf8,
    );
    const extraStart = nameStart + filenameLength;
    if (
      compressedSize === 0xffffffff ||
      originalSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      const sizes = readZip64Extra(
        bytes,
        extraStart,
        extraLength,
        compressedSize,
        originalSize,
        localOffset,
      );
      compressedSize = sizes.compressedSize;
      originalSize = sizes.originalSize;
    }
    entries.push({
      name,
      compression,
      flag,
      compressedSize,
      originalSize,
      localOffset:
        localOffset === 0xffffffff
          ? readZip64Extra(
              bytes,
              extraStart,
              extraLength,
              readU32(bytes, p + 20),
              readU32(bytes, p + 24),
              localOffset,
            ).localOffset
          : Number(localOffset),
    });
    p = nameStart + filenameLength + extraLength + commentLength2;
    if (p > end) {
      throw new ArchiveResourceError("Directorio ZIP no válido.");
    }
  }
  if (p !== end) {
    throw new ArchiveResourceError("Directorio ZIP no válido.");
  }
  return entries;
}

function charge(budget, entry, bytesLength) {
  if (bytesLength > budget.perEntry) {
    throw new ArchiveResourceError(
      `La entrada «${entry.name}» excede el límite de descompresión por recurso.`,
    );
  }
  if (budget.used + bytesLength > budget.perOperation) {
    throw new ArchiveResourceError(
      "El archivo excede el presupuesto de descompresión de la operación.",
    );
  }
  budget.used += bytesLength;
}

function merge(chunks, produced) {
  const out = new Uint8Array(produced);
  let o = 0;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}

// Despliega un miembro del archivo comprimiendo de forma acotada y validando
// el tamaño declarado contra el tamaño real obtenido. Rechaza antes de
// descomprimir cualquier tamaño declarado obviamente excesivo.
function inflateMember(bytes, entry, budget) {
  const start = entry.localOffset;
  requireBytes(bytes, start, 30, "cabecera local");
  if (readU32(bytes, start) !== LOCAL_SIG) {
    throw new ArchiveResourceError(
      `La entrada «${entry.name}» tiene un encabezado local dañado.`,
    );
  }
  const flag = readU16(bytes, start + 6);
  if (flag & FLAG_ENCRYPTED) {
    throw new ArchiveResourceError(
      `La entrada «${entry.name}» está cifrada y no es soportada.`,
    );
  }
  const compression = readU16(bytes, start + 8);
  if (compression !== entry.compression)
    throw new ArchiveResourceError(
      "El método ZIP local no coincide con el directorio.",
    );
  const filenameLength = readU16(bytes, start + 26);
  const extraLength = readU16(bytes, start + 28);
  const dataStart = start + 30 + filenameLength + extraLength;
  if (compression === 0) {
    requireBytes(bytes, dataStart, entry.compressedSize, "datos almacenados");
    if (entry.originalSize !== entry.compressedSize) {
      throw new ArchiveResourceError(
        `La entrada «${entry.name}» declara un tamaño que no coincide con el contenido descomprimido.`,
      );
    }
    charge(budget, entry, entry.compressedSize);
    return bytes.subarray(dataStart, dataStart + entry.compressedSize);
  }
  if (compression !== 8) {
    throw new ArchiveResourceError(
      `La entrada «${entry.name}» usa un método de compresión no soportado.`,
    );
  }
  requireBytes(bytes, dataStart, entry.compressedSize, "datos comprimidos");
  if (entry.originalSize > budget.perEntry) {
    throw new ArchiveResourceError(
      `La entrada «${entry.name}» excede el límite de descompresión por recurso.`,
    );
  }
  if (budget.used + entry.originalSize > budget.perOperation) {
    throw new ArchiveResourceError(
      "El archivo excede el presupuesto de descompresión de la operación.",
    );
  }
  const compressed = bytes.subarray(
    dataStart,
    dataStart + entry.compressedSize,
  );
  if (!compressed.length)
    throw new ArchiveResourceError(
      "La entrada ZIP comprimida está vacía o dañada.",
    );
  const chunks = [];
  let produced = 0;
  const inflator = new Inflate((dat, final) => {
    if (dat.length) {
      if (produced + dat.length > budget.perEntry) {
        throw new ArchiveResourceError(
          `La entrada «${entry.name}» excede el límite de descompresión por recurso.`,
        );
      }
      if (budget.used + produced + dat.length > budget.perOperation) {
        throw new ArchiveResourceError(
          "El archivo excede el presupuesto de descompresión de la operación.",
        );
      }
      chunks.push(dat);
      produced += dat.length;
    }
    if (
      final &&
      entry.originalSize !== undefined &&
      produced !== entry.originalSize
    ) {
      throw new ArchiveResourceError(
        `La entrada «${entry.name}» declara un tamaño que no coincide con el contenido descomprimido.`,
      );
    }
  });
  for (let i = 0; i < compressed.length; i += INPUT_CHUNK) {
    inflator.push(
      compressed.subarray(i, i + INPUT_CHUNK),
      i + INPUT_CHUNK >= compressed.length,
    );
  }
  charge(budget, entry, produced);
  return chunks.length === 0 ? new Uint8Array(0) : merge(chunks, produced);
}

// Extrae los miembros seleccionados de un archivo ZIP acotando los bytes
// reales descomprimidos por entrada y por operación. Rechaza nombres de ruta
// inseguros y nombres duplicados; nunca asigna basándose solo en el tamaño
// declarado del encabezado.
export function createArchiveBudget({
  perEntry = DEFAULT_PER_ENTRY,
  perOperation = DEFAULT_PER_OPERATION,
} = {}) {
  return { used: 0, perEntry, perOperation };
}
export function readZipMembers(bytes, options = {}) {
  const { filter = () => true, budget = createArchiveBudget(options) } =
    options;
  const entries = readCentralDirectory(bytes);
  const files = new Map();
  const seen = new Set();
  for (const entry of entries) {
    // Los nombres duplicados se rechazan en todo el archivo, incluso si están
    // fuera del filtro o no son rutas seguras, para evitar dobles
    // descompresiones o aliases que esquiven la validación.
    if (seen.has(entry.name)) {
      throw new ArchiveResourceError(
        `La entrada ZIP «${entry.name}» está duplicada.`,
      );
    }
    seen.add(entry.name);
    if (!safeArchivePath(entry.name)) continue;
    if (!filter(entry)) continue;
    files.set(entry.name, inflateMember(bytes, entry, budget));
  }
  return files;
}

export function readArchive(bytes, options = {}) {
  return Object.fromEntries(readZipMembers(bytes, options));
}

export function safeArchivePath(path) {
  return (
    typeof path === "string" &&
    !/^[a-z][a-z\d+.-]*:|^[/\\]|\\|\0/i.test(path) &&
    path.split("/").every((part) => part !== ".." && part !== ".")
  );
}

export function imageType(path) {
  const extension = String(path).split(".").pop().toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    }[extension] ?? ""
  );
}

export function archiveReader(bytes, options = {}) {
  const { perEntry = DEFAULT_PER_ENTRY, perOperation = DEFAULT_PER_OPERATION } =
    options;
  const entries = readCentralDirectory(bytes);
  const names = [];
  const available = new Set();
  const offsets = new Map();
  const seen = new Set();
  for (const entry of entries) {
    // Los nombres duplicados se rechazan en todo el archivo.
    if (seen.has(entry.name)) {
      throw new ArchiveResourceError(
        `La entrada ZIP «${entry.name}» está duplicada.`,
      );
    }
    seen.add(entry.name);
    if (!safeArchivePath(entry.name)) continue;
    names.push(entry.name);
    available.add(entry.name);
    offsets.set(entry.name, entry);
  }
  let buffer = bytes;
  return {
    names,
    read(
      path,
      { budget = createArchiveBudget({ perEntry, perOperation }) } = {},
    ) {
      if (!buffer) throw new Error("El libro ya está cerrado.");
      if (!available.has(path)) return null;
      const entry = offsets.get(path);
      if (!entry) return null;
      return inflateMember(buffer, entry, budget);
    },
    image(path, context) {
      return imageUri(this.read(path, context), imageType(path));
    },
    dispose() {
      buffer = null;
    },
  };
}
