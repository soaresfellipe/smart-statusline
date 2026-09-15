#!/usr/bin/env node
'use strict';
/*
 * A three-line status line for Claude Code. Node only, no dependencies.
 *
 *   [dir] my-project (main) +327 -40
 *   Opus 5   [bar]  13% . [clock] 1h6
 *   5h 35% ~ 3h32 . 7d 45% ~ 7h52 . Fable 20% ~ 3d4h
 *
 * Everything comes from the JSON Claude Code writes to stdin:
 *   workspace.project_dir, model.display_name
 *   context_window.used_percentage
 *   cost.total_lines_added / _removed / total_duration_ms
 *   rate_limits.five_hour / .seven_day / .spend_limit (used_percentage + resets_at)
 *
 * The statusline payload has no per-model window, but the plan does have a
 * Fable-scoped weekly limit. That one is fetched (at most every 5 minutes,
 * cached in between) from the same OAuth usage endpoint that powers /usage,
 * using the Claude Code credentials already on this machine.
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
 *   CLAUDE_STATUSLINE_FABLE=1            set to 0 to hide the Fable weekly limit
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
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
  fable: flag(E.CLAUDE_STATUSLINE_FABLE, true),
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
  nerd:  { folder: '', clock: '', reset: '' },
  emoji: { folder: '\u{1F4C1}', clock: '\u{1F551}', reset: '↻' },
  plain: { folder: '', clock: '', reset: '~' },
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
const now = Math.floor(Date.now() / 1000);

let cached = {};
try { cached = JSON.parse(fs.readFileSync(CFG.cache, 'utf8')); } catch (_) {}

let limits = input.rate_limits || null;
if (!limits) {
  const live = {};
  for (const k of Object.keys(cached.rate_limits || {})) {
    const w = cached.rate_limits[k];
    if (w && (!w.resets_at || w.resets_at > now)) live[k] = Object.assign({ stale: true }, w);
  }
  if (Object.keys(live).length) limits = live;
}

// ---------- Fable weekly limit ----------
// The plan's Fable-scoped weekly window isn't in the statusline payload, but
// the OAuth usage endpoint (the one behind /usage) reports it. It 429s under
// frequent polling, so the fetched window is cached and refreshed at most
// every FABLE_TTL_SECS; failed attempts back off for the same interval and
// keep showing the last good value with a trailing ~.
const FABLE_TTL_SECS = 5 * 60;
const FABLE_STALE_SECS = 30 * 60;
const FABLE_TIMEOUT_MS = 2500;

// epoch seconds | epoch ms | ISO string -> epoch seconds (or null)
function toEpochSecs(v) {
  if (typeof v === 'number' && isFinite(v)) return v > 1e10 ? Math.floor(v / 1000) : Math.floor(v);
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (isFinite(n)) return n > 1e10 ? Math.floor(n / 1000) : Math.floor(n);
    const t = Date.parse(v);
    if (!isNaN(t)) return Math.floor(t / 1000);
  }
  return null;
}

function oauthToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
    const o = raw.claudeAiOauth || raw;
    if (o.expiresAt && toEpochSecs(o.expiresAt) < now) return null; // let Claude Code rotate it
    return o.accessToken || o.access_token || null;
  } catch (_) { return null; }
}

// Accepts the documented-by-observation shapes: a `limits` array entry of
// kind weekly_scoped scoped to the Fable model, or (in case the schema
// shifts) a fable_* top-level window with used_percentage/utilization.
function pickFableWindow(j) {
  if (!j || typeof j !== 'object') return null;
  if (Array.isArray(j.limits)) {
    const hit = j.limits.find((l) => l && l.kind === 'weekly_scoped' && isFinite(l.percent) &&
      l.scope && l.scope.model && String(l.scope.model.display_name || '').trim().toLowerCase() === 'fable');
    if (hit) return { used_percentage: Number(hit.percent), resets_at: toEpochSecs(hit.resets_at) };
  }
  for (const k of ['fable_weekly', 'fable_seven_day', 'seven_day_fable']) {
    const w = j[k];
    if (!w) continue;
    const p = w.used_percentage != null ? w.used_percentage : w.utilization;
    if (p != null && isFinite(Number(p))) return { used_percentage: Number(p), resets_at: toEpochSecs(w.resets_at) };
  }
  return null;
}

function fetchUsage(token) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1.0',
      },
      timeout: FABLE_TIMEOUT_MS,
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function fableWindow() {
  if (!CFG.fable) return null;
  const fc = cached.fable || {};
  const attemptedAt = fc.attemptedAt || 0;
  if (now - attemptedAt > FABLE_TTL_SECS) {
    fc.attemptedAt = now; // back off on failure too, or a 429 storm feeds itself
    const token = oauthToken();
    const win = token ? pickFableWindow(await fetchUsage(token)) : null;
    if (win) {
      fc.window = win;
      fc.fetchedAt = now;
    }
    cached.fable = fc;
  }
  const w = fc.window;
  if (!w || w.used_percentage == null) return null;
  if (w.resets_at && w.resets_at <= now) return null; // window rolled over; wait for a fresh fetch
  return (fc.fetchedAt || 0) < now - FABLE_STALE_SECS ? Object.assign({ stale: true }, w) : w;
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

function limitSeg(w, label) {
  if (!w || w.used_percentage == null) return null;
  const p = Number(w.used_percentage);
  const col = colorFor(p, CFG.warn, CFG.crit);
  const reset = until(w.resets_at);
  let out = fg(C.text, label) + ' ' + fg(col, p.toFixed(0) + '%' + (w.stale ? '~' : ''));
  if (reset) out += ' ' + fg(C.dim, (I.reset ? I.reset + ' ' : '') + reset);
  return out;
}

const SEP = fg(C.dim, ' · ');

(async function main() {
  const fable = await fableWindow();

  try {
    fs.mkdirSync(path.dirname(CFG.cache), { recursive: true });
    fs.writeFileSync(CFG.cache, JSON.stringify({
      ts: now,
      rate_limits: input.rate_limits || cached.rate_limits,
      fable: cached.fable,
    }));
  } catch (_) {}

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
  const l3 = [
    limitSeg(limits && limits.five_hour, '5h'),
    limitSeg(limits && limits.seven_day, '7d'),
    limitSeg(fable, 'Fable'),
    limitSeg(limits && limits.spend_limit, 'spend'),
  ].filter(Boolean);
  if (!l3.length) l3.push(fg(C.dim, 'plan usage unavailable'));

  // ---------- output ----------
  const row2 = l2[0] + (l2.length > 1 ? '  ' + l2.slice(1).join(SEP) : '');
  const rows = [l1.join(' '), row2, l3.join(SEP)];
  process.stdout.write((CFG.lines === 1 ? rows.join(SEP) : rows.join('\n')) + '\n');
})();
