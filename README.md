# SURGE — Bullet Heaven with AI Director

> A mobile-first, portrait-mode bullet-heaven survival game built with **zero dependencies** — vanilla JS, HTML5 Canvas, and ES modules. No build step, no bundler, no framework.

**Inspired by:** League of Legends Swarm mode, Vampire Survivors, and the idea that an AI Director can replace hand-tuned difficulty curves.

---

## Quick Start

### Launch Locally

```bash
# Any static file server works. Pick one:

# Python (built-in)
python3 -m http.server 8080

# Node.js (npx, no install)
npx serve .

# VS Code Live Server extension
# Right-click index.html → "Open with Live Server"
```

Then open **http://localhost:8080** in a browser (Chrome/Firefox recommended).

> **Important:** The game uses ES modules (`import`/`export`), so you **must** serve it over HTTP — opening `index.html` directly via `file://` will fail with CORS errors.

### Controls

| Input | Keyboard | Touch |
|-------|----------|-------|
| Move | WASD / Arrow keys | Left-half joystick |
| Dash | Space | Right-side button |
| Pause | Escape | — |
| Auto-fire | Always on | Always on |

### Mobile / Phone

The game is **portrait-first** (240×400 logical pixels, scaled up). On mobile devices, a virtual joystick and dash button appear automatically. Rotate to portrait if prompted.

---

## What Was Built

### Architecture (6,742 lines of code, 24 source files)

```
index.html              — Game shell (canvas + UI overlays)
main.js                 — State machine: MENU → PLAYING → UPGRADE → GAMEOVER/VICTORY
style.css               — Dark theme, pixel-art canvas, responsive overlays

src/
├── core/               — Engine layer (framework-agnostic)
│   ├── ecs.js          — Entity Component System (archetype query caching)
│   ├── engine.js       — Fixed-timestep game loop (60Hz physics + rAF render)
│   ├── events.js       — Pub/sub event bus (wildcard, once, zero-alloc hot path)
│   ├── input.js        — Unified keyboard + touch input
│   └── physics.js      — Spatial hash broad-phase + circle collision
│
├── config/             — All tunable numbers in one place
│   ├── balance.js      — Screen, arena, player, enemy, director, upgrade constants
│   ├── cards.js        — 40+ encounter cards (the Director's vocabulary)
│   └── palettes.js     — 16-color GBC palettes (Moss, Ember)
│
├── game/               — Gameplay systems
│   ├── player.js       — Player entity (movement, dash, auto-fire, stats)
│   ├── enemies.js      — 7 enemy types + elite/boss framework
│   ├── projectiles.js  — Player & enemy bullets (homing, pierce, bounce)
│   ├── collision.js    — Spatial hash resolve (player↔enemy, bullet↔enemy)
│   ├── arena.js        — Spawn point geometry (edge, pincer, surround, cluster, line)
│   ├── particles.js    — Pooled particle system (300 max, 3 types)
│   ├── upgrades.js     — 15 upgrades with stacking (weapon/defense/utility)
│   └── encounter-cards.js — Card selection: budget scaling, boss priority, greedy fill
│
├── agents/             — AI systems
│   ├── director.js     — The AI Director (Classic mode: 30-wave authored sequence)
│   └── enemy-brain.js  — Per-type FSM behaviors (7 distinct AI patterns)
│
└── ui/                 — Rendering & interface
    ├── renderer.js     — Canvas 2D pipeline (pixel-perfect scaling, shake, flash)
    ├── hud.js          — In-game HUD (health, wave, score, combo, XP, upgrades, dash CD)
    └── touch-controls.js — Virtual joystick + dash button (canvas-rendered)
```

### Implemented Features (Phase 1 + Phase 2 — Issues #1 through #17)

#### Core Engine
- **Custom ECS** with archetype query caching and deferred entity destruction
- **Fixed-timestep loop** ("Fix Your Timestep!" pattern) — 60Hz physics, interpolated rendering
- **Spatial hash** broad-phase collision (32px cells) with circle-circle narrow-phase
- **Event bus** with `on`/`off`/`once`/`emit`/wildcard `*` support

#### Enemy Types (7)
| Type | Behavior | Introduced |
|------|----------|------------|
| **Drifter** | Homing + sinusoidal wobble | Wave 1 |
| **Dasher** | 4-state FSM: idle → telegraph → charge → recover | Wave 2 |
| **Sprayer** | Stationary turret, tracks player, fires bullet fans | Wave 3 |
| **Orbitor** | Maintains orbit around player, fires periodically | Wave 4 |
| **Splitter** | Homing approach, splits into 2-3 children on death | Wave 4 |
| **Shielder** | Escorts nearest ally, projects damage-reduction aura | Wave 5 |
| **Splitter Child** | Faster, smaller splitter fragment (no further split) | Spawned |

All types support **Elite** (1.5× stats, crown accent) and **Boss** (5× HP, 2× size, phase transitions at 50% HP) variants.

#### AI Director
- **Classic Mode:** 30 hand-authored waves using a curated sequence of encounter cards
- **Encounter Card System:** 40+ cards organized by category (Swarm, Rush, Turret, Orbit, Splitter, Shield, Mixed, Boss)
- **Budget Scaling:** Intensity budget grows per wave (`3 + wave × 0.8`), boss waves get +4 budget spike
- **Formations:** random, cluster, line, pincer, surround — each with geometric spawn positioning
- **Card Modifiers:** Swift, Dense, Armored, Splitting, Dark, Frenzied (ready for Adaptive/LLM modes)
- **Seeded RNG** (Mulberry32) for deterministic replays in Classic mode

#### Upgrade System (15 upgrades)
| Category | Upgrades |
|----------|----------|
| **Weapon** (6) | Spread Shot, Pierce, Rapid Fire, Heavy Rounds, Homing, Ricochet |
| **Defense** (5) | Shield (absorb hit), Quick Dash, Slow Aura, Regeneration, Plating |
| **Utility** (4) | Magnet, Nuke, Decoy, Scanner |

Offered every 3 waves, pick 1 of 3 random choices. Each upgrade stacks up to its limit (1-3).

#### Game Feel
- Screen shake on player hit
- Screen flash (colored) on hit/level-up
- Death burst particles (scaled for bosses vs normal enemies)
- Combo counter with decay timer
- Kill feed (right side)
- Flash messages ("WAVE 3!", "LEVEL UP!", "WAVE CLEAR!")

#### UI
- **HUD:** Health bar (color-coded), wave counter, score, level, XP bar, combo, enemy count, dash cooldown arc, upgrade icon strip
- **Menus:** Title screen with palette selector (Moss/Ember) and Director mode selector
- **Touch Controls:** Canvas-rendered virtual joystick + dash button with cooldown fill animation
- **Screens:** Menu, Pause, Upgrade Selection, Game Over, Victory — all with backdrop blur

---

## How to Demo / Present

### Talking Points

1. **"Zero dependencies"** — Open `package.json`? There isn't one. No React, no Phaser, no Pixi. Pure vanilla JS + Canvas 2D. Show the import tree — everything is ES modules.

2. **"Custom ECS"** — Open `src/core/ecs.js`. Entities are integers. Components are Maps. Queries use archetype caching that only rebuilds when entities change. This is the same pattern AAA engines use, implemented in ~280 lines.

3. **"The Director thinks in cards"** — Open `src/config/cards.js`. Each card is a spawn composition: enemies, formation, intensity rating, tags. The Director doesn't spawn enemies directly — it picks cards. This is the abstraction layer that makes all three AI modes (Classic, Adaptive, LLM) possible.

4. **"Show wave 10"** — Play to wave 10 to see the first boss. The Swarm King is a boss-variant drifter with 5× HP, 2× size, and a phase transition at 50% HP.

5. **"Upgrade build diversity"** — Play two runs and pick different upgrades. Spread Shot + Pierce creates a clearing build. Shield + Armor + Regen creates a tank build. Show how the upgrade stacking works.

6. **"Mobile-first"** — Open Chrome DevTools → toggle device toolbar → pick any phone. The virtual joystick appears, the canvas scales pixel-perfectly. No DOM overlays — everything is canvas-rendered for 60fps on mobile.

### Demo Script (2 minutes)

1. Open the game in browser. Point out "no build step — just a static file server."
2. Show the Palette selector (switch Moss ↔ Ember). Show the Mode selector (future modes greyed out).
3. Hit PLAY. Point out the auto-fire and dash mechanics.
4. Survive to Wave 3 (upgrade offer). Pick Spread Shot. Explain the upgrade system.
5. Survive to Wave 6 (Orbitors appear). Point out the new enemy types orbiting.
6. Die or reach Wave 10. Show the Game Over / Boss screen stats.
7. (Optional) Open `src/agents/director.js` and show the Classic Sequence — "this is the authored path; the AI Director will generate this dynamically."

---

## What Can Be Done Better (Roadmap)

### Phase 3 — Stress Model & Adaptive Director (Issues #18-#19)
- **Player Stress Model:** Real-time stress scoring (0-100) based on HP ratio, enemy proximity, dodge frequency, DPS taken. This feeds the Adaptive Director.
- **Adaptive Director (Mode 2):** Rule-based card selection using stress + softmax bandit algorithm. Budget scales with 10-wave rolling average. Replaces hand-authored sequences with reactive difficulty.

### Phase 4 — LLM Director (Issues #20-#22)
- **LLM Integration:** Every 3 waves, query an LLM with structured context (stress, build, history). LLM returns card picks + modifiers + narrative flavor text.
- **Graceful Fallback:** If LLM fails or times out (3s), falls back to Adaptive mode seamlessly.
- **Prompt Engineering:** Structured JSON schema for LLM responses, few-shot examples, token budget optimization.

### Phase 5 — Coach Agent (Issues #23-#25)
- Post-run analysis screen with LLM-generated tips
- "Coach says..." callouts during gameplay (e.g., "You're not using dash — try it!")
- Build recommendations based on enemy composition

### Phase 6 — Progression & Meta (Issues #26-#30)
- localStorage persistence (best scores, unlocks, settings)
- XP and leveling system across runs
- Character unlocks with different starting stats

### Phase 7 — Cosmetics (Issues #31-#35)
- More palettes (Ocean, Crimson, Neon)
- Particle themes per palette
- Unlockable visual effects

### Phase 8 — Polish & Launch (Issues #36-#43)
- Sound effects (Web Audio API, no files — synthesized)
- Performance profiling + optimization (target: 60fps on iPhone SE)
- PWA manifest + service worker for offline play
- Accessibility (screen reader announcements, high-contrast mode)
- Analytics + telemetry for difficulty tuning

### Technical Debt / Improvements
- **Testing:** No tests yet. The ECS, physics, and card selection systems are pure functions — ideal candidates for unit testing.
- **TypeScript:** Currently vanilla JS with JSDoc annotations. Migration to TypeScript would catch the API mismatches found during development (wrong import styles, wrong parameter counts).
- **Asset Pipeline:** Currently everything is code-rendered (shapes, not sprites). A sprite sheet system would improve visual quality.
- **Object Pooling:** Bullets and particles use basic pooling — enemies and ECS entities don't. Under heavy load (Wave 20+, 50+ entities), GC pressure could cause frame drops.
- **Netcode:** The fixed-timestep + seeded RNG architecture was deliberately chosen to support potential future replay/spectator features, but no networking exists yet.
- **Build Step:** Adding a bundler (esbuild/Vite) would enable tree-shaking, minification, and source maps for production. Currently the 24-file ES module graph loads fine but isn't optimized.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Vanilla JavaScript (ES2022+, ES Modules) |
| Rendering | HTML5 Canvas 2D (`CanvasRenderingContext2D`) |
| Architecture | Custom ECS + Pub/Sub EventBus |
| Physics | Spatial Hash + Circle Collision |
| AI | FSM enemy behaviors + Encounter Card system |
| Styling | CSS (no preprocessor) |
| Dependencies | **None** |
| Build Step | **None** — serve static files |
| Lines of Code | ~6,742 (24 source files) |

---

## Project Structure Summary

| Directory | Purpose | Files |
|-----------|---------|-------|
| `/` | Entry point + shell | `index.html`, `main.js`, `style.css` |
| `src/core/` | Engine layer | ECS, game loop, events, input, physics |
| `src/config/` | Tuning & data | Balance constants, encounter cards, palettes |
| `src/game/` | Gameplay | Player, enemies, bullets, collision, particles, upgrades |
| `src/agents/` | AI systems | Director, enemy behaviors |
| `src/ui/` | Rendering | Canvas renderer, HUD, touch controls |

---

## License

Private project — not open source.

---

*Built by Ayoub Chamakhi — March 2026*
