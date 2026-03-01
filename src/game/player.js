/**
 * @module game/player
 * @description Player entity — movement, auto-fire, dash, health.
 *
 * The player is a geometric craft rendered procedurally.
 * Auto-fires toward the nearest enemy. Dash provides i-frames.
 * Inspired by LoL Swarm's responsive, snappy character controller.
 */

import { PLAYER, ARENA } from '../config/balance.js';
import world from '../core/ecs.js';
import bus from '../core/events.js';
import { clampToArena, normalize, distSq, angleTo } from '../core/physics.js';

/** @type {number|null} The player entity ID (singleton) */
let playerId = null;

// ─── Components ──────────────────────────────────────────────

/**
 * Create the player entity with all required components.
 * @returns {number} player entity ID
 */
export function createPlayer() {
  if (playerId !== null && world.alive(playerId)) {
    destroyPlayer();
  }

  const id = world.create();
  playerId = id;

  world.add(id, 'pos', { x: ARENA.CENTER_X, y: ARENA.CENTER_Y });
  world.add(id, 'vel', { x: 0, y: 0 });
  world.add(id, 'player', {
    speed: PLAYER.SPEED,
    radius: PLAYER.RADIUS,
    // Health
    hp: PLAYER.MAX_HP,
    maxHp: PLAYER.MAX_HP,
    invulnTimer: 0,        // seconds remaining
    alive: true,
    // Firing
    fireTimer: 0,
    fireRate: PLAYER.FIRE_RATE,
    bulletSpeed: PLAYER.BULLET_SPEED,
    bulletDamage: PLAYER.BULLET_DAMAGE,
    bulletRadius: PLAYER.BULLET_RADIUS,
    bulletRange: PLAYER.BULLET_RANGE,
    // Dash
    dashCooldown: PLAYER.DASH_COOLDOWN,
    dashTimer: 0,           // remaining dash duration
    dashCooldownTimer: 0,   // remaining cooldown
    dashSpeed: PLAYER.DASH_SPEED,
    dashDuration: PLAYER.DASH_DURATION,
    isDashing: false,
    dashDirX: 0,
    dashDirY: 0,
    // Stats
    kills: 0,
    score: 0,
    wavesSurvived: 0,
    damageDealt: 0,
    damageTaken: 0,
    // Upgrades (stacks)
    upgrades: {},
    // Visual
    angle: -Math.PI / 2,   // pointing up
    trail: [],              // {x, y} position history
  });

  // Tag for queries
  world.add(id, 'tag', { type: 'player' });

  bus.emit('player:spawn', id);
  return id;
}

/**
 * Destroy the player entity.
 */
export function destroyPlayer() {
  if (playerId !== null) {
    world.destroy(playerId);
    playerId = null;
  }
}

/**
 * Get the player entity ID.
 * @returns {number|null}
 */
export function getPlayerId() {
  return playerId;
}

/**
 * Get the player's position.
 * @returns {{ x: number, y: number }|null}
 */
export function getPlayerPos() {
  if (playerId === null) return null;
  return world.get(playerId, 'pos');
}

/**
 * Get the player component data.
 * @returns {object|null}
 */
export function getPlayerData() {
  if (playerId === null) return null;
  return world.get(playerId, 'player');
}

// ─── Player Update System ───────────────────────────────────

/**
 * Update the player entity. Called as an ECS system.
 * @param {number} moveX - Input -1..1
 * @param {number} moveY - Input -1..1
 * @param {boolean} actionPressed - Dash button
 * @param {number} dt - Delta time
 */
export function updatePlayer(moveX, moveY, actionPressed, dt) {
  if (playerId === null) return;

  const pos = world.get(playerId, 'pos');
  const vel = world.get(playerId, 'vel');
  const p = world.get(playerId, 'player');

  if (!p.alive) return;

  // ── Invulnerability ──
  if (p.invulnTimer > 0) {
    p.invulnTimer -= dt;
  }

  // ── Dash ──
  if (p.dashCooldownTimer > 0) {
    p.dashCooldownTimer -= dt;
  }

  if (p.isDashing) {
    p.dashTimer -= dt;
    if (p.dashTimer <= 0) {
      p.isDashing = false;
      p.dashTimer = 0;
    } else {
      // Dash movement override
      vel.x = p.dashDirX * p.dashSpeed;
      vel.y = p.dashDirY * p.dashSpeed;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      const clamped = clampToArena(pos.x, pos.y, p.radius);
      pos.x = clamped.x;
      pos.y = clamped.y;
      _updateTrail(pos, p);
      return; // Skip normal movement during dash
    }
  }

  // ── Start Dash ──
  if (actionPressed && p.dashCooldownTimer <= 0 && !p.isDashing) {
    p.isDashing = true;
    p.dashTimer = p.dashDuration;
    p.dashCooldownTimer = p.dashCooldown;
    // Dash in movement direction, or forward if stationary
    if (moveX !== 0 || moveY !== 0) {
      const n = normalize(moveX, moveY);
      p.dashDirX = n.x;
      p.dashDirY = n.y;
    } else {
      p.dashDirX = Math.cos(p.angle);
      p.dashDirY = Math.sin(p.angle);
    }
    p.invulnTimer = p.dashDuration + 0.05; // i-frames during dash
    bus.emit('player:dash', pos.x, pos.y);
  }

  // ── Normal Movement ──
  vel.x = moveX * p.speed;
  vel.y = moveY * p.speed;

  pos.x += vel.x * dt;
  pos.y += vel.y * dt;

  // Clamp to arena
  const clamped = clampToArena(pos.x, pos.y, p.radius);
  pos.x = clamped.x;
  pos.y = clamped.y;

  // Update facing angle (toward nearest enemy or movement direction)
  if (moveX !== 0 || moveY !== 0) {
    p.angle = Math.atan2(moveY, moveX);
  }

  _updateTrail(pos, p);

  // ── Auto-Fire ──
  p.fireTimer -= dt;
  if (p.fireTimer <= 0) {
    _autoFire(pos, p);
    p.fireTimer = p.fireRate;
  }
}

/**
 * Handle player taking damage.
 * @param {number} amount - Damage amount
 * @param {string} source - Source type (e.g., 'drifter', 'bullet')
 */
export function damagePlayer(amount, source = 'unknown') {
  if (playerId === null) return;
  const p = world.get(playerId, 'player');
  const pos = world.get(playerId, 'pos');

  if (!p.alive || p.invulnTimer > 0 || p.isDashing) return;

  // Apply armor reduction
  const armor = (p.upgrades.armor || 0);
  const finalDamage = Math.max(1, amount - armor);

  p.hp -= finalDamage;
  p.damageTaken += finalDamage;
  p.invulnTimer = PLAYER.INVULN_TIME;

  bus.emit('player:hit', finalDamage, source, pos.x, pos.y);

  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    bus.emit('player:death', {
      x: pos.x,
      y: pos.y,
      kills: p.kills,
      score: p.score,
      wavesSurvived: p.wavesSurvived,
    });
  }
}

/**
 * Heal the player.
 * @param {number} amount
 */
export function healPlayer(amount) {
  if (playerId === null) return;
  const p = world.get(playerId, 'player');
  p.hp = Math.min(p.maxHp, p.hp + amount);
  bus.emit('player:heal', amount);
}

// ─── Auto-Fire Logic ─────────────────────────────────────────

/**
 * Fire projectiles toward the nearest enemy.
 * @private
 */
function _autoFire(pos, p) {
  // Find nearest enemy
  const enemies = world.query('pos', 'enemy');
  let nearestId = -1;
  let nearestDist = Infinity;

  for (const eid of enemies) {
    const epos = world.get(eid, 'pos');
    const d = distSq(pos.x, pos.y, epos.x, epos.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearestId = eid;
    }
  }

  // Determine fire angle
  let fireAngle = p.angle; // default: facing direction
  if (nearestId >= 0) {
    const epos = world.get(nearestId, 'pos');
    fireAngle = angleTo(pos.x, pos.y, epos.x, epos.y);
    p.angle = fireAngle; // Face the enemy
  }

  // Calculate spread from upgrades
  const spreadStacks = p.upgrades.spread_shot || 0;
  const totalProjectiles = 1 + spreadStacks;
  const spreadAngle = spreadStacks > 0 ? (Math.PI / 12) * spreadStacks : 0;

  for (let i = 0; i < totalProjectiles; i++) {
    let angle = fireAngle;
    if (totalProjectiles > 1) {
      angle = fireAngle - spreadAngle / 2 + (spreadAngle / (totalProjectiles - 1)) * i;
    }

    _spawnBullet(pos, p, angle);
  }

  bus.emit('player:fire', pos.x, pos.y, fireAngle);
}

/**
 * Spawn a player bullet entity.
 * @private
 */
function _spawnBullet(pos, p, angle) {
  const id = world.create();
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  world.add(id, 'pos', { x: pos.x + cos * (p.radius + 2), y: pos.y + sin * (p.radius + 2) });
  world.add(id, 'vel', { x: cos * p.bulletSpeed, y: sin * p.bulletSpeed });
  world.add(id, 'bullet', {
    damage: p.bulletDamage * (1 + (p.upgrades.damage || 0) * 0.25),
    radius: p.bulletRadius,
    owner: 'player',
    pierceRemaining: p.upgrades.pierce || 0,
    bouncesRemaining: p.upgrades.ricochet || 0,
    homingStrength: p.upgrades.homing ? 0.03 * p.upgrades.homing : 0,
    distanceTraveled: 0,
    maxDistance: p.bulletRange,
  });
  world.add(id, 'tag', { type: 'player_bullet' });
}

// ─── Trail ──────────────────────────────────────────────────

function _updateTrail(pos, p) {
  p.trail.push({ x: pos.x, y: pos.y });
  if (p.trail.length > 8) p.trail.shift();
}

// ─── Rendering ──────────────────────────────────────────────

/**
 * Render the player entity.
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderPlayer(ctx) {
  if (playerId === null) return;
  const pos = world.get(playerId, 'pos');
  const p = world.get(playerId, 'player');
  if (!p.alive) return;

  const { getColor } = _paletteModule();

  // Trail
  for (let i = 0; i < p.trail.length; i++) {
    const alpha = (i / p.trail.length) * 0.3;
    const size = p.radius * 0.4;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = getColor(4);
    ctx.fillRect(p.trail[i].x - size / 2, p.trail[i].y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;

  // Invulnerability flash (blink effect)
  if (p.invulnTimer > 0 && Math.floor(p.invulnTimer * 10) % 2 === 0) {
    return; // Skip render frame for blink effect
  }

  // Ship body — triangle pointing in facing direction
  ctx.fillStyle = getColor(3);
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(p.angle);
  ctx.beginPath();
  ctx.moveTo(p.radius, 0);
  ctx.lineTo(-p.radius * 0.6, -p.radius * 0.6);
  ctx.lineTo(-p.radius * 0.3, 0);
  ctx.lineTo(-p.radius * 0.6, p.radius * 0.6);
  ctx.closePath();
  ctx.fill();

  // Accent stripe
  ctx.fillStyle = getColor(4);
  ctx.beginPath();
  ctx.moveTo(p.radius * 0.3, 0);
  ctx.lineTo(-p.radius * 0.2, -p.radius * 0.3);
  ctx.lineTo(-p.radius * 0.2, p.radius * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Dash cooldown indicator (small arc under ship)
  if (p.dashCooldownTimer > 0) {
    const progress = 1 - (p.dashCooldownTimer / p.dashCooldown);
    ctx.strokeStyle = getColor(12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y + p.radius + 3, 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }
}

// Lazy palette import to avoid circular dependency
let _paletteMod = null;
function _paletteModule() {
  if (!_paletteMod) {
    // Import is already loaded at module level in the game
    _paletteMod = { getColor: (i) => {
      const palettes = {
        moss: ['#0f1b0f','#1a2e1a','#2d4a2d','#8bac0f','#9bbc0f','#c8e060','#e06060','#e09050','#50b0e0','#d050d0','#ff4040','#d0e8b0','#8bac0f','#ffff80','#ff8040','#ffffff'],
        ember: ['#1a0a0a','#2e1510','#4a2520','#ff8830','#ffaa50','#ffe080','#60c060','#40a0e0','#e060e0','#40e0e0','#ff3030','#ffe0c0','#ff8830','#ffff60','#ff6030','#ffffff'],
      };
      return palettes.moss[i] || '#ff00ff';
    }};
    try {
      // Use the real palette module
      import('../config/palettes.js').then(m => { _paletteMod = m; });
    } catch (e) { /* fallback already set */ }
  }
  return _paletteMod;
}

export { playerId };
export default {
  createPlayer, destroyPlayer, getPlayerId, getPlayerPos, getPlayerData,
  updatePlayer, damagePlayer, healPlayer, renderPlayer,
};
