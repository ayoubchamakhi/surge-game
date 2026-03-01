/**
 * @module agents/analytics
 * @description Analytics Agent — event capture, batching, privacy.
 *
 * Captures session and gameplay events, batches them, and
 * transmits to the analytics backend. Respects privacy:
 * no PII, anonymized player ID, opt-out support.
 *
 * Events are buffered and sent in batches every 30s (or on session end).
 */

const STORAGE_KEY = 'surge_analytics';
const BATCH_INTERVAL = 30000; // 30 seconds
const MAX_BUFFER = 200;

let state = {
  enabled: true,
  playerId: '',
  sessionId: '',
  buffer: [],
  batchTimer: null,
  endpoint: '',
};

/**
 * Initialize analytics for a session.
 */
export function initAnalytics() {
  // Generate anonymous player ID if not exists
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {}

  state.enabled = saved.enabled !== false;
  state.playerId = saved.playerId || _generateId();
  state.endpoint = saved.endpoint || '';
  state.sessionId = _generateId();
  state.buffer = [];

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    enabled: state.enabled,
    playerId: state.playerId,
    endpoint: state.endpoint,
  }));

  if (state.enabled) {
    trackEvent('session_start', {
      device: _getDeviceInfo(),
      timestamp: Date.now(),
    });

    // Start batch timer
    state.batchTimer = setInterval(_flush, BATCH_INTERVAL);
  }
}

/**
 * Track an event.
 * @param {string} type
 * @param {object} data
 */
export function trackEvent(type, data = {}) {
  if (!state.enabled) return;

  state.buffer.push({
    type,
    ts: Date.now(),
    sid: state.sessionId,
    ...data,
  });

  if (state.buffer.length >= MAX_BUFFER) {
    _flush();
  }
}

/**
 * Track end of run.
 */
export function trackRunEnd(runData) {
  trackEvent('run_end', {
    wave: runData.wavesCleared || runData.wave,
    score: runData.score,
    kills: runData.totalKills,
    time: Math.round(runData.runTime),
    mode: runData.mode,
    death_cause: runData.deathCause || 'unknown',
  });
}

/**
 * Track wave completion.
 */
export function trackWaveComplete(data) {
  trackEvent('wave_complete', {
    wave: data.wave,
    duration: Math.round(data.duration * 100) / 100,
    kills: data.kills,
    damage: data.damageTaken,
  });
}

/**
 * End the analytics session.
 */
export function shutdownAnalytics() {
  trackEvent('session_end', { duration: Date.now() });
  _flush();
  if (state.batchTimer) {
    clearInterval(state.batchTimer);
    state.batchTimer = null;
  }
}

/**
 * Set analytics enabled/disabled.
 */
export function setAnalyticsEnabled(enabled) {
  state.enabled = enabled;
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  saved.enabled = enabled;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

/**
 * Set analytics endpoint.
 */
export function setAnalyticsEndpoint(url) {
  state.endpoint = url;
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  saved.endpoint = url;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

/**
 * Get buffered events (for local dashboard).
 */
export function getBufferedEvents() {
  return [...state.buffer];
}

// ─── Internal ──────────────────────────────────────────────

function _flush() {
  if (state.buffer.length === 0) return;
  if (!state.endpoint) {
    // No backend configured — store locally for dashboard
    _storeLocal(state.buffer);
    state.buffer = [];
    return;
  }

  const batch = state.buffer.splice(0);
  const payload = {
    pid: state.playerId,
    events: batch,
  };

  // Fire and forget
  fetch(state.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    // On failure, put events back (up to MAX_BUFFER)
    state.buffer.unshift(...batch.slice(0, MAX_BUFFER - state.buffer.length));
  });
}

function _storeLocal(events) {
  try {
    const key = 'surge_analytics_local';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const combined = [...existing, ...events].slice(-500); // Keep last 500
    localStorage.setItem(key, JSON.stringify(combined));
  } catch { /* storage full — drop */ }
}

function _generateId() {
  return 'xxxx-xxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

function _getDeviceInfo() {
  return {
    ua: navigator.userAgent.slice(0, 100),
    screen: `${screen.width}x${screen.height}`,
    dpr: window.devicePixelRatio || 1,
    touch: 'ontouchstart' in window,
  };
}

export default { initAnalytics, trackEvent, trackRunEnd, trackWaveComplete, shutdownAnalytics, setAnalyticsEnabled };
