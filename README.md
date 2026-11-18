[![best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01)
[![rank](https://make.fun/badge/best-game-01/Avapage/makefun-best-game-01-r3/rank.svg)](https://make.fun/bounty/best-game-01)
[![reward](https://make.fun/badge/best-game-01/Avapage/makefun-best-game-01-r3/reward.svg)](https://make.fun/bounty/best-game-01)

# VOIDHARVEST

A roguelite arena survival game for the [best-game-01](https://make.fun/bounty/best-game-01) bounty on make.fun.

You are the last skiff-keeper of a dying star. The Hollow swarm pours through the breach in **ten waves** — pilot your skiff, let its weapons fire on their own, harvest the light that falls from the dead, and choose one of three upgrades at every level: five weapons (Pulse Blaster, Orbit Blades, Nova Bloom, Arc Conductor, Seeker Swarm) and five ship modules, each five levels deep. Elites drop star-cores and repair hearts. In wave 10 the **Hollow Maw** arrives with radial bullet rings, swarm summons and a telegraphed charge. Kill it to seal the breach and win.

## Play

Serve the `game/` folder with any static file server and open `index.html` in desktop Chrome — no build step, no network, no assets: all art is canvas vector work and all sound is synthesized WebAudio.

```sh
node serve.ts   # then open http://localhost:8080
```

- **WASD / arrow keys** — move (weapons aim themselves; positioning is the game)
- **1 / 2 / 3** or click — choose an upgrade on level-up
- **P / Esc** — pause · **M** — mute

## Layout

- `main.ts` — the entry program: copies `game/` + `screenshots/` to the output dir and writes `dossier.json` via the vendored library.
- `game/index.html` — page shell, HUD and menu screens.
- `game/src/main.js` — the whole game: fixed entity-array simulation, wave director, boss AI, canvas renderer with pre-rendered nebula starfield, particles, screen shake and hit-stop.
- `game/src/audio.js` — synthesized SFX and a procedural A-minor music sequencer. No audio files.
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged.
- `screenshots/` — real gameplay renders; the first by name is the cover.

Deterministic under `?seed=N`. Best score persists in `localStorage`.

MIT licensed — see `LICENSE`.
