/**
 * @module agents/planner-critic
 * @description Multi-Agent Planner/Critic — premium LLM mode.
 *
 * Two-call pattern:
 *   1. Planner: generates encounter plan for next 3 waves
 *   2. Critic: validates the plan, suggests revisions if needed
 *
 * Falls back to single-call (planner only) if critic call fails
 * or if token budget is exhausted.
 */

import { getLLMAdapter } from './llm-adapter.js';
import { DIRECTOR_SYSTEM_PROMPT, CRITIC_SYSTEM_PROMPT } from '../config/prompts.js';

/**
 * Run the Planner/Critic pipeline.
 * @param {string} stateJson — JSON string of game state for the Director
 * @returns {Promise<{waves: Array, tip: string, critiqued: boolean}|null>}
 */
export async function planAndCritique(stateJson) {
  const llm = getLLMAdapter();
  if (!llm || !llm.isConfigured()) return null;

  // ── Call 1: Planner ──
  const planResult = await llm.query(DIRECTOR_SYSTEM_PROMPT, stateJson);
  if (!planResult) return null;

  let plan;
  try {
    plan = JSON.parse(_extractJson(planResult.response));
  } catch (e) {
    console.warn('[Planner/Critic] Failed to parse planner response:', e.message);
    return null;
  }

  if (!plan.waves || !Array.isArray(plan.waves)) return null;

  // ── Check token budget — skip critic if low ──
  const stats = llm.getStats();
  const settings = _getSettings();
  if (settings.tokenBudget && stats.totalTokens > settings.tokenBudget * 0.7) {
    console.log('[Planner/Critic] Token budget low, skipping critic');
    return { ...plan, critiqued: false };
  }

  // ── Call 2: Critic ──
  const criticInput = JSON.stringify({ plan, state: JSON.parse(stateJson) });
  const criticResult = await llm.query(CRITIC_SYSTEM_PROMPT, criticInput);
  if (!criticResult) {
    return { ...plan, critiqued: false };
  }

  let critique;
  try {
    critique = JSON.parse(_extractJson(criticResult.response));
  } catch (e) {
    console.warn('[Planner/Critic] Failed to parse critic response:', e.message);
    return { ...plan, critiqued: false };
  }

  // If critic approved, use original plan
  if (critique.approved) {
    return { ...plan, critiqued: true };
  }

  // If critic has a revision, use it
  if (critique.revision?.waves && Array.isArray(critique.revision.waves)) {
    return {
      waves: critique.revision.waves,
      tip: plan.tip || '',
      critiqued: true,
    };
  }

  // Fallback to original plan
  return { ...plan, critiqued: false };
}

/**
 * Extract JSON from a string that might contain markdown code fences.
 */
function _extractJson(text) {
  // Try to extract from code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  return text;
}

/**
 * Read LLM settings from localStorage.
 */
function _getSettings() {
  try {
    return JSON.parse(localStorage.getItem('surge_llm_settings') || '{}');
  } catch {
    return {};
  }
}

export default { planAndCritique };
