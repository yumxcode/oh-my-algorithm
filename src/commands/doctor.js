'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, exists, readJSON, readText } = require('../utils/paths');
const { header, section, ok, warn, fail, info, blank, log, kv, color } = require('../utils/print');

// Each gate: { label, check(cwd) → { pass, detail } }
const GATES = [
  {
    skill: '$requirement',
    artifact: '.oma/requirements.md',
    check: (cwd) => {
      const p = OMA.requirements(cwd);
      if (!exists(p)) return { pass: false, detail: 'File missing — run $requirement to create it' };
      const text = readText(p);
      if (text && text.includes('{PROJECT_NAME}')) {
        return { pass: false, detail: 'Template not filled in — run $requirement' };
      }
      return { pass: true, detail: 'Exists' };
    },
  },
  {
    skill: '$design',
    artifact: '.oma/designs/',
    check: (cwd) => {
      const dir = OMA.designs(cwd);
      if (!exists(dir)) return { pass: false, detail: 'designs/ directory missing' };
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      if (!files.length) return { pass: false, detail: 'No design document found — run $design' };
      return { pass: true, detail: `${files.length} design doc(s): ${files.join(', ')}` };
    },
  },
  {
    skill: '$implement',
    artifact: '.oma/impl/impl-checklist.md + github.json',
    check: (cwd) => {
      const checklistPath = OMA.implChecklist(cwd);
      const githubPath    = path.join(OMA.impl(cwd), 'github.json');

      if (!exists(checklistPath)) return { pass: false, detail: 'impl-checklist.md missing — run $implement' };

      const text      = readText(checklistPath);
      const unchecked = (text.match(/- \[ \]/g) || []).length;
      const checked   = (text.match(/- \[x\]/gi) || []).length;
      if (unchecked > 0) {
        return { pass: false, detail: `Checklist: ${unchecked} unchecked item(s), ${checked} done` };
      }

      if (!exists(githubPath)) {
        return { pass: false, detail: 'Code not yet pushed — run GitHub push step in $implement' };
      }
      const gh = readJSON(githubPath) || {};
      if (!gh.commitHash) {
        return { pass: false, detail: 'github.json exists but commitHash is missing' };
      }
      return { pass: true, detail: `All ${checked} items ✓ | pushed ${gh.commitHash.slice(0,7)} @ ${gh.branch}` };
    },
  },
  {
    skill: '$train',
    artifact: '.oma/experiments/ (≥1 train run)',
    check: (cwd) => {
      const expDir = OMA.experiments(cwd);
      if (!exists(expDir)) return { pass: false, detail: 'experiments/ directory missing' };
      const trainRuns = findExperimentsByPhase(expDir, 'train');
      if (!trainRuns.length) return { pass: false, detail: 'No train experiments found — run $train' };
      return { pass: true, detail: `${trainRuns.length} train run(s) found` };
    },
  },
  {
    skill: '$tune',
    artifact: '.oma/leaderboard.json + best.json',
    check: (cwd) => {
      const lbPath   = OMA.leaderboard(cwd);
      const bestPath = OMA.best(cwd);

      // Phase A: has any sweep run happened?
      if (!exists(lbPath)) {
        return { pass: false, detail: 'leaderboard.json missing — run $tune to start sweep' };
      }
      const lb = readJSON(lbPath);
      if (!lb || !lb.entries || !lb.entries.length) {
        return { pass: false, detail: 'Leaderboard empty — $tune sweep not yet started' };
      }

      // Phase B: has final evaluation (test set) completed?
      if (!exists(bestPath)) {
        return {
          pass: false,
          detail: `Sweep in progress (${lb.entries.length} configs) — final evaluation not yet run (Phase 5 of $tune)`,
        };
      }
      const best = readJSON(bestPath);
      if (!best) return { pass: false, detail: 'best.json malformed' };

      const metricName = best.primaryMetric?.name ?? best.primary_metric?.name ?? '?';
      const metricMean = (best.primaryMetric?.mean ?? best.primary_metric?.mean)?.toFixed(4) ?? '?';
      const gateOpen   = best.deployGateOpen ?? best.deploy_gate_open;
      const gateLabel  = gateOpen ? color.green('deploy gate open') : color.red('deploy gate closed');

      return {
        pass  : gateOpen === true,
        detail: `${lb.entries.length} configs swept | test ${metricName}: ${metricMean} | ${gateLabel}`,
      };
    },
  },
  {
    skill: '$deploy',
    artifact: 'deploy/deploy-checklist.md',
    check: (cwd) => {
      // Pre-check: deploy gate must be open in best.json
      const bestPath = OMA.best(cwd);
      if (exists(bestPath)) {
        const best    = readJSON(bestPath) || {};
        const gateOpen = best.deployGateOpen ?? best.deploy_gate_open;
        if (gateOpen === false) {
          return { pass: false, detail: 'Deploy gate closed — test thresholds not met (see best.json)' };
        }
      }
      const p = path.join(cwd, 'deploy', 'deploy-checklist.md');
      if (!exists(p)) return { pass: false, detail: 'Not yet deployed — run $deploy' };
      const text      = readText(p);
      const unchecked = (text.match(/- \[ \]/g) || []).length;
      if (unchecked > 0) return { pass: false, detail: `${unchecked} deployment checklist item(s) incomplete` };
      return { pass: true, detail: 'Deployment checklist complete' };
    },
  },
];

async function doctor({ cwd = process.cwd() } = {}) {
  header('oma doctor — Gate Chain Status');

  // ── 1. Check .oma/ exists ─────────────────────────────────────────────────
  section('Workspace');
  if (!exists(OMA.dir(cwd))) {
    fail('.oma/ directory', 'Not found — run `oma setup` first');
    blank();
    return;
  }
  ok('.oma/', 'Found');

  // ── Standalone mode check ─────────────────────────────────────────────────
  const standalonePath = path.join(OMA.dir(cwd), 'standalone.json');
  if (exists(standalonePath)) {
    const s = readJSON(standalonePath) || {};
    warn(
      'Standalone mode',
      `ACTIVE — entered ${s.skill || s.stage || '?'} at ${(s.enteredAt || '').slice(0, 19).replace('T', ' ')} | gates are advisory`
    );
    log(color.gray(`    Reason: ${s.reason || 'not specified'}  |  Run 'oma go off' to return to gated mode.`));
    blank();
  }

  if (exists(OMA.memory(cwd))) {
    ok('.oma/memory.md', 'Found (Dead Ends database active)');
  } else {
    warn('.oma/memory.md', 'Missing — will be created by $consolidate after first tune/evaluate');
  }

  // ── 2. Paper extraction status ───────────────────────────────────────────
  section('Paper Extraction (.oma/paper/)');
  const paperDir      = path.join(OMA.dir(cwd), 'paper');
  const paperSections = path.join(paperDir, 'raw-sections.json');
  const paperMeta     = path.join(paperDir, 'meta.json');
  const knowledgePath = path.join(OMA.dir(cwd), 'knowledge.md');

  if (exists(paperSections)) {
    const meta = readJSON(paperMeta) || {};
    ok('raw-sections.json', 'Paper extracted');
    if (meta.title) kv('  Paper', meta.title.slice(0, 70));
    if (meta.year)  kv('  Year',  meta.year);
    if (meta.venue) kv('  Venue', meta.venue);

    const secs = readJSON(paperSections) || {};
    const found = Object.keys(secs).filter(
      (k) => k !== '_full' && typeof secs[k] === 'string' && secs[k].length > 100
    );
    kv('  Sections', found.join(', ') || 'none');
  } else {
    warn('No paper extracted yet', 'Run `oma extract --paper path.pdf` before $requirement');
    info('  Sections will need to be provided manually during the interview');
  }

  if (exists(knowledgePath)) {
    const kText = readText(knowledgePath) || '';
    const locked = kText.includes('Status: LOCKED');
    if (locked) {
      ok('knowledge.md', 'LOCKED — literature context active');
    } else {
      warn('knowledge.md', 'Exists but not yet locked (in-progress $requirement)');
    }
  } else {
    info('knowledge.md', 'Not yet created — will be produced by $requirement');
  }

  // ── 3. Codebase status ───────────────────────────────────────────────────
  section('Reference Codebase (.oma/codebase/)');
  const codebaseDir    = path.join(OMA.dir(cwd), 'codebase');
  const codebaseConfig = path.join(codebaseDir, 'config.json');

  if (exists(codebaseConfig)) {
    const cbCfg = readJSON(codebaseConfig) || {};
    ok('Registered', 'Path A (Adapt) implement enabled');
    kv('  Source', cbCfg.srcPath || '?');
    kv('  Primary language', cbCfg.primaryLang || '?');
    if (cbCfg.registeredAt) kv('  Registered', cbCfg.registeredAt.slice(0, 10));
  } else {
    info('No codebase registered', 'Run `oma index --src <repo-path>` to enable Path A implement');
    info('  Without this, $implement will use Path B (from scratch)');
  }

  // ── 4. Gate chain ─────────────────────────────────────────────────────────
  section('Gate Chain');
  blank();

  let firstBlocked = null;
  for (const gate of GATES) {
    const { pass, detail } = gate.check(cwd);
    if (pass) {
      ok(`${gate.skill}  →  ${gate.artifact}`, detail);
    } else {
      fail(`${gate.skill}  →  ${gate.artifact}`, detail);
      if (!firstBlocked) firstBlocked = gate;
    }
  }

  // ── 5. Trajectory summary ─────────────────────────────────────────────────
  section('Experiment Trajectory');
  const traj = OMA.trajectory(cwd);
  if (exists(traj)) {
    const lines = fs.readFileSync(traj, 'utf8').split('\n').filter(Boolean);
    info('Total recorded runs', String(lines.length));

    const phases = {};
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        phases[e.phase] = (phases[e.phase] || 0) + 1;
      } catch { /* skip malformed lines */ }
    }
    for (const [phase, count] of Object.entries(phases)) {
      info(`  ${phase}`, String(count));
    }
  } else {
    info('No trajectory yet', 'trajectory.jsonl does not exist');
  }

  // ── 6. Budget tracker from config ─────────────────────────────────────────
  section('Budget');
  const configPath = require('path').join(OMA.dir(cwd), 'config.json');
  if (exists(configPath)) {
    const cfg = readJSON(configPath);
    if (cfg) {
      kv('Project', cfg.project_name);
      kv('Seeds per config', cfg.seeds_per_config);
    }
  }

  // ── 7. Verdict ────────────────────────────────────────────────────────────
  blank();
  if (exists(standalonePath)) {
    const s = readJSON(standalonePath) || {};
    log(color.yellow(`  ⚠️  Standalone mode active — targeting ${color.bold(s.skill || s.stage || '?')}.`));
    if (firstBlocked) {
      log(color.gray(`  Blocked gates above are advisory only. Proceed with ${color.bold(s.skill || s.stage || '?')}.`));
    } else {
      log(color.green('  All gates open.'));
    }
  } else if (firstBlocked) {
    log(color.yellow(`  Next action: run ${color.bold(firstBlocked.skill)} to advance the gate chain.`));
    log(color.gray(`  Or run ${color.cyan(`oma go ${firstBlocked.skill.replace('$', '')}`)} to enter it directly (bypass gate).`));
  } else {
    log(color.green('  All gates open. Ready for deployment.'));
  }
  blank();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findExperimentsByPhase(expDir, phase) {
  try {
    return fs.readdirSync(expDir)
      .filter((d) => {
        const resultsPath = require('path').join(expDir, d, 'results.json');
        if (!exists(resultsPath)) return false;
        const r = readJSON(resultsPath);
        return r && r.phase === phase;
      });
  } catch {
    return [];
  }
}

module.exports = { doctor };
