# Animation Icon Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable quiet, playful, operational, and cyber animation/icon themes without changing colors, layout, borders, or transcript density.

**Architecture:** Add a pure typed animation theme registry, then thread the selected theme through existing OpenTUI render builders. Startup selection comes from CLI args; runtime selection uses a local slash/palette command that updates UI state immediately.

**Tech Stack:** TypeScript, Bun tests, OpenTUI core renderables, existing command registry/state machine.

**Repo Policy:** Do not commit unless the user explicitly asks. Replace commit steps with diff and verification checkpoints.

---

## File Structure

- Create `src/ui/animation-theme.ts`: semantic animation/icon theme registry and formatting helpers. No OpenTUI imports.
- Create `src/ui/animation-theme.test.ts`: pure tests for theme lookup, validation, status formatting, cursor formatting, loading formatting, and tool status icon mapping.
- Modify `src/ui/animation.ts`: keep low-level frame helpers; no theme knowledge.
- Modify `src/ui/view.ts`: allow `buildInputBar()` to receive themed cursor content while preserving existing defaults.
- Modify `src/ui/dropdown.ts`: accept themed loading row text through options.
- Modify `src/ui/palette.ts`: accept themed loading row text through options.
- Modify `src/ui/transcript-renderer.ts`: accept animation theme options and apply themed tool icons to tool burst summary/history rows.
- Modify `src/ui.ts`: own active theme state, pass themed strings to render builders, add `setAnimationTheme()` to UI API, and keep one shared animation timer.
- Create `src/cli-args.ts`: move argument parsing out of `src/index.ts` for direct testing.
- Create `src/cli-args.test.ts`: tests for `--animation-theme` parsing and invalid values.
- Modify `src/index.ts`: use `parseArgs()` from `src/cli-args.ts`, register `/animation-theme`, pass startup theme to UI, and handle runtime theme command.
- Modify `src/commands/registry.ts`: include local slash app commands in slash search when their names start with `/`.
- Modify `src/commands/registry.test.ts`: assert `/animation-theme` appears in slash search and palette search.
- Modify `src/commands/state.test.ts`: assert selecting `/animation-theme` option executes `/animation-theme <value>`.
- Modify `src/ui/e2e.test.ts`: assert themed status, cursor, loading UI, and runtime command behavior.

## Task 1: Pure Animation Theme Registry

**Files:**
- Create: `src/ui/animation-theme.ts`
- Create: `src/ui/animation-theme.test.ts`
- Modify: `src/ui/animation.ts` only if needed to export existing helpers unchanged

- [ ] **Step 1: Write failing theme registry tests**

Create `src/ui/animation-theme.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import {
  animationThemeNames,
  formatThemeCursor,
  formatThemeLoading,
  formatThemedInfoStatus,
  getAnimationTheme,
  getToolStatusIcon,
  isAnimationThemeName,
} from "./animation-theme"

describe("animation icon themes", () => {
  test("validates animation theme names", () => {
    expect(animationThemeNames).toEqual(["quiet", "playful", "operational", "cyber"])
    expect(isAnimationThemeName("quiet")).toBe(true)
    expect(isAnimationThemeName("cyber")).toBe(true)
    expect(isAnimationThemeName("unknown")).toBe(false)
  })

  test("looks up the quiet theme as the default-compatible theme", () => {
    const theme = getAnimationTheme("quiet")

    expect(theme.name).toBe("quiet")
    expect(theme.busyFrames[0]).toBe("⠋")
    expect(theme.statusIcons.ready).toBe("✓")
    expect(theme.staticBusyText).toBe("⋯ working")
  })

  test("formats animated and static info status", () => {
    const quiet = getAnimationTheme("quiet")
    const cyber = getAnimationTheme("cyber")

    expect(formatThemedInfoStatus(quiet, "prompting", 1, "noodling", true)).toBe("⠙ noodling")
    expect(formatThemedInfoStatus(quiet, "prompting", 1, "noodling", false)).toBe("⋯ working")
    expect(formatThemedInfoStatus(cyber, "prompting", 0, "scanning", true)).toBe("▰▱▱ scanning")
    expect(formatThemedInfoStatus(cyber, "ready", 0, "scanning", true)).toBe("󰄬 ready")
    expect(formatThemedInfoStatus(cyber, "failed", 0, "scanning", true)).toBe("󰅚 failed")
    expect(formatThemedInfoStatus(cyber, "launching", 0, "scanning", true)).toBe(" launching")
  })

  test("formats cursor and loading frames with reduced motion fallback", () => {
    const operational = getAnimationTheme("operational")

    expect(formatThemeCursor(operational, 0, true)).toBe("▌")
    expect(formatThemeCursor(operational, 1, true)).toBe("")
    expect(formatThemeCursor(operational, 3, false)).toBe("▌")
    expect(formatThemeLoading(operational, 2, true, "Loading options")).toBe("▝ Loading options")
    expect(formatThemeLoading(operational, 2, false, "Loading options")).toBe("󰔟 Loading options")
  })

  test("maps tool statuses to themed icons", () => {
    const playful = getAnimationTheme("playful")

    expect(getToolStatusIcon(playful, "pending")).toBe("󰇥")
    expect(getToolStatusIcon(playful, "running")).toBe("󰚩")
    expect(getToolStatusIcon(playful, "done")).toBe("󰄬")
    expect(getToolStatusIcon(playful, "failed")).toBe("󰅚")
    expect(getToolStatusIcon(playful, "blocked")).toBe("󰅚")
    expect(getToolStatusIcon(playful, "rejected")).toBe("󰅚")
    expect(getToolStatusIcon(playful, "updated")).toBe("󰚩")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/animation-theme.test.ts`

Expected: FAIL because `src/ui/animation-theme.ts` does not exist.

- [ ] **Step 3: Implement `src/ui/animation-theme.ts`**

Create `src/ui/animation-theme.ts`:

```ts
import { frameAt, opencodeSpinnerFrames } from "./animation"
import type { ToolBurstStatus } from "./transcript"

export const animationThemeNames = ["quiet", "playful", "operational", "cyber"] as const

export type AnimationThemeName = typeof animationThemeNames[number]

export type AnimationIconTheme = {
  name: AnimationThemeName
  busyFrames: readonly string[]
  loadingFrames: readonly string[]
  workingWords: readonly string[]
  cursorFrames: readonly string[]
  statusIcons: {
    ready: string
    failed: string
    generic: string
  }
  toolIcons: {
    running: string
    success: string
    error: string
    waiting: string
  }
  commandIcons: {
    loading: string
    selected: string
  }
  staticBusyText: string
}

const quietWorkingWords = [
  "pondering",
  "crunching",
  "spelunking",
  "noodling",
  "simmering",
  "scheming",
  "rummaging",
  "brewing",
  "wrangling",
  "conjuring",
] as const

export const animationThemes: Record<AnimationThemeName, AnimationIconTheme> = {
  quiet: {
    name: "quiet",
    busyFrames: opencodeSpinnerFrames,
    loadingFrames: ["◜", "◠", "◝", "◞", "◡", "◟"],
    workingWords: quietWorkingWords,
    cursorFrames: ["█", ""],
    statusIcons: { ready: "✓", failed: "×", generic: "●" },
    toolIcons: { running: "⠋", success: "✓", error: "×", waiting: "·" },
    commandIcons: { loading: "⋯", selected: ">" },
    staticBusyText: "⋯ working",
  },
  playful: {
    name: "playful",
    busyFrames: ["󰚩", "󰚪", "󰚫", "󰚬"],
    loadingFrames: ["󰇥", "󰇦", "󰇧", "󰇨"],
    workingWords: ["brewing", "summoning", "sparkling", "juggling", "wandering", "sketching"],
    cursorFrames: ["█", "▓", "▒", "░"],
    statusIcons: { ready: "󰄬", failed: "󰅚", generic: "󰚩" },
    toolIcons: { running: "󰚩", success: "󰄬", error: "󰅚", waiting: "󰇥" },
    commandIcons: { loading: "󰇥", selected: "󰜄" },
    staticBusyText: "󰚩 brewing",
  },
  operational: {
    name: "operational",
    busyFrames: ["󰝤", "󰝥", "󰝦", "󰝧"],
    loadingFrames: ["▖", "▘", "▝", "▗"],
    workingWords: ["routing", "indexing", "running", "checking", "resolving", "tracking"],
    cursorFrames: ["▌", ""],
    statusIcons: { ready: "󰄬", failed: "󰅚", generic: "󰙵" },
    toolIcons: { running: "󰏗", success: "󰄬", error: "󰅚", waiting: "󰔟" },
    commandIcons: { loading: "󰔟", selected: "󰜄" },
    staticBusyText: "󰙵 running",
  },
  cyber: {
    name: "cyber",
    busyFrames: ["▰▱▱", "▱▰▱", "▱▱▰", "▱▰▱"],
    loadingFrames: ["▰▱▱", "▱▰▱", "▱▱▰", "▱▰▱"],
    workingWords: ["scanning", "tracing", "syncing", "routing", "compiling", "charging"],
    cursorFrames: ["▰", "▱"],
    statusIcons: { ready: "󰄬", failed: "󰅚", generic: "" },
    toolIcons: { running: "󰊠", success: "󰄬", error: "󰅚", waiting: "󰌵" },
    commandIcons: { loading: "󰊠", selected: "" },
    staticBusyText: " scanning",
  },
}

export function isAnimationThemeName(value: string): value is AnimationThemeName {
  return (animationThemeNames as readonly string[]).includes(value)
}

export function getAnimationTheme(name: AnimationThemeName): AnimationIconTheme {
  return animationThemes[name]
}

export function pickThemeWorkingWord(theme: AnimationIconTheme, random: () => number = Math.random): string {
  return theme.workingWords[Math.min(theme.workingWords.length - 1, Math.floor(random() * theme.workingWords.length))] ?? theme.workingWords[0] ?? "working"
}

export function formatThemeCursor(theme: AnimationIconTheme, frameIndex: number, animationsEnabled: boolean): string {
  return animationsEnabled ? frameAt(theme.cursorFrames, frameIndex) : theme.cursorFrames[0] ?? "█"
}

export function formatThemeLoading(theme: AnimationIconTheme, frameIndex: number, animationsEnabled: boolean, label: string): string {
  const icon = animationsEnabled ? frameAt(theme.loadingFrames, frameIndex) : theme.commandIcons.loading
  return `${icon} ${label}`
}

export function getToolStatusIcon(theme: AnimationIconTheme, status: ToolBurstStatus): string {
  if (status === "pending") return theme.toolIcons.waiting
  if (status === "done") return theme.toolIcons.success
  if (status === "failed" || status === "blocked" || status === "rejected") return theme.toolIcons.error
  return theme.toolIcons.running
}

export function formatThemedInfoStatus(theme: AnimationIconTheme, status: string, frameIndex: number, workingWord: string, animationsEnabled: boolean): string {
  if (status === "prompting") {
    if (!animationsEnabled) return theme.staticBusyText
    return `${frameAt(theme.busyFrames, frameIndex)} ${workingWord}`
  }
  if (status === "ready") return `${theme.statusIcons.ready} ready`
  if (status === "failed") return `${theme.statusIcons.failed} failed`
  return `${theme.statusIcons.generic} ${status}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ui/animation-theme.test.ts`

Expected: PASS.

- [ ] **Step 5: Check TypeScript**

Run: `npm run typecheck`

Expected: PASS.

## Task 2: Thread Themes Through UI Rendering

**Files:**
- Modify: `src/ui/view.ts`
- Modify: `src/ui/dropdown.ts`
- Modify: `src/ui/palette.ts`
- Modify: `src/ui/transcript-renderer.ts`
- Modify: `src/ui.ts`
- Modify: `src/ui/e2e.test.ts`

- [ ] **Step 1: Write failing E2E tests for themed render output**

Add tests to `src/ui/e2e.test.ts` inside `describe("OpenTUI command e2e", () => { ... })`:

```ts
  test("renders cyber status theme without changing color theme", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      animationTheme: "cyber",
      random: () => 0,
    })

    try {
      ui.setStatus("prompting")
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("▰▱▱ scanning")
      const inputCursor = testRenderer.renderer.root.findDescendantById("input-cursor")
      expect(renderableColor(inputCursor, "fg")).toBe("#a78bfa")
    } finally {
      ui.destroy()
    }
  })

  test("renders operational cursor theme", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      animationTheme: "operational",
    })

    try {
      await testRenderer.mockInput.typeText("hello")
      await testRenderer.flush()

      expect(testRenderer.captureCharFrame()).toContain("hello▌")
    } finally {
      ui.destroy()
    }
  })

  test("renders themed dropdown loading text", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      animationTheme: "playful",
      onFetchOptions: () => new Promise(() => {}),
    })

    try {
      await testRenderer.mockInput.typeText("/")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      expect(testRenderer.captureCharFrame()).toContain("󰇥 Loading options")
    } finally {
      ui.destroy()
    }
  })

  test("renders themed tool burst status icons", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      animationTheme: "operational",
    })

    try {
      ui.append({ kind: "tool", toolCallId: "read-1", toolKind: "read", toolStatus: "running", toolTitle: "Read src/ui.ts" })
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("󰏗")

      ui.append({ kind: "tool", toolCallId: "read-1", toolKind: "read", toolStatus: "done", toolTitle: "Read src/ui.ts" })
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("󰄬")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 2: Run E2E tests to verify they fail**

Run: `npm test -- src/ui/e2e.test.ts`

Expected: FAIL because `animationTheme` is not accepted and render paths are not themed.

- [ ] **Step 3: Modify `buildInputBar()` to accept cursor content**

In `src/ui/view.ts`, change `InputBarOptions` and cursor construction:

```ts
export type InputBarOptions = {
  cursorVisible?: boolean
  cursor?: string
}

export function buildInputBar(value = "", options: InputBarOptions = {}): InputBar {
  return {
    prompt: ">",
    ...(value ? { value, valueColor: opencodeTheme.text } : {}),
    ...(options.cursorVisible ? { cursor: options.cursor ?? "█", cursorColor: opencodeTheme.user } : {}),
    promptColor: opencodeTheme.user,
  }
}
```

- [ ] **Step 4: Modify dropdown and palette loading APIs**

In `src/ui/dropdown.ts`, add options type and use it:

```ts
export type DropdownRenderOptions = {
  loadingText?: string
}

export function buildDropdown(
  state: Extract<CommandState, { phase: "listing" | "drilldown" }>,
  items: CommandListDisplayItem[],
  options: DropdownRenderOptions = {},
) {
```

Replace `Text({ content: "Loading...", fg: opencodeTheme.textMuted })` with:

```ts
Text({ content: options.loadingText ?? "Loading...", fg: opencodeTheme.textMuted })
```

In `src/ui/palette.ts`, add options type and use it:

```ts
export type PaletteRenderOptions = {
  loadingText?: string
}

export function buildPalette(
  state: Extract<CommandState, { phase: "listing" | "drilldown" }>,
  items: CommandListDisplayItem[],
  options: PaletteRenderOptions = {},
) {
```

Replace `Text({ content: "Loading...", fg: opencodeTheme.textMuted })` with:

```ts
Text({ content: options.loadingText ?? "Loading...", fg: opencodeTheme.textMuted })
```

- [ ] **Step 5: Modify transcript renderer to accept tool icons**

In `src/ui/transcript-renderer.ts`, import theme types and helper:

```ts
import { getToolStatusIcon, type AnimationIconTheme } from "./animation-theme"
```

Change `BuildTranscriptMessageOptions`:

```ts
type BuildTranscriptMessageOptions = {
  withRenderContext?: BuildWithRenderContext
  onToolBurstMouseUp?: (nodeId: string) => void
  animationTheme?: AnimationIconTheme
}
```

Inside `buildToolBurstSurface()`, change `rows` creation to prefix themed icons when provided:

```ts
  const currentCall = block.calls.find((call) => call.id === block.currentCallId) ?? block.calls[block.calls.length - 1]
  const summaryIcon = currentCall && options?.animationTheme ? `${getToolStatusIcon(options.animationTheme, currentCall.status)} ` : ""
  const rows = [
    { text: `${summaryIcon}${formatToolBurstSummary(block)}`, color: surface.fg, suffix: "summary" },
    ...(block.expanded ? [
      { text: formatToolBurstHistoryHeader(block), color: surface.fg, suffix: "history-header" },
      ...block.calls.map((call, callIndex) => {
        const icon = options?.animationTheme ? `${getToolStatusIcon(options.animationTheme, call.status)} ` : ""
        return {
          text: `${icon}${formatToolBurstHistoryRow(call)}`,
          color: getToolDisplayTypeColor(call.displayType),
          suffix: `history-${callIndex}`,
        }
      }),
    ] : []),
  ]
```

- [ ] **Step 6: Modify `src/ui.ts` to own active animation theme**

Update imports:

```ts
import {
  formatThemeCursor,
  formatThemeLoading,
  formatThemedInfoStatus,
  getAnimationTheme,
  pickThemeWorkingWord,
  type AnimationThemeName,
} from "./ui/animation-theme"
```

Remove `formatInfoStatus` and `pickWorkingWord` import from `./ui/animation`.

Update `UiOptions`:

```ts
  animationTheme?: AnimationThemeName
```

Update `AgentClientUi`:

```ts
  setAnimationTheme(themeName: AnimationThemeName): void
```

Replace theme initialization lines:

```ts
  let animationTheme = getAnimationTheme(options.animationTheme ?? "quiet")
  let workingWord = pickThemeWorkingWord(animationTheme, random)
```

Change input bar construction:

```ts
    const inputBar = buildInputBar(inputValue, {
      cursorVisible: windowActive && cursorVisible,
      cursor: formatThemeCursor(animationTheme, animationFrame, animationsEnabled),
    })
```

Before dropdown and palette creation, compute loading text:

```ts
    const commandLoadingText = formatThemeLoading(animationTheme, animationFrame, animationsEnabled, "Loading options")
```

Pass loading text:

```ts
      ? buildDropdown(commandState, getCommandItems(commandState, registry), { loadingText: commandLoadingText })
```

```ts
          buildPalette(commandState, getCommandItems(commandState, registry), { loadingText: commandLoadingText }),
```

Pass theme to transcript message build:

```ts
      const msg = buildTranscriptMessage(renderer, node, {
        withRenderContext: buildWithRenderContext,
        onToolBurstMouseUp: toggleToolBurstExpansion,
        animationTheme,
      })
```

Change info bar status text:

```ts
      Text({ content: formatThemedInfoStatus(animationTheme, status, animationFrame, workingWord, animationsEnabled), fg: opencodeTheme.secondary }),
```

Change timer guard so loading UI and cursor themes can animate while command surfaces are open:

```ts
  const animationTimer = setInterval(() => {
    if (!animationsEnabled) return
    if (status !== "prompting" && commandState.phase === "idle") return
    animationFrame += 1
    render()
  }, 80)
```

Change `setStatus()` working word selection:

```ts
        workingWord = pickThemeWorkingWord(animationTheme, random)
```

Add API method near `setStatus`:

```ts
    setAnimationTheme(themeName) {
      animationTheme = getAnimationTheme(themeName)
      workingWord = pickThemeWorkingWord(animationTheme, random)
      animationFrame = 0
      resetTranscriptRenderCache()
      render()
    },
```

- [ ] **Step 7: Run focused tests**

Run: `npm test -- src/ui/animation-theme.test.ts src/ui/e2e.test.ts`

Expected: PASS.

- [ ] **Step 8: Run TypeScript**

Run: `npm run typecheck`

Expected: PASS.

## Task 3: CLI Parsing And Runtime Theme Command

**Files:**
- Create: `src/cli-args.ts`
- Create: `src/cli-args.test.ts`
- Modify: `src/index.ts`
- Modify: `src/commands/registry.ts`
- Modify: `src/commands/registry.test.ts`
- Modify: `src/commands/state.test.ts`
- Modify: `src/ui/e2e.test.ts`

- [ ] **Step 1: Write failing CLI arg tests**

Create `src/cli-args.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { parseArgs } from "./cli-args"

describe("CLI argument parsing", () => {
  test("defaults animation theme to quiet", () => {
    const result = parseArgs([], { isBunRuntime: true, execPath: "/bun", cwd: "/repo" })

    expect(result.animationTheme).toBe("quiet")
  })

  test("parses animation theme option", () => {
    const result = parseArgs(["--animation-theme", "cyber"], { isBunRuntime: true, execPath: "/bun", cwd: "/repo" })

    expect(result.animationTheme).toBe("cyber")
  })

  test("rejects missing animation theme value", () => {
    expect(() => parseArgs(["--animation-theme"], { isBunRuntime: true, execPath: "/bun", cwd: "/repo" })).toThrow("--animation-theme requires one of: quiet, playful, operational, cyber")
  })

  test("rejects invalid animation theme value", () => {
    expect(() => parseArgs(["--animation-theme", "loud"], { isBunRuntime: true, execPath: "/bun", cwd: "/repo" })).toThrow("Invalid --animation-theme loud. Expected one of: quiet, playful, operational, cyber")
  })

  test("still parses explicit agent command", () => {
    const result = parseArgs(["--agent", "opencode acp", "--animation-theme", "operational"], { isBunRuntime: false, execPath: "/node", cwd: "/repo" })

    expect(result.agent).toEqual({ command: "opencode", args: ["acp"], label: "opencode acp" })
    expect(result.animationTheme).toBe("operational")
  })
})
```

- [ ] **Step 2: Run CLI arg test to verify it fails**

Run: `npm test -- src/cli-args.test.ts`

Expected: FAIL because `src/cli-args.ts` does not exist.

- [ ] **Step 3: Implement `src/cli-args.ts`**

Create `src/cli-args.ts`:

```ts
import { join } from "node:path"
import { commandFromShellText } from "./agent-command"
import type { AgentCommand } from "./acp/types"
import { animationThemeNames, isAnimationThemeName, type AnimationThemeName } from "./ui/animation-theme"

export type ParsedArgs = {
  agent: AgentCommand
  headless: boolean
  demoTranscript: boolean
  animationTheme: AnimationThemeName
}

export type ParseArgsEnvironment = {
  isBunRuntime: boolean
  execPath: string
  cwd: string
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  return argv[index + 1]
}

function parseAnimationTheme(argv: string[]): AnimationThemeName {
  const index = argv.indexOf("--animation-theme")
  if (index < 0) return "quiet"
  const value = argv[index + 1]
  const expected = animationThemeNames.join(", ")
  if (!value) throw new Error(`--animation-theme requires one of: ${expected}`)
  if (!isAnimationThemeName(value)) throw new Error(`Invalid --animation-theme ${value}. Expected one of: ${expected}`)
  return value
}

export function parseArgs(argv: string[], env: ParseArgsEnvironment): ParsedArgs {
  const commandText = readFlagValue(argv, "--agent")
  const headless = argv.includes("--headless")
  const demoTranscript = argv.includes("--demo-transcript")
  const animationTheme = parseAnimationTheme(argv)

  if (argv.includes("--agent")) {
    if (!commandText) throw new Error("--agent requires a command string")
    return { agent: commandFromShellText(commandText), headless, demoTranscript, animationTheme }
  }

  return {
    agent: {
      command: env.isBunRuntime ? env.execPath : join(env.cwd, "node_modules", ".bin", "tsx"),
      args: env.isBunRuntime ? ["run", "src/mock-agent.ts"] : ["src/mock-agent.ts"],
      label: "mock-agent",
    },
    headless,
    demoTranscript,
    animationTheme,
  }
}
```

- [ ] **Step 4: Modify `src/index.ts` to use `parseArgs()`**

Replace imports at top:

```ts
import { cwd, execPath } from "node:process"
import { parseArgs } from "./cli-args"
```

Remove imports no longer used:

```ts
import { join } from "node:path"
import { commandFromShellText } from "./agent-command"
import type { AgentCommand, TransportEvent } from "./acp/types"
```

Replace with:

```ts
import type { TransportEvent } from "./acp/types"
```

Delete local `parseArgs()` and `isBunRuntime()` functions.

Replace destructuring:

```ts
const { agent, headless, demoTranscript, animationTheme } = parseArgs(process.argv.slice(2), {
  isBunRuntime: typeof process.versions.bun === "string",
  execPath,
  cwd: cwd(),
})
```

Pass theme to UI:

```ts
  animationTheme,
```

- [ ] **Step 5: Add runtime command tests for registry and state**

In `src/commands/registry.test.ts`, add:

```ts
  test("slash search includes local slash app commands", () => {
    const reg = new CommandRegistry()
    const animationTheme: CommandDescriptor = {
      name: "/animation-theme",
      description: "Switch animation/icon theme",
      source: "local",
      kind: "app",
      options: [
        { label: "quiet", value: "quiet" },
        { label: "cyber", value: "cyber" },
      ],
    }
    reg.addLocalCommand(animationTheme)

    expect(reg.searchSlash("animation").map((cmd) => cmd.name)).toEqual(["/animation-theme"])
    expect(reg.searchPalette("animation").map((cmd) => cmd.name)).toEqual(["/animation-theme"])
  })
```

In `src/commands/state.test.ts`, add:

```ts
  test("select animation theme option executes app command with selected value", () => {
    const animationTheme: CommandDescriptor = {
      name: "/animation-theme",
      description: "Switch animation/icon theme",
      source: "local",
      kind: "app",
      options: [{ label: "cyber", value: "cyber" }],
    }
    const drilldown: CommandState = {
      phase: "drilldown",
      parent: animationTheme,
      items: [{ label: "cyber", value: "cyber" }],
      loading: false,
      query: "",
      selectedIndex: 0,
      surface: "dropdown",
    }

    const result = transition(drilldown, { type: "select-item", item: { label: "cyber", value: "cyber" } })

    expect(result.state.phase).toBe("idle")
    expect(result.effect).toEqual({ type: "execute", command: "/animation-theme cyber" })
  })
```

- [ ] **Step 6: Run command tests to verify they fail**

Run: `npm test -- src/commands/registry.test.ts src/commands/state.test.ts`

Expected: registry test FAIL because local slash app commands are not in slash search. State test may PASS already because generic drilldown execute works.

- [ ] **Step 7: Modify registry slash search**

In `src/commands/registry.ts`, change `searchSlash()` first lines:

```ts
  searchSlash(query: string): CommandDescriptor[] {
    const serverCommands = this.acpCommands.filter((cmd) => (cmd.kind ?? "server") === "server")
    const localSlashCommands = this.localCommands.filter((cmd) => (cmd.kind ?? "app") === "app" && cmd.name.startsWith("/"))
    const skills = this.getSkills()
    const skillsCommand = this.skillsCommand()
    const baseCommands = [...serverCommands, ...this.configCommands, ...localSlashCommands]
```

- [ ] **Step 8: Add runtime `/animation-theme` handling in `src/index.ts`**

Import names and type:

```ts
import { animationThemeNames, isAnimationThemeName } from "./ui/animation-theme"
```

Add local command after existing local commands:

```ts
registry.addLocalCommand({
  name: "/animation-theme",
  description: "Switch animation/icon theme",
  source: "local",
  kind: "app",
  options: animationThemeNames.map((name) => ({ label: name, value: name, description: `${name} animation/icon theme` })),
})
```

In `sendPrompt()`, before `promptQueue.enqueue(prompt, options)`, add:

```ts
    if (prompt.startsWith("/animation-theme ")) {
      const themeName = prompt.slice("/animation-theme ".length).trim()
      if (!isAnimationThemeName(themeName)) {
        ui.append({ kind: "error", text: `Unknown animation theme: ${themeName}` })
        return
      }
      ui.setAnimationTheme(themeName)
      ui.append({ kind: "status", text: `animation theme set to ${themeName}` })
      return
    }
```

- [ ] **Step 9: Add runtime UI E2E test**

Add to `src/ui/e2e.test.ts`:

```ts
  test("runtime animation theme command switches status rendering", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const registry = createMockCommandRegistry()
    registry.addLocalCommand({
      name: "/animation-theme",
      description: "Switch animation/icon theme",
      source: "local",
      kind: "app",
      options: [{ label: "cyber", value: "cyber", description: "cyber animation/icon theme" }],
    })
    const submissions: string[] = []
    const ui = await createAgentClientUi({
      registry,
      renderer: testRenderer.renderer,
      random: () => 0,
    })
    ui.onSubmit((prompt) => {
      submissions.push(prompt)
      if (prompt === "/animation-theme cyber") ui.setAnimationTheme("cyber")
    })

    try {
      await testRenderer.mockInput.typeText("/animation-theme")
      testRenderer.mockInput.pressEnter()
      testRenderer.mockInput.pressEnter()
      ui.setStatus("prompting")
      await testRenderer.flush()

      expect(submissions).toEqual(["/animation-theme cyber"])
      expect(testRenderer.captureCharFrame()).toContain("▰▱▱ scanning")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 10: Run focused tests**

Run: `npm test -- src/cli-args.test.ts src/commands/registry.test.ts src/commands/state.test.ts src/ui/e2e.test.ts`

Expected: PASS.

- [ ] **Step 11: Run TypeScript**

Run: `npm run typecheck`

Expected: PASS.

## Task 4: Full Verification And Documentation Touch-Up

**Files:**
- Modify: `docs/animation-guide.md`

- [ ] **Step 1: Update animation guide**

Add this section after `## Repo Helper` in `docs/animation-guide.md`:

```md
## Animation/Icon Themes

Animation and icon themes live in `src/ui/animation-theme.ts`. They control glyphs, frame strings, status words, cursor frames, and static fallbacks only. They do not control colors, borders, layout, spacing, or transcript density.

Available themes:

| Theme | Use |
|---|---|
| `quiet` | Default, subtle, best for long reading sessions |
| `playful` | Nerd Font personality and livelier status words |
| `operational` | High-signal status and tool-state icons |
| `cyber` | Powerline and scanline-inspired terminal energy |

Startup selection:

```bash
npm run dev -- --animation-theme operational
```

Runtime selection:

```text
/animation-theme cyber
```
```

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Run smoke test**

Run: `npm run smoke`

Expected: PASS and output contains transcript text from mock agent.

- [ ] **Step 5: Inspect diff**

Run: `git diff -- src/ui/animation-theme.ts src/ui/animation-theme.test.ts src/ui/view.ts src/ui/dropdown.ts src/ui/palette.ts src/ui/transcript-renderer.ts src/ui.ts src/cli-args.ts src/cli-args.test.ts src/index.ts src/commands/registry.ts src/commands/registry.test.ts src/commands/state.test.ts src/ui/e2e.test.ts docs/animation-guide.md docs/superpowers/plans/2026-06-28-animation-icon-themes.md docs/superpowers/specs/2026-06-28-animation-icon-themes-design.md`

Expected: diff only contains animation/icon theme work and plan/spec docs.

## Self-Review Checklist

- Spec coverage: all theme scope, startup switch, runtime switch, reduced motion, and test requirements map to tasks above.
- Placeholder scan: no placeholder markers or vague implementation steps remain.
- Type consistency: `AnimationThemeName`, `AnimationIconTheme`, `setAnimationTheme()`, `animationTheme`, and helper names are consistent across tasks.
- Policy check: no commit step is included because commits require explicit user request.
