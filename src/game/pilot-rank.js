/**
 * @module game/pilot-rank
 * @description Persistent Pilot Rank + XP system.
 *
 * Players earn XP from runs that accumulates into a persistent rank (1-20).
 * Data stored in localStorage.
 *
 * Rank Tiers:
 *   1-5:  Rookie I-V
 *   6-10: Pilot I-V
 *   11-15: Ace I-V
 *   16-19: Commander I-IV
 *   20: Legend
 */

const STORAGE_KEY = 'surge_pilot_rank';

const RANK_DATA = [
  { rank: 1,  title: 'Rookie I',      xpNeeded: 0 },
  { rank: 2,  title: 'Rookie II',     xpNeeded: 200 },
  { rank: 3,  title: 'Rookie III',    xpNeeded: 500 },
  { rank: 4,  title: 'Rookie IV',     xpNeeded: 1000 },
  { rank: 5,  title: 'Rookie V',      xpNeeded: 1800 },
  { rank: 6,  title: 'Pilot I',       xpNeeded: 2500 },
  { rank: 7,  title: 'Pilot II',      xpNeeded: 3500 },
  { rank: 8,  title: 'Pilot III',     xpNeeded: 5000 },
  { rank: 9,  title: 'Pilot IV',      xpNeeded: 7000 },
  { rank: 10, title: 'Pilot V',       xpNeeded: 10000 },
  { rank: 11, title: 'Ace I',         xpNeeded: 14000 },
  { rank: 12, title: 'Ace II',        xpNeeded: 18000 },
  { rank: 13, title: 'Ace III',       xpNeeded: 22000 },
  { rank: 14, title: 'Ace IV',        xpNeeded: 26000 },
  { rank: 15, title: 'Ace V',         xpNeeded: 30000 },
  { rank: 16, title: 'Commander I',   xpNeeded: 40000 },
  { rank: 17, title: 'Commander II',  xpNeeded: 50000 },
  { rank: 18, title: 'Commander III', xpNeeded: 60000 },
  { rank: 19, title: 'Commander IV',  xpNeeded: 70000 },
  { rank: 20, title: 'Legend',        xpNeeded: 80000 },
];

let state = { totalXp: 0, rank: 1, runsToday: 0, lastPlayDate: '' };

/**
 * Load pilot data from localStorage.
 */
export function loadPilotRank() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) state = { ...state, ...saved };
  } catch { /* fresh start */ }
  _recalcRank();
}

/**
 * Save pilot data to localStorage.
 */
function _save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Add XP from a completed run.
 * @param {object} runData — { wave, kills, bossKills, eliteKills, noHitWaves, completed, time }
 * @returns {{ xpGained: number, newRank: number, oldRank: number, rankUp: boolean }}
 */
export function addRunXp(runData) {
  const oldRank = state.rank;
  let xp = 0;

  // Wave survived: 10 × wave_number
  xp += (runData.wave || 0) * 10;

  // Boss killed: 200 each
  xp += (runData.bossKills || 0) * 200;

  // Elite killed: 50 each
  xp += (runData.eliteKills || 0) * 50;

  // Run completed (wave 30): 1000 bonus
  if (runData.completed) xp += 1000;

  // No-hit waves: 50 each
  xp += (runData.noHitWaves || 0) * 50;

  // First run of day bonus: 100
  const today = new Date().toISOString().split('T')[0];
  if (state.lastPlayDate !== today) {
    xp += 100;
    state.runsToday = 0;
  }
  state.lastPlayDate = today;
  state.runsToday++;

  state.totalXp += xp;
  _recalcRank();
  _save();

  return {
    xpGained: xp,
    newRank: state.rank,
    oldRank,
    rankUp: state.rank > oldRank,
  };
}

/**
 * Recalculate rank from total XP.
 */
function _recalcRank() {
  for (let i = RANK_DATA.length - 1; i >= 0; i--) {
    if (state.totalXp >= RANK_DATA[i].xpNeeded) {
      state.rank = RANK_DATA[i].rank;
      return;
    }
  }
  state.rank = 1;
}

/**
 * Get current pilot rank info.
 */
export function getPilotRank() {
  const rd = RANK_DATA[state.rank - 1] || RANK_DATA[0];
  const next = RANK_DATA[state.rank] || null;
  return {
    rank: state.rank,
    title: rd.title,
    totalXp: state.totalXp,
    xpToNext: next ? next.xpNeeded - state.totalXp : 0,
    xpNeeded: next ? next.xpNeeded - rd.xpNeeded : 0,
    progress: next ? (state.totalXp - rd.xpNeeded) / (next.xpNeeded - rd.xpNeeded) : 1,
    maxRank: state.rank >= 20,
  };
}

/**
 * Get rank title for a given rank number.
 */
export function getRankTitle(rank) {
  return RANK_DATA[rank - 1]?.title || 'Unknown';
}

export default { loadPilotRank, addRunXp, getPilotRank, getRankTitle };
