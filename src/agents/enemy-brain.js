/**
 * @module agents/enemy-brain
 * @description Per-type enemy AI for SURGE.
 *
 * Each enemy type has a distinct behavior function that creates
 * unique gameplay pressure (LoL Swarm design philosophy):
 *
 *   Drifter — lazy homing with sine wobble.
 *     Threat: attrition. Swarms overwhelm players who stand still.
 *     Counter: keep moving, mow them down with spread/pierce.
 *
 *   Dasher — FSM: idle → telegraph → charge → recover.
 *     Threat: burst. Fast charges punish predictable movement.
 *     Counter: watch the telegraph flash, sidestep or dash.
 *
 *   Sprayer — stationary turret that fires bullet fans.
 *     Threat: area denial. Fans of bullets restrict safe zones.
 *     Counter: close the distance and burst it down between volleys.
 *
 * Called once per tick via updateEnemyBrains(dt).
 */

import world from '../core/ecs.js';
import { normalize, angleTo } from '../core/physics.js';
import { spawnEnemyBullet } from '../game/projectiles.js';
import { getPlayerPos } from '../game/player.js';
import { ENEMIES } from '../config/balance.js';

// ─── Behavior Dispatch ──────────────────────────────────────

/**
 * Behavior function registry, keyed by enemy type string.
 * Each handler signature: (id, pos, vel, enemy, dt, playerPos)
 * @type {Record<string, Function>}
 */
const BEHAVIORS = {
  drifter: updateDrifter,
  dasher:  updateDasher,
  sprayer: updateSprayer,
};

/**
 * Update all enemy AI for one tick.
 * Iterates every entity with (pos, vel, enemy) components
 * and dispatches to the correct type-specific brain.
 *
 * @param {number} dt - Delta time in seconds
 */
export function updateEnemyBrains(dt) {
  const playerPos = getPlayerPos();
  if (!playerPos) return; // no player — enemies idle

  const ids = world.query('pos', 'vel', 'enemy');

  for (const id of ids) {
    const pos = world.get(id, 'pos');
    const vel = world.get(id, 'vel');
    const enemy = world.get(id, 'enemy');

    const behaviorFn = BEHAVIORS[enemy.type];
    if (behaviorFn) {
      behaviorFn(id, pos, vel, enemy, dt, playerPos);
    }
  }
}

// ─── Drifter AI ─────────────────────────────────────────────

/**
 * Drifter: lazy homing swarm mob.
 *
 * Behavior:
 *   1. Move slowly toward the player each frame.
 *   2. Apply a perpendicular sine-wave wobble for visual variety.
 *   3. Each drifter has a random swarm offset so groups don't stack
 *      into a single pixel — this makes swarms feel organic.
 *
 * The wobble makes drifters harder to hit head-on with narrow shots,
 * rewarding spread-shot and pierce upgrades.
 *
 * @param {number} id         - Entity ID
 * @param {Object} pos        - Position component {x, y}
 * @param {Object} vel        - Velocity component {x, y}
 * @param {Object} enemy      - Enemy component
 * @param {number} dt         - Delta time (seconds)
 * @param {Object} playerPos  - Player position {x, y}
 */
function updateDrifter(id, pos, vel, enemy, dt, playerPos) {
  const bp = enemy.behaviorParams;

  // Advance wobble phase
  bp.wobblePhase += bp.wobbleFreq * dt;

  // ── Homing vector toward player (with swarm offset) ──
  const targetX = playerPos.x + bp.swarmOffset;
  const targetY = playerPos.y + bp.swarmOffset * 0.7;

  const dx = targetX - pos.x;
  const dy = targetY - pos.y;
  const dir = normalize(dx, dy);

  // ── Perpendicular wobble vector ──
  // Rotate direction 90° to get perpendicular axis
  const wobbleStrength = Math.sin(bp.wobblePhase) * bp.wobbleAmp;
  const perpX = -dir.y * wobbleStrength;
  const perpY = dir.x * wobbleStrength;

  // ── Final velocity: homing + wobble ──
  vel.x = dir.x * enemy.speed + perpX;
  vel.y = dir.y * enemy.speed + perpY;

  // Apply movement
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
}

// ─── Dasher AI ──────────────────────────────────────────────

/**
 * Dasher: FSM-driven charge attacker.
 *
 * State machine:
 *   idle → telegraph → charge → recover → idle
 *
 * idle:      Slowly approach the player (closing distance).
 *            Transitions to 'telegraph' when within engagement range.
 *
 * telegraph: Stop moving, flash warning for 0.6s.
 *            Locks the charge direction toward player's CURRENT position.
 *            Visual cue gives the player time to react.
 *
 * charge:    Dash in the locked direction at high speed for 0.3s.
 *            Does NOT track player — rewards prediction/sidestepping.
 *            The diamond shape stretches during the charge.
 *
 * recover:   Brief pause (1s) after the charge ends.
 *            Vulnerable window — rewards aggressive counterplay.
 *
 * @param {number} id
 * @param {Object} pos
 * @param {Object} vel
 * @param {Object} enemy
 * @param {number} dt
 * @param {Object} playerPos
 */
function updateDasher(id, pos, vel, enemy, dt, playerPos) {
  const bp = enemy.behaviorParams;

  switch (enemy.state) {

    // ── IDLE: slow approach, waiting to engage ──
    case 'idle': {
      const dx = playerPos.x - pos.x;
      const dy = playerPos.y - pos.y;
      const distToPlayer = Math.sqrt(dx * dx + dy * dy);
      const dir = normalize(dx, dy);

      // Slow approach at base speed
      vel.x = dir.x * enemy.speed;
      vel.y = dir.y * enemy.speed;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;

      // Reset visual stretch
      bp.stretchFactor = 1.0;

      // Transition: close enough to telegraph a charge
      // Engage at ~80px range (roughly 1/3 arena width)
      if (distToPlayer < 80) {
        enemy.state = 'telegraph';
        enemy.stateTimer = bp.telegraphTime;

        // Lock charge direction toward player's current position
        bp.chargeDirX = dir.x;
        bp.chargeDirY = dir.y;
      }
      break;
    }

    // ── TELEGRAPH: stop and flash warning ──
    case 'telegraph': {
      // Halt movement — the dasher "winds up"
      vel.x = 0;
      vel.y = 0;

      // Countdown
      enemy.stateTimer -= dt;

      // Slight visual "coil" — shrink then stretch
      bp.stretchFactor = 0.7 + 0.3 * (1 - enemy.stateTimer / bp.telegraphTime);

      if (enemy.stateTimer <= 0) {
        enemy.state = 'charge';
        enemy.stateTimer = bp.chargeTime;
      }
      break;
    }

    // ── CHARGE: fast dash in locked direction ──
    case 'charge': {
      vel.x = bp.chargeDirX * bp.chargeSpeed;
      vel.y = bp.chargeDirY * bp.chargeSpeed;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;

      // Visual stretch during charge (elongate in charge direction)
      bp.stretchFactor = 2.0;

      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'recover';
        enemy.stateTimer = bp.recoverTime;
        bp.stretchFactor = 1.0;
      }
      break;
    }

    // ── RECOVER: brief pause after charge ──
    case 'recover': {
      // Slow to a stop (decelerate)
      vel.x *= 0.9;
      vel.y *= 0.9;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;

      bp.stretchFactor = 1.0;

      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'idle';
        enemy.stateTimer = 0;
      }
      break;
    }

    // Defensive fallback
    default:
      enemy.state = 'idle';
      break;
  }
}

// ─── Sprayer AI ─────────────────────────────────────────────

/**
 * Sprayer: stationary turret with fan-fire volleys.
 *
 * Behavior:
 *   1. Does NOT move (speed = 0 in config). Planted like a seed.
 *   2. Barrel continuously rotates to track the player.
 *   3. Every fireRate seconds, fires a fan of bullets centered
 *      on the barrel angle (spreadAngle across bulletCount shots).
 *
 * The fan pattern creates expanding "walls" of bullets that
 * restrict movement. Players must weave between the gaps or
 * rush in to destroy the sprayer during its cooldown window.
 *
 * @param {number} id
 * @param {Object} pos
 * @param {Object} vel
 * @param {Object} enemy
 * @param {number} dt
 * @param {Object} playerPos
 */
function updateSprayer(id, pos, vel, enemy, dt, playerPos) {
  const bp = enemy.behaviorParams;

  // ── Stationary — clear velocity ──
  vel.x = 0;
  vel.y = 0;

  // ── Track player with barrel ──
  const targetAngle = angleTo(pos.x, pos.y, playerPos.x, playerPos.y);

  // Smooth barrel rotation (lerp toward target for responsive feel)
  let angleDiff = targetAngle - bp.barrelAngle;

  // Normalize angle difference to [-PI, PI]
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const rotationSpeed = 3.0; // radians per second
  bp.barrelAngle += angleDiff * Math.min(1, rotationSpeed * dt);

  // ── Fire timer ──
  bp.fireTimer -= dt;

  if (bp.fireTimer <= 0) {
    bp.fireTimer = bp.fireRate;
    _sprayerFire(pos, bp);
  }
}

/**
 * Fire a fan of enemy bullets from the sprayer.
 *
 * Bullet pattern: evenly spaced across spreadAngle, centered on barrel.
 * Example with 5 bullets and 60° spread:
 *   angles = [-30°, -15°, 0°, +15°, +30°]
 *
 * @private
 * @param {Object} pos - Sprayer position {x, y}
 * @param {Object} bp  - Sprayer behavior params
 */
function _sprayerFire(pos, bp) {
  const count = bp.bulletCount;
  const halfSpread = bp.spreadAngle / 2;

  for (let i = 0; i < count; i++) {
    // Evenly distribute across the spread arc
    const t = count === 1 ? 0 : (i / (count - 1)) - 0.5; // -0.5 to +0.5
    const angle = bp.barrelAngle + t * bp.spreadAngle;

    const vx = Math.cos(angle) * bp.bulletSpeed;
    const vy = Math.sin(angle) * bp.bulletSpeed;

    spawnEnemyBullet(pos.x, pos.y, vx, vy, 1, 2);
  }
}

// ─── Default Export ─────────────────────────────────────────

export default { updateEnemyBrains };
