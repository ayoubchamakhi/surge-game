/**
 * @module object-pool
 * Generic object pool for performance optimization (#39).
 * Reduces GC pressure by recycling frequently created/destroyed objects.
 */

export class ObjectPool {
  /**
   * @param {Function} factory - Creates a new object
   * @param {Function} reset   - Resets object for reuse
   * @param {number} initialSize - Pre-allocate count
   */
  constructor(factory, reset, initialSize = 32) {
    this._factory = factory;
    this._reset = reset;
    this._pool = [];
    this._active = new Set();
    this._stats = { created: 0, reused: 0, peak: 0 };

    // Pre-allocate
    for (let i = 0; i < initialSize; i++) {
      this._pool.push(factory());
      this._stats.created++;
    }
  }

  /** Get an object from the pool (or create new if empty). */
  acquire() {
    let obj;
    if (this._pool.length > 0) {
      obj = this._pool.pop();
      this._stats.reused++;
    } else {
      obj = this._factory();
      this._stats.created++;
    }
    this._reset(obj);
    this._active.add(obj);
    if (this._active.size > this._stats.peak) {
      this._stats.peak = this._active.size;
    }
    return obj;
  }

  /** Return an object to the pool. */
  release(obj) {
    if (!this._active.has(obj)) return;
    this._active.delete(obj);
    this._pool.push(obj);
  }

  /** Release all active objects. */
  releaseAll() {
    for (const obj of this._active) {
      this._pool.push(obj);
    }
    this._active.clear();
  }

  /** Get pool statistics. */
  getStats() {
    return {
      ...this._stats,
      poolSize: this._pool.length,
      activeCount: this._active.size,
    };
  }

  get activeCount() { return this._active.size; }
  get poolSize() { return this._pool.length; }
}

// ─── Pre-built pools for common game objects ─────────────────

/** Particle pool */
export const particlePool = new ObjectPool(
  () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: '', size: 1, type: 'circle' }),
  (p) => { p.x = 0; p.y = 0; p.vx = 0; p.vy = 0; p.life = 0; p.maxLife = 0; p.color = ''; p.size = 1; p.type = 'circle'; },
  128
);

/** Vector/point pool for temporary calculations */
export const vecPool = new ObjectPool(
  () => ({ x: 0, y: 0 }),
  (v) => { v.x = 0; v.y = 0; },
  64
);

// ─── Performance monitor ─────────────────────────────────────

let frameTimeSamples = [];
const SAMPLE_WINDOW = 60;

export function recordFrameTime(dt) {
  frameTimeSamples.push(dt);
  if (frameTimeSamples.length > SAMPLE_WINDOW) {
    frameTimeSamples.shift();
  }
}

export function getPerformanceStats() {
  if (frameTimeSamples.length === 0) return { avgFps: 60, minFps: 60, maxFps: 60 };
  const avg = frameTimeSamples.reduce((s, v) => s + v, 0) / frameTimeSamples.length;
  const min = Math.min(...frameTimeSamples);
  const max = Math.max(...frameTimeSamples);
  return {
    avgFps: Math.round(1 / avg),
    minFps: Math.round(1 / max),
    maxFps: Math.round(1 / min),
    avgFrameMs: (avg * 1000).toFixed(1),
    particles: particlePool.getStats(),
  };
}

export function resetPerformanceStats() {
  frameTimeSamples = [];
}

export default { ObjectPool, particlePool, vecPool, recordFrameTime, getPerformanceStats };
