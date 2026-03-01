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
const $goStats       = document.getElementById('go-stats');
const $vicStats      = document.getElementById('vic-stats');
const $upgradeChoices = document.getElementById('upgrade-choices');

// ─── UI Screen Management ────────────────────────────────────

function showScreen(id) {
  [$menuScreen, $gameoverScreen, $victoryScreen, $pauseScreen, $upgradeScreen]
    .forEach(el => el.classList.remove('active'));
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

  const waveReached = getDirectorState().wave;
  const statsHtml = `
    Wave: ${waveReached}<br>
    Score: ${score}<br>
    Kills: ${killCount}<br>
    Time: ${Math.floor(runTime)}s<br>
    Level: ${level}
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
});

bus.on('wave:clear', (wave) => {
  showFlash('WAVE CLEAR!', 1.0);
  addScore(wave * SCORE.PER_WAVE);
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

  // Particles at death location
  if (data && data.x !== undefined) {
    const colors = data.isBoss
      ? [getColor(9), getColor(12), getColor(15)]
      : [getColor(6), getColor(9), getColor(15)];
    spawnDeathBurst(data.x, data.y, colors, data.isBoss ? 24 : 12);
  }
});

bus.on('hit:enemy', (data) => {
  if (data) {
    spawnHitSpark(data.x, data.y, getColor(9));
  }
});

bus.on('hit:player', (data) => {
  triggerShake(4);
  triggerFlash(getColor(6));
  if (data) {
    spawnExplosion(data.x, data.y, getColor(6), 8);
  }
});

bus.on('player:levelup', (lv) => {
  showFlash(`LEVEL ${lv}!`, 1.5);
  triggerFlash(getColor(12));
});

// ─── Button Handlers ─────────────────────────────────────────

document.getElementById('btn-play').addEventListener('click', startRun);
document.getElementById('btn-retry').addEventListener('click', startRun);
document.getElementById('btn-menu').addEventListener('click', () => {
  showScreen('menu-screen');
  currentState = GAME_STATE.MENU;
});
document.getElementById('btn-resume').addEventListener('click', () => {
  showScreen(null);
  currentState = GAME_STATE.PLAYING;
  engine.resume();
});
document.getElementById('btn-quit').addEventListener('click', () => {
  showScreen('menu-screen');
  currentState = GAME_STATE.MENU;
  shutdownDirector();
  engine.pause();
});
document.getElementById('btn-vic-retry').addEventListener('click', startRun);
document.getElementById('btn-vic-menu').addEventListener('click', () => {
  showScreen('menu-screen');
  currentState = GAME_STATE.MENU;
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
  showScreen('menu-screen');
  console.log('%c⚡ SURGE v0.3.0 — Phase 3 AI', 'color: #aaff44; font-weight: bold; font-size: 14px;');
}

init();
