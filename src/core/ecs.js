/**
 * @module core/ecs
 * @description Lightweight Entity-Component-System for SURGE.
 *
 * Design philosophy (inspired by LoL Swarm's performance):
 *   - Entities are plain integer IDs
 *   - Components are plain objects stored in typed Maps
 *   - Systems are functions run each frame
 *   - ~100 lines of core, zero dependencies
 *
 * Usage:
 *   const world = new World();
 *   const id = world.create();
 *   world.add(id, 'pos', { x: 0, y: 0 });
 *   world.add(id, 'vel', { x: 1, y: 0 });
 *   world.addSystem('movement', ['pos', 'vel'], (entities, dt) => { ... });
 *   world.tick(dt);
 */

/**
 * The ECS World — owns all entities, components, and systems.
 */
export class World {
  constructor() {
    /** @type {number} Next entity ID */
    this._nextId = 1;

    /**
     * Component stores: componentName → Map<entityId, componentData>
     * @type {Map<string, Map<number, object>>}
     */
    this._components = new Map();

    /**
     * Systems run each tick in registration order.
     * @type {Array<{name: string, required: string[], fn: Function, enabled: boolean}>}
     */
    this._systems = [];

    /** @type {Set<number>} All living entity IDs */
    this._alive = new Set();

    /** @type {number[]} Deferred destruction queue (avoids mid-iteration removal) */
    this._destroyQueue = [];

    /** @type {Map<string, Set<number>>} Cached archetype sets for fast queries */
    this._archetypeCache = new Map();
    this._archetypeDirty = true;
  }

  // ─── Entity Lifecycle ───────────────────────────────────────

  /**
   * Create a new entity.
   * @returns {number} The entity ID.
   */
  create() {
    const id = this._nextId++;
    this._alive.add(id);
    this._archetypeDirty = true;
    return id;
  }

  /**
   * Schedule an entity for destruction (processed at end of tick).
   * @param {number} id
   */
  destroy(id) {
    this._destroyQueue.push(id);
  }

  /**
   * Immediately remove an entity and all its components.
   * @param {number} id
   */
  _destroyImmediate(id) {
    for (const store of this._components.values()) {
      store.delete(id);
    }
    this._alive.delete(id);
    this._archetypeDirty = true;
  }

  /**
   * Check if an entity is alive.
   * @param {number} id
   * @returns {boolean}
   */
  alive(id) {
    return this._alive.has(id);
  }

  /** @returns {number} Current living entity count */
  get entityCount() {
    return this._alive.size;
  }

  // ─── Component Management ──────────────────────────────────

  /**
   * Add (or overwrite) a component on an entity.
   * @param {number} id   - Entity ID
   * @param {string} name - Component name (e.g., 'pos', 'vel', 'health')
   * @param {object} data - Component data (plain object)
   * @returns {object} The component data (for chaining)
   */
  add(id, name, data) {
    let store = this._components.get(name);
    if (!store) {
      store = new Map();
      this._components.set(name, store);
    }
    store.set(id, data);
    this._archetypeDirty = true;
    return data;
  }

  /**
   * Get a component from an entity.
   * @param {number} id
   * @param {string} name
   * @returns {object|undefined}
   */
  get(id, name) {
    const store = this._components.get(name);
    return store ? store.get(id) : undefined;
  }

  /**
   * Check if an entity has a specific component.
   * @param {number} id
   * @param {string} name
   * @returns {boolean}
   */
  has(id, name) {
    const store = this._components.get(name);
    return store ? store.has(id) : false;
  }

  /**
   * Remove a component from an entity.
   * @param {number} id
   * @param {string} name
   */
  remove(id, name) {
    const store = this._components.get(name);
    if (store) {
      store.delete(id);
      this._archetypeDirty = true;
    }
  }

  // ─── Queries ───────────────────────────────────────────────

  /**
   * Get all entity IDs that have ALL of the listed components.
   * Uses caching for repeated queries in the same frame.
   * @param {...string} componentNames
   * @returns {number[]}
   */
  query(...componentNames) {
    const key = componentNames.join(',');

    if (this._archetypeDirty) {
      this._archetypeCache.clear();
      this._archetypeDirty = false;
    }

    let cached = this._archetypeCache.get(key);
    if (cached) return cached;

    const result = [];
    const stores = componentNames.map(n => this._components.get(n));

    // If any required component store doesn't exist, return empty
    if (stores.some(s => !s)) {
      this._archetypeCache.set(key, result);
      return result;
    }

    // Iterate the smallest store for efficiency
    let smallest = stores[0];
    for (let i = 1; i < stores.length; i++) {
      if (stores[i].size < smallest.size) smallest = stores[i];
    }

    for (const id of smallest.keys()) {
      if (!this._alive.has(id)) continue;
      let match = true;
      for (const store of stores) {
        if (!store.has(id)) { match = false; break; }
      }
      if (match) result.push(id);
    }

    this._archetypeCache.set(key, result);
    return result;
  }

  /**
   * Iterate all entities with given components, calling fn(id, ...components).
   * More ergonomic than query() for systems.
   * @param {string[]} componentNames
   * @param {Function} fn - Called as fn(id, comp1, comp2, ...)
   */
  each(componentNames, fn) {
    const ids = this.query(...componentNames);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const comps = componentNames.map(n => this.get(id, n));
      fn(id, ...comps);
    }
  }

  // ─── System Management ────────────────────────────────────

  /**
   * Register a system.
   * @param {string} name       - Unique system name
   * @param {string[]} required - Component names entities must have
   * @param {Function} fn       - System function: fn(entities: number[], dt: number, world: World)
   * @param {number} [priority=0] - Lower runs first
   */
  addSystem(name, required, fn, priority = 0) {
    this._systems.push({ name, required, fn, enabled: true, priority });
    this._systems.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Enable or disable a system by name.
   * @param {string} name
   * @param {boolean} enabled
   */
  setSystemEnabled(name, enabled) {
    const sys = this._systems.find(s => s.name === name);
    if (sys) sys.enabled = enabled;
  }

  // ─── Tick ─────────────────────────────────────────────────

  /**
   * Run all systems for one simulation step.
   * @param {number} dt - Delta time in seconds
   */
  tick(dt) {
    // Invalidate archetype cache
    this._archetypeDirty = true;

    for (const sys of this._systems) {
      if (!sys.enabled) continue;
      const entities = this.query(...sys.required);
      sys.fn(entities, dt, this);
    }

    // Flush deferred destructions
    this._flushDestroyQueue();
  }

  /** Process all deferred entity destructions */
  _flushDestroyQueue() {
    for (let i = 0; i < this._destroyQueue.length; i++) {
      this._destroyImmediate(this._destroyQueue[i]);
    }
    this._destroyQueue.length = 0;
  }

  // ─── Utilities ────────────────────────────────────────────

  /**
   * Remove all entities and reset. Systems are kept.
   */
  reset() {
    this._alive.clear();
    for (const store of this._components.values()) store.clear();
    this._destroyQueue.length = 0;
    this._archetypeCache.clear();
    this._archetypeDirty = true;
    this._nextId = 1;
  }
}

/** Singleton world instance */
const world = new World();
export default world;
