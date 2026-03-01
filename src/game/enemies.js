/**
 * @module game/enemies
 * @description Enemy type definitions + factory for SURGE.
 *
 * Each enemy type creates distinct gameplay pressure (LoL Swarm philosophy):
 *   - Drifter:  slow homing swarm — punishes standing still
 *   - Dasher:   telegraph → charge — punishes poor positioning
 *   - Sprayer:  stationary turret — punishes ignoring threats
 *
 * All enemies are ECS entities with: pos, vel, enemy, tag components.
 * The enemy-brain module handles per-type AI (see agents/enemy-brain.js).
 */

import world from '../core/ecs.js';
import bus from '../core/events.js';
import { ENEMIES } from '../config/balance.js';
import { getColor } from '../config/palettes.js';

// ─── Constants ──────────────────────────────────────────────

/** Two-pi constant for full-circle drawing */
const TAU = Math.PI * 2;

/**
 * @typedef {'drifter'|'dasher'|'sprayer'|'orbitor'|'splitter'|'shielder'} EnemyType
 */

/**
 * @typedef {Object} EnemyComponent
 * @property {EnemyType} type         - Enemy archetype
 * @property {number}    hp           - Current hit points
 * @property {number}    maxHp        - Maximum hit points
 * @property {number}    radius       - Collision radius (px)
 * @property {number}    damage       - Contact damage per hit
 * @property {number}    speed        - Movement speed (px/s)
 * @property {number}    score        - Score awarded on kill
 * @property {number}    xp           - XP orb value on death
 * @property {boolean}   isElite      - Elite modifier active
 * @property {boolean}   isBoss       - Boss modifier active
 * @property {string}    state        - Current FSM state
 * @property {number}    stateTimer   - Time remaining in current state (s)
 * @property {Object}    behaviorParams - Type-specific AI parameters
 */

// ─── Type Definitions ───────────────────────────────────────

/**
 * Base stat templates for each enemy type.
 * Values are pulled from balance config; behaviorParams carry
 * type-specific data used by the AI brain module.
 */
const ENEMY_TEMPLATES = {
  drifter: (cfg) => ({
    type: 'drifter',
    hp: cfg.hp,
    maxHp: cfg.hp,
    radius: cfg.radius,
    damage: cfg.damage,
    speed: cfg.speed,
    score: cfg.score,
    xp: cfg.xp,
    isElite: false,
    isBoss: false,
    state: 'idle',
    stateTimer: 0,
    behaviorParams: {
      /** Sine-wave wobble frequency (rad/s) */
      wobbleFreq: 2.0 + Math.random() * 1.5,
      /** Sine-wave wobble amplitude (px) */
      wobbleAmp: 8 + Math.random() * 6,
      /** Accumulated time for wobble phase */
      wobblePhase: Math.random() * TAU,
      /** Slight swarm offset so they don't perfectly stack */
      swarmOffset: (Math.random() - 0.5) * 12,
    },
  }),

  dasher: (cfg) => ({
    type: 'dasher',
    hp: cfg.hp,
    maxHp: cfg.hp,
    radius: cfg.radius,
    damage: cfg.damage,
    speed: cfg.speed,
    score: cfg.score,
    xp: cfg.xp,
    isElite: false,
    isBoss: false,
    state: 'idle',
    stateTimer: 0,
    behaviorParams: {
      /** Speed during charge (px/s) */
      chargeSpeed: cfg.chargeSpeed,
      /** Warning flash duration before charge (s) */
      telegraphTime: cfg.telegraphTime,
      /** Duration of the charge dash (s) */
      chargeTime: cfg.chargeTime,
      /** Recovery pause after charge (s) */
      recoverTime: 1.0,
      /** Direction locked at charge start */
      chargeDirX: 0,
      chargeDirY: 0,
      /** Visual stretch factor (1 = normal, increases during charge) */
      stretchFactor: 1.0,
    },
  }),

  sprayer: (cfg) => ({
    type: 'sprayer',
    hp: cfg.hp,
    maxHp: cfg.hp,
    radius: cfg.radius,
    damage: cfg.damage,
    speed: cfg.speed,
    score: cfg.score,
    xp: cfg.xp,
    isElite: false,
    isBoss: false,
    state: 'idle',
    stateTimer: 0,
    behaviorParams: {
      /** Seconds between bullet volleys */
      fireRate: cfg.fireRate,
      /** Countdown to next volley */
      fireTimer: cfg.fireRate * Math.random(), // stagger initial shots
      /** Speed of spawned bullets (px/s) */
      bulletSpeed: cfg.bulletSpeed,
      /** Number of bullets per volley */
      bulletCount: cfg.bulletCount,
      /** Total fan spread (radians) */
      spreadAngle: cfg.spreadAngle,
      /** Current barrel angle (tracks player) */
      barrelAngle: 0,
    },
  }),
};

// ─── Factory ────────────────────────────────────────────────

/**
 * Spawn an enemy entity of the given type at (x, y).
 *
 * Supports elite/boss modifiers via options:
 *   - elite: 3x HP, 1.5x size, 0.9x speed, 3x score/xp
 *   - boss:  20x HP, 2.5x size, 0.6x speed, 10x score/xp
 *
 * @param {EnemyType} type    - Enemy archetype name
 * @param {number}    x       - Spawn X position
 * @param {number}    y       - Spawn Y position
 * @param {Object}    [options={}]
 * @param {boolean}   [options.elite=false] - Apply elite modifiers
 * @param {boolean}   [options.boss=false]  - Apply boss modifiers
 * @returns {number}  Entity ID of the spawned enemy
 */
export function spawnEnemy(type, x, y, options = {}) {
  const typeKey = type.toUpperCase();
  const cfg = ENEMIES[typeKey];

  if (!cfg) {
    console.warn(`[enemies] Unknown enemy type: "${type}"`);
    return -1;
  }

  // Build template (fall back to drifter if no template yet)
  const templateFn = ENEMY_TEMPLATES[type] || ENEMY_TEMPLATES.drifter;
  const enemy = templateFn(cfg);

  // ── Apply elite modifier ──
  if (options.elite) {
    const e = ENEMIES.ELITE;
    enemy.hp = Math.ceil(enemy.hp * e.hpMultiplier);
    enemy.maxHp = enemy.hp;
    enemy.radius = Math.round(enemy.radius * e.sizeMultiplier);
    enemy.speed *= e.speedMultiplier;
    enemy.score = Math.round(enemy.score * e.scoreMultiplier);
    enemy.xp = Math.round(enemy.xp * e.xpMultiplier);
    enemy.isElite = true;
  }

  // ── Apply boss modifier (overrides elite if both set) ──
  if (options.boss) {
    const b = ENEMIES.BOSS;
    enemy.hp = Math.ceil(enemy.hp * b.hpMultiplier);
    enemy.maxHp = enemy.hp;
    enemy.radius = Math.round(enemy.radius * b.sizeMultiplier);
    enemy.speed *= b.speedMultiplier;
    enemy.score = Math.round(enemy.score * b.scoreMultiplier);
    enemy.xp = Math.round(enemy.xp * b.xpMultiplier);
    enemy.isBoss = true;
  }

  // ── Create ECS entity ──
  const id = world.create();
  world.add(id, 'pos', { x, y });
  world.add(id, 'vel', { x: 0, y: 0 });
  world.add(id, 'enemy', enemy);
  world.add(id, 'tag', { type: 'enemy' });

  bus.emit('enemy:spawn', id, type, x, y);
  return id;
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Get the count of currently living enemies.
 * @returns {number}
 */
export function getEnemyCount() {
  return world.query('pos', 'enemy').length;
}

/**
 * Get an array of all living enemy entity IDs.
 * @returns {number[]}
 */
export function getAllEnemyIds() {
  return world.query('pos', 'enemy');
}

/**
 * Apply damage to an enemy. Handles HP reduction, death, score/xp
 * events, and entity cleanup.
 *
 * @param {number} id      - Enemy entity ID
 * @param {number} amount  - Damage to deal (positive)
 * @param {string} [source='player'] - What dealt the damage (for analytics)
 * @returns {boolean} True if the enemy died from this damage
 */
export function damageEnemy(id, amount, source = 'player') {
  if (!world.alive(id)) return false;

  const enemy = world.get(id, 'enemy');
  if (!enemy) return false;

  enemy.hp -= amount;

  const pos = world.get(id, 'pos');
  bus.emit('enemy:hit', id, amount, source, pos.x, pos.y);

  // ── Death check ──
  if (enemy.hp <= 0) {
    _handleDeath(id, enemy, pos);
    return true;
  }

  return false;
}

/**
 * Instantly kill an enemy (bypass HP check).
 * Useful for nuke upgrades & debug.
 * @param {number} id - Enemy entity ID
 */
export function killEnemy(id) {
  if (!world.alive(id)) return;

  const enemy = world.get(id, 'enemy');
  const pos = world.get(id, 'pos');

  if (enemy && pos) {
    enemy.hp = 0;
    _handleDeath(id, enemy, pos);
  } else {
    world.destroy(id);
  }
}

/**
 * Process enemy death — emit events, schedule destruction.
 * @private
 * @param {number} id
 * @param {EnemyComponent} enemy
 * @param {{ x: number, y: number }} pos
 */
function _handleDeath(id, enemy, pos) {
  bus.emit('enemy:death', id, {
    type: enemy.type,
    x: pos.x,
    y: pos.y,
    score: enemy.score,
    xp: enemy.xp,
    isElite: enemy.isElite,
    isBoss: enemy.isBoss,
  });

  world.destroy(id);
}

// ─── Rendering ──────────────────────────────────────────────

/**
 * Render all living enemies to the canvas.
 * Each type has a unique geometric silhouette for instant readability.
 *
 * Palette indices (from palettes.js):
 *   6 = drifter (warm red)
 *   7 = dasher  (orange)
 *   8 = sprayer (cool blue)
 *
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderEnemies(ctx) {
  const ids = world.query('pos', 'enemy');

  for (const id of ids) {
    const pos = world.get(id, 'pos');
    const enemy = world.get(id, 'enemy');

    switch (enemy.type) {
      case 'drifter': _renderDrifter(ctx, pos, enemy); break;
      case 'dasher':  _renderDasher(ctx, pos, enemy);  break;
      case 'sprayer': _renderSprayer(ctx, pos, enemy);  break;
      default:        _renderFallback(ctx, pos, enemy); break;
    }

    // ── Elite/Boss glow ring ──
    if (enemy.isElite || enemy.isBoss) {
      ctx.strokeStyle = enemy.isBoss ? getColor(15) : getColor(13);
      ctx.lineWidth = enemy.isBoss ? 2 : 1;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, enemy.radius + 3, 0, TAU);
      ctx.stroke();
    }

    // ── HP bar (only if damaged) ──
    if (enemy.hp < enemy.maxHp && enemy.hp > 0) {
      _renderHPBar(ctx, pos, enemy);
    }
  }
}

// ─── Type-Specific Renderers ────────────────────────────────

/**
 * Drifter: small pulsing circle.
 * The pulse conveys "alive" energy — these are the bread-and-butter mob.
 * @private
 */
function _renderDrifter(ctx, pos, enemy) {
  const cfg = ENEMIES.DRIFTER;
  const colorIdx = 6 + (cfg.color || 0);

  // Pulsing opacity based on wobble phase
  const pulse = 0.6 + 0.4 * Math.sin(enemy.behaviorParams.wobblePhase);

  ctx.globalAlpha = pulse;
  ctx.fillStyle = getColor(colorIdx);
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, enemy.radius, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1.0;
}

/**
 * Dasher: diamond shape that stretches during charge.
 * The stretching telegraph makes the charge feel fast and dangerous.
 * @private
 */
function _renderDasher(ctx, pos, enemy) {
  const cfg = ENEMIES.DASHER;
  const colorIdx = 6 + (cfg.color || 1);
  const bp = enemy.behaviorParams;
  const r = enemy.radius;

  // Stretch factor: elongates along charge direction during charge
  const stretch = bp.stretchFactor || 1.0;
  const sx = stretch;      // stretch along X (rotated)
  const sy = 1 / stretch;  // compress perpendicular

  // Flash white during telegraph state
  const isTelegraph = enemy.state === 'telegraph';
  const flashOn = isTelegraph && (Math.floor(enemy.stateTimer * 10) % 2 === 0);

  ctx.fillStyle = flashOn ? getColor(15) : getColor(colorIdx);

  ctx.save();
  ctx.translate(pos.x, pos.y);

  // Rotate toward charge direction if charging
  if (enemy.state === 'charge' && (bp.chargeDirX || bp.chargeDirY)) {
    ctx.rotate(Math.atan2(bp.chargeDirY, bp.chargeDirX));
  }

  ctx.scale(sx, sy);

  // Diamond shape
  ctx.beginPath();
  ctx.moveTo(0, -r);         // top
  ctx.lineTo(r * 0.7, 0);    // right
  ctx.lineTo(0, r);           // bottom
  ctx.lineTo(-r * 0.7, 0);   // left
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Sprayer: octagon with a barrel indicator.
 * The turret aesthetic communicates "stationary ranged threat."
 * @private
 */
function _renderSprayer(ctx, pos, enemy) {
  const cfg = ENEMIES.SPRAYER;
  const colorIdx = 6 + (cfg.color || 2);
  const bp = enemy.behaviorParams;
  const r = enemy.radius;

  ctx.fillStyle = getColor(colorIdx);

  // ── Octagon body ──
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (TAU / 8) * i - TAU / 16; // offset for flat top
    const px = pos.x + Math.cos(angle) * r;
    const py = pos.y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  // ── Barrel indicator (line toward player) ──
  const barrelLen = r + 4;
  const bx = pos.x + Math.cos(bp.barrelAngle) * barrelLen;
  const by = pos.y + Math.sin(bp.barrelAngle) * barrelLen;

  ctx.strokeStyle = getColor(colorIdx);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.lineWidth = 1;
}

/**
 * Fallback renderer for unimplemented types.
 * Simple filled circle with type-based color offset.
 * @private
 */
function _renderFallback(ctx, pos, enemy) {
  ctx.fillStyle = getColor(6);
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, enemy.radius, 0, TAU);
  ctx.fill();
}

/**
 * Render a tiny HP bar above the enemy.
 * @private
 */
function _renderHPBar(ctx, pos, enemy) {
  const barW = enemy.radius * 2.5;
  const barH = 2;
  const barX = pos.x - barW / 2;
  const barY = pos.y - enemy.radius - 5;
  const hpFrac = Math.max(0, enemy.hp / enemy.maxHp);

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(barX, barY, barW, barH);

  // Fill
  ctx.fillStyle = hpFrac > 0.5 ? getColor(13) : getColor(14);
  ctx.fillRect(barX, barY, barW * hpFrac, barH);
}

// ─── Default Export ─────────────────────────────────────────

export default {
  spawnEnemy,
  getEnemyCount,
  getAllEnemyIds,
  damageEnemy,
  killEnemy,
  renderEnemies,
};
