'use strict';

/**
 * oma go <stage>   — Enter any stage directly, bypassing gate enforcement.
 *                    Writes .oma/standalone.json to signal Standalone Mode.
 *
 * oma go off       — Return to normal (gated) mode.
 * oma go status    — Show current standalone mode state.
 */

const fs   = require('fs');
const path = require('path');
const { OMA, exists, readJSON, nextExpId } = require('../utils/paths');
const { header, section, ok, warn, fail, info, blank, log, kv, color } = require('../utils/print');

const VALID_STAGES = [
  'requirement',
  'design',
  'implement',
  'train',
  'tune',
  'deploy',
  'consolidate',
];

// The four mutually-advisory stages that make up the iteration loop.
const LOOP_STAGES = ['design', 'implement', 'train', 'tune'];

// Context files each stage ideally needs — used to display availability
const STAGE_CONTEXT = {
  requirement: [],
  design: [
    { path: (cwd) => path.join(OMA.dir(cwd), 'knowledge.md'),     label: 'knowledge.md',     critical: true  },
    { path: (cwd) => path.join(OMA.dir(cwd), 'requirements.md'),   label: 'requirements.md',   critical: false },
    { path: (cwd) => path.join(OMA.dir(cwd), 'paper', 'raw-sections.json'), label: 'paper/raw-sections.json', critical: false },
    { path: (cwd) => path.join(OMA.dir(cwd), 'codebase', 'config.json'),    label: 'codebase/config.json',    critical: false },
    { path: (cwd) => OMA.memory(cwd),                              label: 'memory.md',         critical: false },
  ],
  implement: [
    { path: (cwd) => path.join(OMA.dir(cwd), 'requirements.md'),  label: 'requirements.md',  critical: false },
    { path: (cwd) => path.join(OMA.dir(cwd), 'designs'),          label: 'designs/*.md',      critical: true  },
    { path: (cwd) => path.join(OMA.dir(cwd), 'codebase', 'config.json'), label: 'codebase/ (Path A)', critical: false },
  ],
  train: [
    { path: (cwd) => path.join(OMA.dir(cwd), 'impl', 'github.json'),       label: 'impl/github.json',  critical: true  },
    { path: (cwd) => path.join(OMA.dir(cwd), 'config.json'),               label: 'config.json',        critical: true  },
    { path: (cwd) => path.join(OMA.dir(cwd), 'requirements.md'),           label: 'requirements.md',   critical: false },
    { path: (cwd) => path.join(OMA.dir(cwd), 'designs'),                   label: 'designs/*.md',       critical: false },
    { path: (cwd) => OMA.memory(cwd),                                       label: 'memory.md',          critical: false },
  ],
  tune: [
    { path: (cwd) => OMA.leaderboard(cwd),                                  label: 'leaderboard.json',   critical: false },
    { path: (cwd) => path.join(OMA.experiments(cwd)),                       label: 'experiments/',        critical: false },
    { path: (cwd) => path.join(OMA.dir(cwd), 'impl', 'github.json'),       label: 'impl/github.json',   critical: true  },
    { path: (cwd) => path.join(OMA.dir(cwd), 'config.json'),               label: 'config.json',         critical: true  },
    { path: (cwd) => OMA.memory(cwd),                                       label: 'memory.md',           critical: false },
  ],
  deploy: [
    { path: (cwd) => OMA.best(cwd),                                          label: 'best.json',           critical: true  },
    { path: (cwd) => path.join(OMA.dir(cwd), 'requirements.md'),            label: 'requirements.md',    critical: false },
    { path: (cwd) => path.join(OMA.dir(cwd), 'designs'),                    label: 'designs/*.md',        critical: false },
    { path: (cwd) => path.join(cwd, 'templates', 'deploy-config.json'),     label: 'deploy-config.json',  critical: false },
  ],
  consolidate: [
    { path: (cwd) => OMA.best(cwd),                                          label: 'best.json',           critical: false },
    { path: (cwd) => OMA.leaderboard(cwd),                                   label: 'leaderboard.json',    critical: false },
    { path: (cwd) => OMA.trajectory(cwd),                                    label: 'trajectory.jsonl',    critical: false },
  ],
};

// Stage → skill name for display
const STAGE_SKILL = {
  requirement : '$requirement',
  design      : '$design',
  implement   : '$implement',
  train       : '$train',
  tune        : '$tune',
  deploy      : '$deploy',
  consolidate : '$consolidate',
};

async function go({ cwd = process.cwd(), stage, reason = '', startStage } = {}) {
  const standalonePath = path.join(OMA.dir(cwd), 'standalone.json');

  // ── oma go off ─────────────────────────────────────────────────────────────
  if (stage === 'off' || stage === 'disable' || stage === 'normal') {
    if (exists(standalonePath)) {
      fs.unlinkSync(standalonePath);
      header('oma go — Standalone Mode disabled');
      ok('Standalone mode', 'OFF — gate chain is now active');
      blank();
      log(`  ${color.gray('Run')} ${color.cyan('oma doctor')} ${color.gray('to check gate status.')}`);
    } else {
      info('Standalone mode', 'Was not active');
    }
    blank();
    return;
  }

  // ── oma go status ──────────────────────────────────────────────────────────
  if (stage === 'status' || stage === undefined) {
    header('oma go — Standalone Mode Status');
    if (exists(standalonePath)) {
      const s = readJSON(standalonePath) || {};
      ok('Standalone mode', color.yellow('ACTIVE'));
      kv('  Stage', s.stage || '?');
      kv('  Entered', s.enteredAt ? s.enteredAt.slice(0, 19).replace('T', ' ') : '?');
      if (s.reason) kv('  Reason', s.reason);
      blank();
      log(`  ${color.gray('To disable:')} ${color.cyan('oma go off')}`);
    } else {
      ok('Standalone mode', 'OFF (normal gated mode)');
      blank();
      log(`  ${color.gray('To enter standalone mode:')} ${color.cyan('oma go <stage>')}`);
      blank();
      log(`  ${color.gray('Available stages:')} ${VALID_STAGES.join(', ')}`);
    }
    blank();
    return;
  }

  // ── oma go loop ────────────────────────────────────────────────────────────
  // Enter the iteration loop directly, WITHOUT a prior $requirement. Waives the
  // requirements-locked (enter-loop) hard gate, sets up the loop pointer, and
  // hands you the cycle — not a single isolated stage.
  if (stage === 'loop') {
    if (!exists(OMA.dir(cwd))) {
      fail('.oma/ not found', 'Run `oma setup` first to initialize the workspace');
      blank();
      process.exit(1);
    }
    const start = LOOP_STAGES.includes(startStage) ? startStage : 'design';

    // 1. standalone.json — waive the requirement (enter-loop) hard gate.
    fs.writeFileSync(standalonePath, JSON.stringify({
      stage     : 'loop',
      skill     : STAGE_SKILL[start],
      mode      : 'loop',
      enteredAt : new Date().toISOString(),
      reason    : reason || 'entered iteration loop without $requirement (oma go loop)',
    }, null, 2));

    // 2. loop.json — create lap 1 if absent, else resume the existing loop.
    const loopPath = path.join(OMA.dir(cwd), 'loop.json');
    const now = new Date().toISOString();
    let loop, resumed = false;
    if (exists(loopPath)) {
      loop = readJSON(loopPath) || {};
      loop.stage = start;
      loop.updated_at = now;
      resumed = true;
    } else {
      loop = { lap: 1, stage: start, exp_id: nextExpId(cwd), hypothesis: reason || null, opened_at: now, updated_at: now };
    }
    fs.writeFileSync(loopPath, JSON.stringify(loop, null, 2) + '\n');

    header('oma go loop — Entering Iteration Loop (Standalone Mode)');
    blank();
    log(`  ${color.yellow('⚠️  STANDALONE MODE')} — the ${color.bold('$requirement')} hard gate is ${color.bold('waived')}.`);
    log(`  You are in the loop: ${color.cyan('$design ↔ $implement ↔ $train ↔ $tune')} — all advisory.`);
    log(`  ${color.gray('The deploy gate (best.json deployGateOpen) still applies to exit the loop.')}`);
    blank();

    section('Loop');
    kv('Lap',   `#${loop.lap}${resumed ? color.gray('  (resumed)') : ''}`);
    kv('Stage', color.cyan(loop.stage));
    kv('Exp',   loop.exp_id);
    if (loop.hypothesis) kv('Hypothesis', loop.hypothesis);

    section('Minimal Seed  (asked by the skill on entry — not blocking)');
    const cfg = readJSON(path.join(OMA.dir(cwd), 'config.json')) || {};
    const metricDir = cfg.metric_higher_is_better === false ? 'lower-is-better'
                    : cfg.metric_higher_is_better === true  ? 'higher-is-better' : '—';
    kv('Primary metric direction', `${metricDir}${color.gray('  (config.json metric_higher_is_better)')}`);
    log(`  ${color.gray('The skill will confirm: primary metric, its direction, and robot/sim target')}`);
    log(`  ${color.gray('(robot, sim_env, control_hz). Provide inline — no full $requirement needed.')}`);

    blank();
    section('Next Step');
    log(`  Open a session and run: ${color.bold(color.cyan(STAGE_SKILL[start]))}`);
    log(`  ${color.gray('To leave the loop / return to gated mode:')} ${color.cyan('oma go off')} ${color.gray('(keeps loop.json)')}`);
    blank();
    return;
  }

  // ── Validate stage ─────────────────────────────────────────────────────────
  if (!VALID_STAGES.includes(stage)) {
    fail('Unknown stage', `"${stage}" is not a valid OMA stage`);
    blank();
    log(`  Valid stages: ${color.cyan(VALID_STAGES.join(', '))}`);
    blank();
    process.exit(1);
  }

  // ── Ensure .oma/ exists ───────────────────────────────────────────────────
  if (!exists(OMA.dir(cwd))) {
    fail('.oma/ not found', 'Run `oma setup` first to initialize the workspace');
    blank();
    process.exit(1);
  }

  // ── Write standalone.json ─────────────────────────────────────────────────
  const payload = {
    stage,
    skill     : STAGE_SKILL[stage],
    enteredAt : new Date().toISOString(),
    reason    : reason || `direct entry via oma go ${stage}`,
  };
  fs.writeFileSync(standalonePath, JSON.stringify(payload, null, 2));

  // ── Display context availability ──────────────────────────────────────────
  header(`oma go — Entering ${STAGE_SKILL[stage]} (Standalone Mode)`);
  blank();
  log(`  ${color.yellow('⚠️  STANDALONE MODE')} — gate chain is ${color.bold('advisory only')}.`);
  log(`  You can start ${color.cyan(STAGE_SKILL[stage])} regardless of prior stage completion.`);
  blank();

  const contextItems = STAGE_CONTEXT[stage] || [];
  if (contextItems.length) {
    section('Context Availability');
    let missingCritical = [];
    for (const item of contextItems) {
      const p    = item.path(cwd);
      const avail = exists(p);
      const tag   = item.critical ? color.red('[critical]') : color.gray('[optional]');
      if (avail) {
        ok(item.label, 'Found');
      } else if (item.critical) {
        fail(item.label, `Missing ${tag} — ${STAGE_SKILL[stage]} will ask you to provide this inline`);
        missingCritical.push(item.label);
      } else {
        warn(item.label, `Missing ${tag} — will work without it`);
      }
    }

    if (missingCritical.length) {
      blank();
      log(`  ${color.yellow('Missing critical context:')} ${missingCritical.join(', ')}`);
      log(`  ${color.gray('Codex will ask for the minimum needed info at the start of the skill.')}`);
    }
  }

  blank();
  section('Next Step');
  log(`  Open a Codex session and run: ${color.bold(color.cyan(STAGE_SKILL[stage]))}`);
  blank();
  log(`  ${color.gray('Codex will see')} ${color.cyan('.oma/standalone.json')} ${color.gray('and enter advisory mode.')}`);
  log(`  ${color.gray('To return to gated mode: ')} ${color.cyan('oma go off')}`);
  blank();
}

module.exports = { go };
