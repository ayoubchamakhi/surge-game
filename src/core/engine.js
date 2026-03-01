/**
 * @module core/engine
 * @description Fixed-timestep game loop with render interpolation.
 *
 * Uses the "Fix Your Timestep!" pattern:
 *   - Physics/logic runs at a fixed 60Hz rate
 *   - Rendering runs at display refresh rate via rAF
 *   - Interpolation smooths between physics states
 *
 * This ensures deterministic simulation regardless of display refresh rate,
 * critical for seed-based replay and ghost runs.
 */

import { TIMING } from '../config/balance.js';
import bus from './events.js';

/** Engine states */
const STATE = Object.freeze({
  STOPPED: 0,
  RUNNING: 1,
  PAUSED:  2,
});

class Engine {
  constructor() {
    /** @type {number} */
    this.state = STATE.STOPPED;

    /** @type {number} Accumulated time for fixed updates (seconds) */
    this._accumulator = 0;

    /** @type {number} Previous rAF timestamp */
    this._prevTime = 0;

    /** @type {number} Current simulation time */
    this._simTime = 0;

    /** @type {number} rAF handle for cancellation */
    this._rafHandle = 0;

    /** @type {number} Smoothed FPS */
    this.fps = 60;

    /** @type {number} Frame count since start */
    this.frameCount = 0;

    /** @type {number} Slowmo multiplier (1.0 = normal, 0.3 = slow) */
    this.timeScale = 1.0;

    /** @type {number} Slowmo remaining duration */
    this._slowmoRemaining = 0;

    /** @type {Function} Bound loop reference */
    this._loop = this._frame.bind(this);

    /** @type {Function|null} Logic update callback: fn(dt) */
    this.onUpdate = null;

    /** @type {Function|null} Render callback: fn(alpha) */
    this.onRender = null;
  }

  /**
   * Start the engine loop.
   */
  start() {
    if (this.state === STATE.RUNNING) return;
    this.state = STATE.RUNNING;
    this._prevTime = performance.now();
    this._accumulator = 0;
    this._rafHandle = requestAnimationFrame(this._loop);
    bus.emit('engine:start');
  }

  /**
   * Stop the engine completely.
   */
  stop() {
    this.state = STATE.STOPPED;
    cancelAnimationFrame(this._rafHandle);
    this._rafHandle = 0;
    bus.emit('engine:stop');
  }

  /**
   * Pause — freezes simulation but keeps rAF alive (for pause menus).
   */
  pause() {
    if (this.state !== STATE.RUNNING) return;
    this.state = STATE.PAUSED;
    bus.emit('engine:pause');
  }

  /**
   * Resume from pause.
   */
  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.RUNNING;
    this._prevTime = performance.now();
    this._accumulator = 0;
    bus.emit('engine:resume');
  }

  /**
   * Trigger a slowmo effect (e.g., boss phase transition, big hit).
   * @param {number} duration - Seconds of slowmo
   * @param {number} [scale=0.3] - Time scale during slowmo
   */
  slowmo(duration, scale = TIMING.SLOWMO_FACTOR || 0.3) {
    this._slowmoRemaining = duration;
    this.timeScale = scale;
  }

  /**
   * Main frame callback — called every rAF.
   * @param {number} timestamp - DOMHighResTimeStamp from rAF
   * @private
   */
  _frame(timestamp) {
    this._rafHandle = requestAnimationFrame(this._loop);
    this.frameCount++;

    // Calculate raw delta
    let rawDt = (timestamp - this._prevTime) / 1000;
    this._prevTime = timestamp;

    // Clamp to prevent spiral of death
    if (rawDt > TIMING.MAX_FRAME_TIME) rawDt = TIMING.MAX_FRAME_TIME;

    // Smooth FPS
    this.fps = this.fps * TIMING.FPS_SMOOTH + (1 / rawDt) * (1 - TIMING.FPS_SMOOTH);

    // If paused, only render (for animated menus)
    if (this.state === STATE.PAUSED) {
      if (this.onRender) this.onRender(0);
      return;
    }

    // Handle slowmo
    if (this._slowmoRemaining > 0) {
      this._slowmoRemaining -= rawDt;
      if (this._slowmoRemaining <= 0) {
        this.timeScale = 1.0;
        this._slowmoRemaining = 0;
      }
    }

    // Apply time scale
    const dt = rawDt * this.timeScale;

    // Accumulate & consume fixed timesteps
    this._accumulator += dt;
    const fixedDt = TIMING.FIXED_DT;

    while (this._accumulator >= fixedDt) {
      // Fixed update (physics, logic, AI)
      if (this.onUpdate) this.onUpdate(fixedDt);
      bus.emit('engine:tick', fixedDt, this._simTime);
      this._simTime += fixedDt;
      this._accumulator -= fixedDt;
    }

    // Render interpolation alpha (0..1 between physics frames)
    const alpha = this._accumulator / fixedDt;
    if (this.onRender) this.onRender(alpha);
  }

  /** @returns {boolean} */
  get running() { return this.state === STATE.RUNNING; }

  /** @returns {boolean} */
  get paused() { return this.state === STATE.PAUSED; }

  /** @returns {number} Simulation time in seconds */
  get time() { return this._simTime; }

  /**
   * Reset engine state for a new run.
   */
  reset() {
    this._accumulator = 0;
    this._simTime = 0;
    this.timeScale = 1.0;
    this._slowmoRemaining = 0;
    this.frameCount = 0;
    this.fps = 60;
  }
}

/** Singleton engine instance */
const engine = new Engine();
export default engine;
export { STATE };
