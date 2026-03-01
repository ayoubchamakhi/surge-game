/**
 * @module game/daily-challenges
 * @description Daily Challenge system — 3 challenges per day, deterministic from date seed.
 *
 * Challenges refresh daily. Completing all 3 builds a streak.
 * Rewards: XP bonuses.
 */

const STORAGE_KEY = 'surge_daily_challenges';

const CHALLENGE_POOL = [
  { id: 'kill_200',       desc: 'Kill 200 enemies in a single run', check: r => r.totalKills >= 200, difficulty: 1 },
  { id: 'kill_500',       desc: 'Kill 500 enemies in a single run', check: r => r.totalKills >= 500, difficulty: 2 },
  { id: 'wave_10',        desc: 'Reach wave 10', check: r => r.wavesCleared >= 10, difficulty: 1 },
  { id: 'wave_15',        desc: 'Reach wave 15', check: r => r.wavesCleared >= 15, difficulty: 2 },
  { id: 'wave_20',        desc: 'Reach wave 20 without healing', check: r => r.wavesCleared >= 20 && !r.usedRegen, difficulty: 3 },
  { id: 'no_damage_5',    desc: 'Clear 5 waves without taking damage', check: r => r.noHitWaves >= 5, difficulty: 2 },
  { id: 'boss_kill',      desc: 'Kill a boss', check: r => r.bossKills >= 1, difficulty: 1 },
  { id: 'boss_3',         desc: 'Kill 3 bosses today', check: r => r.bossKills >= 3, difficulty: 3 },
  { id: 'speed_5min',     desc: 'Complete a run in under 5 minutes', check: r => r.completed && r.runTime < 300, difficulty: 3 },
  { id: 'low_hp',         desc: 'Survive 10 waves with ≤2 HP', check: r => r.lowHpWaves >= 10, difficulty: 2 },
  { id: 'projectile_only', desc: 'Win using only projectile upgrades', check: r => r.completed && r.projectileOnly, difficulty: 3 },
  { id: 'defense_only',   desc: 'Win using only defense upgrades', check: r => r.completed && r.defenseOnly, difficulty: 3 },
  { id: 'adaptive_win',   desc: 'Complete a run on Adaptive mode', check: r => r.completed && r.mode === 'adaptive', difficulty: 2 },
  { id: 'score_5k',       desc: 'Score 5,000+ in a single run', check: r => r.score >= 5000, difficulty: 1 },
  { id: 'score_20k',      desc: 'Score 20,000+ in a single run', check: r => r.score >= 20000, difficulty: 2 },
  { id: 'efficiency',     desc: 'Maintain 2+ kills/sec average', check: r => r.killEfficiency >= 2, difficulty: 2 },
  { id: 'elite_5',        desc: 'Kill 5 elites in one run', check: r => r.eliteKills >= 5, difficulty: 2 },
  { id: 'no_dash',        desc: 'Reach wave 10 without dashing', check: r => r.wavesCleared >= 10 && !r.usedDash, difficulty: 3 },
];

let state = { completedToday: {}, streak: 0, lastCompleteDate: '', todaysSeed: '' };

/**
 * Load daily data from localStorage.
 */
export function loadDailyChallenges() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) state = { ...state, ...saved };
  } catch { /* fresh start */ }
  _checkDateRollover();
}

function _save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function _getDateSeed() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Simple seeded hash for deterministic daily picks.
 */
function _hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function _checkDateRollover() {
  const today = _getDateSeed();
  if (state.todaysSeed !== today) {
    // Check if yesterday was completed for streak
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (state.lastCompleteDate === yesterdayStr) {
      // Streak continues
    } else if (state.lastCompleteDate !== today) {
      state.streak = 0; // Streak broken
    }

    state.completedToday = {};
    state.todaysSeed = today;
    _save();
  }
}

/**
 * Get today's 3 challenges.
 * @returns {Array<{id: string, desc: string, difficulty: number, completed: boolean}>}
 */
export function getDailyChallenges() {
  const seed = _hashSeed(state.todaysSeed || _getDateSeed());
  const pool = [...CHALLENGE_POOL];

  // Pick 3 challenges deterministically: 1 easy, 1 medium, 1 hard
  const easy = pool.filter(c => c.difficulty === 1);
  const med = pool.filter(c => c.difficulty === 2);
  const hard = pool.filter(c => c.difficulty === 3);

  const picks = [
    easy[seed % easy.length],
    med[(seed >> 4) % med.length],
    hard[(seed >> 8) % hard.length],
  ];

  return picks.map(c => ({
    id: c.id,
    desc: c.desc,
    difficulty: c.difficulty,
    stars: c.difficulty,
    completed: !!state.completedToday[c.id],
    reward: c.difficulty === 1 ? 50 : c.difficulty === 2 ? 150 : 300,
  }));
}

/**
 * Check run results against today's challenges.
 * @param {object} runData
 * @returns {{ completed: string[], xpReward: number, allComplete: boolean, streak: number }}
 */
export function checkDailyChallenges(runData) {
  const challenges = getDailyChallenges();
  const completed = [];
  let xpReward = 0;

  for (const c of challenges) {
    if (c.completed) continue;
    const def = CHALLENGE_POOL.find(p => p.id === c.id);
    if (def && def.check(runData)) {
      state.completedToday[c.id] = true;
      completed.push(c.id);
      xpReward += c.reward;
    }
  }

  // Check if all 3 are now complete
  const updated = getDailyChallenges();
  const allComplete = updated.every(c => c.completed);

  if (allComplete && state.lastCompleteDate !== state.todaysSeed) {
    state.streak++;
    state.lastCompleteDate = state.todaysSeed;
  }

  _save();
  return { completed, xpReward, allComplete, streak: state.streak };
}

/**
 * Get the current streak count.
 */
export function getDailyStreak() {
  return state.streak;
}

export default { loadDailyChallenges, getDailyChallenges, checkDailyChallenges, getDailyStreak };
