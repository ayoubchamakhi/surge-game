/**
 * @module core/input
 * @description Unified touch + keyboard input for SURGE.
 *
 * Provides a normalized input state:
 *   - moveX, moveY: -1..1 analog stick values
 *   - action: boolean (dash / ability)
 *   - pause: boolean
 *
 * Phone: virtual joystick (left half) + tap right half for action
 * Desktop: WASD/arrows + space/click
 *
 * The input module does NOT render — touch controls visuals are in ui/touch-controls.js.
 */

import { SCREEN, ARENA } from '../config/balance.js';
import bus from './events.js';

/** Current frame's normalized input state */
const state = {
  /** @type {number} Horizontal input -1..1 */
  moveX: 0,
  /** @type {number} Vertical input -1..1 */
  moveY: 0,
  /** @type {boolean} Action button (dash) pressed this frame */
  action: false,
  /** @type {boolean} Pause requested this frame */
  pause: false,
  /** @type {boolean} Any touch currently active */
  touching: false,
  /** @type {{x: number, y: number}|null} Touch joystick origin */
  touchOrigin: null,
  /** @type {{x: number, y: number}} Current touch position */
  touchPos: { x: 0, y: 0 },
};

// ─── Internal State ──────────────────────────────────────────

const keys = new Set();
let canvas = null;
let scaleX = 1;
let scaleY = 1;
const JOYSTICK_DEAD_ZONE = 8;   // pixels in logical space
const JOYSTICK_MAX_RADIUS = 40; // max drag distance for full input

// ─── Initialization ──────────────────────────────────────────

/**
 * Initialize input system and bind event listeners.
 * @param {HTMLCanvasElement} canvasEl - The game canvas
 */
export function initInput(canvasEl) {
  canvas = canvasEl;
  _updateScale();

  // Keyboard
  window.addEventListener('keydown', _onKeyDown);
  window.addEventListener('keyup', _onKeyUp);

  // Touch
  canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', _onTouchMove, { passive: false });
  canvas.addEventListener('touchend', _onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', _onTouchEnd, { passive: false });

  // Mouse (desktop fallback)
  canvas.addEventListener('mousedown', _onMouseDown);
  canvas.addEventListener('mousemove', _onMouseMove);
  canvas.addEventListener('mouseup', _onMouseUp);

  // Resize
  window.addEventListener('resize', _updateScale);
}

/**
 * Tear down input listeners.
 */
export function destroyInput() {
  window.removeEventListener('keydown', _onKeyDown);
  window.removeEventListener('keyup', _onKeyUp);
  window.removeEventListener('resize', _updateScale);
  if (canvas) {
    canvas.removeEventListener('touchstart', _onTouchStart);
    canvas.removeEventListener('touchmove', _onTouchMove);
    canvas.removeEventListener('touchend', _onTouchEnd);
    canvas.removeEventListener('touchcancel', _onTouchEnd);
    canvas.removeEventListener('mousedown', _onMouseDown);
    canvas.removeEventListener('mousemove', _onMouseMove);
    canvas.removeEventListener('mouseup', _onMouseUp);
  }
}

/** Update canvas-to-logical scaling after resize */
function _updateScale() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  scaleX = SCREEN.WIDTH / rect.width;
  scaleY = SCREEN.HEIGHT / rect.height;
}

// ─── Per-Frame Polling ───────────────────────────────────────

/**
 * Poll input state. Call once per logic frame.
 * Merges keyboard + touch into the unified state object.
 * @returns {typeof state}
 */
export function pollInput() {
  // Reset one-shot inputs
  state.action = false;
  state.pause = false;

  // ── Keyboard contribution ──
  let kx = 0, ky = 0;
  if (keys.has('ArrowLeft')  || keys.has('KeyA')) kx -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) kx += 1;
  if (keys.has('ArrowUp')    || keys.has('KeyW')) ky -= 1;
  if (keys.has('ArrowDown')  || keys.has('KeyS')) ky += 1;

  // Normalize diagonal
  if (kx !== 0 && ky !== 0) {
    const inv = 1 / Math.SQRT2;
    kx *= inv;
    ky *= inv;
  }

  // ── Touch contribution ──
  let tx = 0, ty = 0;
  if (state.touching && state.touchOrigin) {
    const dx = state.touchPos.x - state.touchOrigin.x;
    const dy = state.touchPos.y - state.touchOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > JOYSTICK_DEAD_ZONE) {
      const clamped = Math.min(dist, JOYSTICK_MAX_RADIUS);
      const norm = (clamped - JOYSTICK_DEAD_ZONE) / (JOYSTICK_MAX_RADIUS - JOYSTICK_DEAD_ZONE);
      tx = (dx / dist) * norm;
      ty = (dy / dist) * norm;
    }
  }

  // Merge: keyboard overrides touch if nonzero
  state.moveX = kx !== 0 ? kx : tx;
  state.moveY = ky !== 0 ? ky : ty;

  // One-shot: space or action key
  if (_consumeKey('Space') || _consumeKey('KeyE')) {
    state.action = true;
    bus.emit('input:action');
  }
  if (_consumeKey('Escape') || _consumeKey('KeyP')) {
    state.pause = true;
    bus.emit('input:pause');
  }

  if (state.moveX !== 0 || state.moveY !== 0) {
    bus.emit('input:move', state.moveX, state.moveY);
  }

  return state;
}

/** Check and consume a key press (returns true once per press) */
function _consumeKey(code) {
  if (keys.has(code)) {
    keys.delete(code);
    return true;
  }
  return false;
}

// ─── Keyboard Handlers ──────────────────────────────────────

function _onKeyDown(e) {
  keys.add(e.code);
  // Prevent arrow key page scrolling
  if (e.code.startsWith('Arrow') || e.code === 'Space') {
    e.preventDefault();
  }
}

function _onKeyUp(e) {
  keys.delete(e.code);
}

// ─── Touch Handlers ─────────────────────────────────────────

function _toLogical(touch) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (touch.clientX - rect.left) * scaleX,
    y: (touch.clientY - rect.top) * scaleY,
  };
}

function _onTouchStart(e) {
  e.preventDefault();
  const t = e.changedTouches[0];
  const pos = _toLogical(t);

  // Right half of screen → action button
  if (pos.x > SCREEN.WIDTH * 0.5) {
    state.action = true;
    bus.emit('input:action');
    return;
  }

  // Left half → joystick
  state.touching = true;
  state.touchOrigin = { x: pos.x, y: pos.y };
  state.touchPos = { x: pos.x, y: pos.y };
}

function _onTouchMove(e) {
  e.preventDefault();
  if (!state.touching) return;
  const t = e.changedTouches[0];
  const pos = _toLogical(t);
  state.touchPos.x = pos.x;
  state.touchPos.y = pos.y;
}

function _onTouchEnd(e) {
  e.preventDefault();
  state.touching = false;
  state.touchOrigin = null;
  state.moveX = 0;
  state.moveY = 0;
}

// ─── Mouse Handlers (desktop) ───────────────────────────────

let mouseDown = false;

function _onMouseDown(e) {
  // Right-click → action
  if (e.button === 2) {
    state.action = true;
    bus.emit('input:action');
    return;
  }
  mouseDown = true;
  const rect = canvas.getBoundingClientRect();
  const pos = {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
  state.touching = true;
  state.touchOrigin = { x: pos.x, y: pos.y };
  state.touchPos = { x: pos.x, y: pos.y };
}

function _onMouseMove(e) {
  if (!mouseDown) return;
  const rect = canvas.getBoundingClientRect();
  state.touchPos.x = (e.clientX - rect.left) * scaleX;
  state.touchPos.y = (e.clientY - rect.top) * scaleY;
}

function _onMouseUp() {
  mouseDown = false;
  state.touching = false;
  state.touchOrigin = null;
}

// ─── Exports ─────────────────────────────────────────────────

export { state as inputState };
export default { initInput, destroyInput, pollInput, state };
