// Synthetic documents exercise the renderer without private books or accounts.
import { createHash } from "node:crypto";
const padding = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex",
);
const md5 = (...parts) =>
  createHash("md5").update(Buffer.concat(parts)).digest();
const padded = (value) =>
  Buffer.concat([Buffer.from(value, "latin1"), padding]).subarray(0, 32);
function rc4(key, input) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  j = 0;
  return Buffer.from(input).map((byte) => {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
    return byte ^ s[(s[i] + s[j]) % 256];
  });
}
export function makePdf({ scanned = false, password = null, count = 5 } = {}) {
  const objects = [
    null,
    "<< /Type /Catalog /Pages 2 0 R /Lang (es-ES) >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const id = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  let key, owner, user;
  if (password !== null) {
    owner = rc4(md5(padded("owner-fixture")).subarray(0, 5), padded(password));
    const permission = Buffer.alloc(4);
    permission.writeInt32LE(-4);
    key = md5(padded(password), owner, permission, id).subarray(0, 5);
    user = rc4(key, padding);
  }
  const encrypt = (bytes, n) => {
    if (!key) return bytes;
    const suffix = Buffer.alloc(5);
    suffix.writeUIntLE(n, 0, 3);
    return rc4(md5(key, suffix).subarray(0, 10), bytes);
  };
  if (key)
    objects[1] = `<< /Type /Catalog /Pages 2 0 R /Lang <${encrypt(Buffer.from("es-ES"), 1).toString("hex")}> >>`;
  const kids = [];
  for (let index = 0; index < count; index++) {
    const n = objects.length;
    kids.push(`${n} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Rotate ${index === 3 ? 90 : 0} /Resources << /Font << /F1 3 0 R >> >> /Contents ${n + 1} 0 R >>`,
    );
    const text =
      scanned || index === 2
        ? ""
        : `BT /F1 16 Tf 1 0 0 1 35 520 Tm (Página ${index + 1}: Señal del camino.) Tj 0 -30 Td (Texto para escuchar y buscar.) Tj ET`;
    const stream = encrypt(
      Buffer.from(
        `0.15 0.3 0.6 rg 20 20 360 80 re f\n0 0 0 rg\n${text}`,
        "latin1",
      ),
      n + 1,
    );
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
        stream,
        Buffer.from("\nendstream"),
      ]),
    );
  }
  objects[2] = `<< /Type /Pages /Count ${count} /Kids [${kids.join(" ")}] >>`;
  const info = objects.length;
  const pdfString = (value, n) => {
    const utf16 = Buffer.from(value, "utf16le");
    utf16.swap16();
    return encrypt(Buffer.concat([Buffer.from([254, 255]), utf16]), n).toString(
      "hex",
    );
  };
  objects.push(
    `<< /Title <${pdfString(scanned ? "PDF escaneado de prueba" : "Lectura PDF de prueba", info)}> /Author <${pdfString("Autora de prueba", info)}> >>`,
  );
  let encryption = "";
  if (key) {
    encryption = `/Encrypt ${objects.length} 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>]`;
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`,
    );
  }
  const chunks = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let length = chunks[0].length;
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = length;
    const chunk = Buffer.concat([
      Buffer.from(`${n} 0 obj\n`),
      Buffer.isBuffer(objects[n])
        ? objects[n]
        : Buffer.from(objects[n], "latin1"),
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${info} 0 R ${encryption} >>\nstartxref\n${length}\n%%EOF`,
    ),
  );
  return new Uint8Array(Buffer.concat(chunks));
}
