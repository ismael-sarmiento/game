# IsGame · Neo Academia

Open-world browser game of [IsAcademy](https://ismael-sarmiento.github.io/isacademy/): a neon tech city at night where you
drive, walk, talk to android mentors and learn data, networks, debugging and AI through missions.

## Run locally

```bash
python3 tools/serve.py
```

Open `http://localhost:8765/`. Useful parameters: `?renderer=webgl` (force WebGL2), `?quality=low|medium|high`,
`?debug=1` (FPS panel and `window.__isgame` test helpers), `?lang=en`.

## Controls

| Action | Keyboard / mouse | Gamepad | Touch |
|---|---|---|---|
| Move / drive | WASD or arrows | Left stick, RT/LT | Left joystick |
| Camera | Drag with the mouse | Right stick | Drag on the right half |
| Interact (talk, enter/exit car) | E | Y / △ | E button |
| Handbrake / jump | Space | A / ✕ | ⤒ button |
| Sprint | Shift | Left stick press | — |
| Horn | H | B / ○ | — |
| Reset car | R | Back / Select | — |
| Full map | M | — | — |
| Radio station | Q | — | — |
| Photo mode | O | — | — |
| Mute | N | — | — |
| Pause | Esc or P | Start | ‖ button |

## Structure

- `index.html` — shell, screens and HUD; CSP with a hash for the inline import map.
- `js/core/` — renderer and post-processing, loop, input, audio, i18n, save, quality.
- `js/world/` — city layout and materials, MegaKit buildings (`kit.js`), props and traffic lights, sky, time of day and
  weather, landscape (bay, mountains, birds), neon signs, traffic and vehicles, people and crowd, mentors, the tower lobby.
- `js/player/` — car (Rapier ray-cast vehicle), avatar (character controller), camera.
- `js/game/` — missions, dialogue, 40 facts, achievements, HUD, minimap and full map, menus and settings.
- `i18n/` — every text in ES and EN, including the 20 verifiable facts and the mentors' dialogue.
- `worker/isa-game.js` — Cloudflare Worker for AI dialogue (Workers AI); optional, configured in `js/config.js`.
- `vendor/` — three.js 0.186.1 and Rapier 0.19.3 (MIT / Apache-2.0), unmodified except removed source-map comments.
