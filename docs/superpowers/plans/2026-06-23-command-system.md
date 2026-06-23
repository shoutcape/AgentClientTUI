# Command System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a command system with inline `/` dropdown and `Ctrl+P` palette to discover and execute Kiro ACP slash commands and local TUI actions.

**Architecture:** Unified CommandRegistry + shared state machine driving two rendering surfaces. Registry populated from ACP `_kiro.dev/commands/available` notification + local commands. State machine handles navigation (idle → listing → drilldown → argument).

**Tech Stack:** TypeScript, Bun test runner, OpenTUI (@opentui/core), JSON-RPC over stdio

**References:**
- PRD: `docs/superpowers/prds/2026-06-23-command-system.md`
- Design Spec: `docs/superpowers/specs/2026-06-23-command-system-design.md`
- Existing project spec: `docs/superpowers/specs/2026-06-22-agent-client-tui-design.md`
- Original plan: `docs/superpowers/plans/2026-06-22-agent-client-tui.md`

---

### Task 1: Command Registry

**Files:**
- Create: `src/commands/registry.ts`
- Create: `src/commands/registry.test.ts`

- [ ] **Step 1: Write failing tests for CommandRegistry**

```typescript
// src/commands/registry.test.ts
import { describe, expect, test } from "bun:test"
import { CommandRegistry, type CommandDescriptor } from "./registry"

const model: CommandDescriptor = {
  name: "/model",
  description: "Select model",
  source: "acp",
  inputType: "selection",
  optionsMethod: "_kiro.dev/commands/model/options",
}

const context: CommandDescriptor = {
  name: "/context",
  description: "Manage context files",
  source: "acp",
  inputType: "panel",
  subcommands: ["show", "add", "remove", "clear"],
  subcommandHints: { add: "[--force] <path>...", remove: "<path>..." },
}

const quit: CommandDescriptor = {
  name: "Quit",
  description: "Quit the application",
  source: "local",
}

describe("CommandRegistry", () => {
  test("search returns commands matching query substring", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, context])
    expect(reg.search("mod")).toEqual([model])
  })

  test("search with empty query returns all non-hidden commands", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, context])
    reg.addLocalCommand(quit)
    expect(reg.search("")).toHaveLength(3)
  })

  test("search filters by source", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, context])
    reg.addLocalCommand(quit)
    expect(reg.search("", { source: "local" })).toEqual([quit])
  })

  test("hidden commands excluded from search", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([{ ...model, hidden: true }])
    expect(reg.search("")).toEqual([])
  })

  test("get returns command by exact name", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model])
    expect(reg.get("/model")).toEqual(model)
    expect(reg.get("/nonexistent")).toBeUndefined()
  })

  test("getSubcommands returns subcommand list", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([context])
    expect(reg.getSubcommands("/context")).toEqual(["show", "add", "remove", "clear"])
    expect(reg.getSubcommands("/model")).toEqual([])
  })

  test("setAcpCommands replaces previous commands", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, context])
    reg.setAcpCommands([model])
    expect(reg.search("")).toEqual([model])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/commands/registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CommandRegistry**

```typescript
// src/commands/registry.ts
export type CommandSource = "acp" | "local"
export type InputType = "selection" | "panel"

export interface CommandDescriptor {
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

export class CommandRegistry {
  private acpCommands: CommandDescriptor[] = []
  private localCommands: CommandDescriptor[] = []

  setAcpCommands(commands: CommandDescriptor[]): void {
    this.acpCommands = commands
  }

  addLocalCommand(command: CommandDescriptor): void {
    this.localCommands.push(command)
  }

  search(query: string, filter?: { source?: CommandSource }): CommandDescriptor[] {
    const all = [...this.acpCommands, ...this.localCommands]
    return all.filter((cmd) => {
      if (cmd.hidden) return false
      if (filter?.source && cmd.source !== filter.source) return false
      if (!query) return true
      const lower = query.toLowerCase()
      return cmd.name.toLowerCase().includes(lower) || cmd.description.toLowerCase().includes(lower)
    })
  }

  get(name: string): CommandDescriptor | undefined {
    return [...this.acpCommands, ...this.localCommands].find((cmd) => cmd.name === name)
  }

  getSubcommands(name: string): string[] {
    return this.get(name)?.subcommands ?? []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/commands/registry.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/registry.ts src/commands/registry.test.ts
git commit -m "feat: add CommandRegistry with search/filter"
```

---

### Task 2: Command State Machine

**Files:**
- Create: `src/commands/state.ts`
- Create: `src/commands/state.test.ts`

- [ ] **Step 1: Write failing tests for state machine transitions**

```typescript
// src/commands/state.test.ts
import { describe, expect, test } from "bun:test"
import { transition, idle, type CommandEvent, type CommandState, type TransitionResult } from "./state"
import type { CommandDescriptor } from "./registry"

const model: CommandDescriptor = {
  name: "/model",
  description: "Select model",
  source: "acp",
  inputType: "selection",
  optionsMethod: "_kiro.dev/commands/model/options",
}

const clear: CommandDescriptor = {
  name: "/clear",
  description: "Clear history",
  source: "acp",
}

const context: CommandDescriptor = {
  name: "/context",
  description: "Manage context",
  source: "acp",
  inputType: "panel",
  subcommands: ["show", "add", "remove", "clear"],
  subcommandHints: { add: "<path>" },
}

describe("Command State Machine", () => {
  test("slash in empty input transitions to listing (dropdown)", () => {
    const result = transition(idle(), { type: "slash-typed" })
    expect(result.state.phase).toBe("listing")
    if (result.state.phase === "listing") {
      expect(result.state.surface).toBe("dropdown")
      expect(result.state.query).toBe("")
    }
  })

  test("ctrl-p transitions to listing (palette)", () => {
    const result = transition(idle(), { type: "ctrl-p" })
    expect(result.state.phase).toBe("listing")
    if (result.state.phase === "listing") {
      expect(result.state.surface).toBe("palette")
    }
  })

  test("esc in listing returns to idle", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "esc" })
    expect(result.state.phase).toBe("idle")
  })

  test("select command with no subcommands executes", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "select", command: clear })
    expect(result.state.phase).toBe("idle")
    expect(result.effect).toEqual({ type: "execute", command: "/clear" })
  })

  test("select command with optionsMethod enters drilldown loading", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "select", command: model })
    expect(result.state.phase).toBe("drilldown")
    if (result.state.phase === "drilldown") {
      expect(result.state.loading).toBe(true)
      expect(result.state.parent).toBe(model)
    }
    expect(result.effect).toEqual({ type: "fetch-options", method: "_kiro.dev/commands/model/options" })
  })

  test("select command with subcommands enters drilldown with items", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "select", command: context })
    expect(result.state.phase).toBe("drilldown")
    if (result.state.phase === "drilldown") {
      expect(result.state.items).toEqual(["show", "add", "remove", "clear"])
      expect(result.state.loading).toBe(false)
    }
  })

  test("options-loaded populates drilldown items", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: model, items: [], loading: true,
      query: "", selectedIndex: 0, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "options-loaded", items: ["opus", "sonnet"] })
    if (result.state.phase === "drilldown") {
      expect(result.state.items).toEqual(["opus", "sonnet"])
      expect(result.state.loading).toBe(false)
    }
  })

  test("backspace on empty drilldown query returns to listing", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: context, items: ["show", "add"], loading: false,
      query: "", selectedIndex: 0, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "backspace" })
    expect(result.state.phase).toBe("listing")
  })

  test("select subcommand with hint enters argument mode", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: context, items: ["show", "add", "remove", "clear"], loading: false,
      query: "", selectedIndex: 1, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "select-item", item: "add" })
    expect(result.state.phase).toBe("argument")
    if (result.state.phase === "argument") {
      expect(result.state.commandText).toBe("/context add ")
    }
  })

  test("select subcommand without hint executes directly", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: context, items: ["show", "add", "remove", "clear"], loading: false,
      query: "", selectedIndex: 0, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "select-item", item: "show" })
    expect(result.state.phase).toBe("idle")
    expect(result.effect).toEqual({ type: "execute", command: "/context show" })
  })

  test("char event updates query in listing", () => {
    const listing: CommandState = { phase: "listing", query: "mo", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "char", char: "d" })
    if (result.state.phase === "listing") {
      expect(result.state.query).toBe("mod")
      expect(result.state.selectedIndex).toBe(0)
    }
  })

  test("arrow-down increments selectedIndex", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "arrow-down" })
    if (result.state.phase === "listing") {
      expect(result.state.selectedIndex).toBe(1)
    }
  })

  test("arrow-up decrements selectedIndex (min 0)", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "arrow-up" })
    if (result.state.phase === "listing") {
      expect(result.state.selectedIndex).toBe(0)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/commands/state.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement state machine**

```typescript
// src/commands/state.ts
import type { CommandDescriptor } from "./registry"

export type CommandState =
  | { phase: "idle" }
  | { phase: "listing"; query: string; surface: "dropdown" | "palette"; selectedIndex: number }
  | { phase: "drilldown"; parent: CommandDescriptor; items: string[]; loading: boolean; query: string; selectedIndex: number; surface: "dropdown" | "palette" }
  | { phase: "argument"; commandText: string }

export type CommandEvent =
  | { type: "slash-typed" }
  | { type: "ctrl-p" }
  | { type: "esc" }
  | { type: "char"; char: string }
  | { type: "backspace" }
  | { type: "arrow-up" }
  | { type: "arrow-down" }
  | { type: "select"; command: CommandDescriptor }
  | { type: "select-item"; item: string }
  | { type: "options-loaded"; items: string[] }

export type CommandEffect =
  | { type: "execute"; command: string }
  | { type: "fetch-options"; method: string }
  | { type: "set-input"; text: string }

export type TransitionResult = {
  state: CommandState
  effect?: CommandEffect
}

export function idle(): CommandState {
  return { phase: "idle" }
}

export function transition(state: CommandState, event: CommandEvent): TransitionResult {
  switch (state.phase) {
    case "idle":
      return transitionIdle(event)
    case "listing":
      return transitionListing(state, event)
    case "drilldown":
      return transitionDrilldown(state, event)
    case "argument":
      return transitionArgument(state, event)
  }
}

function transitionIdle(event: CommandEvent): TransitionResult {
  if (event.type === "slash-typed") {
    return { state: { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 } }
  }
  if (event.type === "ctrl-p") {
    return { state: { phase: "listing", query: "", surface: "palette", selectedIndex: 0 } }
  }
  return { state: { phase: "idle" } }
}

function transitionListing(state: Extract<CommandState, { phase: "listing" }>, event: CommandEvent): TransitionResult {
  if (event.type === "esc") {
    return { state: idle() }
  }
  if (event.type === "backspace") {
    if (state.query === "") return { state: idle() }
    return { state: { ...state, query: state.query.slice(0, -1), selectedIndex: 0 } }
  }
  if (event.type === "char") {
    return { state: { ...state, query: state.query + event.char, selectedIndex: 0 } }
  }
  if (event.type === "arrow-down") {
    return { state: { ...state, selectedIndex: state.selectedIndex + 1 } }
  }
  if (event.type === "arrow-up") {
    return { state: { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) } }
  }
  if (event.type === "select") {
    const cmd = event.command
    if (cmd.optionsMethod) {
      return {
        state: { phase: "drilldown", parent: cmd, items: [], loading: true, query: "", selectedIndex: 0, surface: state.surface },
        effect: { type: "fetch-options", method: cmd.optionsMethod },
      }
    }
    if (cmd.subcommands && cmd.subcommands.length > 0) {
      return {
        state: { phase: "drilldown", parent: cmd, items: cmd.subcommands, loading: false, query: "", selectedIndex: 0, surface: state.surface },
      }
    }
    return { state: idle(), effect: { type: "execute", command: cmd.name } }
  }
  return { state }
}

function transitionDrilldown(state: Extract<CommandState, { phase: "drilldown" }>, event: CommandEvent): TransitionResult {
  if (event.type === "esc") {
    return { state: idle() }
  }
  if (event.type === "backspace") {
    if (state.query === "") {
      return { state: { phase: "listing", query: "", surface: state.surface, selectedIndex: 0 } }
    }
    return { state: { ...state, query: state.query.slice(0, -1), selectedIndex: 0 } }
  }
  if (event.type === "char") {
    return { state: { ...state, query: state.query + event.char, selectedIndex: 0 } }
  }
  if (event.type === "arrow-down") {
    return { state: { ...state, selectedIndex: state.selectedIndex + 1 } }
  }
  if (event.type === "arrow-up") {
    return { state: { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) } }
  }
  if (event.type === "options-loaded") {
    return { state: { ...state, items: event.items, loading: false } }
  }
  if (event.type === "select-item") {
    const hint = state.parent.subcommandHints?.[event.item]
    if (hint) {
      return {
        state: { phase: "argument", commandText: `${state.parent.name} ${event.item} ` },
      }
    }
    return { state: idle(), effect: { type: "execute", command: `${state.parent.name} ${event.item}` } }
  }
  return { state }
}

function transitionArgument(state: Extract<CommandState, { phase: "argument" }>, event: CommandEvent): TransitionResult {
  if (event.type === "esc") {
    return { state: idle() }
  }
  return { state }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/commands/state.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/state.ts src/commands/state.test.ts
git commit -m "feat: add command state machine with transitions"
```

---

### Task 3: Command Execution Logic

**Files:**
- Create: `src/commands/execute.ts`
- Modify: `src/acp/client.ts`

- [ ] **Step 1: Add fetchOptions method to AcpClient class**

In `src/acp/client.ts`, add this method inside the `AcpClient` class body (after the `prompt` method, before the closing `}`):

```typescript
  async fetchOptions(method: string): Promise<Array<{ label: string; value: string; description?: string }>> {
    const result = await this.transport.request(method, {})
    if (Array.isArray(result)) {
      return (result as string[]).map((v) => ({ label: String(v), value: String(v) }))
    }
    const obj = result as { options?: Array<{ label?: string; value?: string; name?: string; description?: string }> }
    return (obj.options ?? []).map((o) => ({
      label: o.label ?? o.name ?? o.value ?? "",
      value: o.value ?? o.name ?? o.label ?? "",
      description: o.description,
    }))
  }
```

- [ ] **Step 2: Create execute.ts**

```typescript
// src/commands/execute.ts
import type { AcpClient } from "../acp/client"
import type { CommandDescriptor } from "./registry"
import type { CommandEffect } from "./state"

export interface ExecuteContext {
  client: AcpClient
  sessionId: string
  sendPrompt: (text: string) => Promise<void>
  setInput: (text: string) => void
  localActions: Record<string, () => void>
}

export async function handleEffect(effect: CommandEffect, ctx: ExecuteContext): Promise<string[] | undefined> {
  if (effect.type === "execute") {
    const cmdName = effect.command.split(" ")[0]
    const localAction = ctx.localActions[cmdName]
    if (localAction) {
      localAction()
      return undefined
    }
    // Determine if this is a panel command
    const text = effect.command
    // Caller decides panel vs transcript routing based on command descriptor
    await ctx.sendPrompt(text)
    return undefined
  }

  if (effect.type === "fetch-options") {
    const options = await ctx.client.fetchOptions(effect.method)
    return options.map((o) => o.label)
  }

  if (effect.type === "set-input") {
    ctx.setInput(effect.text)
    return undefined
  }

  return undefined
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/execute.ts src/acp/client.ts
git commit -m "feat: add command execution and fetchOptions"
```

---

### Task 4: Inline Dropdown Renderer

**Files:**
- Create: `src/ui/dropdown.ts`

- [ ] **Step 1: Implement dropdown renderer**

```typescript
// src/ui/dropdown.ts
import { Box, Text } from "@opentui/core"
import type { CommandDescriptor } from "../commands/registry"
import type { CommandState } from "../commands/state"
import { opencodeTheme } from "./view"

export function buildDropdown(state: Extract<CommandState, { phase: "listing" | "drilldown" }>, items: Array<{ name: string; description: string }>) {
  const maxVisible = 8
  const visibleItems = items.slice(0, maxVisible)
  const isLoading = state.phase === "drilldown" && state.loading

  const children = []

  if (state.phase === "drilldown") {
    children.push(
      Box(
        { flexDirection: "row", width: "100%", paddingLeft: 1, paddingRight: 1 },
        Text({ content: `⟵ ${state.parent.name} — ${state.parent.description}`, fg: opencodeTheme.textMuted }),
      ),
    )
  }

  if (isLoading) {
    children.push(
      Box(
        { flexDirection: "row", paddingLeft: 1, paddingRight: 1 },
        Text({ content: "Loading...", fg: opencodeTheme.textMuted }),
      ),
    )
  } else {
    visibleItems.forEach((item, i) => {
      const selected = i === state.selectedIndex
      children.push(
        Box(
          {
            flexDirection: "row",
            width: "100%",
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: selected ? opencodeTheme.primary : undefined,
          },
          Text({
            content: `${item.name}`,
            fg: selected ? opencodeTheme.background : opencodeTheme.text,
          }),
          Text({
            content: ` — ${item.description}`,
            fg: selected ? opencodeTheme.background : opencodeTheme.textMuted,
          }),
        ),
      )
    })
  }

  children.push(
    Box(
      { flexDirection: "row", paddingLeft: 1, paddingRight: 1 },
      Text({ content: "↑↓ navigate · Enter select · Esc close", fg: opencodeTheme.textMuted }),
    ),
  )

  return Box(
    {
      flexDirection: "column",
      width: "100%",
      maxWidth: 60,
      borderStyle: "single",
      borderColor: opencodeTheme.primary,
      backgroundColor: opencodeTheme.backgroundElement,
    },
    ...children,
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ui/dropdown.ts
git commit -m "feat: add inline dropdown renderer"
```

---

### Task 5: Command Palette Renderer

**Files:**
- Create: `src/ui/palette.ts`

- [ ] **Step 1: Implement palette renderer**

```typescript
// src/ui/palette.ts
import { Box, Text, TextAttributes } from "@opentui/core"
import type { CommandState } from "../commands/state"
import { opencodeTheme } from "./view"

export function buildPalette(state: Extract<CommandState, { phase: "listing" | "drilldown" }>, items: Array<{ name: string; description: string }>) {
  const maxVisible = 12
  const visibleItems = items.slice(0, maxVisible)
  const isLoading = state.phase === "drilldown" && state.loading
  const query = state.query

  const itemRows = []

  if (state.phase === "drilldown") {
    itemRows.push(
      Box(
        { flexDirection: "row", width: "100%", paddingLeft: 1 },
        Text({ content: `⟵ ${state.parent.name} — ${state.parent.description}`, fg: opencodeTheme.textMuted }),
      ),
    )
  }

  if (isLoading) {
    itemRows.push(
      Box(
        { flexDirection: "row", paddingLeft: 1 },
        Text({ content: "Loading...", fg: opencodeTheme.textMuted }),
      ),
    )
  } else {
    visibleItems.forEach((item, i) => {
      const selected = i === state.selectedIndex
      itemRows.push(
        Box(
          {
            flexDirection: "row",
            width: "100%",
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: selected ? opencodeTheme.accent : undefined,
          },
          Text({ content: item.name, fg: selected ? "#fff" : opencodeTheme.text }),
          Text({ content: ` — ${item.description}`, fg: selected ? "#fff" : opencodeTheme.textMuted }),
        ),
      )
    })
  }

  // Rendered as a flex child — positioned by the parent layout in ui.ts
  // which places it centered with margin on either side
  return Box(
    {
      flexDirection: "column",
      width: "70%",
      borderStyle: "single",
      borderColor: opencodeTheme.accent,
      backgroundColor: opencodeTheme.backgroundPanel,
    },
    Box(
      {
        flexDirection: "row",
        width: "100%",
        paddingLeft: 1,
        paddingRight: 1,
        borderStyle: "single",
        borderColor: opencodeTheme.borderSubtle,
      },
      Text({ content: "⌘ ", fg: opencodeTheme.accent }),
      Text({ content: query || " ", fg: opencodeTheme.text }),
    ),
    ...itemRows,
    Box(
      { flexDirection: "row", paddingLeft: 1, paddingRight: 1 },
      Text({ content: "↑↓ navigate · Enter select · Esc close", fg: opencodeTheme.textMuted }),
    ),
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ui/palette.ts
git commit -m "feat: add command palette overlay renderer"
```

---

### Task 6: Panel Overlay Renderer

**Files:**
- Create: `src/ui/panel-overlay.ts`

- [ ] **Step 1: Implement panel overlay renderer**

```typescript
// src/ui/panel-overlay.ts
import { Box, Text } from "@opentui/core"
import { opencodeTheme } from "./view"

export function buildPanelOverlay(title: string, content: string, hints?: string) {
  // Rendered as a flex child — parent layout in ui.ts positions it
  // by conditionally replacing the main content area
  return Box(
    {
      flexDirection: "column",
      width: "90%",
      borderStyle: "single",
      borderColor: opencodeTheme.secondary,
      backgroundColor: opencodeTheme.backgroundPanel,
      padding: 1,
      gap: 1,
    },
    Text({ content: title, fg: opencodeTheme.secondary }),
    Text({ content, fg: opencodeTheme.text }),
    Text({ content: hints ?? "Esc close", fg: opencodeTheme.textMuted }),
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ui/panel-overlay.ts
git commit -m "feat: add panel overlay renderer"
```

---

### Task 7: Integrate into UI and Index

**Files:**
- Modify: `src/ui/view.ts`
- Modify: `src/ui.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update handleInputKey to signal `/` activation**

In `src/ui/view.ts`, change the return type to include an optional `activate` signal:

```typescript
export type InputKeyResult = {
  value: string
  submit?: string
  activate?: "slash"
}
```

In the handler, add before the generic character append block (`if (key.sequence.length === 1 && key.sequence >= " ")`):

```typescript
  if (key.sequence === "/" && value === "") {
    return { value: "/", activate: "slash" }
  }
```

- [ ] **Step 2: Add registry instantiation and pass to UI in index.ts**

At the top of `src/index.ts`, add imports and create registry:

```typescript
import { CommandRegistry } from "./commands/registry"
import { transition, idle, type CommandState, type CommandEvent } from "./commands/state"
import { handleEffect, type ExecuteContext } from "./commands/execute"

const registry = new CommandRegistry()
```

Change the UI creation to pass registry:

```typescript
const ui = await createAgentClientUi({ headless, registry })
```

- [ ] **Step 3: Intercept _kiro.dev/commands/available in index.ts notification handler**

Replace the notification handling block in `transport.onEvent`:

```typescript
transport.onEvent((event) => {
  if (event.type === "notification") {
    if (event.method === "_kiro.dev/commands/available") {
      const params = event.params as { commands?: Array<{ name: string; description: string; meta?: Record<string, unknown> }> }
      const descriptors = (params.commands ?? []).map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        source: "acp" as const,
        inputType: cmd.meta?.inputType as "selection" | "panel" | undefined,
        subcommands: cmd.meta?.subcommands as string[] | undefined,
        subcommandHints: cmd.meta?.subcommandHints as Record<string, string> | undefined,
        optionsMethod: cmd.meta?.optionsMethod as string | undefined,
        hint: cmd.meta?.hint as string | undefined,
        hidden: cmd.meta?.hidden as boolean | undefined,
      }))
      registry.setAcpCommands(descriptors)
      return
    }

    const text = extractAgentText(event.params)
    if (text !== null) {
      if (activePanelCommand) {
        panelText += text
        ui.updatePanel(panelText)
      } else if (!isStreaming) {
        isStreaming = true
        streamingText = text
        ui.append({ kind: "agent", text: streamingText })
      } else {
        streamingText += text
        ui.updateLast(streamingText)
      }
    }
  } else if (event.type === "protocol-error") {
    ui.append({ kind: "error", text: event.raw ? `${event.message}: ${event.raw}` : event.message })
  } else if (event.type === "exit") {
    ui.setStatus(`agent exited (${event.code ?? event.signal ?? "unknown"})`)
  }
})
```

Add panel tracking variables alongside existing streaming state:

```typescript
let activePanelCommand: string | null = null
let panelText = ""
```

- [ ] **Step 4: Update createAgentClientUi signature and add command key handling in ui.ts**

Change the options type and add command state:

```typescript
import { CommandRegistry } from "./commands/registry"
import { transition, idle, type CommandState, type CommandEvent } from "./commands/state"
import { buildDropdown } from "./ui/dropdown"
import { buildPalette } from "./ui/palette"
import { buildPanelOverlay } from "./ui/panel-overlay"

export type UiOptions = {
  headless?: boolean
  registry?: CommandRegistry
  onFetchOptions?: (method: string) => Promise<string[]>
}

export async function createAgentClientUi(options: UiOptions = {}): Promise<AgentClientUi> {
```

Update `AgentClientUi` interface — `onSubmit` handler includes panel option:

```typescript
export type AgentClientUi = {
  isInteractive: boolean
  setStatus(status: string): void
  onSubmit(handler: (prompt: string, options?: { panel?: boolean }) => void | Promise<void>): void
  append(entry: TranscriptEntry): void
  updateLast(text: string): void
  showPanel(title: string): void
  updatePanel(content: string): void
  hidePanel(): void
  destroy(): void
}
```

Inside the interactive UI branch, add state variables:

```typescript
  let commandState: CommandState = idle()
  const registry = options.registry ?? new CommandRegistry()
  const fetchOptions = options.onFetchOptions
  let panelOverlay: { title: string; content: string } | null = null
```

Replace the keypress handler with command-aware version:

```typescript
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    // Ctrl+P always opens palette (intercept before anything else)
    if (key.name === "p" && key.ctrl) {
      const result = transition(commandState, { type: "ctrl-p" })
      commandState = result.state
      render()
      return
    }

    // Esc dismisses panel overlay if open
    if (key.name === "escape" && panelOverlay) {
      panelOverlay = null
      render()
      return
    }

    // If command UI is active, route keys to state machine
    if (commandState.phase !== "idle") {
      const event = mapKeyToCommandEvent(key, commandState)
      if (event) {
        const result = transition(commandState, event)
        commandState = result.state

        if (result.effect?.type === "execute") {
          const cmdText = result.effect.command
          const cmdName = cmdText.split(" ")[0]
          const descriptor = registry.get(cmdName)
          const isPanel = descriptor?.inputType === "panel"
          if (submitHandler) void submitHandler(cmdText, { panel: isPanel })
        } else if (result.effect?.type === "fetch-options" && fetchOptions) {
          const method = result.effect.method
          void (async () => {
            const items = await fetchOptions(method)
            if (commandState.phase === "drilldown") {
              const loaded = transition(commandState, { type: "options-loaded", items })
              commandState = loaded.state
              render()
            }
          })()
        }

        // If transitioning to argument phase, set input value
        if (commandState.phase === "argument") {
          inputValue = commandState.commandText
          commandState = idle()
        }
      }
      render()
      return
    }

    // Normal input handling
    const result = handleInputKey(inputValue, key)
    inputValue = result.value
    cursorVisible = true

    // Check if / was typed into empty input
    if (result.activate === "slash") {
      const tr = transition(commandState, { type: "slash-typed" })
      commandState = tr.state
    }

    render()

    if (result.submit && submitHandler) {
      void submitHandler(result.submit)
    }
  })
```

Add the key-to-event mapping helper inside the function scope:

```typescript
  function mapKeyToCommandEvent(key: KeyEvent, state: CommandState): CommandEvent | null {
    if (key.name === "escape") return { type: "esc" }
    if (key.name === "up") return { type: "arrow-up" }
    if (key.name === "down") return { type: "arrow-down" }
    if (key.name === "backspace") return { type: "backspace" }
    if (key.name === "return") {
      // Resolve current selection to a command or item
      if (state.phase === "listing") {
        const query = state.query
        const items = registry.search(query, state.surface === "dropdown" ? { source: "acp" } : undefined)
        const selected = items[state.selectedIndex]
        if (selected) return { type: "select", command: selected }
      } else if (state.phase === "drilldown" && !state.loading) {
        const filtered = state.items.filter((item) =>
          state.query === "" || item.toLowerCase().includes(state.query.toLowerCase())
        )
        const item = filtered[state.selectedIndex]
        if (item) return { type: "select-item", item }
      }
      return null
    }
    // Character input for filtering
    if (key.sequence.length === 1 && key.sequence >= " ") {
      return { type: "char", char: key.sequence }
    }
    return null
  }
```

- [ ] **Step 5: Add conditional rendering for dropdown/palette/panel in the render function**

The render function conditionally replaces the main content area when overlays are active. The full modified structure (showing the main body section only — header and footer unchanged):

```typescript
    // Replace the main content row with overlay content when active
    const mainContent = (() => {
      // Command palette takes over the full content area
      if (commandState.phase !== "idle" && (commandState as any).surface === "palette") {
        const query = "query" in commandState ? (commandState as any).query : ""
        const items = commandState.phase === "listing"
          ? registry.search(query).map((c) => ({ name: c.name, description: c.description }))
          : (commandState as Extract<CommandState, { phase: "drilldown" }>).items
              .filter((i) => !query || i.toLowerCase().includes(query.toLowerCase()))
              .map((i) => ({ name: i, description: "" }))
        return Box(
          { flexDirection: "column", flexGrow: 1, width: "100%", alignItems: "center", justifyContent: "center" },
          buildPalette(commandState as any, items),
        )
      }

      // Panel overlay replaces content area
      if (panelOverlay) {
        return Box(
          { flexDirection: "column", flexGrow: 1, width: "100%", alignItems: "center", padding: 1 },
          buildPanelOverlay(panelOverlay.title, panelOverlay.content),
        )
      }

      // Normal layout: transcript panel + sidebar
      return Box(
        { flexDirection: "row", flexGrow: 1, width: "100%", gap: 1 },
        Box(
          {
            flexDirection: "column",
            flexGrow: 1,
            backgroundColor: opencodeTheme.backgroundPanel,
            borderStyle: "single",
            borderColor: opencodeTheme.borderSubtle,
            padding: 1,
            gap: 0,
          },
          Box(
            { flexDirection: "column", flexGrow: 1, width: "100%" },
            Text({ content: "transcript panel", fg: opencodeTheme.textMuted }),
            ...rows.map((row) =>
              Box(
                { flexDirection: "row", gap: 1, width: "100%" },
                Text({ content: row.label.padEnd(12), fg: row.color }),
                Text({ content: row.text, fg: opencodeTheme.text }),
              ),
            ),
          ),
          // Dropdown renders above input bar when active
          ...(commandState.phase !== "idle" && (commandState as any).surface === "dropdown"
            ? [(() => {
                const query = "query" in commandState ? (commandState as any).query : ""
                const items = commandState.phase === "listing"
                  ? registry.search(query, { source: "acp" }).map((c) => ({ name: c.name, description: c.description }))
                  : (commandState as Extract<CommandState, { phase: "drilldown" }>).items
                      .filter((i) => !query || i.toLowerCase().includes(query.toLowerCase()))
                      .map((i) => ({ name: i, description: "" }))
                return buildDropdown(commandState as any, items)
              })()]
            : []),
          // Input bar
          Box(
            {
              flexDirection: "row",
              width: "100%",
              backgroundColor: opencodeTheme.backgroundElement,
              borderStyle: "single",
              borderColor: opencodeTheme.borderSubtle,
              paddingLeft: 1,
              paddingRight: 1,
              gap: 1,
            },
            Text({ content: inputBar.prompt, fg: inputBar.promptColor, attributes: TextAttributes.BOLD }),
            Text({ content: inputBar.value ?? "", fg: inputBar.valueColor ?? opencodeTheme.text }),
          ),
        ),
        // Sidebar (session info panel)
        Box(
          {
            flexDirection: "column",
            width: 34,
            backgroundColor: opencodeTheme.backgroundPanel,
            borderStyle: "single",
            borderColor: opencodeTheme.borderSubtle,
            padding: 1,
            gap: 1,
          },
          Text({ content: "session info", fg: opencodeTheme.primary, attributes: TextAttributes.BOLD }),
          Text({ content: `status  ${status}`, fg: opencodeTheme.text }),
          Text({ content: `server  ${agent?.label ?? "unknown"}`, fg: opencodeTheme.textMuted }),
          Text({ content: "", fg: opencodeTheme.textMuted }),
          Text({ content: "capabilities", fg: opencodeTheme.accent }),
          Text({ content: "● prompt", fg: opencodeTheme.success }),
          Text({ content: "● stream", fg: opencodeTheme.success }),
          Text({ content: "· tools pending", fg: opencodeTheme.textMuted }),
        ),
      )
    })()
```

Then in the main app-root Box, use `mainContent` in place of the current inline content row. The rest of the render function (header row, footer row) stays the same.

- [ ] **Step 6: Add panel-related methods to the UI interface and implementation**

```typescript
// Add to AgentClientUi type:
showPanel(title: string): void
updatePanel(content: string): void
hidePanel(): void

// Implementations:
showPanel(title: string) {
  panelOverlay = { title, content: "" }
  render()
},
updatePanel(content: string) {
  if (panelOverlay) {
    panelOverlay.content = content
    render()
  }
},
hidePanel() {
  panelOverlay = null
  render()
},
```

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Run all tests**

Run: `bun test`
Expected: All tests pass (existing view tests + new registry + state tests)

- [ ] **Step 9: Manual verification with Kiro**

Run: `npm run dev -- --agent "kiro-cli acp --trust-all-tools"`
Verify: Typing `/` shows the command dropdown with Kiro's commands. `Ctrl+P` shows the palette.

- [ ] **Step 10: Commit**

```bash
git add src/ui/view.ts src/ui.ts src/index.ts
git commit -m "feat: integrate command system into UI with / dropdown and Ctrl+P palette"
```

---

### Task 8: Panel Command Routing in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update sendPrompt to accept panel option and pass onFetchOptions to UI**

In `src/index.ts`, update the UI creation to pass the fetch callback:

```typescript
const ui = await createAgentClientUi({
  headless,
  registry,
  onFetchOptions: async (method) => {
    const options = await client.fetchOptions(method)
    return options.map((o) => o.label)
  },
})
```

Update `sendPrompt` to handle the panel option:

```typescript
  async function sendPrompt(prompt: string, options?: { panel?: boolean }): Promise<void> {
    if (promptInFlight) {
      ui.append({ kind: "status", text: "prompt already running" })
      return
    }

    promptInFlight = true
    streamingText = ""
    isStreaming = false

    if (options?.panel) {
      activePanelCommand = prompt
      panelText = ""
      ui.showPanel(prompt)
    } else {
      ui.append({ kind: "user", text: prompt })
    }

    ui.setStatus("prompting")

    try {
      await client.prompt(sessionId, prompt)
      ui.setStatus("ready")
    } catch (error) {
      ui.append({ kind: "error", text: (error as Error).message })
      ui.setStatus("failed")
    } finally {
      promptInFlight = false
      isStreaming = false
      activePanelCommand = null
    }
  }

  ui.onSubmit(sendPrompt)
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Manual test**

Run: `npm run dev -- --agent "kiro-cli acp --trust-all-tools"`
Test: Execute `/tools` — verify output appears in overlay, not transcript. Press Esc to dismiss.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire panel command routing and fetchOptions in index.ts"
```

---

### Task 9: Add Local TUI Commands

**Files:**
- Modify: `src/ui.ts` or `src/index.ts`

- [ ] **Step 1: Register local commands**

```typescript
registry.addLocalCommand({ name: "Quit", description: "Exit AgentClientTUI", source: "local" })
registry.addLocalCommand({ name: "Toggle Session Panel", description: "Show/hide sidebar", source: "local" })
```

- [ ] **Step 2: Implement local action handlers**

```typescript
const localActions: Record<string, () => void> = {
  Quit: () => { transport.destroy(); ui.destroy(); process.exit(0) },
  "Toggle Session Panel": () => { /* toggle sidebar visibility */ },
}
```

- [ ] **Step 3: Run typecheck and manual test**

Run: `npx tsc --noEmit`
Test: Open `Ctrl+P`, verify local commands appear alongside ACP commands.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add local TUI commands to palette"
```

---

### Task 10: Final Smoke Test and Cleanup

**Files:**
- Modify: `scripts/smoke.ts` (if needed)

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run smoke test**

Run: `npm run smoke`
Expected: Pass

- [ ] **Step 4: Manual end-to-end with Kiro**

Run: `npm run dev -- --agent "kiro-cli acp --trust-all-tools"`
Verify:
- `/` in empty input shows dropdown with Kiro commands
- Typing filters the list
- Arrow keys navigate, Enter selects
- `/model` drills down to model options
- `/context add` inserts into input bar
- `Ctrl+P` shows palette with all commands + local actions
- `/tools` shows panel overlay, Esc dismisses
- Esc at any point closes UI

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: smoke test verification for command system"
```
