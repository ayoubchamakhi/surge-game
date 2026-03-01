/**
 * @module tutorial
 * First-run onboarding tutorial (#41).
 * Shows interactive overlay prompts teaching core mechanics.
 */

const TUTORIAL_KEY = 'surge_tutorial_done';

let active = false;
let step = 0;
let onComplete = null;
let $overlay = null;

const STEPS = [
  {
    text: '⚡ Welcome to SURGE!\nA bullet-heaven where you auto-fire and enemies come to you.',
    action: 'Click or tap to continue',
  },
  {
    text: '🖱 MOVE: Hold mouse / touch and your pilot flies toward the cursor.',
    action: 'Click to continue',
  },
  {
    text: '⚡ DASH: Press SPACE or double-tap to dash through enemies.\nBrief invincibility!',
    action: 'Click to continue',
  },
  {
    text: '🔫 AUTO-FIRE: Your weapons fire automatically.\nFocus on dodging and positioning!',
    action: 'Click to continue',
  },
  {
    text: '⬆ LEVEL UP: Kill enemies → gain XP → pick upgrades.\n15 unique upgrades across 3 categories.',
    action: 'Click to continue',
  },
  {
    text: '🌊 WAVES: Survive 30 waves to win.\nEach wave brings tougher enemies and bosses.',
    action: 'Click to continue',
  },
  {
    text: '🧠 AI DIRECTOR: The game adapts to YOUR skill.\nStress too high? It eases up. Too easy? It ramps up.',
    action: 'Click to start your first run!',
  },
];

export function shouldShowTutorial() {
  try {
    return !localStorage.getItem(TUTORIAL_KEY);
  } catch {
    return false;
  }
}

export function markTutorialDone() {
  try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch {}
}

export function resetTutorial() {
  try { localStorage.removeItem(TUTORIAL_KEY); } catch {}
}

export function startTutorial(callback) {
  if (!shouldShowTutorial()) {
    if (callback) callback();
    return;
  }

  active = true;
  step = 0;
  onComplete = callback;

  // Create overlay
  $overlay = document.createElement('div');
  $overlay.id = 'tutorial-overlay';
  $overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(10, 10, 11, 0.92); z-index: 100;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; pointer-events: auto; cursor: pointer;
    font-family: 'Courier New', monospace; color: #e0e0e0;
  `;

  $overlay.innerHTML = renderStep();

  $overlay.addEventListener('click', nextStep);
  $overlay.addEventListener('touchend', (e) => { e.preventDefault(); nextStep(); });

  document.body.appendChild($overlay);
}

function renderStep() {
  const s = STEPS[step];
  const progress = `${step + 1} / ${STEPS.length}`;
  return `
    <div style="text-align: center; max-width: 280px; padding: 20px;">
      <div style="font-size: 16px; line-height: 1.6; white-space: pre-line; margin-bottom: 20px;">
        ${s.text}
      </div>
      <div style="font-size: 10px; color: #aaff44; letter-spacing: 2px;">${s.action}</div>
      <div style="font-size: 9px; color: #555; margin-top: 12px;">${progress}</div>
      <div style="width: 120px; height: 2px; background: #333; margin: 8px auto 0; border-radius: 1px;">
        <div style="width: ${((step + 1) / STEPS.length) * 100}%; height: 100%; background: #aaff44; border-radius: 1px;"></div>
      </div>
    </div>
  `;
}

function nextStep() {
  step++;
  if (step >= STEPS.length) {
    endTutorial();
    return;
  }
  if ($overlay) $overlay.innerHTML = renderStep();
}

function endTutorial() {
  active = false;
  markTutorialDone();
  if ($overlay) {
    $overlay.remove();
    $overlay = null;
  }
  if (onComplete) onComplete();
}

export function isTutorialActive() {
  return active;
}

export default { shouldShowTutorial, startTutorial, resetTutorial, markTutorialDone, isTutorialActive };
