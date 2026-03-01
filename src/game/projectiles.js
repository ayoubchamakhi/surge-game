/**
 * @module game/projectiles
 * @description Player + enemy bullet management.
 *
 * ECS-based bullet system. All projectiles share 'bullet' component
 * with owner='player' or owner='enemy'. Physics moves them,
 * this module handles lifetime, collision resolution, and cleanup.
 */

import world from '../core/ecs.js';
import bus from '../core/events.js';
import { isOutOfArena, circleVsCircle, ARENA } from '../core/physics.js';
import { getColor } from '../config/palettes.js';

/**
 * Spawn an enemy bullet.
 * @param {number} x @param {number} y - Spawn position
 * @param {number} vx @param {number} vy - Velocity
 * @param {number} [damage=1]
 * @param {number} [radius=2]
 */
export function spawnEnemyBullet(x, y, vx, vy, damage = 1, radius = 2) {
  const id = world.create();
  world.add(id, 'pos', { x, y });
  world.add(id, 'vel', { x: vx, y: vy });
  world.add(id, 'bullet', {
    damage,
    radius,
    owner: 'enemy',
    pierceRemaining: 0,
    bouncesRemaining: 0,
    homingStrength: 0,
    distanceTraveled: 0,
    maxDistance: 500,
  });
  world.add(id, 'tag', { type: 'enemy_bullet' });
  return id;
}

/**
 * Update all bullets — movement, lifetime, out-of-bounds cleanup.
 * Collision with entities is handled separately in the collision system.
 * @param {number} dt
 */
export function updateBullets(dt) {
  const bulletIds = world.query('pos', 'vel', 'bullet');

  for (const id of bulletIds) {
    const pos = world.get(id, 'pos');
    const vel = world.get(id, 'vel');
    const bullet = world.get(id, 'bullet');

    // Homing (player bullets only)
    if (bullet.homingStrength > 0 && bullet.owner === 'player') {
      _applyHoming(id, pos, vel, bullet);
    }

    // Move
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;

    // Track distance
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    bullet.distanceTraveled += speed * dt;

    // Wall bounce (ricochet)
    if (bullet.bouncesRemaining > 0) {
      let bounced = false;
      if (pos.x - bullet.radius <= ARENA.LEFT || pos.x + bullet.radius >= ARENA.RIGHT) {
        vel.x = -vel.x;
        pos.x = Math.max(ARENA.LEFT + bullet.radius, Math.min(pos.x, ARENA.RIGHT - bullet.radius));
        bounced = true;
      }
      if (pos.y - bullet.radius <= ARENA.TOP || pos.y + bullet.radius >= ARENA.BOTTOM) {
        vel.y = -vel.y;
        pos.y = Math.max(ARENA.TOP + bullet.radius, Math.min(pos.y, ARENA.BOTTOM - bullet.radius));
        bounced = true;
      }
      if (bounced) bullet.bouncesRemaining--;
    }

    // Destroy if out of range or out of arena
    if (bullet.distanceTraveled >= bullet.maxDistance || isOutOfArena(pos.x, pos.y)) {
      world.destroy(id);
    }
  }
}

/**
 * Apply homing behavior to a bullet.
 * @private
 */
function _applyHoming(bulletId, pos, vel, bullet) {
  const enemies = world.query('pos', 'enemy');
  let nearestDist = Infinity;
  let targetX = 0, targetY = 0;
  let found = false;

  for (const eid of enemies) {
    const epos = world.get(eid, 'pos');
    const dx = epos.x - pos.x;
    const dy = epos.y - pos.y;
    const d = dx * dx + dy * dy;
    if (d < nearestDist) {
      nearestDist = d;
      targetX = epos.x;
      targetY = epos.y;
      found = true;
    }
  }

  if (found) {
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

    vel.x += (dx / dist) * bullet.homingStrength * speed;
    vel.y += (dy / dist) * bullet.homingStrength * speed;

    // Re-normalize to maintain speed
    const newSpeed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    if (newSpeed > 0) {
      vel.x = (vel.x / newSpeed) * speed;
      vel.y = (vel.y / newSpeed) * speed;
    }
  }
}

/**
 * Render all bullets.
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderBullets(ctx) {
  const bulletIds = world.query('pos', 'bullet');

  for (const id of bulletIds) {
    const pos = world.get(id, 'pos');
    const bullet = world.get(id, 'bullet');

    if (bullet.owner === 'player') {
      // Player bullets: bright, small, palette color 5
      ctx.fillStyle = getColor(5);
      ctx.fillRect(
        pos.x - bullet.radius,
        pos.y - bullet.radius,
        bullet.radius * 2,
        bullet.radius * 2
      );
    } else {
      // Enemy bullets: red, circular, palette color 10
      ctx.fillStyle = getColor(10);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, bullet.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Get count of bullets on screen (for stress calculation).
 * @returns {{ player: number, enemy: number }}
 */
export function getBulletCounts() {
  const counts = { player: 0, enemy: 0 };
  const bulletIds = world.query('bullet');
  for (const id of bulletIds) {
    const b = world.get(id, 'bullet');
    if (b.owner === 'player') counts.player++;
    else counts.enemy++;
  }
  return counts;
}

export default { spawnEnemyBullet, updateBullets, renderBullets, getBulletCounts };
