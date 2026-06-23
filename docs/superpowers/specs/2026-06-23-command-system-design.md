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
- **drilldown** — showing subcommands or dynamically fetched options for the selected command.
- **argument** — command text inserted into input bar with cursor positioned for the user to type the argument. Dropdown/palette is closed.

**Transitions:**

| From | Trigger | To | Side effect |
|------|---------|-----|-------------|
| idle | `/` typed in input | listing | Filter to `/` commands |
| idle | Ctrl+P pressed | listing | Show all commands (no filter) |
| listing | Select command with subcommands/optionsMethod | drilldown | Fetch options if optionsMethod present |
| listing | Select command with no args, no subcommands | idle | Execute command |
| listing | Esc | idle | Close dropdown/palette |
| drilldown | Select option/subcommand needing argument | argument | Insert into input bar |
| drilldown | Select option/subcommand with no argument | idle | Execute command |
| drilldown | Backspace (empty filter) | listing | Go back to command list |
| drilldown | Esc | idle | Close |
| argument | Enter | idle | Send full command text as prompt |
| argument | Esc | idle | Cancel, clear input |

**State object:**

```typescript
type CommandState =
  | { phase: "idle" }
  | { phase: "listing"; query: string; surface: "dropdown" | "palette"; selectedIndex: number }
  | { phase: "drilldown"; parent: CommandDescriptor; items: string[]; query: string; selectedIndex: number; surface: "dropdown" | "palette" }
  | { phase: "argument"; commandText: string }
```

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

**Dynamic options fetching:** For commands with `optionsMethod`, the client sends a JSON-RPC request to that method name. The server responds with a list of options that populate the drilldown.

```typescript
// In AcpClient
async fetchOptions(method: string): Promise<string[]>
```

### Integration with Existing Code

**`src/index.ts` changes:**

- Intercept `_kiro.dev/commands/available` notification → populate registry.
- Pass registry and ACP client to the UI layer.

**`src/ui.ts` changes:**

- Instantiate command state machine.
- Handle `Ctrl+P` keypress → open palette.
- Detect `/` in input → activate dropdown.
- Render dropdown/palette/panel-overlay as part of the render tree.
- Route arrow keys, Enter, Esc, Backspace to state machine when active.

**`src/ui/view.ts` changes:**

- Extend `handleInputKey` to detect when command UI is active and delegate.

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
| `/` | Input bar (empty or start) | Open inline dropdown |
| Ctrl+P | Anywhere | Open command palette |
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
