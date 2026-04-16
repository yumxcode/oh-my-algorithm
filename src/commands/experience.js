'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// ─── Storage layout ───────────────────────────────────────────────────────────
//
//  ~/.oma/
//    xp-index.json          ← global index: [{id, name, stage, description, tags, ...}]
//    experiences/
//      deploy-001.md        ← individual experience files (Markdown, human-readable)
//      deploy-002.md
//      design-001.md
//
//  Codex workflow:
//    1. oma xp index --format md      → scan xp-index.json, decide relevance (cheap)
//    2. oma xp show <id>              → read ~/.oma/experiences/<id>.md (only if relevant)
//
// ─────────────────────────────────────────────────────────────────────────────

const GLOBAL_XP_DIR     = path.join(os.homedir(), '.oma');
const GLOBAL_XP_INDEX   = path.join(GLOBAL_XP_DIR, 'xp-index.json');
const GLOBAL_XP_XP_DIR  = path.join(GLOBAL_XP_DIR, 'experiences');

const VALID_STAGES = ['design', 'tune', 'deploy'];

// ─── Filesystem helpers ───────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(GLOBAL_XP_DIR,    { recursive: true });
  fs.mkdirSync(GLOBAL_XP_XP_DIR, { recursive: true });
}

function xpFilePath(id) {
  return path.join(GLOBAL_XP_XP_DIR, `${id}.md`);
}

// ─── Index helpers ────────────────────────────────────────────────────────────

function loadIndex() {
  if (!fs.existsSync(GLOBAL_XP_INDEX)) return [];
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_XP_INDEX, 'utf8'));
  } catch {
    return [];
  }
}

function saveIndex(index) {
  ensureDirs();
  fs.writeFileSync(GLOBAL_XP_INDEX, JSON.stringify(index, null, 2) + '\n', 'utf8');
}

function generateId(stage) {
  const idx = loadIndex();
  const count = idx.filter(e => e.stage === stage).length;
  return `${stage}-${String(count + 1).padStart(3, '0')}`;
}

// ─── Experience file format ───────────────────────────────────────────────────
//
// Each experience is a standalone Markdown file.
// Codex can read it directly. Humans can edit it in any editor.

function renderExperienceFile(entry) {
  const tags = (entry.tags || []).map(t => `\`${t}\``).join(' ') || '—';
  return [
    `# [${entry.id}] ${entry.name}`,
    '',
    `**阶段**: ${entry.stage}  `,
    `**机器人**: ${entry.robot_type}  **任务**: ${entry.task}  `,
    `**标签**: ${tags}  `,
    `**添加时间**: ${entry.added_at?.slice(0, 10) || '—'}  `,
    entry.source_project ? `**来源项目**: ${entry.source_project}  ` : null,
    '',
    '## 描述',
    entry.description,
    '',
    '## 背景',
    entry.context || '—',
    '',
    '## 核心经验',
    entry.insight,
    '',
    '## 结果',
    entry.outcome || '—',
    '',
  ].filter(l => l !== null).join('\n');
}

// ─── Prompt helper ────────────────────────────────────────────────────────────

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * oma xp add [--stage <s>] [--name <n>] [--description <d>] [--tag <t1,t2>]
 *
 * --name and --description are REQUIRED (either via flag or interactive prompt).
 * Passing them as flags lets Codex call this non-interactively for the two key
 * index fields; remaining fields are still filled interactively.
 */
async function add({ stage, nameCli, descriptionCli, tagsCli } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n📚 OMA 经验库 — 添加新经验\n');

  // ── Stage (required) ────────────────────────────────────────────────────────
  if (!stage || !VALID_STAGES.includes(stage)) {
    const raw = await ask(rl, `阶段 (${VALID_STAGES.join('/')}): `);
    stage = raw.trim();
    if (!VALID_STAGES.includes(stage)) {
      console.error(`无效阶段: ${stage}`);
      rl.close(); process.exit(1);
    }
  } else {
    console.log(`阶段: ${stage}`);
  }

  // ── name (必填) — 预填时直接确认，否则强制输入直到非空 ──────────────────────
  let name = nameCli?.trim() || '';
  if (name) {
    console.log(`经验名: ${name}`);
  } else {
    while (!name) {
      name = (await ask(rl, '经验名 [必填] (kebab-case，如: ankle-kd-tuning): ')).trim();
      if (!name) console.log('  ⚠️  经验名不能为空，请重新输入。');
    }
  }

  // ── description (必填) — 预填时直接确认，否则强制输入直到非空 ────────────────
  let description = descriptionCli?.trim() || '';
  if (description) {
    console.log(`描述: ${description}`);
  } else {
    while (!description) {
      description = (await ask(rl, '一句话描述 [必填] (显示在索引里，供快速判断相关性): ')).trim();
      if (!description) console.log('  ⚠️  描述不能为空，请重新输入。');
    }
  }

  // ── 其余字段（选填）──────────────────────────────────────────────────────────
  const robot_type = (await ask(rl, '机器人类型 (biped/quadruped/arm/wheel/other): ')).trim() || 'other';
  const task       = (await ask(rl, '任务类型 (locomotion/manipulation/navigation/other): ')).trim() || 'other';
  const context    = (await ask(rl, '背景/场景 (什么情况下发现的): ')).trim();
  const insight    = (await ask(rl, '核心经验 (做了什么，为什么有效): ')).trim();
  const outcome    = (await ask(rl, '结果/收益 (量化或描述): ')).trim();

  const tagPrompt = tagsCli
    ? `标签 (已预填: ${tagsCli}，回车确认或覆盖): `
    : '标签 (逗号分隔，如: ankle,kd,biped): ';
  const tags_raw = (await ask(rl, tagPrompt)).trim() || tagsCli || '';
  const src      = (await ask(rl, '来源项目 (可选，回车跳过): ')).trim();

  rl.close();

  const tags = tags_raw.split(',').map(t => t.trim()).filter(Boolean);
  const id   = generateId(stage);

  const entry = {
    id,
    name,
    stage,
    robot_type,
    task,
    description,   // ← shown in index for quick relevance check
    tags,
    added_at: new Date().toISOString(),
    source_project: src || null,
    // full content below — stored only in the .md file
    _context: context,
    _insight: insight,
    _outcome: outcome,
  };

  // 1. Write experience file
  ensureDirs();
  const filePath = xpFilePath(id);
  const fileContent = renderExperienceFile({
    ...entry,
    context: entry._context,
    insight: entry._insight,
    outcome: entry._outcome,
  });
  fs.writeFileSync(filePath, fileContent, 'utf8');

  // 2. Append to index (index stores only lightweight fields)
  const indexEntry = {
    id,
    name,
    stage,
    robot_type,
    task,
    description,
    tags,
    added_at: entry.added_at,
    source_project: entry.source_project,
  };
  const index = loadIndex();
  index.push(indexEntry);
  saveIndex(index);

  console.log(`\n✅ 经验已保存`);
  console.log(`   ID   : ${id}`);
  console.log(`   名称 : ${name}`);
  console.log(`   文件 : ${filePath}`);
  console.log(`   索引 : ${GLOBAL_XP_INDEX}\n`);
}

/**
 * oma xp tag <id> <tag1> [tag2 ...]
 * Add tags to an existing experience (updates index + rewrites file header).
 */
function tagCmd({ id, newTags } = {}) {
  if (!id || !newTags?.length) {
    console.error('用法: oma xp tag <id> <tag1> [tag2 ...]');
    process.exit(1);
  }

  const index = loadIndex();
  const pos = index.findIndex(e => e.id === id);
  if (pos === -1) {
    console.error(`未找到经验: ${id}`);
    process.exit(1);
  }

  const existing = new Set(index[pos].tags || []);
  const added = newTags.map(t => t.trim()).filter(t => t && !existing.has(t));
  if (!added.length) {
    console.log(`[${id}] 标签无变化（都已存在）: ${[...existing].join(', ')}`);
    return;
  }

  added.forEach(t => existing.add(t));
  index[pos].tags = [...existing];
  saveIndex(index);

  // Rewrite the experience file to reflect new tags
  const filePath = xpFilePath(id);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const tagLine = `**标签**: ${index[pos].tags.map(t => `\`${t}\``).join(' ')}  `;
    content = content.replace(/\*\*标签\*\*:.*/, tagLine);
    fs.writeFileSync(filePath, content, 'utf8');
  }

  console.log(`✅ [${id}] 已添加标签: ${added.join(', ')}`);
  console.log(`   当前全部标签: ${index[pos].tags.join(', ')}`);
}

/**
 * oma xp index [--stage <s>] [--tag <t>] [--format table|md|json]
 *
 * Print xp-index.json in the requested format.
 * This is the primary Codex entry point — lightweight, no file I/O beyond the index.
 *
 * Codex reads this first, then decides which IDs to `show` for full content.
 */
function indexCmd({ stage, tag, format = 'table' } = {}) {
  let entries = loadIndex();

  if (stage) entries = entries.filter(e => e.stage === stage);
  if (tag)   entries = entries.filter(e => (e.tags || []).includes(tag));

  if (entries.length === 0) {
    if (stage || tag) {
      console.log(`没有符合条件的经验（stage=${stage || '*'}, tag=${tag || '*'}）。`);
    } else {
      console.log('经验库为空。运行 `oma xp add` 添加第一条经验。');
    }
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (format === 'md') {
    const filterStr = [stage && `stage:${stage}`, tag && `tag:${tag}`].filter(Boolean).join(', ');
    console.log(`# OMA Experience Index${filterStr ? ` — ${filterStr}` : ''}`);
    console.log(`_${entries.length} 条经验。读完此表再决定是否 \`oma xp show <id>\` 查看全文。_\n`);
    console.log('| ID | 阶段 | 机器人 | 任务 | 名称 | 描述 | 标签 |');
    console.log('|---|---|---|---|---|---|---|');
    for (const e of entries) {
      const tags = (e.tags || []).join(', ') || '—';
      console.log(`| \`${e.id}\` | ${e.stage} | ${e.robot_type} | ${e.task} | **${e.name}** | ${e.description} | ${tags} |`);
    }
    console.log('');
    return;
  }

  // Terminal table
  const col = (s, n) => String(s ?? '').substring(0, n).padEnd(n);
  console.log('\n' + col('ID', 12) + col('Stage', 8) + col('Robot', 11) + col('Tags', 25) + col('Name', 28) + 'Description');
  console.log('─'.repeat(115));
  for (const e of entries) {
    console.log(
      col(e.id, 12) +
      col(e.stage, 8) +
      col(e.robot_type, 11) +
      col((e.tags || []).join(','), 25) +
      col(e.name, 28) +
      (e.description || '').substring(0, 40)
    );
  }
  console.log(`\n共 ${entries.length} 条。运行 \`oma xp show <id>\` 查看完整经验文件。\n`);
}

/**
 * oma xp show <id>
 * Print the full Markdown experience file to stdout.
 * Codex reads this after scanning the index and deciding the entry is relevant.
 */
function show({ id } = {}) {
  if (!id) {
    console.error('用法: oma xp show <id>  (例: oma xp show deploy-001)');
    process.exit(1);
  }

  // Verify it's in the index
  const idx = loadIndex().find(e => e.id === id);
  if (!idx) {
    console.error(`未找到经验: ${id}`);
    process.exit(1);
  }

  const filePath = xpFilePath(id);
  if (!fs.existsSync(filePath)) {
    console.error(`经验文件丢失: ${filePath}  (索引中有记录，但文件不存在 — 运行 oma xp reindex 修复)`);
    process.exit(1);
  }

  console.log(fs.readFileSync(filePath, 'utf8'));
}

/**
 * oma xp search <query> [--stage <stage>] [--format table|md]
 * Two-pass search:
 *   Pass 1: match index fields (id, name, description, tags) — cheap
 *   Pass 2: read matching files for full-text match — only for index hits
 */
function search({ query, stage, format = 'md' } = {}) {
  if (!query) {
    console.error('用法: oma xp search <关键词>');
    process.exit(1);
  }

  const terms = query.toLowerCase().split(/\s+/);

  function scoreIndex(e) {
    const text = [e.id, e.name, e.description, ...(e.tags || [])].join(' ').toLowerCase();
    return terms.reduce((s, t) => s + (text.includes(t) ? 2 : 0), 0);
  }

  function scoreFile(id) {
    const fp = xpFilePath(id);
    if (!fs.existsSync(fp)) return 0;
    const text = fs.readFileSync(fp, 'utf8').toLowerCase();
    return terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
  }

  let entries = loadIndex();
  if (stage) entries = entries.filter(e => e.stage === stage);

  // Score each entry: index score (weight 2x) + file content score (weight 1x)
  const scored = entries
    .map(e => {
      const si = scoreIndex(e);
      const sf = si > 0 ? scoreFile(e.id) : 0;   // only read file if index already matched
      return { ...e, _score: si + sf };
    })
    .filter(e => e._score > 0)
    .sort((a, b) => b._score - a._score);

  if (scored.length === 0) {
    console.log(`未找到与 "${query}" 相关的经验。`);
    return;
  }

  if (format === 'md') {
    console.log(`# 经验搜索: "${query}" — ${scored.length} 条结果\n`);
    console.log('_摘要如下。使用 `oma xp show <id>` 查看全文。_\n');
    for (const e of scored) {
      const tags = (e.tags || []).map(t => `\`${t}\``).join(' ') || '—';
      console.log(`## [${e.id}] ${e.name}  _(${e.stage} / ${e.robot_type})_`);
      console.log(`> ${e.description}`);
      console.log(`标签: ${tags}\n`);
    }
  } else {
    const col = (s, n) => String(s ?? '').substring(0, n).padEnd(n);
    console.log('\n' + col('ID', 12) + col('Stage', 8) + col('Name', 28) + 'Description');
    console.log('─'.repeat(90));
    for (const e of scored) {
      console.log(col(e.id, 12) + col(e.stage, 8) + col(e.name, 28) + (e.description || '').substring(0, 40));
    }
    console.log('');
  }
}

/**
 * oma xp list [--stage <s>] [--tag <t>] [--format table|md]
 * Alias for indexCmd — list is just the index, not the heavy content.
 */
function list(opts) {
  return indexCmd(opts);
}

/**
 * oma xp delete <id>
 * Remove experience file and update index.
 */
function del({ id } = {}) {
  if (!id) {
    console.error('用法: oma xp delete <id>');
    process.exit(1);
  }

  const index = loadIndex();
  const filtered = index.filter(e => e.id !== id);
  if (filtered.length === index.length) {
    console.error(`未找到经验: ${id}`);
    process.exit(1);
  }

  // Remove file
  const filePath = xpFilePath(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  saveIndex(filtered);
  console.log(`✅ 已删除经验: ${id}`);
}

/**
 * oma xp reindex
 * Rebuild xp-index.json by scanning all .md files in experiences/.
 * Use after manual edits to files or after migration from old JSONL format.
 */
function reindex() {
  if (!fs.existsSync(GLOBAL_XP_XP_DIR)) {
    console.log('experiences/ 目录不存在，索引为空。');
    saveIndex([]);
    return;
  }

  const files = fs.readdirSync(GLOBAL_XP_XP_DIR).filter(f => f.endsWith('.md'));
  const entries = [];

  for (const file of files) {
    const id = file.replace(/\.md$/, '');
    const content = fs.readFileSync(path.join(GLOBAL_XP_XP_DIR, file), 'utf8');

    // Extract fields from Markdown header
    const get = (key) => {
      const m = content.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*(.+?)\\s*$`, 'm'));
      return m ? m[1].replace(/\s*\*+$/, '').trim() : null;
    };

    const titleMatch = content.match(/^#\s+\[([^\]]+)\]\s+(.+)$/m);
    const name  = titleMatch?.[2]?.trim() || id;
    const stage = get('阶段') || 'deploy';

    // Description is the first line of the 描述 section
    const descMatch = content.match(/## 描述\s*\n+(.+)/);
    const description = descMatch?.[1]?.trim() || '';

    // Tags: extract from backtick list
    const tagMatch = content.match(/\*\*标签\*\*:\s*(.+)/);
    const tags = tagMatch
      ? [...tagMatch[1].matchAll(/`([^`]+)`/g)].map(m => m[1])
      : [];

    const robot_type = get('机器人')?.split(/\s+/)[0] || 'other';
    const task       = get('任务')?.split(/\s+/)[0] || 'other';
    const added_at   = get('添加时间') || null;
    const source_project = get('来源项目') || null;

    entries.push({ id, name, stage, robot_type, task, description, tags, added_at, source_project });
  }

  saveIndex(entries);
  console.log(`✅ 索引已重建：${entries.length} 条经验 → ${GLOBAL_XP_INDEX}`);
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function help() {
  console.log(`
oma xp — 全局经验库管理

存储结构:
  ~/.oma/xp-index.json         轻量索引（id / name / description / stage / tags）
  ~/.oma/experiences/<id>.md   每条经验的完整 Markdown 文件

Codex 推荐使用流程:
  1. oma xp index --format md          先看索引，判断哪些经验相关
  2. oma xp show <id>                  读取相关经验的完整内容
  3. oma xp search "<词>" --stage <s>  有明确关键词时直接全文搜索

用法:
  oma xp add [--stage <s>] [--name <n>] [--description <d>] [--tag <t1,t2>]
                                               添加新经验（name/description 必填）
  oma xp tag <id> <tag1> [tag2 ...]            为已有经验追加标签
  oma xp index [--stage <s>] [--tag <t>]       打印轻量索引
               [--format table|md|json]
  oma xp show <id>                             查看经验完整内容
  oma xp search <关键词> [--stage <s>]          两阶段搜索（索引 + 全文）
  oma xp list                                  同 index（别名）
  oma xp delete <id>                           删除经验
  oma xp reindex                               从 experiences/*.md 重建索引

有效阶段: ${VALID_STAGES.join(', ')}

示例:
  oma xp add --stage deploy --name ankle-kd-tuning --description "降低 ankle kd 消除颤振" --tag ankle,kd
  oma xp add --stage tune   # 纯交互模式，name/description 会强制提示直到填写
  oma xp tag deploy-003 biped locomotion
  oma xp index --stage deploy --format md
  oma xp search "ankle kd" --stage deploy
  oma xp show deploy-001
`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function xp(args = [], flags = {}) {
  const sub         = args[0];
  const stage       = flags['--stage']       || null;
  const tag         = flags['--tag']         || null;
  const format      = flags['--format']      || undefined;
  const nameCli     = flags['--name']        || null;   // ← new
  const descCli     = flags['--description'] || flags['--desc'] || null;  // ← new
  const id          = args[1] || null;
  const newTags     = args.slice(2);
  const tagsCli     = tag || null;

  switch (sub) {
    case 'add':     return add({ stage, nameCli, descriptionCli: descCli, tagsCli });
    case 'tag':     return tagCmd({ id, newTags });
    case 'index':   return indexCmd({ stage, tag, format });
    case 'list':    return list({ stage, tag, format });
    case 'search':  return search({ query: args.slice(1).join(' ') || flags['--query'], stage, format });
    case 'show':    return show({ id });
    case 'delete':
    case 'del':     return del({ id });
    case 'reindex': return reindex();
    default:        return help();
  }
}

module.exports = { xp, GLOBAL_XP_INDEX, GLOBAL_XP_XP_DIR, VALID_STAGES };
