# ⚡ SURGE

**A bullet-heaven where the AI learns how you play — and fights back.**

Built from scratch. No engine, no framework, no dependencies. Just vanilla JavaScript, a Canvas, and a bad attitude.

---

## What is this?

SURGE is a mobile-first, portrait-mode bullet-heaven survival game. You auto-fire. Enemies come at you in waves. You dodge, dash, level up, and try to survive 30 waves of increasingly creative mayhem.

The twist? **An AI Director watches everything you do** — your stress level, your dodge patterns, your build choices — and dynamically adjusts what it throws at you. Too comfortable? Here come the Dashers. Tilting? It'll ease off. If you plug in an LLM, it gets *weird* — the Director starts crafting encounters with narrative flavor text and strategic reasoning.

Think Vampire Survivors meets Left 4 Dead's AI Director, shrunk down to a phone screen.

---

## Play It

```bash
# Any static server works:
python3 -m http.server 8080

# Or:
npx serve .
```

Open **http://localhost:8080**. That's it. No `npm install`, no build step, no waiting.

> ES modules require HTTP — opening `index.html` via `file://` won't work.

---

## Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Move | WASD / Arrows / Mouse | Touch & drag |
| Dash | Space | Double-tap |
| Pause | Escape | — |
| Fire | Automatic | Automatic |

Portrait mode. 240×400 logical pixels. Scales to any screen.

---

## The Architecture (in 60 seconds)

**Zero dependencies.** No React. No Phaser. No Pixi. The import tree is pure ES modules served as-is.

The whole thing runs on a custom **Entity Component System** — entities are integers, components are Maps, queries use archetype caching. Below that sits a **fixed-timestep game loop** (60Hz physics, interpolated rAF rendering) and a **spatial hash** for broad-phase collision detection.

The AI Director doesn't spawn enemies directly. It picks **encounter cards** — each card is a composition of enemies, formations, and intensity ratings. Three Director modes use this same card abstraction:

- **Classic:** 30 hand-authored waves. Deterministic. Seeded RNG for replays.
- **Adaptive:** Softmax bandit algorithm driven by a real-time player stress model.
- **LLM:** Queries an external LLM every few waves with player state. The LLM picks cards, adds modifiers, and writes flavor text. Falls back to Adaptive if the LLM times out.

```
main.js ─── State machine (MENU → PLAYING → UPGRADE → GAMEOVER)
│
├── src/core/         Engine: ECS, game loop, events, input, physics
├── src/config/       Balance constants, 40+ encounter cards, palettes
├── src/game/         Player, 7 enemy types, bullets, collision, particles, upgrades
│                     + pilot rank, achievements, daily challenges, leaderboard,
│                       mastery, cosmetics, battle pass
├── src/agents/       AI Director (3 modes), enemy FSM brains, stress model,
│                     telemetry, coach, LLM adapter, planner-critic, analytics
├── src/ui/           Canvas renderer, HUD, touch controls, CRT filter,
│                     report screen, store, tutorial
├── src/audio/        Procedural Web Audio SFX (no audio files)
└── prompts/          LLM system prompts (Director + Coach)
```

---

## Enemy Types

| Type | What It Does | Shows Up |
|------|-------------|----------|
| **Drifter** | Homing + sinusoidal wobble | Wave 1 |
| **Dasher** | Telegraph → charge → recover FSM | Wave 2 |
| **Sprayer** | Stationary turret, bullet fans | Wave 3 |
| **Orbitor** | Orbits you, fires periodically | Wave 4 |
| **Splitter** | Splits into 2-3 children on death | Wave 4 |
| **Shielder** | Escorts allies with damage-reduction aura | Wave 5 |

All types come in **Elite** (1.5× stats, crown) and **Boss** (5× HP, 2× size, phase transitions) variants.

---

## Upgrades (15)

| Category | Options |
|----------|---------|
| **Weapon** (6) | Spread Shot, Pierce, Rapid Fire, Heavy Rounds, Homing, Ricochet |
| **Defense** (5) | Shield, Quick Dash, Slow Aura, Regeneration, Plating |
| **Utility** (4) | Magnet, Nuke, Decoy, Scanner |

Pick 1 of 3 every few waves. Each stacks 1-3 times.

---

## The AI Pipeline

This is the part I'm most proud of:

1. **Stress Model** — Reads 6 real-time signals (HP ratio, enemy proximity, dodge frequency, DPS taken/given, combo). Outputs a smooth 0-1 stress score.

2. **Director** — Consumes stress + telemetry to pick encounter cards. In Adaptive mode, it uses a softmax bandit that balances exploration vs exploitation. In LLM mode, it sends a structured state summary and gets back card picks + narrative.

3. **Telemetry** — Per-frame recording: movement heatmap, dodge tracking, DPS windows, build progression.

4. **Coach** — After each run, generates a diagnostic report. Analyzes playstyle, identifies improvement areas, gives specific tips based on what actually happened.

5. **Planner-Critic** — Premium LLM mode. Planner proposes a wave plan, Critic reviews it for balance issues, planner adjusts. Two-agent deliberation loop.

6. **Analytics** — Event batching, privacy controls, local storage fallback.

---

## Gamification

- **Pilot Rank** — 20 ranks from Rookie to Legend. XP from waves, bosses, completions, no-hit bonuses.
- **40 Achievements** — Combat, Survival, Mastery, and Fun categories. "Kill 1000 enemies." "Win without dashing." "Have all 15 upgrades."
- **Daily Challenges** — 3 per day (easy/medium/hard), deterministic from date seed. Streak tracking.
- **Leaderboard** — Top 50 local runs. Sort by score, wave, or kills. Seed sharing for challenge runs.
- **Mastery** — Per-upgrade and per-enemy mastery tiers (Bronze → Diamond).
- **Cosmetics** — 10 categories, 35+ items, 4 rarity tiers. Trails, death effects, bullet skins, titles.
- **Battle Pass** — 30-tier seasonal system with free + premium tracks.
- **Store** — Browse and purchase cosmetics with in-game coins earned from runs.

---

## Polish

- **Procedural Audio** — All SFX generated via Web Audio API oscillators and noise. Shoot, hit, death, level up, wave clear, dash, game over, victory. Plus an ambient drone soundtrack. Zero audio files.
- **CRT Filter** — Scanlines, vignette, subtle flicker. Toggle in settings.
- **Screen Shake & Flash** — Juice on every hit and level up.
- **Coach Report** — Post-run terminal overlay with CRT aesthetic.
- **Onboarding Tutorial** — First-run interactive walkthrough covering all core mechanics.
- **PWA** — Manifest + service worker. Install to homescreen, play offline.
- **Object Pooling** — Particle and vector pools to reduce GC pressure at high entity counts.
- **Settings** — LLM config (endpoint, key, model, token budget), audio sliders, visual toggles.

---

## Tech

| | |
|---|---|
| Language | Vanilla JavaScript (ES2022+) |
| Rendering | HTML5 Canvas 2D |
| Architecture | Custom ECS + Pub/Sub + Fixed Timestep |
| AI | Stress Model + Bandit Director + LLM integration |
| Audio | Web Audio API (procedural) |
| Dependencies | **None** |
| Build Step | **None** |
| Source Files | 40+ |

---

## What I'd Do Next

- **Unit tests** — The ECS, physics, and card systems are pure functions. Perfect candidates.
- **TypeScript migration** — Catch the API mismatches at compile time instead of runtime.
- **Sprite assets** — Currently everything is code-rendered shapes. Sprites would elevate the look.
- **Netcode** — The seeded RNG + fixed timestep was chosen specifically to enable future replay/spectator features.
- **Cloud leaderboard** — Currently local only. A simple serverless function could power global rankings.
- **More enemy types** — The FSM brain system makes adding new enemies straightforward.

---

*Built by Ayoub Chamakhi — 2026*
