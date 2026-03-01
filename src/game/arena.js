/**
 * @module game/arena
 * @description Arena bounds, spawn points, and zone helpers.
 *
 * The arena is the contained play area. Enemies spawn from its edges.
 * Spawn points are distributed around the perimeter for varied encounters.
 */

import { ARENA, SCREEN } from '../config/balance.js';

/** Pre-computed spawn points around the arena perimeter */
const EDGE_SPAWN_POINTS = [];
const SPAWN_SPACING = 24;

// Top edge
for (let x = ARENA.LEFT; x <= ARENA.RIGHT; x += SPAWN_SPACING) {
  EDGE_SPAWN_POINTS.push({ x, y: ARENA.TOP - 8, edge: 'top' });
}
// Bottom edge
for (let x = ARENA.LEFT; x <= ARENA.RIGHT; x += SPAWN_SPACING) {
  EDGE_SPAWN_POINTS.push({ x, y: ARENA.BOTTOM + 8, edge: 'bottom' });
}
// Left edge
for (let y = ARENA.TOP; y <= ARENA.BOTTOM; y += SPAWN_SPACING) {
  EDGE_SPAWN_POINTS.push({ x: ARENA.LEFT - 8, y, edge: 'left' });
}
// Right edge
for (let y = ARENA.TOP; y <= ARENA.BOTTOM; y += SPAWN_SPACING) {
  EDGE_SPAWN_POINTS.push({ x: ARENA.RIGHT + 8, y, edge: 'right' });
}

/**
 * Get a random spawn point around the arena edge.
 * @returns {{ x: number, y: number, edge: string }}
 */
export function getRandomSpawnPoint() {
  return EDGE_SPAWN_POINTS[(Math.random() * EDGE_SPAWN_POINTS.length) | 0];
}

/**
 * Get spawn points from a specific edge.
 * @param {'top'|'bottom'|'left'|'right'} edge
 * @returns {Array<{x: number, y: number}>}
 */
export function getEdgeSpawnPoints(edge) {
  return EDGE_SPAWN_POINTS.filter(p => p.edge === edge);
}

/**
 * Get spawn points for a "pincer" formation (two opposite sides).
 * @param {number} count - Total spawn count (split between two sides)
 * @returns {Array<{x: number, y: number}>}
 */
export function getPincerSpawnPoints(count) {
  const half = Math.ceil(count / 2);
  const leftPoints = getEdgeSpawnPoints('left');
  const rightPoints = getEdgeSpawnPoints('right');
  const result = [];

  for (let i = 0; i < half && i < leftPoints.length; i++) {
    result.push(leftPoints[i % leftPoints.length]);
  }
  for (let i = 0; i < count - half && i < rightPoints.length; i++) {
    result.push(rightPoints[i % rightPoints.length]);
  }
  return result;
}

/**
 * Get spawn points for a "surround" formation (all edges).
 * @param {number} count
 * @returns {Array<{x: number, y: number}>}
 */
export function getSurroundSpawnPoints(count) {
  const result = [];
  const step = Math.max(1, Math.floor(EDGE_SPAWN_POINTS.length / count));
  for (let i = 0; i < count && i * step < EDGE_SPAWN_POINTS.length; i++) {
    result.push(EDGE_SPAWN_POINTS[i * step]);
  }
  return result;
}

/**
 * Get a random position near a specific edge.
 * @param {'top'|'bottom'|'left'|'right'} edge
 * @returns {{ x: number, y: number }}
 */
export function getSpawnNearEdge(edge) {
  const margin = 8;
  switch (edge) {
    case 'top':
      return { x: ARENA.LEFT + Math.random() * ARENA.WIDTH, y: ARENA.TOP - margin };
    case 'bottom':
      return { x: ARENA.LEFT + Math.random() * ARENA.WIDTH, y: ARENA.BOTTOM + margin };
    case 'left':
      return { x: ARENA.LEFT - margin, y: ARENA.TOP + Math.random() * ARENA.HEIGHT };
    case 'right':
      return { x: ARENA.RIGHT + margin, y: ARENA.TOP + Math.random() * ARENA.HEIGHT };
    default:
      return getRandomSpawnPoint();
  }
}

/**
 * Check if player is in a specific quadrant.
 * @param {number} px @param {number} py
 * @returns {'TL'|'TR'|'BL'|'BR'}
 */
export function getPlayerQuadrant(px, py) {
  const midX = ARENA.CENTER_X;
  const midY = ARENA.CENTER_Y;
  if (px < midX) return py < midY ? 'TL' : 'BL';
  return py < midY ? 'TR' : 'BR';
}

/**
 * Get the opposite edge from the player's nearest edge.
 * Used for spawning enemies behind the player.
 * @param {number} px @param {number} py
 * @returns {'top'|'bottom'|'left'|'right'}
 */
export function getOppositeEdge(px, py) {
  const dTop = py - ARENA.TOP;
  const dBot = ARENA.BOTTOM - py;
  const dLeft = px - ARENA.LEFT;
  const dRight = ARENA.RIGHT - px;
  const min = Math.min(dTop, dBot, dLeft, dRight);
  if (min === dTop) return 'bottom';
  if (min === dBot) return 'top';
  if (min === dLeft) return 'right';
  return 'left';
}

export default {
  getRandomSpawnPoint, getEdgeSpawnPoints, getPincerSpawnPoints,
  getSurroundSpawnPoints, getSpawnNearEdge, getPlayerQuadrant, getOppositeEdge,
};
