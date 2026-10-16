# Preparación local de 0.12.6

El 16 de octubre de 2026 el usuario confirmó que completó las pruebas de la entrega anterior en PC y celular. Es una confirmación del usuario, sin desglose adicional de los casos ejecutados ni instrumentación independiente del teléfono.

La preparación 0.12.6 elimina el selector de Fondo duplicado y conserva la galería, la imagen propia y los dos accesos al creador de citas. Las 125 pruebas JavaScript y las 61 Rust aprobaron. Los 16 casos integrados del editor aprobaron tras corregir la expectativa del filtro Colores, que incluye ocho estilos y tres fondos fotográficos.

La ejecución inicial completa de navegador aprobó 22 de 24 suites. Una falló por esa expectativa de la nueva prueba y se resolvió. La otra, browser-stability.mjs, volvió a fallar en una ejecución aislada: la misma superficie de lectura cambia scrollTop de 300 a 293 al sincronizar. Se conserva la aserción exacta. Se registra como defecto pendiente; esta preparación no se presenta como una entrega sin fallos ni se publica automáticamente.

La auditoría extensa y sus límites se documentan por separado, vinculados a una copia de código inmutable. Los recuentos anteriores corresponden a ejecuciones de esta preparación; no se ha repetido todavía su instalación en un teléfono. Drive y OmniRoute siguen desactivados.

# Comprobaciones históricas de 0.12.4

Comprobaciones del 15 de octubre de 2026. Google Drive continúa desactivado por defecto. Se conservan las correcciones de respaldo, lectura vertical y controles de voz de 0.12.3.

- Formato de código comprobado; 108 pruebas JavaScript y 54 pruebas Rust del host Windows aprobadas.
- Contraste de texto principal y secundario de las diez paletas sobre sus fondos de interfaz. Texto de lectura con un mínimo de 7:1 en los diez colores de página.
- Cien combinaciones entre tema de interfaz y página comprobadas en el navegador, incluidos enlaces y controles principales, seleccionados y avisos de error. La prueba de contraste reprodujo el fallo anterior del botón principal al pasar el cursor.
- Movimiento de portada con retorno suave, solo con ratón; sin elevación en pantallas táctiles ni cuando se solicita reducir movimiento. El menú con teclado se abre inmediatamente y la preferencia de reducir movimiento se respeta también en un móvil horizontal de 900 píxeles de ancho. La prueba reprodujo el retorno sin transición de la portada anterior.
- Los identificadores de tema y las preferencias existentes no cambian. La vista previa conserva la independencia entre el tema de la aplicación y el color de página.
- Las 23 suites de navegador completas aprobaron tras actualizar los dos valores de color esperados por la prueba de barras del sistema Android. La primera ejecución completa detectó esas expectativas antiguas; las comprobaciones funcionales de la prueba se conservaron.
- Windows x64 y los APK de Android arm64 y MEmu se generaron con versión 0.12.4. Los APK declaran el paquete org.lectorlibre.reader y código 12004; apksigner verifica ambos y sus certificados coinciden con los de la versión publicada 0.12.2.
- Alineación de paquete de 16 KB verificada con zipalign. Los segmentos LOAD de las bibliotecas arm64, x86 y x86_64 están alineados a 16384 bytes.
- REA identifica el nuevo ejecutable Windows como PE de 64 bits e inventaría el APK arm64 sin contradicciones de integridad. La inspección es estática, no ejecuta la app ni certifica su comportamiento. El ejecutable no incluye la sección .dep-v0 para inventariar dependencias Rust.

La revisión de movimiento comprobó las dos transiciones existentes. No se añadieron animaciones al pasar páginas, buscar ni cambiar de tema. Los requestAnimationFrame de posicionamiento y desplazamiento siguen cumpliendo su función de lectura.

Los PDF con diseño original, las ilustraciones y los cómics conservan sus colores. Las pruebas de contraste corresponden a la interfaz y al texto que dibuja el lector, no al texto incluido dentro de imágenes o páginas PDF originales.

No hay dispositivo ADB conectado. No se han repetido en esta revisión las pruebas de instrumentación, permisos nativos, TalkBack, rotación física ni reproducción prolongada con la pantalla apagada. Las comprobaciones de movimiento son de navegador y no equivalen a medir fotogramas en el Redmi o en MEmu. La prueba de error de voz nativo compiló en la revisión anterior 0.12.3, sin ejecución en dispositivo.

Las pruebas de rendimiento usan una biblioteca sintética de 825 libros en escritorio; no equivalen a medir archivos grandes reales en el teléfono. No se simularon pérdida de energía ni disco defectuoso.

Windows conserva un instalador sin firma certificada y Android una firma de desarrollo. Los instaladores no modifican la aplicación instalada hasta que el usuario ejecuta la actualización. Los artefactos, el código y las huellas SHA-256 corresponden a la entrega 0.12.4.
