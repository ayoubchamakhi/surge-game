/**
 * @module main
 * SURGE entry point — game state machine + system wiring.
 *
 * States: MENU → PLAYING → (UPGRADE → PLAYING) → GAMEOVER | VICTORY
 * Each state owns its own update/render cycle.
 */

// ─── Core systems ────────────────────────────────────────────
import engine, { STATE } from './src/core/engine.js';
import world from './src/core/ecs.js';
import bus from './src/core/events.js';
import { initInput, pollInput, destroyInput } from './src/core/input.js';
import { initRenderer, beginFrame, endFrame, drawArena, triggerShake, triggerFlash, resizeCanvas } from './src/ui/renderer.js';

// ─── Game systems ────────────────────────────────────────────
import { createPlayer, destroyPlayer, getPlayerId, getPlayerPos, getPlayerData, updatePlayer, renderPlayer, damagePlayer, healPlayer } from './src/game/player.js';
import { updateBullets, renderBullets } from './src/game/projectiles.js';
import { spawnEnemy, getEnemyCount, renderEnemies } from './src/game/enemies.js';
import { updateEnemyBrains } from './src/agents/enemy-brain.js';
import { updateCollisions } from './src/game/collision.js';
import { updateParticles, renderParticles, clearParticles, spawnHitSpark, spawnDeathBurst, spawnExplosion } from './src/game/particles.js';

// ─── Director ────────────────────────────────────────────────
import { initDirector, startNextWave, updateDirector, onUpgradePicked, shutdownDirector, getDirectorState } from './src/agents/director.js';

// ─── Stress Model ────────────────────────────────────────────
import { initStressModel, updateStressModel, shutdownStressModel, resetStressModel } from './src/agents/stress-model.js';

// ─── Telemetry ───────────────────────────────────────────────
import { initTelemetry, recordFrame, shutdownTelemetry, getRunSummary } from './src/agents/telemetry.js';

// ─── Coach Report ────────────────────────────────────────────
import { generateCoachReport } from './src/agents/coach.js';
import { showReportScreen } from './src/ui/report-screen.js';

// ─── UI ──────────────────────────────────────────────────────
import { updateHud, renderHud, setHudHealth, setHudScore, setHudWave, setHudXp, setHudUpgrades, setHudDash, setHudEnemyCount, setHudLevel, incrementCombo, showFlash, resetHud } from './src/ui/hud.js';
import { detectTouch, updateTouchControls, renderTouchControls } from './src/ui/touch-controls.js';

// ─── Upgrades ────────────────────────────────────────────────
import { UPGRADE_DEFS, resetUpgrades, rollUpgradeChoices, applyUpgrade as applyUpgradeToPlayer, getStack, getUpgradeDef, getAllStacks } from './src/game/upgrades.js';

// ─── Config ──────────────────────────────────────────────────
import { SCREEN, PLAYER, TIMING, SCORE, UPGRADES } from './src/config/balance.js';
import { getColor, setPalette } from './src/config/palettes.js';

// ─── Phase 4: LLM Director ──────────────────────────────────
import { getLLMAdapter, resetLLMAdapter } from './src/agents/llm-adapter.js';
import { getLLMTip } from './src/agents/director.js';

// ─── Phase 5: Gamification ───────────────────────────────────
import { loadPilotRank, addRunXp, getPilotRank } from './src/game/pilot-rank.js';
import { loadAchievements, checkAchievements, getAchievements, ACHIEVEMENTS } from './src/game/achievements.js';
import { loadDailyChallenges, getDailyChallenges, checkDailyChallenges, getDailyStreak } from './src/game/daily-challenges.js';
import { loadLeaderboard, addLeaderboardEntry, getLeaderboard } from './src/game/leaderboard.js';
import { loadMastery, recordMastery } from './src/game/mastery.js';

// ─── Phase 6: Cosmetics ─────────────────────────────────────
import { loadCosmetics, addCoins, getCoins } from './src/game/cosmetics.js';
import { loadBattlePass, addBattlePassXp, getBattlePassState } from './src/game/battle-pass.js';
import { initStoreScreen, showStoreScreen, hideStoreScreen } from './src/ui/store-screen.js';

// ─── Phase 7: Analytics ──────────────────────────────────────
import { initAnalytics, trackRunEnd, trackWaveComplete, shutdownAnalytics } from './src/agents/analytics.js';

// ─── Phase 8: Polish ─────────────────────────────────────────
import { initAudio, resumeAudio, sfxShoot, sfxHitEnemy, sfxHitPlayer, sfxEnemyDeath, sfxLevelUp, sfxWaveStart, sfxWaveClear, sfxDash, sfxUpgrade, sfxGameOver, sfxVictory, sfxClick, startMusic, stopMusic, setMasterVolume, setSfxVolume, setMusicVolume, getAudioSettings } from './src/audio/audio-engine.js';
import { initCRT, renderCRT, setCRTEnabled, isCRTEnabled } from './src/ui/crt-filter.js';
import { startTutorial, shouldShowTutorial } from './src/ui/tutorial.js';
import { recordFrameTime } from './src/core/object-pool.js';

// ─── Game State ──────────────────────────────────────────────

/** @enum {string} */
const GAME_STATE = {
  MENU:     'menu',
  PLAYING:  'playing',
  PAUSED:   'paused',
  UPGRADE:  'upgrade',
  GAMEOVER: 'gameover',
  VICTORY:  'victory',
};

let currentState = GAME_STATE.MENU;
let score = 0;
let killCount = 0;
let runTime = 0;

// ─── DOM Elements ────────────────────────────────────────────

const $menuScreen    = document.getElementById('menu-screen');
const $gameoverScreen = document.getElementById('gameover-screen');
const $victoryScreen = document.getElementById('victory-screen');
const $pauseScreen   = document.getElementById('pause-screen');
const $upgradeScreen = document.getElementById('upgrade-screen');
const $settingsScreen = document.getElementById('settings-screen');
const $achievementsScreen = document.getElementById('achievements-screen');
const $leaderboardScreen = document.getElementById('leaderboard-screen');
const $dailyScreen   = document.getElementById('daily-screen');
const $storeScreen   = document.getElementById('store-screen');
const $goStats       = document.getElementById('go-stats');
const $vicStats      = document.getElementById('vic-stats');
const $upgradeChoices = document.getElementById('upgrade-choices');

// ─── UI Screen Management ────────────────────────────────────

function showScreen(id) {
  [$menuScreen, $gameoverScreen, $victoryScreen, $pauseScreen, $upgradeScreen,
   $settingsScreen, $achievementsScreen, $leaderboardScreen, $dailyScreen, $storeScreen]
    .forEach(el => { if (el) el.classList.remove('active'); });
  if (id) document.getElementById(id)?.classList.add('active');
}

// ─── Upgrade system now imported from src/game/upgrades.js ──

// ─── Upgrade UI ──────────────────────────────────────────────

function showUpgradeUI(choices) {
  $upgradeChoices.innerHTML = '';
  for (const upg of choices) {
    const stack = getStack(upg.id);
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    const categoryIcon = upg.category === 'weapon' ? '⚔' : upg.category === 'defense' ? '🛡' : '⚙';
    card.innerHTML = `
      <div class="category">${categoryIcon} ${upg.category}</div>
      <div class="name">${upg.name}</div>
      <div class="desc">${upg.desc}</div>
      <div class="level">Lv ${stack} → ${stack + 1}</div>
    `;
    card.addEventListener('click', () => {
      pickUpgrade(upg.id);
    });
    card.addEventListener('touchend', (e) => {
      e.preventDefault();
      pickUpgrade(upg.id);
    });
    $upgradeChoices.appendChild(card);
  }
  showScreen('upgrade-screen');
  currentState = GAME_STATE.UPGRADE;
}

function pickUpgrade(upgradeId) {
  const data = getPlayerData();
  if (data) {
    applyUpgradeToPlayer(upgradeId, data);
  }
  bus.emit('upgrade:picked', { id: upgradeId, wave: getDirectorState().wave });
  showScreen(null);
  currentState = GAME_STATE.PLAYING;
  onUpgradePicked();
}

// ─── Score & XP ──────────────────────────────────────────────

let xp = 0;
let level = 1;
let xpToNext = 100;

function addScore(amount) {
  score += amount;
  setHudScore(score);
}

function addXp(amount) {
  xp += amount;
  if (xp >= xpToNext) {
    xp -= xpToNext;
    level++;
    xpToNext = Math.floor(xpToNext * 1.4);
    bus.emit('player:levelup', level);
  }
  setHudXp(xp, xpToNext);
}

// ─── Regen Timer ─────────────────────────────────────────────

let regenTimer = 0;

// ─── Game Lifecycle ──────────────────────────────────────────

function startRun() {
  // Clean slate
  world.reset();
  clearParticles();
  resetHud();
  resetUpgrades();

  score = 0;
  killCount = 0;
  runTime = 0;
  xp = 0;
  level = 1;
  xpToNext = 100;
  regenTimer = 0;

  // Create player at center
  createPlayer();

  // Init AI systems
  initStressModel();
  initTelemetry();
  const mode = document.getElementById('sel-mode')?.value || 'classic';
  initDirector({ mode });

  // Start the first wave
  startNextWave();

  // Start audio
  resumeAudio();
  startMusic();

  // Switch state
  showScreen(null);
  currentState = GAME_STATE.PLAYING;

  // Start engine
  engine.start();
}

function endRun(reason) {
  currentState = reason === 'victory' ? GAME_STATE.VICTORY : GAME_STATE.GAMEOVER;

  // Capture run summary before shutdown
  const runSummary = getRunSummary();
  shutdownTelemetry();
  shutdownStressModel();
  shutdownDirector();
  engine.pause();
  stopMusic();

  const waveReached = getDirectorState().wave;
  const mode = document.getElementById('sel-mode')?.value || 'classic';

  // Build run data for gamification systems
  const runData = {
    wave: waveReached,
    score,
    kills: killCount,
    time: Math.floor(runTime),
    level,
    mode,
    victory: reason === 'victory',
    upgrades: getAllStacks(),
    killsByType: runSummary?.killsByType || {},
    noHitWaves: runSummary?.noHitWaves || 0,
    eliteKills: runSummary?.eliteKills || 0,
    bossKills: runSummary?.bossKills || 0,
    maxCombo: runSummary?.maxCombo || 0,
    avgStress: runSummary?.avgStress || 0.5,
  };

  // Phase 5: Gamification
  const rankResult = addRunXp(runData);
  const newAchievements = checkAchievements(runData);
  const dailyResults = checkDailyChallenges(runData);
  addLeaderboardEntry(runData);
  recordMastery(runData);

  // Phase 6: Cosmetics — award coins based on performance
  const coinReward = Math.floor(waveReached * 3 + killCount * 0.5 + (reason === 'victory' ? 100 : 0));
  addCoins(coinReward);
  addBattlePassXp(Math.floor(waveReached * 10 + killCount));

  // Phase 7: Analytics
  trackRunEnd(runData);

  // Audio
  if (reason === 'victory') sfxVictory(); else sfxGameOver();

  const statsHtml = `
    Wave: ${waveReached}<br>
    Score: ${score}<br>
    Kills: ${killCount}<br>
    Time: ${Math.floor(runTime)}s<br>
    Level: ${level}<br>
    Coins: +${coinReward} 💰
    ${newAchievements.length > 0 ? `<br>🏆 ${newAchievements.length} new achievement${newAchievements.length > 1 ? 's' : ''}!` : ''}
    ${rankResult?.leveledUp ? `<br>⬆ Rank Up: ${rankResult.title}!` : ''}
  `;

  // Generate Coach Report
  const coachReport = generateCoachReport(runSummary);

  // Show coach report first, then show game over / victory screen
  showReportScreen(coachReport, () => {
    if (reason === 'victory') {
      $vicStats.innerHTML = statsHtml;
      showScreen('victory-screen');
    } else {
      $goStats.innerHTML = statsHtml;
      showScreen('gameover-screen');
    }
  });
}

// ─── Engine Callbacks ────────────────────────────────────────

engine.onUpdate = (dt) => {
  if (currentState !== GAME_STATE.PLAYING) return;

  runTime += dt;
  recordFrameTime(dt);

  // Poll input
  const input = pollInput();

  // Handle pause
  if (input.pause) {
    currentState = GAME_STATE.PAUSED;
    engine.pause();
    showScreen('pause-screen');
    return;
  }

  // Update touch controls overlay
  const playerData = getPlayerData();
  updateTouchControls(input, playerData);

  // Mouse-driven movement: when mouse is held, compute direction from player to cursor
  let mx = input.moveX;
  let my = input.moveY;
  if (input.mouseHeld && (mx === 0 && my === 0)) {
    const pPos = getPlayerPos();
    if (pPos) {
      const dx = input.mouseLogical.x - pPos.x;
      const dy = input.mouseLogical.y - pPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const deadZone = 6; // ignore if cursor is very close to player
      if (dist > deadZone) {
        const strength = Math.min(1, (dist - deadZone) / 40);
        mx = (dx / dist) * strength;
        my = (dy / dist) * strength;
      }
    }
  }

  // Update player
  updatePlayer(mx, my, input.action, dt);

  // Update enemy brains
  updateEnemyBrains(dt);

  // Update bullets
  updateBullets(dt);

  // Collision detection
  updateCollisions(dt);

  // Telemetry (record per-frame data)
  recordFrame(dt);

  // Stress model (reads game state, feeds director)
  updateStressModel(dt);

  // Director (wave management)
  updateDirector(dt);

  // Particles
  updateParticles(dt);

  // HUD updates
  updateHud(dt);

  // Update player health display + HUD data
  if (playerData) {
    setHudHealth(playerData.hp, playerData.maxHp);
    setHudDash(playerData.dashCooldownTimer > 0
      ? 1 - playerData.dashCooldownTimer / playerData.dashCooldown
      : 1);
    setHudUpgrades(getAllStacks());
    setHudLevel(level);
  }
  setHudEnemyCount(getEnemyCount());

  // Regen
  if (playerData && playerData.upgrades?.regen > 0) {
    regenTimer += dt;
    const interval = 8 / playerData.upgrades.regen;
    if (regenTimer >= interval) {
      regenTimer -= interval;
      healPlayer(1);
    }
  }

  // ECS maintenance — flush deferred destructions
  world._flushDestroyQueue();
};

engine.onRender = (alpha) => {
  const ctx = beginFrame();
  if (!ctx) return;

  // Draw arena background
  drawArena();

  // Render game objects
  renderEnemies(ctx);
  renderBullets(ctx);
  renderPlayer(ctx);
  renderParticles(ctx);

  // HUD on top
  renderHud(ctx);

  // Touch controls overlay (on top of HUD)
  renderTouchControls(ctx);

  // CRT post-processing
  renderCRT();

  endFrame();
};

// ─── Bus Event Wiring ────────────────────────────────────────

bus.on('player:death', () => {
  endRun('death');
});

bus.on('game:victory', () => {
  endRun('victory');
});

bus.on('wave:start', (wave) => {
  setHudWave(wave);
  showFlash(`WAVE ${wave}`, 1.2);
  sfxWaveStart();
  trackWaveComplete({ wave });
});

bus.on('wave:clear', (wave) => {
  showFlash('WAVE CLEAR!', 1.0);
  addScore(wave * SCORE.PER_WAVE);
  sfxWaveClear();
});

bus.on('upgrade:offered', () => {
  const choices = rollUpgradeChoices(UPGRADES.CHOICES_PER_PICK);
  if (choices.length === 0) {
    // No upgrades left — skip
    onUpgradePicked();
    return;
  }
  showUpgradeUI(choices);
});

bus.on('enemy:death', (id, data) => {
  killCount++;
  incrementCombo();
  addScore(data?.score || SCORE.PER_KILL);
  addXp(data?.xp || 10);
  sfxEnemyDeath();

  // Particles at death location
  if (data && data.x !== undefined) {
    const colors = data.isBoss
      ? [getColor(9), getColor(12), getColor(15)]
      : [getColor(6), getColor(9), getColor(15)];
    spawnDeathBurst(data.x, data.y, colors, data.isBoss ? 24 : 12);
  }
});

bus.on('hit:enemy', (data) => {
  sfxHitEnemy();
  if (data) {
    spawnHitSpark(data.x, data.y, getColor(9));
  }
});

bus.on('hit:player', (data) => {
  triggerShake(4);
  triggerFlash(getColor(6));
  sfxHitPlayer();
  if (data) {
    spawnExplosion(data.x, data.y, getColor(6), 8);
  }
});

bus.on('player:levelup', (lv) => {
  showFlash(`LEVEL ${lv}!`, 1.5);
  triggerFlash(getColor(12));
  sfxLevelUp();
});

// ─── Button Handlers ─────────────────────────────────────────

document.getElementById('btn-play').addEventListener('click', () => {
  sfxClick();
  resumeAudio();
  if (shouldShowTutorial()) {
    startTutorial(() => startRun());
  } else {
    startRun();
  }
});
document.getElementById('btn-retry').addEventListener('click', () => { sfxClick(); startRun(); });
document.getElementById('btn-menu').addEventListener('click', () => {
  sfxClick();
  showScreen('menu-screen');
  currentState = GAME_STATE.MENU;
});
document.getElementById('btn-resume').addEventListener('click', () => {
  sfxClick();
  showScreen(null);
  currentState = GAME_STATE.PLAYING;
  engine.resume();
});
document.getElementById('btn-quit').addEventListener('click', () => {
  sfxClick();
  showScreen('menu-screen');
  currentState = GAME_STATE.MENU;
  shutdownDirector();
  stopMusic();
  engine.pause();
});
document.getElementById('btn-vic-retry').addEventListener('click', () => { sfxClick(); startRun(); });
document.getElementById('btn-vic-menu').addEventListener('click', () => {
  sfxClick();
  showScreen('menu-screen');
  currentState = GAME_STATE.MENU;
});

// ─── Settings Screen ─────────────────────────────────────────

document.getElementById('btn-settings')?.addEventListener('click', () => {
  sfxClick();
  loadSettingsUI();
  showScreen('settings-screen');
});
document.getElementById('btn-settings-back')?.addEventListener('click', () => {
  sfxClick();
  saveSettings();
  showScreen('menu-screen');
});

// LLM test connection
document.getElementById('btn-test-llm')?.addEventListener('click', async () => {
  const $result = document.getElementById('llm-test-result');
  if ($result) $result.textContent = 'Testing...';
  try {
    const config = {
      endpoint: document.getElementById('set-endpoint')?.value || '',
      apiKey: document.getElementById('set-apikey')?.value || '',
      model: document.getElementById('set-model')?.value || 'gpt-4o-mini',
      maxTokens: parseInt(document.getElementById('set-tokens')?.value) || 4000,
    };
    if (!config.endpoint) {
      if ($result) $result.textContent = '✗ No endpoint configured';
      return;
    }
    resetLLMAdapter();
    const adapter = getLLMAdapter(config);
    const ok = await adapter.testConnection();
    if ($result) $result.textContent = ok ? '✓ Connection OK!' : '✗ Connection failed';
  } catch (e) {
    if ($result) $result.textContent = `✗ ${e.message}`;
  }
});

// Audio sliders
document.getElementById('set-master-vol')?.addEventListener('input', (e) => {
  setMasterVolume(e.target.value / 100);
});
document.getElementById('set-sfx-vol')?.addEventListener('input', (e) => {
  setSfxVolume(e.target.value / 100);
});
document.getElementById('set-music-vol')?.addEventListener('input', (e) => {
  setMusicVolume(e.target.value / 100);
});

// Visual toggles
document.getElementById('set-crt')?.addEventListener('change', (e) => {
  setCRTEnabled(e.target.checked);
});
document.getElementById('set-shake')?.addEventListener('change', (e) => {
  try { localStorage.setItem('surge_shake_enabled', e.target.checked); } catch {}
});

function loadSettingsUI() {
  const settings = loadSettings();
  const $ep = document.getElementById('set-endpoint');
  const $key = document.getElementById('set-apikey');
  const $model = document.getElementById('set-model');
  const $tokens = document.getElementById('set-tokens');
  const $premium = document.getElementById('set-premium');
  if ($ep) $ep.value = settings.llmEndpoint || '';
  if ($key) $key.value = settings.llmApiKey || '';
  if ($model) $model.value = settings.llmModel || 'gpt-4o-mini';
  if ($tokens) $tokens.value = settings.llmTokens || 4000;
  if ($premium) $premium.checked = settings.llmPremium || false;

  // Audio
  const audio = getAudioSettings();
  const $mv = document.getElementById('set-master-vol');
  const $sv = document.getElementById('set-sfx-vol');
  const $muv = document.getElementById('set-music-vol');
  if ($mv) $mv.value = Math.round(audio.master * 100);
  if ($sv) $sv.value = Math.round(audio.sfx * 100);
  if ($muv) $muv.value = Math.round(audio.music * 100);

  // Visual
  const $crt = document.getElementById('set-crt');
  const $shake = document.getElementById('set-shake');
  if ($crt) $crt.checked = isCRTEnabled();
  if ($shake) {
    try { $shake.checked = localStorage.getItem('surge_shake_enabled') !== 'false'; } catch { $shake.checked = true; }
  }
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('surge_settings') || '{}');
  } catch { return {}; }
}

function saveSettings() {
  const settings = {
    llmEndpoint: document.getElementById('set-endpoint')?.value || '',
    llmApiKey: document.getElementById('set-apikey')?.value || '',
    llmModel: document.getElementById('set-model')?.value || 'gpt-4o-mini',
    llmTokens: parseInt(document.getElementById('set-tokens')?.value) || 4000,
    llmPremium: document.getElementById('set-premium')?.checked || false,
  };
  try { localStorage.setItem('surge_settings', JSON.stringify(settings)); } catch {}
}

// ─── Achievements Screen ─────────────────────────────────────

document.getElementById('btn-achievements')?.addEventListener('click', () => {
  sfxClick();
  renderAchievementsUI();
  showScreen('achievements-screen');
});
document.getElementById('btn-ach-back')?.addEventListener('click', () => {
  sfxClick();
  showScreen('menu-screen');
});

function renderAchievementsUI() {
  const $list = document.getElementById('achievement-list');
  if (!$list) return;
  const achs = getAchievements();
  $list.innerHTML = ACHIEVEMENTS.map(def => {
    const unlocked = achs.unlocked.includes(def.id);
    return `
      <div class="ach-item ${unlocked ? 'ach-unlocked' : 'ach-locked'}">
        <div class="ach-icon">${unlocked ? '🏆' : '🔒'}</div>
        <div class="ach-info">
          <div class="ach-name">${def.name}</div>
          <div class="ach-desc">${def.desc}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Leaderboard Screen ──────────────────────────────────────

document.getElementById('btn-leaderboard')?.addEventListener('click', () => {
  sfxClick();
  renderLeaderboardUI('score');
  showScreen('leaderboard-screen');
});
document.getElementById('btn-lb-back')?.addEventListener('click', () => {
  sfxClick();
  showScreen('menu-screen');
});

// Leaderboard sort tabs
document.querySelectorAll('.lb-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderLeaderboardUI(tab.dataset.sort);
  });
});

function renderLeaderboardUI(sortBy = 'score') {
  const $list = document.getElementById('leaderboard-list');
  if (!$list) return;
  const entries = getLeaderboard({ sortBy, limit: 20 });
  if (entries.length === 0) {
    $list.innerHTML = '<div class="lb-empty">No runs yet — play to set a record!</div>';
    return;
  }
  $list.innerHTML = entries.map((e, i) => `
    <div class="lb-entry">
      <span class="lb-rank">${i + 1}.</span>
      <span class="lb-score">${e.score}</span>
      <span class="lb-detail">W${e.wave} · ${e.kills}K · ${e.time}s</span>
      <span class="lb-mode">${e.mode || 'classic'}</span>
    </div>
  `).join('');
}

// ─── Daily Challenges Screen ─────────────────────────────────

// Add daily challenges button to menu (wire if exists)
document.getElementById('btn-daily')?.addEventListener('click', () => {
  sfxClick();
  renderDailyUI();
  showScreen('daily-screen');
});
document.getElementById('btn-daily-back')?.addEventListener('click', () => {
  sfxClick();
  showScreen('menu-screen');
});

function renderDailyUI() {
  const $list = document.getElementById('daily-list');
  const $streak = document.getElementById('daily-streak');
  if (!$list) return;

  const challenges = getDailyChallenges();
  $list.innerHTML = challenges.map(c => `
    <div class="daily-item ${c.completed ? 'daily-done' : ''}">
      <div class="daily-diff daily-${c.difficulty}">${c.difficulty.toUpperCase()}</div>
      <div class="daily-info">
        <div class="daily-name">${c.name}</div>
        <div class="daily-desc">${c.desc}</div>
      </div>
      <div class="daily-status">${c.completed ? '✓' : '○'}</div>
    </div>
  `).join('');

  if ($streak) {
    const streak = getDailyStreak();
    $streak.textContent = `🔥 ${streak}-day streak`;
  }
}

// ─── Store Screen ────────────────────────────────────────────

document.getElementById('btn-store')?.addEventListener('click', () => {
  sfxClick();
  showStoreScreen();
  showScreen('store-screen');
});
document.getElementById('btn-store-back')?.addEventListener('click', () => {
  sfxClick();
  hideStoreScreen();
  showScreen('menu-screen');
});

// Palette selector
const $paletteSelect = document.getElementById('sel-palette');
$paletteSelect.addEventListener('change', () => {
  setPalette($paletteSelect.value);
});

// ─── Init ────────────────────────────────────────────────────

function init() {
  setPalette('moss');
  initRenderer(document.getElementById('game'));
  initInput(document.getElementById('game'));
  detectTouch();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Phase 4: Audio system
  initAudio();

  // Phase 5: Load gamification data from localStorage
  loadPilotRank();
  loadAchievements();
  loadDailyChallenges();
  loadLeaderboard();
  loadMastery();

  // Phase 6: Cosmetics & Store
  loadCosmetics();
  loadBattlePass();
  initStoreScreen();

  // Phase 7: Analytics
  initAnalytics();

  // Phase 8: CRT filter + PWA
  initCRT(document.getElementById('game'));
  registerServiceWorker();

  showScreen('menu-screen');
  console.log('%c⚡ SURGE v0.8.0 — Phase 8', 'color: #aaff44; font-weight: bold; font-size: 14px;');
}

// ─── PWA Service Worker ──────────────────────────────────────

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }
}

init();
