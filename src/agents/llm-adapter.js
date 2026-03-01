/**
 * @module agents/llm-adapter
 * @description LLM Adapter Agent — bridges SURGE with any OpenAI-compatible API.
 *
 * Supports: OpenAI, Ollama, Groq, Together AI, LM Studio, or any
 * OpenAI-compatible endpoint. Auto-detects Ollama format.
 *
 * Features:
 *   - Rate limiting (configurable minimum interval)
 *   - Timeout with AbortController
 *   - Token tracking
 *   - Failure counting + stats
 *   - Graceful fallback on error (returns null)
 *
 * @example
 *   const llm = new LLMAdapter({ endpoint, apiKey, model });
 *   const result = await llm.query(systemPrompt, userMessage);
 *   if (result) console.log(result.response);
 */

import { DIRECTOR } from '../config/balance.js';

// ─── Configuration Defaults ──────────────────────────────────

const DEFAULTS = {
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  timeout: DIRECTOR.LLM_TIMEOUT_MS || 3000,
  rateLimitMs: DIRECTOR.LLM_RATE_LIMIT_MS || 20000,
  maxOutputTokens: DIRECTOR.LLM_MAX_OUTPUT_TOKENS || 150,
};

// ─── LLMAdapter Class ────────────────────────────────────────

export class LLMAdapter {
  /**
   * @param {object} config
   * @param {string} [config.endpoint]
   * @param {string} [config.apiKey]
   * @param {string} [config.model]
   * @param {number} [config.timeout]
   * @param {number} [config.rateLimitMs]
   */
  constructor(config = {}) {
    this.endpoint = (config.endpoint || DEFAULTS.endpoint).replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.model = config.model || DEFAULTS.model;
    this.timeout = config.timeout || DEFAULTS.timeout;
    this.rateLimitMs = config.rateLimitMs || DEFAULTS.rateLimitMs;
    this.maxOutputTokens = config.maxOutputTokens || DEFAULTS.maxOutputTokens;

    // Stats
    this._totalCalls = 0;
    this._totalTokens = 0;
    this._totalLatency = 0;
    this._failures = 0;
    this._lastCallTime = 0;
  }

  /**
   * Check if the adapter is configured with at minimum an endpoint.
   * Ollama doesn't need an API key. OpenAI does.
   * @returns {boolean}
   */
  isConfigured() {
    if (this._isOllama()) return true;
    return !!(this.endpoint && this.apiKey);
  }

  /**
   * Query the LLM.
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @returns {Promise<{response: string, tokensUsed: number, latency: number}|null>}
   */
  async query(systemPrompt, userMessage) {
    if (!this.isConfigured()) return null;

    // Rate limiting
    const now = Date.now();
    if (now - this._lastCallTime < this.rateLimitMs) {
      console.warn('[LLM] Rate limited — skipping query');
      return null;
    }
    this._lastCallTime = now;

    const start = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const body = this._buildRequestBody(systemPrompt, userMessage);
      const url = this._getUrl();
      const headers = this._getHeaders();

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[LLM] API error ${res.status}: ${errText}`);
        this._failures++;
        return null;
      }

      const data = await res.json();
      const latency = performance.now() - start;
      const result = this._parseResponse(data);

      this._totalCalls++;
      this._totalTokens += result.tokensUsed;
      this._totalLatency += latency;

      return { ...result, latency };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.warn('[LLM] Query timed out');
      } else {
        console.error('[LLM] Query failed:', err.message);
      }
      this._failures++;
      return null;
    }
  }

  /**
   * Test the connection with a minimal prompt.
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    const oldRateLimit = this.rateLimitMs;
    this.rateLimitMs = 0; // bypass for test
    const result = await this.query(
      'You are a test assistant.',
      'Reply with exactly: OK'
    );
    this.rateLimitMs = oldRateLimit;
    return result !== null;
  }

  /**
   * Get adapter stats.
   * @returns {{totalCalls: number, totalTokens: number, avgLatency: number, failures: number}}
   */
  getStats() {
    return {
      totalCalls: this._totalCalls,
      totalTokens: this._totalTokens,
      avgLatency: this._totalCalls > 0
        ? Math.round(this._totalLatency / this._totalCalls)
        : 0,
      failures: this._failures,
    };
  }

  /**
   * Update configuration.
   * @param {object} config
   */
  updateConfig(config) {
    if (config.endpoint !== undefined) this.endpoint = config.endpoint.replace(/\/+$/, '');
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
    if (config.model !== undefined) this.model = config.model;
    if (config.timeout !== undefined) this.timeout = config.timeout;
  }

  // ─── Internal ────────────────────────────────────────────

  _isOllama() {
    return this.endpoint.includes('localhost:11434') || this.endpoint.includes('127.0.0.1:11434');
  }

  _getUrl() {
    if (this._isOllama()) {
      return `${this.endpoint}/api/chat`;
    }
    // OpenAI-compatible
    return `${this.endpoint}/chat/completions`;
  }

  _getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey && !this._isOllama()) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  _buildRequestBody(systemPrompt, userMessage) {
    if (this._isOllama()) {
      return {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        stream: false,
        options: { num_predict: this.maxOutputTokens },
      };
    }
    // OpenAI-compatible
    return {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: this.maxOutputTokens,
      temperature: 0.7,
    };
  }

  _parseResponse(data) {
    // Ollama format
    if (data.message?.content) {
      return {
        response: data.message.content,
        tokensUsed: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      };
    }
    // OpenAI format
    if (data.choices?.[0]?.message?.content) {
      return {
        response: data.choices[0].message.content,
        tokensUsed: data.usage?.total_tokens || 0,
      };
    }
    return { response: '', tokensUsed: 0 };
  }
}

// ─── Singleton for game use ──────────────────────────────────

let _instance = null;

/**
 * Get or create the global LLM adapter instance.
 * @param {object} [config] — pass config on first call to initialize
 * @returns {LLMAdapter}
 */
export function getLLMAdapter(config) {
  if (!_instance || config) {
    _instance = new LLMAdapter(config);
  }
  return _instance;
}

/**
 * Reset the global instance (for testing / reconfig).
 */
export function resetLLMAdapter() {
  _instance = null;
}

export default { LLMAdapter, getLLMAdapter, resetLLMAdapter };
