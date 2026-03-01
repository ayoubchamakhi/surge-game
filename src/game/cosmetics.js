/**
 * @module game/cosmetics
 * @description Cosmetic Registry + Unlock System — 10 categories, rarity tiers.
 *
 * Categories: Pilot Skins, Trails, Projectile Styles, Death Effects,
 * Palettes, Arena Skins, Director Voices, Kill Effects, HUD Themes, Titles
 *
 * Rarity: Common, Rare, Epic, Legendary
 * Persistence: localStorage
 */

const STORAGE_KEY = 'surge_cosmetics';

const RARITY = {
  common:    { name: 'Common',    color: '#aaaaaa', weight: 60 },
  rare:      { name: 'Rare',      color: '#33ccff', weight: 25 },
  epic:      { name: 'Epic',      color: '#cc66ff', weight: 12 },
  legendary: { name: 'Legendary', color: '#ffaa00', weight: 3 },
};

const CATEGORIES = [
  'pilot_skin', 'trail', 'projectile', 'death_effect', 'palette',
  'arena_skin', 'director_voice', 'kill_effect', 'hud_theme', 'title',
];

/** Registry of all cosmetic items */
const COSMETIC_REGISTRY = [
  // ── Pilot Skins ──
  { id: 'skin_default',    cat: 'pilot_skin', name: 'Standard Issue',   rarity: 'common',    price: 0, earnable: true },
  { id: 'skin_neon',       cat: 'pilot_skin', name: 'Neon Striker',     rarity: 'rare',       price: 200 },
  { id: 'skin_stealth',    cat: 'pilot_skin', name: 'Stealth Runner',   rarity: 'epic',       price: 500 },
  { id: 'skin_golden',     cat: 'pilot_skin', name: 'Golden Ace',       rarity: 'legendary',  price: 1000 },
  { id: 'skin_pixel',      cat: 'pilot_skin', name: 'Pixel Classic',    rarity: 'common',     price: 100, earnable: true },

  // ── Trails ──
  { id: 'trail_default',   cat: 'trail',      name: 'None',             rarity: 'common',    price: 0, earnable: true },
  { id: 'trail_fire',      cat: 'trail',      name: 'Fire Trail',       rarity: 'rare',       price: 200 },
  { id: 'trail_ice',       cat: 'trail',      name: 'Ice Trail',        rarity: 'rare',       price: 200 },
  { id: 'trail_rainbow',   cat: 'trail',      name: 'Rainbow',          rarity: 'epic',       price: 500 },
  { id: 'trail_void',      cat: 'trail',      name: 'Void Wake',        rarity: 'legendary',  price: 1000 },

  // ── Projectile Styles ──
  { id: 'proj_default',    cat: 'projectile', name: 'Standard Rounds',  rarity: 'common',    price: 0, earnable: true },
  { id: 'proj_plasma',     cat: 'projectile', name: 'Plasma Bolts',     rarity: 'rare',       price: 200 },
  { id: 'proj_laser',      cat: 'projectile', name: 'Laser Beams',      rarity: 'epic',       price: 500 },
  { id: 'proj_star',       cat: 'projectile', name: 'Star Shot',        rarity: 'legendary',  price: 1000 },

  // ── Death Effects ──
  { id: 'death_default',   cat: 'death_effect', name: 'Standard Burst', rarity: 'common',    price: 0, earnable: true },
  { id: 'death_confetti',  cat: 'death_effect', name: 'Confetti',       rarity: 'rare',       price: 200 },
  { id: 'death_pixel',     cat: 'death_effect', name: 'Pixel Shatter',  rarity: 'epic',       price: 500 },

  // ── Palettes (map to existing + new) ──
  { id: 'pal_moss',        cat: 'palette',    name: 'Moss (Default)',    rarity: 'common',    price: 0, earnable: true },
  { id: 'pal_ember',       cat: 'palette',    name: 'Ember',            rarity: 'common',    price: 0, earnable: true },
  { id: 'pal_midnight',    cat: 'palette',    name: 'Midnight',         rarity: 'rare',       price: 300 },
  { id: 'pal_synthwave',   cat: 'palette',    name: 'Synthwave',        rarity: 'epic',       price: 600 },

  // ── Arena Skins ──
  { id: 'arena_default',   cat: 'arena_skin', name: 'Grid Standard',    rarity: 'common',    price: 0, earnable: true },
  { id: 'arena_hex',       cat: 'arena_skin', name: 'Hex Grid',         rarity: 'rare',       price: 250 },
  { id: 'arena_stars',     cat: 'arena_skin', name: 'Starfield',        rarity: 'epic',       price: 500 },

  // ── Director Voices ──
  { id: 'voice_default',   cat: 'director_voice', name: 'Clinical',     rarity: 'common',    price: 0, earnable: true },
  { id: 'voice_drill',     cat: 'director_voice', name: 'Drill Sergeant', rarity: 'rare',    price: 200 },
  { id: 'voice_chill',     cat: 'director_voice', name: 'Chill Guide',  rarity: 'rare',       price: 200 },

  // ── HUD Themes ──
  { id: 'hud_default',     cat: 'hud_theme',  name: 'Terminal Green',   rarity: 'common',    price: 0, earnable: true },
  { id: 'hud_amber',       cat: 'hud_theme',  name: 'Amber CRT',       rarity: 'rare',       price: 200 },
  { id: 'hud_hologram',    cat: 'hud_theme',  name: 'Hologram Blue',   rarity: 'epic',       price: 500 },

  // ── Titles ──
  { id: 'title_rookie',    cat: 'title',      name: 'Rookie Pilot',     rarity: 'common',    price: 0, earnable: true },
  { id: 'title_ace',       cat: 'title',      name: 'Top Ace',          rarity: 'rare',       price: 300, earnable: true },
  { id: 'title_legend',    cat: 'title',      name: 'Living Legend',    rarity: 'legendary',  price: 2000 },
];

let state = {
  owned: {},     // id → true
  equipped: {},  // category → id
  coins: 0,
};

export function loadCosmetics() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) state = { ...state, ...saved };
  } catch { /* fresh start */ }

  // Auto-own free items
  for (const c of COSMETIC_REGISTRY) {
    if (c.price === 0) state.owned[c.id] = true;
  }
  // Default equips
  for (const cat of CATEGORIES) {
    if (!state.equipped[cat]) {
      const def = COSMETIC_REGISTRY.find(c => c.cat === cat && c.price === 0);
      if (def) state.equipped[cat] = def.id;
    }
  }
  _save();
}

function _save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Purchase a cosmetic item.
 * @returns {boolean} success
 */
export function purchaseCosmetic(id) {
  if (state.owned[id]) return false;
  const item = COSMETIC_REGISTRY.find(c => c.id === id);
  if (!item) return false;
  if (state.coins < item.price) return false;

  state.coins -= item.price;
  state.owned[id] = true;
  _save();
  return true;
}

/**
 * Unlock a cosmetic (free — from achievement/rank reward).
 */
export function unlockCosmetic(id) {
  state.owned[id] = true;
  _save();
}

/**
 * Equip a cosmetic.
 */
export function equipCosmetic(id) {
  const item = COSMETIC_REGISTRY.find(c => c.id === id);
  if (!item || !state.owned[id]) return false;
  state.equipped[item.cat] = id;
  _save();
  return true;
}

/**
 * Add coins.
 */
export function addCoins(amount) {
  state.coins += amount;
  _save();
}

/**
 * Get coins balance.
 */
export function getCoins() {
  return state.coins;
}

/**
 * Get all cosmetics in a category.
 */
export function getCosmeticsByCategory(cat) {
  return COSMETIC_REGISTRY
    .filter(c => c.cat === cat)
    .map(c => ({
      ...c,
      owned: !!state.owned[c.id],
      equipped: state.equipped[c.cat] === c.id,
      rarityData: RARITY[c.rarity],
    }));
}

/**
 * Get currently equipped cosmetic for a category.
 */
export function getEquipped(cat) {
  const id = state.equipped[cat];
  return COSMETIC_REGISTRY.find(c => c.id === id) || null;
}

/**
 * Get all equipped cosmetics.
 */
export function getAllEquipped() {
  const result = {};
  for (const cat of CATEGORIES) {
    result[cat] = getEquipped(cat);
  }
  return result;
}

export { RARITY, CATEGORIES, COSMETIC_REGISTRY };
export default { loadCosmetics, purchaseCosmetic, unlockCosmetic, equipCosmetic, addCoins, getCoins, getCosmeticsByCategory, getEquipped, getAllEquipped };
