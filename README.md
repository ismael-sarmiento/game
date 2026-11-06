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
- `404.html`: copia de la 404 del universo (repo de la portada) sin la analítica. Tras cada versión nueva de la portada:
  `python3 tools/sync_404.py`.

## Desarrollo

- Sin paso de compilación: módulos ES servidos tal cual. Todas las rutas son relativas, porque el juego vive en
  `/game/`.
- Tras editar el import map de `index.html`: `python3 tools/csp_hash.py`.
- Cada texto visible está en `i18n/es.json` y `i18n/en.json` con las mismas claves; las curiosidades deben ser reales
  y verificables.
- Las reglas para agentes están en `AGENTS.md`.

## Créditos

El código, la ciudad, la música y los efectos de sonido son originales y se generan en código. Las texturas, los
personajes y los edificios externos son CC0 (dominio público); el detalle está en [CREDITS.md](CREDITS.md).
