/**
 * @module crt-filter
 * CRT post-processing shader overlay (#40).
 * Draws scanlines, vignette, and subtle color aberration on a top canvas.
 */

let canvas = null;
let ctx = null;
let enabled = true;
let width = 0;
let height = 0;

const SETTINGS_KEY = 'surge_crt_enabled';

export function initCRT(gameCanvas) {
  // Create overlay canvas
  canvas = document.createElement('canvas');
  canvas.id = 'crt-overlay';
  canvas.style.cssText = `
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 5;
    mix-blend-mode: multiply;
  `;
  gameCanvas.parentElement.insertBefore(canvas, gameCanvas.nextSibling);
  ctx = canvas.getContext('2d');

  // Load preference
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved !== null) enabled = saved === 'true';
  } catch {}

  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!canvas) return;
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
}

export function setCRTEnabled(val) {
  enabled = !!val;
  try { localStorage.setItem(SETTINGS_KEY, String(enabled)); } catch {}
  if (!enabled && canvas) {
    canvas.style.display = 'none';
  } else if (canvas) {
    canvas.style.display = 'block';
  }
}

export function isCRTEnabled() {
  return enabled;
}

export function renderCRT() {
  if (!enabled || !ctx || !canvas) return;
  if (canvas.style.display === 'none') canvas.style.display = 'block';

  ctx.clearRect(0, 0, width, height);

  // ─── Scanlines ─────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
  for (let y = 0; y < height; y += 3) {
    ctx.fillRect(0, y, width, 1);
  }

  // ─── Vignette ──────────────────────────────────────────────
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, height * 0.3,
    width / 2, height / 2, height * 0.8
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // ─── Subtle flicker (every ~2s) ───────────────────────────
  if (Math.random() < 0.004) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillRect(0, 0, width, height);
  }
}

export default { initCRT, setCRTEnabled, isCRTEnabled, renderCRT };
