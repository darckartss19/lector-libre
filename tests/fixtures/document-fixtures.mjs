import { zipSync, strToU8 } from "fflate";

const xml = (value) => strToU8(value);
const zip = (entries) =>
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, value]) => [
        path,
        typeof value === "string" ? xml(value) : value,
      ]),
    ),
  );

export function documentFixtures(image) {
  const imageBytes = new Uint8Array(Buffer.from(image.split(",")[1], "base64"));
  const image64 = image.split(",")[1];
  const fb2 = xml(
    `<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>Fantasía</genre><author><first-name>Ana</first-name><last-name>Pérez</last-name></author><book-title>Viajes FB2</book-title><lang>es</lang><sequence name="Viajes" number="2"/><coverpage><image l:href="#cover"/></coverpage></title-info></description><body>${Array.from({ length: 12 }, (_, index) => `<section><title><p>Capítulo ${index + 1}</p></title><p>Un párrafo ${index + 1} con <emphasis>café y música</emphasis>.</p><image l:href="#cover"/><p>Final de sección ${index + 1}.</p></section>`).join("")}</body><binary id="cover" content-type="image/png">${image64}</binary></FictionBook>`,
  );
  const docx = zip({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "docProps/core.xml": `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Viajes DOCX</dc:title><dc:creator>Ana Pérez</dc:creator><dc:language>es</dc:language></cp:coreProperties>`,
    "word/styles.xml": `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="cover" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/cover.png"/><Relationship Id="evil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${Array.from({ length: 8 }, (_, index) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Capítulo ${index + 1}</w:t></w:r></w:p><w:p><w:r><w:t>Un párrafo ${index + 1} con café y música.</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t> Texto destacado.</w:t></w:r></w:p>`).join("")}<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Cover" descr="Portada"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="cover"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:p><w:hyperlink r:id="evil"><w:r><w:t>Enlace sin ejecución</w:t></w:r></w:hyperlink></w:p></w:body></w:document>`,
    "word/media/cover.png": imageBytes,
    "docProps/thumbnail.png": imageBytes,
  });
  const namespaces = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"`;
  const odt = zip({
    mimetype: "application/vnd.oasis.opendocument.text",
    "meta.xml": `<office:document-meta ${namespaces}><office:meta><dc:title>Viajes ODT</dc:title><meta:initial-creator>Ana Pérez</meta:initial-creator><dc:language>es</dc:language><meta:keyword>Fantasía</meta:keyword></office:meta></office:document-meta>`,
    "content.xml": `<office:document-content ${namespaces}><office:automatic-styles><style:style style:name="bold"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text>${Array.from({ length: 8 }, (_, index) => `<text:h text:outline-level="1">Capítulo ${index + 1}</text:h><text:p>Un párrafo ${index + 1} con <text:span text:style-name="bold">café y música</text:span>.</text:p>`).join("")}<text:p><draw:frame><draw:image xlink:href="Pictures/cover.png"/></draw:frame></text:p><text:p>Texto con<text:s text:c="3"/>espacios<text:line-break/>y salto.</text:p></office:text></office:body></office:document-content>`,
    "Pictures/cover.png": imageBytes,
    "Thumbnails/thumbnail.png": imageBytes,
  });
  const html = xml(
    `<html lang="es"><head><meta name="author" content="Ana Pérez"><meta name="keywords" content="Fantasía, Viajes"><title>Viajes HTML</title></head><body>${Array.from({ length: 8 }, (_, index) => `<h1>Capítulo ${index + 1}</h1><p>Un párrafo ${index + 1} con <strong>café y música</strong>.</p>`).join("")}<img src="${image}" alt="Portada"><img src="https://example.invalid/tracking.png"><script>window.documentExecuted=true</script><iframe src="https://example.invalid/frame"></iframe><a href="javascript:alert(1)" onclick="alert(1)">Enlace inerte</a></body></html>`,
  );
  const md = xml(
    Array.from(
      { length: 8 },
      (_, index) =>
        `# Capítulo ${index + 1}\n\nUn párrafo ${index + 1} con **café y música**.\n\n- Primero\n- Segundo\n`,
    ).join("\n") +
      `\n![Imagen](${image})\n\n<img src="https://example.invalid/markdown.png" onerror="alert(1)">\n<script>window.documentExecuted=true</script>`,
  );
  const cbz = zip({
    "ComicInfo.xml":
      "<ComicInfo><Title>Viajes CBZ</Title><Writer>Ana Pérez</Writer><Series>Viajes</Series><Number>2</Number><LanguageISO>es</LanguageISO><Genre>Aventuras</Genre></ComicInfo>",
    ...Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `pages/page-${index + 1}.png`,
        imageBytes,
      ]),
    ),
    "__MACOSX/cover.png": imageBytes,
    "../outside.png": imageBytes,
  });
  return Object.fromEntries(
    Object.entries({ fb2, docx, odt, html, md, cbz }).map(([format, bytes]) => [
      format,
      [...bytes],
    ]),
  );
}
