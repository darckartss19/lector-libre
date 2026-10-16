"""Package the current source and canonical docs without local data or signing keys."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=root / 'work' / f'source-{version}')
output = parser.parse_args().output.resolve()
output.mkdir(parents=True, exist_ok=False)
source = output / 'source'
folders = ['public/quote-backgrounds', 'src', 'tests', 'native', 'scripts', 'artwork', '.github', 'src-tauri/src',
           'src-tauri/icons', 'src-tauri/capabilities', 'src-tauri/gen/android']
files = ['.editorconfig', '.prettierrc.json', '.gitignore', 'LICENSE', 'THIRD_PARTY_NOTICES.txt',
         'package.json', 'pnpm-lock.yaml', 'index.html', 'vite.config.mjs', 'README.md',
         'ANDROID.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'PRIVACIDAD.md', 'VALIDACION.md',
         'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/build.rs',
         'src-tauri/tauri.conf.json', 'src-tauri/tauri.android.conf.json']
excluded = {'build', 'target', 'jniLibs', '.gradle', '.kotlin', '.idea', 'node_modules', '.git', '__pycache__'}
local_names = {'local.properties', 'tauri.settings.gradle', 'tauri.properties'}
private_extensions = {'.apk', '.aab', '.so', '.dll', '.exe', '.pdb', '.jks', '.keystore', '.vault', '.onnx'}
paths = [root / name for name in files]
for folder in folders:
    paths.extend((root / folder).rglob('*'))
manifest = []
for path in sorted(set(paths)):
    relative = path.relative_to(root)
    if (not path.is_file() or path.is_symlink() or excluded.intersection(relative.parts)
            or path.name in local_names or path.suffix.lower() in private_extensions
            or path.name.startswith('.env') or 'client_secret' in path.name.lower()):
        continue
    destination = source / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, destination)
    manifest.append({'path': relative.as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
archive = output / f'Lector-libre-{version}-codigo-fuente.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
    for item in manifest:
        bundle.write(source / item['path'], item['path'])
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({'version': version, 'files': len(manifest), 'archive': str(archive)}, ensure_ascii=False))
