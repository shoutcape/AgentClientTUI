# OpenCode ACP Output Rendering Notes

Date: 2026-06-28
Branch: `test-real-opencode-output-rendering`
Worktree: `/home/shoutcape/github/AgentClientTUI/.worktrees/test-real-opencode-output-rendering`
OpenCode version: `1.17.11`

## Setup

The app was opened in tmux pane `%32` with a real OpenCode ACP stdio server after syncing the current UI branch changes into this test branch:

```bash
npm run dev -- --agent "opencode acp --cwd /home/shoutcape/github/AgentClientTUI/.worktrees/test-real-opencode-output-rendering"
```

The app initialized successfully and displayed:

```text
┃ commands updated (32)
server        opencode acp
status        session ses_...
```

Additional raw traces were captured with:

```bash
npm run trace -- --agent "opencode acp --cwd /home/shoutcape/github/AgentClientTUI/.worktrees/test-real-opencode-output-rendering" --scenario initialize --out tmp/acp-traces/opencode-real/initialize.jsonl
npm run trace -- --agent "opencode acp --cwd /home/shoutcape/github/AgentClientTUI/.worktrees/test-real-opencode-output-rendering" --scenario new-prompt --prompt "Reply with exactly: trace text output" --out tmp/acp-traces/opencode-real/text-output.jsonl
```

A temporary ACP harness at `/tmp/opencode/acp-tool-trace.mjs` mirrored the app's permission handler and captured tool output to `/tmp/opencode/opencode-acp-tool-trace.jsonl`.

## Observed Protocol Outputs

| ACP event or result | Observed data | App normalization | Current render |
|---|---|---|---|
| `initialize` result | `agentInfo.name = OpenCode`, `agentInfo.version = 1.17.11`, auth method `opencode-login`, capabilities for session load/list/resume/fork/close | Not a transcript entry | Startup status changes from launching to initialized |
| `session/new` result | `sessionId`, `configOptions` for Model, Effort, Session Mode | Stores active session ID and config commands | Top status and sidebar show session ID; config commands enter palette/dropdown registry |
| `available_commands_update` | 32 commands, mostly skills and local OpenCode commands | Command registry update plus status text | `┃ commands updated (32)` |
| `agent_message_chunk` | Text arrives in small chunks such as `trace`, ` text`, ` output` | Chunks are accumulated into active assistant message | Plain assistant text with no role gutter, for example `updated branch render text observed.` |
| `usage_update` | Example: `used=11860`, `size=400000`, `cost=0 USD` | `usage 11860/400000 tokens, 0 USD` | `┃ usage 11860/400000 tokens, 0 USD` |
| `tool_call` | `kind`, `status`, `title`, `toolCallId`; examples: `other pending: skill`, `search pending: glob`, `read pending: read` | Tool row text `${kind} ${status}: ${title}` | `┃ other pending: skill` |
| `tool_call_update` without content | Examples: `in_progress` for `skill`, `glob`, `read` | Tool row text is only status | `┃ in_progress` |
| `tool_call_update` with text content | Examples: loaded skill body, `package.json` path, full package file content | First text block is prefixed with status, for example `completed: <content>` | `┃ completed: ...`, wrapping inside transcript with thin strip |
| `session/prompt` result | `stopReason = end_turn`, usage object in result | Not a transcript entry | Status changes back to `ready` |

## Tool Trace Summary

Tool prompt:

```text
Use your tools to inspect package.json and tell me the package name. If a permission is requested, continue after rejection and summarize.
```

Observed `session/update` counts from `/tmp/opencode/opencode-acp-tool-trace.jsonl`:

| Update type | Count |
|---|---:|
| `available_commands_update` | 1 |
| `tool_call` | 3 |
| `tool_call_update` | 6 |
| `agent_message_chunk` | 17 |
| `usage_update` | 1 |

Tool lifecycle rows observed:

| Update | Kind | Status | Title |
|---|---|---|---|
| `tool_call` | `other` | `pending` | `skill` |
| `tool_call_update` | `other` | `in_progress` | `skill` |
| `tool_call_update` | `other` | `completed` | `Loaded skill: using-superpowers` |
| `tool_call` | `search` | `pending` | `glob` |
| `tool_call_update` | `search` | `in_progress` | `glob` |
| `tool_call_update` | `search` | `completed` | `glob` |
| `tool_call` | `read` | `pending` | `read` |
| `tool_call_update` | `read` | `in_progress` | `read` |
| `tool_call_update` | `read` | `completed` | `package.json` |

Final assistant text after tools:

```text
Package name: `agent-client-tui`
```

## Render Behavior Observed In tmux

Text-only prompt:

```text
┃ Reply with exactly: updated branch render text observed. Do not use
┃ tools.

updated branch render text observed.

┃ usage 11868/400000 tokens, 0 USD
```

Tool prompt, top of transcript after `Home`:

```text
┃ Use your tools to inspect package.json and report only the package name.
┃  Keep final answer short.

┃ other pending: skill

┃ in_progress

┃ completed: <skill_content name="using-superpowers">
┃ # Skill: using-superpowers
┃ ...
```

Tool prompt, bottom of transcript:

```text
┃   "name": "agent-client-tui",
┃   "version": "0.1.0",
┃   ...

agent-client-tui

┃ usage 13819/400000 tokens, 0 USD
```

The completed skill tool output and package file read are very long. They fill the visible transcript and require scrolling to reach either the top lifecycle rows or the final assistant response. The updated branch uses a thin left strip (`┃`) and a one-cell neutral gap before event body backgrounds instead of the older padded role gutter.

## Transcript Reply Type Coverage

`TranscriptKind` currently has these reply types in `src/ui/transcript.ts`:

| Reply type | Source | Render treatment | Covered by sampled real OpenCode run? |
|---|---|---|---|
| `user` | Local prompt appended before `session/prompt` | Event surface with user strip, for example `┃ prompt text` | Yes, visible in prompt examples |
| `agent` | `agent_message_chunk`, accumulated into the active assistant message | Plain text with no strip or role gutter | Yes |
| `thought` | `agent_thought_chunk` | Muted event surface with thought strip | No, supported only |
| `tool` | `tool_call` and `tool_call_update` | Muted event surface with tool strip; text, code, and diff blocks can render inside | Yes for text tool rows; no for code or diff blocks |
| `plan` | `plan` update entries formatted as `[status] content` lines | Muted event surface with plan strip | No, supported only |
| `usage` | `usage_update` | Muted event surface with usage strip | Yes |
| `status` | command updates, mode updates, permission requests, queue messages, and unknown session updates | Muted event surface with status strip | Yes for command updates; no for mode, permission, queue, or unknown updates |
| `error` | protocol parse errors, prompt failures, startup failures, config option errors | Strong event surface with error strip | No, supported only |
| `log` | Agent stderr | Muted event surface with log strip | No, supported only |

`TranscriptBlock` currently has these block variants:

| Block type | Source | Render treatment | Covered by sampled real OpenCode run? |
|---|---|---|---|
| `text` | Default block for all text-only transcript entries and text tool content | Wrapped text in the parent reply type surface | Yes |
| `status` | Renderer supports it, but current append path does not create status blocks explicitly | Same as text/status surface handling | No |
| `code` | `tool_call_update` content block with `{ type: "content", content: { type: "code" } }` | Metadata row plus `CodeRenderable` with syntax style | No, supported only |
| `diff` | `tool_call_update` item with `{ type: "diff" }` | Metadata row plus `DiffRenderable` unified diff view | No, supported only |

## Transcript Visual Mockups

Markdown cannot show the actual terminal background colors, so these examples show the rendered shape and list the styling tokens next to each type. Event entries use a one-cell heavy left strip (`┃`) and a one-cell gap before body text. Assistant entries are intentionally plain.

| Reply type | Treatment | Foreground | Strip | Background |
|---|---|---|---|---|
| `agent` | `plain` | `#eeeeee` | none | none |
| `user` | `event` | `#eeeeee` | `#a78bfa` | `#211a2e` |
| `thought` | `muted-event` | `#808080` | `#9d7cd8` | `#15111e` |
| `tool` | `muted-event` | `#808080` | `#56b6c2` | `#10191b` |
| `plan` | `muted-event` | `#808080` | `#5c9cf5` | `#111826` |
| `usage` | `muted-event` | `#808080` | `#f5a742` | `#211a10` |
| `status` | `muted-event` | `#808080` | `#5c9cf5` | `#111826` |
| `error` | `strong-event` | `#e06c75` | `#e06c75` | `#2a1114` |
| `log` | `muted-event` | `#808080` | `#808080` | `#111111` |

### Text Reply Types

```text
user
┃ Explain what package this repo builds.

agent
This repo builds `agent-client-tui`.

thought
┃ Checking package metadata and command wiring.

plan
┃ [completed] Read source
┃ [pending] Run tests

usage
┃ usage 11868/400000 tokens, 0 USD

status
┃ commands updated (32)
┃ mode build
┃ queued: summarize package.json
┃ permission requested (auto-rejected)
┃ unhandled custom_update

error
┃ Failed to prompt: Method not found: session/prompt

log
┃ mock-agent: ready
```

### Tool Lifecycle

Current observed rendering is verbose because each lifecycle update becomes its own transcript row:

```text
tool call
┃ read pending: package.json

tool update without content
┃ in_progress

tool update with text content
┃ completed: Found package name `agent-client-tui`
```

Approved target rendering groups dense tool activity into one tool burst row per assistant turn:

```text
collapsed
▸ <loader> Using tools read docs/opencode-output-rendering.md        read · 8

expanded
▾ Tool history                                                12 calls
search  done  grep normalizeSessionUpdate                       0.2s
read    done  src/acp/session-update.ts                         0.1s
edit    done  apply_patch docs/opencode-output-rendering.md      0.3s
shell   done  rg Transcript Visual Mockups ...                   0.4s
```

Collapsed behavior:

- Row text starts with `Using tools`.
- Loader changes by current tool type.
- Current tool label stays visible.
- Right side shows current type/count such as `read · 8`.
- No bottom pills render in the collapsed state.
- Expanded state shows grouped tool-call history by `toolCallId`.

Tool type mapping target:

| Display type | Examples | Loader color role |
|---|---|---|
| `search` | `glob`, `grep`, `ast-grep`, file search | cyan |
| `read` | `read`, resource reads, docs reads | blue |
| `edit` | `apply_patch`, write, format changes | green |
| `shell` | `bash`, tests, builds, command execution | amber |
| `web` | web fetch, browser actions, external docs | purple |
| `task` | subagent or delegated work | violet |
| `attention` | permission, blocked, failed, rejected | red |

### Tool Code Block

When tool content starts with a code block, the status is rendered as a stripped event row, then the code block renders as a separate block in the same transcript node.

```text
tool code content
┃ completed:

code ts
const answer = 42
console.log(answer)
```

### Tool Diff Block

Current diff content renders as a metadata row plus `DiffRenderable` unified diff view. In the real TUI, added and removed lines receive diff colors and line numbers.

```text
tool diff content
┃ completed:

diff src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,1 +1,1 @@
-const label = "before"
+const label = "after"
```

Target diff content should move toward side-by-side rendering:

```text
diff src/example.ts
old                                new
const label = "before"             const label = "after"
console.log(label)                 render(label)
```

### Mixed Tool Blocks

Text content keeps the status prefix on the first text row. Later code or diff blocks render below it without repeating the event strip.

```text
tool mixed content
┃ completed: Updated example file

diff src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,1 +1,1 @@
-old
+new
```

### Styling Tuning Notes

- `agent` is the only plain transcript surface, so it visually reads as conversation content rather than metadata.
- `user` has strong contrast through a purple strip and darker purple background.
- `thought`, `tool`, `plan`, `usage`, `status`, and `log` share muted foreground text, so their main difference is strip/background color.
- `error` is the only strong event treatment and uses red foreground, strip, and background.
- `code` and `diff` blocks are not wrapped in the event-strip container. Only their metadata rows use the parent surface foreground.
- Long tool text content is still just wrapped event text and can dominate the transcript.
- Tool lifecycle rows should become a grouped, collapsible tool burst row rather than separate `pending`, `in_progress`, and `completed` transcript nodes.
- `usage_update` should move to footer/session metadata and stop appending transcript rows.

## Supported But Not Observed In This Run

These are supported by `normalizeSessionUpdate` or the renderer, but real OpenCode did not emit them in the sampled prompts:

| Update type | App normalization | Current render |
|---|---|---|
| `agent_thought_chunk` | `thought` | `┃ thought text` |
| `plan` | `plan` with `[status] content` lines | `┃ [status] content` |
| `current_mode_update` | `status` with `mode <id>` | `┃ mode <id>` |
| Unknown session update type | `status` with `unhandled <type>` | `┃ unhandled <type>` |
| Agent stderr | `log` | `┃ log text` |
| Protocol parse error | `error` | `┃ error text` |

## Notes And Rendering Gaps

- `available_commands_update` only shows a status count in the transcript. Full command detail is available through slash dropdown and palette search, not as transcript content.
- `tool_call_update` with content drops the event title from the visible transcript. Example: title `Loaded skill: using-superpowers` rendered as `completed: <skill_content...`.
- Tool lifecycle updates are separate transcript nodes, not grouped by `toolCallId`.
- Long tool text content is rendered as normal wrapped text. It can dominate the viewport.
- The package file read came through as text content, not a code block, so it did not use `CodeRenderable` syntax highlighting.
- No `session/request_permission` request occurred for the sampled `skill`, `glob`, or `read` tools. The app still has a handler that would append `┃ permission requested (auto-rejected)` and choose `reject_once`.
- Sidebar currently shows `mode demo` even though real OpenCode config reported Session Mode `build`.
- Approved design: dense tool activity should collapse into one `Using tools` row with a current type/count suffix like `read · 8`.
- Approved design: expanded tool history should show grouped calls by `toolCallId`, not raw lifecycle updates.
- Approved design: usage updates belong outside transcript history.
