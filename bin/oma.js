#!/usr/bin/env node
'use strict';

/**
 * oma — oh-my-algorithm CLI
 *
 * Usage:
 *   oma setup                        Initialize .oma/ workspace
 *   oma extract --paper <path.pdf>   Extract paper → .oma/paper/ (run before $requirement)
 *   oma search --topic "..."         Fetch papers from Semantic Scholar (Stream A seeds)
 *   oma doctor                       Check gate chain status
 *   oma status                       Show leaderboard, phase, memory snapshot
 *   oma log [options]                Pretty-print the experiment trajectory
 *   oma version                      Print version
 *   oma help [command]               Show help
 */

const { setup }   = require('../src/commands/setup');
const { extract } = require('../src/commands/extract');
const { search }  = require('../src/commands/search');
const { index }   = require('../src/commands/index');
const { go }      = require('../src/commands/go');
const { doctor }  = require('../src/commands/doctor');
const { status }  = require('../src/commands/status');
const { logCmd }  = require('../src/commands/log');
const { xp }      = require('../src/commands/experience');
const { log, err, blank, color } = require('../src/utils/print');

const pkg  = require('../package.json');
const args = process.argv.slice(2);
const cmd  = args[0];

// ── Flag parsing ──────────────────────────────────────────────────────────────

function hasFlag(...flags) {
  return flags.some((f) => args.includes(f));
}

function flagValue(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

// ── Help text ─────────────────────────────────────────────────────────────────

const HELP = {
  root: `
  ${color.bold(color.cyan('oma'))} — oh-my-algorithm ${color.gray(`v${pkg.version}`)}

  ${color.bold('Usage:')}
    oma <command> [options]

  ${color.bold('Commands:')}
    ${color.cyan('setup')}                        Initialize .oma/ workspace in current directory
    ${color.cyan('go <stage>')}                   Enter any stage directly (bypass gate enforcement)
    ${color.cyan('extract --paper <path.pdf>')}   Extract paper → .oma/paper/ (run before $requirement)
    ${color.cyan('index --src <repo-path>')}      Index reference codebase → .oma/codebase/ ($design + $implement)
    ${color.cyan('search --topic "..."')}         Fetch papers from Semantic Scholar (Stream A seeds)
    ${color.cyan('doctor')}                       Check gate chain status and workspace health
    ${color.cyan('status')}                       Show leaderboard, current phase, memory snapshot
    ${color.cyan('log')}                          Pretty-print the experiment trajectory
    ${color.cyan('xp <sub>')}                     Global experience library (add / list / search / show / delete)
    ${color.cyan('version')}                      Print version
    ${color.cyan('help [command]')}               Show help for a command

  ${color.bold('Options:')}
    --cwd <path>          Run as if in this directory (default: process.cwd())
    --no-color            Disable color output
    -h, --help            Show this help

  ${color.bold('Typical first session:')}
    oma setup
    oma extract --paper ./paper.pdf
    oma index --src ./reference-repo     # optional — enables Path A implement
    oma doctor
    # open Codex and run: $requirement

  ${color.bold('Standalone (gate-free) entry:')}
    oma go design                        # jump straight to $design, no gates
    oma go train                         # enter $train even without prior stages
    oma go off                           # return to gated mode
    oma go status                        # show current standalone mode state
`,

  setup: `
  ${color.bold('oma setup')} — Initialize .oma/ workspace

  Creates the .oma/ directory structure, copies templates, and writes
  an initial config.json. Safe to run multiple times (skips existing files).

  ${color.bold('Options:')}
    --force               Overwrite existing template files
    --cwd <path>          Initialize in this directory instead of cwd

  ${color.bold('Creates:')}
    .oma/requirements.md  (from template — fill via $requirement)
    .oma/memory.md        (empty Dead Ends / Working Patterns tables)
    .oma/config.json      (project name, default seeds, metric direction)
    .oma/designs/         (directory for $design outputs)
    .oma/impl/            (directory for $implement outputs)
    .oma/experiments/     (directory for $train / $tune / $evaluate outputs)
    .gitignore            (appends .oma/experiments/ and other volatile state)
`,

  go: `
  ${color.bold('oma go <stage>')} — Enter any stage directly (Standalone Mode)

  Bypasses gate enforcement so you can enter any OMA stage without completing
  prior stages. Writes ${color.cyan('.oma/standalone.json')} to signal Codex that gate
  checks should be advisory only (warnings, not blocks).

  ${color.bold('Stages:')}
    requirement   Enter $requirement directly
    design        Enter $design directly
    implement     Enter $implement directly
    train         Enter $train directly
    tune          Enter $tune directly
    deploy        Enter $deploy directly
    consolidate   Enter $consolidate directly
    off           Disable standalone mode (return to gated flow)
    status        Show current standalone mode state

  ${color.bold('Options:')}
    --reason "..."   Document why you're entering standalone mode
    --cwd <path>     Workspace directory (default: cwd)

  ${color.bold('Examples:')}
    oma go design                         # jump into $design
    oma go train --reason "testing infra"
    oma go off                            # return to normal gated flow
    oma go status                         # check if standalone mode is active

  ${color.bold('Experience library:')}
    oma xp add --stage design             # save a design experience after a session
    oma xp search "reward hacking"        # query past experiences (Codex calls this)
    oma xp list --stage tune              # list all tune-stage experiences
`,

  xp: `
  ${color.bold('oma xp')} — Global experience library (~/.oma/experiences.jsonl)

  Accumulates successful practices across projects for design, tune, and deploy
  stages. Codex is informed of the library at stage entry and queries it on demand.

  ${color.bold('Subcommands:')}
    ${color.cyan('add [--stage <stage>]')}          Interactive: fill fields and append one entry
    ${color.cyan('list [--stage <s>] [--tag <t>]')} List experiences (table view)
    ${color.cyan('search <query> [--stage <s>]')}   Full-text search (used by Codex inside sessions)
    ${color.cyan('show <id>')}                      Full detail for one entry
    ${color.cyan('delete <id>')}                    Remove one entry

  ${color.bold('Valid stages:')} design, tune, deploy

  ${color.bold('Options:')}
    --format md             Output as Markdown (default for search, used by Codex)
    --format table          Output as table (default for list)

  ${color.bold('Examples:')}
    oma xp add --stage design
    oma xp search "reward hacking" --stage tune
    oma xp list --stage deploy --format md
    oma xp show tune-003
    oma xp delete design-001
`,

  doctor: `
  ${color.bold('oma doctor')} — Verify gate chain and workspace health

  Checks each gate in the lifecycle chain (requirement → design → implement
  → train → tune → evaluate → deploy) and reports which gates are open
  or blocked. Shows trajectory statistics and budget info.

  ${color.bold('Options:')}
    --cwd <path>          Check workspace in this directory

  ${color.bold('Exit codes:')}
    0   All gates open (or first blocked gate is deploy)
    1   .oma/ directory not found
`,

  status: `
  ${color.bold('oma status')} — Workspace dashboard

  Shows:
    Current phase (inferred from which artifacts exist)
    Best result from best.json (deploy gate status)
    Top 8 leaderboard entries
    Memory snapshot (Dead Ends / Working Patterns counts)
    Last 5 trajectory entries

  ${color.bold('Options:')}
    --cwd <path>          Read workspace from this directory
`,

  log: `
  ${color.bold('oma log')} — Experiment trajectory viewer

  ${color.bold('Options:')}
    --tail <n>            Show last N entries (default: 20)
    --phase <name>        Filter by phase: train | tune | evaluate
    --verbose             Print full JSON for each entry
    --cwd <path>          Read workspace from this directory

  ${color.bold('Examples:')}
    oma log
    oma log --tail 5
    oma log --phase tune
    oma log --verbose --tail 3
`,

  search: `
  ${color.bold('oma search')} — Fetch papers from Semantic Scholar (Stream A seeds)

  Queries Semantic Scholar (free, no API key) and saves structured results
  to .oma/paper/search-cache/ for the $design skill to consume.

  ${color.bold('Options:')}
    --topic <query>       Search query (repeatable for multiple queries)
    --from-knowledge      Derive queries automatically from .oma/knowledge.md
    --limit <n>           Max papers per query (default: 8, max: 20)
    --year-from <year>    Minimum publication year (default: 3 years ago)
    --force               Re-fetch even if cache already exists
    --cwd <path>          Workspace directory (default: cwd)

  ${color.bold('Output:')}
    .oma/paper/search-cache/ss-{slug}.json    Per-query results
    .oma/paper/search-cache/search-results.json  Combined ranked results
    .oma/paper/search-cache/stream-a-seeds.md    Ready for $design Stream A

  ${color.bold('Examples:')}
    oma search --topic "attention mechanism tabular data"
    oma search --topic "graph neural networks" --topic "message passing"
    oma search --from-knowledge
    oma search --from-knowledge --year-from 2023 --limit 10
`,

  index: `
  ${color.bold('oma index')} — Index a reference open-source implementation

  Scans the repository at --src, scores files by importance, extracts
  class/function symbols, and writes a structured codebase index to
  .oma/codebase/ for the $design and $implement skills to consume.

  ${color.bold('Why this matters:')}
    $design Phase 0 loads the codebase to make ideas concretely implementable.
    $implement uses Path A (Adapt) when .oma/codebase/ exists — modifying
    only the files that need to change instead of reimplementing from scratch.

  ${color.bold('Options:')}
    --src <path>          Path to the open-source repository (required)
    --top <n>             Number of key files to index in depth (default: 40)
    --force               Re-index even if .oma/codebase/ already exists
    --cwd <path>          Workspace directory (default: cwd)

  ${color.bold('Output:')}
    .oma/codebase/config.json     Source path, language distribution, index stats
    .oma/codebase/index.json      Scored file list with extracted symbols
    .oma/codebase/symbols.json    Flat symbol map (class/function → file)
    .oma/codebase/key-files.md    Agent-readable file role map ($design loads this)
    .oma/codebase/arch-map.md     Module/class map ($implement uses for surgery)

  ${color.bold('Examples:')}
    oma index --src ./xgboost
    oma index --src ~/code/tabnet --top 60
    oma index --src ./lightgbm --force
`,

  extract: `
  ${color.bold('oma extract')} — Extract benchmark paper into structured sections

  Runs BEFORE starting a Codex session. Converts a PDF paper into structured
  section files that the $requirement skill reads to ground knowledge.md and
  pre-fill requirements.md without a lengthy interview.

  ${color.bold('Options:')}
    --paper <path>        Path to the PDF file (required)
    --force               Re-extract even if .oma/paper/ already exists
    --cwd <path>          Workspace directory (default: cwd)

  ${color.bold('Output:')}
    .oma/paper/raw-text.txt        Full extracted text
    .oma/paper/raw-sections.json   Heuristically split sections
    .oma/paper/meta.json           Title, year, venue, best result (best-effort)
    .oma/paper/manifest.json       Extraction summary

  ${color.bold('Extraction backends (tried in order):')}
    1. pdftotext (poppler-utils)   brew install poppler / apt install poppler-utils
    2. python3 pdfminer.six        pip install pdfminer.six
    3. python3 pypdf               pip install pypdf

  ${color.bold('Examples:')}
    oma extract --paper ./attention.pdf
    oma extract --paper ~/papers/bert.pdf --force
`,
};

// ── Router ────────────────────────────────────────────────────────────────────

async function main() {
  if (hasFlag('-h', '--help') && !cmd) {
    log(HELP.root);
    return;
  }

  const cwd = flagValue('--cwd') || process.cwd();

  switch (cmd) {

    case 'setup':
      if (hasFlag('-h', '--help')) { log(HELP.setup); return; }
      await setup({ cwd, force: hasFlag('--force') });
      break;

    case 'go':
      if (hasFlag('-h', '--help')) { log(HELP.go); return; }
      await go({
        cwd,
        stage : args[1] || 'status',
        reason: flagValue('--reason') || '',
      });
      break;

    case 'search': {
      if (hasFlag('-h', '--help')) { log(HELP.search); return; }
      // Collect all --topic values (flag may appear multiple times)
      const topics = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--topic' && args[i + 1]) topics.push(args[i + 1]);
      }
      await search({
        cwd,
        topics,
        fromKnowledge : hasFlag('--from-knowledge'),
        limit         : parseInt(flagValue('--limit')     || '8',  10),
        yearFrom      : parseInt(flagValue('--year-from') || String(new Date().getFullYear() - 3), 10),
        force         : hasFlag('--force'),
      });
      break;
    }

    case 'index':
      if (hasFlag('-h', '--help')) { log(HELP.index); return; }
      await index({
        cwd,
        srcPath : flagValue('--src'),
        topN    : parseInt(flagValue('--top') || '40', 10),
        force   : hasFlag('--force'),
      });
      break;

    case 'extract':
      if (hasFlag('-h', '--help')) { log(HELP.extract); return; }
      await extract({ cwd, paperPath: flagValue('--paper'), force: hasFlag('--force') });
      break;

    case 'doctor':
      if (hasFlag('-h', '--help')) { log(HELP.doctor); return; }
      await doctor({ cwd });
      break;

    case 'status':
      if (hasFlag('-h', '--help')) { log(HELP.status); return; }
      await status({ cwd });
      break;

    case 'log':
      if (hasFlag('-h', '--help')) { log(HELP.log); return; }
      await logCmd({
        cwd,
        tail:    parseInt(flagValue('--tail') || '20', 10),
        phase:   flagValue('--phase') || null,
        verbose: hasFlag('--verbose', '-v'),
      });
      break;

    case 'xp': {
      if (hasFlag('-h', '--help')) { log(HELP.xp); return; }
      // Parse xp-specific flags
      const xpFlags = {};
      const xpArgs  = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
          xpFlags[args[i]] = args[i + 1];
          i++;
        } else if (args[i].startsWith('--')) {
          xpFlags[args[i]] = true;
        } else {
          xpArgs.push(args[i]);
        }
      }
      await xp(xpArgs, xpFlags);
      break;
    }

    case 'version':
    case '--version':
    case '-v':
      log(`oh-my-algorithm v${pkg.version}`);
      break;

    case 'help':
    case undefined:
      log(HELP[args[1]] ?? HELP.root);
      break;

    default:
      err(`  ${color.red('✗')} Unknown command: ${color.bold(cmd)}`);
      blank();
      err(`  Run ${color.cyan('oma help')} to see available commands.`);
      blank();
      process.exit(1);
  }
}

main().catch((e) => {
  err(`\n  ${color.red('✗')} Fatal error: ${e.message}`);
  if (process.env.OMA_DEBUG) err(e.stack);
  process.exit(1);
});
