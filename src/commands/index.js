/**
 * oma index --src <path>
 *
 * Records the path to a reference open-source implementation.
 * Codex will read and analyse the code directly — we just need to know where it is.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { header, section, ok, warn, fail, info, kv, blank } = require('../utils/print');
const { OMA, readJSON } = require('../utils/paths');

async function index({ cwd, srcPath, force = false }) {
  header('oma index — Register Reference Codebase');

  // ── Workspace check ───────────────────────────────────────────────────────
  if (!fs.existsSync(OMA.dir(cwd))) {
    fail('No .oma/ directory found. Run `oma setup` first.');
    process.exit(1);
  }
  if (!srcPath) {
    fail('--src <path> is required. Point to the open-source repository folder.');
    process.exit(1);
  }

  const resolvedSrc = path.resolve(srcPath);
  if (!fs.existsSync(resolvedSrc)) {
    fail(`Source path not found: ${resolvedSrc}`);
    process.exit(1);
  }
  if (!fs.statSync(resolvedSrc).isDirectory()) {
    fail(`--src must be a directory, not a file: ${resolvedSrc}`);
    process.exit(1);
  }

  // ── Already indexed? ──────────────────────────────────────────────────────
  const codebaseDir  = path.join(OMA.dir(cwd), 'codebase');
  const configPath   = path.join(codebaseDir, 'config.json');

  if (!force && fs.existsSync(configPath)) {
    const existing = readJSON(configPath) || {};
    if (existing.srcPath === resolvedSrc) {
      warn('Already registered', resolvedSrc);
      info('Use --force to re-register a different path.');
      return;
    }
  }

  // ── Quick directory snapshot (top-level only — for orientation) ───────────
  section('Registering codebase');
  info('Path', resolvedSrc);

  const topLevel = fs.readdirSync(resolvedSrc, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .map(e => e.isDirectory() ? e.name + '/' : e.name)
    .sort();

  // Detect primary language from top-level file extensions
  const extCount = {};
  topLevel.forEach(name => {
    const ext = path.extname(name).toLowerCase();
    if (ext) extCount[ext] = (extCount[ext] || 0) + 1;
  });
  const primaryExt  = Object.entries(extCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const LANG_MAP = { '.py': 'Python', '.js': 'JavaScript', '.ts': 'TypeScript',
                     '.cpp': 'C++', '.cc': 'C++', '.rs': 'Rust', '.java': 'Java',
                     '.go': 'Go', '.r': 'R', '.m': 'MATLAB', '.cu': 'CUDA' };
  const primaryLang = LANG_MAP[primaryExt] || primaryExt || 'unknown';

  // ── Write config ──────────────────────────────────────────────────────────
  fs.mkdirSync(codebaseDir, { recursive: true });

  const config = {
    srcPath      : resolvedSrc,
    primaryLang,
    topLevel,
    registeredAt : new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  ok('Registered', resolvedSrc);
  kv('Primary language (detected)', primaryLang);
  kv('Top-level entries', topLevel.slice(0, 12).join(', ') + (topLevel.length > 12 ? ' …' : ''));

  blank();
  ok([
    'Reference codebase registered at .oma/codebase/config.json',
    'Codex will read and analyse the source directly during $design and $implement',
    '$implement will use Path A (Adapt) — modifying the existing code to match the design',
  ].join('\n  '));
}

module.exports = { index };
