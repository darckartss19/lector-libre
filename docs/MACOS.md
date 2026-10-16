# Lector libre para Mac: primera prueba

Esta compilación reutiliza el lector, la biblioteca local y el creador de citas de
0.12.6. Se generan instaladores separados para Apple Silicon (arm64, M1 y posteriores)
e Intel (x64). Requiere macOS 12 o posterior. No incluye voz nativa de Mac ni Drive.

## Instalar

Descarga el `.dmg` de tu arquitectura, ábrelo y arrastra Lector libre a Aplicaciones.
La firma es ad hoc: comprueba la integridad del paquete, pero no identifica al
desarrollador ante Apple. La aplicación no está notarizada. macOS puede pedir que
autorices esta aplicación concreta desde Privacidad y seguridad. No desactives
Gatekeeper ni otras protecciones del equipo.

El instalador de Mac no sirve en iPhone o iPad. Esas versiones requieren el proyecto
iOS y la firma y el aprovisionamiento de Apple; todavía no se distribuyen.

## Construir

Con Xcode, sus herramientas, Node 24, pnpm 11.25.0 y Rust 1.99 instalados:

```sh
bash scripts/build-macos.sh aarch64-apple-darwin
# En una Mac Intel:
bash scripts/build-macos.sh x86_64-apple-darwin
```

El workflow `macos-preview.yml` ejecuta las pruebas de JavaScript y Rust, construye
el frontend y ambos instaladores en máquinas de GitHub, verifica su firma ad hoc
y la integridad de los DMG, y comprueba el arranque nativo y del frontend en cada
arquitectura. Conserva los instaladores y sus SHA256 como artefactos durante 14 días.
No usa certificados privados ni publica releases automáticamente.

La prueba de arranque no sustituye comprobar importación, lectura y exportación de
citas en una Mac física. La suite de estabilidad de navegador de 0.12.6 tiene un
fallo de desplazamiento ya registrado; este workflow de empaquetado no lo corrige
ni declara que toda la auditoría esté aprobada.

Referencias: [distribución con GitHub](https://v2.tauri.app/distribute/pipelines/github/)
y [firma ad hoc](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing).
