/**
 * @module game/battle-pass
 * @description 30-tier seasonal Battle Pass with free + premium tracks.
 *
 * Season: 30 days, BP XP earned alongside rank XP.
 * Free track: rewards every 3 tiers (coins, common cosmetics).
 * Premium track: rewards every tier (rarer cosmetics, titles).
 */

const STORAGE_KEY = 'surge_battle_pass';
const TIERS = 30;
const XP_PER_TIER = 500;
const SEASON_DAYS = 30;

const FREE_REWARDS = {
  3: { type: 'coins', amount: 100 },
  6: { type: 'cosmetic', id: 'skin_pixel' },
  9: { type: 'coins', amount: 200 },
  12: { type: 'cosmetic', id: 'trail_ice' },
  15: { type: 'coins', amount: 300 },
  18: { type: 'cosmetic', id: 'death_confetti' },
  21: { type: 'coins', amount: 400 },
  24: { type: 'cosmetic', id: 'arena_hex' },
  27: { type: 'coins', amount: 500 },
  30: { type: 'cosmetic', id: 'hud_amber' },
};

const PREMIUM_REWARDS = {
  1:  { type: 'coins', amount: 50 },
  2:  { type: 'cosmetic', id: 'proj_plasma' },
  4:  { type: 'coins', amount: 100 },
  5:  { type: 'cosmetic', id: 'voice_drill' },
  7:  { type: 'coins', amount: 100 },
  8:  { type: 'cosmetic', id: 'trail_fire' },
  10: { type: 'cosmetic', id: 'skin_neon' },
  11: { type: 'coins', amount: 150 },
  13: { type: 'cosmetic', id: 'voice_chill' },
  14: { type: 'coins', amount: 150 },
  16: { type: 'cosmetic', id: 'proj_laser' },
  17: { type: 'coins', amount: 200 },
  19: { type: 'cosmetic', id: 'pal_midnight' },
  20: { type: 'cosmetic', id: 'death_pixel' },
  22: { type: 'coins', amount: 250 },
  23: { type: 'cosmetic', id: 'arena_stars' },
  25: { type: 'cosmetic', id: 'pal_synthwave' },
  26: { type: 'coins', amount: 300 },
  28: { type: 'cosmetic', id: 'hud_hologram' },
  29: { type: 'cosmetic', id: 'skin_stealth' },
  30: { type: 'cosmetic', id: 'trail_rainbow' },
};

let state = {
  season: 1,
  seasonStart: '',
  xp: 0,
  tier: 0,
  premium: false,
  claimedFree: {},
  claimedPremium: {},
};

export function loadBattlePass() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) state = { ...state, ...saved };
  } catch { /* fresh */ }
  _checkSeasonRollover();
}

function _save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function _checkSeasonRollover() {
  if (!state.seasonStart) {
    state.seasonStart = new Date().toISOString();
    _save();
    return;
  }
  const start = new Date(state.seasonStart);
  const now = new Date();
  const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  if (daysPassed >= SEASON_DAYS) {
    // New season
    state.season++;
    state.seasonStart = now.toISOString();
    state.xp = 0;
    state.tier = 0;
    state.claimedFree = {};
    state.claimedPremium = {};
    _save();
  }
}

/**
 * Add BP XP (same amount as rank XP from a run).
 * @param {number} xp
 * @returns {{ newTier: number, oldTier: number, tierUp: boolean }}
 */
export function addBattlePassXp(xp) {
  const oldTier = state.tier;
  state.xp += xp;
  state.tier = Math.min(TIERS, Math.floor(state.xp / XP_PER_TIER));
  _save();
  return { newTier: state.tier, oldTier, tierUp: state.tier > oldTier };
}

/**
 * Claim a free track reward.
 * @returns {{ type: string, amount?: number, id?: string }|null}
 */
export function claimFreeReward(tier) {
  if (tier > state.tier) return null;
  if (state.claimedFree[tier]) return null;
  const reward = FREE_REWARDS[tier];
  if (!reward) return null;
  state.claimedFree[tier] = true;
  _save();
  return reward;
}

/**
 * Claim a premium track reward.
 * @returns {{ type: string, amount?: number, id?: string }|null}
 */
export function claimPremiumReward(tier) {
  if (!state.premium) return null;
  if (tier > state.tier) return null;
  if (state.claimedPremium[tier]) return null;
  const reward = PREMIUM_REWARDS[tier];
  if (!reward) return null;
  state.claimedPremium[tier] = true;
  _save();
  return reward;
}

/**
 * Get battle pass state for UI.
 */
export function getBattlePassState() {
  const daysLeft = _getDaysLeft();
  return {
    season: state.season,
    tier: state.tier,
    xp: state.xp,
    xpToNextTier: XP_PER_TIER - (state.xp % XP_PER_TIER),
    maxTier: TIERS,
    premium: state.premium,
    daysLeft,
    freeRewards: Object.entries(FREE_REWARDS).map(([t, r]) => ({
      tier: parseInt(t), ...r,
      available: parseInt(t) <= state.tier,
      claimed: !!state.claimedFree[t],
    })),
    premiumRewards: Object.entries(PREMIUM_REWARDS).map(([t, r]) => ({
      tier: parseInt(t), ...r,
      available: state.premium && parseInt(t) <= state.tier,
      claimed: !!state.claimedPremium[t],
    })),
  };
}

function _getDaysLeft() {
  if (!state.seasonStart) return SEASON_DAYS;
  const start = new Date(state.seasonStart);
  const now = new Date();
  const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.max(0, SEASON_DAYS - daysPassed);
}

/**
 * Toggle premium status (for testing/purchase).
 */
export function setPremium(val) {
  state.premium = val;
  _save();
}

export default { loadBattlePass, addBattlePassXp, claimFreeReward, claimPremiumReward, getBattlePassState, setPremium };
