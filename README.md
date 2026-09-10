# smart-statusline

A three-line status line for [Claude Code](https://code.claude.com/docs), written in Node with **no dependencies and no `jq`**. It's a single portable script — the same file runs unmodified on Windows, Linux, and macOS, regardless of whether Claude Code itself is the native binary or the `npm install -g @anthropic-ai/claude-code` package.

```
📁 my-project (main) +327 -40
Fable 5.1  ⣿⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀  13% · 🕐 1h6
5h 35% ↻ 3h32 · 7d 78% ↻ 2d4h 📈 1d9h
```
*(shown here with `emoji` icons so it renders in any README viewer — the actual default is a compact set of Nerd Font glyphs, see [Configuration](#configuration))*

- **Line 1** — project directory, git branch, and lines added/removed this session.
- **Line 2** — model, context window usage as a braille bar, and session duration.
- **Line 3** — your plan's rolling **5-hour** and **7-day** usage windows, each with a countdown to its reset. The 7-day window also gets a 📈 projection, shown only when the current pace would hit 100% *before* the window resets — if the reset comes first, usage is fine and nothing is shown.

Percentages are color-coded: green, yellow past the warning threshold, red past the critical one.

## Install

Requires **Node.js 14+ available as `node` on your `PATH`**, separately from Claude Code — the native Claude Code binary bundles its own runtime but doesn't expose it for other scripts to use, so this needs its own system Node install no matter which way Claude Code got installed.

Clone anywhere:

```bash
git clone https://github.com/soaresfellipe/smart-statusline.git ~/.claude/smart-statusline
```

Then point `statusLine` at it in `~/.claude/settings.json` — same file and format on macOS, Linux, and Windows:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/absolute/path/to/statusline.js\"",
    "refreshInterval": 60000
  }
}
```

- **macOS/Linux**: `node "/home/you/.claude/smart-statusline/statusline.js"`. You can also drop the `node` prefix and call the script directly once it's executable (`chmod +x statusline.js`) — it runs via its own `#!/usr/bin/env node` shebang.
- **Windows**: use forward slashes in the path (`C:/Users/you/.claude/smart-statusline/statusline.js`) — they work fine and avoid escaping backslashes in JSON.

`refreshInterval` is optional but recommended: Claude Code only re-runs the status line on events like a new assistant message, so without a timer the reset countdowns freeze while the session sits idle.

Changing the `command` takes effect immediately — no restart needed.

## Configuration

Everything is driven by environment variables; there is no config file.

| Variable | Default | What it does |
| --- | --- | --- |
| `CLAUDE_STATUSLINE_LINES` | `3` | Set to `1` to collapse everything onto a single line |
| `CLAUDE_STATUSLINE_BAR_WIDTH` | `28` | Context bar width; `0` hides the bar |
| `CLAUDE_STATUSLINE_BAR_STYLE` | `braille` | `braille` (`⣿⣀`), `blocks` (`█░`), or `ascii` (`#.`) |
| `CLAUDE_STATUSLINE_ICONS` | `nerd` | `nerd` (Nerd Font glyphs), `emoji`, or `plain` (no icons) |
| `CLAUDE_STATUSLINE_NO_COLOR` | — | `1` disables ANSI color |
| `CLAUDE_STATUSLINE_SHOW_COST` | — | `1` appends the session cost in USD to line 2 |
| `CLAUDE_STATUSLINE_LIMIT_WARN` / `_LIMIT_CRIT` | `50` / `80` | Rate-limit thresholds for yellow / red |
| `CLAUDE_STATUSLINE_CTX_WARN` / `_CTX_CRIT` | `60` / `80` | Context-usage thresholds for yellow / red |
| `CLAUDE_STATUSLINE_CACHE` | `~/.claude/cache/rate-limits.json` | Where the rate-limit windows (and usage history) are cached |
| `CLAUDE_STATUSLINE_PROJECT` | `1` | Set to `0` to hide the 7-day time-to-100% projection |

> The default `nerd` icon style needs a [Nerd Font](https://www.nerdfonts.com/) patched into your terminal. If the icons show up as blank boxes, your terminal font isn't patched — set `CLAUDE_STATUSLINE_ICONS` to `emoji` or `plain` instead.

Set them in the `env` block of `settings.json`, or inline in the command:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"C:/Users/you/.claude/smart-statusline/statusline.js\""
  },
  "env": {
    "CLAUDE_STATUSLINE_BAR_STYLE": "blocks",
    "CLAUDE_STATUSLINE_ICONS": "plain"
  }
}
```

## About the plan usage line

The 5h/7d numbers come straight from the `rate_limits` object Claude Code passes on stdin. Two things worth knowing:

- **`rate_limits` is only present for Claude.ai Pro and Max subscribers**, and only after the first API response of a session. Before that, this script falls back to the last values it cached and marks them with a trailing `~` rather than showing nothing. If a window has no cached value either, line 3 reads `plan usage unavailable`.
- **There is no per-model limit window.** Usage from every model — Opus, Fable, Sonnet — is counted against the same 5h and 7d buckets, so there is no "Fable limit" to display separately.

A `spend_limit` window is also rendered automatically when present (it appears behind a Claude apps gateway with spend limits).

### The 7-day projection

Each run records a `(time, used%)` sample for the 7-day window in the same cache file, then fits a straight line through the recent samples to estimate when usage would hit 100% at the current pace. A few notes:

- It only shows up when that estimate lands **before** the window's own reset — if the reset would happen first, the count wipes itself out anyway, so there's nothing to flag.
- It needs at least 20 minutes of recent history before it shows anything, so it won't appear on a session's first few prompts.
- History resets whenever the window's `resets_at` changes (i.e. the 7-day window actually rolled over), so a fresh week starts with a fresh trend.
- It's a straight-line fit on recent usage, not a forecast — a burst of heavy use will pull the estimate in sharply, and it settles back down as usage evens out.

## Testing it

Pipe a mock payload in:

```bash
echo '{"model":{"display_name":"Opus 5"},"workspace":{"project_dir":"/home/me/proj"},"context_window":{"used_percentage":13},"cost":{"total_duration_ms":3960000,"total_lines_added":327,"total_lines_removed":40},"rate_limits":{"five_hour":{"used_percentage":35,"resets_at":1893456000}}}' | node statusline.js
```

## Credits

Inspired by [k8adev/claude-code-statusline](https://github.com/k8adev/claude-code-statusline) — the three-line layout follows its design closely. That project is Bash + `jq`; this is an independent Node rewrite sharing none of its code, written so the status line works without installing `jq`.

## License

MIT — see [LICENSE](LICENSE).
