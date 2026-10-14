import { defineConfig } from "vite";
import { cpSync, mkdirSync } from "node:fs";
// All fonts, CMaps and decoders are bundled locally; no PDF content uses a CDN.
for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const destination = new URL(`./public/pdfjs/${folder}/`, import.meta.url);
  mkdirSync(destination, { recursive: true });
  cpSync(
    new URL(`./node_modules/pdfjs-dist/${folder}/`, import.meta.url),
    destination,
    { recursive: true },
  );
}
export default defineConfig({
  optimizeDeps: { entries: ["index.html"] },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/target/**",
        "**/.tools/**",
        "**/src-tauri/gen/android/**",
        "**/native/mobile/android/build/**",
      ],
    },
  },
  clearScreen: false,
});
