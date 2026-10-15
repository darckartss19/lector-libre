# Comprobaciones de Android 0.12.2

La corrección se centra en la autorización y la búsqueda de documentos. Drive sigue desactivado en la interfaz y los comandos nativos.

- 106 pruebas JavaScript aprobadas.
- Nueve escenarios de interfaz del buscador aprobados con puente nativo simulado: primera autorización, cancelación, búsqueda al añadir carpeta, permisos guardados, permiso retirado, denegación en Android antiguo, resultados parciales, prevención de peticiones repetidas y recuperación de errores del selector.
- Once grupos de lectura móvil y las pruebas de funciones Android y Drive desactivado aprobados.
- APK arm64 y x86/x86_64 compilados en release: versión 0.12.2/12002, mínimo Android 7.0/API 24. Firma v2 y alineación ZIP de 16 KiB verificadas. Misma identidad de firma que 0.12.1, para actualizar conservando los datos.
- Confirmación manual del usuario: búsqueda con autorización funcionando en un Redmi Note 15 Pro.

Las pruebas de instrumentación de voz, cifrado y navegación de frases corresponden a la base 0.12.0 en MEmu Android 9; las 51 pruebas Rust corresponden a la base pública 0.12.1. Esta actualización no modifica su lógica. Windows conserva su instalador 0.12.1.

Estas comprobaciones no cubren todos los teléfonos, proveedores de documentos ni restricciones de almacenamiento. Las carpetas privadas de otras aplicaciones y algunas raíces de almacenamiento están restringidas por Android.
