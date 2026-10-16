#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --no-open ) ]]; then
  echo "Uso: bash scripts/prepare-ios.sh [--no-open]" >&2
  exit 2
fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo "El proyecto de iPhone/iPad requiere macOS con Xcode completo." >&2
  exit 1
fi
for tool in xcodebuild xcrun rustup pnpm pod xcodegen; do
  command -v "$tool" >/dev/null || { echo "Falta la herramienta: $tool" >&2; exit 1; }
done
xcrun --sdk iphoneos --show-sdk-path >/dev/null
cd "$(dirname "$0")/.."
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
pnpm install --frozen-lockfile
pnpm build
pnpm tauri ios init --ci --skip-targets-install
if [[ "${1:-}" != --no-open ]]; then
  pnpm tauri ios open
fi
