# Cómo contribuir

Puedes ayudar con una reseña, un error reproducible, una propuesta de mejora o una contribución de código. Abre un issue usando los formularios del repositorio. Para cambios grandes, comenta primero el objetivo y el comportamiento esperado.

En un error indica plataforma, dispositivo, versión del lector, formato del documento, pasos y resultado esperado. Usa documentos de prueba y evita incluir datos personales. No se necesitan credenciales ni libros completos para un reporte.

Para una contribución de código: instala las dependencias, conserva el estilo del proyecto, añade pruebas que cubran el problema cuando corresponda y ejecuta las comprobaciones relevantes. Mantén Drive desactivado en la vista previa pública. No añadas claves, libros personales ni archivos generados al repositorio.

El proyecto usa MIT para su código y conserva las licencias de sus dependencias. Las mejoras de estabilidad, accesibilidad, rendimiento y experiencia en dispositivos reales tienen prioridad en esta primera etapa.

Ejecuta `pnpm install --frozen-lockfile` y `pnpm verify` con Node.js 22 o posterior, pnpm, Rust en PATH y Microsoft Edge instalado. `pnpm test:browser` ejecuta las suites completas por separado. Para trabajar con una sola, ejecuta `node tests/browser-nombre.mjs`.

Cada corrección de comportamiento debe incluir una prueba que reproduzca el defecto. Actualiza las simulaciones cuando cambie el contrato nativo y conserva las comprobaciones funcionales. Las pruebas de voz que necesitan motores, modelos o un dispositivo Android deben declarar sus requisitos y registrar lo que no se haya podido ejecutar.

Mantén la documentación de la raíz junto al cambio. `python scripts/prepare-source.py` la incluye sin reescribir versiones ni instrucciones; el ZIP usa la versión de package.json. No se incluyen claves de firma ni datos locales.
