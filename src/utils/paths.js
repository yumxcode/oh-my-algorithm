'use strict';

const path = require('path');
const fs   = require('fs');

// Root of the OMA state directory (.oma/) relative to cwd
function omaDir(cwd = process.cwd()) {
  return path.join(cwd, '.oma');
}

// Canonical .oma paths
const OMA = {
  dir:             (cwd) => omaDir(cwd),
  requirements:    (cwd) => path.join(omaDir(cwd), 'requirements.md'),
  designs:         (cwd) => path.join(omaDir(cwd), 'designs'),
  impl:            (cwd) => path.join(omaDir(cwd), 'impl'),
  implChecklist:   (cwd) => path.join(omaDir(cwd), 'impl', 'impl-checklist.md'),
  experiments:     (cwd) => path.join(omaDir(cwd), 'experiments'),
  leaderboard:     (cwd) => path.join(omaDir(cwd), 'leaderboard.json'),
  best:            (cwd) => path.join(omaDir(cwd), 'best.json'),
  trajectory:      (cwd) => path.join(omaDir(cwd), 'trajectory.jsonl'),
  memory:          (cwd) => path.join(omaDir(cwd), 'memory.md'),
};

// Package root (where templates live)
function pkgRoot() {
  return path.resolve(__dirname, '..', '..');
}

function templatePath(name) {
  return path.join(pkgRoot(), 'templates', name);
}

// Helpers
function exists(p) {
  return fs.existsSync(p);
}

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readLines(p) {
  if (!exists(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function readText(p) {
  if (!exists(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

// Generate the next experiment ID: exp-YYYYMMDD-NNN
function nextExpId(cwd = process.cwd()) {
  const expDir = OMA.experiments(cwd);
  const today  = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let seq      = 1;

  if (exists(expDir)) {
    const existing = fs.readdirSync(expDir)
      .filter((d) => d.startsWith(`exp-${today}-`))
      .map((d) => parseInt(d.split('-').pop(), 10))
      .filter((n) => !isNaN(n));
    if (existing.length) seq = Math.max(...existing) + 1;
  }

  return `exp-${today}-${String(seq).padStart(3, '0')}`;
}

module.exports = { OMA, pkgRoot, templatePath, exists, readJSON, readLines, readText, nextExpId };
