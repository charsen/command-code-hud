# Command Code HUD

A persistent, multi-line heads-up display for [Command Code](https://commandcode.ai). It keeps
the model, project, Git state, context usage, cache hit rate, tools, sub-agents, turns and
session tokens visible under the composer — without touching the Command Code binary.

Inspired by [Codex HUD](https://github.com/konnga/codex-hud) and Claude HUD.

## Repository

- Gitee: <https://gitee.com/charsen/command-code-hud>
- GitHub: <https://github.com/charsen/command-code-hud>

```text
[glm-5.3 high] │ command-code-hud git:(main*) M2 A1 ?1 │ HUD work
Context ▄▄▁▁▁▁▁▁▁▁ 21% · 210K/1M │ cache 7.2M · 95%
Quota 5h ▄▄▄▁▁▁▁▁▁▁ 32% · 3h 12m │ 1w ▄▄▄▄▁▁▁▁▁▁ 41% · 2d 4h │ month ▄▄▄▁▁▁▁▁▁▁ 29% ($23.4/$80)
mode: default │ tools: ✓ shell_command ×41 ✓ read_file ×9 │ agents: explorer×1
⏱ 3h 14m │ turns 6 │ tokens 7.6M (in 7.6M · cache 7.2M · 95% · out 32.4K) │ compactions 2                    HUD 0.1.0
```

## What it shows

| Row | Data | Source |
| --- | --- | --- |
| Identity | Model, reasoning effort, project name, Git branch and dirty counts | `getModel`, `getEffort`, `git status` |
| Context | Context bar, used/window tokens, cache-read tokens and hit rate | `getContextUsage`, `turn_end` usage |
| Quota | 5-hour, weekly and monthly meters, reset times and spend | intercepted `/alpha/billing/credits` response, local transcript estimate, or a manual snapshot |
| Activity | Permission mode, running/finished tools and counts, active sub-agents | `permission_mode_changed`, tool and sub-agent events |
| Session | Duration, turns, input/cache/output tokens, compactions, HUD version | events + durable session entries |

Only rows with data are drawn. A missing measurement shows `—` instead of a fake `0%`.

## Install

Try it without installing:

```bash
cmd --mod /path/to/command-code-hud/src/index.ts
```

Install it for every project (user scope):

```bash
cmd mods add /path/to/command-code-hud -g
```

After publishing to npm, the same package installs with:

```bash
cmd mods add command-code-hud -g
```

Restart Command Code (or run `/mods reload`) after installing. Verify with:

```bash
cmd mods list
cmd mods inspect /path/to/command-code-hud/src/index.ts
```

Then run `/hud status` inside a session.

Uninstall with `cmd mods remove command-code-hud -g`.

## Commands

| Command | Effect |
| --- | --- |
| `/hud` or `/hud status` | Current preset, placement, language, context percent and enabled items |
| `/hud preset full\|essential\|minimal\|presentation` | Apply a preset |
| `/hud lang en\|zh` | Switch the HUD language |
| `/hud plan go\|goat\|pro\|max10\|max20\|team-pro\|custom` | Set the plan caps used by local estimates (`custom <monthly> <5h> <weekly>`) |
| `/hud quota` | Show the quota source, meters, resets and the exact snapshot time |
| `/hud quota set 5h=32 1w=41 [month=29] [used=23.4 cap=80]` | Record the exact meters read from `/usage` |
| `/hud quota auto\|exact\|local` | Prefer the captured snapshot, only the snapshot, or only local estimates |
| `/hud quota refresh` / `/hud quota clear` | Rescan transcripts / drop the exact snapshot |
| `/hud quota cycle <1-28\|auto>` | Set your billing day for the local monthly estimate, or `auto` for a rolling 30 days |
| `/hud on` / `/hud off` / `/hud toggle` | Show or hide the HUD (also `alt+h`) |
| `/hud enable <items>` / `/hud disable <items>` | Toggle individual segments |
| `/hud position above\|below` | Draw above or below the composer |
| `/hud color on\|off` | ANSI colors (honors `NO_COLOR`) |
| `/hud bar block\|half\|none` | Progress-bar style: full block, slim half block (default), or no bar |
| `/hud footer on\|off` | Add a compact `HUD ctx 21%` footer segment |
| `/hud reset` | Restore defaults |
| `/hud debug` | Dump the raw last usage payload and live stats |

Items: `identity`, `project`, `title`, `context`, `cache`, `quota`, `mode`, `tools`, `agents`,
`turns`, `session`, `version`. Aliases such as `model`, `git`, `ctx`, `permission`, `tokens` and
`subagents` are accepted.

Presets:

| Preset | Items |
| --- | --- |
| `full` | Everything (default) |
| `essential` | Identity, project, context, cache, quota, tools, session, version |
| `minimal` | Project and context |
| `presentation` | Identity, project and context |

Session-scoped overrides:

```bash
cmd --mod-option hud-preset=minimal --mod-option hud-lang=zh --mod-option hud-position=above
cmd --mod-option hud-plan=goat
```

## Configuration

`/hud` changes are stored through the mod store (one JSON file per mod, under
`~/.commandcode/mods/.store/`). They survive restarts. CLI flags apply to one session and do not
overwrite the saved config.

Context, turns, token totals, compactions, agent tokens and the session start time are also
appended to the session transcript as a private custom entry, so they survive `--resume`.

The quota interceptor stores the billing response body (usage numbers), URL and status. It
**never** stores request headers, tokens or cookies; the captured headers live in process memory
only and are used for the 5-minute replay. The local quota scan reads only `timestamp`, `id` and
`usage.costUsd` from transcripts, never prompt content. The mod never opens `auth.json`.

## Limitations

- **Quota is captured from the CLI's own billing request.** The `/usage` overlay itself is a
  private UI: it does not emit `command_output`, is not written to the transcript, and the
  ModApi has no quota getter. But the overlay asks `api.commandcode.ai/alpha/billing/credits`,
  so the mod wraps `globalThis.fetch` and reads that response. It extracts the 5-hour and weekly
  `used`/`cap`/`resetAt` and the remaining `monthlyCredits`, infers the plan from the caps, and
  stores the parsed snapshot. The CLI's normal request headers are kept **in memory only**; the
  mod replays the request every 5 minutes to refresh. No auth file is read and no token is
  persisted.
- **The billing endpoint is internal and may change.** If the response shape or URL changes,
  capture stops and the HUD falls back to the manual snapshot or the local estimate. `/hud
  quota` shows which source is active.
- **Manual override and local fallback remain.** `/hud quota set 5h=32 1w=41 month=29 used=23.4
  cap=80` records a snapshot by hand. Without an API capture or manual snapshot, the HUD sums
  `costUsd` and timestamps from `~/.commandcode/projects/**/*.jsonl` using the plan caps from
  `/hud plan`. Local quota counts this machine only, simulates rolling windows from the first
  local request, and can understate credit draw on lower-allowance models. Its monthly window is
  **rolling 30 days** by default, so no per-user billing day is assumed; set your own with
  `/hud quota cycle <1-28>` or return to rolling with `/hud quota cycle auto`. The exact API
  monthly percentage does not depend on this setting.
- **The initial permission mode is unknown.** There is no `getPermissionMode()` getter; the mode
  appears after the first `permission_mode_changed` event (for example after `shift+tab`).
- **Per-tool counts reset on resume.** Token totals, turns and compactions are persisted; the
  tool/session tile counters start fresh in the new process.
- **Cache fields depend on the provider.** Usage keys vary between providers; the normalizer
  accepts the common snake_case and camelCase spellings. Run `/hud debug` to see the raw payload
  if a provider reports something else.
- The HUD uses the widget band under the composer, not the built-in one-line status row, because
  the built-in status line has no context or token items.

## Development

```bash
npm install
npm run check        # tsc --noEmit + vitest
```

The mod is a single TypeScript entry (`src/index.ts`) loaded by Command Code's jiti runtime, so
there is no build step. `@commandcode/harness` is not published to npm; the small surface this
mod uses is typed locally in `src/types.ts`.

## License

MIT
