'use strict';

// ANSI color helpers — no external dependencies
const ESC = '\x1b[';
const RESET = '\x1b[0m';

const c = {
  bold:    (s) => `${ESC}1m${s}${RESET}`,
  dim:     (s) => `${ESC}2m${s}${RESET}`,
  green:   (s) => `${ESC}32m${s}${RESET}`,
  yellow:  (s) => `${ESC}33m${s}${RESET}`,
  red:     (s) => `${ESC}31m${s}${RESET}`,
  cyan:    (s) => `${ESC}36m${s}${RESET}`,
  blue:    (s) => `${ESC}34m${s}${RESET}`,
  magenta: (s) => `${ESC}35m${s}${RESET}`,
  gray:    (s) => `${ESC}90m${s}${RESET}`,
};

const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY;
// If NO_COLOR or not a TTY, strip all color codes
const color = NO_COLOR
  ? Object.fromEntries(Object.keys(c).map((k) => [k, (s) => s]))
  : c;

function log(msg)  { process.stdout.write(msg + '\n'); }
function err(msg)  { process.stderr.write(msg + '\n'); }
function blank()   { log(''); }

function header(title) {
  const line = '─'.repeat(Math.min(60, process.stdout.columns || 60));
  log(color.bold(color.cyan(`\n${line}`)));
  log(color.bold(color.cyan(`  ${title}`)));
  log(color.bold(color.cyan(line)));
}

function section(title) {
  log(color.bold(`\n  ${title}`));
}

function ok(label, detail = '')  {
  log(`  ${color.green('✓')} ${color.bold(label)}${detail ? color.gray('  ' + detail) : ''}`);
}

function warn(label, detail = '') {
  log(`  ${color.yellow('!')} ${color.bold(label)}${detail ? color.gray('  ' + detail) : ''}`);
}

function fail(label, detail = '') {
  log(`  ${color.red('✗')} ${color.bold(label)}${detail ? color.gray('  ' + detail) : ''}`);
}

function info(label, detail = '') {
  log(`  ${color.cyan('·')} ${label}${detail ? color.gray('  ' + detail) : ''}`);
}

function kv(key, value, { indent = 4, valueColor = null } = {}) {
  const pad = ' '.repeat(indent);
  const v = valueColor ? color[valueColor](String(value)) : color.cyan(String(value));
  log(`${pad}${color.gray(key + ':')}  ${v}`);
}

function table(rows, { indent = 4 } = {}) {
  if (!rows.length) return;
  const pad = ' '.repeat(indent);
  // Compute column widths
  const cols = rows[0].length;
  const widths = Array.from({ length: cols }, (_, ci) =>
    Math.max(...rows.map((r) => String(r[ci] ?? '').replace(/\x1b\[[0-9;]*m/g, '').length))
  );
  rows.forEach((row, ri) => {
    const cells = row.map((cell, ci) => {
      const raw = String(cell ?? '');
      const visible = raw.replace(/\x1b\[[0-9;]*m/g, '');
      const padded = raw + ' '.repeat(Math.max(0, widths[ci] - visible.length));
      return ri === 0 ? color.bold(padded) : padded;
    });
    log(pad + cells.join('  '));
  });
}

module.exports = { log, err, blank, header, section, ok, warn, fail, info, kv, table, color };
