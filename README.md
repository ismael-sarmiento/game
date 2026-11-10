# IsGame · Neo Academia

*IsAcademy's open-world browser game: drive and walk a living tech city, talk to its mentors and learn programming,
data and AI by playing.*

Juego de mundo abierto de [IsAcademy](https://isuniverse.dev/academy/) que se juega en el navegador. Neo
Academia es una ciudad viva, de día y de noche, construida alrededor de la programación, los datos y la inteligencia
artificial, con el campus de IsAcademy en el centro. Conduces, paseas, hablas con seis mentores y aprendes redes,
depuración y entrenamiento de modelos con tres misiones, además de 40 curiosidades reales y verificables repartidas por
la ciudad.

**Jugar:** <https://isuniverse.dev/game/>

## Requisitos

- Un navegador actual con **WebGPU** o, si no lo tiene, **WebGL2** (cualquier Chrome, Edge, Firefox o Safari
  reciente). Si el navegador no tiene ninguno de los dos, la portada lo explica en lugar de intentar cargar.
- Ordenador o móvil (controles táctiles). La calidad automática se adapta al equipo (con WebGL2 empieza en Media) y
  baja sola si hace falta. Mejor con auriculares.

## Probar en local

```bash
python3 tools/serve.py
```

Abre `http://localhost:8765/`. Parámetros útiles:

| Parámetro | Para qué sirve |
|---|---|
| `?renderer=webgl` | Fuerza WebGL2 |
| `?quality=low\|medium\|high` | Fija la calidad |
| `?lang=en` | Inglés (por defecto, el idioma del navegador; si no es inglés, español) |
| `?debug=1` | Panel de FPS y ayudas de prueba en `window.__isgame` |
| `?debug=1&simulate=nogfx` | Muestra el aviso de navegador sin WebGPU ni WebGL2 |

## Controles

| Acción | Teclado y ratón | Mando | Táctil |
|---|---|---|---|
| Moverse o conducir | WASD o flechas | Stick izquierdo, RT acelera, LT frena | Joystick a la izquierda |
| Cámara | Arrastrar · rueda para acercar | Stick derecho | Arrastrar a la derecha |
| Hablar, subir o bajar del coche | E | Y | Botón E |
| Saltar · freno de mano | Espacio | A | Botón ⤒ |
| Correr | Shift | Pulsar el stick izquierdo | — |
| Claxon | H | B | — |
| Recolocar el coche | R | Back / Select | — |
| Distancia de cámara | C | RB | — |
| Mapa completo | M | — | — |
| Emisora de radio | Q | — | — |
| Modo foto | O (Esc o O para salir) | A hace la foto, B sale | Barra inferior |
| Silenciar | N | — | — |
| Pausa | Esc o P | Start | Botón ‖ |
| Menús, tarjetas y diálogos | Tab, flechas, Enter, Esc | Cruceta o stick, A elige, B vuelve, LB/RB cambian de pestaña | Tocar |

## Estructura

- `index.html`: estructura, pantallas y HUD; CSP con el hash del import map en línea.
- `js/core/`: renderizador y posprocesado, entrada (teclado, ratón, mando y táctil), audio, textos, guardado y calidad.
- `js/world/`: trazado de la ciudad y materiales, edificios MegaKit, mobiliario y semáforos, cielo, hora del día y
  clima, paisaje (bahía, montañas, pájaros), rótulos y pantallas, tráfico y vehículos, gente, vida ambiental, mentores,
  campus y vestíbulo de la torre.
- `js/player/`: coche (vehículo de Rapier con rayos), personaje y cámara.
- `js/game/`: misiones, diálogo, curiosidades, logros, HUD, minimapa y mapa completo, menús y ajustes, y navegación con
  mando (`padnav.js`).
- `i18n/`: todos los textos en español e inglés con las mismas claves, incluidas las 40 curiosidades y los diálogos.
- `worker/isa-game.js`: Worker de Cloudflare para preguntas libres a los mentores con IA. Es opcional y **no está
  desplegado**: sin él, cada mentor responde con sus diálogos escritos.
- `vendor/`: three.js 0.186.1 y Rapier 0.19.3 (MIT / Apache-2.0), sin cambios salvo los comentarios de source maps.
- `tools/`: servidor local sin caché, hash de la CSP, generación del follaje y copia de la 404.
- `404.html`: copia de la 404 del universo (repo de la portada) sin Cloudflare Web Analytics. Tras cada versión nueva de la portada:
  `python3 tools/sync_404.py`.
- Visitas: al arrancar, el juego envía una señal anónima de página con el `views.js` compartido (sin cookies ni
  identificadores; respeta Do Not Track y GPC), así IsPanel mide IsGame como las demás webs. La CSP solo abre `connect-src`
  al Worker `isa-forms`.

## Desarrollo

- Sin paso de compilación: módulos ES servidos tal cual. Todas las rutas son relativas, porque el juego vive en
  `/game/`.
- Tras editar el import map de `index.html`: `python3 tools/csp_hash.py`.
- Para preparar una versión: `bash tools/bump-version.sh VERSION`. Coordina CSS, entrada, importaciones compartidas y alias de todos los módulos propios; recalcula la CSP y sincroniza la 404. Es preparación de metadatos, sin compilar ni modificar vendor. Así cambiar `main.js` no deja dependencias relativas con una URL anterior en caché.
- Cada texto visible está en `i18n/es.json` y `i18n/en.json` con las mismas claves; las curiosidades deben ser reales
  y verificables.
- Las reglas para agentes están en `AGENTS.md`.

En una partida sin elección guardada, el ajuste de reducir movimiento de cámara sigue `prefers-reduced-motion`. Una preferencia guardada prevalece, y restablecer el progreso conserva los ajustes. Pruebas: `node --test qa/save.test.mjs`.

Tab y Mayús+Tab permanecen dentro de las capas modales de pausa, fichas y mapa; Escape llega a la capa abierta. La pantalla inicial, la barra de foto y el diálogo no modal conservan su navegación de página. La lógica se comparte con la selección de capas del mando en `js/game/padnav.js`.

Regresión de teclado real y tamaños de los cinco menús, en un contexto aislado con datos de prueba:

```bash
node ../kit/tools/browser_check.mjs 'http://127.0.0.1:8804/game/?debug=1' --flow qa/menu.flow.js --widths 375,1280 --schemes dark --allow-warn
```

El recorrido abre también una ficha ficticia, cambia y restaura la sensibilidad y comprueba Escape. El envoltorio del expediente 360 de detalle añade axe fijado para auditar cada pestaña; el comando anterior comprueba teclado y controles. No usar `--allow-warn` en las otras webs: aquí se admite la deprecación conocida de Rapier.

## Créditos

El código, la ciudad, la música y los efectos de sonido son originales y se generan en código. Las texturas, los
personajes y los edificios externos son CC0 (dominio público); el detalle está en [CREDITS.md](CREDITS.md).
