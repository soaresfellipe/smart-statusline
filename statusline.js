#!/usr/bin/env node
'use strict';
/*
 * A three-line status line for Claude Code. Node only, no dependencies.
 *
 *   [dir] my-project (main) +327 -40
 *   Opus 5   [bar]  13% . [clock] 1h6
 *   5h 35% ~ 3h32 . 7d 45% ~ 7h52
 *
 * Everything comes from the JSON Claude Code writes to stdin:
 *   workspace.project_dir, model.display_name
 *   context_window.used_percentage
 *   cost.total_lines_added / _removed / total_duration_ms
 *   rate_limits.five_hour / .seven_day / .spend_limit (used_percentage + resets_at)
 *
 * Note: the payload has no per-model limit window. Usage from every model,
 * Opus and Fable included, lands in the same 5h and 7d buckets.
 *
 * Environment variables (all optional):
 *   CLAUDE_STATUSLINE_LINES=1            collapse everything onto one line
 *   CLAUDE_STATUSLINE_BAR_WIDTH=28       context bar width (0 hides the bar)
 *   CLAUDE_STATUSLINE_BAR_STYLE=braille  braille | blocks | ascii
 *   CLAUDE_STATUSLINE_ICONS=emoji        emoji | nerd (needs a Nerd Font) | plain
 *   CLAUDE_STATUSLINE_NO_COLOR=1         disable ANSI colors
 *   CLAUDE_STATUSLINE_CACHE=<path>       where to cache the rate-limit windows
 *   CLAUDE_STATUSLINE_SHOW_COST=1        append the session cost to line 2
 *   CLAUDE_STATUSLINE_LIMIT_WARN=50      rate-limit thresholds (yellow / red)
 *   CLAUDE_STATUSLINE_LIMIT_CRIT=80
 *   CLAUDE_STATUSLINE_CTX_WARN=60        context thresholds (yellow / red)
 *   CLAUDE_STATUSLINE_CTX_CRIT=80
 *   CLAUDE_STATUSLINE_PROJECT=1          projected time-to-100% on the 7d window
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const E = process.env;
const numEnv = (v, d) => (v !== undefined && !isNaN(parseFloat(v)) ? parseFloat(v) : d);
const flag = (v, d) => (v === undefined ? d : v === '1' || v === 'true');
const CFG = {
  lines: numEnv(E.CLAUDE_STATUSLINE_LINES, 3),
  barWidth: numEnv(E.CLAUDE_STATUSLINE_BAR_WIDTH, 28),
  barStyle: E.CLAUDE_STATUSLINE_BAR_STYLE || 'braille',
  icons: E.CLAUDE_STATUSLINE_ICONS || 'emoji',
  color: E.CLAUDE_STATUSLINE_NO_COLOR !== '1',
  cache: E.CLAUDE_STATUSLINE_CACHE || path.join(os.homedir(), '.claude', 'cache', 'rate-limits.json'),
  showCost: flag(E.CLAUDE_STATUSLINE_SHOW_COST, false),
  warn: numEnv(E.CLAUDE_STATUSLINE_LIMIT_WARN, 50),
  crit: numEnv(E.CLAUDE_STATUSLINE_LIMIT_CRIT, 80),
  ctxWarn: numEnv(E.CLAUDE_STATUSLINE_CTX_WARN, 60),
  ctxCrit: numEnv(E.CLAUDE_STATUSLINE_CTX_CRIT, 80),
  project: flag(E.CLAUDE_STATUSLINE_PROJECT, true),
};

const C = {
  proj:   [224, 108, 80],
  green:  [138, 176, 96],
  yellow: [214, 176, 90],
  red:    [204, 92, 84],
  dim:    [110, 108, 104],
  gray:   [150, 147, 142],
  text:   [214, 210, 204],
};
const fg = (c, s) => (CFG.color ? '\x1b[38;2;' + c[0] + ';' + c[1] + ';' + c[2] + 'm' + s + '\x1b[0m' : s);

const ICONS = {
  // Font Awesome glyphs from the Nerd Fonts "fa" set — needs a patched
  // (Nerd Font) terminal font to render as anything but a blank box.
  nerd:  { folder: '', clock: '', reset: '', trend: '' },
  emoji: { folder: '\u{1F4C1}', clock: '\u{1F551}', reset: '↻', trend: '\u{1F4C8}' },
  plain: { folder: '', clock: '', reset: '~', trend: '->' },
};
const I = ICONS[CFG.icons] || ICONS.emoji;
const BARS = {
  braille: ['⣿', '⣀'],
  blocks:  ['█', '░'],
  ascii:   ['#', '.'],
};

// ---------- input ----------
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) {}
const cost = input.cost || {};
const cwd = (input.workspace && (input.workspace.current_dir || input.workspace.project_dir)) || input.cwd || process.cwd();
const projectDir = (input.workspace && input.workspace.project_dir) || cwd;

// ---------- rate-limit cache ----------
// rate_limits only shows up after the first API response of a session, and
// Claude Code drops a window once it resets. The cache fills that early gap;
// reused values are marked with a trailing ~.
//
// The same file also keeps a rolling history of used_percentage samples per
// window, so projectEta() can fit a trend line and estimate a time-to-100%.
const now = Math.floor(Date.now() / 1000);
const WINDOW_SECS = { seven_day: 7 * 86400, five_hour: 5 * 3600 };
const PROJECT_KEYS = CFG.project ? ['seven_day'] : [];
const MIN_SPAN_SECS = 20 * 60;
const MAX_ETA_SECS = 28 * 86400;
const RESET_DROP_PTS = 1; // a real renewal drops usage back near 0%, not a jitter-sized dip

let cached = {};
try { cached = JSON.parse(fs.readFileSync(CFG.cache, 'utf8')); } catch (_) {}
let history = cached.history || {};

let limits = input.rate_limits || null;
if (limits) {
  for (const key of PROJECT_KEYS) {
    const w = limits[key];
    if (!w || w.used_percentage == null) continue;
    const resetsAt = w.resets_at || null;
    const p = Number(w.used_percentage);
    let arr = history[key] || [];
    // used% only climbs while a window is active, across every session that
    // shares this cache file — a drop means the window actually renewed.
    // (resets_at can shift slightly between reports even without a real
    // reset, so it's tracked but not used to trigger the clear.)
    const lastP = arr.length ? arr[arr.length - 1].p : null;
    if (lastP != null && p < lastP - RESET_DROP_PTS) arr = [];
    arr.push({ t: now, p, r: resetsAt });
    const span = WINDOW_SECS[key] || 7 * 86400;
    const windowStart = resetsAt ? resetsAt - span : now - span;
    history[key] = arr.filter((s) => s.t >= windowStart).slice(-300);
  }
  try {
    fs.mkdirSync(path.dirname(CFG.cache), { recursive: true });
    fs.writeFileSync(CFG.cache, JSON.stringify({ ts: now, rate_limits: limits, history }));
  } catch (_) {}
} else {
  const live = {};
  for (const k of Object.keys(cached.rate_limits || {})) {
    const w = cached.rate_limits[k];
    if (w && (!w.resets_at || w.resets_at > now)) live[k] = Object.assign({ stale: true }, w);
  }
  if (Object.keys(live).length) limits = live;
}

// Fits a line through the recorded (time, used%) samples for `key` and
// projects when usage would cross 100% if the current pace holds.
function projectEta(key) {
  const arr = history[key];
  if (!arr || arr.length < 2) return null;
  const first = arr[0], last = arr[arr.length - 1];
  if (last.t - first.t < MIN_SPAN_SECS) return null;
  let n = 0, sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const s of arr) {
    const x = s.t - first.t;
    n++; sumX += x; sumY += s.p; sumXY += x * s.p; sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (!denom) return null;
  const slope = (n * sumXY - sumX * sumY) / denom; // % per second
  if (slope <= 0) return null;
  const remaining = 100 - last.p;
  if (remaining <= 0) return { seconds: 0 };
  const seconds = remaining / slope;
  return seconds <= MAX_ETA_SECS ? { seconds } : null;
}

// ---------- git ----------
function git(args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 });
}
let branch = null;
try {
  for (const line of git(['status', '--porcelain=v2', '--branch']).split('\n')) {
    if (line.startsWith('# branch.head ')) { branch = line.slice(14).trim(); break; }
  }
  if (branch === '(detached)') branch = git(['rev-parse', '--short', 'HEAD']).trim();
} catch (_) {}

// ---------- helpers ----------
const colorFor = (p, warn, crit) => (p >= crit ? C.red : p >= warn ? C.yellow : C.green);

function bar(p, col) {
  const w = CFG.barWidth;
  if (!w) return '';
  const chars = BARS[CFG.barStyle] || BARS.braille;
  const filled = Math.max(0, Math.min(w, Math.round((Math.min(p, 100) / 100) * w)));
  return fg(col, chars[0].repeat(filled)) + fg(C.dim, chars[1].repeat(w - filled));
}

function fmtDur(s) {
  if (s <= 0) return 'now';
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d) return d + 'd' + h + 'h';
  if (h) return h + 'h' + String(m).padStart(2, '0');
  return m + 'm';
}

function until(epoch) {
  if (!epoch) return null;
  return fmtDur(epoch - now);
}

function dur(ms) {
  if (!ms) return null;
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  return h ? h + 'h' + m : m + 'm';
}

function limitSeg(key, label, opts) {
  const w = limits && limits[key];
  if (!w || w.used_percentage == null) return null;
  const p = Number(w.used_percentage);
  const col = colorFor(p, CFG.warn, CFG.crit);
  const reset = until(w.resets_at);
  let out = fg(C.text, label) + ' ' + fg(col, p.toFixed(0) + '%' + (w.stale ? '~' : ''));
  if (reset) out += ' ' + fg(C.dim, (I.reset ? I.reset + ' ' : '') + reset);
  if (opts && opts.project) {
    const eta = projectEta(key);
    // only worth flagging if 100% would land before the window resets and
    // wipes the count anyway
    const resetRemaining = w.resets_at ? w.resets_at - now : MAX_ETA_SECS;
    if (eta && eta.seconds <= resetRemaining) {
      out += ' ' + fg(C.red, (I.trend ? I.trend + ' ' : '') + fmtDur(eta.seconds));
    }
  }
  return out;
}

const SEP = fg(C.dim, ' · ');

// ---------- line 1: project ----------
const l1 = [];
const projName = path.basename(projectDir.replace(/[\\/]+$/, '')) || projectDir;
l1.push((I.folder ? fg(C.gray, I.folder) + ' ' : '') + fg(C.proj, projName));
if (branch) l1.push(fg(C.gray, '(' + branch + ')'));
const add = cost.total_lines_added || 0;
const del = cost.total_lines_removed || 0;
if (add) l1.push(fg(C.green, '+' + add));
if (del) l1.push(fg(C.red, '-' + del));

// ---------- line 2: model, context, elapsed ----------
const l2 = [];
if (input.model) l2.push(fg(C.text, String(input.model.display_name || input.model.id).replace(/^Claude\s+/i, '')));
const ctx = input.context_window && input.context_window.used_percentage;
if (ctx != null) {
  const v = Number(ctx);
  l2.push(bar(v, colorFor(v, CFG.ctxWarn, CFG.ctxCrit)) + '  ' + fg(C.gray, v.toFixed(0) + '%'));
} else {
  l2.push(fg(C.dim, 'ctx --'));
}
const elapsed = dur(cost.total_duration_ms);
if (elapsed) l2.push((I.clock ? fg(C.gray, I.clock) + ' ' : '') + fg(C.text, elapsed));
if (CFG.showCost && cost.total_cost_usd) l2.push(fg(C.dim, '$' + Number(cost.total_cost_usd).toFixed(2)));

// ---------- line 3: plan usage ----------
const l3 = [limitSeg('five_hour', '5h'), limitSeg('seven_day', '7d', { project: true }), limitSeg('spend_limit', 'spend')].filter(Boolean);
if (!l3.length) l3.push(fg(C.dim, 'plan usage unavailable'));

// ---------- output ----------
const row2 = l2[0] + (l2.length > 1 ? '  ' + l2.slice(1).join(SEP) : '');
const rows = [l1.join(' '), row2, l3.join(SEP)];
process.stdout.write((CFG.lines === 1 ? rows.join(SEP) : rows.join('\n')) + '\n');
