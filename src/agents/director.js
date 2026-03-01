/**
 * @module agents/director
 * @description The AI Director — heart of SURGE's adaptive difficulty.
 *
 * Three modes:
 *   Mode 1 (Classic):  Pre-authored wave sequence, deterministic per seed
 *   Mode 2 (Adaptive): Rule-based + softmax bandit, reads player stress
 *   Mode 3 (LLM):      Queries LLM every 3 waves, falls back to Adaptive
 *
 * Phase 1 implements Mode 1 (Classic) only.
 *
 * The Director doesn't spawn enemies directly — it picks Encounter Cards,
 * which describe what to spawn. This is the unit of reasoning.
 */

import { DIRECTOR, ENEMIES } from '../config/balance.js';
import world from '../core/ecs.js';
import bus from '../core/events.js';
import { spawnEnemy, getEnemyCount } from '../game/enemies.js';
import { getRandomSpawnPoint, getPincerSpawnPoints, getSurroundSpawnPoints } from '../game/arena.js';

// ─── Director State ──────────────────────────────────────────

const state = {
  /** Current mode: 'classic' | 'adaptive' | 'llm' */
  mode: 'classic',
  /** Current wave number (1-based) */
  wave: 0,
  /** Is a wave currently active? */
  waveActive: false,
  /** Current stress score (0-100) */
  stress: 0,
  /** Spawn queue for current wave */
  spawnQueue: [],
  /** Timer for next spawn in queue */
  spawnTimer: 0,
  /** Cards played this wave */
  currentCards: [],
  /** History of decisions */
  history: [],
  /** Wave pause timer (between waves) */
  pauseTimer: 0,
  /** Total enemies spawned this wave */
  waveEnemiesSpawned: 0,
  /** Total enemies killed this wave */
  waveEnemiesKilled: 0,
  /** Is the game in upgrade selection phase? */
  upgradePhase: false,
  /** RNG seed for deterministic Classic mode */
  seed: 0,
  /** Seeded RNG state */
  _rng: null,
  /** Boss active flag */
  bossActive: false,
  /** Run in progress? */
  running: false,
};

// ─── Seeded RNG (Mulberry32) ─────────────────────────────────

/**
 * Simple seeded PRNG (Mulberry32).
 * Produces deterministic sequences for Classic mode replay.
 * @param {number} seed
 * @returns {() => number} Returns 0..1
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Encounter Card Definitions (Phase 1 — basic set) ────────

/**
 * @typedef {object} EncounterCard
 * @property {string} id
 * @property {string} name
 * @property {Array<{type: string, count: number}>} enemies
 * @property {string} formation - 'random' | 'pincer' | 'surround' | 'cluster'
 * @property {number} intensity - 1-10
 * @property {string[]} tags
 * @property {number} minWave
 */

/** @type {EncounterCard[]} */
const CARD_DECK = [
  // ── Wave 1+ (easy) ──
  {
    id: 'drifter_trickle',
    name: 'Drifter Trickle',
    enemies: [{ type: 'drifter', count: 4 }],
    formation: 'random',
    intensity: 1,
    tags: ['swarm', 'easy'],
    minWave: 1,
  },
  {
    id: 'drifter_pack',
    name: 'Drifter Pack',
    enemies: [{ type: 'drifter', count: 8 }],
    formation: 'cluster',
    intensity: 2,
    tags: ['swarm'],
    minWave: 1,
  },
  {
    id: 'single_dasher',
    name: 'Lone Dasher',
    enemies: [{ type: 'dasher', count: 1 }],
    formation: 'random',
    intensity: 2,
    tags: ['pressure', 'fast'],
    minWave: 2,
  },
  // ── Wave 3+ ──
  {
    id: 'dasher_pair',
    name: 'Dasher Duo',
    enemies: [{ type: 'dasher', count: 2 }],
    formation: 'pincer',
    intensity: 3,
    tags: ['pressure', 'fast', 'positional'],
    minWave: 3,
  },
  {
    id: 'drifter_swarm',
    name: 'Drifter Swarm',
    enemies: [{ type: 'drifter', count: 12 }],
    formation: 'surround',
    intensity: 3,
    tags: ['swarm', 'overwhelming'],
    minWave: 3,
  },
  {
    id: 'sprayer_post',
    name: 'Sprayer Turret',
    enemies: [{ type: 'sprayer', count: 1 }],
    formation: 'random',
    intensity: 3,
    tags: ['zoning', 'ranged'],
    minWave: 3,
  },
  // ── Wave 5+ ──
  {
    id: 'mixed_assault',
    name: 'Mixed Assault',
    enemies: [
      { type: 'drifter', count: 6 },
      { type: 'dasher', count: 2 },
    ],
    formation: 'random',
    intensity: 4,
    tags: ['mixed', 'pressure'],
    minWave: 5,
  },
  {
    id: 'flanking_dashers',
    name: 'Flanking Dashers',
    enemies: [{ type: 'dasher', count: 4 }],
    formation: 'pincer',
    intensity: 5,
    tags: ['pressure', 'fast', 'positional'],
    minWave: 5,
  },
  {
    id: 'sprayer_crossfire',
    name: 'Sprayer Crossfire',
    enemies: [{ type: 'sprayer', count: 2 }],
    formation: 'pincer',
    intensity: 5,
    tags: ['zoning', 'ranged', 'positional'],
    minWave: 5,
  },
  // ── Wave 8+ ──
  {
    id: 'drifter_flood',
    name: 'Drifter Flood',
    enemies: [{ type: 'drifter', count: 20 }],
    formation: 'surround',
    intensity: 5,
    tags: ['swarm', 'overwhelming'],
    minWave: 8,
  },
  {
    id: 'dasher_squad',
    name: 'Dasher Squad',
    enemies: [{ type: 'dasher', count: 6 }],
    formation: 'surround',
    intensity: 6,
    tags: ['pressure', 'fast'],
    minWave: 8,
  },
  {
    id: 'turret_alley',
    name: 'Turret Alley',
    enemies: [
      { type: 'sprayer', count: 3 },
      { type: 'drifter', count: 8 },
    ],
    formation: 'random',
    intensity: 6,
    tags: ['zoning', 'swarm', 'mixed'],
    minWave: 8,
  },
  // ── Wave 10+ (Boss waves) ──
  {
    id: 'boss_drifter_king',
    name: 'The Drifter King',
    enemies: [
      { type: 'drifter', count: 1, elite: false, boss: true },
      { type: 'drifter', count: 8 },
    ],
    formation: 'surround',
    intensity: 8,
    tags: ['boss', 'swarm'],
    minWave: 10,
  },
  // ── Wave 15+ ──
  {
    id: 'hell_wave',
    name: 'Hell Wave',
    enemies: [
      { type: 'drifter', count: 15 },
      { type: 'dasher', count: 4 },
      { type: 'sprayer', count: 2 },
    ],
    formation: 'surround',
    intensity: 8,
    tags: ['overwhelming', 'mixed'],
    minWave: 15,
  },
];

// ─── Classic Mode Wave Sequence ──────────────────────────────

/**
 * Pre-authored wave→cards mapping for Classic mode.
 * Provides a curated experience without AI.
 */
const CLASSIC_SEQUENCE = {
  1:  ['drifter_trickle'],
  2:  ['drifter_pack'],
  3:  ['single_dasher', 'drifter_trickle'],
  4:  ['dasher_pair'],
  5:  ['sprayer_post', 'drifter_pack'],
  6:  ['mixed_assault'],
  7:  ['flanking_dashers'],
  8:  ['drifter_swarm', 'single_dasher'],
  9:  ['sprayer_crossfire', 'drifter_pack'],
  10: ['boss_drifter_king'],
  11: ['turret_alley'],
  12: ['dasher_squad'],
  13: ['mixed_assault', 'sprayer_post'],
  14: ['drifter_flood'],
  15: ['hell_wave'],
  16: ['flanking_dashers', 'sprayer_crossfire'],
  17: ['dasher_squad', 'drifter_swarm'],
  18: ['turret_alley', 'dasher_pair'],
  19: ['hell_wave', 'single_dasher'],
  20: ['boss_drifter_king'], // Second boss (harder due to player build)
  21: ['drifter_flood', 'sprayer_crossfire'],
  22: ['hell_wave', 'dasher_pair'],
  23: ['turret_alley', 'flanking_dashers'],
  24: ['drifter_flood', 'dasher_squad'],
  25: ['hell_wave', 'sprayer_crossfire'],
  26: ['dasher_squad', 'drifter_flood'],
  27: ['hell_wave', 'turret_alley'],
  28: ['hell_wave', 'flanking_dashers'],
  29: ['hell_wave', 'dasher_squad'],
  30: ['boss_drifter_king'], // Final boss
};

// ─── Card Lookup ─────────────────────────────────────────────

/** @type {Map<string, EncounterCard>} */
const cardMap = new Map();
for (const card of CARD_DECK) {
  cardMap.set(card.id, card);
}

/**
 * Get a card by ID.
 * @param {string} id
 * @returns {EncounterCard|undefined}
 */
export function getCard(id) {
  return cardMap.get(id);
}

// ─── Director Public API ─────────────────────────────────────

/**
 * Initialize the Director for a new run.
 * @param {object} options
 * @param {string} [options.mode='classic'] - 'classic' | 'adaptive' | 'llm'
 * @param {number} [options.seed] - RNG seed (random if omitted)
 */
export function initDirector(options = {}) {
  state.mode = options.mode || 'classic';
  state.wave = 0;
  state.waveActive = false;
  state.stress = 0;
  state.spawnQueue = [];
  state.spawnTimer = 0;
  state.currentCards = [];
  state.history = [];
  state.pauseTimer = 0;
  state.waveEnemiesSpawned = 0;
  state.waveEnemiesKilled = 0;
  state.upgradePhase = false;
  state.bossActive = false;
  state.running = true;

  state.seed = options.seed ?? (Math.random() * 0xFFFFFFFF) | 0;
  state._rng = mulberry32(state.seed);

  // Listen for enemy deaths
  bus.on('enemy:death', _onEnemyDeath);

  bus.emit('director:init', { mode: state.mode, seed: state.seed });
}

/**
 * Start the next wave.
 */
export function startNextWave() {
  if (!state.running) return;

  state.wave++;
  state.waveActive = true;
  state.waveEnemiesSpawned = 0;
  state.waveEnemiesKilled = 0;
  state.spawnQueue = [];
  state.spawnTimer = 0;

  // Pick cards based on mode
  let cardIds;
  if (state.mode === 'classic') {
    cardIds = _classicPick(state.wave);
  } else {
    // Adaptive/LLM will be implemented in Phase 3/4
    cardIds = _classicPick(state.wave);
  }

  state.currentCards = cardIds;

  // Build spawn queue from cards
  for (const cardId of cardIds) {
    const card = cardMap.get(cardId);
    if (!card) continue;
    _enqueueCard(card);
  }

  const decision = {
    wave: state.wave,
    cards: cardIds,
    mode: state.mode,
    stress: state.stress,
  };
  state.history.push(decision);

  bus.emit('wave:start', state.wave);
  bus.emit('director:decision', decision);
}

/**
 * Update the Director each frame.
 * Handles spawn queue processing and wave transitions.
 * @param {number} dt
 */
export function updateDirector(dt) {
  if (!state.running) return;

  // ── Between-wave pause ──
  if (!state.waveActive && state.wave > 0 && !state.upgradePhase) {
    state.pauseTimer -= dt;
    if (state.pauseTimer <= 0) {
      // Check upgrade phase
      if (state.wave % DIRECTOR.WAVES_PER_UPGRADE === 0) {
        state.upgradePhase = true;
        bus.emit('upgrade:offered', state.wave);
        return;
      }
      startNextWave();
    }
    return;
  }

  if (state.upgradePhase) return;

  // ── Process spawn queue ──
  if (state.spawnQueue.length > 0) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const spawn = state.spawnQueue.shift();
      _executeSpawn(spawn);
      state.spawnTimer = DIRECTOR.SPAWN_DELAY_BASE;
    }
  }

  // ── Check wave clear ──
  if (state.waveActive && state.spawnQueue.length === 0 && getEnemyCount() === 0) {
    _onWaveClear();
  }
}

/**
 * Signal that the player has picked an upgrade (end upgrade phase).
 */
export function onUpgradePicked() {
  state.upgradePhase = false;
  startNextWave();
}

/**
 * Get current Director state (for UI, telemetry).
 * @returns {object}
 */
export function getDirectorState() {
  return { ...state, spawnQueue: undefined, _rng: undefined };
}

/**
 * Shutdown the Director.
 */
export function shutdownDirector() {
  state.running = false;
  bus.off('enemy:death', _onEnemyDeath);
}

// ─── Internal ────────────────────────────────────────────────

/**
 * Classic mode: look up pre-authored card sequence.
 * Falls back to cycling high-intensity cards.
 * @param {number} wave
 * @returns {string[]}
 */
function _classicPick(wave) {
  if (CLASSIC_SEQUENCE[wave]) {
    return CLASSIC_SEQUENCE[wave];
  }
  // Beyond wave 30 — cycle hard encounters
  const hardCards = CARD_DECK.filter(c => c.intensity >= 6);
  const rng = state._rng;
  const count = 2;
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(hardCards[(rng() * hardCards.length) | 0].id);
  }
  return result;
}

/**
 * Build spawn queue from an encounter card.
 * @param {EncounterCard} card
 */
function _enqueueCard(card) {
  for (const group of card.enemies) {
    const positions = _getFormationPositions(card.formation, group.count);
    for (let i = 0; i < group.count; i++) {
      state.spawnQueue.push({
        type: group.type,
        x: positions[i]?.x ?? getRandomSpawnPoint().x,
        y: positions[i]?.y ?? getRandomSpawnPoint().y,
        elite: group.elite || false,
        boss: group.boss || false,
      });
    }
  }
}

/**
 * Get spawn positions for a formation type.
 * @param {string} formation
 * @param {number} count
 * @returns {Array<{x: number, y: number}>}
 */
function _getFormationPositions(formation, count) {
  switch (formation) {
    case 'pincer':
      return getPincerSpawnPoints(count);
    case 'surround':
      return getSurroundSpawnPoints(count);
    case 'cluster': {
      const origin = getRandomSpawnPoint();
      const points = [];
      for (let i = 0; i < count; i++) {
        points.push({
          x: origin.x + (Math.random() - 0.5) * 30,
          y: origin.y + (Math.random() - 0.5) * 30,
        });
      }
      return points;
    }
    case 'random':
    default:
      return Array.from({ length: count }, () => getRandomSpawnPoint());
  }
}

/**
 * Execute a single spawn from the queue.
 * @param {object} spawn - { type, x, y, elite, boss }
 */
function _executeSpawn(spawn) {
  spawnEnemy(spawn.type, spawn.x, spawn.y, {
    elite: spawn.elite,
    boss: spawn.boss,
  });
  state.waveEnemiesSpawned++;
}

/**
 * Handle enemy death event.
 */
function _onEnemyDeath() {
  state.waveEnemiesKilled++;
}

/**
 * Handle wave clear.
 */
function _onWaveClear() {
  state.waveActive = false;
  state.pauseTimer = DIRECTOR.WAVE_CLEAR_PAUSE;
  bus.emit('wave:clear', state.wave);

  // Check for boss wave clear
  if (state.wave % DIRECTOR.BOSS_WAVE_INTERVAL === 0) {
    state.bossActive = false;
  }

  // Check victory
  if (state.wave >= DIRECTOR.MAX_WAVE) {
    state.running = false;
    bus.emit('game:victory', { wave: state.wave });
  }
}

// ─── Exports ─────────────────────────────────────────────────

export { state as directorState, CARD_DECK };
export default {
  initDirector, startNextWave, updateDirector, onUpgradePicked,
  getDirectorState, shutdownDirector, getCard, CARD_DECK,
};
