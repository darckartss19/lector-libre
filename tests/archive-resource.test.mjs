import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import {
  readArchive,
  archiveReader,
  createArchiveBudget,
  readZipMembers,
  ArchiveResourceError,
} from "../src/core/archive-resource.mjs";

function u16(n) {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >> 8) & 0xff;
  return b;
}
function u32(n) {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >> 8) & 0xff;
  b[2] = (n >> 16) & 0xff;
  b[3] = (n >> 24) & 0xff;
  return b;
}
function concat(parts) {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Construye un ZIP con miembros almacenados (sin descompresión) y permite
// sobredimensionar los tamaños declarados del directorio central para probar
// la validación real frente a lo declarado.
function buildStoredZip(entries) {
  // entries: Array<{name, data, declaredCsize?, declaredUsize?}>
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = strToU8(entry.name);
    const data = entry.data;
    const csize = entry.declaredCsize ?? data.length;
    const usize = entry.declaredUsize ?? data.length;
    const lh = new Uint8Array(30 + name.length);
    lh.set(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    lh.set(u16(0), 8); // compresión: almacenado
    lh.set(u32(csize), 18);
    lh.set(u32(usize), 22);
    lh.set(u16(name.length), 26);
    lh.set(u16(0), 28);
    lh.set(name, 30);
    locals.push(lh, data);
    const cd = new Uint8Array(46 + name.length);
    cd.set(new Uint8Array([0x50, 0x4b, 0x01, 0x02]));
    cd.set(u16(0), 10); // compresión: almacenado
    cd.set(u32(csize), 20);
    cd.set(u32(usize), 24);
    cd.set(u16(name.length), 28);
    cd.set(u16(0), 30);
    cd.set(u16(0), 32);
    cd.set(u32(offset), 42);
    cd.set(name, 46);
    central.push(cd);
    offset += 30 + name.length + data.length;
  }
  const centralBytes = concat(central);
  const eocd = new Uint8Array(22);
  eocd.set(new Uint8Array([0x50, 0x4b, 0x05, 0x06]));
  eocd.set(u16(entries.length), 8);
  eocd.set(u16(entries.length), 10);
  eocd.set(u32(centralBytes.length), 12);
  eocd.set(u32(offset), 16);
  return concat([concat(locals), centralBytes, eocd]);
}

test("archive resource enforces the per-entry expanded budget", () => {
  const archive = zipSync({
    small: strToU8("hola"),
    over: new Uint8Array(100),
  });
  assert.throws(
    () => readArchive(archive, { perEntry: 50 }),
    (err) =>
      err instanceof ArchiveResourceError && /por recurso/.test(err.message),
  );
  assert.deepEqual(Object.keys(readArchive(archive, { perEntry: 1000 })), [
    "small",
    "over",
  ]);
});

test("archive resource enforces the per-operation aggregate budget", () => {
  const archive = zipSync({
    one: strToU8("a".repeat(60)),
    two: strToU8("b".repeat(60)),
  });
  assert.throws(
    () => readArchive(archive, { perOperation: 100 }),
    (err) =>
      err instanceof ArchiveResourceError && /presupuesto/.test(err.message),
  );
  assert.deepEqual(
    Object.keys(readArchive(archive, { perOperation: 1000 })).sort(),
    ["one", "two"],
  );
});

test("archive resource rejects a deflated entry whose declared size does not match the actual output", () => {
  const archive = zipSync({ "data.txt": strToU8("texto plano") });
  const bytes = new Uint8Array(archive);
  // Declarar un tamaño descomprimido distinto al real en el directorio central.
  const tampered = new Uint8Array(bytes);
  // Desplazamiento aproximado: recorrer directorio central y alterar el tamaño descomprimido del primer miembro.
  let e = bytes.length - 22;
  while (
    (bytes[e] |
      (bytes[e + 1] << 8) |
      (bytes[e + 2] << 16) |
      (bytes[e + 3] << 24)) !==
    0x06054b50
  )
    e--;
  const off =
    bytes[e + 16] |
    (bytes[e + 17] << 8) |
    (bytes[e + 18] << 16) |
    (bytes[e + 19] << 24);
  tampered[off + 24] = 255;
  assert.throws(
    () => readArchive(tampered),
    (err) =>
      err instanceof ArchiveResourceError && /no coincide/.test(err.message),
  );
});

test("archive resource does not include unsafe paths", () => {
  const archive = buildStoredZip([
    { name: "ok.txt", data: strToU8("seguro") },
    { name: "../evil.txt", data: strToU8("inseguro") },
    { name: "a/../../b.txt", data: strToU8("inseguro") },
  ]);
  const files = readArchive(archive);
  assert.deepEqual(Object.keys(files), ["ok.txt"]);
  assert.equal(new TextDecoder().decode(files["ok.txt"]), "seguro");
});

test("archive resource rejects duplicate member names instead of decompressing twice", () => {
  const archive = buildStoredZip([
    { name: "dup.txt", data: strToU8("primero") },
    { name: "dup.txt", data: strToU8("segundo") },
  ]);
  assert.throws(
    () => readArchive(archive),
    (err) =>
      err instanceof ArchiveResourceError && /duplicada/.test(err.message),
  );
});

test("archive resource rejects a stored entry whose declared size does not match its data", () => {
  const archive = buildStoredZip([
    { name: "bad.txt", data: strToU8("texto"), declaredUsize: 9999 },
  ]);
  assert.throws(
    () => readArchive(archive),
    (err) =>
      err instanceof ArchiveResourceError && /no coincide/.test(err.message),
  );
});

test("archive resource keeps valid large entries and many small entries under default budgets", () => {
  const archive = zipSync({
    large: new Uint8Array(20_000_001),
    text: strToU8("Capítulo"),
  });
  const files = readArchive(archive);
  assert.equal(files.large.length, 20_000_001);
  assert.equal(new TextDecoder().decode(files.text), "Capítulo");
  const many = Object.fromEntries(
    Array.from({ length: 5001 }, (_, i) => [`${i}.txt`, strToU8("a")]),
  );
  assert.equal(Object.keys(readArchive(zipSync(many))).length, 5001);
});

test("one working set shares its budget, while independent reads can revisit pages", () => {
  const archive = archiveReader(
    zipSync({ a: strToU8("12345678"), b: strToU8("abcdefgh") }),
  );
  const context = {
    budget: createArchiveBudget({ perEntry: 10, perOperation: 10 }),
  };
  assert.equal(archive.read("a", context).length, 8);
  assert.throws(() => archive.read("b", context), /presupuesto/);
  for (let i = 0; i < 5; i++) assert.equal(archive.read("a").length, 8);
  archive.dispose();
  assert.throws(() => archive.read("a"), /cerrado/);
});

test("ordinary ZIP entry count65535 does not require a ZIP64 record", () => {
  const bytes = zipSync(
    Object.fromEntries(
      Array.from({ length: 65535 }, (_, i) => [String(i), new Uint8Array(0)]),
    ),
  );
  const files = readArchive(bytes, {
    filter: (entry) => entry.name === "65534",
  });
  assert.equal(files["65534"].length, 0);
});

test("actual deflate output remains bounded when declared size understates it", () => {
  const bytes = zipSync({ text: strToU8("a".repeat(10000)) });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const central = view.getUint32(bytes.length - 22 + 16, true);
  view.setUint32(central + 24, 1, true);
  assert.throws(() => readArchive(bytes, { perEntry: 100 }), /por recurso/);
});
