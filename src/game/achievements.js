/**
 * @module game/achievements
 * @description Achievement System — 40 achievements across 4 categories.
 *
 * Categories: Combat (10), Survival (10), Mastery (10), Fun (10)
 * Stored in localStorage, checked after each run.
 */

const STORAGE_KEY = 'surge_achievements';

/** @type {Achievement[]} */
const ACHIEVEMENTS = [
  // ━━━ COMBAT (10) ━━━
  { id: 'first_blood',     name: 'First Blood',     desc: 'Kill your first enemy', category: 'combat', icon: '🗡' },
  { id: 'century',         name: 'Century',          desc: 'Kill 100 enemies in one run', category: 'combat', icon: '💯' },
  { id: 'thousand_cuts',   name: 'Thousand Cuts',    desc: 'Kill 1000 enemies in one run', category: 'combat', icon: '⚔' },
  { id: 'boss_slayer',     name: 'Boss Slayer',      desc: 'Defeat a boss', category: 'combat', icon: '👑' },
  { id: 'elite_hunter',    name: 'Elite Hunter',     desc: 'Kill 10 elites in one run', category: 'combat', icon: '🎯' },
  { id: 'untouchable',     name: 'Untouchable',      desc: 'Clear 5 waves without damage', category: 'combat', icon: '✨' },
  { id: 'glass_cannon',    name: 'Glass Cannon',     desc: 'Win with ≤1 HP upgrade', category: 'combat', icon: '🔫' },
  { id: 'speed_demon',     name: 'Speed Demon',      desc: 'Kill a boss in under 10s', category: 'combat', icon: '⚡' },
  { id: 'overkill',        name: 'Overkill',         desc: 'Deal 50+ damage to a boss', category: 'combat', icon: '💥' },
  { id: 'combo_king',      name: 'Combo King',       desc: 'Get a 50-kill combo', category: 'combat', icon: '🔥' },

  // ━━━ SURVIVAL (10) ━━━
  { id: 'survivor',        name: 'Survivor',         desc: 'Reach wave 10', category: 'survival', icon: '🛡' },
  { id: 'veteran',         name: 'Veteran',          desc: 'Reach wave 20', category: 'survival', icon: '🏅' },
  { id: 'champion',        name: 'Champion',         desc: 'Clear all 30 waves', category: 'survival', icon: '🏆' },
  { id: 'iron_will',       name: 'Iron Will',        desc: 'Survive with 1 HP for 30s', category: 'survival', icon: '❤' },
  { id: 'full_health',     name: 'Full Health',      desc: 'End a run at full HP', category: 'survival', icon: '💚' },
  { id: 'speed_runner',    name: 'Speed Runner',     desc: 'Clear 30 waves under 10 min', category: 'survival', icon: '⏱' },
  { id: 'marathon',        name: 'Marathon',          desc: 'Play for 15+ minutes in one run', category: 'survival', icon: '🏃' },
  { id: 'close_call',      name: 'Close Call',       desc: 'Survive a wave with 1 HP', category: 'survival', icon: '😰' },
  { id: 'pacifist_wave',   name: 'Pacifist Wave',    desc: 'Survive a wave with 0 kills', category: 'survival', icon: '☮' },
  { id: 'no_upgrades',     name: 'Minimalist',       desc: 'Reach wave 10 with no upgrades', category: 'survival', icon: '🚫' },

  // ━━━ MASTERY (10) ━━━
  { id: 'adaptive_clear',  name: 'Adaptive Victor',  desc: 'Win on Adaptive mode', category: 'mastery', icon: '🤖' },
  { id: 'llm_clear',       name: 'AI Directed',      desc: 'Win on LLM mode', category: 'mastery', icon: '🧠' },
  { id: 'all_upgrades',    name: 'Fully Loaded',     desc: 'Have 5+ different upgrades', category: 'mastery', icon: '📦' },
  { id: 'max_stack',       name: 'Specialist',       desc: 'Max out any upgrade (3 stacks)', category: 'mastery', icon: '📈' },
  { id: 'perfect_wave',    name: 'Perfect Wave',     desc: 'Clear a wave with S-rank speed, 0 damage', category: 'mastery', icon: '💎' },
  { id: 'rank5',           name: 'Pilot Rank 5',     desc: 'Reach Pilot rank', category: 'mastery', icon: '🎖' },
  { id: 'rank10',          name: 'Pilot Rank 10',    desc: 'Reach Pilot V rank', category: 'mastery', icon: '🎖' },
  { id: 'rank15',          name: 'Ace Rank',         desc: 'Reach Ace V rank', category: 'mastery', icon: '✈' },
  { id: 'rank20',          name: 'Legend',            desc: 'Reach Legend rank', category: 'mastery', icon: '⭐' },
  { id: 'streak_7',        name: 'Weekly Warrior',   desc: 'Complete daily challenges 7 days in a row', category: 'mastery', icon: '📅' },

  // ━━━ FUN (10) ━━━
  { id: 'ten_runs',        name: 'Dedicated',        desc: 'Complete 10 runs', category: 'fun', icon: '🎮' },
  { id: 'fifty_runs',      name: 'Addicted',          desc: 'Complete 50 runs', category: 'fun', icon: '🎮' },
  { id: 'hundred_runs',    name: 'Obsessed',          desc: 'Complete 100 runs', category: 'fun', icon: '🎮' },
  { id: 'score_10k',       name: '10K Club',         desc: 'Score 10,000 in one run', category: 'fun', icon: '💰' },
  { id: 'score_50k',       name: '50K Club',         desc: 'Score 50,000 in one run', category: 'fun', icon: '💰' },
  { id: 'all_enemy_types', name: 'Bestiary',         desc: 'Kill every enemy type in one run', category: 'fun', icon: '📖' },
  { id: 'drifter_1000',    name: 'Drifter Bane',     desc: 'Kill 1000 drifters total', category: 'fun', icon: '👻' },
  { id: 'dasher_500',      name: 'Dasher Dodger',    desc: 'Kill 500 dashers total', category: 'fun', icon: '💨' },
  { id: 'night_owl',       name: 'Night Owl',        desc: 'Play between midnight and 4am', category: 'fun', icon: '🦉' },
  { id: 'diverse_builds',  name: 'Experimenter',     desc: 'Use 10 different upgrade combos', category: 'fun', icon: '🔬' },
];

let unlocked = {};
let totalRuns = 0;
let totalKillsByType = {};
let uniqueBuilds = new Set();

/**
 * Load achievements from localStorage.
 */
export function loadAchievements() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      unlocked = saved.unlocked || {};
      totalRuns = saved.totalRuns || 0;
      totalKillsByType = saved.totalKillsByType || {};
      uniqueBuilds = new Set(saved.uniqueBuilds || []);
    }
  } catch { /* fresh start */ }
}

function _save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    unlocked,
    totalRuns,
    totalKillsByType,
    uniqueBuilds: [...uniqueBuilds],
  }));
}

/**
 * Check and unlock achievements after a run.
 * @param {object} runData — run summary with all stats
 * @returns {string[]} — newly unlocked achievement IDs
 */
export function checkAchievements(runData) {
  const newlyUnlocked = [];

  function unlock(id) {
    if (!unlocked[id]) {
      unlocked[id] = { time: Date.now() };
      newlyUnlocked.push(id);
    }
  }

  totalRuns++;

  // Track kills by type
  if (runData.killsByType) {
    for (const [type, count] of Object.entries(runData.killsByType)) {
      totalKillsByType[type] = (totalKillsByType[type] || 0) + count;
    }
  }

  // Track unique builds
  const buildKey = (runData.upgrades || []).map(u => u.upgradeId || u).sort().join(',');
  if (buildKey) uniqueBuilds.add(buildKey);

  // ── Combat checks ──
  if (runData.totalKills >= 1) unlock('first_blood');
  if (runData.totalKills >= 100) unlock('century');
  if (runData.totalKills >= 1000) unlock('thousand_cuts');
  if (runData.bossKills >= 1) unlock('boss_slayer');
  if (runData.eliteKills >= 10) unlock('elite_hunter');
  if (runData.noHitWaves >= 5) unlock('untouchable');
  if (runData.completed && (runData.hpUpgrades || 0) <= 1) unlock('glass_cannon');
  if (runData.fastestBossKill && runData.fastestBossKill < 10) unlock('speed_demon');
  if (runData.maxCombo >= 50) unlock('combo_king');

  // ── Survival checks ──
  if (runData.wavesCleared >= 10) unlock('survivor');
  if (runData.wavesCleared >= 20) unlock('veteran');
  if (runData.completed) unlock('champion');
  if (runData.endHp === runData.maxHp) unlock('full_health');
  if (runData.completed && runData.runTime < 600) unlock('speed_runner');
  if (runData.runTime >= 900) unlock('marathon');
  if (runData.survivedWith1Hp) unlock('close_call');
  if (runData.hadPacifistWave) unlock('pacifist_wave');

  // ── Mastery checks ──
  if (runData.completed && runData.mode === 'adaptive') unlock('adaptive_clear');
  if (runData.completed && runData.mode === 'llm') unlock('llm_clear');
  if (runData.uniqueUpgradeCount >= 5) unlock('all_upgrades');
  if (runData.hasMaxStack) unlock('max_stack');
  if (runData.rank >= 5) unlock('rank5');
  if (runData.rank >= 10) unlock('rank10');
  if (runData.rank >= 15) unlock('rank15');
  if (runData.rank >= 20) unlock('rank20');

  // ── Fun checks ──
  if (totalRuns >= 10) unlock('ten_runs');
  if (totalRuns >= 50) unlock('fifty_runs');
  if (totalRuns >= 100) unlock('hundred_runs');
  if (runData.score >= 10000) unlock('score_10k');
  if (runData.score >= 50000) unlock('score_50k');
  if (runData.allEnemyTypes) unlock('all_enemy_types');
  if ((totalKillsByType['drifter'] || 0) >= 1000) unlock('drifter_1000');
  if ((totalKillsByType['dasher'] || 0) >= 500) unlock('dasher_500');
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 4) unlock('night_owl');
  if (uniqueBuilds.size >= 10) unlock('diverse_builds');

  _save();
  return newlyUnlocked;
}

/**
 * Get all achievements with unlock status.
 */
export function getAchievements() {
  return ACHIEVEMENTS.map(a => ({
    ...a,
    unlocked: !!unlocked[a.id],
    unlockedAt: unlocked[a.id]?.time || null,
  }));
}

/**
 * Get achievement count.
 */
export function getAchievementProgress() {
  const total = ACHIEVEMENTS.length;
  const done = Object.keys(unlocked).length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

/**
 * Get a specific achievement definition.
 */
export function getAchievement(id) {
  const a = ACHIEVEMENTS.find(a => a.id === id);
  if (!a) return null;
  return { ...a, unlocked: !!unlocked[a.id] };
}

export { ACHIEVEMENTS };
export default { loadAchievements, checkAchievements, getAchievements, getAchievementProgress };
