import definitions from "./document-formats.json" with { type: "json" };

export const DOCUMENT_FORMATS = Object.freeze(
  definitions.map((entry) => Object.freeze(entry)),
);
export const READABLE_FORMATS = new Set(
  DOCUMENT_FORMATS.filter((entry) => entry.readable).map((entry) => entry.id),
);
export const CATALOG_FORMATS = new Set(
  DOCUMENT_FORMATS.map((entry) => entry.id),
);

export function formatLabel(format) {
  return (
    DOCUMENT_FORMATS.find((entry) => entry.id === format)?.label ??
    format.toUpperCase()
  );
}
