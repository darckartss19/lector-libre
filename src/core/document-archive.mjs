import { unzipSync } from "fflate";
import { imageUri } from "./document-content.mjs";

export function archiveReader(bytes) {
  let archive = bytes;
  const names = [];
  unzipSync(bytes, {
    filter(entry) {
      names.push(entry.name);
      return false;
    },
  });
  const available = new Set(names);
  return {
    names,
    read(path) {
      if (!archive) throw new Error("El libro ya está cerrado.");
      if (!available.has(path) || !safeArchivePath(path)) return null;
      return (
        unzipSync(archive, { filter: (entry) => entry.name === path })[path] ??
        null
      );
    },
    image(path) {
      return imageUri(this.read(path), imageType(path));
    },
    dispose() {
      archive = null;
    },
  };
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
