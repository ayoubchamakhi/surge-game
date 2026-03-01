/**
 * @module ui/report-screen
 * @description Retro terminal-themed Coach Report overlay for SURGE.
 *
 * Displays post-run analysis from the Coach system as a full-screen
 * overlay with scrolling, styled like a retro CRT terminal.
 *
 * API:
 *   showReportScreen(report)   — display the report overlay
 *   hideReportScreen()         — remove the overlay
 */

import { getColor } from '../config/palettes.js';

/** @type {HTMLElement|null} */
let overlay = null;
let scrollEl = null;

/**
 * Show the Coach Report as a full-screen overlay.
 * @param {import('../agents/coach.js').CoachReport} report
 * @param {Function} onDismiss — callback when user dismisses
 */
export function showReportScreen(report, onDismiss) {
  hideReportScreen(); // clean up any existing

  overlay = document.createElement('div');
  overlay.id = 'report-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.92);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: 'Courier New', monospace;
    color: #33ff33;
    overflow: hidden;
    animation: reportFadeIn 0.5s ease-out;
  `;

  // Add CSS animation
  if (!document.getElementById('report-styles')) {
    const style = document.createElement('style');
    style.id = 'report-styles';
    style.textContent = `
      @keyframes reportFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes scanline {
        0% { transform: translateY(-100%); }
        100% { transform: translateY(100vh); }
      }
      #report-overlay .scanlines {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: repeating-linear-gradient(
          0deg,
          rgba(0, 255, 0, 0.03) 0px,
          rgba(0, 255, 0, 0.03) 1px,
          transparent 1px,
          transparent 3px
        );
        pointer-events: none;
      }
      #report-overlay .crt-glow {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        box-shadow: inset 0 0 80px rgba(0, 255, 0, 0.08);
        pointer-events: none;
      }
      #report-content {
        max-width: 420px;
        width: 90%;
        max-height: 85vh;
        overflow-y: auto;
        padding: 16px;
        scrollbar-width: thin;
        scrollbar-color: #33ff33 #111;
      }
      #report-content::-webkit-scrollbar {
        width: 6px;
      }
      #report-content::-webkit-scrollbar-track {
        background: #111;
      }
      #report-content::-webkit-scrollbar-thumb {
        background: #33ff33;
        border-radius: 3px;
      }
      .report-grade {
        font-size: 48px;
        font-weight: bold;
        text-align: center;
        margin: 8px 0;
        text-shadow: 0 0 20px currentColor;
      }
      .report-grade.grade-S { color: #ffff00; }
      .report-grade.grade-A { color: #33ff33; }
      .report-grade.grade-B { color: #33ccff; }
      .report-grade.grade-C { color: #ff9933; }
      .report-grade.grade-D { color: #ff6633; }
      .report-grade.grade-F { color: #ff3333; }
      .report-headline {
        text-align: center;
        font-size: 12px;
        margin-bottom: 16px;
        opacity: 0.8;
      }
      .report-section {
        margin: 12px 0;
        border-left: 2px solid #33ff33;
        padding-left: 8px;
      }
      .report-section-title {
        font-size: 11px;
        font-weight: bold;
        color: #66ff66;
        margin-bottom: 4px;
        letter-spacing: 2px;
      }
      .report-line {
        font-size: 10px;
        line-height: 1.6;
        opacity: 0.9;
      }
      .report-line.warning { color: #ffaa33; }
      .report-line.good { color: #33ff33; }
      .report-line.star { color: #ffff00; }
      .report-line.drill { color: #33ccff; }
      .report-line.empty { height: 6px; }
      .report-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px 12px;
        font-size: 9px;
        margin: 12px 0;
        padding: 8px;
        border: 1px solid rgba(51, 255, 51, 0.3);
      }
      .report-stat-label { opacity: 0.6; }
      .report-stat-value { text-align: right; font-weight: bold; }
      .report-dismiss {
        display: block;
        margin: 16px auto 0;
        padding: 8px 24px;
        background: transparent;
        border: 1px solid #33ff33;
        color: #33ff33;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        cursor: pointer;
        letter-spacing: 2px;
      }
      .report-dismiss:hover {
        background: rgba(51, 255, 51, 0.15);
      }
      .report-header-line {
        text-align: center;
        font-size: 10px;
        opacity: 0.5;
        letter-spacing: 3px;
      }
    `;
    document.head.appendChild(style);
  }

  // Scanlines + CRT glow
  overlay.innerHTML = '<div class="scanlines"></div><div class="crt-glow"></div>';

  // Content container
  scrollEl = document.createElement('div');
  scrollEl.id = 'report-content';

  // ── Build report HTML ──
  const html = [];

  html.push(`<div class="report-header-line">━━━ SURGE AI COACH ━━━</div>`);
  html.push(`<div class="report-grade grade-${report.grade}">${report.grade}</div>`);
  html.push(`<div class="report-headline">${_escHtml(report.headline)}</div>`);

  // Stats grid
  if (report.stats) {
    html.push('<div class="report-stats">');
    const statLabels = {
      runTime: 'RUN TIME',
      wavesCleared: 'WAVES',
      totalKills: 'KILLS',
      totalDamage: 'DAMAGE TAKEN',
      killEfficiency: 'KILLS/SEC',
      predictability: 'PREDICT %',
      peakEnemies: 'PEAK ENEMIES',
    };
    for (const [key, label] of Object.entries(statLabels)) {
      const val = report.stats[key];
      const display = key === 'runTime' ? `${val}s` : val;
      html.push(`<div class="report-stat-label">${label}</div>`);
      html.push(`<div class="report-stat-value">${display}</div>`);
    }
    html.push('</div>');
  }

  // Sections
  const sections = ['patterns', 'threats', 'director', 'drills'];
  for (const key of sections) {
    const section = report[key];
    if (!section) continue;
    html.push('<div class="report-section">');
    html.push(`<div class="report-section-title">${_escHtml(section.title)}</div>`);
    for (const line of section.lines) {
      if (!line || line.trim() === '') {
        html.push('<div class="report-line empty"></div>');
        continue;
      }
      let cls = 'report-line';
      if (line.startsWith('⚠')) cls += ' warning';
      else if (line.startsWith('★') || line.startsWith('✦')) cls += ' star';
      else if (line.startsWith('🎯')) cls += ' drill';
      else if (line.startsWith('◉') || line.startsWith('⚡')) cls += ' good';
      html.push(`<div class="${cls}">${_escHtml(line)}</div>`);
    }
    html.push('</div>');
  }

  // Dismiss button
  html.push('<button class="report-dismiss">[ CONTINUE ]</button>');

  scrollEl.innerHTML = html.join('');
  overlay.appendChild(scrollEl);
  document.body.appendChild(overlay);

  // Dismiss handler
  const dismissBtn = scrollEl.querySelector('.report-dismiss');
  dismissBtn.addEventListener('click', () => {
    hideReportScreen();
    if (onDismiss) onDismiss();
  });

  // Also dismiss on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      hideReportScreen();
      if (onDismiss) onDismiss();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

/**
 * Hide and remove the report overlay.
 */
export function hideReportScreen() {
  if (overlay) {
    overlay.remove();
    overlay = null;
    scrollEl = null;
  }
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function _escHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

export default { showReportScreen, hideReportScreen };
