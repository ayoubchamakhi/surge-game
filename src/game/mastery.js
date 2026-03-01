/**
 * @module game/mastery
 * @description Mastery Badges + Bestiary — per-upgrade and per-enemy mastery tracking.
 *
 * Tiers: Bronze (100) → Silver (500) → Gold (2000) → Diamond (5000)
 * Stored in localStorage.
 */

const STORAGE_KEY = 'surge_mastery';

const TIERS = [
  { name: 'Bronze',  threshold: 100,  icon: '🥉' },
  { name: 'Silver',  threshold: 500,  icon: '🥈' },
  { name: 'Gold',    threshold: 2000, icon: '🥇' },
  { name: 'Diamond', threshold: 5000, icon: '💎' },
];

let state = {
  upgrades: {},  // upgradeId → { xp: number }
  enemies: {},   // enemyType → { kills: number }
};

export function loadMastery() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) state = { ...state, ...saved };
  } catch { /* fresh start */ }
}

function _save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Record mastery XP from a completed run.
 * @param {object} runData — { upgrades: [{upgradeId, wave}], killsByType: {type: count}, wavesCleared }
 */
export function recordMastery(runData) {
  // Upgrade mastery: XP for picking + using
  if (runData.upgrades) {
    for (const u of runData.upgrades) {
      const id = u.upgradeId || u;
      if (!state.upgrades[id]) state.upgrades[id] = { xp: 0 };
      // 50 XP for picking, + 10 per wave survived with it
      state.upgrades[id].xp += 50 + (runData.wavesCleared || 0) * 10;
    }
  }

  // Enemy mastery: kills
  if (runData.killsByType) {
    for (const [type, count] of Object.entries(runData.killsByType)) {
      if (!state.enemies[type]) state.enemies[type] = { kills: 0 };
      state.enemies[type].kills += count;
    }
  }

  _save();
}

/**
 * Get mastery tier for a given XP/kill count.
 */
function _getTier(value) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (value >= TIERS[i].threshold) return TIERS[i];
  }
  return null;
}

function _getNextTier(value) {
  for (const t of TIERS) {
    if (value < t.threshold) return t;
  }
  return null;
}

/**
 * Get all upgrade mastery data.
 */
export function getUpgradeMastery() {
  const result = {};
  for (const [id, data] of Object.entries(state.upgrades)) {
    const tier = _getTier(data.xp);
    const next = _getNextTier(data.xp);
    result[id] = {
      xp: data.xp,
      tier: tier?.name || 'None',
      tierIcon: tier?.icon || '',
      nextTier: next?.name || null,
      nextThreshold: next?.threshold || null,
      progress: next ? data.xp / next.threshold : 1,
    };
  }
  return result;
}

/**
 * Get all enemy mastery (bestiary).
 */
export function getEnemyMastery() {
  const result = {};
  for (const [type, data] of Object.entries(state.enemies)) {
    const tier = _getTier(data.kills);
    const next = _getNextTier(data.kills);
    result[type] = {
      kills: data.kills,
      tier: tier?.name || 'None',
      tierIcon: tier?.icon || '',
      nextTier: next?.name || null,
      nextThreshold: next?.threshold || null,
      progress: next ? data.kills / next.threshold : 1,
    };
  }
  return result;
}

/**
 * Get total diamond badges count.
 */
export function getDiamondCount() {
  let count = 0;
  for (const d of Object.values(state.upgrades)) {
    if (d.xp >= 5000) count++;
  }
  for (const d of Object.values(state.enemies)) {
    if (d.kills >= 5000) count++;
  }
  return count;
}

export { TIERS };
export default { loadMastery, recordMastery, getUpgradeMastery, getEnemyMastery, getDiamondCount };
