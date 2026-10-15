# Lector libre para Android 0.12.4

Vista previa pública con lectura y biblioteca local. **Google Drive está desactivado y se ofrecerá en una versión futura.**

[Descargar Android y MEmu 0.12.4](https://github.com/darckartss19/lector-libre/releases/tag/v0.12.4). Esta versión ajusta las diez paletas y sus colores de página, conserva las correcciones de respaldo y voz de 0.12.3 y respeta reducir movimiento también en horizontal. Las portadas no se elevan al tocarlas.

## Instalar y probar

Descarga Android-arm64 para teléfonos de 64 bits; usa MEmu para x86/x86_64. El mínimo declarado es Android 7.0. Actualiza Android System WebView. Instala una actualización sobre la app anterior y conserva una copia ZIP de tu biblioteca.

En Añadir libros puedes elegir archivos o Buscar documentos. Si falta acceso en Android reciente, Buscar documentos abre el selector del sistema: elige una carpeta y confirma Usar esta carpeta. La búsqueda empieza automáticamente e incluye subcarpetas. Añadir carpeta también inicia la búsqueda al autorizarla. Las carpetas permitidas se recuerdan; si un permiso se retira, se solicita de nuevo. En Android 9 o anterior, el permiso antiguo de almacenamiento se solicita cuando sea necesario. Android moderno puede limitar algunas raíces o archivos de otras apps; autoriza una subcarpeta o usa Elegir archivos. El buscador encuentra archivos, no usa la cámara ni OCR. Las importaciones conservan los originales y reconocen los repetidos por SHA-256.

En Personalizar y sincronizar elige idioma, voz y velocidad. Si falta una voz offline, abre Descargar voces en Android, instala sus datos y pulsa Actualizar voces. Escucha un libro y prueba otra aplicación, pantalla apagada, notificación, pausa, continuar, detener y temporizador. Quitar el lector de recientes detiene la voz. La posición al retomar depende de las marcas de palabra del motor; puede repetirse el inicio de un fragmento interrumpido.

Prueba EPUB, PDF y CBZ, lectura vertical, rotación, menú y botones inferiores. Para tarjetas de citas, selecciona texto o escribe una cita si la página es una imagen; guarda PNG o abre Compartir imagen. Pegar una imagen depende de la aplicación de destino.

## Compilar

Configura JAVA_HOME, ANDROID_HOME y NDK_HOME. Instala las dependencias frontend y los destinos Rust aarch64-linux-android, x86_64-linux-android e i686-linux-android. Usa scripts/build-android.ps1 desde PowerShell. El script empaqueta APK release y admite Windows sin enlaces simbólicos; no cambia permisos del sistema.

Los APK de esta vista previa están firmados con una identidad de desarrollo. Quien compile debe usar su propia clave; las claves de firma no se distribuyen en el repositorio.
