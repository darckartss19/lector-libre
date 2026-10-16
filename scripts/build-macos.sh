#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo "La compilación de macOS requiere macOS con Xcode." >&2
  exit 1
fi
target="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
case "$target" in
  aarch64-apple-darwin|x86_64-apple-darwin) ;;
  *) echo "Arquitectura de macOS no admitida: $target" >&2; exit 1 ;;
esac
rustup target add "$target"
pnpm install --frozen-lockfile
pnpm build
pnpm tauri build --target "$target" --bundles app,dmg --ci -- --locked
bundle="${CARGO_TARGET_DIR:-src-tauri/target}/$target/release/bundle"
codesign --verify --deep --strict "$bundle/macos/Lector libre.app"
mkdir -p "work/macos-$target"
for disk in "$bundle"/dmg/*.dmg; do
  hdiutil verify "$disk"
  cp "$disk" "work/macos-$target/"
done
(cd "work/macos-$target" && shasum -a 256 ./*.dmg > SHA256SUMS.txt)
echo "Instalador y huella: work/macos-$target"
