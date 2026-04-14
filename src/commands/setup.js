'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, templatePath, exists } = require('../utils/paths');
const { header, section, ok, warn, info, blank, log, color } = require('../utils/print');

const DIRS_TO_CREATE = [
  (cwd) => OMA.dir(cwd),
  (cwd) => OMA.designs(cwd),
  (cwd) => OMA.impl(cwd),
  (cwd) => OMA.experiments(cwd),
  (cwd) => path.join(OMA.dir(cwd), 'paper'),
];

const TEMPLATES = [
  { src: 'requirements.md', dest: (cwd) => OMA.requirements(cwd),                              label: '.oma/requirements.md' },
  { src: 'memory.md',       dest: (cwd) => OMA.memory(cwd),                                    label: '.oma/memory.md'       },
  { src: 'knowledge.md',    dest: (cwd) => path.join(OMA.dir(cwd), 'knowledge.md'),             label: '.oma/knowledge.md'    },
];

async function setup({ cwd = process.cwd(), force = false } = {}) {
  header('oma setup — oh-my-algorithm');
  blank();

  // ── 1. Create .oma/ directory tree ──────────────────────────────────────
  section('Creating .oma/ directory structure');

  for (const mkDir of DIRS_TO_CREATE) {
    const p = mkDir(cwd);
    const rel = path.relative(cwd, p);
    if (exists(p)) {
      warn(rel, 'already exists, skipped');
    } else {
      fs.mkdirSync(p, { recursive: true });
      ok(rel, 'created');
    }
  }

  // ── 2. Copy templates ────────────────────────────────────────────────────
  section('Initializing state templates');

  for (const { src, dest, label } of TEMPLATES) {
    const destPath = dest(cwd);
    const srcPath  = templatePath(src);

    if (exists(destPath) && !force) {
      warn(label, 'already exists, skipped  (use --force to overwrite)');
      continue;
    }

    if (!exists(srcPath)) {
      // Fallback: write minimal stubs if templates not found (e.g. global install)
      writeStub(destPath, src);
      ok(label, 'created (stub)');
    } else {
      fs.copyFileSync(srcPath, destPath);
      ok(label, 'created from template');
    }
  }

  // ── 3. Write .oma/config.json ────────────────────────────────────────────
  const configPath = path.join(OMA.dir(cwd), 'config.json');
  if (!exists(configPath) || force) {
    const config = {
      schema_version     : '1.0',
      created_at         : new Date().toISOString(),
      project_name       : path.basename(cwd),
      seeds_per_config   : 3,
      metric_higher_is_better: true,
      // Gradmotion training platform — fill in before running $train
      // Run: gm project list / gm task resource list / gm task image official
      gradmotion: {
        projectId    : null,   // e.g. "proj_xxx"
        goodsId      : null,   // e.g. "goods_xxx"  (use goodsId from resource list, NOT goodsBackId)
        imageId      : null,   // e.g. "BJX00000001"
        imageVersion : null,   // e.g. "V000057"  (use `id` field from image versions, NOT versionCode)
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    ok('.oma/config.json', 'created');
  } else {
    warn('.oma/config.json', 'already exists, skipped');
  }

  // ── 4. Write .gitignore entry ────────────────────────────────────────────
  const gitignorePath = path.join(cwd, '.gitignore');
  const omaIgnoreEntry = '\n# oh-my-algorithm state\n.oma/experiments/\n.oma/leaderboard.json\n.oma/best.json\n.oma/trajectory.jsonl\n';

  if (exists(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    if (!existing.includes('.oma/experiments/')) {
      fs.appendFileSync(gitignorePath, omaIgnoreEntry);
      ok('.gitignore', 'appended .oma experiment entries');
    } else {
      warn('.gitignore', 'already has .oma entries, skipped');
    }
  } else {
    fs.writeFileSync(gitignorePath, omaIgnoreEntry.trimStart());
    ok('.gitignore', 'created with .oma experiment entries');
  }

  // ── 5. Next steps ─────────────────────────────────────────────────────────
  blank();
  log(color.bold('  Setup complete. What to do next:'));
  blank();
  info('Run doctor to confirm everything is in order:', 'oma doctor');
  info('Start your first session in Codex with:',       '"clarify the problem" or "$requirement"');
  info('Check status anytime with:',                    'oma status');
  blank();
}

// Minimal stub content when templates dir is not available
function writeStub(destPath, templateName) {
  const stubs = {
    'requirements.md': `# Requirements\n_Created: ${new Date().toISOString().slice(0, 10)}_\n\n<!-- Fill this in via $requirement -->\n`,
    'memory.md':       `# Algorithm Memory\n_Last updated: ${new Date().toISOString().slice(0, 10)}_\n\n## Dead Ends\n| Direction | Why Failed | Seeds Tested | Evidence Experiments | Date Added |\n|-----------|-----------|-------------|---------------------|-----------|\n\n## Working Patterns\n| Pattern | Conditions | Median Gain | Evidence Experiments | Date Added |\n|---------|-----------|------------|---------------------|-----------|\n\n## Open Hypotheses\n| Hypothesis | Source | Priority | Estimated Gain | Status |\n|-----------|--------|----------|---------------|--------|\n\n## Budget Tracker\n| Item | Value |\n|------|-------|\n| Experiments run | 0 |\n| Deploy gate status | closed |\n`,
    'knowledge.md':    `# Knowledge Base\n_Status: DRAFT — run \`oma extract --paper path.pdf\` then \$requirement to populate_\n`,
  };
  fs.writeFileSync(destPath, stubs[templateName] ?? `# ${templateName}\n`);
}

module.exports = { setup };
