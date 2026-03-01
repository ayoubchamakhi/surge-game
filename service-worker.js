/**
 * SURGE Service Worker — offline PWA support (#42).
 * Cache-first strategy for all game assets.
 */

const CACHE_NAME = 'surge-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/style.css',
  '/manifest.json',
  '/src/core/ecs.js',
  '/src/core/engine.js',
  '/src/core/events.js',
  '/src/core/input.js',
  '/src/core/physics.js',
  '/src/config/balance.js',
  '/src/config/cards.js',
  '/src/config/palettes.js',
  '/src/config/prompts.js',
  '/src/game/player.js',
  '/src/game/enemies.js',
  '/src/game/projectiles.js',
  '/src/game/collision.js',
  '/src/game/arena.js',
  '/src/game/particles.js',
  '/src/game/upgrades.js',
  '/src/game/encounter-cards.js',
  '/src/game/pilot-rank.js',
  '/src/game/achievements.js',
  '/src/game/daily-challenges.js',
  '/src/game/leaderboard.js',
  '/src/game/mastery.js',
  '/src/game/cosmetics.js',
  '/src/game/battle-pass.js',
  '/src/agents/director.js',
  '/src/agents/stress-model.js',
  '/src/agents/telemetry.js',
  '/src/agents/coach.js',
  '/src/agents/enemy-brain.js',
  '/src/agents/llm-adapter.js',
  '/src/agents/planner-critic.js',
  '/src/agents/analytics.js',
  '/src/ui/renderer.js',
  '/src/ui/hud.js',
  '/src/ui/touch-controls.js',
  '/src/ui/report-screen.js',
  '/src/ui/store-screen.js',
  '/src/ui/crt-filter.js',
  '/src/ui/tutorial.js',
  '/src/audio/audio-engine.js',
];

// Install: pre-cache all assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET and external requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback
      if (event.request.destination === 'document') {
        return caches.match('/index.html');
      }
    })
  );
});
