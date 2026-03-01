/**
 * SURGE — Color Palettes
 * GBC-inspired 16-color palettes. Each palette is an array of 16 hex strings.
 * Index meanings:
 *   0  = background darkest
 *   1  = background mid
 *   2  = background lightest / grid
 *   3  = player core
 *   4  = player accent
 *   5  = player bullet
 *   6-9  = enemy colors (one per type family)
 *   10 = enemy bullet
 *   11 = HUD text
 *   12 = HUD accent
 *   13 = particle primary
 *   14 = particle secondary
 *   15 = flash / highlight
 *
 * @module config/palettes
 */

export const PALETTES = {
  /** Default palette — deep space green tint (GBC homage) */
  moss: [
    '#0f1b0f', // 0  bg dark
    '#1a2e1a', // 1  bg mid
    '#2d4a2d', // 2  bg light / grid
    '#8bac0f', // 3  player core
    '#9bbc0f', // 4  player accent
    '#c8e060', // 5  player bullet
    '#e06060', // 6  enemy: drifter / warm
    '#e09050', // 7  enemy: dasher / orange
    '#50b0e0', // 8  enemy: sprayer / blue
    '#d050d0', // 9  enemy: orbitor / purple
    '#ff4040', // 10 enemy bullet
    '#d0e8b0', // 11 HUD text
    '#8bac0f', // 12 HUD accent
    '#ffff80', // 13 particle primary
    '#ff8040', // 14 particle secondary
    '#ffffff', // 15 flash / highlight
  ],

  /** Warm palette — ember sunset */
  ember: [
    '#1a0a0a', // 0  bg dark
    '#2e1510', // 1  bg mid
    '#4a2520', // 2  bg light / grid
    '#ff8830', // 3  player core
    '#ffaa50', // 4  player accent
    '#ffe080', // 5  player bullet
    '#60c060', // 6  enemy: drifter / green
    '#40a0e0', // 7  enemy: dasher / blue
    '#e060e0', // 8  enemy: sprayer / pink
    '#40e0e0', // 9  enemy: orbitor / cyan
    '#ff3030', // 10 enemy bullet
    '#ffe0c0', // 11 HUD text
    '#ff8830', // 12 HUD accent
    '#ffff60', // 13 particle primary
    '#ff6030', // 14 particle secondary
    '#ffffff', // 15 flash / highlight
  ],
};

/** Currently active palette name */
let activePalette = 'moss';

/**
 * Get the current palette array
 * @returns {string[]} 16-color hex array
 */
export function getPalette() {
  return PALETTES[activePalette];
}

/**
 * Get a specific color from the active palette
 * @param {number} index - 0-15
 * @returns {string} hex color string
 */
export function getColor(index) {
  return PALETTES[activePalette][index] || '#ff00ff';
}

/**
 * Switch to a named palette
 * @param {string} name
 */
export function setPalette(name) {
  if (PALETTES[name]) {
    activePalette = name;
  }
}

/**
 * Get all available palette names
 * @returns {string[]}
 */
export function getPaletteNames() {
  return Object.keys(PALETTES);
}
