# Lector libre

Lector gratuito y de código abierto para **Windows y Android**, con biblioteca personal, lectura sin conexión, voz y personalización. La versión **0.12.4** reúne las paletas revisadas para lectura, los ajustes de movimiento y las correcciones de respaldo, voz y posición de lectura.

**La sincronización con Google Drive está desactivada en esta entrega, tanto en Windows como en Android. Está prevista para una versión futura.** Tus libros, progreso y ajustes se guardan en el dispositivo. Puedes trasladarlos mediante una copia ZIP.

## Vista previa 0.12.6

[Descargar Lector libre 0.12.6 — Vista previa](https://github.com/darckartss19/lector-libre/releases/tag/v0.12.6-preview.1)

Incluye el creador de imágenes con texto libre, quince fondos fotográficos, la galería simplificada y mejoras de importación, restauración y privacidad.

[Windows x64](https://github.com/darckartss19/lector-libre/releases/download/v0.12.6-preview.1/Lector-libre-0.12.6-Windows.exe) · [Android arm64](https://github.com/darckartss19/lector-libre/releases/download/v0.12.6-preview.1/Lector-libre-0.12.6-Android-arm64.apk) · [MEmu](https://github.com/darckartss19/lector-libre/releases/download/v0.12.6-preview.1/Lector-libre-0.12.6-MEmu.apk)

Es una versión preliminar: persiste un pequeño desplazamiento al sincronizar y hay comprobaciones de seguridad pendientes. Consulta [el estado de validación](docs/VALIDACION-0.12.6.md). La sincronización con Drive continúa desactivada.

## Cambios de 0.12.4

- Diez paletas revisadas: papel cálido, sepia y niebla, más siete opciones nocturnas con matices menos saturados. Se conservan los nombres y las preferencias existentes.
- Colores de página propios, combinables con cualquier tema de la interfaz. Texto de lectura con contraste mínimo de 7:1 en las paletas incluidas; los enlaces y la selección siguen el color de página.
- Botones, selecciones y avisos de error con contraste comprobado. Las portadas conservan su color al pasar el cursor.
- Movimiento discreto de las portadas solo con ratón; regreso suave y sin efecto al tocar. El menú respeta reducir movimiento también en horizontal y se abre inmediatamente al usar el teclado.
- Los PDF con diseño original y las imágenes conservan sus propios colores. Las paletas no recolorean las ilustraciones ni incorporan fondos fotográficos a la lectura.

## Correcciones de 0.12.3 incluidas

- Conserva el último estado válido al recuperar una biblioteca o al guardar después de una corrupción del archivo principal.
- Rechaza una copia completa si falta un libro sin referencia remota y mantiene el ZIP anterior. Avisa cuando una copia incluye solo referencias de Drive.
- Mantiene el lugar de lectura vertical al cambiar el ancho, incluso si hay capítulos cargándose.
- Los controles de voz de Android muestran un error recuperable si el motor no puede activar una voz.
- Amplía los objetivos táctiles de los botones móviles y permite comprobar todas las suites de navegador con un comando.

## Descargar versiones publicadas

[Descargar Lector libre 0.12.4 para Windows y Android](https://github.com/darckartss19/lector-libre/releases/tag/v0.12.4)

| Archivo | Para qué sirve |
| --- | --- |
| [Lector-libre-0.12.4-Windows.exe](https://github.com/darckartss19/lector-libre/releases/download/v0.12.4/Lector-libre-0.12.4-Windows.exe) | Instalador para Windows de 64 bits |
| [Lector-libre-0.12.4-Android-arm64.apk](https://github.com/darckartss19/lector-libre/releases/download/v0.12.4/Lector-libre-0.12.4-Android-arm64.apk) | Teléfonos Android de 64 bits |
| [Lector-libre-0.12.4-MEmu.apk](https://github.com/darckartss19/lector-libre/releases/download/v0.12.4/Lector-libre-0.12.4-MEmu.apk) | MEmu y dispositivos x86/x86_64 |
| [Lector-libre-0.12.4-codigo-fuente.zip](https://github.com/darckartss19/lector-libre/releases/download/v0.12.4/Lector-libre-0.12.4-codigo-fuente.zip) | Código fuente de esta versión |
| [Lector-libre-0.12.4-SHA256SUMS.txt](https://github.com/darckartss19/lector-libre/releases/download/v0.12.4/Lector-libre-0.12.4-SHA256SUMS.txt) | Comprobar que los archivos descargados coinciden con la entrega |

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
- Creador de imágenes con texto: desde un libro toma el fragmento seleccionado y permite incluir título y autor; desde **Crear imagen**, en la biblioteca, puedes escribir una frase, reflexión o poema libre. Comparte el mismo editor para PC y teléfonos, con 15 fondos fotográficos sin conexión, ocho estilos de color, tipografía y PNG. En escaneos puedes escribir la cita manualmente; Android abre el menú de compartir.

## Reseñas, errores e ideas

[Dejar una reseña](https://github.com/darckartss19/lector-libre/issues/new?template=opinion.yml) · [Reportar un error](https://github.com/darckartss19/lector-libre/issues/new?template=error.yml) · [Proponer una mejora](https://github.com/darckartss19/lector-libre/issues/new?template=idea.yml)

Cuéntanos qué dispositivo usas, qué formato estabas leyendo, qué te resultó cómodo y qué cambiarías. Los reportes son públicos; comparte una muestra sintética cuando sea necesario y evita adjuntar libros completos o datos personales.

## Próximos pasos

La prioridad será corregir problemas de estabilidad, rendimiento y comodidad en teléfonos según los reportes recibidos. Después se retomarán Google Drive, otras plataformas y formatos. No hay una fecha prometida para la sincronización.

## Desarrollo

Se necesita Node.js 22 o posterior, pnpm, Rust y los requisitos de Tauri para la plataforma. Android necesita JDK, SDK y NDK configurados. En Windows también se necesita el entorno de compilación C++.

```text
pnpm install --frozen-lockfile
pnpm verify
pnpm tauri build --bundles nsis
```

El comando verify comprueba formato, pruebas JavaScript, Rust, compilación de interfaz y suites de navegador. Rust debe estar disponible en PATH. Las pruebas de navegador necesitan Microsoft Edge instalado; Playwright se instala como dependencia de desarrollo. Las integraciones de voz de Windows necesitan sus motores y modelos de prueba. Los tests usan bibliotecas sintéticas y no abren la biblioteca personal instalada.

Para preparar un ZIP del código y la documentación actuales, ejecuta `python scripts/prepare-source.py`. Escribe en una carpeta nueva bajo work y toma la versión de package.json. README.md, ANDROID.md, PRIVACIDAD.md y VALIDACION.md en la raíz son las fuentes que se incluyen en el paquete; las carpetas de entregas anteriores se conservan como registros.

Para Android consulta [ANDROID.md](ANDROID.md). Los builds predeterminados son públicos y mantienen Drive desactivado. La opción de compilación `drive-sync` está reservada para desarrollo experimental; no se utiliza en los instaladores de esta entrega ni incluye credenciales.

## Licencia y privacidad

El código propio se distribuye bajo [MIT](LICENSE). Las bibliotecas, motores y modelos de terceros conservan sus propias licencias; consulta [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) y los avisos del motor de voz. Las voces descargadas se almacenan por separado.

[Privacidad](PRIVACIDAD.md) · [Cómo contribuir](CONTRIBUTING.md) · [Comprobaciones de esta entrega](VALIDACION.md)
