# Refactor Codebase Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the codebase structure by removing dead code, extracting duplicated logic, and splitting large UI responsibilities without changing user-visible behavior.

**Architecture:** Keep `src/index.ts` as composition, `src/acp/*` as protocol boundary, `src/commands/*` as command state and selection logic, and `src/ui/*` as rendering modules. Refactor by small extractions with tests first, leaving larger behavior changes like capability-driven UI and permission UX for separate work.

**Tech Stack:** TypeScript, Bun test runner, OpenTUI core, JSON-RPC over stdio ACP.

---

## Scope Guard

- Preserve current runtime behavior unless a test exposes an accidental bug.
- Do not redesign ACP permissions in this branch.
- Do not implement capability-driven UI in this branch.
- Do not replace OpenTUI rendering architecture in one pass.
- Do not remove mock agent features unless they are proven unused by tests.

## Target File Structure

- `TASK.md`: root execution brief for this treebranch.
- `src/commands/items.ts`: command filtering, visible item mapping, selected item lookup, and selected index clamping.
- `src/commands/items.test.ts`: tests for command selection helpers.
- `src/commands/state.ts`: command state machine only. No dead effect variants.
- `src/commands/execute.ts`: deleted because it is disconnected from current execution flow.
- `src/ui/command-list.ts`: shared list windowing model used by dropdown and palette.
- `src/ui/command-list.test.ts`: tests for list windowing and row selection.
- `src/ui/dropdown.ts`: dropdown rendering only.
- `src/ui/palette.ts`: palette rendering only.
- `src/ui/text-ui.ts`: headless text UI fallback.
- `src/ui/transcript-renderer.ts`: OpenTUI transcript render builders.
- `src/ui.ts`: top-level UI controller and renderer wiring.
- `src/acp/commands.ts`: ACP and Kiro command update parsing.
- `src/acp/commands.test.ts`: tests for command update parsing.
- `src/index.ts`: app composition, prompt queue, and event routing only.

## Task 1: Baseline Verification

**Files:**
- Read: `package.json`
- Read: `src/ui.ts`
- Read: `src/index.ts`

- [ ] **Step 1: Check worktree status**

Run:

```bash
git status --short
```

Expected: only setup files are modified before implementation begins.

- [ ] **Step 2: Run baseline tests**

Run:

```bash
bun test
```

Expected: all tests pass before refactor work begins.

- [ ] **Step 3: Run baseline typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript completes with no errors.

- [ ] **Step 4: Run baseline smoke check**

Run:

```bash
npm run smoke
```

Expected: prints `Smoke test passed`.

## Task 2: Remove Dead Command Effect Code

**Files:**
- Modify: `src/commands/state.ts`
- Delete: `src/commands/execute.ts`
- Test: `src/commands/state.test.ts`

- [ ] **Step 1: Confirm dead code references**

Run:

```bash
rg "handleEffect|ExecuteContext|set-input|commands/execute" src
```

Expected before change: matches only in `src/commands/execute.ts` and `src/commands/state.ts`.

- [ ] **Step 2: Remove dead effect variant**

In `src/commands/state.ts`, change `CommandEffect` to:

```ts
export type CommandEffect =
  | { type: "execute"; command: string }
  | { type: "fetch-options"; method: string }
```

- [ ] **Step 3: Delete unused effect handler**

Delete `src/commands/execute.ts`.

- [ ] **Step 4: Verify no references remain**

Run:

```bash
rg "handleEffect|ExecuteContext|set-input|commands/execute" src
```

Expected: no matches.

- [ ] **Step 5: Run command state tests**

Run:

```bash
bun test src/commands/state.test.ts
```

Expected: tests pass.

## Task 3: Extract Command Item Helpers

**Files:**
- Create: `src/commands/items.ts`
- Create: `src/commands/items.test.ts`
- Modify: `src/ui.ts`

- [ ] **Step 1: Add failing tests for item helpers**

Create `src/commands/items.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { CommandRegistry } from "./registry"
import type { CommandState } from "./state"
import {
  clampCommandSelectedIndex,
  getCommandItems,
  getSelectedCommandDescriptor,
  getSelectedDrilldownItem,
} from "./items"

function registryWithCommands(): CommandRegistry {
  const registry = new CommandRegistry()
  registry.setAcpCommands([
    { name: "/model", description: "Switch model", source: "acp" },
    { name: "/context", description: "Show context", source: "acp" },
  ])
  registry.addLocalCommand({ name: "Quit", description: "Exit", source: "local" })
  return registry
}

describe("command item helpers", () => {
  test("lists ACP commands only for slash dropdown", () => {
    const state: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    expect(getCommandItems(state, registryWithCommands())).toEqual([
      { name: "/model", description: "Switch model" },
      { name: "/context", description: "Show context" },
    ])
  })

  test("lists ACP and local commands for palette", () => {
    const state: CommandState = { phase: "listing", query: "", surface: "palette", selectedIndex: 0 }
    expect(getCommandItems(state, registryWithCommands()).map((item) => item.name)).toEqual([
      "/model",
      "/context",
      "Quit",
    ])
  })

  test("filters drilldown items by label or value", () => {
    const state: CommandState = {
      phase: "drilldown",
      parent: { name: "/model", description: "Switch model", source: "acp" },
      items: [{ label: "sonnet", value: "claude-sonnet" }, { label: "opus", value: "claude-opus" }],
      loading: false,
      query: "claude-s",
      selectedIndex: 0,
      surface: "dropdown",
    }
    expect(getCommandItems(state, registryWithCommands())).toEqual([
      { name: "sonnet", description: "" },
    ])
    expect(getSelectedDrilldownItem(state)).toEqual({ label: "sonnet", value: "claude-sonnet" })
  })

  test("gets selected command descriptor for listing state", () => {
    const state: CommandState = { phase: "listing", query: "context", surface: "dropdown", selectedIndex: 0 }
    expect(getSelectedCommandDescriptor(state, registryWithCommands())?.name).toBe("/context")
  })

  test("clamps selected index to visible item count", () => {
    const state: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 20 }
    expect(clampCommandSelectedIndex(state, 2)).toEqual({ ...state, selectedIndex: 1 })
    expect(clampCommandSelectedIndex(state, 0)).toEqual({ ...state, selectedIndex: 0 })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test src/commands/items.test.ts
```

Expected: fail because `src/commands/items.ts` does not exist.

- [ ] **Step 3: Implement command item helpers**

Create `src/commands/items.ts`:

```ts
import type { CommandDescriptor, CommandRegistry } from "./registry"
import type { CommandItem, CommandState } from "./state"

export type CommandListItem = { name: string; description: string }

function getItemLabel(item: CommandItem): string {
  return typeof item === "string" ? item : item.label
}

function getItemValue(item: CommandItem): string {
  return typeof item === "string" ? item : item.value
}

function getItemDescription(item: CommandItem): string {
  return typeof item === "string" ? "" : item.description ?? ""
}

function getFilteredDrilldownItems(state: Extract<CommandState, { phase: "drilldown" }>): CommandItem[] {
  const query = state.query.toLowerCase()
  return state.items.filter((item) => {
    const label = getItemLabel(item).toLowerCase()
    const value = getItemValue(item).toLowerCase()
    return !query || label.includes(query) || value.includes(query)
  })
}

export function getCommandItems(state: CommandState, registry: CommandRegistry): CommandListItem[] {
  if (state.phase === "listing") {
    const source = state.surface === "dropdown" ? "acp" as const : undefined
    return registry.search(state.query, source ? { source } : undefined).map((command) => ({
      name: command.name,
      description: command.description,
    }))
  }

  if (state.phase === "drilldown") {
    return getFilteredDrilldownItems(state).map((item) => ({
      name: getItemLabel(item),
      description: getItemDescription(item),
    }))
  }

  return []
}

export function getSelectedCommandDescriptor(
  state: Extract<CommandState, { phase: "listing" }>,
  registry: CommandRegistry,
): CommandDescriptor | undefined {
  const source = state.surface === "dropdown" ? "acp" as const : undefined
  return registry.search(state.query, source ? { source } : undefined)[state.selectedIndex]
}

export function getSelectedDrilldownItem(
  state: Extract<CommandState, { phase: "drilldown" }>,
): CommandItem | undefined {
  return getFilteredDrilldownItems(state)[state.selectedIndex]
}

export function clampCommandSelectedIndex<T extends Extract<CommandState, { phase: "listing" | "drilldown" }>>(
  state: T,
  itemCount: number,
): T {
  if (state.selectedIndex < itemCount) return state
  return { ...state, selectedIndex: Math.max(0, itemCount - 1) }
}
```

- [ ] **Step 4: Refactor `src/ui.ts` to use helpers**

In `src/ui.ts`, import helpers:

```ts
import {
  clampCommandSelectedIndex,
  getCommandItems,
  getSelectedCommandDescriptor,
  getSelectedDrilldownItem,
} from "./commands/items"
```

Remove local `getItemLabel`, `getItemDescription`, and `getCommandItems` helpers.

In `mapKeyToCommandEvent`, replace listing selection with:

```ts
const selected = getSelectedCommandDescriptor(commandState, registry)
if (selected) return { type: "select", command: selected }
```

Replace drilldown selection with:

```ts
const item = getSelectedDrilldownItem(commandState)
if (item) return { type: "select-item", item }
```

Replace clamping block with:

```ts
const itemCount = getCommandItems(commandState, registry).length
commandState = clampCommandSelectedIndex(commandState, itemCount)
```

Replace render calls with:

```ts
buildDropdown(commandState, getCommandItems(commandState, registry))
```

and:

```ts
buildPalette(commandState, getCommandItems(commandState, registry))
```

- [ ] **Step 5: Run helper and UI tests**

Run:

```bash
bun test src/commands/items.test.ts src/ui/e2e.test.ts
```

Expected: tests pass.

## Task 4: Deduplicate Dropdown And Palette List Windowing

**Files:**
- Create: `src/ui/command-list.ts`
- Create: `src/ui/command-list.test.ts`
- Modify: `src/ui/dropdown.ts`
- Modify: `src/ui/palette.ts`

- [ ] **Step 1: Add failing command list window tests**

Create `src/ui/command-list.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { buildCommandListWindow } from "./command-list"

const items = Array.from({ length: 6 }, (_, index) => ({
  name: `/item-${index + 1}`,
  description: `Item ${index + 1}`,
}))

describe("command list window", () => {
  test("returns visible rows with selected state", () => {
    expect(buildCommandListWindow(items, 1, 3)).toEqual({
      scrollStart: 0,
      rows: [
        { item: items[0], index: 0, selected: false },
        { item: items[1], index: 1, selected: true },
        { item: items[2], index: 2, selected: false },
      ],
    })
  })

  test("scrolls selected row into view", () => {
    expect(buildCommandListWindow(items, 5, 3)).toEqual({
      scrollStart: 3,
      rows: [
        { item: items[3], index: 3, selected: false },
        { item: items[4], index: 4, selected: false },
        { item: items[5], index: 5, selected: true },
      ],
    })
  })

  test("handles empty lists", () => {
    expect(buildCommandListWindow([], 0, 3)).toEqual({ scrollStart: 0, rows: [] })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test src/ui/command-list.test.ts
```

Expected: fail because `src/ui/command-list.ts` does not exist.

- [ ] **Step 3: Implement shared list windowing**

Create `src/ui/command-list.ts`:

```ts
export type CommandListDisplayItem = { name: string; description: string }

export type CommandListRow = {
  item: CommandListDisplayItem
  index: number
  selected: boolean
}

export type CommandListWindow = {
  scrollStart: number
  rows: CommandListRow[]
}

export function buildCommandListWindow(
  items: CommandListDisplayItem[],
  selectedIndex: number,
  maxVisible: number,
): CommandListWindow {
  const scrollStart = Math.max(0, Math.min(selectedIndex - maxVisible + 1, items.length - maxVisible))
  const rows = items.slice(scrollStart, scrollStart + maxVisible).map((item, offset) => {
    const index = scrollStart + offset
    return { item, index, selected: index === selectedIndex }
  })
  return { scrollStart, rows }
}
```

- [ ] **Step 4: Use helper in dropdown**

In `src/ui/dropdown.ts`, import:

```ts
import { buildCommandListWindow, type CommandListDisplayItem } from "./command-list"
```

Change the `items` parameter type to `CommandListDisplayItem[]`.

Replace local `scrollStart` and `visibleItems` with:

```ts
const listWindow = buildCommandListWindow(items, state.selectedIndex, maxVisible)
```

Replace `visibleItems.forEach((item, i) => { ... })` with:

```ts
listWindow.rows.forEach(({ item, selected }) => {
```

Change row count calculation to use `listWindow.rows.length`.

- [ ] **Step 5: Use helper in palette**

In `src/ui/palette.ts`, import:

```ts
import { buildCommandListWindow, type CommandListDisplayItem } from "./command-list"
```

Change the `items` parameter type to `CommandListDisplayItem[]`.

Replace local `scrollStart` and `visibleItems` with:

```ts
const listWindow = buildCommandListWindow(items, state.selectedIndex, maxVisible)
```

Replace `visibleItems.forEach((item, i) => { ... })` with:

```ts
listWindow.rows.forEach(({ item, selected }) => {
```

- [ ] **Step 6: Run command list and e2e tests**

Run:

```bash
bun test src/ui/command-list.test.ts src/ui/e2e.test.ts
```

Expected: tests pass.

## Task 5: Move Text UI Fallback Out Of `src/ui.ts`

**Files:**
- Create: `src/ui/text-ui.ts`
- Modify: `src/ui.ts`
- Test: `src/ui/view.test.ts`
- Test: `scripts/smoke.ts`

- [ ] **Step 1: Move text UI implementation**

Create `src/ui/text-ui.ts` with the existing `createTextUi` implementation from `src/ui.ts`:

```ts
import { buildTranscriptRows, type TranscriptEntry } from "./view"

export type TextAgentClientUi = {
  isInteractive: false
  setStatus(status: string): void
  onSubmit(): void
  append(entry: TranscriptEntry): void
  updateLast(): void
  finishAgentMessage(): void
  showPanel(): void
  updatePanel(): void
  hidePanel(): void
  toggleSidebar(): void
  destroy(): void
}

export function createTextUi(): TextAgentClientUi {
  return {
    isInteractive: false,
    setStatus(status) {
      process.stdout.write(`\u25cf status ${status}\n`)
    },
    onSubmit() {},
    append(entry) {
      for (const row of buildTranscriptRows([entry])) {
        process.stdout.write(`${row.label} ${row.text}\n`)
      }
    },
    updateLast() {},
    finishAgentMessage() {},
    showPanel() {},
    updatePanel() {},
    hidePanel() {},
    toggleSidebar() {},
    destroy() {},
  }
}
```

- [ ] **Step 2: Import text UI in controller**

In `src/ui.ts`, add:

```ts
import { createTextUi } from "./ui/text-ui"
```

Delete the local `createTextUi` function from the bottom of `src/ui.ts`.

- [ ] **Step 3: Run smoke test**

Run:

```bash
npm run smoke
```

Expected: prints `Smoke test passed`.

## Task 6: Move Transcript Render Builders Out Of `src/ui.ts`

**Files:**
- Create: `src/ui/transcript-renderer.ts`
- Modify: `src/ui.ts`
- Test: `src/ui/e2e.test.ts`
- Test: `src/ui/transcript.test.ts`

- [ ] **Step 1: Extract render helpers**

Create `src/ui/transcript-renderer.ts` and move these functions from `src/ui.ts` into it:

```ts
buildTranscriptLabel
buildUnifiedDiff
buildTranscriptBlock
buildTranscriptMessage
```

Export `buildTranscriptMessage`.

Use this function signature:

```ts
export function buildTranscriptMessage(
  renderer: Awaited<ReturnType<typeof createCliRenderer>>,
  node: TranscriptNode,
): Renderable
```

Keep the existing renderable IDs, colors, diff options, code options, and label formatting unchanged.

- [ ] **Step 2: Replace local helper calls**

In `src/ui.ts`, import:

```ts
import { buildTranscriptMessage } from "./ui/transcript-renderer"
```

In `syncTranscript`, replace:

```ts
const msg = buildTranscriptMessage(node)
```

with:

```ts
const msg = buildTranscriptMessage(renderer, node)
```

Remove no-longer-used imports from `src/ui.ts`: `CodeRenderable`, `DiffRenderable`, `Renderable`, `filetype`, `getSyntaxStyle`, `getTranscriptLabel`, `opencodeTranscriptTheme`, and `TranscriptBlock` if they are only used by moved code.

- [ ] **Step 3: Run UI tests**

Run:

```bash
bun test src/ui/e2e.test.ts src/ui/transcript.test.ts
```

Expected: tests pass.

## Task 7: Move ACP Command Update Parsing Out Of `src/index.ts`

**Files:**
- Create: `src/acp/commands.ts`
- Create: `src/acp/commands.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add tests for ACP command parsing**

Create `src/acp/commands.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { commandsFromAcpUpdate, commandsFromKiroAvailable } from "./commands"

describe("ACP command parsing", () => {
  test("parses standard available command updates", () => {
    expect(commandsFromAcpUpdate({
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "model", description: "Switch model" },
          { name: "/mode", description: "Switch mode" },
        ],
      },
    })).toEqual([
      { name: "/model", description: "Switch model", source: "acp" },
      { name: "/mode", description: "Switch mode", source: "acp" },
    ])
  })

  test("parses Kiro command metadata", () => {
    expect(commandsFromKiroAvailable({
      commands: [{
        name: "/context",
        description: "Show context",
        meta: {
          inputType: "panel",
          subcommands: ["show"],
          subcommandHints: { add: "<path>" },
          optionsMethod: "_mock/options",
          hint: "context command",
          hidden: false,
        },
      }],
    })).toEqual([{
      name: "/context",
      description: "Show context",
      source: "acp",
      inputType: "panel",
      subcommands: ["show"],
      subcommandHints: { add: "<path>" },
      optionsMethod: "_mock/options",
      hint: "context command",
      hidden: false,
    }])
  })

  test("ignores malformed command payloads", () => {
    expect(commandsFromAcpUpdate({ update: { sessionUpdate: "available_commands_update", availableCommands: [null, { description: "missing name" }] } })).toEqual([])
    expect(commandsFromKiroAvailable({ commands: [null, { description: "missing name" }] })).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test src/acp/commands.test.ts
```

Expected: fail because `src/acp/commands.ts` does not exist.

- [ ] **Step 3: Implement command parsers**

Create `src/acp/commands.ts`:

```ts
import type { CommandDescriptor } from "../commands/registry"

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function commandName(value: string): string {
  return value.startsWith("/") ? value : `/${value}`
}

export function commandsFromAcpUpdate(params: unknown): CommandDescriptor[] | null {
  const record = asRecord(params)
  const update = asRecord(record?.update)
  if (update?.sessionUpdate !== "available_commands_update" || !Array.isArray(update.availableCommands)) return null

  return update.availableCommands.flatMap((command) => {
    const c = asRecord(command)
    if (!c || typeof c.name !== "string") return []
    return [{
      name: commandName(c.name),
      description: typeof c.description === "string" ? c.description : "",
      source: "acp" as const,
    }]
  })
}

export function commandsFromKiroAvailable(params: unknown): CommandDescriptor[] {
  const record = asRecord(params)
  const commands = Array.isArray(record?.commands) ? record.commands : []
  return commands.flatMap((command) => {
    const cmd = asRecord(command)
    if (!cmd || typeof cmd.name !== "string") return []
    const meta = asRecord(cmd.meta)
    return [{
      name: cmd.name,
      description: typeof cmd.description === "string" ? cmd.description : "",
      source: "acp" as const,
      ...(meta?.inputType === "selection" || meta?.inputType === "panel" ? { inputType: meta.inputType } : {}),
      ...(Array.isArray(meta?.subcommands) ? { subcommands: meta.subcommands.filter((item): item is string => typeof item === "string") } : {}),
      ...(asRecord(meta?.subcommandHints) ? { subcommandHints: meta.subcommandHints as Record<string, string> } : {}),
      ...(typeof meta?.optionsMethod === "string" ? { optionsMethod: meta.optionsMethod } : {}),
      ...(typeof meta?.hint === "string" ? { hint: meta.hint } : {}),
      ...(typeof meta?.hidden === "boolean" ? { hidden: meta.hidden } : {}),
    }]
  })
}
```

- [ ] **Step 4: Use parsers in `src/index.ts`**

In `src/index.ts`, import:

```ts
import { commandsFromAcpUpdate, commandsFromKiroAvailable } from "./acp/commands"
```

Delete local `commandsFromAvailableCommandsUpdate`.

Replace the Kiro command block body with:

```ts
registry.setAcpCommands(commandsFromKiroAvailable(event.params))
return
```

Replace standard command extraction with:

```ts
const descriptors = commandsFromAcpUpdate(event.params)
```

- [ ] **Step 5: Run ACP and mock tests**

Run:

```bash
bun test src/acp/commands.test.ts src/acp/session-update.test.ts src/mock-agent.test.ts
```

Expected: tests pass.

## Task 8: Final Verification And Cleanup

**Files:**
- Review: `src/ui.ts`
- Review: `src/index.ts`
- Review: `src/commands/*`
- Review: `src/ui/*`
- Review: `src/acp/*`

- [ ] **Step 1: Run full test suite**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run smoke check**

Run:

```bash
npm run smoke
```

Expected: prints `Smoke test passed`.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: changes are limited to planned refactor files and setup docs.

- [ ] **Step 5: Confirm no dead command effect references remain**

Run:

```bash
rg "handleEffect|ExecuteContext|set-input|commands/execute" src
```

Expected: no matches.

## Completion Criteria

- `src/ui.ts` has fewer responsibilities and no text fallback or transcript render helper definitions.
- Command filtering and selected item lookup live in `src/commands/items.ts`.
- Dropdown and palette share list windowing logic from `src/ui/command-list.ts`.
- ACP command parsing lives in `src/acp/commands.ts`.
- Dead command effect code is removed.
- `bun test`, `npm run typecheck`, and `npm run smoke` pass.
