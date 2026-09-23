# smart-statusline

A three-line status line for [Claude Code](https://code.claude.com/docs), written in Node with **no dependencies and no `jq`**. It's a single portable script — the same file runs unmodified on Windows, Linux, and macOS, regardless of whether Claude Code itself is the native binary or the `npm install -g @anthropic-ai/claude-code` package.

```
📁 my-project (main) +327 -40
Fable 5.1  ⣿⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀  13% · 🕐 1h6
5h 35% ↻ 3h32 · 7d 78% ↻ 2d4h · Fable 39% ↻ 1d18h
```

- **Line 1** — project directory, git branch, and lines added/removed this session.
- **Line 2** — model, context window usage as a braille bar, and session duration.
- **Line 3** — your plan's rolling **5-hour** and **7-day** usage windows plus the **Fable weekly limit**, each with a countdown to its reset — see [The Fable weekly limit](#the-fable-weekly-limit).

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
| `CLAUDE_STATUSLINE_ICONS` | `emoji` | `emoji`, `nerd` (Nerd Font glyphs), or `plain` (no icons) |
| `CLAUDE_STATUSLINE_NO_COLOR` | — | `1` disables ANSI color |
| `CLAUDE_STATUSLINE_SHOW_COST` | — | `1` appends the session cost in USD to line 2 |
| `CLAUDE_STATUSLINE_LIMIT_WARN` / `_LIMIT_CRIT` | `50` / `80` | Rate-limit thresholds for yellow / red |
| `CLAUDE_STATUSLINE_CTX_WARN` / `_CTX_CRIT` | `60` / `80` | Context-usage thresholds for yellow / red |
| `CLAUDE_STATUSLINE_CACHE` | `$CLAUDE_CONFIG_DIR/cache/rate-limits.json` (`~/.claude/…` by default) | Where the rate-limit windows (including the fetched Fable / Z.ai windows) are cached |
| `CLAUDE_STATUSLINE_FABLE` | `1` | Set to `0` to hide the Fable weekly limit |
| `CLAUDE_STATUSLINE_PROVIDER` | auto | `zai` forces the Z.ai (GLM Coding Plan) usage line; auto-detected when `ANTHROPIC_BASE_URL` points at `z.ai` / `bigmodel.cn` |

> Prefer sharper glyphs over emoji? Set `CLAUDE_STATUSLINE_ICONS=nerd` — but only if your terminal has a [Nerd Font](https://www.nerdfonts.com/) patched in, otherwise the icons show up as blank boxes.

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
- **The stdin payload has no per-model window.** Usage from every model — Opus, Fable, Sonnet — is counted against the same 5h and 7d buckets there. The Fable segment comes from a different source; see below.

A `spend_limit` window is also rendered automatically when present (it appears behind a Claude apps gateway with spend limits).

### The Fable weekly limit

Plans with Fable access get a **Fable-scoped weekly limit** in addition to the shared 5h/7d windows, but Claude Code doesn't (yet) include it in the statusline payload. This script fetches it from the same OAuth usage endpoint that powers `/usage` inside Claude Code, authenticating with the Claude Code credentials already on the machine (`~/.claude/.credentials.json`). No extra setup or login is needed.

- The endpoint rate-limits aggressive polling, so the value is fetched **at most every 5 minutes** and cached in between — failed attempts (offline, expired token mid-rotation, endpoint hiccup) back off for the same interval and keep showing the last good value, marked with a trailing `~` once it's over 30 minutes old.
- The segment disappears (rather than erroring) when there's nothing to show: no Fable limit on the plan, no readable credentials, or the window just rolled over and a fresh value hasn't been fetched yet.
- It's an undocumented endpoint, so the parser tolerates the response-shape variants seen in the wild; if the schema drifts beyond that, the segment quietly drops out instead of breaking the status line.

### Z.ai (GLM Coding Plan)

When Claude Code is pointed at [Z.ai](https://docs.z.ai/devpack/tool/claude) (`ANTHROPIC_BASE_URL` on `api.z.ai` or `open.bigmodel.cn`), line 3 switches to the GLM Coding Plan instead of the Anthropic limits:

```
GLM Lite · 5h 4% ↻ 4h33 · 7d 55% ↻ 2d20h
```

- The plan level and its quota windows come from Z.ai's quota monitor endpoint (`/api/monitor/usage/quota/limit`), authenticated with the key Claude Code already uses (`ANTHROPIC_AUTH_TOKEN`, falling back to `~/.config/zai/api_key`).
- It's fetched **at most once a minute** and cached; failures keep the last good value, marked `~` once it's over 30 minutes old. A window past its reset shows `0%~` until the next fetch.
- The Fable and `spend` segments are hidden in this mode, since they describe an Anthropic plan.
- If you run Z.ai under a separate `CLAUDE_CONFIG_DIR`, its cache lives there too, so the two profiles never show each other's numbers.

## Testing it

Pipe a mock payload in:

```bash
echo '{"model":{"display_name":"Opus 5"},"workspace":{"project_dir":"/home/me/proj"},"context_window":{"used_percentage":13},"cost":{"total_duration_ms":3960000,"total_lines_added":327,"total_lines_removed":40},"rate_limits":{"five_hour":{"used_percentage":35,"resets_at":1893456000}}}' | node statusline.js
```

## Credits

Inspired by [k8adev/claude-code-statusline](https://github.com/k8adev/claude-code-statusline) — the three-line layout follows its design closely. That project is Bash + `jq`; this is an independent Node rewrite sharing none of its code, written so the status line works without installing `jq`.

## License

MIT — see [LICENSE](LICENSE).
