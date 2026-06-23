# Command System PRD

> **Date:** 2026-06-23
> **Status:** Draft

## Problem Statement

AgentClientTUI connects to Kiro via ACP and can send free-text prompts, but has no way to access the rich set of slash commands (`/model`, `/context`, `/tools`, etc.) that Kiro advertises. Users currently have to know and type these commands as plain text with no discoverability, no autocomplete, and no structured interaction for commands that require selection or display panels. The TUI also lacks quick-access actions for its own UI controls.

## Solution

Users will be able to discover and execute all available commands through two keyboard-driven interfaces:

1. Typing `/` in an empty input bar shows an inline autocomplete dropdown that filters commands as the user types. Selecting a command with options drills down to show those options in-place.
2. Pressing `Ctrl+P` opens a full-screen command palette (opencode-style) that shows both Kiro ACP commands and local TUI actions, searchable and navigable with arrow keys.

Commands that display information (panel type) render in a dismissible overlay. Commands that require an argument insert themselves into the input bar with the cursor positioned for the user to complete.

## User Stories

1. As a user, I want to type `/` in the input bar and see all available commands so I can discover what's available without memorizing them.
2. As a user, I want the command list to filter in real-time as I type after `/` so I can quickly narrow to the command I want.
3. As a user, I want to press `Ctrl+P` to open a command palette that shows both Kiro commands and TUI actions so I have one place to find everything.
4. As a user, I want to navigate the command list with arrow keys and select with Enter so I can work entirely from the keyboard.
5. As a user, I want to press Esc at any point to dismiss the dropdown/palette and return to normal input.
6. As a user, I want selecting `/model` to show me the available models inline (fetched from the server) so I can pick one without typing the name.
7. As a user, I want to press Backspace in a drilldown to go back to the parent command list so I can change my mind.
8. As a user, I want commands like `/context add` to insert the text into my input bar so I can type the path argument and submit with Enter.
9. As a user, I want panel commands like `/tools` to show their output in a dismissible overlay so the transcript stays clean.
10. As a user, I want the command list to update automatically when Kiro sends new commands so I always see current options.
11. As a user, I want hidden commands (like `/stats`) to not appear in the list so the UI stays uncluttered.
12. As a user, I want a loading indicator when options are being fetched so I know the system is working.
13. As a user, I want local TUI actions (quit, toggle panels) available in the Ctrl+P palette so I don't need to remember separate shortcuts for everything.

## Implementation Decisions

- **Unified Command Registry** — single data store holding both ACP-sourced commands (from `_kiro.dev/commands/available` notification) and locally-registered TUI actions. Same `CommandDescriptor` shape for both, differentiated by a `source` field.
- **Shared state machine** — both the `/` dropdown and `Ctrl+P` palette drive the same state machine (`idle → listing → drilldown → argument`). The two surfaces are rendering differences only.
- **Key interception order** — `ui.ts` checks command state before delegating to `handleInputKey`. `Ctrl+P` is intercepted before the existing ctrl/meta early-return. When command state is not idle, keys route to the state machine.
- **`/` trigger condition** — activates only when input is empty and `/` is the first character typed.
- **Panel routing via prompt context** — an `activePanelCommand` flag tracks whether the current in-flight prompt is a panel command. Streaming chunks route to the panel overlay when set, transcript when not.
- **Option fetching** — `AcpClient.fetchOptions(method)` sends a JSON-RPC request to the `optionsMethod` advertised in command metadata. Response normalized to `{ label, value, description? }[]`.
- **Two rendering surfaces** — inline dropdown (orange accent, positioned above input bar, ~8 items) and overlay palette (purple accent, centered, dims background).
- **Panel overlay** — bordered overlay for panel command output, Esc to dismiss.

State machine type shape:

```typescript
type CommandState =
  | { phase: "idle" }
  | { phase: "listing"; query: string; surface: "dropdown" | "palette"; selectedIndex: number }
  | { phase: "drilldown"; parent: CommandDescriptor; items: string[]; loading: boolean; query: string; selectedIndex: number; surface: "dropdown" | "palette" }
  | { phase: "argument"; commandText: string }
```

## Testing Decisions

- Test external behavior of the command registry (search, filter, population from ACP payload) and state machine (transitions given input keys and current state).
- **Test seams:**
  - `CommandRegistry` — pure class, test search/filter/setAcpCommands.
  - State machine transitions — pure function `transition(state, event) → newState + effects`, test all paths.
- **Prior art:** `src/ui/view.test.ts` exists with tests for `buildTranscriptRows`, `buildInputBar`, and `handleInputKey`. Follow the same pattern (Bun test, import functions, assert outputs).
- Do not test OpenTUI rendering internals — those are visual and covered by manual verification.

## Out of Scope

- Command history / recently-used ordering.
- Mouse interaction.
- Custom keybinding configuration.
- Fuzzy matching (substring filter is sufficient for now).
- Prompt/tool selection via the command system (prompts and tools are advertised in the notification but not part of the initial command UI).

## Further Notes

- The `_kiro.dev/commands/available` notification also includes `prompts`, `tools`, and `mcpServers` arrays. These could be surfaced in future iterations but are not part of this PRD.
- The `fetchOptions` response shape from Kiro is not formally documented. Implementation should handle gracefully if the response is a flat string array vs. object array.
- Commands marked `local: true` in ACP metadata (like `/chat`, `/quit`) may need special handling since they might conflict with TUI-level local commands of the same name.
