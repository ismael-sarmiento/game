# AGENTS.md — game (IsGame)

## Parent

Global roots (L0):
- Claude Code: `~/.claude/CLAUDE.md`
- Codex: `~/.codex/AGENTS.md`

Sibling sites on the same origin (`https://isuniverse.dev`): portada (repository `ismael-sarmiento.github.io`),
IsProfile (`/profile/`) and IsAcademy (`/academy/`). Repository `game`, a copy with history of `isgame`, which now only
redirects `/isgame/` here: never delete it or its redirect pages.

## Purpose

Entry point for agents working on IsGame, the open-world browser game of IsAcademy ("Neo Academia", a living tech city;
sober, realistic signage, no neon — owner decision 2026-10-30),
served at `/game/`. Personal project of Ismael Sarmiento; only the global L0 protocols apply
(Plan al Milímetro before each phase, close-out recap after each task).

## Read order

1. `README.md` — structure, controls, local preview, publishing.
2. `.private/TODO.md` — phases (G1 playable slice, G2 publish, G3 AI Worker, G4 links, G5 growth) and open items.

## Rules

- Static only: no build step, no backend in this repository except `worker/` (deployed separately to Cloudflare by the owner's
  approval), no API keys anywhere. Relative paths (the game lives under `/game/`).
- Libraries are vendored at exact versions in `vendor/` (three.js 0.186.1, Rapier 0.19.3). Upgrade only in a planned phase.
- Art and sound are generated in code; external assets only if CC0 (owner decision 2026-10-29), listed in `CREDITS.md`.
  Any content must be original: no characters, names, maps or assets from existing games.
- Every user-facing string lives in `i18n/es.json` and `i18n/en.json` with the same keys; Spanish is the default.
- Facts (`facts` in `i18n/*.json`) must be real and verifiable; never invent one.
- NPC text from the network is rendered only with `textContent`, never as HTML.
- The inline import map is covered by a CSP hash: run `python3 tools/csp_hash.py` after editing it.
- Prepare release metadata with `bash tools/bump-version.sh VERSION`: it versions all own modules, recomputes CSP and synchronizes the 404 without modifying vendor.
- `404.html` is the universe's 404 (portada repository) without Cloudflare Web Analytics: run `python3 tools/sync_404.py`
  after every new portada version; never edit it by hand.
- Visits: `boot()` sends one anonymous page signal with the shared `/assets/ds/views.js` (no cookie or identifier; DNT/GPC
  respected), so IsPanel measures IsGame like the other sites (F11). Its CSP `connect-src` allows only the isa-forms Worker.
- Links to the other sites are root-relative with `data-i18n-href` (`links.*` in `i18n/*.json`); the language follows the
  universe's `isa-lang`, and only an explicit choice of the player is stored there.
- Check desktop and phone portrait (375×812, touch), WebGPU and WebGL2 (`?renderer=webgl`) before publishing.
- Never add AI co-author lines to commits. Publishing from this machine goes through the GitHub web (the IT hook blocks pushes).
