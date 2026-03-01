/**
 * @module collision
 * Per-frame collision detection and resolution for SURGE.
 * Uses a spatial hash for broad-phase and circle-vs-circle for narrow-phase.
 */

import world from '../core/ecs.js';
import bus from '../core/events.js';
import { SpatialHash, circleVsCircle, clampToArena } from '../core/physics.js';
import { damagePlayer, getPlayerId, getPlayerPos } from './player.js';
import { damageEnemy } from './enemies.js';
import { SCREEN, ARENA } from '../config/balance.js';

/** Broad-phase spatial hash (cell size 32px) */
const hash = new SpatialHash(32);

/**
 * Run all collision checks and responses for the current frame.
 * @param {number} dt — delta time in seconds
 */
export function updateCollisions(dt) {
  // Track pairs already resolved this frame to prevent double damage
  /** @type {Set<string>} */
  const resolved = new Set();

  // ── 1. Rebuild spatial hash ────────────────────────────────
  hash.clear();

  const enemies = world.query('pos', 'enemy');
  for (let i = 0; i < enemies.length; i++) {
    const id = enemies[i];
    const pos = world.get(id, 'pos');
    const enemy = world.get(id, 'enemy');
    hash.insert(id, pos.x, pos.y, enemy.radius);
  }

  const allBullets = world.query('pos', 'vel', 'bullet');
  for (let i = 0; i < allBullets.length; i++) {
    const id = allBullets[i];
    const bullet = world.get(id, 'bullet');
    if (bullet.owner === 'enemy') {
      const pos = world.get(id, 'pos');
      hash.insert(id, pos.x, pos.y, bullet.radius);
    }
  }

  // ── 2. Player bullets vs enemies ──────────────────────────
  for (let i = 0; i < allBullets.length; i++) {
    const bId = allBullets[i];
    // Bullet may have been destroyed by a previous iteration
    if (!world.has(bId, 'bullet')) continue;

    const bullet = world.get(bId, 'bullet');
    if (bullet.owner !== 'player') continue;

    const bPos = world.get(bId, 'pos');
    const candidates = hash.query(bPos.x, bPos.y, bullet.radius);
    let destroyed = false;

    for (let j = 0; j < candidates.length; j++) {
      const cId = candidates[j];
      if (!world.has(cId, 'enemy')) continue;

      const pairKey = bId < cId ? `${bId}:${cId}` : `${cId}:${bId}`;
      if (resolved.has(pairKey)) continue;

      const ePos = world.get(cId, 'pos');
      const enemy = world.get(cId, 'enemy');

      if (circleVsCircle(bPos.x, bPos.y, bullet.radius, ePos.x, ePos.y, enemy.radius)) {
        resolved.add(pairKey);
        damageEnemy(cId, bullet.damage);
        bus.emit('hit:enemy', { id: cId, x: ePos.x, y: ePos.y, damage: bullet.damage });

        if (bullet.pierce > 0) {
          bullet.pierce--;
        } else {
          world.destroy(bId);
          destroyed = true;
          break;
        }
      }
    }

    if (destroyed) continue;
  }

  // ── 3. Player vs enemies & enemy bullets ──────────────────
  const playerId = getPlayerId();
  if (playerId != null && world.has(playerId, 'player')) {
    const playerComp = world.get(playerId, 'player');
    const pPos = getPlayerPos();

    const nearby = hash.query(pPos.x, pPos.y, playerComp.radius);

    for (let i = 0; i < nearby.length; i++) {
      const cId = nearby[i];

      const pairKey = playerId < cId ? `${playerId}:${cId}` : `${cId}:${playerId}`;
      if (resolved.has(pairKey)) continue;

      // Check enemy collision
      if (world.has(cId, 'enemy')) {
        const ePos = world.get(cId, 'pos');
        const enemy = world.get(cId, 'enemy');

        if (circleVsCircle(pPos.x, pPos.y, playerComp.radius, ePos.x, ePos.y, enemy.radius)) {
          resolved.add(pairKey);
          if (playerComp.invulnTimer <= 0) {
            damagePlayer(1, 'enemy');
            bus.emit('hit:player', { x: pPos.x, y: pPos.y, source: 'enemy' });
          }
        }
      }

      // Check enemy bullet collision
      if (world.has(cId, 'bullet')) {
        const bullet = world.get(cId, 'bullet');
        if (bullet.owner !== 'enemy') continue;

        const bPos = world.get(cId, 'pos');

        if (circleVsCircle(pPos.x, pPos.y, playerComp.radius, bPos.x, bPos.y, bullet.radius)) {
          resolved.add(pairKey);
          if (playerComp.invulnTimer <= 0) {
            damagePlayer(bullet.damage, 'bullet');
            bus.emit('hit:player', { x: pPos.x, y: pPos.y, source: 'bullet' });
          }
          world.destroy(cId);
        }
      }
    }
  }

  // ── 4. Clamp enemies to arena bounds ──────────────────────
  for (let i = 0; i < enemies.length; i++) {
    const id = enemies[i];
    if (!world.has(id, 'pos')) continue;
    const pos = world.get(id, 'pos');
    clampToArena(pos);
  }

  // ── 5. Clamp player to arena bounds ───────────────────────
  if (playerId != null && world.has(playerId, 'pos')) {
    const pPos = world.get(playerId, 'pos');
    clampToArena(pPos);
  }
}
