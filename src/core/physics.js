/**
 * @module core/physics
 * @description Collision detection + spatial hash grid for SURGE.
 *
 * Provides:
 *  - SpatialHash: grid-based broad-phase for O(n) collision checks
 *  - Collision helpers: circle–circle, circle–AABB, point-in-rect
 *  - Arena boundary clamping
 *
 * Designed for 500+ entities at 60fps on mid-range phones.
 */

import { ARENA } from '../config/balance.js';

// ─── Spatial Hash ────────────────────────────────────────────

/**
 * Grid-based spatial hash for broad-phase collision detection.
 * Reduces pair checks from O(n²) to O(n × k) where k = avg per cell.
 */
export class SpatialHash {
  /**
   * @param {number} cellSize - Grid cell size in pixels (tunable, default 32)
   */
  constructor(cellSize = 32) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    /** @type {Map<number, number[]>} cell key → entity IDs */
    this._cells = new Map();
    /** @type {Map<number, number[]>} entity ID → cell keys it occupies */
    this._entityCells = new Map();
  }

  /** Clear all cells for a fresh frame */
  clear() {
    this._cells.clear();
    this._entityCells.clear();
  }

  /**
   * Hash a world position to a cell key.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  _key(x, y) {
    const cx = (x * this.invCellSize) | 0;
    const cy = (y * this.invCellSize) | 0;
    return cx * 73856093 ^ cy * 19349663; // spatial hash primes
  }

  /**
   * Insert an entity into the hash based on its bounding circle.
   * @param {number} id     - Entity ID
   * @param {number} x      - Center X
   * @param {number} y      - Center Y
   * @param {number} radius - Bounding radius
   */
  insert(id, x, y, radius) {
    const minCX = ((x - radius) * this.invCellSize) | 0;
    const maxCX = ((x + radius) * this.invCellSize) | 0;
    const minCY = ((y - radius) * this.invCellSize) | 0;
    const maxCY = ((y + radius) * this.invCellSize) | 0;

    const myCells = [];

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const key = cx * 73856093 ^ cy * 19349663;
        let bucket = this._cells.get(key);
        if (!bucket) {
          bucket = [];
          this._cells.set(key, bucket);
        }
        bucket.push(id);
        myCells.push(key);
      }
    }

    this._entityCells.set(id, myCells);
  }

  /**
   * Query all entity IDs that share cells with the given circle.
   * Returns potential collision candidates (broad-phase).
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {Set<number>} Unique entity IDs nearby
   */
  query(x, y, radius) {
    const result = new Set();
    const minCX = ((x - radius) * this.invCellSize) | 0;
    const maxCX = ((x + radius) * this.invCellSize) | 0;
    const minCY = ((y - radius) * this.invCellSize) | 0;
    const maxCY = ((y + radius) * this.invCellSize) | 0;

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const key = cx * 73856093 ^ cy * 19349663;
        const bucket = this._cells.get(key);
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            result.add(bucket[i]);
          }
        }
      }
    }

    return result;
  }
}

// ─── Collision Primitives ────────────────────────────────────

/**
 * Circle vs circle overlap test.
 * @param {number} x1 @param {number} y1 @param {number} r1
 * @param {number} x2 @param {number} y2 @param {number} r2
 * @returns {boolean}
 */
export function circleVsCircle(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distSq = dx * dx + dy * dy;
  const radSum = r1 + r2;
  return distSq <= radSum * radSum;
}

/**
 * Circle vs circle with penetration depth.
 * @returns {{ hit: boolean, depth: number, nx: number, ny: number }}
 */
export function circleVsCircleManifold(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distSq = dx * dx + dy * dy;
  const radSum = r1 + r2;

  if (distSq > radSum * radSum) {
    return { hit: false, depth: 0, nx: 0, ny: 0 };
  }

  const dist = Math.sqrt(distSq) || 0.001;
  return {
    hit: true,
    depth: radSum - dist,
    nx: dx / dist,
    ny: dy / dist,
  };
}

/**
 * Circle vs axis-aligned rectangle.
 * @param {number} cx @param {number} cy @param {number} cr - Circle
 * @param {number} rx @param {number} ry @param {number} rw @param {number} rh - Rect
 * @returns {boolean}
 */
export function circleVsAABB(cx, cy, cr, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) <= (cr * cr);
}

/**
 * Point inside rectangle test.
 */
export function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

// ─── Arena Boundaries ────────────────────────────────────────

/**
 * Clamp a position + radius inside the arena bounds.
 * Returns the clamped position. Mutates nothing.
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {{ x: number, y: number }}
 */
export function clampToArena(x, y, radius) {
  return {
    x: Math.max(ARENA.LEFT + radius, Math.min(x, ARENA.RIGHT - radius)),
    y: Math.max(ARENA.TOP + radius, Math.min(y, ARENA.BOTTOM - radius)),
  };
}

/**
 * Check if a position is outside the arena (for bullet cleanup).
 * @param {number} x
 * @param {number} y
 * @param {number} margin - Extra margin outside arena before considered "out"
 * @returns {boolean}
 */
export function isOutOfArena(x, y, margin = 16) {
  return x < ARENA.LEFT - margin || x > ARENA.RIGHT + margin ||
         y < ARENA.TOP - margin || y > ARENA.BOTTOM + margin;
}

/**
 * Distance squared between two points (avoids sqrt).
 * @param {number} x1 @param {number} y1
 * @param {number} x2 @param {number} y2
 * @returns {number}
 */
export function distSq(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/**
 * Distance between two points.
 */
export function dist(x1, y1, x2, y2) {
  return Math.sqrt(distSq(x1, y1, x2, y2));
}

/**
 * Normalize a vector. Returns {x, y} with length 1, or {0,0} for zero vector.
 */
export function normalize(x, y) {
  const len = Math.sqrt(x * x + y * y);
  if (len < 0.0001) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

/**
 * Linear interpolation
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Angle from point a to point b in radians
 */
export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

// ─── Singleton Spatial Hash ──────────────────────────────────

/** Global spatial hash instance, rebuilt each physics frame */
const spatialHash = new SpatialHash(32);
export { spatialHash };
export default { SpatialHash, spatialHash, circleVsCircle, clampToArena, isOutOfArena };
