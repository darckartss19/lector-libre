#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' \
    'Usage: bash scripts/build-linux.sh [--check] [--output-dir DIRECTORY]' \
    'Build and verify a Linux x86_64 .deb with the Linux Tauri override.' \
    '--check validates prerequisites/configuration without compiling.' \
    'Dependencies must already be installed (pnpm install --frozen-lockfile).'
}

check_only=false
output_dir=''
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --check) check_only=true; shift ;;
    --output-dir)
      if (($# < 2)) || [[ -z "$2" || "$2" == --* ]]; then
        printf '%s\n' '--output-dir requires a directory.' >&2
        exit 2
      fi
      output_dir="$2"
      shift 2
      ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  printf '%s\n' 'This script requires a native x86_64 Linux builder.' >&2
  exit 1
fi
for tool in node pnpm cargo rustc python3 pkg-config dpkg-deb readelf; do
  command -v "$tool" >/dev/null || { printf 'Missing prerequisite: %s\n' "$tool" >&2; exit 1; }
done
if [[ "$(rustc -vV | sed -n 's/^host: //p')" != x86_64-unknown-linux-gnu ]]; then
  printf '%s\n' 'An x86_64-unknown-linux-gnu Rust toolchain is required.' >&2
  exit 1
fi
pkg-config --exists gtk+-3.0 webkit2gtk-4.1 libsoup-3.0 openssl

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/.." && pwd -P)"
if [[ -n "$output_dir" ]]; then
  output_dir="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$output_dir")"
fi
cd -- "$repo_root"
node --input-type=module -e 'if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js >=22 required")'
version="$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync("package.json", "utf8")).version)')"
python3 - <<'PY'
import json
from pathlib import Path

override = json.loads(Path('src-tauri/tauri.linux.conf.json').read_text())
bundle = override['bundle']
expected = {'../LICENSE': 'LICENSE', '../THIRD_PARTY_NOTICES.txt': 'THIRD_PARTY_NOTICES.txt'}
if bundle['targets'] != ['deb'] or bundle['resources'] != expected:
    raise SystemExit('Linux packaging must select deb and only the two license resources.')
for source in expected:
    if not (Path('src-tauri') / source).is_file():
        raise SystemExit(f'Missing license: {source}')
PY
if "$check_only"; then
  printf 'Linux preflight passed for %s; no build performed.\n' "$version"
  exit 0
fi

# Preserve supplied compiler flags while removing builder paths from diagnostics
# embedded in the release binary. Encoded flags also support paths with spaces.
if [[ -v CARGO_ENCODED_RUSTFLAGS ]]; then
  encoded_flags="$CARGO_ENCODED_RUSTFLAGS"
else
  read -r -a existing_flags <<< "${RUSTFLAGS:-}"
  encoded_flags=''
  for flag in "${existing_flags[@]}"; do
    encoded_flags+="${encoded_flags:+$'\x1f'}$flag"
  done
fi
for mapping in \
  "$repo_root=lector-libre" \
  "${CARGO_HOME:-$HOME/.cargo}=cargo-cache" \
  "${RUSTUP_HOME:-$HOME/.rustup}=rust-toolchains"; do
  encoded_flags+="${encoded_flags:+$'\x1f'}--remap-path-prefix=$mapping"
done
export CARGO_ENCODED_RUSTFLAGS="$encoded_flags"
export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_RELEASE_STRIP=symbols
target_dir="$(cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --no-deps --locked | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
marker="$(mktemp)"
trap 'rm -f -- "$marker"' EXIT

pnpm build
pnpm tauri build --ci --target x86_64-unknown-linux-gnu \
  --config src-tauri/tauri.linux.conf.json --bundles deb -- --locked --no-default-features

python3 - "$repo_root" "$target_dir" "$version" "$marker" "$output_dir" <<'PY'
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

root, target, version, marker = map(Path, sys.argv[1:5])
version = str(version)
bundle_dir = target / 'x86_64-unknown-linux-gnu/release/bundle/deb'
packages = [p for p in bundle_dir.glob('*.deb') if p.stat().st_mtime_ns > marker.stat().st_mtime_ns]
if len(packages) != 1:
    raise SystemExit(f'Expected one newly generated .deb, found {len(packages)} in {bundle_dir}')
package = packages[0]
def field(name):
    return subprocess.check_output(['dpkg-deb', '--field', str(package), name], text=True).strip()
metadata = {name: field(name) for name in ('Package', 'Version', 'Architecture', 'Depends')}
if (metadata['Package'], metadata['Version'], metadata['Architecture']) != ('lector-libre', version, 'amd64'):
    raise SystemExit(f'Unexpected package metadata: {metadata}')
for dependency in ('libc6', 'libssl3', 'libgtk-3-0', 'libwebkit2gtk-4.1-0'):
    if dependency not in metadata['Depends']:
        raise SystemExit(f'Missing runtime dependency: {dependency}')

process = subprocess.Popen(['dpkg-deb', '--fsys-tarfile', str(package)], stdout=subprocess.PIPE)
with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
    for member in archive:
        path = PurePosixPath(member.name)
        name = str(path).lower()
        if path.is_absolute() or '..' in path.parts:
            raise SystemExit(f'Unsafe package path: {member.name}')
        if any(part in path.parts for part in ('sysroot', 'node_modules', '.cargo', '.rustup', 'target')):
            raise SystemExit(f'Development directory in package: {member.name}')
        if '/workspace' in member.name or '/workspace' in member.linkname:
            raise SystemExit(f'Builder path in package entry: {member.name}')
        if 'native/windows' in name or name.endswith(('.exe', '.dll', '.ps1', '.cs', '.pdb')) or 'voice-catalog' in name:
            raise SystemExit(f'Windows resource in Linux package: {member.name}')
process.stdout.close()
if process.wait() != 0:
    raise SystemExit('Unable to inspect Debian archive')

with tempfile.TemporaryDirectory(prefix='lector-linux-verify-') as directory:
    staging = Path(directory)
    subprocess.run(['dpkg-deb', '--extract', str(package), str(staging)], check=True)
    binary = staging / 'usr/bin/lector-libre'
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise SystemExit('Missing executable usr/bin/lector-libre')
    elf = subprocess.check_output(['readelf', '-h', str(binary)], text=True)
    if 'Advanced Micro Devices X86-64' not in elf:
        raise SystemExit('Executable is not ELF x86_64')
    versions = subprocess.check_output(['readelf', '--version-info', str(binary)], text=True)
    glibc_versions = re.findall(r'Name: GLIBC_([0-9.]+)', versions)
    declared_glibc = re.search(r'\blibc6\s*\(>=\s*([0-9.]+)\)', metadata['Depends'])
    version_key = lambda value: tuple(map(int, value.split('.')))
    if not glibc_versions or not declared_glibc:
        raise SystemExit('Unable to verify the declared glibc minimum')
    required_glibc = max(glibc_versions, key=version_key)
    if version_key(declared_glibc.group(1)) < version_key(required_glibc):
        raise SystemExit(f'ELF requires glibc {required_glibc}; build on an older base or revise the dependency floor')
    dynamic = subprocess.check_output(['readelf', '-d', str(binary)], text=True)
    if re.search(r'\((RPATH|RUNPATH)\)', dynamic):
        raise SystemExit('Release binary must use system runtime libraries, without a builder RPATH')
    for filename in ('LICENSE', 'THIRD_PARTY_NOTICES.txt'):
        product_name = json.loads((root / 'src-tauri/tauri.conf.json').read_text()).get('productName', 'lector-libre')
        resource = staging / 'usr/lib' / product_name / filename
        document = staging / 'usr/share/doc/lector-libre' / ('copyright' if filename == 'LICENSE' else filename)
        for copy in (resource, document):
            if not copy.is_file() or copy.read_bytes() != (root / filename).read_bytes():
                raise SystemExit(f'Missing or altered license: {copy.relative_to(staging)}')
    for path in staging.rglob('*'):
        if path.is_file():
            if b'/workspace' in path.read_bytes():
                raise SystemExit(f'Builder path embedded in package file: {path.relative_to(staging)}')
    desktop = staging / 'usr/share/applications/Lector libre.desktop'
    if not desktop.exists():
        candidates = list((staging / 'usr/share/applications').glob('*.desktop'))
        if len(candidates) != 1:
            raise SystemExit('Missing unambiguous desktop entry')
        desktop = candidates[0]
    if not re.search(r'^Exec=lector-libre(?:\s|$)', desktop.read_text(), re.M):
        raise SystemExit('Desktop entry does not launch the installed executable')

output = Path(sys.argv[5]) if sys.argv[5] else None
if output is None:
    parent = root / 'work/linux'
    parent.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix=f'{version}-', dir=parent))
output.mkdir(parents=True, exist_ok=True)
destination = output / f'lector-libre_{version}_amd64.deb'
digest = hashlib.sha256(package.read_bytes()).hexdigest()
if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
    raise SystemExit(f'Refusing to overwrite a different artifact: {destination}; choose another output directory')
checksum = destination.with_suffix('.deb.sha256')
checksum_text = f'{digest}  {destination.name}\n'
if checksum.exists() and checksum.read_text() != checksum_text:
    raise SystemExit(f'Refusing to overwrite a different checksum: {checksum}')
if destination.resolve() != package.resolve():
    shutil.copyfile(package, destination)
checksum.write_text(checksum_text)
print(json.dumps(metadata, ensure_ascii=False))
print(f'DEB_PATH={destination}')
print(f'SHA256={digest}')
PY
