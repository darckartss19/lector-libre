# Preparación de iPhone y iPad con una cuenta gratuita

La instalación en el dispositivo queda pendiente de tu Mac y de la firma con tu
propia cuenta de Apple. El ZIP de código prepara el proyecto de Xcode; no es un
IPA firmado ni una descarga instalable desde Safari. El binario para simulador
tampoco se puede instalar en un iPhone físico.

## Preparar en tu Mac

Necesitas Xcode completo, Node 24, pnpm 11.25.0, Rust, CocoaPods y XcodeGen. Si
Xcode pide aceptar su licencia o iniciar sesión, completa esos pasos tú desde
Xcode. Los scripts no aceptan acuerdos ni solicitan contraseñas.

Desde la carpeta del código:

```sh
bash scripts/prepare-ios.sh
```

El script genera `src-tauri/gen/apple` en tu Mac y abre el proyecto en Xcode. Se
regenera localmente para no conservar rutas de otro equipo ni identificadores
personales en el repositorio.

En Xcode, añade tu cuenta en Settings > Accounts. Selecciona el target de iOS y,
en Signing & Capabilities, activa la firma automática y elige tu Personal Team.
Conecta el iPhone o iPad, confirma la confianza y el modo de desarrollador si el
sistema lo solicita, selecciónalo como destino y pulsa Run. Estos pasos se hacen
en tu equipo; no envíes certificados, perfiles ni contraseñas al chat.

Apple limita la duración del aprovisionamiento gratuito; tendrás que renovar la
instalación desde Xcode cuando caduque. No requiere contratar un plan para esta
prueba personal. Consulta las [condiciones de prueba de Apple](https://developer.apple.com/help/account/basics/about-your-developer-account).

## Alcance de esta preparación

Se mantiene la interfaz móvil compartida y se prepara iOS 15 o posterior. La voz
nativa, la búsqueda de todo el almacenamiento y Drive no están disponibles en
iOS. La importación, el guardado de imágenes y copias, las áreas seguras y la
lectura con una biblioteca real deben probarse en el dispositivo antes de ofrecer
una versión de iOS al público. No se declara paridad con Windows o Android.

El workflow `iOS preparation` comprueba la generación del proyecto y compila para
el simulador Apple Silicon, sin certificados ni credenciales de Apple. Conserva
por separado el código para Xcode y el binario de simulador. El resultado de ese
workflow determina si la compilación queda comprobada; generar un proyecto por
sí solo no confirma que la app funcione en el teléfono.

Referencia técnica: [Tauri para iOS](https://v2.tauri.app/start/prerequisites/#ios).
