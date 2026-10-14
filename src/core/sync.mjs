// Each device writes its own immutable-versioned field registers. A lower
// reading percentage can be newer: rereading must survive synchronization.
import {
  createLibrary,
  importLibrary,
  normalizeAnnotation,
} from "./library.mjs";
const fields = [
  "title",
  "author",
  "format",
  "language",
  "genres",
  "series",
  "seriesIndex",
  "collections",
  "cover",
  "importedMetadata",
  "addedAt",
  "lastReadAt",
  "pinOrder",
  "progress",
  "locator",
  "audioPosition",
  "driveSource",
];
const compare = (a, b) =>
  a.time - b.time || a.counter - b.counter || a.device.localeCompare(b.device);
const key = (id, field) => JSON.stringify([id, field]);
const annotationField = (field) =>
  typeof field === "string" && /^annotation:[A-Za-z0-9_-]{1,200}$/.test(field);
function registerKey(name) {
  let parts;
  try {
    parts = JSON.parse(name);
  } catch {
    throw new Error("Registro de nube no válido.");
  }
  if (
    !Array.isArray(parts) ||
    parts.length !== 2 ||
    typeof parts[0] !== "string" ||
    typeof parts[1] !== "string"
  )
    throw new Error("Registro de nube no válido.");
  const [id, field] = parts;
  const global = ["preferences", "driveFolder"].includes(field);
  if (
    (global && id !== "") ||
    (!global && !id) ||
    !(
      global ||
      fields.includes(field) ||
      annotationField(field) ||
      field === "annotations"
    )
  )
    throw new Error("Registro de nube no válido.");
  return parts;
}

const equal = (a, b) =>
  a === b ||
  (a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    JSON.stringify(a) === JSON.stringify(b));
export function stampChanges(before, after, device, now = Date.now()) {
  const registers = { ...before.registers };
  const highest = Object.values(registers).reduce(
    (n, r) => Math.max(n, r.time),
    0,
  );
  const time = Math.max(now, highest),
    counter = Object.values(registers).reduce(
      (n, r) => (r.time === time ? Math.max(n, r.counter + 1) : n),
      0,
    );
  const old = new Map(before.books.map((b) => [b.id, b]));
  for (const book of after.books) {
    if (old.get(book.id) === book) continue;
    for (const field of fields)
      if (!equal(old.get(book.id)?.[field], book[field]))
        registers[key(book.id, field)] = {
          time,
          counter,
          device,
          value: structuredClone(book[field]),
        };
    const previous = new Map(
      (old.get(book.id)?.annotations ?? []).map((annotation) => [
        annotation.id,
        annotation,
      ]),
    );
    for (const annotation of book.annotations ?? []) {
      const value = normalizeAnnotation(annotation);
      if (!equal(previous.get(value.id), value))
        registers[key(book.id, "annotation:" + value.id)] = {
          time,
          counter,
          device,
          value,
        };
    }
  }
  if (!equal(before.preferences, after.preferences))
    registers[key("", "preferences")] = {
      time,
      counter,
      device,
      value: structuredClone(after.preferences),
    };
  if (!equal(before.driveFolder, after.driveFolder))
    registers[key("", "driveFolder")] = {
      time,
      counter,
      device,
      value: structuredClone(after.driveFolder),
    };
  return { ...after, deviceId: device, registers };
}
export function mergeSnapshots(local, snapshots) {
  const registers = { ...local.registers },
    conflicts = [...(local.conflicts ?? [])];
  let changed = false;
  for (const snapshot of snapshots) {
    if (
      snapshot?.version !== 1 ||
      !snapshot.registers ||
      typeof snapshot.registers !== "object" ||
      Array.isArray(snapshot.registers)
    )
      throw new Error("Copia de nube no compatible.");
    for (const [name, record] of Object.entries(snapshot.registers)) {
      const [id, field] = registerKey(name);
      if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        !Number.isSafeInteger(record.time) ||
        record.time < 0 ||
        !Number.isSafeInteger(record.counter) ||
        record.counter < 0 ||
        typeof record.device !== "string" ||
        !record.device
      )
        throw new Error("Registro de nube no válido.");
      let incoming = record;
      if (annotationField(field)) {
        const value = normalizeAnnotation(record.value);
        if (field !== "annotation:" + value.id)
          throw new Error("Identificador de anotación de nube no válido.");
        incoming = { ...record, value };
      } else if (field === "annotations") {
        // An older empty-array register cannot overwrite independent notes.
        if (!Array.isArray(record.value) || record.value.length)
          throw new Error("Registro de anotaciones de nube no válido.");
        continue;
      }
      const previous = registers[name];
      if (
        previous &&
        previous.device !== incoming.device &&
        JSON.stringify(previous.value) !== JSON.stringify(incoming.value) &&
        ["locator", "audioPosition"].includes(field)
      ) {
        const conflict = {
          bookId: id,
          field,
          versions: [previous, incoming].sort(compare),
        };
        if (
          !conflicts.some((c) => JSON.stringify(c) === JSON.stringify(conflict))
        ) {
          conflicts.push(conflict);
          changed = true;
        }
      }
      if (!previous || compare(previous, incoming) < 0) {
        registers[name] = structuredClone(incoming);
        changed = true;
      }
    }
  }
  if (!changed) return local;
  const books = new Map();
  let preferences = createLibrary().preferences,
    driveFolder;
  for (const [name, record] of Object.entries(registers)) {
    const [id, field] = registerKey(name);
    if (!id && field === "preferences") preferences = record.value;
    else if (!id && field === "driveFolder") driveFolder = record.value;
    else {
      if (!books.has(id)) books.set(id, { id, annotations: [] });
      const book = books.get(id);
      if (annotationField(field)) {
        const annotation = normalizeAnnotation(record.value);
        if (field !== "annotation:" + annotation.id)
          throw new Error("Identificador de anotación de nube no válido.");
        book.annotations.push(annotation);
      } else if (field !== "annotations") book[field] = record.value;
    }
  }
  // Stable order makes replicas converge even if their register insertion order differs.
  for (const book of books.values())
    book.annotations.sort((a, b) => a.id.localeCompare(b.id));
  // Pin positions from separate offline devices may coincide; normalize deterministically.
  const ordered = [...books.values()]
    .filter((b) => b.pinOrder !== null)
    .sort((a, b) => a.pinOrder - b.pinOrder || a.id.localeCompare(b.id));
  ordered.forEach((b, i) => (b.pinOrder = i));
  const validated = importLibrary({
    version: 1,
    preferences,
    driveFolder,
    books: [...books.values()],
  });
  return {
    ...validated,
    deviceId: local.deviceId,
    registers,
    conflicts: conflicts.slice(-100),
  };
}
