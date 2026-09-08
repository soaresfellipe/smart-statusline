# claude-code-statusline-node

A three-line status line for [Claude Code](https://code.claude.com/docs), written in Node with **no dependencies and no `jq`** — so it runs on Windows out of the box, where `jq` usually isn't installed but Node almost always is.

```
📁 my-project (main) +327 -40
Fable 5.1  ⣿⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀  13% · 🕐 1h6
5h 35% ↻ 3h32 · 7d 45% ↻ 7h52
```

- **Line 1** — project directory, git branch, and lines added/removed this session.
- **Line 2** — model, context window usage as a braille bar, and session duration.
- **Line 3** — your plan's rolling **5-hour** and **7-day** usage windows, each with a countdown to its reset.

Percentages are color-coded: green, yellow past the warning threshold, red past the critical one.

## Install

Requires Node 14+ and Claude Code. Clone anywhere:

```bash
git clone https://github.com/soaresfellipe/claude-code-statusline-node.git ~/.claude/statusline-node
```

Then point `statusLine` at it in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/absolute/path/to/statusline.js\"",
    "refreshInterval": 60000
  }
}
```

On Windows use forward slashes in the path (`C:/Users/you/.claude/statusline-node/statusline.js`) — they work fine and avoid escaping backslashes in JSON.

`refreshInterval` is optional but recommended: Claude Code only re-runs the status line on events like a new assistant message, so without a timer the reset countdowns freeze while the session sits idle.

Changing the `command` takes effect immediately — no restart needed.

## Configuration

Everything is driven by environment variables; there is no config file.

| Variable | Default | What it does |
| --- | --- | --- |
| `CLAUDE_STATUSLINE_LINES` | `3` | Set to `1` to collapse everything onto a single line |
| `CLAUDE_STATUSLINE_BAR_WIDTH` | `28` | Context bar width; `0` hides the bar |
| `CLAUDE_STATUSLINE_BAR_STYLE` | `braille` | `braille` (`⣿⣀`), `blocks` (`█░`), or `ascii` (`#.`) |
| `CLAUDE_STATUSLINE_ICONS` | `emoji` | `emoji`, `nerd` (Nerd Font glyphs), or `plain` (no icons) |
| `CLAUDE_STATUSLINE_NO_COLOR` | — | `1` disables ANSI color |
| `CLAUDE_STATUSLINE_SHOW_COST` | — | `1` appends the session cost in USD to line 2 |
| `CLAUDE_STATUSLINE_LIMIT_WARN` / `_LIMIT_CRIT` | `50` / `80` | Rate-limit thresholds for yellow / red |
| `CLAUDE_STATUSLINE_CTX_WARN` / `_CTX_CRIT` | `60` / `80` | Context-usage thresholds for yellow / red |
| `CLAUDE_STATUSLINE_CACHE` | `~/.claude/cache/rate-limits.json` | Where the rate-limit windows are cached |

Set them in the `env` block of `settings.json`, or inline in the command:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"C:/Users/you/.claude/statusline-node/statusline.js\""
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

## Testing it

Pipe a mock payload in:

```bash
echo '{"model":{"display_name":"Opus 5"},"workspace":{"project_dir":"/home/me/proj"},"context_window":{"used_percentage":13},"cost":{"total_duration_ms":3960000,"total_lines_added":327,"total_lines_removed":40},"rate_limits":{"five_hour":{"used_percentage":35,"resets_at":1893456000}}}' | node statusline.js
```

## Credits

Inspired by [k8adev/claude-code-statusline](https://github.com/k8adev/claude-code-statusline) — the three-line layout follows its design closely. That project is Bash + `jq`; this is an independent Node rewrite sharing none of its code, written so the status line works without installing `jq`.

## License

MIT — see [LICENSE](LICENSE).
