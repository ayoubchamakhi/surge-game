/**
 * @module particles
 * Lightweight pooled particle system for SURGE visual effects.
 * Handles explosions, hit sparks, death bursts, and trails.
 */

import { getColor } from '../config/palettes.js';
import { SCREEN } from '../config/balance.js';

/** Maximum number of live particles in the pool */
const MAX_PARTICLES = 300;

/**
 * @typedef {'circle'|'spark'|'ring'} ParticleType
 */

/**
 * @typedef {Object} Particle
 * @property {number}  x       — world x position
 * @property {number}  y       — world y position
 * @property {number}  vx      — velocity x (px/s)
 * @property {number}  vy      — velocity y (px/s)
 * @property {number}  life    — remaining life in seconds
 * @property {number}  maxLife — initial life span (for alpha calc)
 * @property {number}  radius  — base radius in px
 * @property {string}  color   — CSS color string
 * @property {ParticleType} type — rendering style
 * @property {boolean} active  — whether this slot is in use
 */

/** @type {Particle[]} */
const pool = [];

// Pre-allocate the pool
for (let i = 0; i < MAX_PARTICLES; i++) {
  pool.push({
    x: 0, y: 0,
    vx: 0, vy: 0,
    life: 0, maxLife: 0,
    radius: 2, color: '#fff',
    type: 'circle',
    active: false,
  });
}

// ── Internal helpers ─────────────────────────────────────────

/**
 * Acquire a free particle slot from the pool.
 * Returns null when the pool is exhausted.
 * @returns {Particle|null}
 */
function acquire() {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (!pool[i].active) return pool[i];
  }
  return null;
}

/**
 * Random float in [min, max).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function rng(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Random integer in [min, max].
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function rngInt(min, max) {
  return (Math.random() * (max - min + 1) | 0) + min;
}

// ── Emitter helpers ──────────────────────────────────────────

/**
 * Burst of particles radiating outward from a point.
 * @param {number} x      — origin x
 * @param {number} y      — origin y
 * @param {string} color  — CSS color
 * @param {number} count  — number of particles to spawn
 */
export function spawnExplosion(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) return;
    const angle = Math.random() * Math.PI * 2;
    const speed = rng(40, 160);
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.life = rng(0.2, 0.5);
    p.maxLife = p.life;
    p.radius = rng(1.5, 4);
    p.color = color;
    p.type = 'circle';
    p.active = true;
  }
}

/**
 * Small spark cluster at impact point (3–5 fast particles).
 * @param {number} x     — origin x
 * @param {number} y     — origin y
 * @param {string} color — CSS color
 */
export function spawnHitSpark(x, y, color) {
  const n = rngInt(3, 5);
  for (let i = 0; i < n; i++) {
    const p = acquire();
    if (!p) return;
    const angle = Math.random() * Math.PI * 2;
    const speed = rng(80, 220);
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.life = rng(0.1, 0.25);
    p.maxLife = p.life;
    p.radius = rng(1, 2.5);
    p.color = color;
    p.type = 'spark';
    p.active = true;
  }
}

/**
 * Large burst with mixed colors, used for enemy death.
 * @param {number}   x      — origin x
 * @param {number}   y      — origin y
 * @param {string[]} colors — array of CSS colors to pick from
 * @param {number}   count  — total particles
 */
export function spawnDeathBurst(x, y, colors, count) {
  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) return;
    const angle = Math.random() * Math.PI * 2;
    const speed = rng(60, 200);
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.life = rng(0.3, 0.7);
    p.maxLife = p.life;
    p.radius = rng(2, 6);
    p.color = colors[i % colors.length];
    p.type = i % 4 === 0 ? 'ring' : 'circle';
    p.active = true;
  }
}

/**
 * Single small fading trail particle.
 * @param {number} x     — spawn x
 * @param {number} y     — spawn y
 * @param {string} color — CSS color
 */
export function spawnTrail(x, y, color) {
  const p = acquire();
  if (!p) return;
  p.x = x;
  p.y = y;
  p.vx = rng(-10, 10);
  p.vy = rng(-10, 10);
  p.life = rng(0.15, 0.35);
  p.maxLife = p.life;
  p.radius = rng(1, 2);
  p.color = color;
  p.type = 'circle';
  p.active = true;
}

// ── Update & Render ──────────────────────────────────────────

/**
 * Advance all active particles by dt seconds.
 * Deactivates particles whose life has expired.
 * @param {number} dt — delta time in seconds
 */
export function updateParticles(dt) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = pool[i];
    if (!p.active) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
    }
  }
}

/**
 * Draw every active particle to the provided canvas context.
 * Alpha is derived from remaining life ratio for a natural fade-out.
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderParticles(ctx) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = pool[i];
    if (!p.active) continue;

    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;

    switch (p.type) {
      case 'circle': {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * alpha + 0.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'spark': {
        // Stretch along velocity direction
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed < 0.01) break;
        const nx = p.vx / speed;
        const ny = p.vy / speed;
        const len = Math.min(speed * 0.04, 8) * alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.radius * alpha + 0.5;
        ctx.beginPath();
        ctx.moveTo(p.x - nx * len, p.y - ny * len);
        ctx.lineTo(p.x + nx * len, p.y + ny * len);
        ctx.stroke();
        break;
      }

      case 'ring': {
        // Expanding hollow circle
        const progress = 1 - (p.life / p.maxLife);
        const ringRadius = p.radius + progress * p.radius * 3;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.5, (1 - progress) * 2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }
  }

  ctx.globalAlpha = 1;
}

/**
 * Immediately deactivate every particle in the pool.
 */
export function clearParticles() {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pool[i].active = false;
  }
}
