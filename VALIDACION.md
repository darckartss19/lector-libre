# Comprobaciones de 0.12.1

Edición pública para Windows y Android con Drive desactivado por defecto en la interfaz y en sus comandos nativos, incluso si quedan credenciales de una entrega de desarrollo. La lectura y las copias ZIP funcionan con datos locales.

Resultados: 106 pruebas JavaScript y 51 pruebas Rust aprobadas; 11 grupos de interfaz móvil aprobados. La prueba específica de la edición pública comprobó en Windows y Android que el aviso es visible, no aparecen controles de conexión y no se realizan llamadas a Drive.

El instalador de Windows y ambos APK se generaron en modo release. Los APK declaran 0.12.1 (12001), Android mínimo 7.0/API 24; ambos verifican su firma v2 y la alineación ZIP de 16 KiB. Se acompañan de SHA-256.

La base Android 0.12.0 se probó en MEmu Android 9: nueve formatos, búsqueda e importación de TXT, acceso a subcarpetas autorizadas, deduplicación de archivos, cola UTF-16, cifrado local y voz offline silenciosa que continúa en segundo plano y responde a pausa, salto, continuación y detención. Se comprobaron la firma de los APK y la alineación ZIP de 16 KiB.

Esta es una vista previa. Esas comprobaciones no cubren todos los teléfonos, restricciones de batería, documentos grandes ni programas que reciban imágenes compartidas. Las reseñas y muestras reproducibles de la comunidad ayudarán a ampliar la validación.
