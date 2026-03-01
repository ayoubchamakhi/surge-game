/**
 * @module agents/coach
 * @description Post-run Coach Report Generator for SURGE.
 *
 * Analyzes telemetry data to produce a human-readable report with:
 *   1. Play Patterns — movement habits, positioning, predictability
 *   2. Threat Analysis — what hurt the player most, close calls
 *   3. Director Notes — how the AI adapted and why
 *   4. Suggested Drills — actionable improvement tips
 *
 * Uses template-driven text generation with threshold-based triggers.
 * Each section has multiple templates; the one whose condition matches
 * the telemetry data gets selected.
 *
 * API:
 *   generateCoachReport(runSummary) → CoachReport
 */

// ─── Report Structure ────────────────────────────────────────

/**
 * @typedef {Object} CoachReport
 * @property {string} grade          — S/A/B/C/D/F letter grade
 * @property {string} headline       — One-line run summary
 * @property {ReportSection} patterns — Movement/positioning analysis
 * @property {ReportSection} threats  — Threat & damage analysis
 * @property {ReportSection} director — How the AI director adapted
 * @property {ReportSection} drills   — Improvement suggestions
 * @property {object} stats           — Raw stat summary
 */

/**
 * @typedef {Object} ReportSection
 * @property {string} title
 * @property {string[]} lines — Rendered text lines
 */

// ─── Template Registry ───────────────────────────────────────

const PATTERN_TEMPLATES = [
  {
    condition: (s) => s.predictability > 0.7,
    lines: [
      '⚠ MOVEMENT TOO PREDICTABLE',
      'You moved in very consistent patterns.',
      'Enemies with learning behaviors will exploit this.',
      'Try varying your path — zigzag, orbit, reverse.',
    ],
  },
  {
    condition: (s) => s.predictability > 0.4,
    lines: [
      '◉ MODERATE MOVEMENT VARIETY',
      'Your pathing was fairly varied but has tendencies.',
      'Watch for "comfort zones" you default to under pressure.',
    ],
  },
  {
    condition: (s) => s.predictability <= 0.4,
    lines: [
      '✦ ERRATIC MOVEMENT — GOOD',
      'Your movement was highly unpredictable.',
      'Enemies had difficulty targeting you. Keep it up.',
    ],
  },
];

const HOTSPOT_TEMPLATES = [
  {
    condition: (s) => {
      const h = s.hotspot;
      return h.col >= 2 && h.col <= 5 && h.row >= 4 && h.row <= 7;
    },
    lines: [
      '◉ CENTER HUGGER',
      'You spent most time near the arena center.',
      'Good for maximizing dodge space, but enemies can surround you.',
    ],
  },
  {
    condition: (s) => {
      const h = s.hotspot;
      return h.col <= 1 || h.col >= 6 || h.row <= 1 || h.row >= 10;
    },
    lines: [
      '⚠ EDGE DWELLER',
      'You hugged the arena edges.',
      'This reduces your dodge options. Try using more of the arena.',
    ],
  },
  {
    condition: () => true,
    lines: [
      '◉ BALANCED POSITIONING',
      'No extreme positioning tendencies detected.',
    ],
  },
];

const THREAT_TEMPLATES = [
  {
    condition: (s) => s.totalDamageTaken === 0,
    lines: [
      '★ PERFECT — NO DAMAGE TAKEN',
      'Flawless run. The machines never touched you.',
    ],
  },
  {
    condition: (s) => (s.damageBySource['bullet'] || 0) > (s.damageBySource['enemy'] || 0),
    lines: [
      '⚠ BULLET DAMAGE DOMINANT',
      'Most hits came from enemy projectiles.',
      'Focus on reading bullet patterns from Sprayers and Orbitors.',
      'Close the distance to destroy turret-type enemies faster.',
    ],
  },
  {
    condition: (s) => (s.damageBySource['enemy'] || 0) > (s.damageBySource['bullet'] || 0),
    lines: [
      '⚠ CONTACT DAMAGE DOMINANT',
      'Most hits came from direct enemy contact.',
      'Watch for Drifter swarms and Dasher charges.',
      'Use dash i-frames to escape tight clusters.',
    ],
  },
  {
    condition: () => true,
    lines: [
      '◉ MIXED DAMAGE SOURCES',
      'You took damage from both projectiles and contact.',
      'Balance awareness between both threat types.',
    ],
  },
];

const DODGE_TEMPLATES = [
  {
    condition: (s) => s.dodgeRate > 0.15,
    lines: [
      '⚡ HIGH CLOSE-CALL RATE',
      'You had many near-misses with enemy projectiles.',
      'Either brilliant dodging or playing too dangerously.',
      'Check if you\'re weaving intentionally or panic-moving.',
    ],
  },
  {
    condition: (s) => s.dodgeRate > 0.05,
    lines: [
      '◉ MODERATE DODGING',
      'A healthy number of close calls — you\'re engaging with threats.',
    ],
  },
  {
    condition: () => true,
    lines: [
      '◉ SAFE DISTANCE',
      'You generally kept safe distance from projectiles.',
      'This is efficient play if kill speed stays high.',
    ],
  },
];

const KILL_TEMPLATES = [
  {
    condition: (s) => s.killEfficiency > 3.0,
    lines: [
      '★ KILL MACHINE',
      `${s => s.totalKills} kills at ${s => s.killEfficiency.toFixed(1)}/sec.`,
      'Your DPS output is excellent.',
    ],
  },
  {
    condition: (s) => s.killEfficiency > 1.0,
    lines: [
      '◉ SOLID KILL RATE',
      'Consistent damage output. Room to optimize with better positioning.',
    ],
  },
  {
    condition: () => true,
    lines: [
      '⚠ LOW KILL RATE',
      'Enemy clear time was slow.',
      'Prioritize fire-rate and damage upgrades.',
      'Stay mobile but keep firing toward dense clusters.',
    ],
  },
];

const DIRECTOR_TEMPLATES = [
  {
    condition: (s) => s.directorDecisions.some(d => d.delta > 20),
    lines: [
      '◉ DIRECTOR EASED UP',
      'The AI detected high stress and reduced intensity.',
      'You were struggling — it backed off to keep you in flow.',
    ],
  },
  {
    condition: (s) => s.directorDecisions.some(d => d.delta < -20),
    lines: [
      '◉ DIRECTOR PUSHED HARDER',
      'The AI detected you were breezing through and turned up the heat.',
      'It deployed harder cards and modifiers to challenge you.',
    ],
  },
  {
    condition: () => true,
    lines: [
      '◉ DIRECTOR STAYED BALANCED',
      'The AI found a good rhythm with you.',
      'Stress stayed close to target throughout the run.',
    ],
  },
];

const DRILL_TEMPLATES = [
  {
    condition: (s) => s.predictability > 0.6,
    lines: [
      '🎯 DRILL: RANDOM WALK',
      'Practice moving in random directions every 2 seconds.',
      'Break the habit of pathing in straight lines.',
    ],
  },
  {
    condition: (s) => (s.damageBySource['bullet'] || 0) > 2,
    lines: [
      '🎯 DRILL: BULLET WEAVING',
      'Focus a run on only dodging — ignore kills.',
      'Practice reading Sprayer fan patterns and Orbitor shots.',
    ],
  },
  {
    condition: (s) => s.killEfficiency < 1.5 && s.wavesCleared > 3,
    lines: [
      '🎯 DRILL: FOCUS FIRE',
      'Prioritize killing the closest enemy each second.',
      'Don\'t let enemies accumulate — clear fast, stay aggressive.',
    ],
  },
  {
    condition: (s) => {
      const h = s.hotspot;
      return h.col <= 1 || h.col >= 6 || h.row <= 1 || h.row >= 10;
    },
    lines: [
      '🎯 DRILL: CENTER CONTROL',
      'Practice staying near center and kiting enemies in circles.',
      'Edge play is a trap — you corner yourself.',
    ],
  },
  {
    condition: () => true,
    lines: [
      '🎯 KEEP PRACTICING',
      'No major weaknesses detected.',
      'Try higher difficulty or Adaptive mode for more challenge.',
    ],
  },
];

// ─── Report Generation ───────────────────────────────────────

/**
 * Generate a full coach report from a run summary.
 * @param {object} summary — from telemetry.getRunSummary()
 * @returns {CoachReport}
 */
export function generateCoachReport(summary) {
  const grade = _computeGrade(summary);
  const headline = _computeHeadline(summary, grade);

  return {
    grade,
    headline,
    patterns: {
      title: 'MOVEMENT PATTERNS',
      lines: [
        ..._pickTemplate(PATTERN_TEMPLATES, summary),
        '',
        ..._pickTemplate(HOTSPOT_TEMPLATES, summary),
      ],
    },
    threats: {
      title: 'THREAT ANALYSIS',
      lines: [
        ..._pickTemplate(THREAT_TEMPLATES, summary),
        '',
        ..._pickTemplate(DODGE_TEMPLATES, summary),
        '',
        ..._resolveTextFunctions(
          _pickTemplate(KILL_TEMPLATES, summary),
          summary
        ),
      ],
    },
    director: {
      title: 'DIRECTOR NOTES',
      lines: _generateDirectorNotes(summary),
    },
    drills: {
      title: 'SUGGESTED DRILLS',
      lines: _pickAllDrills(summary),
    },
    stats: {
      runTime: Math.round(summary.runTime),
      wavesCleared: summary.wavesCleared,
      totalKills: summary.totalKills,
      totalDamage: summary.totalDamageTaken,
      killEfficiency: Math.round(summary.killEfficiency * 100) / 100,
      predictability: Math.round(summary.predictability * 100),
      peakEnemies: summary.peakEnemyCount,
    },
  };
}

// ─── Internal Helpers ────────────────────────────────────────

/**
 * Pick the first template whose condition matches.
 * @param {Array} templates
 * @param {object} summary
 * @returns {string[]}
 */
function _pickTemplate(templates, summary) {
  for (const t of templates) {
    if (t.condition(summary)) {
      return t.lines;
    }
  }
  return ['No data.'];
}

/**
 * Pick ALL matching drill templates (up to 3).
 */
function _pickAllDrills(summary) {
  const lines = [];
  let count = 0;
  for (const t of DRILL_TEMPLATES) {
    if (count >= 3) break;
    if (t.condition(summary)) {
      if (count > 0) lines.push('');
      lines.push(...t.lines);
      count++;
    }
  }
  return lines;
}

/**
 * Resolve any function values in template lines.
 */
function _resolveTextFunctions(lines, summary) {
  return lines.map(line => {
    if (typeof line === 'function') return line(summary);
    return line;
  });
}

/**
 * Generate director notes from decision history.
 */
function _generateDirectorNotes(summary) {
  const decisions = summary.directorDecisions;
  if (decisions.length === 0) {
    return ['No adaptive decisions recorded (Classic mode).'];
  }

  const lines = [];
  lines.push(`Total decisions: ${decisions.length} waves`);

  // Summarize stress tracking
  const avgDelta = decisions.reduce((s, d) => s + (d.delta || 0), 0) / decisions.length;
  if (avgDelta > 5) {
    lines.push(`Average stress was ${Math.round(avgDelta)} above target — you were under pressure.`);
  } else if (avgDelta < -5) {
    lines.push(`Average stress was ${Math.round(-avgDelta)} below target — the AI tried to challenge you more.`);
  } else {
    lines.push('Stress stayed close to target — the AI found your flow state.');
  }

  // Notable decisions
  const pushes = decisions.filter(d => (d.delta || 0) < -15);
  const eases = decisions.filter(d => (d.delta || 0) > 15);
  if (pushes.length > 0) {
    lines.push(`The Director pushed harder on ${pushes.length} wave(s).`);
  }
  if (eases.length > 0) {
    lines.push(`The Director eased up on ${eases.length} wave(s).`);
  }

  // Show last rationale if available
  const lastWithRationale = [...decisions].reverse().find(d => d.rationale);
  if (lastWithRationale) {
    lines.push('');
    lines.push('Last decision:');
    lines.push(`"${lastWithRationale.rationale}"`);
  }

  return lines;
}

/**
 * Compute letter grade from run metrics.
 */
function _computeGrade(s) {
  let score = 0;

  // Waves cleared (max 30 points)
  score += Math.min(30, s.wavesCleared * 1);

  // Kill efficiency (max 20 points)
  score += Math.min(20, s.killEfficiency * 8);

  // Low damage (max 20 points)
  score += Math.max(0, 20 - s.totalDamageTaken * 3);

  // Movement variety (max 15 points)
  score += (1 - s.predictability) * 15;

  // Run time bonus (max 15 points)
  score += Math.min(15, s.runTime / 20);

  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B';
  if (score >= 40) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

/**
 * Compute headline text.
 */
function _computeHeadline(s, grade) {
  const headlines = {
    S: 'Flawless execution. The machines fear you.',
    A: 'Excellent run. You read the Director well.',
    B: 'Solid performance. Room to sharpen your edge.',
    C: 'Decent attempt. The Director was testing you.',
    D: 'Rough run. Study the threats. Adapt.',
    F: 'Overwhelmed. Regroup and try again.',
  };
  return headlines[grade] || 'Run complete.';
}

// ─── Export ──────────────────────────────────────────────────

export default { generateCoachReport };
