# SURGE — Design & Architecture Document

> A phone-friendly, top-down 2D bullet-heaven with an adaptive AI Director.
> Hackathon-quality demo. Retro handheld aesthetic. Zero default cost.

---

## 1. CONCEPT IN ONE PARAGRAPH

**SURGE** is a wave-survival bullet-heaven played portrait-mode on a phone (or desktop). You pilot a small craft in a confined arena, auto-firing into escalating swarms while dodging dense projectile patterns. Every few waves you pick one of three upgrades to build toward a "broken" power fantasy. What makes it different: the waves aren't scripted — they're chosen by an **AI Director** that reads your play style and adapts encounter composition in real time, using a structured "encounter card" system. After each run (death or victory), a **Coach** agent analyzes your telemetry and delivers a short natural-language report with specific improvement tips. Three Director modes let the player choose between deterministic classic play, offline adaptive AI, or an optional LLM-powered director that explains its reasoning — all with zero default API cost.

---

## 2. WHY THIS DEMO IS COMPELLING

| Hook | Why it works |
|---|---|
| **Bullet-heaven is addictive** | Proven loop: dodge, grow, dominate, die, retry. Sessions are 5-15 min. |
| **Director you can _feel_** | Player notices the game responding — "it sent flankers because I was camping." |
| **Coach creates retention** | Post-run report gives a reason to play again: "beat your predictability score." |
| **Three AI modes = live demo story** | Toggle between Classic → Adaptive → LLM live to show escalating intelligence. |
| **Runs entirely in a browser** | `index.html` — open it, play it. No install, no server, no build step. |
| **Phone-first touch UX** | Portrait mode, virtual joystick, auto-fire. Feels native. |

---

## 3. CORE GAME LOOP

```
┌────────────────────────────────────────────────┐
│                   RUN START                     │
│  Player picks Director mode (Classic/Adaptive/  │
│  LLM) and optional loadout.                     │
└──────────────────┬─────────────────────────────┘
                   ▼
         ┌─────────────────┐
    ┌───►│   WAVE N BEGIN   │◄──────────────────┐
    │    └────────┬────────┘                     │
    │             ▼                              │
    │    Director selects 1-3                    │
    │    Encounter Cards for                     │
    │    this wave based on                      │
    │    mode + telemetry.                       │
    │             ▼                              │
    │    ┌─────────────────┐                     │
    │    │   COMBAT PHASE   │                    │
    │    │ Enemies spawn per │                    │
    │    │ card schedule.    │                    │
    │    │ Player dodges,    │                    │
    │    │ shoots, uses      │                    │
    │    │ ability. Telemetry│                    │
    │    │ records everything│                    │
    │    └────────┬────────┘                     │
    │             ▼                              │
    │    Wave cleared?───No──► Player dies?       │
    │         │                    │              │
    │        Yes                  Yes             │
    │         ▼                    ▼              │
    │    Every 3 waves:      ┌──────────┐        │
    │    UPGRADE PICK ──────►│ RUN END  │        │
    │    (choose 1 of 3)     │ Coach    │        │
    │         │              │ Report   │        │
    │         ▼              └──────────┘        │
    │    Boss wave every                         │
    │    10 waves? ──Yes──► BOSS FIGHT ──────────┘
    │         │
    │        No
    └─────────┘
```

**Session length target**: 8-15 minutes for an average run, ~25 waves.

---

## 4. AGENT ARCHITECTURE

Seven agents with clear boundaries. Each is a standalone module with a defined interface — swappable, testable, mockable.

```
┌─────────────────────────────────────────────────────────┐
│                        MAIN LOOP                        │
│                      (engine.js)                        │
└──┬──────┬──────────┬───────────┬──────────┬─────────────┘
   │      │          │           │          │
   ▼      ▼          ▼           ▼          ▼
┌──────┐┌────────┐┌──────────┐┌───────┐┌───────────────┐
│ SIM  ││DIRECTOR││ENEMY     ││ COACH ││     UI        │
│AGENT ││ AGENT  ││BRAIN     ││ AGENT ││    AGENT      │
│      ││        ││ AGENT    ││       ││               │
│ECS,  ││Picks   ││Per-type  ││Collects││Renderer,     │
│phys, ││cards,  ││behavior  ││telem, ││HUD, menus,   │
│collis-││sets    ││patterns, ││builds ││touch input,  │
│ion,  ││stress  ││targeting,││report,││screen shake  │
│spawn ││targets ││formation ││drills ││              │
└──────┘└───┬────┘└──────────┘└───────┘└───────────────┘
            │                     │
            ▼                     ▼
     ┌─────────────┐     ┌──────────────┐
     │ LLM ADAPTER │     │  ANALYTICS   │
     │    AGENT    │     │    AGENT     │
     │ (optional)  │     │ Batches,     │
     │ Formats →   │     │ anonymizes,  │
     │ prompt,     │     │ transports   │
     │ parses,     │     │ events       │
     │ fallback    │     │              │
     └─────────────┘     └──────────────┘
```

### Agent Contracts

| Agent | Input | Output | Update Frequency |
|---|---|---|---|
| **SimAgent** | Entity commands, dt | Updated world state | Every frame (~60fps) |
| **DirectorAgent** | Telemetry snapshot, wave# | Encounter card picks + rationale | Once per wave (+ mid-wave adjustments) |
| **EnemyBrainAgent** | Enemy state, player pos, type | Velocity, fire commands | Every frame per enemy |
| **CoachAgent** | Full run telemetry log | Structured report + drill | Once at run end |
| **UIAgent** | World state, HUD data, events | Canvas draw calls, input events | Every frame |
| **LLMAdapterAgent** | Compact state JSON | Structured decision JSON | Every 3-5 waves (Mode 3 only) |
| **AnalyticsAgent** | Game events (kills, deaths, upgrades, purchases) | Batched event payloads | On run-end + session-end |

---

## 5. THE DIRECTOR — CORE DESIGN

### 5.1 Encounter Card System

The Director doesn't spawn enemies directly. It picks **Encounter Cards** — atomic, composable descriptions of a spawning event. This is the unit of reasoning for all three modes.

```js
// Example card
{
  id: "flanking_dashers",
  name: "Flanking Dashers",
  enemies: [{ type: "dasher", count: 6 }],
  formation: "pincer",        // spawn from two sides
  modifier: null,
  intensity: 5,               // 1-10 scale
  tags: ["pressure", "fast", "positional"],
  minWave: 4,                 // earliest wave this can appear
  description: "Six dashers charge from opposite flanks."
}
```

**Card pool**: ~30-40 cards covering all enemy types, formations, and modifiers. Cards combine — playing "flanking_dashers" + "orbital_shields" in the same wave creates emergent difficulty.

**Card modifiers** (overlays the Director can apply to any card):
- `+speed` — enemies 25% faster
- `+density` — 50% more enemies
- `+armored` — enemies take 2 hits
- `+splitOnDeath` — enemies split when killed
- `+darkened` — reduced visibility radius

### 5.2 Stress Model

The Director maintains a real-time **stress score** (0-100) computed from:

| Signal | Weight | What it measures |
|---|---|---|
| HP trend | 25% | Is player losing health? (stress ↑) |
| Dodge proximity | 20% | How close are near-misses? (stress ↑) |
| Screen density | 20% | Projectiles + enemies on screen |
| Kill speed | 15% | Time-to-clear current spawns |
| Ability cooldown state | 10% | Are abilities available or on CD? |
| Upgrade power level | 10% | How "built" is the player? |

The Director targets a **stress curve** — a desired stress level per wave:

```
Stress
100│                          ╱Boss
   │                    ╱──╲╱
 70│              ╱──╲╱      ──╲
   │        ╱──╲╱                ╲
 40│  ╱──╲╱
   │╱
 10│
   └──────────────────────────────── Wave
    1    5    10   15   20   25
```

The curve has deliberate **tension-release cycles** — hard wave → breathing room → harder wave. This creates the rhythm of a great action game.

### 5.3 Three Director Modes

#### MODE 1: Classic (Offline, Deterministic)

- Card sequence is **pre-authored** and fixed per seed.
- Stress curve is predetermined — no adaptation.
- RNG seeded → identical runs with same seed → speedrun-friendly.
- Director is essentially a lookup table: `wave# → cards[]`.
- **Cost: $0. Complexity: trivial.**

#### MODE 2: Adaptive (Offline, Heuristic)

- Director uses a **rule-based policy** with the stress model:
  ```
  IF current_stress > target_stress + 15:
      pick lower-intensity cards, delay next spawn
  ELIF current_stress < target_stress - 15:
      pick higher-intensity cards, add modifier overlay
  ELSE:
      pick cards matching target intensity from eligible pool
  ```
- Uses a **softmax bandit** for card selection: cards that successfully brought stress toward target get higher selection weight over time.
- Tracks what the **player is weak against** (e.g., high damage from orbitors) and occasionally leans into it, but with a fairness cap (no more than 40% of a wave can be the "exploit" type).
- Mid-wave micro-adjustments: if stress spikes dangerously, slow spawn rate by 20%. If stress drops (player nuked everything), accelerate remaining spawns.
- **Cost: $0. Complexity: moderate — ~200 lines of tuned heuristics.**

#### MODE 3: LLM Director (Online, Optional)

- Every **3-5 waves**, the LLMAdapterAgent sends a compact state summary:
  ```json
  {
    "wave": 12,
    "hp": 0.65,
    "stress_avg_last_3": 58,
    "stress_target": 65,
    "build": ["spread_shot_2", "dash_cd_1", "magnet"],
    "weakness": { "orbitor": 0.42, "dasher": 0.28 },
    "predictability": 0.7,
    "last_cards": ["swarm_drifters", "orbital_ring"],
    "available_cards": ["flanking_dashers", "shielded_advance", "splitter_burst", "boss_orbitor_king"],
    "notes": "Player tends to circle clockwise. Under-uses dash."
  }
  ```
  (~150-200 input tokens)

- LLM responds with:
  ```json
  {
    "cards": ["flanking_dashers", "shielded_advance"],
    "modifiers": { "flanking_dashers": "+speed" },
    "rationale": "Player camps top-right and circles CW. Pincer dashers from flanks will force movement. Shielded enemies punish spray-and-pray spread shot.",
    "tip": "Try dashing through the flankers instead of retreating."
  }
  ```
  (~80-100 output tokens)

- **System prompt** is ~300 tokens, cached/reused. Constrains the LLM:
  - Must pick from available cards only
  - Cannot exceed intensity budget for the wave
  - Must provide a rationale
  - Fairness rules enforced (max exploit %, no instant-kill combos)

- **Fallback**: if API call fails or times out (>2s), seamlessly use Adaptive mode for that wave. Player never notices.

- **Cost estimate per run** (~25 waves, LLM queried ~6 times):
  - ~6 calls × 500 tokens = 3,000 tokens
  - GPT-4o-mini: ~$0.002/run
  - GPT-4o: ~$0.03/run
  - Local Ollama (Llama 3.1 8B): $0.00/run

- **Multi-agent LLM pattern** (premium mode enhancement): split into a **Planner** (picks cards) and **Critic** (evaluates fairness). The Critic reviews the Planner's picks and can veto. This burns ~2× tokens but produces more interesting decisions. Enabled only when user opts into premium mode.

---

## 6. THE COACH — POST-RUN INTELLIGENCE

### What it tracks (per run):

| Metric | How |
|---|---|
| **Movement heatmap** | Discretize arena into 8×12 grid, count frames per cell |
| **Predictability score** | Autocorrelation of movement direction over sliding windows |
| **Dodge timing** | Distribution of nearest-miss distances per wave |
| **Ability usage timing** | When in wave lifecycle abilities are activated (early/mid/late) |
| **Damage source breakdown** | % of damage taken per enemy type |
| **Kill efficiency** | Kills-per-second per enemy type, upgrade effectiveness |
| **Director decisions** | What cards were played, what the Director thought |

### Report format (shown in-game after death/victory):

```
╔══════════════════════════════════════╗
║         RUN REPORT — Wave 18        ║
╠══════════════════════════════════════╣
║                                     ║
║  PATTERNS DETECTED                  ║
║  ● You circle clockwise 73% of     ║
║    the time — enemies will read     ║
║    this.                            ║
║  ● Dash used 1.8s late vs optimal  ║
║    window on average.               ║
║  ● Top-right corner camped for     ║
║    38% of run.                      ║
║                                     ║
║  BIGGEST THREATS                    ║
║  ● Orbitors dealt 42% of damage    ║
║  ● Dashers dealt 28% of damage     ║
║                                     ║
║  DIRECTOR NOTES                     ║
║  "Started sending flankers at W12   ║
║   because you stopped moving.       ║
║   Shielded enemies at W15 punished  ║
║   your spread shot."                ║
║                                     ║
║  SUGGESTED DRILL                    ║
║  ► Practice: Counter-clockwise      ║
║    movement waves (3 min drill)     ║
║                                     ║
╚══════════════════════════════════════╝
```

### Offline vs LLM Coach:

- **Offline**: Report is template-driven from telemetry data. Fixed phrases, fill-in-the-blanks. Still very useful.
- **LLM (optional)**: Send telemetry summary to LLM at run end, get a natural-language paragraph. One call, ~500 tokens total. Adds flavor but isn't essential.

---

## 7. ENEMY BESTIARY

| Type | Behavior | Projectiles | Threat Profile |
|---|---|---|---|
| **Drifter** | Slow homing, seeks player lazily | None (contact damage) | Low per-unit, dangerous in swarms |
| **Dasher** | Pauses, telegraphs, charges in a line | None (contact) | Punishes stationary play |
| **Orbitor** | Circles player at fixed radius | Fires inward periodically | Sustained DPS, hard to ignore |
| **Sprayer** | Stationary turret | Fires bullet fans | Area denial, zone control |
| **Splitter** | Moves toward player | Splits into 2-3 mini versions on death | Punishes kill order mistakes |
| **Shielder** | Escorts other enemies | Projects shield aura on nearby allies | Force priority targeting |
| **Elite** (any type) | Larger, more HP, enhanced pattern | Type-dependent, more dangerous | Mini-boss every 5 waves |
| **Boss** | Unique per-boss mechanics | Multi-phase patterns | Every 10 waves, run milestone |

All enemies are drawn procedurally — geometric shapes with a few accent pixels. No sprite sheets needed.

---

## 8. UPGRADE SYSTEM

Every **3 waves** (and after boss kills), player picks **1 of 3 random upgrades**:

### Weapon Tree
| Upgrade | Effect |
|---|---|
| Spread Shot | +1 projectile per volley (fan pattern) |
| Pierce | Projectiles pass through 1 extra enemy |
| Fire Rate | 20% faster shooting |
| Damage | 25% more damage per hit |
| Homing | Slight tracking on projectiles |
| Ricochet | Projectiles bounce once off arena walls |

### Defense Tree
| Upgrade | Effect |
|---|---|
| Shield | Absorb 1 hit, recharges after 10s |
| Dash Cooldown | Dash recharges 30% faster |
| Slow Aura | Enemies within close range move 20% slower |
| Regen | Heal 1 HP every 20s |
| Armor | Reduce all damage by 1 (min 1) |

### Utility Tree
| Upgrade | Effect |
|---|---|
| Magnet | XP/pickups attracted from further away |
| Nuke | Clear-screen bomb, usable once per 5 waves |
| Decoy | Drop a decoy that draws enemy attention for 5s |
| Scanner | Brief flash showing enemy spawn points |

Upgrades stack — getting Spread Shot 3 times = firing 4 projectiles. Max stack of 3 per upgrade. This creates the "build diversity" that makes bullet-heavens replayable.

---

## 9. VISUAL & AUDIO IDENTITY

### Retro Handheld Aesthetic
- **Resolution**: Render at 240×400 logical pixels (portrait), scaled up to device.
- **Palette**: 16-color palette inspired by GBC. Two palettes shipped: "Moss" (green tint) and "Ember" (warm).
- **Rendering**: All procedural — shapes, lines, fills. No external image assets.
- **Effects**: Screen shake (on hits), flash (on damage), particle puffs (on kills), slowmo (on boss phase transitions).
- **Scanline filter**: Optional CRT overlay (CSS).
- **Font**: Monospace, bitmap-style (rendered via canvas or a single embedded pixel font).

### Audio (Stretch Goal)
- Web Audio API for procedural SFX (blips, booms, whooshes).
- No music files — either procedural ambient drone or silent.

---

## 10. CONTROLS

### Phone (Primary)
- **Left thumb**: Virtual joystick for 360° movement
- **Right thumb**: Tap for ability activation (dash by default)
- **Auto-fire**: Always on — weapon shoots toward nearest enemy (or cursor direction)
- **Swipe right edge**: Open pause menu

### Desktop (Secondary)
- **WASD / Arrow keys**: Movement
- **Mouse aim**: Weapon fires toward cursor
- **Space / Click**: Ability
- **Esc**: Pause

---

## 11. TECH STACK

| Layer | Choice | Rationale |
|---|---|---|
| **Runtime** | Vanilla JS + HTML5 Canvas | Zero dependencies, opens in any browser, phone-friendly |
| **Architecture** | Lightweight ECS (custom, ~100 lines) | Clean separation, easy to extend, good for agent boundaries |
| **State management** | Simple event bus between agents | Decoupled communication, agents subscribe to what they need |
| **LLM integration** | Fetch API → any OpenAI-compatible endpoint | Works with OpenAI, Ollama, LM Studio, Groq, etc. |
| **Build** | None — raw ES modules, served via file:// or any static server | Hackathon-fast, no toolchain friction |
| **Deployment** | Single folder, `index.html` entry point | Drop on GitHub Pages, Netlify, or open locally |
| **Testing** | Can add lightweight tests per agent (optional) | Agent boundaries make unit testing natural |

---

## 12. FILE STRUCTURE

```
surge-game/
├── index.html                 # Entry point, canvas + UI shell
├── style.css                  # Minimal styling, CRT filter, touch layout
├── main.js                    # Bootstrap, game state machine
│
├── src/
│   ├── core/
│   │   ├── engine.js          # Game loop (fixed timestep + render interpolation)
│   │   ├── ecs.js             # Entity-Component-System (~100 lines)
│   │   ├── events.js          # Lightweight pub/sub event bus
│   │   ├── input.js           # Unified touch + keyboard input
│   │   └── physics.js         # AABB + circle collision, spatial hash
│   │
│   ├── agents/
│   │   ├── director.js        # AI Director (all 3 modes in one module)
│   │   ├── enemy-brain.js     # Per-type enemy behavior logic
│   │   ├── coach.js           # Telemetry collector + report generator
│   │   ├── llm-adapter.js     # LLM API bridge (format, call, parse, fallback)
│   │   └── analytics.js       # Analytics Agent — event batching, consent, transport
│   │
│   ├── game/
│   │   ├── player.js          # Player entity, stats, abilities
│   │   ├── enemies.js         # Enemy type definitions + factory
│   │   ├── projectiles.js     # Player + enemy bullet management
│   │   ├── upgrades.js        # Upgrade pool, stacking, selection
│   │   ├── encounter-cards.js # Full card deck definitions
│   │   ├── arena.js           # Arena bounds, zones, spawn points
│   │   ├── progression.js     # Pilot rank, XP, mastery badges, achievements
│   │   ├── cosmetics.js       # Cosmetic definitions, unlock state, equip logic
│   │   └── store.js           # Cosmetic store UI logic, bundles, season pass
│   │
│   ├── ui/
│   │   ├── renderer.js        # Canvas rendering pipeline
│   │   ├── hud.js             # HP bar, wave counter, score, stress meter
│   │   ├── menus.js           # Title, pause, game over, settings
│   │   ├── report-screen.js   # Post-run coach report display
│   │   ├── touch-controls.js  # Virtual joystick + ability button
│   │   ├── share-card.js      # Run Replay Card generator (shareable image)
│   │   └── leaderboard.js     # Leaderboard display (local + online)
│   │
│   └── config/
│       ├── balance.js         # All tuning constants (single source of truth)
│       ├── palettes.js        # Color palette definitions
│       ├── cards.js           # Encounter card data (importable deck)
│       ├── cosmetics.js       # Cosmetic item registry (all skins, trails, etc.)
│       └── achievements.js    # Achievement definitions + conditions
│
├── prompts/
│   ├── director-system.md     # LLM system prompt for Director (version-controlled)
│   └── coach-system.md        # LLM system prompt for Coach
│
└── DESIGN.md                  # This document
```

---

## 13. COST MODEL

### Default Path: $0.00/run (Modes 1 & 2)

- No server needed. Open `index.html` in a browser.
- Classic mode: fully deterministic encounters.
- Adaptive mode: heuristic Director uses local computation only.
- Coach report: template-driven, no LLM.
- This is the **complete, polished, fully playable game**.

### Cheap Path: ~$0.00/run (Mode 3 with local model)

- Run Ollama locally with Llama 3.1 8B or Phi-3.
- Point LLM adapter at `localhost:11434`.
- Same protocol as paid API — zero code change.
- Quality is slightly lower than paid models but still adds flavor.

### Premium Path: ~$0.002-0.05/run (Mode 3 with paid API)

- GPT-4o-mini: ~$0.002/run (~6 calls × 500 tokens)
- GPT-4o: ~$0.03/run (same call pattern, better reasoning)
- Claude Sonnet: ~$0.01/run
- Multi-agent (Planner + Critic): 2× above costs
- Player enters their own API key in settings — we never touch billing.

### Token Budget Enforcement

- Hard cap: Director prompt ≤ 250 input tokens, ≤ 150 output tokens.
- Coach prompt ≤ 400 input tokens, ≤ 300 output tokens.
- LLM calls are batched (every 3-5 waves), never per-frame.
- All LLM calls have a 3-second timeout with automatic fallback.

---

## 14. LLM INTEGRATION — QUALITY GUARDRAILS

| Guardrail | Implementation |
|---|---|
| **Structured I/O** | JSON schema for both request and response. LLM never sees free-form game state. |
| **Bounded decisions** | LLM picks from a provided list of available cards. Cannot invent enemies. |
| **Intensity budget** | Per-wave intensity cap enforced server-side. LLM suggestions that exceed are clamped. |
| **Fairness rules** | Max 40% of wave can exploit player weakness. No more than 2 modifiers per card. |
| **Validation layer** | LLMAdapterAgent validates JSON schema before passing to Director. Malformed = fallback. |
| **Prompt versioning** | System prompts live in `/prompts/` as Markdown files — easy to iterate without touching game code. |
| **Deterministic fallback** | Any LLM failure → Adaptive mode for that decision. Player experience is seamless. |
| **Rate limiting** | Max 1 LLM call per 20 seconds regardless of wave pacing. |

---

## 15. MULTI-AGENT IN-GAME CONCEPT

Beyond the development architecture, the "agent" concept is visible to the player:

1. **The Director is named.** In-game, it's called "The Director." When the player picks LLM mode, the Director's rationale text appears as a brief message between waves:
   > *"Director: Sending flankers — you've been camping that corner."*

2. **The Coach is named.** The post-run report is from "The Coach." It has personality:
   > *"Coach: Your clockwise habit is becoming a liability. Try this drill."*

3. **Future extension: The Rival.** A potential stretch goal — an "enemy general" agent that the player can unlock, which has persistent memory across runs and develops counter-strategies over time.

---

## 16. WHAT MAKES EACH MODE FEEL DIFFERENT

| Aspect | Classic | Adaptive | LLM Director |
|---|---|---|---|
| Encounter pacing | Fixed pattern | Responsive | Strategic + explained |
| Player feels | "I learned the pattern" | "It's reading me" | "It's thinking about me" |
| Between-wave text | Wave number only | Brief auto-text | Director's rationale quote |
| Replayability driver | Mastery + seed variation | Adaptation keeps it fresh | Curiosity about AI reasoning |
| Coach report | Template stats | Template + insights | Natural language analysis |

---

## 17. GAMIFICATION — PLAYER ATTRACTION & RETENTION

### 17.1 Progression Systems (Cross-Run)

| System | What it does | Why it hooks |
|---|---|---|
| **Pilot Rank** | XP earned per run (waves survived × performance multiplier). Ranks from Cadet → Commander → Ace → Legend. | Visible progression even on bad runs. |
| **Mastery Badges** | Per-enemy-type kill milestones (e.g., "Dasher Slayer III — Kill 500 dashers"). | Completionist hook, directs play variety. |
| **Run Streaks** | Consecutive daily runs tracked. Streak bonuses unlock cosmetic rewards. | Daily retention driver. |
| **Achievement Wall** | ~40 achievements (first boss kill, survive 30 waves, win with no upgrades, etc.). | Discovery + bragging rights. |
| **Seasonal Challenges** | Weekly rotating challenges ("Win a run using only defense upgrades"). Reward: exclusive trail effects. | Time-limited urgency, variety forcing. |
| **Leaderboards** | Per-mode leaderboards: highest wave, fastest boss kill, lowest damage taken. Seeded Classic mode = fair comparison. | Competitive hook. |
| **Coach Improvement Score** | Coach tracks improvement across runs: "Your predictability dropped from 73% → 51% over 5 runs." | Tangible skill growth. |

### 17.2 Social & Viral

| Feature | How |
|---|---|
| **Run Replay Card** | Auto-generated shareable image: build path, wave reached, Coach quote, Director MVP card. One tap → share to socials. |
| **Seed Sharing** | Classic mode seeds are shareable strings. "Try seed FURY-2847 — that Wave 15 is brutal." |
| **Ghost Runs** | In Classic mode, race against your own ghost (faint outline of previous best run's position). |
| **Challenge Links** | Generate a link: "Beat my Wave 22 run on seed X." Opens game pre-configured. |

---

## 18. MONETIZATION — COSMETICS ONLY (NO PAY-TO-WIN)

### Philosophy
Like League of Legends: the full gameplay is free. Money buys **looks**, **personality**, and **convenience** — never power. A player who spends $0 and a player who spends $50 have identical gameplay capability.

### 18.1 Cosmetic Store

| Category | Examples | Price Range |
|---|---|---|
| **Pilot Skins** | Geometric shape variants for the player craft (hexagon, star, diamond, arrow). Each has idle + dash animations. | $0.99 - $2.99 |
| **Trail Effects** | Dash/movement trails — neon, pixel dust, fire, glitch, rainbow, shadow. | $0.99 - $1.99 |
| **Projectile Styles** | Bullet shapes/colors — arrows, orbs, lightning bolts, musical notes, sakura petals. | $0.99 - $1.99 |
| **Death Effects** | What happens when enemies die — pixel explosion, vaporize, confetti, skull puff, dissolve. | $0.99 - $1.99 |
| **Color Palettes** | Additional 16-color palettes beyond the 2 free ones — "Neon Tokyo", "Ocean", "Sunset", "Monochrome", "Vaporwave". | $0.99 each |
| **Arena Skins** | Background patterns/themes — circuit board, star field, hex grid, underwater, lava. | $1.99 - $2.99 |
| **Director Voices** | Different personality for Director between-wave text — "Drill Sergeant", "Anime Rival", "Chill Sensei", "Chaos Agent". | $1.99 |
| **Coach Personas** | Different Coach report personality — "Sports Coach", "Wise Mentor", "Sarcastic AI", "Motivational Speaker". | $1.99 |
| **Kill Counters** | Visible on-screen kill counter styles — digital, handwritten, roman numerals, binary. | $0.99 |
| **Emotes** | Quick expression animations on your craft — taunt, GG, focus, panic. Tap during play. | $0.49 each |

### 18.2 Bundles & Battle Pass

| Offering | Contents | Price |
|---|---|---|
| **Starter Bundle** | 1 pilot skin + 1 trail + 1 palette + 1 Director voice | $4.99 |
| **Season Pass (30 days)** | 30-tier reward track. Free tier gives 10 items, paid tier gives 30. All cosmetic. Progressed by playing. | $4.99 |
| **Founder's Pack** | All launch cosmetics + "Founder" badge + exclusive palette "Genesis" | $14.99 |

### 18.3 Earnable (Free) Cosmetics

Not everything is paid. Free players earn cosmetics through gameplay:

| Source | Reward |
|---|---|
| Pilot Rank milestones | Unlock 1 skin per rank tier (4 free skins total) |
| Achievement completion | Specific achievements unlock specific cosmetics |
| Seasonal challenges | Weekly challenge completions → exclusive trail/palette |
| Run streaks (7-day, 30-day) | Streak milestones unlock death effects |
| Coach improvement milestones | "Reduced predictability by 50%" → unlock Coach persona |

### 18.4 Implementation

- **No server required for purchases in MVP.** Use localStorage receipts + honor system initially. Later: integrate with a lightweight payment provider (Stripe, RevenueCat for mobile).
- **Cosmetic registry**: all cosmetics defined in `src/config/cosmetics.js`. Each has an ID, type, unlock condition (purchase/earn), and render function.
- **No loot boxes. No gacha. No RNG purchases.** Players see what they buy. This is a deliberate anti-predatory choice.

---

## 19. PLAYER ANALYTICS — OWNER DASHBOARD

### 19.1 Purpose

You (the game owner) need to understand your playerbase to make good product decisions. All analytics are privacy-respecting, aggregated, and opt-in.

### 19.2 What We Track

#### Session Analytics
| Metric | Description |
|---|---|
| **DAU/WAU/MAU** | Daily/Weekly/Monthly active players |
| **Session length** | Average, median, p95 play session duration |
| **Sessions per user per day** | How often players come back in a day |
| **Retention (D1/D7/D30)** | % of players who return after 1/7/30 days |
| **Churn signals** | Players who haven't returned in 7+ days |

#### Gameplay Analytics
| Metric | Description |
|---|---|
| **Wave distribution** | Histogram: what wave do most runs end on? Where's the difficulty cliff? |
| **Mode popularity** | % of runs in Classic vs Adaptive vs LLM mode |
| **Upgrade pick rates** | Which upgrades are chosen most? Which are ignored? (balance signal) |
| **Enemy type lethality** | Which enemies kill players most? At which waves? |
| **Build win rates** | Which upgrade combinations correlate with reaching Wave 25+? |
| **Boss clear rates** | % of players who reach/clear each boss |
| **Stress curve actuals** | Average stress curve per mode — is the Director doing its job? |

#### Monetization Analytics
| Metric | Description |
|---|---|
| **Conversion rate** | % of players who make any purchase |
| **ARPU / ARPPU** | Average revenue per user / per paying user |
| **Top-selling items** | Which cosmetics sell best? |
| **Time-to-first-purchase** | How many sessions before first buy? |
| **Purchase triggers** | What event preceded a purchase? (boss kill, rank up, etc.) |

#### Engagement Quality
| Metric | Description |
|---|---|
| **Skill distribution** | Histogram of best wave reached across all players |
| **Improvement velocity** | How fast are players improving? (Coach data) |
| **Director mode conversion** | Do Classic players try Adaptive? Do Adaptive players try LLM? |
| **Social shares** | How many Run Replay Cards are generated/shared? |
| **Seed sharing** | How often are challenge links created/clicked? |
| **Feature discovery** | % of players who find Coach report, Director mode toggle, cosmetic store |

### 19.3 Implementation Architecture

```
┌───────────────┐     ┌──────────────────┐     ┌────────────────────┐
│   GAME CLIENT │────►│  ANALYTICS AGENT │────►│  ANALYTICS BACKEND │
│               │     │  (src/agents/    │     │  (lightweight)     │
│  Events fire  │     │   analytics.js)  │     │                    │
│  on key       │     │                  │     │  Option A: Simple  │
│  actions      │     │  Batches events  │     │  JSON endpoint     │
│               │     │  Respects opt-in │     │  (Vercel function) │
│               │     │  Sends on run-end│     │                    │
│               │     │  + session-end   │     │  Option B: Free    │
│               │     │                  │     │  tier analytics    │
│               │     │  Local fallback: │     │  (PostHog, Plaus-  │
│               │     │  localStorage    │     │  ible, or Umami)   │
└───────────────┘     └──────────────────┘     └────────┬───────────┘
                                                        │
                                                        ▼
                                               ┌────────────────────┐
                                               │  OWNER DASHBOARD   │
                                               │                    │
                                               │  /admin/dashboard  │
                                               │  Password-protected│
                                               │  Real-time charts  │
                                               │  Exportable CSV    │
                                               └────────────────────┘
```

### 19.4 Analytics Agent Design

The **AnalyticsAgent** is the 7th agent in the system:

| Agent | Input | Output | Update Frequency |
|---|---|---|---|
| **AnalyticsAgent** | Game events (kills, deaths, upgrades, purchases, sessions) | Batched event payloads | On run-end + session-end |

**Key principles:**
- **Opt-in only**: first launch shows a clear "Help us improve SURGE?" prompt. No tracking without consent.
- **Batched, not streaming**: events are collected locally and sent in one payload at run-end. No per-frame tracking.
- **Offline fallback**: if no backend, analytics accumulate in localStorage. Can be exported as JSON.
- **Anonymous IDs**: no PII collected. Player gets a random UUID. No email, no name, no device fingerprint.
- **Minimal payload**: ~1-2KB per run summary. No raw telemetry — pre-aggregated locally.

### 19.5 Dashboard Priorities (What You'll Actually Look At)

1. **Health dashboard**: DAU trend, retention curve, session length distribution
2. **Balance dashboard**: wave death distribution, upgrade pick rates, enemy lethality matrix
3. **Revenue dashboard**: conversion funnel, top sellers, ARPU trend
4. **AI dashboard**: mode popularity, stress curve accuracy, Director/Coach usage
5. **Growth dashboard**: share rates, seed link clicks, viral coefficient

### 19.6 Privacy & Compliance

- GDPR-friendly: opt-in, anonymous, deletable
- No third-party trackers loaded by default
- Analytics toggle in Settings accessible at any time
- Data retention: 90 days rolling, then aggregated into summary stats

---

## 20. DEVELOPMENT PHASES (UPDATED)

### Phase 1 — Core Loop (playable in browser)
- Engine, ECS, rendering, input
- Player movement + auto-fire
- 3 basic enemy types (Drifter, Dasher, Sprayer)
- Basic wave spawning (Classic mode Director)
- HP, death, restart

### Phase 2 — Game Feel + Content
- All 7 enemy types
- Encounter card system
- Upgrade system (pick 1 of 3)
- Screen shake, particles, visual juice
- HUD, pause menu, game over screen
- Touch controls

### Phase 3 — Adaptive Director + Telemetry
- Stress model implementation
- Adaptive mode Director logic
- Telemetry collection system
- Coach report (template-driven)
- Elite/Boss waves

### Phase 4 — LLM Integration
- LLM Adapter Agent
- Director system prompt
- Coach system prompt
- Settings UI (API key, model selection)
- Fallback logic + validation
- Multi-agent Planner/Critic (premium enhancement)

### Phase 5 — Gamification & Retention
- Pilot Rank progression system
- Achievement wall (40 achievements)
- Mastery badges per enemy type
- Run streaks + daily challenges
- Leaderboards (per-mode)
- Ghost runs for Classic mode
- Run Replay Card (shareable image generation)
- Seed sharing + challenge links

### Phase 6 — Monetization (Cosmetics)
- Cosmetic registry + unlock system
- Pilot skins + trail effects + projectile styles
- Death effects + arena skins + palettes
- Director voices + Coach personas
- Bundle/Season Pass framework
- Payment integration (Stripe/RevenueCat)
- Free earnable cosmetics pipeline

### Phase 7 — Analytics & Dashboard
- Analytics Agent implementation
- Opt-in consent flow
- Event batching + local storage fallback
- Analytics backend (Vercel function or PostHog)
- Owner dashboard (health, balance, revenue, AI, growth)
- Export tools (CSV, JSON)

### Phase 8 — Polish & Launch
- Performance optimization (object pooling, spatial hash)
- Second color palette
- CRT filter
- Drill mode (Coach practice suggestions)
- Onboarding tutorial (first 3 waves guided)
- App store / PWA packaging
- Marketing page

---

## 21. KEY DESIGN DECISIONS SUMMARY

| Decision | Choice | Alternatives considered |
|---|---|---|
| **Rendering** | Canvas 2D, procedural shapes | Pixi.js (heavier), SVG (slower for many entities) |
| **Architecture** | Lightweight custom ECS | OOP hierarchy (tangled), full ECS lib like bitecs (overkill) |
| **Director reasoning unit** | Encounter Cards | Per-enemy spawning (too granular), wave templates (too rigid) |
| **Stress model** | Weighted multi-signal score | Simple HP-based (too crude), ML model (expensive/complex) |
| **LLM call frequency** | Every 3-5 waves | Per-frame (insane cost), per-wave (unnecessary), per-run only (too infrequent) |
| **LLM I/O format** | Compact JSON | Natural language (unparseable), function calling (vendor-locked) |
| **Offline adaptive algo** | Rule-based + softmax bandit | Reinforcement learning (complex to tune), neural net (overkill) |
| **Touch controls** | Virtual joystick + auto-fire | Tap-to-move (imprecise), tilt (unreliable) |
| **Build system** | None (ES modules) | Vite/Webpack (adds friction for hackathon demo) |
| **Audio** | Web Audio procedural SFX | Audio files (size), no audio (less juicy) |
| **Monetization** | Cosmetics only, no pay-to-win | Gameplay unlocks (splits playerbase), loot boxes (predatory) |
| **Analytics** | Opt-in, anonymous, batched | Always-on tracking (privacy), per-frame (expensive), none (blind) |

---

*This document is the source of truth for SURGE. Implementation follows this architecture.*