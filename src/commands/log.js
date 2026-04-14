'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, exists, readJSON } = require('../utils/paths');
const { header, section, blank, log, info, table, color } = require('../utils/print');

async function logCmd({ cwd = process.cwd(), tail = 20, phase = null, verbose = false } = {}) {
  header('oma log — Experiment Trajectory');

  const trajPath = OMA.trajectory(cwd);
  if (!exists(trajPath)) {
    info('No trajectory yet', 'trajectory.jsonl appears after the first $train run');
    blank();
    return;
  }

  const allLines = fs.readFileSync(trajPath, 'utf8').split('\n').filter(Boolean);
  const parsed   = allLines.map((line, i) => {
    try { return { ok: true, i, entry: JSON.parse(line) }; }
    catch { return { ok: false, i, raw: line }; }
  });

  const filtered = phase
    ? parsed.filter((r) => r.ok && r.entry.phase === phase)
    : parsed;

  const shown = filtered.slice(-tail).reverse();

  if (!shown.length) {
    info('No matching experiments', phase ? `phase filter: ${phase}` : '');
    blank();
    return;
  }

  // ── Table view ─────────────────────────────────────────────────────────────
  section(`Showing ${shown.length} of ${filtered.length} entries (most recent first)`);
  blank();

  const rows = [
    ['timestamp', 'exp-id', 'phase', 'metric (mean)', '± std', 'Δ baseline', 'status'],
  ];

  for (const { ok: isOk, entry, raw } of shown) {
    if (!isOk) {
      rows.push([color.red('parse error'), '', '', raw?.slice(0, 30) ?? '', '', '', '']);
      continue;
    }

    const ts     = (entry.timestamp || '').slice(0, 16).replace('T', ' ');
    const expId  = entry.exp_id || '?';
    const ph     = phaseColor(entry.phase);
    const mean   = entry.metric_mean  != null ? entry.metric_mean.toFixed(4)  : color.gray('—');
    const std    = entry.metric_std   != null ? entry.metric_std.toFixed(4)   : color.gray('—');
    const delta  = formatDelta(entry.delta_vs_baseline);
    const status = statusChip(entry.status);

    rows.push([color.gray(ts), expId, ph, mean, std, delta, status]);
  }

  table(rows);

  // ── Verbose: print full JSON for each entry ────────────────────────────────
  if (verbose) {
    section('Full entries');
    for (const { ok: isOk, entry, raw } of shown) {
      blank();
      if (isOk) {
        log('  ' + JSON.stringify(entry, null, 2).split('\n').join('\n  '));
      } else {
        log(color.red('  MALFORMED: ') + raw);
      }
    }
  }

  // ── Summary statistics ────────────────────────────────────────────────────
  section('Summary');
  const completed = parsed.filter((r) => r.ok && r.entry.status === 'completed');
  const failed    = parsed.filter((r) => r.ok && r.entry.status === 'failed');
  const byPhase   = {};
  for (const { ok: isOk, entry } of parsed) {
    if (isOk) byPhase[entry.phase] = (byPhase[entry.phase] || 0) + 1;
  }

  info(`Total experiments: ${color.bold(String(parsed.length))}  (${color.green(String(completed.length))} completed, ${color.red(String(failed.length))} failed)`);
  for (const [ph, cnt] of Object.entries(byPhase)) {
    info(`  ${phaseColor(ph)}: ${cnt}`);
  }

  // Best result across all trajectory entries
  const bestEntry = completed
    .filter((r) => r.entry.metric_mean != null)
    .sort((a, b) => b.entry.metric_mean - a.entry.metric_mean)[0];
  if (bestEntry) {
    info(
      `Best (trajectory): ${color.green(bestEntry.entry.metric_mean.toFixed(4))}`,
      `${bestEntry.entry.metric_name || ''} — ${bestEntry.entry.exp_id}`
    );
  }

  blank();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function phaseColor(phase) {
  const map = {
    train:    color.blue('train'),
    tune:     color.magenta('tune'),
    evaluate: color.cyan('evaluate'),
  };
  return map[phase] || color.gray(phase || '?');
}

function statusChip(status) {
  if (status === 'completed') return color.green('✓');
  if (status === 'failed')    return color.red('✗');
  return color.gray(status || '?');
}

function formatDelta(raw) {
  if (raw == null) return color.gray('—');
  const s = String(raw);
  if (s.startsWith('+')) return color.green(s);
  if (s.startsWith('-')) return color.red(s);
  return s;
}

module.exports = { logCmd };
