/**
 * @module agents/telemetry
 * @description Telemetry & analytics system for SURGE's Coach.
 *
 * Records per-frame and per-event data throughout a run, then computes
 * derived metrics for the Coach Report (Issue #21).
 *
 * Per-Frame Recording:
 *   - Player position → 8×12 heatmap grid
 *   - Movement direction → circular buffer for predictability scoring
 *   - Nearest bullet distance → dodge timing analysis
 *
 * Per-Event Recording:
 *   - player:hit       — damage taken, source, position
 *   - enemy:death      — type, position, time
 *   - upgrade:picked   — upgrade id, wave
 *   - wave:clear       — wave number, time
 *   - director:decision — cards picked, stress data
 *
 * Derived Metrics (computed on demand via getRunSummary):
 *   - Movement heatmap (8×12 grid, normalized 0–1)
 *   - Predictability score (0–1, how repetitive movement is)
 *   - Dodge timing histogram (close dodges per second)
 *   - Damage breakdown by source type
 *   - Kill efficiency (kills per second over time)
 *   - Favorite position (hottest heatmap cell)
 *   - Upgrade path analysis
 *   - Director history
 *
 * API:
 *   telemetry.init()
 *   telemetry.recordFrame(dt)
 *   telemetry.recordEvent(type, data)
 *   telemetry.getRunSummary()
 *   telemetry.reset()
 */

import world from '../core/ecs.js';
import bus from '../core/events.js';
import { SCREEN, ARENA } from '../config/balance.js';
import { getPlayerPos, getPlayerData } from '../game/player.js';

// ─── Constants ───────────────────────────────────────────────

/** Heatmap grid dimensions */
const GRID_COLS = 8;
const GRID_ROWS = 12;

/** Movement buffer size for predictability analysis */
const MOVE_BUFFER_SIZE = 120; // 2 seconds at 60fps

/** Close dodge threshold (pixels) */
const CLOSE_DODGE_THRESHOLD = 20;

/** Heatmap recording interval (avoid per-frame overhead) */
const HEATMAP_INTERVAL = 0.1; // every 100ms

// ─── State ───────────────────────────────────────────────────

const state = {
  active: false,
  runTime: 0,

  // ── Per-frame data ──

  /** 8×12 heatmap grid (flat array, row-major) */
  heatmap: new Float32Array(GRID_COLS * GRID_ROWS),
  heatmapTotal: 0,
  heatmapTimer: 0,

  /** Circular buffer of movement angles (radians) */
  moveBuffer: new Float32Array(MOVE_BUFFER_SIZE),
  moveBufferIdx: 0,
  moveBufferFilled: false,

  /** Closest bullet distance each frame (min across frame) */
  closeDodges: 0,         // count of "close dodges" (within threshold)
  totalDodgeSamples: 0,

  /** Previous frame position for direction calculation */
  lastX: 0,
  lastY: 0,
  hasLastPos: false,

  // ── Per-event data ──

  /** Damage events: { time, source, amount, x, y } */
  damageEvents: [],

  /** Kill events: { time, type, x, y, wave } */
  killEvents: [],

  /** Upgrade events: { time, upgradeId, wave } */
  upgradeEvents: [],

  /** Wave clear events: { time, wave, duration } */
  waveClearEvents: [],
  waveStartTime: 0,

  /** Director decisions: { wave, cards, stress, target, delta, rationale } */
  directorDecisions: [],

  /** Total kills by type */
  killsByType: {},

  /** Total damage taken by source */
  damageBySource: {},

  /** Peak enemy count observed */
  peakEnemyCount: 0,
};

// ─── Bus Listeners ───────────────────────────────────────────

function _onHitPlayer(data) {
  if (!state.active) return;
  const source = data?.source || 'unknown';
  const amount = 1; // Standard damage
  state.damageEvents.push({
    time: state.runTime,
    source,
    amount,
    x: data?.x || 0,
    y: data?.y || 0,
  });
  state.damageBySource[source] = (state.damageBySource[source] || 0) + amount;
}

function _onEnemyDeath(id, data) {
  if (!state.active) return;
  const type = data?.type || 'unknown';
  state.killEvents.push({
    time: state.runTime,
    type,
    x: data?.x || 0,
    y: data?.y || 0,
    wave: data?.wave || 0,
  });
  state.killsByType[type] = (state.killsByType[type] || 0) + 1;
}

function _onUpgradePicked(data) {
  if (!state.active) return;
  state.upgradeEvents.push({
    time: state.runTime,
    upgradeId: data?.id || data || 'unknown',
    wave: data?.wave || 0,
  });
}

function _onWaveStart(wave) {
  if (!state.active) return;
  state.waveStartTime = state.runTime;
}

function _onWaveClear(wave) {
  if (!state.active) return;
  state.waveClearEvents.push({
    time: state.runTime,
    wave,
    duration: state.runTime - state.waveStartTime,
  });
}

function _onDirectorDecision(decision) {
  if (!state.active) return;
  state.directorDecisions.push({ ...decision, time: state.runTime });
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Initialize telemetry for a new run.
 */
export function initTelemetry() {
  resetTelemetry();
  state.active = true;

  bus.on('hit:player', _onHitPlayer);
  bus.on('enemy:death', _onEnemyDeath);
  bus.on('upgrade:picked', _onUpgradePicked);
  bus.on('wave:start', _onWaveStart);
  bus.on('wave:clear', _onWaveClear);
  bus.on('director:decision', _onDirectorDecision);
}

/**
 * Shutdown telemetry.
 */
export function shutdownTelemetry() {
  state.active = false;
  bus.off('hit:player', _onHitPlayer);
  bus.off('enemy:death', _onEnemyDeath);
  bus.off('upgrade:picked', _onUpgradePicked);
  bus.off('wave:start', _onWaveStart);
  bus.off('wave:clear', _onWaveClear);
  bus.off('director:decision', _onDirectorDecision);
}

/**
 * Record per-frame telemetry data.
 * Called every frame from main.js.
 * @param {number} dt — frame delta in seconds
 */
export function recordFrame(dt) {
  if (!state.active) return;
  state.runTime += dt;

  const pPos = getPlayerPos();
  if (!pPos) return;

  // ── Heatmap sampling (throttled) ──
  state.heatmapTimer += dt;
  if (state.heatmapTimer >= HEATMAP_INTERVAL) {
    state.heatmapTimer -= HEATMAP_INTERVAL;
    _recordHeatmap(pPos);
  }

  // ── Movement direction buffer ──
  if (state.hasLastPos) {
    const dx = pPos.x - state.lastX;
    const dy = pPos.y - state.lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.5) { // Only record if actually moving
      const angle = Math.atan2(dy, dx);
      state.moveBuffer[state.moveBufferIdx] = angle;
      state.moveBufferIdx = (state.moveBufferIdx + 1) % MOVE_BUFFER_SIZE;
      if (state.moveBufferIdx === 0) state.moveBufferFilled = true;
    }
  }
  state.lastX = pPos.x;
  state.lastY = pPos.y;
  state.hasLastPos = true;

  // ── Nearest bullet distance (dodge proximity) ──
  _sampleDodgeProximity(pPos);

  // ── Peak enemy count ──
  const enemies = world.query('pos', 'enemy');
  if (enemies.length > state.peakEnemyCount) {
    state.peakEnemyCount = enemies.length;
  }
}

/**
 * Compute and return the full run summary.
 * Call after run ends for the Coach Report.
 * @returns {RunSummary}
 */
export function getRunSummary() {
  return {
    runTime: state.runTime,

    // Heatmap
    heatmap: _getNormalizedHeatmap(),
    hotspot: _getHotspot(),

    // Movement analysis
    predictability: _computePredictability(),

    // Dodge analysis
    dodgeRate: state.totalDodgeSamples > 0
      ? state.closeDodges / state.totalDodgeSamples
      : 0,
    closeDodgesTotal: state.closeDodges,

    // Combat stats
    totalKills: state.killEvents.length,
    killsByType: { ...state.killsByType },
    killEfficiency: state.runTime > 0
      ? state.killEvents.length / state.runTime
      : 0,
    peakEnemyCount: state.peakEnemyCount,

    // Damage breakdown
    totalDamageTaken: state.damageEvents.length,
    damageBySource: { ...state.damageBySource },
    damageTimeline: state.damageEvents.map(e => ({
      time: e.time,
      source: e.source,
    })),

    // Upgrade path
    upgrades: state.upgradeEvents.slice(),

    // Wave performance
    waves: state.waveClearEvents.slice(),
    wavesCleared: state.waveClearEvents.length,
    avgWaveDuration: _avgWaveDuration(),
    fastestWave: _fastestWave(),
    slowestWave: _slowestWave(),

    // Director analysis
    directorDecisions: state.directorDecisions.slice(),
  };
}

/**
 * Reset telemetry for a new run.
 */
export function resetTelemetry() {
  state.active = false;
  state.runTime = 0;
  state.heatmap = new Float32Array(GRID_COLS * GRID_ROWS);
  state.heatmapTotal = 0;
  state.heatmapTimer = 0;
  state.moveBuffer = new Float32Array(MOVE_BUFFER_SIZE);
  state.moveBufferIdx = 0;
  state.moveBufferFilled = false;
  state.closeDodges = 0;
  state.totalDodgeSamples = 0;
  state.lastX = 0;
  state.lastY = 0;
  state.hasLastPos = false;
  state.damageEvents = [];
  state.killEvents = [];
  state.upgradeEvents = [];
  state.waveClearEvents = [];
  state.waveStartTime = 0;
  state.directorDecisions = [];
  state.killsByType = {};
  state.damageBySource = {};
  state.peakEnemyCount = 0;
}

// ─── Internal Helpers ────────────────────────────────────────

/**
 * Record player position to heatmap grid.
 * @param {{ x: number, y: number }} pos
 */
function _recordHeatmap(pos) {
  // Map arena coordinates to grid cell
  const col = Math.floor((pos.x - ARENA.LEFT) / ARENA.WIDTH * GRID_COLS);
  const row = Math.floor((pos.y - ARENA.TOP) / ARENA.HEIGHT * GRID_ROWS);

  if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
    state.heatmap[row * GRID_COLS + col]++;
    state.heatmapTotal++;
  }
}

/**
 * Get normalized heatmap (each cell 0–1, relative to max).
 * @returns {number[][]} — 12 rows × 8 cols
 */
function _getNormalizedHeatmap() {
  const max = Math.max(1, ...state.heatmap);
  const grid = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    const row = [];
    for (let c = 0; c < GRID_COLS; c++) {
      row.push(state.heatmap[r * GRID_COLS + c] / max);
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Get hotspot (most visited cell).
 * @returns {{ row: number, col: number, visits: number }}
 */
function _getHotspot() {
  let maxVal = 0;
  let maxRow = 0;
  let maxCol = 0;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const v = state.heatmap[r * GRID_COLS + c];
      if (v > maxVal) {
        maxVal = v;
        maxRow = r;
        maxCol = c;
      }
    }
  }
  return { row: maxRow, col: maxCol, visits: maxVal };
}

/**
 * Compute movement predictability score (0–1).
 * Low = erratic/varied, High = repetitive/predictable.
 * Uses circular variance of movement angles.
 */
function _computePredictability() {
  const n = state.moveBufferFilled ? MOVE_BUFFER_SIZE : state.moveBufferIdx;
  if (n < 10) return 0; // Not enough data

  // Compute mean resultant length (circular stats)
  let sumCos = 0;
  let sumSin = 0;
  for (let i = 0; i < n; i++) {
    sumCos += Math.cos(state.moveBuffer[i]);
    sumSin += Math.sin(state.moveBuffer[i]);
  }
  const R = Math.sqrt(sumCos * sumCos + sumSin * sumSin) / n;

  // R close to 1 = all same direction = predictable
  // R close to 0 = all different = erratic
  return R;
}

/**
 * Sample nearest enemy bullet distance for dodge analysis.
 * @param {{ x: number, y: number }} pPos
 */
function _sampleDodgeProximity(pPos) {
  let minDist = Infinity;

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

  state.totalDodgeSamples++;
  if (minDist < CLOSE_DODGE_THRESHOLD) {
    state.closeDodges++;
  }
}

/**
 * Average wave clear duration.
 * @returns {number} seconds
 */
function _avgWaveDuration() {
  if (state.waveClearEvents.length === 0) return 0;
  const total = state.waveClearEvents.reduce((s, w) => s + w.duration, 0);
  return total / state.waveClearEvents.length;
}

/**
 * Fastest wave time.
 * @returns {{ wave: number, duration: number }|null}
 */
function _fastestWave() {
  if (state.waveClearEvents.length === 0) return null;
  return state.waveClearEvents.reduce((best, w) =>
    w.duration < best.duration ? w : best
  );
}

/**
 * Slowest wave time.
 * @returns {{ wave: number, duration: number }|null}
 */
function _slowestWave() {
  if (state.waveClearEvents.length === 0) return null;
  return state.waveClearEvents.reduce((worst, w) =>
    w.duration > worst.duration ? w : worst
  );
}

// ─── Export ──────────────────────────────────────────────────

export default {
  initTelemetry,
  shutdownTelemetry,
  recordFrame,
  getRunSummary,
  resetTelemetry,
};
