# Tool Burst Transcript Design

Date: 2026-06-28
Status: Draft

## Goal

Reduce transcript noise from dense tool-call sequences while preserving live activity and post-run observability.

The transcript should show one compact live tool burst row during an assistant turn. It should not append separate rows for `pending`, `in_progress`, and `completed` lifecycle updates. The user can expand the burst row to inspect tool-call history when needed.

## Context

Real OpenCode ACP output can emit many `tool_call` and `tool_call_update` events in a row. Current rendering appends each lifecycle update as a transcript node:

```text
┃ search pending: glob
┃ in_progress
┃ completed: package.json
```

This becomes dense and repetitive during normal agent work. It also pushes assistant responses out of view and makes the transcript read like logs rather than conversation.

The approved direction came from the visual companion screen at:

```text
.superpowers/brainstorm/111133-1782644309/tool-burst-selected-v6.html
```

## Final Direction

Use a collapsed tool burst row by default:

```text
▸ <loader> Using tools read docs/opencode-output-rendering.md        read · 8
```

Behavior:

- The row text starts with `Using tools`.
- The loader changes color/style based on the currently active tool type.
- The row includes the current tool label or concise target.
- The right side shows current type/count, for example `read · 8`.
- There are no bottom pills in the collapsed state.
- Expanding the row shows tool-call history.

## Collapsed Row

The collapsed row should replace the current sequence of tool lifecycle transcript rows for an assistant turn.

Fields:

- Chevron: collapsed or expanded state.
- Loader: type-specific visual indicator.
- Stable label: `Using tools`.
- Current tool text: concise current action, such as `read package.json` or `bash bun test`.
- Right metadata: current type and count, such as `search · 3`, `read · 8`, or `shell · 1`.

The current type/count means the count for the currently active type in this burst, not total tools. Total call count belongs in the expanded history header.

## Tool Type Mapping

Map ACP tool events into display types:

| Display type | Examples | Visual role |
|---|---|---|
| `search` | `glob`, `grep`, `ast-grep`, file search | Cyan loader |
| `read` | `read`, resource reads, docs reads | Blue loader |
| `edit` | `apply_patch`, write, format changes | Green loader |
| `shell` | `bash`, tests, builds, command execution | Amber loader |
| `web` | web fetch, browser actions, external docs | Purple loader |
| `task` | subagent or delegated work | Violet loader |
| `attention` | permission, blocked, failed, rejected | Red loader |

Unknown tools should fall back to the existing tool color and a generic `tool` type.

## Expanded History

When expanded, show a compact history inside the same tool burst container.

Recommended row shape:

```text
tool type     status     concise title or target                         duration
search        done       grep normalizeSessionUpdate                      0.2s
read          done       src/acp/session-update.ts                        0.1s
edit          done       apply_patch docs/opencode-output-rendering.md    0.3s
shell         done       rg Transcript Visual Mockups ...                 0.4s
```

Expanded header should show total calls, for example `12 calls`.

History rows should be grouped by logical tool call ID, not raw lifecycle events. A single `toolCallId` should appear once and update as status/content arrives.

## Status And Usage Routing

Usage updates should move out of the transcript container.

Routing decisions:

- `usage_update`: footer/session metadata only, no transcript node.
- `available_commands_update`: command registry/sidebar only, no recurring transcript node.
- `current_mode_update`: sidebar/header state, no transcript node unless user explicitly changes mode.
- prompt queue updates: keep a lightweight status only when user action is delayed.
- permission requests: visible attention state because they affect behavior.
- protocol errors and prompt failures: visible error transcript entries.

## Diff Rendering

Diff content should move toward side-by-side rendering rather than unified patch-only rendering.

Target shape:

```text
old src/example.ts                 new src/example.ts
const name = "agent"               const name = "agent"
const label = "before"             const label = "after"
console.log(label)                 render(label)
```

This can be implemented separately from tool burst grouping if needed. The tool burst design should not block side-by-side diff work.

## Data Model Implications

The current transcript model appends independent tool nodes. Tool bursts need a small state layer that can update an existing transcript node.

Needed behavior:

- Track the current assistant turn's active tool burst node.
- Group tool lifecycle updates by `toolCallId`.
- Update the burst row instead of appending every lifecycle update.
- Preserve full tool history for expanded view.
- Clear or finalize the active burst when the prompt finishes.

This can be implemented without changing assistant streaming semantics. Assistant message streaming still uses the active assistant node.

## Interaction

Tool burst history must be expandable. The exact input method can be chosen during implementation based on OpenTUI support.

Minimum viable behavior:

- Render collapsed by default.
- Preserve expanded data in transcript state.
- Add an expand/collapse affordance on the burst row.
- Support keyboard toggling at minimum.
- Add pointer/click toggling too if the existing transcript renderables support it cleanly.

Do not reintroduce raw lifecycle rows as the fallback for missing interaction polish.

## Testing

Add or update tests for:

- `tool_call` creates or updates one active tool burst node.
- `tool_call_update` updates existing history by `toolCallId`.
- Multiple tool calls in one assistant turn produce one collapsed burst node.
- Collapsed row text includes `Using tools` and current type/count, such as `read · 8`.
- Pending and in-progress updates do not append standalone transcript rows.
- Permission or failed tool updates map to `attention` styling or visible error state.
- `usage_update` does not append a transcript entry.
- Expanded history data remains available in state.

Run after implementation:

```bash
bun test src/acp/session-update.test.ts
bun test src/ui/transcript.test.ts
bun test src/ui/e2e.test.ts
bun test
bun run typecheck
```

## Out Of Scope

- Full side activity rail.
- Persistent user preferences for collapsed or expanded state.
- Replaying every raw ACP event in transcript.
- Redesigning assistant or user message surfaces.
- Moving all status/log handling to a separate panel.
- Full side-by-side diff implementation if it would make the first tool burst change too large.
