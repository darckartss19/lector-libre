# Lector libre

Lector gratuito y de código abierto para **Windows y Android**, con biblioteca personal, lectura sin conexión, voz y personalización. La actualización para Android es **0.12.2**, con la búsqueda de documentos corregida. Windows sigue disponible en **0.12.1**. Queremos probarla con más dispositivos y mejorarla con las reseñas de la comunidad.

**La sincronización con Google Drive está desactivada en esta entrega, tanto en Windows como en Android. Está prevista para una versión futura.** Tus libros, progreso y ajustes se guardan en el dispositivo. Puedes trasladarlos mediante una copia ZIP.

## Descargar

[Descargas para Windows y Android](https://github.com/darckartss19/lector-libre/releases)

| Archivo | Para qué sirve |
| --- | --- |
| Lector-libre-0.12.1-Windows.exe | Instalador para Windows de 64 bits |
| Lector-libre-0.12.2-Android-arm64.apk | Teléfonos Android de 64 bits |
| Lector-libre-0.12.2-MEmu.apk | MEmu y dispositivos x86/x86_64 |
| Lector-libre-0.12.2-codigo-fuente.zip | Código fuente de esta versión |
| SHA256SUMS.txt | Comprobar que los archivos descargados coinciden con la entrega |

Instala una actualización sobre la versión anterior para conservar los datos. Antes de probar una entrega nueva, puedes exportar una copia ZIP desde Personalizar y sincronizar. La versión de Windows no tiene firma de distribución certificada; los APK de esta vista previa usan una firma de desarrollo.

## Corrección de Android 0.12.2

Buscar documentos solicita autorizar una carpeta cuando hace falta y empieza la búsqueda al confirmarla. Recuerda las carpetas permitidas, incluye subcarpetas y explica los accesos denegados o retirados. El flujo fue confirmado en un Redmi Note 15 Pro.

En Android reciente, el permiso se concede en el selector del sistema. Si Android bloquea la raíz de Descargas o del teléfono, selecciona una subcarpeta o usa Elegir archivos.

[Descargar Android 0.12.2](https://github.com/darckartss19/lector-libre/releases/tag/v0.12.2) · [Descargar Windows 0.12.1](https://github.com/darckartss19/lector-libre/releases/download/v0.12.1/Lector-libre-0.12.1-Windows.exe)

## Qué puedes probar

- EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown y CBZ. Los originales se conservan; no se abren libros con DRM.
- Biblioteca por portadas, lomos o lista; géneros, sagas, colecciones, fijados, búsqueda y filtros. El primer género organiza las estanterías.
- Progreso de lectura, historial, marcadores, subrayados y notas. Copia de seguridad ZIP exportable y restaurable.
- Temas claros y nocturnos, páginas personalizables e interfaz en español, inglés y portugués.
- Lectura por páginas o vertical continua. PDF conserva su diseño original; el texto seleccionable depende del documento. No incluye OCR.
- Lectura en voz alta con idioma, voz, velocidad y temporizador. Windows permite usar voces del sistema o descargar voces compatibles; Android usa voces offline de su motor de texto a voz. No se generan archivos de audiolibro.
- En Android, la voz continúa en segundo plano y tiene controles en la notificación. Las restricciones de batería de cada fabricante pueden afectar la reproducción.
- En Android, buscar documentos visibles y autorizar carpetas con subcarpetas. Puedes filtrar y elegir cuáles importar; los archivos iguales no crean libros duplicados. Android puede limitar el acceso a algunas ubicaciones.
- Tarjetas de citas con fondos, tipografía y PNG; Android permite abrir el menú para compartir la imagen. En escaneos puedes escribir la cita manualmente.

## Reseñas, errores e ideas

[Dejar una reseña](https://github.com/darckartss19/lector-libre/issues/new?template=opinion.yml) · [Reportar un error](https://github.com/darckartss19/lector-libre/issues/new?template=error.yml) · [Proponer una mejora](https://github.com/darckartss19/lector-libre/issues/new?template=idea.yml)

Cuéntanos qué dispositivo usas, qué formato estabas leyendo, qué te resultó cómodo y qué cambiarías. Los reportes son públicos; comparte una muestra sintética cuando sea necesario y evita adjuntar libros completos o datos personales.

## Próximos pasos

La prioridad será corregir problemas de estabilidad, rendimiento y comodidad en teléfonos según los reportes recibidos. Después se retomarán Google Drive, otras plataformas y formatos. No hay una fecha prometida para la sincronización.

## Desarrollo

Se necesita Node.js 22 o posterior, pnpm, Rust y los requisitos de Tauri para la plataforma. Android necesita JDK, SDK y NDK configurados. En Windows también se necesita el entorno de compilación C++.

```text
pnpm install --frozen-lockfile
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
pnpm tauri build --bundles nsis
```

Para Android consulta [ANDROID.md](ANDROID.md). Los builds predeterminados son públicos y mantienen Drive desactivado. La opción de compilación `drive-sync` está reservada para desarrollo experimental; no se utiliza en los instaladores de esta entrega ni incluye credenciales.

## Licencia y privacidad

El código propio se distribuye bajo [MIT](LICENSE). Las bibliotecas, motores y modelos de terceros conservan sus propias licencias; consulta [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) y los avisos del motor de voz. Las voces descargadas se almacenan por separado.

[Privacidad](PRIVACIDAD.md) · [Cómo contribuir](CONTRIBUTING.md) · [Comprobaciones de esta entrega](VALIDACION.md)
