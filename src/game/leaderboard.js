/**
 * @module game/leaderboard
 * @description Local leaderboard + seed sharing system.
 *
 * Top 50 runs stored locally. Entries include seed for replay.
 * Score formula: (wave × 100) + (kills × 2) + time_bonus + (no_hit_waves × 50)
 */

const STORAGE_KEY = 'surge_leaderboard';
const MAX_ENTRIES = 50;

let entries = [];

/**
 * Load leaderboard from localStorage.
 */
export function loadLeaderboard() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) entries = saved;
  } catch { /* fresh start */ }
}

function _save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/**
 * Calculate the composite score for a run.
 */
export function calculateScore(runData) {
  const wave = runData.wavesCleared || runData.wave || 0;
  const kills = runData.totalKills || runData.kills || 0;
  const time = runData.runTime || 0;
  const noHit = runData.noHitWaves || 0;

  const waveScore = wave * 100;
  const killScore = kills * 2;
  const timeBonus = Math.max(0, Math.floor((600 - time) / 10)); // bonus for faster runs
  const noHitBonus = noHit * 50;

  return waveScore + killScore + timeBonus + noHitBonus;
}

/**
 * Add a run to the leaderboard.
 * @param {object} runData
 * @returns {{ rank: number, isNewBest: boolean }}
 */
export function addLeaderboardEntry(runData) {
  const score = runData.score || calculateScore(runData);

  const entry = {
    score,
    wave: runData.wavesCleared || runData.wave || 0,
    kills: runData.totalKills || runData.kills || 0,
    time: Math.round(runData.runTime || 0),
    date: new Date().toISOString(),
    seed: runData.seed || 0,
    mode: runData.mode || 'classic',
    build: runData.build || [],
    rank: 0,
  };

  entries.push(entry);
  entries.sort((a, b) => b.score - a.score);
  entries = entries.slice(0, MAX_ENTRIES);

  // Assign ranks
  entries.forEach((e, i) => { e.rank = i + 1; });

  _save();

  const rank = entries.findIndex(e => e === entry) + 1;
  const isNewBest = rank === 1;

  return { rank: rank || entries.length, isNewBest };
}

/**
 * Get leaderboard entries, optionally filtered and sorted.
 * @param {object} [options]
 * @param {'score'|'wave'|'kills'|'time'} [options.sortBy='score']
 * @param {string} [options.mode] — filter by mode
 * @param {number} [options.limit=50]
 * @returns {Array}
 */
export function getLeaderboard(options = {}) {
  let result = [...entries];

  if (options.mode && options.mode !== 'all') {
    result = result.filter(e => e.mode === options.mode);
  }

  const sortBy = options.sortBy || 'score';
  switch (sortBy) {
    case 'wave': result.sort((a, b) => b.wave - a.wave); break;
    case 'kills': result.sort((a, b) => b.kills - a.kills); break;
    case 'time': result.sort((a, b) => a.time - b.time); break;
    default: result.sort((a, b) => b.score - a.score);
  }

  result.forEach((e, i) => { e.rank = i + 1; });
  return result.slice(0, options.limit || MAX_ENTRIES);
}

/**
 * Get the best score.
 */
export function getBestScore() {
  return entries.length > 0 ? entries[0].score : 0;
}

/**
 * Generate a shareable seed string.
 */
export function generateSeedString(seed, mode) {
  return `SURGE-${mode.toUpperCase()}-${seed.toString(16).toUpperCase()}`;
}

/**
 * Parse a seed string.
 */
export function parseSeedString(str) {
  const match = str.match(/SURGE-(\w+)-([A-F0-9]+)/i);
  if (!match) return null;
  return { mode: match[1].toLowerCase(), seed: parseInt(match[2], 16) };
}

export default { loadLeaderboard, addLeaderboardEntry, getLeaderboard, getBestScore, calculateScore };
