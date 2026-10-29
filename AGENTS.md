# AGENTS.md — isgame

## Parent

Global roots (L0):
- Claude Code: `~/.claude/CLAUDE.md`
- Codex: `~/.codex/AGENTS.md`

Sibling sites on the same origin: portada (`ismael-sarmiento.github.io`), CV Online (`/cv/`) and IsAcademy (`/isacademy/`).

## Purpose

Entry point for agents working on IsGame, the open-world browser game of IsAcademy ("Neo Academia", a neon tech city),
served at `/isgame/`. Personal project of Ismael Sarmiento; only the global L0 protocols apply
(Plan al Milímetro before each phase, close-out recap after each task).

## Read order

1. `README.md` — structure, controls, local preview, publishing.
2. `.private/TODO.md` — phases (G1 playable slice, G2 publish, G3 AI Worker, G4 links, G5 growth) and open items.

## Rules

- Static only: no build step, no backend in this repository except `worker/` (deployed separately to Cloudflare by the owner's
  approval), no API keys anywhere. Relative paths (the game lives under `/isgame/`).
- Libraries are vendored at exact versions in `vendor/` (three.js 0.186.1, Rapier 0.19.3). Upgrade only in a planned phase.
- All art and sound are generated in code. Any content must be original: no characters, names, maps or assets from existing games.
- Every user-facing string lives in `i18n/es.json` and `i18n/en.json` with the same keys; Spanish is the default.
- Facts (`facts` in `i18n/*.json`) must be real and verifiable; never invent one.
- NPC text from the network is rendered only with `textContent`, never as HTML.
- The inline import map is covered by a CSP hash: run `python3 tools/csp_hash.py` after editing it.
- Check desktop and phone portrait (375×812, touch), WebGPU and WebGL2 (`?renderer=webgl`) before publishing.
- Never add AI co-author lines to commits. Publishing from this machine goes through the GitHub web (the IT hook blocks pushes).
