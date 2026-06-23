# Command System Design — AgentClientTUI

Date: 2026-06-23
Status: Approved

## Overview

Add a command system to AgentClientTUI that exposes Kiro's ACP slash commands and local TUI actions through two interaction surfaces: an inline autocomplete dropdown triggered by `/` in the input bar, and a full overlay command palette triggered by `Ctrl+P`.

## Architecture

### Unified Command Registry

A single `CommandRegistry` holds all commands from two sources:

- **ACP commands** — populated dynamically from the `_kiro.dev/commands/available` notification Kiro sends after session creation. Each command carries metadata: `name`, `description`, `inputType` (selection | panel | none), `subcommands`, `subcommandHints`, `optionsMethod`, `hint`, `local`, `hidden`.
- **Local TUI commands** — registered at startup. Same descriptor shape with `source: "local"`. Examples: quit, toggle session panel, theme switch.

The registry is reactive — when ACP sends updated commands, the UI reflects changes immediately.

**ACP notification payload:**

The `_kiro.dev/commands/available` notification has this shape:

```typescript
// notification.params
interface CommandsAvailableParams {
  sessionId: string
  commands: Array<{
    name: string           // e.g. "/model"
    description: string
    meta?: {
      inputType?: "selection" | "panel"
      optionsMethod?: string
      hint?: string
      searchable?: boolean
      hidden?: boolean
      local?: boolean
      subcommands?: string[]
      subcommandHints?: Record<string, string>
    }
  }>
  prompts: Array<{ name: string; description: string; arguments: unknown[]; serverName: string }>
  tools: Array<{ name: string; description: string; source: string }>
  mcpServers: unknown[]
}
```

The registry maps `commands[].meta` fields into `CommandDescriptor`.

**API:**

```typescript
type CommandSource = "acp" | "local"
type InputType = "selection" | "panel" | undefined

interface CommandDescriptor {
  name: string
  description: string
  source: CommandSource
  inputType?: InputType
  subcommands?: string[]
  subcommandHints?: Record<string, string>
  optionsMethod?: string
  hint?: string
  hidden?: boolean
}

class CommandRegistry {
  setAcpCommands(commands: CommandDescriptor[]): void
  addLocalCommand(command: CommandDescriptor): void
  search(query: string, filter?: { source?: CommandSource }): CommandDescriptor[]
  get(name: string): CommandDescriptor | undefined
  getSubcommands(name: string): string[]
}
```

### Interaction State Machine

Both rendering surfaces share the same state machine:

```
idle → listing → drilldown → argument
```

**States:**

- **idle** — nothing open, normal text input mode.
- **listing** — showing filtered command list. Entry point for both `/` and `Ctrl+P`.
- **drilldown** — showing subcommands or dynamically fetched options for the selected command. Includes a `loading` sub-state while fetching options.
- **argument** — command text inserted into input bar with cursor positioned for the user to type the argument. Dropdown/palette is closed.

**Transitions:**

| From | Trigger | To | Side effect |
|------|---------|-----|-------------|
| idle | `/` typed when input is empty | listing | Filter to `/` commands |
| idle | Ctrl+P pressed | listing | Show all commands (no filter) |
| listing | Select command with subcommands/optionsMethod | drilldown | Fetch options if optionsMethod; show "loading..." until response |
| listing | Select command with no args, no subcommands | idle | Execute command |
| listing | Esc | idle | Close dropdown/palette |
| drilldown | Select option/subcommand needing argument | argument | Insert into input bar |
| drilldown | Select option/subcommand with no argument | idle | Execute command |
| drilldown | Backspace (empty filter) | listing | Go back to command list |
| drilldown | Esc | idle | Close |
| argument | Enter | idle | Send full command text as prompt |
| argument | Esc | idle | Cancel, clear input |

**`/` trigger condition:** The dropdown activates only when the input value is empty and the user types `/` as the first character. If the input already has content (e.g., mid-sentence), `/` is treated as a normal character.

**State object:**

```typescript
type CommandState =
  | { phase: "idle" }
  | { phase: "listing"; query: string; surface: "dropdown" | "palette"; selectedIndex: number }
  | { phase: "drilldown"; parent: CommandDescriptor; items: string[]; loading: boolean; query: string; selectedIndex: number; surface: "dropdown" | "palette" }
  | { phase: "argument"; commandText: string }
```

When `drilldown.loading` is true, the renderer shows a "Loading..." indicator. Once `fetchOptions` resolves, `items` is populated and `loading` set to false.

### Rendering Surfaces

#### 1. Inline Dropdown (`/` trigger)

- Appears directly above the input bar.
- Shows filtered commands matching the text after `/`.
- Max visible items: ~8 with scroll.
- Highlighted selection follows arrow keys.
- Footer: `↑↓ navigate · Enter select · Esc close`.
- In drilldown: shows breadcrumb header (`⟵ /model — Select model`), Backspace goes back.

#### 2. Command Palette (`Ctrl+P` trigger)

- Centered overlay, dims background.
- Search input at top, results below.
- Shows all commands (ACP + local TUI actions).
- Styled distinctly from the dropdown (purple accent border vs. orange).
- Footer: `↑↓ navigate · Enter select · Esc close`.
- Same drill-down behavior as dropdown.

#### 3. Panel Overlay (for `inputType: "panel"` commands)

- Shown after executing a panel command.
- Bordered overlay rendered over the transcript area.
- Displays the command's response content.
- Dismissible with Esc, returns focus to input bar.
- Shows relevant subcommand hints in footer.

### Command Execution

When a command is finally selected:

| inputType | Behavior |
|-----------|----------|
| none / undefined | Send command text as `session/prompt` to ACP. Response streams into transcript. |
| selection | Send full command + selected option as `session/prompt`. |
| panel | Send as `session/prompt`. Render response in panel overlay instead of transcript. |
| (local) | Execute directly in TUI (no ACP call). |

**Dynamic options fetching:** For commands with `optionsMethod`, the client sends a JSON-RPC request to that method name. The server responds with an object containing an array of option items.

```typescript
// Request: { method: "_kiro.dev/commands/model/options", params: {} }
// Response shape:
interface OptionsResponse {
  options: Array<{ label: string; value: string; description?: string }>
}

// In AcpClient
async fetchOptions(method: string): Promise<Array<{ label: string; value: string; description?: string }>>
```

If the response shape differs from expected (e.g., just a flat string array), normalize it into `{ label: value, value: value }` objects.

**Panel command routing:** To distinguish panel command responses from normal transcript streaming, the execution layer tracks the current prompt context:

```typescript
// In index.ts, before sending the prompt:
let activePanelCommand: string | null = null

// When executing a panel command:
activePanelCommand = commandName
await client.prompt(sessionId, commandText)
activePanelCommand = null

// In the notification handler:
if (activePanelCommand) {
  // Route agent_message_chunk text to panel overlay instead of transcript
  ui.appendToPanel(text)
} else {
  // Normal transcript accumulation
  ui.updateLast(streamingText)
}
```

This works because prompts are serialized (one at a time, `promptInFlight` flag already exists).

### Integration with Existing Code

**Key handling ownership:**

Currently `ui.ts` receives all keypress events and passes them to `handleInputKey` in `view.ts`. The command system introduces a new layer:

1. `ui.ts` keypress handler checks command state first (before `handleInputKey`).
2. If command state is not `idle`, keys route to the command state machine — arrow keys navigate, Enter selects, Esc closes, character keys filter.
3. If command state is `idle`, keys go to `handleInputKey` as before — except `Ctrl+P` always opens the palette (handled before the existing ctrl early-return in `handleInputKey`).
4. When `handleInputKey` processes a `/` character and the input was empty, it signals the command system to activate the dropdown.

The existing `handleInputKey` ctrl/meta early-return stays for normal input. `Ctrl+P` is intercepted in `ui.ts` before calling `handleInputKey`.

**`src/index.ts` changes:**

- Intercept `_kiro.dev/commands/available` notification → populate registry.
- Pass registry and ACP client to the UI layer.
- Track `activePanelCommand` to route streaming text to panel overlay vs. transcript.

**`src/ui.ts` changes:**

- Instantiate command state machine.
- Add key interception layer: check command state before delegating to `handleInputKey`.
- Handle `Ctrl+P` keypress → open palette.
- Detect `/` activation signal from input → activate dropdown.
- Render dropdown/palette/panel-overlay as part of the render tree.
- Add `appendToPanel(text: string)` method for panel overlay content.

**`src/ui/view.ts` changes:**

- `handleInputKey` returns an additional signal when `/` is typed into an empty input, so `ui.ts` can activate the dropdown. No other changes needed here — command navigation is handled at the `ui.ts` level.

**`src/acp/client.ts` changes:**

- Add `fetchOptions(method: string)` for dynamic option list requests.

## File Structure

```
src/commands/
  registry.ts      — CommandRegistry class, CommandDescriptor type, search/filter
  state.ts         — CommandState type, state machine transitions
  execute.ts       — Command execution (route to ACP prompt, local action, or option fetch)
src/ui/
  dropdown.ts      — Inline / dropdown OpenTUI renderer
  palette.ts       — Ctrl+P overlay OpenTUI renderer
  panel-overlay.ts — Panel content overlay renderer
```

## Keyboard Shortcuts Summary

| Key | Context | Action |
|-----|---------|--------|
| `/` | Input bar is empty | Open inline dropdown |
| Ctrl+P | Any time (intercepted before handleInputKey) | Open command palette |
| ↑/↓ | Dropdown or palette open | Navigate items |
| Enter | Item highlighted | Select item / execute |
| Esc | Dropdown, palette, or panel open | Close / return to idle |
| Backspace | Drilldown with empty filter | Go back to parent list |
| Backspace | Listing with empty filter | Close (return to idle) |

## Out of Scope

- Command history / recently used ordering (future enhancement).
- Mouse interaction (TUI is keyboard-first).
- Custom keybinding configuration.
- Fuzzy matching beyond simple substring filter (can upgrade later).
