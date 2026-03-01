/**
 * SURGE — Balance Configuration
 * Single source of truth for all tuning constants.
 * Inspired by League of Legends' Swarm mode tuning philosophy:
 * every number here is a lever that shapes the player experience.
 * 
 * @module config/balance
 */

/** Logical resolution — all game math operates in this space */
export const SCREEN = Object.freeze({
  WIDTH:  240,
  HEIGHT: 400,
  ASPECT: 240 / 400,
});

/** Arena boundaries (inset from screen edges) */
export const ARENA = Object.freeze({
  PADDING:    8,
  LEFT:       8,
  TOP:        24,   // leave room for HUD
  RIGHT:      232,
  BOTTOM:     392,
  WIDTH:      224,
  HEIGHT:     368,
  CENTER_X:   120,
  CENTER_Y:   208,
});

/** Player tuning — the craft you pilot */
export const PLAYER = Object.freeze({
  RADIUS:         6,
  SPEED:          80,     // pixels per second
  MAX_HP:         5,
  INVULN_TIME:    1.0,    // seconds of invulnerability after hit
  FIRE_RATE:      0.25,   // seconds between shots
  BULLET_SPEED:   200,
  BULLET_DAMAGE:  1,
  BULLET_RADIUS:  2,
  BULLET_RANGE:   300,    // max travel distance in pixels
  DASH_SPEED:     300,
  DASH_DURATION:  0.15,   // seconds
  DASH_COOLDOWN:  2.0,    // seconds
  PICKUP_RADIUS:  20,     // XP magnet base radius
});

/** Enemy base stats — each type multiplies from here */
export const ENEMIES = Object.freeze({
  // Drifter — lazy homing swarm
  DRIFTER: {
    hp: 1, speed: 30, radius: 5, damage: 1,
    score: 10, xp: 1, color: 0,
  },
  // Dasher — telegraph → charge
  DASHER: {
    hp: 2, speed: 20, radius: 5, damage: 1,
    chargeSpeed: 180, telegraphTime: 0.6, chargeTime: 0.3,
    score: 25, xp: 2, color: 1,
  },
  // Sprayer — stationary turret, fan of bullets
  SPRAYER: {
    hp: 3, speed: 0, radius: 7, damage: 1,
    fireRate: 1.5, bulletSpeed: 80, bulletCount: 5, spreadAngle: Math.PI / 3,
    score: 30, xp: 3, color: 2,
  },
  // Orbitor — circles player, fires inward
  ORBITOR: {
    hp: 2, speed: 40, radius: 5, damage: 1,
    orbitRadius: 60, orbitSpeed: 1.5, fireRate: 2.0, bulletSpeed: 60,
    score: 35, xp: 3, color: 3,
  },
  // Splitter — splits on death
  SPLITTER: {
    hp: 3, speed: 35, radius: 7, damage: 1,
    splitCount: 3, splitRadius: 4, splitHP: 1, splitSpeed: 50,
    score: 40, xp: 4, color: 4,
  },
  // Shielder — projects aura on allies
  SHIELDER: {
    hp: 4, speed: 25, radius: 6, damage: 1,
    shieldRadius: 30, shieldDamageReduction: 0.5,
    score: 45, xp: 4, color: 5,
  },
  // Elite modifier
  ELITE: {
    hpMultiplier: 3, sizeMultiplier: 1.5, speedMultiplier: 0.9,
    scoreMultiplier: 3, xpMultiplier: 3,
  },
  // Boss base
  BOSS: {
    hpMultiplier: 20, sizeMultiplier: 2.5, speedMultiplier: 0.6,
    scoreMultiplier: 10, xpMultiplier: 10,
    phaseThresholds: [0.75, 0.5, 0.25],
  },
});

/** Director tuning */
export const DIRECTOR = Object.freeze({
  // Stress model weights (must sum to 1.0)
  STRESS_WEIGHTS: {
    hpTrend:         0.25,
    dodgeProximity:  0.20,
    screenDensity:   0.20,
    killSpeed:       0.15,
    abilityCooldown: 0.10,
    upgradePower:    0.10,
  },
  // Stress curve target per wave (interpolated)
  STRESS_CURVE: [
    { wave: 1,  target: 15 },
    { wave: 5,  target: 35 },
    { wave: 10, target: 55 },
    { wave: 15, target: 65 },
    { wave: 20, target: 75 },
    { wave: 25, target: 85 },
    { wave: 30, target: 95 },
  ],
  // Adaptive mode
  STRESS_TOLERANCE:      15,    // ±15 from target before adjustment
  EXPLOIT_CAP:           0.40,  // max 40% of wave can exploit weakness
  MID_WAVE_SLOW_FACTOR:  0.80,  // slow spawn rate 20% if stress spikes
  BANDIT_LEARN_RATE:     0.1,   // softmax bandit learning rate
  // LLM mode
  LLM_QUERY_INTERVAL:    3,     // query every N waves
  LLM_TIMEOUT_MS:        3000,
  LLM_MAX_INPUT_TOKENS:  250,
  LLM_MAX_OUTPUT_TOKENS: 150,
  LLM_RATE_LIMIT_MS:     20000, // min 20s between calls
  // Wave pacing
  WAVES_PER_UPGRADE:     3,
  BOSS_WAVE_INTERVAL:    10,
  SPAWN_DELAY_BASE:      0.5,  // seconds between spawns within a wave
  WAVE_CLEAR_PAUSE:      1.5,  // seconds between waves
  MAX_WAVE:              30,
});

/** Upgrade tuning */
export const UPGRADES = Object.freeze({
  MAX_STACK:         3,
  CHOICES_PER_PICK:  3,
  // Per-upgrade values
  SPREAD_SHOT:       { projectilesPerStack: 1, spreadAngle: Math.PI / 12 },
  PIERCE:            { extraPiercePerStack: 1 },
  FIRE_RATE:         { multiplierPerStack: 0.80 },  // 20% faster each
  DAMAGE:            { multiplierPerStack: 1.25 },   // 25% more each
  HOMING:            { trackingStrength: 0.03 },
  RICOCHET:          { bouncesPerStack: 1 },
  SHIELD:            { rechargeTime: 10 },
  DASH_CD:           { multiplierPerStack: 0.70 },
  SLOW_AURA:         { radius: 40, slowFactor: 0.80 },
  REGEN:             { intervalPerStack: 20 },       // seconds
  ARMOR:             { reductionPerStack: 1 },
  MAGNET:            { radiusPerStack: 20 },
  NUKE:              { cooldownWaves: 5, damage: 999 },
  DECOY:             { duration: 5, cooldown: 15 },
  SCANNER:           { flashDuration: 1.5 },
});

/** Visual tuning */
export const VISUAL = Object.freeze({
  SCREEN_SHAKE_INTENSITY:  3,
  SCREEN_SHAKE_DECAY:      0.9,
  PARTICLE_POOL_SIZE:      300,
  FLASH_DURATION:          0.08,
  SLOWMO_FACTOR:           0.3,
  SLOWMO_DURATION:         0.5,
  TRAIL_LENGTH:            8,
  HUD_HEIGHT:              24,
  FONT_SIZE:               8,
});

/** Timing & pacing */
export const TIMING = Object.freeze({
  FIXED_DT:        1 / 60,    // 60Hz physics
  MAX_FRAME_TIME:  0.25,      // clamp to prevent spiral of death
  FPS_SMOOTH:      0.9,       // FPS counter smoothing
});

/** Score multipliers */
export const SCORE = Object.freeze({
  PER_KILL:          10,
  PER_WAVE:          100,
  BOSS_KILL:         500,
  ELITE_KILL:        100,
  NO_HIT_WAVE:       200,
  PERFECT_WAVE:      500,  // no damage + fast clear
});
