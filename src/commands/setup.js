'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, pkgRoot, templatePath, exists, readJSON } = require('../utils/paths');
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

const PLATFORM_MAP = {
  'codex'       : 'AGENTS.md',
  'meta-agent'  : 'AGENT.md',
  // cursor still writes AGENTS.md (as @-fallback) but ALSO generates the
  // native .cursor/ layout — see installCursorAssets().
  'cursor'      : 'AGENTS.md',
  // claude-code uses CLAUDE.md as the contract file.
  'claude-code' : 'CLAUDE.md',
};

async function setup({ cwd = process.cwd(), force = false, platform = 'codex', overlay = null } = {}) {
  if (!PLATFORM_MAP[platform]) {
    const valid = Object.keys(PLATFORM_MAP).join(' | ');
    console.error(`  ✗ Unknown platform: "${platform}". Valid values: ${valid}`);
    process.exit(1);
  }

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

  // ── 4. Copy agent prompt file into project root ──────────────────────────
  const agentFileName = PLATFORM_MAP[platform];
  section(`Installing agent prompt (${agentFileName}) for platform: ${platform}`);

  const agentsSrc  = path.join(pkgRoot(), 'AGENTS.md');   // source is always AGENTS.md in package
  const agentsDest = path.join(cwd, agentFileName);

  if (exists(agentsDest) && !force) {
    warn(agentFileName, 'already exists, skipped  (use --force to overwrite)');
  } else if (!exists(agentsSrc)) {
    warn(agentFileName, 'source not found in package — skipped');
  } else {
    fs.copyFileSync(agentsSrc, agentsDest);
    ok(agentFileName, 'copied from package');
  }

  // ── 5. Install stage prompts ────────────────────────────────────────────
  // Codex/meta-agent → plain markdown under .oma/skills/ (routed via AGENTS.md
  // keyword table). Cursor → native .cursor/ layout (rules + frontmatter'd
  // skills) because Cursor ignores keyword tables and auto-loads skills by
  // their frontmatter `description`.
  if (platform === 'cursor') {
    installCursorAssets(cwd, force);
  } else {
    section('Installing .oma/skills/ (Codex stage prompts)');

    const skillsSrc  = path.join(pkgRoot(), 'skills');
    const skillsDest = path.join(OMA.dir(cwd), 'skills');

    if (!exists(skillsSrc)) {
      warn('.oma/skills/', 'source not found in package — skipped');
    } else {
      copyDirRecursive(skillsSrc, skillsDest, force);
      ok('.oma/skills/', `installed at ${path.relative(cwd, skillsDest)}`);
    }
  }

  // ── 6. Copy templates/ directory into .oma/templates/ ───────────────────
  section('Installing .oma/templates/ (deploy test scripts + config templates)');

  const templatesSrc  = path.join(pkgRoot(), 'templates');
  const templatesDest = path.join(OMA.dir(cwd), 'templates');

  if (!exists(templatesSrc)) {
    warn('.oma/templates/', 'source not found in package — skipped');
  } else {
    copyDirRecursive(templatesSrc, templatesDest, force);
    ok('.oma/templates/', `installed at ${path.relative(cwd, templatesDest)}`);
  }

  // ── 7. Write .gitignore entry ────────────────────────────────────────────
  // Runtime state is always ignored. The tooling block differs by platform:
  //   codex/meta-agent → ignore .oma/skills + .oma/templates
  //   cursor           → ignore the OMA-managed .cursor assets (kept private,
  //                       per setup choice) without nuking the user's own .cursor/
  const gitignorePath = path.join(cwd, '.gitignore');
  const runtimeBlock = '\n# oh-my-algorithm state\n.oma/experiments/\n.oma/leaderboard.json\n.oma/best.json\n.oma/trajectory.jsonl\n';
  const toolingBlock = platform === 'cursor'
    ? '# oh-my-algorithm tooling (managed by oma setup -p cursor, not project files)\n.oma/templates/\n.cursor/rules/oma-core.mdc\n.cursor/skills/\n'
    : '# oh-my-algorithm tooling (managed by oma setup, not project files)\n.oma/skills/\n.oma/templates/\n';
  const omaIgnoreEntry = runtimeBlock + toolingBlock;
  const sentinel = platform === 'cursor' ? '.cursor/skills/' : '.oma/skills/';

  if (exists(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    if (!existing.includes(sentinel)) {
      fs.appendFileSync(gitignorePath, omaIgnoreEntry);
      ok('.gitignore', 'appended oma entries');
    } else {
      warn('.gitignore', 'already has oma entries, skipped');
    }
  } else {
    fs.writeFileSync(gitignorePath, omaIgnoreEntry.trimStart());
    ok('.gitignore', 'created with oma entries');
  }

  // ── 7.5 Append user overlay markdown (optional) ───────────────────────────
  // The single, simple customization entry: append one markdown file to the end of
  // the platform's agent file so codex/cursor/claude-code see the user's own habits.
  if (overlay) {
    section('Appending user overlay');
    appendOverlay(cwd, platform, overlay);
  }

  // ── 8. Next steps ─────────────────────────────────────────────────────────
  blank();
  log(color.bold('  Setup complete. What to do next:'));
  blank();
  info('Run doctor to confirm everything is in order:', 'oma doctor');
  if (platform === 'cursor') {
    info('Cursor rule (always on):',          '.cursor/rules/oma-core.mdc');
    info('Cursor skills (auto-selected):',    '.cursor/skills/<stage>/SKILL.md');
    info('AGENTS.md also written as',         '@-fallback (Cursor auto-load is unstable)');
  } else {
    info('Agent prompt installed as:',        agentFileName);
  }
  info('Check status anytime with:',                    'oma status');
  blank();
}

// Files and directories to skip when copying skills/ or templates/
const COPY_SKIP = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep']);
function shouldSkip(name) {
  return COPY_SKIP.has(name) || name === '__pycache__' || name.endsWith('.pyc');
}

// Copy a directory recursively. If force=false, skips files that already exist.
function copyDirRecursive(src, dest, force) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, force);
    } else {
      if (!exists(destPath) || force) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

// ── Cursor platform assets ──────────────────────────────────────────────────
// Cursor does not read AGENTS.md reliably and does not honor keyword routing
// tables. Instead it injects `.cursor/rules/*.mdc` (alwaysApply) every turn and
// auto-selects `.cursor/skills/*/SKILL.md` by their frontmatter `description`.
// So we translate OMA's single AGENTS.md contract into that two-layer model.
function installCursorAssets(cwd, force) {
  const pkg = pkgRoot();

  // 1. .cursor/rules/oma-core.mdc — the always-on "constitution" (startup
  //    protocol, gate chain, state files, routing) derived from AGENTS.md with
  //    skill paths rewritten to where Cursor looks for them.
  section('Installing .cursor/rules/oma-core.mdc (alwaysApply constitution)');
  const rulesDir = path.join(cwd, '.cursor', 'rules');
  const coreDest = path.join(rulesDir, 'oma-core.mdc');
  if (exists(coreDest) && !force) {
    warn('.cursor/rules/oma-core.mdc', 'already exists, skipped  (use --force to overwrite)');
  } else {
    const agentsSrc = path.join(pkg, 'AGENTS.md');
    let body = exists(agentsSrc) ? fs.readFileSync(agentsSrc, 'utf8') : '# oh-my-algorithm (OMA)\n';
    body = body.replace(/\.oma\/skills\//g, '.cursor/skills/');   // Cursor skill location
    const fm = [
      '---',
      'description: OMA robot-RL workflow constitution — startup protocol, gate chain, state files, and stage routing. Always active in this repo.',
      'alwaysApply: true',
      '---',
      '',
    ].join('\n');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(coreDest, fm + body);
    ok('.cursor/rules/oma-core.mdc', 'generated from AGENTS.md');
  }

  // 2. .cursor/skills/<stage>/SKILL.md — OMA stage prompts with injected
  //    frontmatter so Cursor can auto-select them by intent.
  section('Installing .cursor/skills/ (Cursor agent skills with frontmatter)');
  const skillsSrc  = path.join(pkg, 'skills');
  const skillsDest = path.join(cwd, '.cursor', 'skills');
  if (!exists(skillsSrc)) {
    warn('.cursor/skills/', 'source not found in package — skipped');
    return;
  }
  const meta = loadCursorSkillMeta(pkg);

  for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
    if (!entry.isDirectory() || shouldSkip(entry.name)) continue;
    const stage = entry.name;
    if (stage === 'evaluate') continue;   // deprecated → never expose to Cursor

    const stageSrc  = path.join(skillsSrc, stage);
    const srcFile   = path.join(stageSrc, 'SKILL.md');
    if (!exists(srcFile)) continue;

    const destDir   = path.join(skillsDest, stage);
    const destFile  = path.join(destDir, 'SKILL.md');
    if (exists(destFile) && !force) {
      warn(`.cursor/skills/${stage}/SKILL.md`, 'exists, skipped');
      continue;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(destFile, withCursorFrontmatter(fs.readFileSync(srcFile, 'utf8'), stage, meta));

    // Copy sibling reference files (reference.md, etc.) verbatim.
    for (const sib of fs.readdirSync(stageSrc)) {
      if (sib === 'SKILL.md' || shouldSkip(sib)) continue;
      const sp = path.join(stageSrc, sib);
      if (fs.statSync(sp).isFile()) {
        const dp = path.join(destDir, sib);
        if (!exists(dp) || force) fs.copyFileSync(sp, dp);
      }
    }
    ok(`.cursor/skills/${stage}/SKILL.md`, m(meta, stage) ? 'installed (+frontmatter)' : 'installed');
  }
}

function loadCursorSkillMeta(pkg) {
  const data = readJSON(path.join(pkg, 'configs', 'cursor-skill-meta.json'));
  return (data && data.skills) || {};
}

function m(meta, stage) { return meta[stage]; }

// Prepend Cursor frontmatter unless the skill already declares its own.
function withCursorFrontmatter(content, stage, meta) {
  if (/^---\s*\r?\n/.test(content)) return content;   // already has frontmatter (e.g. gradmotion)
  const entry = meta[stage];
  if (!entry) return content;                          // no mapping → leave untouched
  const fm = [
    '---',
    `name: ${entry.name}`,
    `description: ${JSON.stringify(entry.description)}`,
    '---',
    '',
    '',
  ].join('\n');
  return fm + content;
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

// ── User overlay ─────────────────────────────────────────────────────────────
// The single, simple customization entry. Append one user markdown file to the end
// of the platform's agent file, inside an idempotent managed region, so codex /
// cursor / claude-code read the user's custom habits verbatim. OMA does not parse it.
const OVERLAY_AGENT_FILE = {
  'codex'      : 'AGENTS.md',
  'meta-agent' : 'AGENT.md',
  'cursor'     : path.join('.cursor', 'rules', 'oma-core.mdc'),
  'claude-code': 'CLAUDE.md',
};
const OVERLAY_RE = /<!--\s*OMA:USER-OVERLAY:BEGIN[\s\S]*?OMA:USER-OVERLAY:END\s*-->\n?/;

function appendOverlay(cwd, platform, overlayPath) {
  if (!exists(overlayPath)) {
    warn('overlay', `not found: ${overlayPath} — skipped`);
    return;
  }
  const rel    = OVERLAY_AGENT_FILE[platform] || 'AGENTS.md';
  const target = path.join(cwd, rel);
  const md     = fs.readFileSync(overlayPath, 'utf8').trimEnd();
  const region =
    `<!-- OMA:USER-OVERLAY:BEGIN (from ${path.basename(overlayPath)}; appended verbatim by oma setup --overlay) -->\n` +
    md + '\n' +
    `<!-- OMA:USER-OVERLAY:END -->\n`;

  let existing = exists(target) ? fs.readFileSync(target, 'utf8') : `# ${path.basename(rel)}\n`;
  existing = OVERLAY_RE.test(existing)
    ? existing.replace(OVERLAY_RE, region)
    : existing.trimEnd() + '\n\n---\n\n' + region;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, existing);
  ok('overlay', `appended to ${rel}`);
}

module.exports = { setup };
