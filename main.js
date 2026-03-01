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

// ─── UI ──────────────────────────────────────────────────────
import { updateHud, renderHud, setHudHealth, setHudScore, setHudWave, setHudXp, incrementCombo, showFlash, resetHud } from './src/ui/hud.js';

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

// ─── Upgrade Definitions (Phase 1 pool) ──────────────────────

const UPGRADE_POOL = [
  {
    id: 'spread_shot',
    name: 'Spread Shot',
    desc: 'Fire additional projectiles in a fan pattern.',
    maxStack: UPGRADES.MAX_STACK,
    apply(data, stack) { data.upgrades.spreadShot = stack; },
  },
  {
    id: 'fire_rate',
    name: 'Rapid Fire',
    desc: 'Reduce firing interval by 20%.',
    maxStack: UPGRADES.MAX_STACK,
    apply(data, stack) { data.fireRate = PLAYER.FIRE_RATE * Math.pow(UPGRADES.FIRE_RATE.multiplierPerStack, stack); },
  },
  {
    id: 'damage',
    name: 'Heavy Rounds',
    desc: 'Increase bullet damage by 25%.',
    maxStack: UPGRADES.MAX_STACK,
    apply(data, stack) { data.bulletDamage = PLAYER.BULLET_DAMAGE * Math.pow(UPGRADES.DAMAGE.multiplierPerStack, stack); },
  },
  {
    id: 'pierce',
    name: 'Pierce',
    desc: 'Bullets pass through one extra enemy.',
    maxStack: UPGRADES.MAX_STACK,
    apply(data, stack) { data.upgrades.pierce = stack * UPGRADES.PIERCE.extraPiercePerStack; },
  },
  {
    id: 'speed',
    name: 'Swift Boots',
    desc: 'Move 15% faster.',
    maxStack: UPGRADES.MAX_STACK,
    apply(data, stack) { data.speed = PLAYER.SPEED * (1 + stack * 0.15); },
  },
  {
    id: 'armor',
    name: 'Plating',
    desc: 'Reduce incoming damage by 1.',
    maxStack: 2,
    apply(data, stack) { data.upgrades.armor = stack; },
  },
  {
    id: 'regen',
    name: 'Regeneration',
    desc: 'Recover 1 HP every 8 seconds.',
    maxStack: 2,
    apply(data, stack) { data.upgrades.regen = stack; },
  },
  {
    id: 'magnet',
    name: 'Magnet',
    desc: 'Increase XP pickup range.',
    maxStack: UPGRADES.MAX_STACK,
    apply(data, stack) { data.upgrades.magnet = stack; },
  },
];

/** Track current upgrade stacks per run */
let upgradeStacks = {};

function resetUpgradeStacks() {
  upgradeStacks = {};
  for (const upg of UPGRADE_POOL) {
    upgradeStacks[upg.id] = 0;
  }
}

/**
 * Pick N random upgrades that haven't maxed out.
 */
function pickUpgradeChoices(count) {
  const available = UPGRADE_POOL.filter(u => upgradeStacks[u.id] < u.maxStack);
  const shuffled = available.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ─── Upgrade UI ──────────────────────────────────────────────

function showUpgradeUI(choices) {
  $upgradeChoices.innerHTML = '';
  for (const upg of choices) {
    const stack = upgradeStacks[upg.id];
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `
      <div class="name">${upg.name}</div>
      <div class="desc">${upg.desc}</div>
      <div class="level">Lv ${stack} → ${stack + 1}</div>
    `;
    card.addEventListener('click', () => {
      applyUpgrade(upg);
    });
    card.addEventListener('touchend', (e) => {
      e.preventDefault();
      applyUpgrade(upg);
    });
    $upgradeChoices.appendChild(card);
  }
  showScreen('upgrade-screen');
  currentState = GAME_STATE.UPGRADE;
}

function applyUpgrade(upg) {
  upgradeStacks[upg.id]++;
  const data = getPlayerData();
  if (data) {
    upg.apply(data, upgradeStacks[upg.id]);
  }
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
  resetUpgradeStacks();

  score = 0;
  killCount = 0;
  runTime = 0;
  xp = 0;
  level = 1;
  xpToNext = 100;
  regenTimer = 0;

  // Create player at center
  createPlayer();

  // Init Director
  initDirector({ mode: 'classic' });

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

  if (reason === 'victory') {
    $vicStats.innerHTML = statsHtml;
    showScreen('victory-screen');
  } else {
    $goStats.innerHTML = statsHtml;
    showScreen('gameover-screen');
  }
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

  // Update player
  updatePlayer(input.moveX, input.moveY, input.action, dt);

  // Update enemy brains
  updateEnemyBrains(dt);

  // Update bullets
  updateBullets(dt);

  // Collision detection
  updateCollisions(dt);

  // Director (wave management)
  updateDirector(dt);

  // Particles
  updateParticles(dt);

  // HUD updates
  updateHud(dt);

  // Update player health display
  const playerData = getPlayerData();
  if (playerData) {
    setHudHealth(playerData.hp, playerData.maxHp);
  }

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
  const choices = pickUpgradeChoices(UPGRADES.CHOICES_PER_PICK);
  if (choices.length === 0) {
    // No upgrades left — skip
    onUpgradePicked();
    return;
  }
  showUpgradeUI(choices);
});

bus.on('enemy:death', (data) => {
  killCount++;
  incrementCombo();
  addScore(SCORE.PER_KILL);
  addXp(10);

  // Particles at death location
  if (data && data.x !== undefined) {
    spawnDeathBurst(data.x, data.y, [getColor(6), getColor(9), getColor(15)], 12);
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

// ─── Init ────────────────────────────────────────────────────

function init() {
  setPalette('moss');
  initRenderer(document.getElementById('game'));
  initInput(document.getElementById('game'));
  showScreen('menu-screen');
  console.log('%c⚡ SURGE v0.1.0 — Phase 1', 'color: #aaff44; font-weight: bold; font-size: 14px;');
}

init();
