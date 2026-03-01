/**
 * @module agents/stress-model
 * @description Player Stress Model for SURGE's Adaptive AI Director.
 *
 * Computes a continuous 0–100 stress score from 6 weighted gameplay signals,
 * updated every 0.5s. The Director reads this to decide whether to ease up
 * or push harder — the core feedback loop of adaptive difficulty.
 *
 * Signals (weights from balance.js DIRECTOR.STRESS_WEIGHTS):
 *   1. HP Trend       (25%) — recent HP changes; losing HP = stress
 *   2. Dodge Proximity (20%) — nearest threats; close calls = stress
 *   3. Screen Density  (20%) — entity count relative to screen area
 *   4. Kill Speed      (15%) — kills per second; high = confident, low = stressed
 *   5. Ability Cooldown(10%) — dash/abilities on cooldown = less safe
 *   6. Upgrade Power   (10%) — more upgrades = more powerful = less stressed
 *
 * Target Stress Curve:
 *   base = interpolated from DIRECTOR.STRESS_CURVE control points
 *   oscillation = sine wave for tension-release rhythm
 *   boss peaks at boss waves (every 10th)
 *
 * API:
 *   stressModel.update(world, dt)     — tick the model
 *   stressModel.getCurrent()          — current stress 0–100
 *   stressModel.getTarget(wave)       — ideal stress for wave
 *   stressModel.getDelta()            — current - target
 *   stressModel.getHistory()          — stress history array
 *   stressModel.getSignals()          — last computed signal breakdown
 *   stressModel.reset()               — reset for new run
 */

import world from '../core/ecs.js';
import bus from '../core/events.js';
import { DIRECTOR, ARENA, SCREEN } from '../config/balance.js';
import { getPlayerPos, getPlayerId, getPlayerData } from '../game/player.js';
import { getEnemyCount } from '../game/enemies.js';

// ─── Constants ───────────────────────────────────────────────

/** How often to recompute stress (seconds) */
const UPDATE_INTERVAL = 0.5;

/** Max enemies on screen considered "full density" */
const MAX_DENSITY_ENEMIES = 30;

/** Window for kill speed calculation (seconds) */
const KILL_SPEED_WINDOW = 5.0;

/** Max upgrades considered "fully powered" */
const MAX_UPGRADE_STACKS = 20;

/** Dodge proximity danger radius (pixels) */
const DODGE_DANGER_RADIUS = 40;

/** Max tracked history entries */
const MAX_HISTORY = 300; // 300 × 0.5s = 150s of history

// ─── State ───────────────────────────────────────────────────

const state = {
  /** Current smoothed stress score 0–100 */
  current: 0,
  /** Raw (unsmoothed) stress from last tick */
  raw: 0,
  /** Accumulator for update interval */
  timer: 0,
  /** Current wave (updated via bus) */
  wave: 0,
  /** Running time for oscillation */
  runTime: 0,

  /** Per-signal raw values (0–1 each, before weighting) */
  signals: {
    hpTrend: 0,
    dodgeProximity: 0,
    screenDensity: 0,
    killSpeed: 0,
    abilityCooldown: 0,
    upgradePower: 0,
  },

  /** Weighted signal contributions (for debug/telemetry) */
  weighted: {
    hpTrend: 0,
    dodgeProximity: 0,
    screenDensity: 0,
    killSpeed: 0,
    abilityCooldown: 0,
    upgradePower: 0,
  },

  /** HP tracking for trend */
  hpHistory: [],       // recent HP values sampled each tick
  lastHp: -1,

  /** Kill timestamps for kill speed */
  killTimestamps: [],  // timestamps (runTime) of recent kills

  /** Nearest threat distance last frame */
  nearestThreatDist: Infinity,

  /** History of {time, stress, target, wave} for coach report */
  history: [],

  /** Is the model active? */
  active: false,
};

// ─── Bus Listeners ───────────────────────────────────────────

function _onWaveStart(wave) {
  state.wave = wave;
}

function _onEnemyDeath() {
  state.killTimestamps.push(state.runTime);
}

function _onHitPlayer() {
  // HP trend picks this up via polling — but we can also
  // record a "close call" spike for dodge proximity
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Initialize / reset the stress model for a new run.
 */
export function initStressModel() {
  state.current = 0;
  state.raw = 0;
  state.timer = 0;
  state.wave = 0;
  state.runTime = 0;
  state.signals = { hpTrend: 0, dodgeProximity: 0, screenDensity: 0, killSpeed: 0, abilityCooldown: 0, upgradePower: 0 };
  state.weighted = { hpTrend: 0, dodgeProximity: 0, screenDensity: 0, killSpeed: 0, abilityCooldown: 0, upgradePower: 0 };
  state.hpHistory = [];
  state.lastHp = -1;
  state.killTimestamps = [];
  state.nearestThreatDist = Infinity;
  state.history = [];
  state.active = true;

  bus.on('wave:start', _onWaveStart);
  bus.on('enemy:death', _onEnemyDeath);
}

/**
 * Shut down the stress model.
 */
export function shutdownStressModel() {
  state.active = false;
  bus.off('wave:start', _onWaveStart);
  bus.off('enemy:death', _onEnemyDeath);
}

/**
 * Tick the stress model.
 * Called every frame; internally batches computation to UPDATE_INTERVAL.
 * @param {number} dt — frame delta in seconds
 */
export function updateStressModel(dt) {
  if (!state.active) return;

  state.runTime += dt;
  state.timer += dt;

  // Sample nearest threat distance every frame (cheap)
  _sampleNearestThreat();

  if (state.timer >= UPDATE_INTERVAL) {
    state.timer -= UPDATE_INTERVAL;
    _computeStress();
  }
}

/**
 * Get the current smoothed stress score.
 * @returns {number} 0–100
 */
export function getStress() {
  return state.current;
}

/**
 * Get the target stress for a given wave.
 * Includes base curve + sine oscillation + boss peaks.
 * @param {number} [wave] — defaults to current wave
 * @returns {number} 0–100
 */
export function getTargetStress(wave) {
  const w = wave ?? state.wave;
  return _computeTarget(w);
}

/**
 * Get delta: current - target. Positive = overstressed, negative = bored.
 * @returns {number}
 */
export function getStressDelta() {
  return state.current - _computeTarget(state.wave);
}

/**
 * Get the stress history array.
 * @returns {Array<{time: number, stress: number, target: number, wave: number}>}
 */
export function getStressHistory() {
  return state.history;
}

/**
 * Get the last computed signal breakdown.
 * @returns {{ signals: object, weighted: object }}
 */
export function getStressSignals() {
  return {
    signals: { ...state.signals },
    weighted: { ...state.weighted },
  };
}

/**
 * Reset for a new run.
 */
export function resetStressModel() {
  shutdownStressModel();
  initStressModel();
}

// ─── Internal Computation ────────────────────────────────────

/**
 * Sample the nearest threat (enemy or enemy bullet) distance.
 * Done per-frame to catch close dodges.
 */
function _sampleNearestThreat() {
  const pPos = getPlayerPos();
  if (!pPos) { state.nearestThreatDist = Infinity; return; }

  let minDist = Infinity;

  // Check enemies
  const enemies = world.query('pos', 'enemy');
  for (const id of enemies) {
    const ePos = world.get(id, 'pos');
    const dx = ePos.x - pPos.x;
    const dy = ePos.y - pPos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < minDist) minDist = d;
  }

  // Check enemy bullets
  const bullets = world.query('pos', 'bullet');
  for (const id of bullets) {
    const b = world.get(id, 'bullet');
    if (b.owner !== 'enemy') continue;
    const bPos = world.get(id, 'pos');
    const dx = bPos.x - pPos.x;
    const dy = bPos.y - pPos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < minDist) minDist = d;
  }

  state.nearestThreatDist = minDist;
}

/**
 * Compute all 6 stress signals and produce raw + smoothed score.
 */
function _computeStress() {
  const W = DIRECTOR.STRESS_WEIGHTS;

  // ── 1. HP Trend (0 = full health steady, 1 = losing HP rapidly) ──
  const hpSignal = _computeHpTrend();

  // ── 2. Dodge Proximity (0 = nothing nearby, 1 = point-blank) ──
  const dodgeSignal = _computeDodgeProximity();

  // ── 3. Screen Density (0 = empty, 1 = packed) ──
  const densitySignal = _computeScreenDensity();

  // ── 4. Kill Speed (0 = killing fast, 1 = not killing) ──
  const killSignal = _computeKillSpeed();

  // ── 5. Ability Cooldown (0 = all ready, 1 = all on cooldown) ──
  const cooldownSignal = _computeAbilityCooldown();

  // ── 6. Upgrade Power (0 = fully powered, 1 = no upgrades) ──
  const upgradeSignal = _computeUpgradePower();

  // Store raw signals
  state.signals.hpTrend = hpSignal;
  state.signals.dodgeProximity = dodgeSignal;
  state.signals.screenDensity = densitySignal;
  state.signals.killSpeed = killSignal;
  state.signals.abilityCooldown = cooldownSignal;
  state.signals.upgradePower = upgradeSignal;

  // Weighted sum → raw stress 0–100
  const raw =
    (hpSignal * W.hpTrend +
     dodgeSignal * W.dodgeProximity +
     densitySignal * W.screenDensity +
     killSignal * W.killSpeed +
     cooldownSignal * W.abilityCooldown +
     upgradeSignal * W.upgradePower) * 100;

  // Store weighted contributions
  state.weighted.hpTrend = hpSignal * W.hpTrend * 100;
  state.weighted.dodgeProximity = dodgeSignal * W.dodgeProximity * 100;
  state.weighted.screenDensity = densitySignal * W.screenDensity * 100;
  state.weighted.killSpeed = killSignal * W.killSpeed * 100;
  state.weighted.abilityCooldown = cooldownSignal * W.abilityCooldown * 100;
  state.weighted.upgradePower = upgradeSignal * W.upgradePower * 100;

  state.raw = raw;

  // Exponential smoothing (α = 0.3 for responsive but not twitchy)
  const alpha = 0.3;
  state.current = state.current * (1 - alpha) + raw * alpha;

  // Clamp
  state.current = Math.max(0, Math.min(100, state.current));

  // Record history
  state.history.push({
    time: state.runTime,
    stress: Math.round(state.current * 10) / 10,
    target: Math.round(_computeTarget(state.wave) * 10) / 10,
    wave: state.wave,
  });

  // Trim history
  if (state.history.length > MAX_HISTORY) {
    state.history.shift();
  }
}

// ─── Signal Computation Functions ────────────────────────────

/**
 * HP Trend: how fast is the player losing health?
 * Compares current HP to recent HP samples.
 * @returns {number} 0–1 (0 = stable/gaining, 1 = losing fast)
 */
function _computeHpTrend() {
  const pData = getPlayerData();
  if (!pData) return 0;

  const currentHp = pData.hp;
  const maxHp = pData.maxHp;

  // Record HP
  state.hpHistory.push(currentHp);
  if (state.hpHistory.length > 6) state.hpHistory.shift(); // ~3s window at 0.5s ticks

  // HP ratio inverse (low HP = more stressed)
  const hpRatio = currentHp / maxHp;
  const hpLoss = 1 - hpRatio; // 0 = full, 1 = dead

  // HP trend: compare to oldest sample
  let trend = 0;
  if (state.hpHistory.length >= 2) {
    const oldest = state.hpHistory[0];
    const delta = oldest - currentHp; // positive = lost HP
    trend = Math.max(0, delta / maxHp); // 0–1
  }

  // Combine: 60% current HP level, 40% trend rate
  return Math.min(1, hpLoss * 0.6 + trend * 0.4);
}

/**
 * Dodge Proximity: how close are threats right now?
 * Uses the per-frame sampled nearest threat distance.
 * @returns {number} 0–1 (0 = nothing nearby, 1 = point-blank)
 */
function _computeDodgeProximity() {
  if (state.nearestThreatDist === Infinity) return 0;

  // Map distance to stress: within DODGE_DANGER_RADIUS = max stress
  // Beyond 2x radius = no stress
  const norm = 1 - Math.min(1, state.nearestThreatDist / (DODGE_DANGER_RADIUS * 2));
  return norm * norm; // Quadratic — ramps up sharply when close
}

/**
 * Screen Density: how many entities relative to capacity?
 * @returns {number} 0–1
 */
function _computeScreenDensity() {
  const count = getEnemyCount();

  // Also count enemy bullets
  let bulletCount = 0;
  const bullets = world.query('pos', 'bullet');
  for (const id of bullets) {
    const b = world.get(id, 'bullet');
    if (b.owner === 'enemy') bulletCount++;
  }

  // Total threats: enemies + enemy bullets (bullets weighted 0.5)
  const totalThreats = count + bulletCount * 0.5;
  return Math.min(1, totalThreats / MAX_DENSITY_ENEMIES);
}

/**
 * Kill Speed: how fast is the player killing enemies?
 * High kill speed = confident player = less stress.
 * @returns {number} 0–1 (0 = killing fast, 1 = not killing)
 */
function _computeKillSpeed() {
  const now = state.runTime;

  // Prune old timestamps outside window
  while (state.killTimestamps.length > 0 &&
         state.killTimestamps[0] < now - KILL_SPEED_WINDOW) {
    state.killTimestamps.shift();
  }

  const kills = state.killTimestamps.length;

  // Expected kills per window scales with wave (more enemies = should kill more)
  const expectedKills = Math.max(3, state.wave * 1.5);

  // Ratio: high kills = low stress signal
  const killRatio = Math.min(1, kills / expectedKills);
  return 1 - killRatio; // Invert: low kills = high stress
}

/**
 * Ability Cooldown: is the player's dash on cooldown?
 * @returns {number} 0–1 (0 = ready, 1 = fully on cooldown)
 */
function _computeAbilityCooldown() {
  const pData = getPlayerData();
  if (!pData) return 0;

  // Dash cooldown ratio
  const dashRatio = pData.dashCooldownTimer > 0
    ? pData.dashCooldownTimer / pData.dashCooldown
    : 0;

  // Could expand with more abilities in the future
  return dashRatio;
}

/**
 * Upgrade Power: how many upgrades does the player have?
 * More upgrades = more powerful = less stressed.
 * @returns {number} 0–1 (0 = fully powered, 1 = no upgrades)
 */
function _computeUpgradePower() {
  const pData = getPlayerData();
  if (!pData || !pData.upgrades) return 1;

  // Count total upgrade stacks
  let totalStacks = 0;
  for (const key in pData.upgrades) {
    totalStacks += pData.upgrades[key] || 0;
  }

  return 1 - Math.min(1, totalStacks / MAX_UPGRADE_STACKS);
}

// ─── Target Stress Curve ─────────────────────────────────────

/**
 * Compute the ideal target stress for a given wave.
 * Interpolates from DIRECTOR.STRESS_CURVE, adds sine oscillation for
 * tension-release rhythm, and spikes for boss waves.
 *
 * @param {number} wave
 * @returns {number} 0–100
 */
function _computeTarget(wave) {
  if (wave <= 0) return 15;

  const curve = DIRECTOR.STRESS_CURVE;

  // ── Interpolate base from control points ──
  let base;
  if (wave <= curve[0].wave) {
    base = curve[0].target;
  } else if (wave >= curve[curve.length - 1].wave) {
    base = curve[curve.length - 1].target;
  } else {
    // Find surrounding control points
    let lo = curve[0], hi = curve[curve.length - 1];
    for (let i = 0; i < curve.length - 1; i++) {
      if (wave >= curve[i].wave && wave <= curve[i + 1].wave) {
        lo = curve[i];
        hi = curve[i + 1];
        break;
      }
    }
    const t = (wave - lo.wave) / (hi.wave - lo.wave);
    base = lo.target + (hi.target - lo.target) * t;
  }

  // ── Tension-release sine oscillation ──
  // Every ~4 waves, stress dips briefly then rises
  const oscillation = Math.sin(wave * Math.PI / 2) * 5;

  // ── Boss wave peak ──
  const bossPeak = (wave % 10 === 0) ? 10 : 0;

  // ── Pre-boss anticipation (waves 9, 19, 29...) ──
  const preBoss = (wave % 10 === 9) ? 5 : 0;

  return Math.max(0, Math.min(100, base + oscillation + bossPeak + preBoss));
}

// ─── Debug Visualization ─────────────────────────────────────

/**
 * Render a debug stress bar overlay on the HUD.
 * Call from renderHud when debug mode is active.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
export function renderStressDebug(ctx, x, y, w, h) {
  const stress = state.current;
  const target = _computeTarget(state.wave);
  const ratio = stress / 100;
  const targetRatio = target / 100;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, w, h);

  // Current stress bar
  const color = stress > 70 ? '#ff4444' : stress > 40 ? '#ffaa00' : '#44ff44';
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * ratio, h);

  // Target line
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w * targetRatio, y);
  ctx.lineTo(x + w * targetRatio, y + h);
  ctx.stroke();

  // Label
  ctx.fillStyle = '#ffffff';
  ctx.font = '5px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`STR ${Math.round(stress)}/${Math.round(target)}`, x + 2, y + h - 1);
}

// ─── Export ──────────────────────────────────────────────────

export default {
  initStressModel,
  shutdownStressModel,
  updateStressModel,
  getStress,
  getTargetStress,
  getStressDelta,
  getStressHistory,
  getStressSignals,
  resetStressModel,
  renderStressDebug,
};
