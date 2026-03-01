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
import { CARD_DECK as FULL_DECK, CARD_MAP, getCard as getCardDef, getEligibleCards, MODIFIERS } from '../config/cards.js';
import { pickCards, getIntensityBudget, applyModifier } from '../game/encounter-cards.js';
import { getStress, getTargetStress, getStressDelta, getStressSignals } from './stress-model.js';

// ─── Director State ──────────────────────────────────────────

const state = {
  /** Current mode: 'classic' | 'adaptive' | 'llm' */
  mode: 'classic',
  /** Current wave number (1-based) */
  wave: 0,
  /** Is a wave currently active? */
  waveActive: false,
  /** Current stress score (0-100) — synced from stress model */
  stress: 0,
  /** Spawn queue for current wave */
  spawnQueue: [],
  /** Timer for next spawn in queue */
  spawnTimer: 0,
  /** Base spawn delay (can be modulated mid-wave) */
  spawnDelay: DIRECTOR.SPAWN_DELAY_BASE,
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

  // ── Adaptive Mode State ──

  /** Softmax bandit: card_id → cumulative reward */
  banditRewards: {},
  /** Softmax bandit: card_id → play count */
  banditCounts: {},
  /** Temperature for softmax (decays over waves) */
  banditTemperature: 1.0,

  /** Weakness tracking: enemy_type → deaths-by-player count in recent waves */
  weaknessMap: {},
  /** Deaths-by-type this wave */
  deathsByType: {},

  /** Last decision rationale text */
  rationale: '',

  /** Mid-wave spawn rate multiplier (1.0 = normal) */
  midWaveSpawnMult: 1.0,
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

// ─── Encounter Cards now imported from src/config/cards.js ───
// The full ~40-card deck + encounter manager are in:
//   src/config/cards.js       (CARD_DECK, CARD_MAP, getCard, getEligibleCards)
//   src/game/encounter-cards.js (pickCards, getIntensityBudget, applyModifier)

// ─── Classic Mode Wave Sequence (Expanded for Phase 2) ──────

/**
 * Pre-authored wave→cards mapping for Classic mode.
 * Provides a curated experience without AI.
 * Uses the full card deck including Orbitor, Splitter, Shielder.
 */
const CLASSIC_SEQUENCE = {
  1:  ['drifter_trickle'],
  2:  ['drifter_pack'],
  3:  ['single_dasher', 'drifter_trickle'],
  4:  ['dasher_pair', 'drifter_line'],
  5:  ['sprayer_post', 'drifter_pack'],
  6:  ['orbitor_ring', 'drifter_trickle'],
  7:  ['flanking_dashers', 'splitter_pair'],
  8:  ['drifter_swarm', 'shielded_pack'],
  9:  ['sprayer_crossfire', 'orbitor_ring'],
  10: ['boss_swarm_king'],
  11: ['turret_alley', 'splitter_chain'],
  12: ['dasher_squad', 'orbitor_cage'],
  13: ['mixed_assault', 'shield_wall'],
  14: ['drifter_flood', 'splitter_pair'],
  15: ['hell_wave', 'orbitor_constellation'],
  16: ['flanking_dashers', 'sprayer_crossfire'],
  17: ['dasher_squad', 'splitter_wave'],
  18: ['elite_orbitor', 'drifter_swarm'],
  19: ['shielded_crossfire', 'mixed_assault'],
  20: ['boss_blitz_captain'],
  21: ['drifter_flood', 'sprayer_crossfire'],
  22: ['hell_wave', 'orbital_assault'],
  23: ['turret_alley', 'flanking_dashers'],
  24: ['splitter_rush', 'shielded_crossfire'],
  25: ['fortress', 'hell_wave'],
  26: ['dasher_squad', 'drifter_flood'],
  27: ['chaos', 'turret_alley'],
  28: ['apocalypse', 'shield_wall'],
  29: ['hell_wave', 'dasher_squad'],
  30: ['boss_hivemind'],
};

// Card lookup now via CARD_MAP from src/config/cards.js

/**
 * Get a card by ID (re-exported for backwards compat).
 * @param {string} id
 * @returns {EncounterCard|undefined}
 */
export function getCard(id) {
  return CARD_MAP.get(id);
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
  state.spawnDelay = DIRECTOR.SPAWN_DELAY_BASE;
  state.currentCards = [];
  state.history = [];
  state.pauseTimer = 0;
  state.waveEnemiesSpawned = 0;
  state.waveEnemiesKilled = 0;
  state.upgradePhase = false;
  state.bossActive = false;
  state.running = true;
  state.rationale = '';
  state.midWaveSpawnMult = 1.0;

  // Adaptive state
  state.banditRewards = {};
  state.banditCounts = {};
  state.banditTemperature = 1.0;
  state.weaknessMap = {};
  state.deathsByType = {};

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

  // ── End-of-wave bandit reward (for previous wave) ──
  if (state.wave > 0 && (state.mode === 'adaptive' || state.mode === 'llm')) {
    _updateBanditRewards();
    _updateWeaknessMap();
    // Decay temperature for softmax
    state.banditTemperature = Math.max(0.3, state.banditTemperature * 0.95);
  }

  state.wave++;
  state.waveActive = true;
  state.waveEnemiesSpawned = 0;
  state.waveEnemiesKilled = 0;
  state.spawnQueue = [];
  state.spawnTimer = 0;
  state.spawnDelay = DIRECTOR.SPAWN_DELAY_BASE;
  state.midWaveSpawnMult = 1.0;
  state.deathsByType = {};

  // Sync stress from model
  state.stress = getStress();

  // Pick cards based on mode
  let cardIds;
  let rationale = '';
  if (state.mode === 'adaptive') {
    const result = _adaptivePick(state.wave);
    cardIds = result.cardIds;
    rationale = result.rationale;
  } else if (state.mode === 'classic') {
    cardIds = _classicPick(state.wave);
    rationale = `Classic sequence: wave ${state.wave}`;
  } else {
    // LLM will be implemented in Phase 4 — fallback to adaptive
    const result = _adaptivePick(state.wave);
    cardIds = result.cardIds;
    rationale = result.rationale;
  }

  state.currentCards = cardIds;
  state.rationale = rationale;

  // Build spawn queue from cards
  for (const cardId of cardIds) {
    // Support modified cards (with : in id)
    const card = CARD_MAP.get(cardId) || CARD_MAP.get(cardId.split(':')[0]);
    if (!card) continue;
    _enqueueCard(card);
  }

  const decision = {
    wave: state.wave,
    cards: cardIds,
    mode: state.mode,
    stress: state.stress,
    target: getTargetStress(state.wave),
    delta: getStressDelta(),
    rationale,
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

  // Sync stress from model every frame
  state.stress = getStress();

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

  // ── Mid-wave adaptive adjustments ──
  if (state.mode === 'adaptive' || state.mode === 'llm') {
    _midWaveAdjust();
  }

  // ── Process spawn queue ──
  if (state.spawnQueue.length > 0) {
    state.spawnTimer -= dt;
    const effectiveDelay = state.spawnDelay * state.midWaveSpawnMult;
    if (state.spawnTimer <= 0) {
      const spawn = state.spawnQueue.shift();
      _executeSpawn(spawn);
      state.spawnTimer = effectiveDelay;
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
  return {
    ...state,
    spawnQueue: undefined,
    _rng: undefined,
    stressTarget: getTargetStress(state.wave),
    stressDelta: getStressDelta(),
  };
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
 * Falls back to budget-based picking from the full deck via encounter-cards.js
 * @param {number} wave
 * @returns {string[]}
 */
function _classicPick(wave) {
  if (CLASSIC_SEQUENCE[wave]) {
    return CLASSIC_SEQUENCE[wave];
  }
  // Beyond wave 30 — use the encounter-cards budget system
  return pickCards(wave, 'classic', getIntensityBudget(wave), state._rng);
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
    case 'line': {
      const origin = getRandomSpawnPoint();
      const points = [];
      const step = 16; // pixels between each enemy in the line
      for (let i = 0; i < count; i++) {
        points.push({
          x: origin.x + (i - (count - 1) / 2) * step,
          y: origin.y,
        });
      }
      return points;
    }
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
 * @param {number} id — entity id
 * @param {object} data — { type, score, xp, x, y, isBoss, isElite }
 */
function _onEnemyDeath(id, data) {
  state.waveEnemiesKilled++;

  // Track deaths by type for weakness analysis
  if (data && data.type) {
    state.deathsByType[data.type] = (state.deathsByType[data.type] || 0) + 1;
  }
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── ADAPTIVE DIRECTOR ENGINE ─────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Adaptive card selection: reads stress delta to decide intensity,
 * uses softmax bandit for exploration vs exploitation, and
 * exploits detected player weaknesses (bounded at EXPLOIT_CAP).
 *
 * @param {number} wave
 * @returns {{ cardIds: string[], rationale: string }}
 */
function _adaptivePick(wave) {
  const budget = getIntensityBudget(wave);
  const delta = getStressDelta();
  const stress = getStress();
  const target = getTargetStress(wave);
  const eligible = getEligibleCards(wave);
  const signals = getStressSignals();
  const rng = state._rng;

  if (eligible.length === 0) return { cardIds: [], rationale: 'No eligible cards.' };

  // ── Boss waves always get their boss card ──
  if (wave % 10 === 0) {
    const bossCards = eligible.filter(c => c.tags.includes('boss'));
    if (bossCards.length > 0) {
      const boss = bossCards[Math.floor(rng() * bossCards.length)];
      return {
        cardIds: [boss.id],
        rationale: `🔴 Boss wave ${wave}. Deploying ${boss.name}.`,
      };
    }
  }

  // ── Determine intensity policy from stress delta ──
  let intensityBias = 0;   // -1 to +1: negative = easier, positive = harder
  let policyName = 'balanced';
  const reasons = [];

  if (delta > DIRECTOR.STRESS_TOLERANCE) {
    // Player is overstressed → ease up
    intensityBias = -0.5 - (delta - DIRECTOR.STRESS_TOLERANCE) / 100;
    policyName = 'easing';
    reasons.push(`Stress ${Math.round(stress)} exceeds target ${Math.round(target)} by ${Math.round(delta)}.`);
    reasons.push('Selecting lower-intensity cards. Delaying spawns.');
  } else if (delta < -DIRECTOR.STRESS_TOLERANCE) {
    // Player is bored → push harder
    intensityBias = 0.5 + (-delta - DIRECTOR.STRESS_TOLERANCE) / 100;
    policyName = 'pushing';
    reasons.push(`Stress ${Math.round(stress)} is below target ${Math.round(target)} by ${Math.round(-delta)}.`);
    reasons.push('Selecting higher-intensity cards. Adding modifiers.');
  } else {
    policyName = 'balanced';
    reasons.push(`Stress ${Math.round(stress)} near target ${Math.round(target)}. Balanced selection.`);
  }

  intensityBias = Math.max(-1, Math.min(1, intensityBias));

  // ── Filter cards by intensity policy ──
  const midIntensity = budget / 2;
  let filteredCards;

  if (intensityBias < -0.2) {
    // Prefer lower-intensity cards
    filteredCards = eligible.filter(c => c.intensity <= midIntensity + 1 && !c.tags.includes('boss'));
  } else if (intensityBias > 0.2) {
    // Prefer higher-intensity cards
    filteredCards = eligible.filter(c => c.intensity >= midIntensity - 1 && !c.tags.includes('boss'));
  } else {
    filteredCards = eligible.filter(c => !c.tags.includes('boss'));
  }

  if (filteredCards.length === 0) filteredCards = eligible.filter(c => !c.tags.includes('boss'));
  if (filteredCards.length === 0) filteredCards = eligible;

  // ── Softmax bandit card selection ──
  const cardIds = _softmaxSelect(filteredCards, budget, rng);

  // ── Weakness exploitation (bounded at EXPLOIT_CAP) ──
  const weakExploit = _weaknessExploit(eligible, wave, rng);
  if (weakExploit) {
    // Replace up to EXPLOIT_CAP % of total spawns with weakness cards
    const maxExploitCards = Math.max(1, Math.floor(cardIds.length * DIRECTOR.EXPLOIT_CAP));
    let added = 0;
    if (weakExploit.cardId && added < maxExploitCards) {
      cardIds.push(weakExploit.cardId);
      added++;
      reasons.push(weakExploit.reason);
    }
  }

  // ── Apply modifiers when pushing ──
  const finalCards = [];
  for (const cId of cardIds) {
    if (intensityBias > 0.3 && rng() < 0.3) {
      // 30% chance to modify a card when pushing
      const modKeys = Object.keys(MODIFIERS);
      const modKey = modKeys[Math.floor(rng() * modKeys.length)];
      const modified = applyModifier(cId, modKey);
      if (modified) {
        // Register the modified card temporarily in CARD_MAP
        CARD_MAP.set(modified.id, modified);
        finalCards.push(modified.id);
        reasons.push(`Applied ${MODIFIERS[modKey].label} modifier to ${cId}.`);
        continue;
      }
    }
    finalCards.push(cId);
  }

  const rationale = `[${policyName.toUpperCase()}] ` + reasons.join(' ');

  return { cardIds: finalCards, rationale };
}

/**
 * Softmax bandit: select cards proportionally to reward scores.
 * Higher temperature = more exploration, lower = more exploitation.
 *
 * @param {Array} eligible — eligible card objects
 * @param {number} budget — max total intensity
 * @param {Function} rng
 * @returns {string[]} — selected card IDs
 */
function _softmaxSelect(eligible, budget, rng) {
  const T = state.banditTemperature;
  const result = [];
  let remaining = budget;
  const used = new Set();

  // Compute softmax probabilities
  const scores = eligible.map(c => {
    const reward = state.banditRewards[c.id] || 0;
    const count = state.banditCounts[c.id] || 0;
    // Average reward + exploration bonus
    const avgReward = count > 0 ? reward / count : 0.5;
    return { card: c, score: avgReward };
  });

  // Softmax with temperature
  const maxScore = Math.max(...scores.map(s => s.score));
  const expScores = scores.map(s => ({
    card: s.card,
    exp: Math.exp((s.score - maxScore) / T),
  }));
  const sumExp = expScores.reduce((s, e) => s + e.exp, 0);

  // Sample cards until budget is filled
  let attempts = 0;
  while (remaining > 0 && attempts < 50) {
    attempts++;

    // Weighted random selection
    let roll = rng() * sumExp;
    let chosen = null;
    for (const e of expScores) {
      roll -= e.exp;
      if (roll <= 0) {
        chosen = e.card;
        break;
      }
    }
    if (!chosen) chosen = expScores[expScores.length - 1].card;

    // Skip already picked (avoid duplicate cards)
    if (used.has(chosen.id)) continue;

    // Check budget
    if (chosen.intensity <= remaining) {
      result.push(chosen.id);
      remaining -= chosen.intensity;
      used.add(chosen.id);
    }
  }

  // Ensure at least one card
  if (result.length === 0 && eligible.length > 0) {
    result.push(eligible[Math.floor(rng() * eligible.length)].id);
  }

  return result;
}

/**
 * Update softmax bandit rewards after a wave completes.
 * Reward = how close actual stress stayed to target.
 * Good wave = stress near target → high reward for played cards.
 */
function _updateBanditRewards() {
  const delta = Math.abs(getStressDelta());
  // Reward inversely proportional to stress delta (closer to target = better)
  const reward = Math.max(0, 1 - delta / 50);

  for (const cardId of state.currentCards) {
    const baseId = cardId.split(':')[0]; // Strip modifier suffix
    state.banditRewards[baseId] = (state.banditRewards[baseId] || 0) + reward;
    state.banditCounts[baseId] = (state.banditCounts[baseId] || 0) + 1;
  }
}

/**
 * Update the weakness map from deaths-by-type this wave.
 * Tracks which enemy types the player kills fastest (= weakest against player).
 * The director will avoid those types or exploit them based on policy.
 */
function _updateWeaknessMap() {
  for (const type in state.deathsByType) {
    state.weaknessMap[type] = (state.weaknessMap[type] || 0) + state.deathsByType[type];
  }
}

/**
 * Exploit detected player weaknesses: find enemy types the player
 * kills SLOWEST (= hardest for the player) and select cards featuring them.
 * Bounded at EXPLOIT_CAP of wave enemy count.
 *
 * @param {Array} eligible
 * @param {number} wave
 * @param {Function} rng
 * @returns {{ cardId: string, reason: string }|null}
 */
function _weaknessExploit(eligible, wave, rng) {
  if (Object.keys(state.weaknessMap).length < 2) return null;

  // Find the type killed LEAST (proportionally = player weakness)
  const types = Object.entries(state.weaknessMap);
  types.sort((a, b) => a[1] - b[1]); // Ascending by kill count

  const weakType = types[0][0]; // Least killed = hardest for player

  // Find cards featuring this type
  const matchCards = eligible.filter(c =>
    c.enemies.some(e => e.type === weakType) && !c.tags.includes('boss')
  );

  if (matchCards.length === 0) return null;

  const card = matchCards[Math.floor(rng() * matchCards.length)];
  return {
    cardId: card.id,
    reason: `Exploiting weakness: player struggles vs ${weakType}. Deploying ${card.name}.`,
  };
}

/**
 * Mid-wave spawn rate adjustments.
 * Runs every frame during an active wave (adaptive/LLM modes).
 * - Stress > 85: slow spawns to 80% rate
 * - Stress < 30: accelerate spawns to 120% rate
 * - Otherwise: normal rate
 */
function _midWaveAdjust() {
  if (!state.waveActive) return;

  const stress = getStress();

  if (stress > 85) {
    state.midWaveSpawnMult = 1 / DIRECTOR.MID_WAVE_SLOW_FACTOR; // Slower spawns (larger delay)
  } else if (stress < 30 && state.wave > 2) {
    state.midWaveSpawnMult = DIRECTOR.MID_WAVE_SLOW_FACTOR; // Faster spawns (shorter delay)
  } else {
    // Smooth return to normal
    state.midWaveSpawnMult += (1.0 - state.midWaveSpawnMult) * 0.05;
  }
}

// ─── Rationale Templates ─────────────────────────────────────

/**
 * Get the Director's last decision rationale.
 * @returns {string}
 */
export function getDirectorRationale() {
  return state.rationale;
}

// ─── Exports ─────────────────────────────────────────────────

export { state as directorState, FULL_DECK as CARD_DECK };
export default {
  initDirector, startNextWave, updateDirector, onUpgradePicked,
  getDirectorState, shutdownDirector, getCard, getDirectorRationale,
  CARD_DECK: FULL_DECK,
};
