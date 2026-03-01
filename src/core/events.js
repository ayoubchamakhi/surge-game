/**
 * @module core/events
 * @description Zero-allocation pub/sub event bus for SURGE.
 *
 * Event naming convention:  "domain:action"
 *   engine:start | engine:stop | engine:tick
 *   wave:start   | wave:end    | wave:clear
 *   player:hit   | player:death| player:dash
 *   enemy:spawn  | enemy:death | enemy:hit
 *   upgrade:offered | upgrade:picked
 *   director:decision | director:stress
 *   input:move   | input:action
 *
 * Wildcard listeners registered with on('*', fn) receive (eventName, ...args).
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    /** @type {boolean} */
    this.debug = false;
  }

  /**
   * Subscribe to an event. Use '*' to listen to every event.
   * @param {string}   event    - Event name or '*' for wildcard.
   * @param {Function} callback - Handler invoked when the event fires.
   * @returns {this} For chaining.
   */
  on(event, callback) {
    let set = this._listeners.get(event);
    if (!set) { set = new Set(); this._listeners.set(event, set); }
    set.add(callback);
    return this;
  }

  /**
   * Unsubscribe a specific callback from an event.
   * @param {string}   event    - Event name or '*'.
   * @param {Function} callback - The exact function reference to remove.
   * @returns {this}
   */
  off(event, callback) {
    const set = this._listeners.get(event);
    if (set) { set.delete(callback); if (set.size === 0) this._listeners.delete(event); }
    return this;
  }

  /**
   * Subscribe to an event for a single firing, then auto-unsubscribe.
   * @param {string}   event    - Event name.
   * @param {Function} callback - One-shot handler.
   * @returns {this}
   */
  once(event, callback) {
    const wrapper = (...args) => { this.off(event, wrapper); callback(...args); };
    return this.on(event, wrapper);
  }

  /**
   * Emit an event, invoking all registered listeners.
   * Hot-path: zero temporary array allocations.
   * @param {string} event - Event name to fire.
   * @param {...*}   args  - Payload forwarded to each listener.
   * @returns {this}
   */
  emit(event, ...args) {
    if (this.debug) console.log(`[EventBus] ${event}`, ...args);

    const set = this._listeners.get(event);
    if (set) for (const fn of set) fn(...args);

    const wild = this._listeners.get('*');
    if (wild) for (const fn of wild) fn(event, ...args);

    return this;
  }

  /**
   * Remove all listeners, optionally scoped to a single event.
   * @param {string} [event] - If provided, only clear that event's listeners.
   * @returns {this}
   */
  clear(event) {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
    return this;
  }
}

/** Singleton instance shared across the entire game. */
const bus = new EventBus();
export default bus;
