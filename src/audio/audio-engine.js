/**
 * @module audio-engine
 * Procedural Web Audio API sound system (#43).
 * Zero external assets — all SFX generated via oscillators + noise.
 */

let ctx = null;
let masterGain = null;
let sfxGain = null;
let musicGain = null;
let initialized = false;

const SETTINGS_KEY = 'surge_audio_settings';
let settings = { master: 0.7, sfx: 0.8, music: 0.5 };

// ─── Init ────────────────────────────────────────────────────

export function initAudio() {
  if (initialized) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain = ctx.createGain();

    sfxGain.connect(masterGain);
    musicGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    loadAudioSettings();
    applyVolumes();
    initialized = true;
  } catch (e) {
    console.warn('Web Audio not available:', e);
  }
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

// ─── Volume Controls ─────────────────────────────────────────

export function setMasterVolume(v) {
  settings.master = Math.max(0, Math.min(1, v));
  applyVolumes();
  saveAudioSettings();
}

export function setSfxVolume(v) {
  settings.sfx = Math.max(0, Math.min(1, v));
  applyVolumes();
  saveAudioSettings();
}

export function setMusicVolume(v) {
  settings.music = Math.max(0, Math.min(1, v));
  applyVolumes();
  saveAudioSettings();
}

export function getAudioSettings() {
  return { ...settings };
}

function applyVolumes() {
  if (!masterGain) return;
  const t = ctx.currentTime + 0.02;
  masterGain.gain.linearRampToValueAtTime(settings.master, t);
  sfxGain.gain.linearRampToValueAtTime(settings.sfx, t);
  musicGain.gain.linearRampToValueAtTime(settings.music, t);
}

function saveAudioSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

function loadAudioSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s) Object.assign(settings, s);
  } catch {}
}

// ─── SFX: Procedural sounds ─────────────────────────────────

function playTone(freq, duration, type = 'square', volume = 0.3) {
  if (!ctx || !initialized) return;
  resumeAudio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playNoise(duration, volume = 0.15) {
  if (!ctx || !initialized) return;
  resumeAudio();
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  source.connect(gain);
  gain.connect(sfxGain);
  source.start();
}

// ─── Named SFX ───────────────────────────────────────────────

export function sfxShoot() {
  playTone(880, 0.06, 'square', 0.15);
  playTone(440, 0.08, 'sawtooth', 0.08);
}

export function sfxHitEnemy() {
  playTone(220, 0.05, 'square', 0.2);
  playNoise(0.03, 0.1);
}

export function sfxHitPlayer() {
  playTone(110, 0.15, 'sawtooth', 0.3);
  playNoise(0.1, 0.2);
}

export function sfxEnemyDeath() {
  playTone(330, 0.08, 'square', 0.2);
  playTone(165, 0.12, 'sawtooth', 0.15);
  playNoise(0.06, 0.1);
}

export function sfxLevelUp() {
  playTone(523, 0.1, 'sine', 0.25);
  setTimeout(() => playTone(659, 0.1, 'sine', 0.25), 80);
  setTimeout(() => playTone(784, 0.15, 'sine', 0.3), 160);
}

export function sfxWaveStart() {
  playTone(440, 0.15, 'triangle', 0.2);
  setTimeout(() => playTone(660, 0.2, 'triangle', 0.25), 100);
}

export function sfxWaveClear() {
  playTone(660, 0.1, 'sine', 0.2);
  setTimeout(() => playTone(880, 0.15, 'sine', 0.25), 80);
  setTimeout(() => playTone(1100, 0.2, 'sine', 0.3), 160);
}

export function sfxDash() {
  playTone(600, 0.05, 'sawtooth', 0.15);
  playNoise(0.04, 0.08);
}

export function sfxUpgrade() {
  playTone(440, 0.08, 'sine', 0.2);
  setTimeout(() => playTone(550, 0.08, 'sine', 0.2), 60);
  setTimeout(() => playTone(660, 0.12, 'sine', 0.25), 120);
}

export function sfxGameOver() {
  playTone(220, 0.3, 'sawtooth', 0.3);
  setTimeout(() => playTone(165, 0.4, 'sawtooth', 0.25), 200);
  setTimeout(() => playTone(110, 0.5, 'sawtooth', 0.2), 400);
}

export function sfxVictory() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => {
    setTimeout(() => playTone(n, 0.2, 'sine', 0.25), i * 120);
  });
}

export function sfxClick() {
  playTone(1000, 0.03, 'square', 0.1);
}

// ─── Simple Music Loop (procedural ambient drone) ────────────

let musicOsc1 = null;
let musicOsc2 = null;
let musicPlaying = false;

export function startMusic() {
  if (!ctx || !initialized || musicPlaying) return;
  resumeAudio();

  musicOsc1 = ctx.createOscillator();
  musicOsc1.type = 'sine';
  musicOsc1.frequency.setValueAtTime(55, ctx.currentTime);  // Low A drone
  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(0.08, ctx.currentTime);
  musicOsc1.connect(g1);
  g1.connect(musicGain);
  musicOsc1.start();

  musicOsc2 = ctx.createOscillator();
  musicOsc2.type = 'triangle';
  musicOsc2.frequency.setValueAtTime(82.4, ctx.currentTime); // Low E
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.04, ctx.currentTime);
  musicOsc2.connect(g2);
  g2.connect(musicGain);
  musicOsc2.start();

  musicPlaying = true;
}

export function stopMusic() {
  if (!musicPlaying) return;
  try {
    if (musicOsc1) { musicOsc1.stop(); musicOsc1 = null; }
    if (musicOsc2) { musicOsc2.stop(); musicOsc2 = null; }
  } catch {}
  musicPlaying = false;
}

export default {
  initAudio, resumeAudio,
  setMasterVolume, setSfxVolume, setMusicVolume, getAudioSettings,
  sfxShoot, sfxHitEnemy, sfxHitPlayer, sfxEnemyDeath, sfxLevelUp,
  sfxWaveStart, sfxWaveClear, sfxDash, sfxUpgrade, sfxGameOver, sfxVictory, sfxClick,
  startMusic, stopMusic,
};
