'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, exists, readJSON, readText } = require('../utils/paths');
const { header, section, ok, warn, info, blank, log, kv, table, color } = require('../utils/print');

async function status({ cwd = process.cwd() } = {}) {
  header('oma status');

  if (!exists(OMA.dir(cwd))) {
    log(color.red('  .oma/ not found. Run `oma setup` first.'));
    blank();
    return;
  }

  // ── 1. Current Phase ──────────────────────────────────────────────────────
  section('Current Phase');
  const phase = inferPhase(cwd);
  log(`  ${color.bold(color.cyan(phase.current))}  ${color.gray('→')}  ${color.gray(phase.next)}`);

  // ── 2. Best Result ────────────────────────────────────────────────────────
  section('Best Result');
  const bestPath = OMA.best(cwd);
  if (exists(bestPath)) {
    const best = readJSON(bestPath);
    if (best) {
      const gateStr = best.deploy_gate_open
        ? color.green('deploy gate OPEN')
        : color.red('deploy gate closed');

      kv('Experiment',    best.exp_id);
      kv('Metric',        `${best.primary_metric?.name}: ${color.green(best.primary_metric?.mean?.toFixed(4) ?? '?')} ± ${best.primary_metric?.std?.toFixed(4) ?? '?'}`);
      kv('Status',        gateStr);
      kv('Evaluated at',  best.evaluated_at ? best.evaluated_at.slice(0, 16).replace('T', ' ') : '—');
    }
  } else {
    info('No evaluation run yet', 'run $evaluate to populate best.json');
  }

  // ── 3. Leaderboard (top 8) ────────────────────────────────────────────────
  section('Leaderboard');
  const lbPath = OMA.leaderboard(cwd);
  if (exists(lbPath)) {
    const lb = readJSON(lbPath);
    if (lb && lb.entries && lb.entries.length) {
      const higherBetter = lb.higher_is_better !== false;
      const metric = lb.metric_name || '?';
      const entries = lb.entries.slice(0, 8);

      const rows = [
        ['#', 'exp-id', `${metric} (mean)`, '± std', 'phase', 'config'],
      ];
      entries.forEach((e, i) => {
        const rank   = String(i + 1);
        const mean   = typeof e.metric_mean === 'number' ? e.metric_mean.toFixed(4) : '?';
        const std    = typeof e.metric_std  === 'number' ? e.metric_std.toFixed(4)  : '?';
        const isBest = i === 0;
        rows.push([
          isBest ? color.green(rank) : color.gray(rank),
          isBest ? color.green(e.exp_id) : e.exp_id,
          isBest ? color.green(mean) : mean,
          std,
          color.gray(e.phase || '?'),
          color.gray((e.config_summary || '').slice(0, 30)),
        ]);
      });
      table(rows);
      if (lb.entries.length > 8) {
        info(`  …and ${lb.entries.length - 8} more entries`);
      }
    } else {
      info('Leaderboard empty');
    }
  } else {
    info('No leaderboard yet', 'appears after first $train');
  }

  // ── 4. Memory snapshot ────────────────────────────────────────────────────
  section('Memory Snapshot');
  const memPath = OMA.memory(cwd);
  if (exists(memPath)) {
    const text = readText(memPath);
    const deadEnds      = countTableRows(text, 'Dead Ends');
    const workingPat    = countTableRows(text, 'Working Patterns');
    const openHyp       = countTableRows(text, 'Open Hypotheses');
    kv('Dead Ends',        String(deadEnds));
    kv('Working Patterns', String(workingPat));
    kv('Open Hypotheses',  String(openHyp));

    // Extract budget from memory.md table if present
    const budgetMatch = text.match(/Remaining\s*\|\s*([^\n|]+)/);
    if (budgetMatch) kv('Budget Remaining', budgetMatch[1].trim());
  } else {
    info('memory.md not yet created', 'appears after first $consolidate');
  }

  // ── 5. Recent trajectory ──────────────────────────────────────────────────
  section('Recent Experiments');
  const trajPath = OMA.trajectory(cwd);
  if (exists(trajPath)) {
    const lines = fs.readFileSync(trajPath, 'utf8').split('\n').filter(Boolean);
    const recent = lines.slice(-5).reverse();

    if (recent.length) {
      const rows = [['exp-id', 'phase', 'metric (mean)', 'status', 'timestamp']];
      for (const line of recent) {
        try {
          const e = JSON.parse(line);
          rows.push([
            e.exp_id   || '?',
            color.gray(e.phase || '?'),
            e.metric_mean != null ? String(e.metric_mean.toFixed(4)) : '?',
            statusIcon(e.status),
            color.gray((e.timestamp || '').slice(0, 16).replace('T', ' ')),
          ]);
        } catch { /* skip */ }
      }
      table(rows);
    }
  } else {
    info('No experiments yet');
  }

  blank();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferPhase(cwd) {
  if (!exists(OMA.requirements(cwd)))
    return { current: 'pre-requirement', next: 'run $requirement to begin' };

  const designs = exists(OMA.designs(cwd))
    ? fs.readdirSync(OMA.designs(cwd)).filter((f) => f.endsWith('.md'))
    : [];
  if (!designs.length)
    return { current: 'requirement ✓', next: 'run $design' };

  if (!exists(OMA.implChecklist(cwd)))
    return { current: 'design ✓', next: 'run $implement' };

  const text      = readText(OMA.implChecklist(cwd)) || '';
  const unchecked = (text.match(/- \[ \]/g) || []).length;
  if (unchecked > 0)
    return { current: 'implement (in progress)', next: `${unchecked} checklist item(s) remaining` };

  if (!exists(OMA.leaderboard(cwd)))
    return { current: 'implement ✓', next: 'run $train' };

  const lb = readJSON(OMA.leaderboard(cwd));
  const hasTune = lb?.entries?.some((e) => e.phase === 'tune');
  if (!hasTune)
    return { current: 'train ✓', next: 'run $tune to improve' };

  if (!exists(OMA.best(cwd)))
    return { current: 'tune ✓', next: 'run $evaluate' };

  const best = readJSON(OMA.best(cwd));
  if (!best?.deploy_gate_open)
    return { current: 'evaluate ✓ (gate closed)', next: 'thresholds not met — continue $tune or revisit $design' };

  if (!exists(require('path').join(cwd, 'deploy', 'deploy-checklist.md')))
    return { current: 'evaluate ✓ (gate OPEN)', next: 'run $deploy' };

  return { current: 'deployed ✓', next: 'done' };
}

function countTableRows(text, sectionTitle) {
  // Find the section, count non-header, non-separator, non-empty table rows
  const re = new RegExp(`## ${sectionTitle}[\\s\\S]*?(?=## |$)`);
  const match = text.match(re);
  if (!match) return 0;
  const rows = match[0]
    .split('\n')
    .filter((l) => l.startsWith('|') && !l.includes('---') && !l.match(/^\|\s*(Direction|Pattern|Hypothesis|Item|\#)/));
  // Subtract empty/placeholder rows
  return rows.filter((l) => !l.includes('_(empty')).length;
}

function statusIcon(status) {
  if (!status) return color.gray('?');
  if (status === 'completed') return color.green('✓ completed');
  if (status === 'failed')    return color.red('✗ failed');
  return color.yellow(status);
}

module.exports = { status };
