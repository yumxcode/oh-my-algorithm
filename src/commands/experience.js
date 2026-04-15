'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// ─── Storage ──────────────────────────────────────────────────────────────────

const GLOBAL_XP_DIR = path.join(os.homedir(), '.oma');
const GLOBAL_XP_FILE = path.join(GLOBAL_XP_DIR, 'experiences.jsonl');

const VALID_STAGES = ['design', 'tune', 'deploy'];

function ensureDir() {
  if (!fs.existsSync(GLOBAL_XP_DIR)) {
    fs.mkdirSync(GLOBAL_XP_DIR, { recursive: true });
  }
}

function loadAll() {
  if (!fs.existsSync(GLOBAL_XP_FILE)) return [];
  return fs.readFileSync(GLOBAL_XP_FILE, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function appendEntry(entry) {
  ensureDir();
  fs.appendFileSync(GLOBAL_XP_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function generateId(stage) {
  const count = loadAll().filter(e => e.stage === stage).length;
  return `${stage}-${String(count + 1).padStart(3, '0')}`;
}

// ─── Prompt helper ────────────────────────────────────────────────────────────

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * oma xp add [--stage <stage>]
 * Interactive: ask each field, append to JSONL.
 */
async function add({ stage } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n📚 OMA 经验库 — 添加新经验\n');

  // Stage
  if (!stage || !VALID_STAGES.includes(stage)) {
    const raw = await ask(rl, `阶段 (${VALID_STAGES.join('/')}): `);
    stage = raw.trim();
    if (!VALID_STAGES.includes(stage)) {
      console.error(`无效阶段: ${stage}，有效值: ${VALID_STAGES.join(', ')}`);
      rl.close();
      process.exit(1);
    }
  } else {
    console.log(`阶段: ${stage}`);
  }

  const title       = (await ask(rl, '标题 (一句话概括经验): ')).trim();
  const robot_type  = (await ask(rl, '机器人类型 (biped/quadruped/arm/wheel/other): ')).trim() || 'other';
  const task        = (await ask(rl, '任务类型 (locomotion/manipulation/navigation/other): ')).trim() || 'other';
  const context     = (await ask(rl, '背景/场景 (什么情况下发现的): ')).trim();
  const insight     = (await ask(rl, '核心经验 (做了什么，为什么有效): ')).trim();
  const outcome     = (await ask(rl, '结果/收益 (量化或描述改善): ')).trim();
  const tags_raw    = (await ask(rl, '标签 (逗号分隔，如: reward_design,energy,biped): ')).trim();
  const src         = (await ask(rl, '来源项目 (可选，回车跳过): ')).trim();

  rl.close();

  if (!title || !insight) {
    console.error('标题和核心经验不能为空，已取消。');
    process.exit(1);
  }

  const entry = {
    id: generateId(stage),
    stage,
    robot_type,
    task,
    title,
    context,
    insight,
    outcome,
    tags: tags_raw.split(',').map(t => t.trim()).filter(Boolean),
    added_at: new Date().toISOString(),
    source_project: src || null,
  };

  appendEntry(entry);
  console.log(`\n✅ 经验已保存: [${entry.id}] ${entry.title}`);
  console.log(`   路径: ${GLOBAL_XP_FILE}\n`);
}

/**
 * oma xp list [--stage <stage>] [--tag <tag>] [--format table|md]
 * List experiences, optionally filtered.
 */
function list({ stage, tag, format = 'table' } = {}) {
  let entries = loadAll();

  if (stage) entries = entries.filter(e => e.stage === stage);
  if (tag)   entries = entries.filter(e => e.tags.includes(tag));

  if (entries.length === 0) {
    console.log('暂无经验记录。运行 `oma xp add` 添加第一条经验。');
    return;
  }

  if (format === 'md') {
    // Markdown — Codex 消费格式
    console.log(`# OMA 经验库${stage ? ` — ${stage} 阶段` : ''}\n`);
    for (const e of entries) {
      console.log(`## [${e.id}] ${e.title}`);
      console.log(`- **阶段**: ${e.stage}  **机器人**: ${e.robot_type}  **任务**: ${e.task}`);
      if (e.context)  console.log(`- **背景**: ${e.context}`);
      console.log(`- **经验**: ${e.insight}`);
      if (e.outcome)  console.log(`- **结果**: ${e.outcome}`);
      if (e.tags.length) console.log(`- **标签**: \`${e.tags.join('` `')}\``);
      if (e.source_project) console.log(`- **来源**: ${e.source_project}`);
      console.log('');
    }
  } else {
    // Table — 终端阅读
    const col = (s, n) => String(s ?? '').substring(0, n).padEnd(n);
    console.log('\n' + col('ID', 12) + col('Stage', 8) + col('Robot', 11) + col('Task', 14) + 'Title');
    console.log('─'.repeat(90));
    for (const e of entries) {
      console.log(col(e.id, 12) + col(e.stage, 8) + col(e.robot_type, 11) + col(e.task, 14) + (e.title || ''));
    }
    console.log(`\n共 ${entries.length} 条经验。运行 \`oma xp show <id>\` 查看详情。\n`);
  }
}

/**
 * oma xp search <query> [--stage <stage>] [--format table|md]
 * Full-text search across title/context/insight/outcome/tags.
 */
function search({ query, stage, format = 'md' } = {}) {
  if (!query) {
    console.error('用法: oma xp search <关键词>');
    process.exit(1);
  }

  const terms = query.toLowerCase().split(/\s+/);

  function score(e) {
    const text = [e.title, e.context, e.insight, e.outcome, ...e.tags]
      .join(' ').toLowerCase();
    return terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
  }

  let entries = loadAll();
  if (stage) entries = entries.filter(e => e.stage === stage);

  entries = entries
    .map(e => ({ ...e, _score: score(e) }))
    .filter(e => e._score > 0)
    .sort((a, b) => b._score - a._score);

  if (entries.length === 0) {
    console.log(`未找到与 "${query}" 相关的经验。`);
    return;
  }

  if (format === 'md') {
    console.log(`# 经验搜索: "${query}" — ${entries.length} 条结果\n`);
    for (const e of entries) {
      console.log(`## [${e.id}] ${e.title}`);
      console.log(`- **阶段**: ${e.stage}  **机器人**: ${e.robot_type}  **任务**: ${e.task}`);
      if (e.context)  console.log(`- **背景**: ${e.context}`);
      console.log(`- **经验**: ${e.insight}`);
      if (e.outcome)  console.log(`- **结果**: ${e.outcome}`);
      if (e.tags.length) console.log(`- **标签**: \`${e.tags.join('` `')}\``);
      console.log('');
    }
  } else {
    list({ stage, format: 'table', _entries: entries });
  }
}

/**
 * oma xp show <id>
 * Show full detail of a single experience.
 */
function show({ id } = {}) {
  if (!id) {
    console.error('用法: oma xp show <id>  (例: oma xp show design-001)');
    process.exit(1);
  }
  const entry = loadAll().find(e => e.id === id);
  if (!entry) {
    console.error(`未找到经验: ${id}`);
    process.exit(1);
  }
  console.log('\n' + '─'.repeat(60));
  console.log(`[${entry.id}] ${entry.title}`);
  console.log('─'.repeat(60));
  console.log(`阶段    : ${entry.stage}`);
  console.log(`机器人  : ${entry.robot_type}    任务: ${entry.task}`);
  console.log(`背景    : ${entry.context || '—'}`);
  console.log(`核心经验: ${entry.insight}`);
  console.log(`结果    : ${entry.outcome || '—'}`);
  console.log(`标签    : ${entry.tags.join(', ') || '—'}`);
  console.log(`来源    : ${entry.source_project || '—'}`);
  console.log(`时间    : ${entry.added_at}`);
  console.log('─'.repeat(60) + '\n');
}

/**
 * oma xp delete <id>
 * Remove an experience entry.
 */
function del({ id } = {}) {
  if (!id) {
    console.error('用法: oma xp delete <id>');
    process.exit(1);
  }
  const entries = loadAll();
  const filtered = entries.filter(e => e.id !== id);
  if (filtered.length === entries.length) {
    console.error(`未找到经验: ${id}`);
    process.exit(1);
  }
  ensureDir();
  fs.writeFileSync(GLOBAL_XP_FILE, filtered.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  console.log(`✅ 已删除经验: ${id}`);
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function help() {
  console.log(`
oma xp — 全局经验库管理（存储于 ~/.oma/experiences.jsonl）

用法:
  oma xp add [--stage <stage>]          交互式添加一条经验
  oma xp list [--stage <s>] [--tag <t>] 列出经验（表格视图）
  oma xp search <关键词> [--stage <s>]  全文搜索（Codex 调用时加 --format md）
  oma xp show <id>                      查看单条经验详情
  oma xp delete <id>                    删除一条经验

有效阶段: ${VALID_STAGES.join(', ')}

示例:
  oma xp add --stage design
  oma xp search "reward hacking" --stage tune
  oma xp list --stage deploy --format md
  oma xp show tune-003
`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Entry point called from bin/oma.js
 * args: remaining argv after 'xp'
 * flags: parsed flag map
 */
async function xp(args = [], flags = {}) {
  const sub = args[0];

  const stage  = flags['--stage']  || null;
  const tag    = flags['--tag']    || null;
  const format = flags['--format'] || undefined;
  const id     = args[1] || null;

  switch (sub) {
    case 'add':    return add({ stage });
    case 'list':   return list({ stage, tag, format });
    case 'search': return search({ query: args.slice(1).join(' ') || flags['--query'], stage, format });
    case 'show':   return show({ id });
    case 'delete':
    case 'del':    return del({ id });
    default:       return help();
  }
}

module.exports = { xp, GLOBAL_XP_FILE, VALID_STAGES };
