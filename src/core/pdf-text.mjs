export function pdfPageText(content) {
  const lines = [];
  let line = [];
  for (const item of content.items ?? []) {
    if (typeof item.str !== "string") continue;
    if (item.str) line.push(item.str);
    if (item.hasEOL) {
      if (line.length) lines.push(line.join(" ").trim());
      line = [];
    }
  }
  if (line.length) lines.push(line.join(" ").trim());
  return lines.filter(Boolean).join("\n");
}

export function pdfTextHtml(text) {
  const escape = (value) =>
    value.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  return text
    .split(/\n+/)
    .filter((line) => line.trim())
    .map((line) => `<p>${escape(line)}</p>`)
    .join("");
}

export function pdfPageIds(pageCount, labels = []) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1)
    throw new TypeError("El PDF no tiene páginas válidas.");
  return Array.from({ length: pageCount }, (_, index) => ({
    id: `pdf-page-${index + 1}`,
    pageNumber: index + 1,
    title: String(labels[index] ?? index + 1),
  }));
}
