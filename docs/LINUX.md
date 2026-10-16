# Lector libre para Linux — vista previa 0.12.6

El paquete Linux es un candidato de prueba de la versión 0.12.6. Permite usar
la biblioteca, leer documentos sin conexión y crear imágenes con texto. No se
declara una entrega estable: siguen abiertos los pendientes de desplazamiento,
dependencias y auditoría profunda.

En Linux, `platform_info` declara `speech: false` y `drive: false`. Este paquete
no ofrece voz nativa ni sincronización con Google Drive. No contiene los motores,
scripts o catálogos de voz de Windows. El núcleo compartido y la configuración
predeterminada de Windows/Android no se modifican para generar el paquete.

## Instalar el `.deb`

El paquete se prepara para **Linux x86_64 con glibc 2.39 o posterior**, GTK 3 y
WebKitGTK 4.1 suministrados por la distribución. La compilación inicial en Debian
13 aprobó la inspección del paquete; su última prueba gráfica quedó interrumpida
por el límite de uso del entorno. El workflow de GitHub usa Ubuntu 24.04 y exige
un arranque nuevo del binario extraído antes de ofrecerlo como artefacto.
No se ha comprobado la instalación en Debian 12, ARM ni otras distribuciones.
Un binario construido en una distribución reciente no garantiza compatibilidad
con una anterior.

Desde la carpeta que contiene el paquete y su archivo de suma:

```sh
sha256sum --check lector-libre_0.12.6_amd64.deb.sha256
sudo apt install ./lector-libre_0.12.6_amd64.deb
lector-libre
```

`apt` debe resolver las dependencias del sistema indicadas en el paquete. No copies
el sysroot ni las bibliotecas de desarrollo del constructor al equipo de destino.
Se necesita una sesión gráfica Linux. La suma SHA256 comprueba el archivo recibido;
el candidato no incluye una firma de distribución del paquete.

## Construir sin modificar Windows/Android

Requisitos: Linux x86_64, Node.js 22 o posterior, pnpm, Rust para
`x86_64-unknown-linux-gnu`, compilador C/C++, Python 3, `pkg-config`, `dpkg-deb`
y `readelf`. También hacen falta las cabeceras de GTK 3, WebKitGTK 4.1, OpenSSL,
X11 y los demás requisitos Linux de Tauri 2.

En Debian 13, un equipo de desarrollo puede preparar los requisitos con su gestor
de paquetes; el script de construcción no instala paquetes del sistema. Para el
frontend, instala las dependencias una vez o cuando cambie el lockfile:

```sh
pnpm install --frozen-lockfile
bash scripts/build-linux.sh --check
CARGO_BUILD_JOBS=4 bash scripts/build-linux.sh
```

El último comando crea una carpeta nueva bajo `work/linux/` y muestra `DEB_PATH`
y `SHA256`. También admite una carpeta de salida explícita:

```sh
bash scripts/build-linux.sh --output-dir "$PWD/work/linux/mi-candidato"
```

No sobrescribe un `.deb` o una suma anterior con contenido distinto. Usa otra
carpeta para una nueva construcción de la misma versión. Si todas las dependencias
Rust están en caché, puedes usar `CARGO_NET_OFFLINE=true`.

El script compila el frontend y ejecuta Tauri con
`src-tauri/tauri.linux.conf.json`, destino GNU x86_64, `--locked` y sin features
predeterminadas adicionales. Tauri aplica este archivo de plataforma en Linux;
el archivo base sigue seleccionando NSIS para Windows. Las rutas de compilación
se remapean y se retiran los símbolos de depuración del ejecutable release.

El override reemplaza la lista de recursos por `LICENSE` y
`THIRD_PARTY_NOTICES.txt`. También incluye copias en
`/usr/share/doc/lector-libre/`. Las imágenes de la galería y los recursos PDF
del frontend se incorporan al ejecutable mediante el flujo normal de Tauri.

## Comprobaciones del empaquetado

```sh
node --test tests/linux-package.test.mjs
bash -n scripts/build-linux.sh
```

Además, cada construcción inspecciona el `.deb` generado: nombre, versión,
arquitectura, dependencias GTK/WebKit/OpenSSL/glibc, ejecutable ELF x86_64,
entrada de escritorio y licencias intactas. Rechaza recursos Windows, directorios
de desarrollo, rutas del constructor y RPATH/RUNPATH en el ejecutable. Solo copia
el artefacto y escribe su SHA256 después de esas comprobaciones.
También contrasta el mínimo de glibc declarado con los símbolos del ELF; si un
runner más reciente exige una versión superior, se detiene en lugar de entregar
un paquete con un mínimo falso.

Para una revisión manual:

```sh
dpkg-deb --info lector-libre_0.12.6_amd64.deb
dpkg-deb --contents lector-libre_0.12.6_amd64.deb
dpkg-deb --extract lector-libre_0.12.6_amd64.deb directorio-de-prueba
readelf -d directorio-de-prueba/usr/bin/lector-libre
```

Una extracción no instala ni resuelve dependencias. Para probar el ejecutable sin
tocar una biblioteca personal, configura directorios `XDG_DATA_HOME`,
`XDG_CONFIG_HOME` y `XDG_CACHE_HOME` nuevos y separados de los habituales. Conserva
los registros de esa sesión y comprueba la biblioteca y el editor de imágenes.
En un cloud sin escritorio físico puede emplearse Xvfb; cualquier adaptación local
de las rutas de WebKit pertenece al constructor y no se distribuye dentro del
paquete. No hacen falta Tailscale, RDP ni un cliente VPN.

Un sysroot reubicado necesita especial atención: `x11-dl` incorpora el valor
`pkg-config --variable=libdir` como ruta de búsqueda en tiempo de ejecución.
En el constructor cloud se usó un wrapper auxiliar de `PKG_CONFIG` que devuelve
`/usr/lib/x86_64-linux-gnu` únicamente para esas consultas de las bibliotecas X11;
las consultas de compilación `--cflags` y `--libs` siguen usando las bibliotecas
locales verificadas. Un constructor Debian nativo con los paquetes de desarrollo
en sus rutas normales no necesita esa adaptación. El script rechaza el `.deb`
si aún quedan rutas del constructor; no reescribe el binario para ocultarlas.

`browser-stability.mjs:314` tiene un fallo intermitente conocido de desplazamiento
de 300 a 293 con el mismo panel. Una ejecución aprobada no demuestra su corrección;
no se relajan sus aserciones para validar un paquete.

## AppImage y otras plataformas

Esta propuesta genera `.deb`. El constructor cloud comprobado no dispone de
`/dev/fuse`, `libfuse.so.2` ni herramientas AppImage preparadas. No se genera ni se
declara validado un AppImage, y no se instalan capacidades privilegiadas para
forzarlo. macOS/iOS se revisan por separado y no forman parte de esta validación.
