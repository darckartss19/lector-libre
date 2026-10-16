# Preparación 0.12.6: estado de revisión

Fecha: 16 de octubre de 2026. Este código es un candidato de pruebas; no representa una nueva entrega estable ni una auditoría de seguridad completada.

## Cambios

- Presupuestos acumulados de descompresión y conversión para documentos importados.
- Validación de metadatos al restaurar copias y protección del título del libro en notificaciones y MediaSession de Android.
- Creador de citas independiente de la biblioteca, compatible con citas tomadas de libros, imágenes propias, categorías y quince fondos fotográficos locales nuevos.
- Eliminación del desplegable Fondo duplicado: las miniaturas son el selector de fondos predeterminados.

Drive continúa desactivado en la configuración pública. No se actualizaron dependencias en este candidato.

## Verificación local del código de este candidato

- Formato y compilación de interfaz aprobados.
- 125 pruebas JavaScript y 61 pruebas Rust del host Windows aprobadas.
- Primera ejecución completa de navegador: 22/24 suites aprobadas. Una expectativa nueva del filtro Colores se corrigió: hay ocho estilos y tres fondos fotográficos en esa categoría. La repetición del editor aprobó sus 16 casos.
- Queda pendiente `tests/browser-stability.mjs:314`: el panel se conserva, pero el desplazamiento cambia de 300 a 293 píxeles después de sincronizar. Se reprodujo por separado y no se modificó la aserción.
- Por tanto, 23/24 suites tienen una ejecución aprobada tras la corrección de la prueba. La orden integral de verificación no terminó en verde y no se afirma una nueva ejecución completa de 24/24.
- Editor comprobado en 1280×850, 390×844, 320×640 y 844×390; sin desbordamiento horizontal y con Guardar visible.
- Compilaciones Windows, Android arm64 y Android x86/x86_64 generadas localmente. Firma Android y alineación de paquete de 16 KiB verificadas. No se repitió instalación física de 0.12.6 en teléfono.

Las pruebas de este candidato se ejecutaron sobre el origen local del que se copiaron los archivos. Al preparar esta rama se conservaron los finales de línea de los archivos existentes del repositorio; no se cambió su contenido lógico ni los binarios. La aceptación del usuario en PC y celular correspondía a la entrega anterior.

## Seguridad y dependencias

Codex Security Deep Scan no empezó: `Deep Scan cannot safely start a read-only worker: the parent must provide a managed filesystem permission profile.` No hay informe canónico ni conclusión de cero vulnerabilidades. La validación dinámica complementaria con cargas hostiles tampoco se ejecutó sin el aislamiento exigido.

La consulta de dependencias de producción de npm informó un aviso moderado para `sprintf-js 1.0.3`, vía el CLI de mammoth/argparse: [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). La aplicación importa `mammoth/mammoth.browser.js`; no se estableció que el formateador afectado forme parte del recorrido de DOCX distribuido.

La consulta a OSV de 321 versiones Rust encontró cuatro avisos para `rustls 0.23.45`, en el árbol Android: RUSTSEC-2026-0346, 0347, 0348 y 0349; reparación declarada en 0.23.46. No se demostró explotación en la aplicación. El árbol actual no habilita Brotli, condición del aviso 0348; tampoco se encontró configuración ECH ni almacenamiento personalizado de sesiones que registre los valores afectados por 0346/0347. El alcance del 0349 requiere revisión adicional. La presencia de avisos y sus condiciones debe evaluarse antes de publicar una entrega estable.

## Requisitos pendientes antes de integrar y publicar una entrega estable

1. Resolver el desplazamiento reproducible conservando la regresión y repetir la verificación integral.
2. Revisar una actualización acotada de rustls y repetir pruebas y compilaciones.
3. Completar el análisis profundo en una sesión compatible.
4. Probar el candidato en Android real: permisos, citas, compartir, voz en segundo plano e interrupciones.

Las pruebas de nube sobre `main` 0.12.4 (105 JavaScript, 53 Rust y 23 suites de navegador) son resultados de otra versión y no validan este candidato.
