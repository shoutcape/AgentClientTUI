import { describe, expect, test } from "bun:test"
import { Readable, Writable } from "node:stream"
import { BoxRenderable, createCliRenderer, ScrollBoxRenderable, TextRenderable, Yoga } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { CommandRegistry } from "../commands/registry"
import { createAgentClientUi } from "../ui"

class CapturingStdout extends Writable {
  isTTY = true
  columns = 100
  rows = 30
  chunks: string[] = []

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.from(chunk).toString("binary"))
    callback()
  }

  getColorDepth() {
    return 24
  }

  output() {
    return this.chunks.join("")
  }
}

function createCapturingStdin() {
  const stdin = new Readable({ read() {} }) as Readable & { isTTY: boolean; setRawMode: () => typeof stdin }
  stdin.isTTY = true
  stdin.setRawMode = () => stdin
  return stdin
}

function createMockCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registry.setAcpCommands([
    {
      name: "/model",
      description: "Switch mock model",
      source: "acp",
      inputType: "selection",
      optionsMethod: "_mock/commands/model/options",
    },
    {
      name: "/context",
      description: "Show mock context panel",
      source: "acp",
      inputType: "panel",
      subcommands: ["show", "add", "clear"],
    },
    { name: "/long", description: "Stream a long mock transcript response", source: "acp" },
    {
      name: "/output",
      description: "Emit mock ACP output variants",
      source: "acp",
      subcommands: ["text", "thought", "plan", "tools", "usage", "code", "diff", "mixed"],
    },
    ...Array.from({ length: 16 }, (_, i) => {
      const n = i + 1
      return { name: `/mock-${n}`, description: `Mock command ${n}`, source: "acp" as const }
    }),
    { name: "/pr-review", description: "Review pull request", source: "acp", kind: "skill" },
  ])
  registry.setConfigCommands([
    {
      name: "Models",
      description: "Select session model",
      source: "local",
      kind: "config",
      configId: "model",
      options: [{ label: "sonnet", value: "anthropic/claude-sonnet" }],
    },
  ])
  registry.addLocalCommand({ name: "Quit", description: "Exit AgentClientTUI", source: "local" })
  return registry
}

function renderableColor(renderable: unknown, key: "backgroundColor" | "borderColor" | "fg"): string | undefined {
  if (!renderable) return undefined
  const color = (renderable as Record<"backgroundColor" | "borderColor" | "fg", string | { toInts?: () => number[] } | undefined>)[key]
  if (typeof color === "string" || color === undefined) return color
  const [r, g, b] = color.toInts?.() ?? []
  if (r === undefined || g === undefined || b === undefined) return undefined
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`
}

function renderableBorderStyle(renderable: unknown): string | undefined {
  return (renderable as { borderStyle?: string } | undefined)?.borderStyle
}

function renderablePadding(renderable: unknown, key: "paddingTop" | "paddingBottom"): number | undefined {
  const layoutNode = (renderable as { getLayoutNode?: () => { getComputedPadding(edge: number): number } } | undefined)?.getLayoutNode?.()
  return layoutNode?.getComputedPadding(key === "paddingTop" ? Yoga.Edge.Top : Yoga.Edge.Bottom)
}

async function withCapturedStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const originalWrite = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
    chunks.push(Buffer.from(chunk).toString("utf8"))
    if (typeof encodingOrCallback === "function") encodingOrCallback()
    if (callback) callback()
    return true
  }) as typeof process.stdout.write

  try {
    await run()
  } finally {
    process.stdout.write = originalWrite
  }

  return chunks.join("")
}

describe("OpenTUI command e2e", () => {
  test("headless mode uses text UI output", async () => {
    const output = await withCapturedStdout(async () => {
      const ui = await createAgentClientUi({ headless: true })

      expect(ui.isInteractive).toBe(false)
      ui.setStatus("ready")
      ui.append({ kind: "agent", text: "hello text mode" })
      ui.destroy()
    })

    expect(output).toContain("● status ready")
    expect(output).toContain("◆ assistant hello text mode")
  })

  test("headless question requests reject clearly", async () => {
    const ui = await createAgentClientUi({ headless: true })

    await expect(ui.askQuestions({
      header: "Demo Questions",
      questions: [{ id: "color", text: "Choose a color", options: [] }],
    })).rejects.toThrow("Question prompts require interactive UI")
  })

  test("question overlay records option and custom typed answers", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({ renderer: testRenderer.renderer })

    try {
      const response = ui.askQuestions({
        header: "Demo Questions",
        questions: [
          {
            id: "color",
            text: "Choose a color",
            options: [
              { id: "red", label: "Red" },
              { id: "blue", label: "Blue" },
            ],
          },
          { id: "snack", text: "Name a snack", options: [] },
        ],
      })

      await testRenderer.flush()
      expect(testRenderer.renderer.root.findDescendantById("question-overlay")).toBeTruthy()

      testRenderer.mockInput.pressArrow("down")
      testRenderer.mockInput.pressEnter()
      await testRenderer.mockInput.typeText("pretzels")
      testRenderer.mockInput.pressEnter()

      await expect(response).resolves.toEqual({
        answers: [
          { questionId: "color", answer: "blue" },
          { questionId: "snack", answer: "pretzels" },
        ],
      })
    } finally {
      ui.destroy()
    }
  })

  test("renders input bar below the content panels", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("hello")
      await testRenderer.flush()

      const lines = testRenderer.captureCharFrame().split("\n")
      const inputIndex = lines.findIndex((line) => line.includes(">") && line.includes("hello"))
      const contentBottomIndex = lines.findIndex((line) => line.includes("└") && line.includes("┘ └"))

      expect(inputIndex).toBeGreaterThan(contentBottomIndex)
      expect(lines[inputIndex]).not.toContain("└")
    } finally {
      ui.destroy()
    }
  })

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

  test("keeps input cursor regular under animation themes", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      animationTheme: "operational",
    })

    try {
      await testRenderer.mockInput.typeText("hello")
      await testRenderer.flush()

      expect(testRenderer.captureCharFrame()).toContain("hello█")
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
      await testRenderer.flush()

      expect(submissions).toEqual(["/animation-theme cyber"])
      ui.setStatus("prompting")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toMatch(/[▰▱]{3} scanning/)
    } finally {
      ui.destroy()
    }
  })

  test("renders configured agent label in session sidebar", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      agentLabel: "opencode acp",
      branchLabel: "feature/sidebar-path",
    })

    try {
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("server  opencode acp")
      expect(frame).toContain("cwd")
      expect(frame).toContain(" feature/sidebar-path")
      expect(frame).not.toContain("server  mock-agent")
      expect(frame).not.toContain("mode    demo")
      const sidebarCwd = testRenderer.renderer.root.findDescendantById("sidebar-cwd") as { plainText?: string } | undefined
      expect(sidebarCwd?.plainText).toBe(process.cwd())
    } finally {
      ui.destroy()
    }
  })

  test("hides the session sidebar on narrow screens", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      agentLabel: "opencode acp",
    })

    try {
      await testRenderer.flush()

      expect(testRenderer.captureCharFrame()).not.toContain("server  opencode acp")
    } finally {
      ui.destroy()
    }
  })

  test("lets the sidebar be shown on narrow screens until width returns to auto", async () => {
    const testRenderer = await createTestRenderer({ width: 80, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      agentLabel: "opencode acp",
    })

    try {
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).not.toContain("server  opencode acp")

      ui.toggleSidebar()
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("server  opencode acp")

      testRenderer.resize(100, 30)
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("server  opencode acp")

      testRenderer.resize(80, 30)
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).not.toContain("server  opencode acp")
    } finally {
      ui.destroy()
    }
  })

  test("enables terminal focus reporting and disables it on destroy", async () => {
    const stdout = new CapturingStdout()
    const renderer = await createCliRenderer({
      stdin: createCapturingStdin() as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      width: 100,
      height: 30,
      exitOnCtrlC: false,
    })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer,
    })

    expect(stdout.output()).toContain("\x1B[?1004h")

    ui.destroy()

    expect(stdout.output()).toContain("\x1B[?1004l")
  })

  test("hides input cursor while terminal window is blurred", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("hello")
      await testRenderer.flush()

      expect(testRenderer.captureCharFrame()).toContain("hello█")

      testRenderer.renderer.stdin.emit("data", Buffer.from("\x1B[O"))
      await testRenderer.flush()

      const blurredFrame = testRenderer.captureCharFrame()
      expect(blurredFrame).toContain("hello")
      expect(blurredFrame).not.toContain("hello█")

      testRenderer.renderer.stdin.emit("data", Buffer.from("\x1B[I"))
      await testRenderer.flush()

      expect(testRenderer.captureCharFrame()).toContain("hello█")
    } finally {
      ui.destroy()
    }
  })

  test("input bar uses faint violet border while idle and strong violet while typing", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.flush()
      const idleInput = testRenderer.renderer.root.findDescendantById("input-bar")
      expect(renderableColor(idleInput, "backgroundColor")).toBe("#141414")
      expect(renderableColor(idleInput, "borderColor")).toBe("#4a3f62")
      expect(renderableBorderStyle(idleInput)).toBe("rounded")

      await testRenderer.mockInput.typeText("hello")
      await testRenderer.flush()

      const activeInput = testRenderer.renderer.root.findDescendantById("input-bar")
      expect(renderableColor(activeInput, "borderColor")).toBe("#a78bfa")
      expect(testRenderer.captureCharFrame()).toContain("hello█")
    } finally {
      ui.destroy()
    }
  })

  test("keeps transcript scrollbar hidden when content overflows", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      for (let i = 0; i < 40; i++) {
        ui.append({ kind: "agent", text: `line ${i}` })
      }
      await testRenderer.flush()

      const transcriptScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
      expect(transcriptScroll?.verticalScrollBar.visible).toBe(false)
    } finally {
      ui.destroy()
    }
  })

  test("input cursor is a separate violet renderable from typed text", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("hello")
      await testRenderer.flush()

      const inputValue = testRenderer.renderer.root.findDescendantById("input-value")
      const inputCursor = testRenderer.renderer.root.findDescendantById("input-cursor")

      expect(renderableColor(inputValue, "fg")).toBe("#eeeeee")
      expect(renderableColor(inputCursor, "fg")).toBe("#a78bfa")
    } finally {
      ui.destroy()
    }
  })

  test("normal input navigates submitted prompt history and restores draft", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const submissions: string[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit((prompt) => {
      submissions.push(prompt)
    })

    try {
      await testRenderer.mockInput.typeText("first")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("second")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("draft")
      await testRenderer.flush()

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("second█")

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first█")

      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("second█")

      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("draft█")

      expect(submissions).toEqual(["first", "second"])
    } finally {
      ui.destroy()
    }
  })

  test("editing while browsing prompt history exits history mode", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit(() => {})

    try {
      await testRenderer.mockInput.typeText("first")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("draft")
      await testRenderer.flush()

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first█")

      testRenderer.mockInput.pressKey("!")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first!█")
      expect(testRenderer.captureCharFrame()).not.toContain("draft█")
    } finally {
      ui.destroy()
    }
  })

  test("paste while browsing prompt history exits history mode", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit(() => {})

    try {
      await testRenderer.mockInput.typeText("first")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("draft")
      await testRenderer.flush()

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()

      testRenderer.renderer.keyInput.processPaste(new TextEncoder().encode(" pasted"))
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first pasted█")

      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first pasted█")
      expect(testRenderer.captureCharFrame()).not.toContain("draft█")
    } finally {
      ui.destroy()
    }
  })

  test("renders ACP output transcript kinds", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 40 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      ui.append({ kind: "plan", text: "[completed] Inspect workspace" })
      ui.append({ kind: "thought", text: "Thinking through mock output types." })
      ui.append({ kind: "tool", text: "read completed: Found package metadata." })
      ui.append({ kind: "tool", blocks: [
        { id: "code-1", type: "code", language: "ts", text: "const answer = 42" },
        { id: "diff-1", type: "diff", path: "src/example.ts", oldText: "const before = 1", newText: "const after = 2" },
      ] })
      ui.append({ kind: "usage", text: "usage 53000/200000 tokens, 0.045 USD" })
      await testRenderer.flush()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("[completed] Inspect workspace")
      expect(frame).toContain("Thinking through mock output types.")
      expect(frame).toContain("read completed: Found package metadata.")
      expect(frame).toContain("code ts")
      expect(frame).toContain("diff src/example.ts")
      expect(frame).toContain("- const before = 1")
      expect(frame).toContain("+ const after = 2")
      expect(frame).toContain("usage 53000/200000 tokens, 0.045 USD")
      expect(frame).not.toContain("□ plan")
      expect(frame).not.toContain("◇ thought")
      expect(frame).not.toContain("◦ tool")
      expect(frame).not.toContain("↯ usage")

      const lines = frame.split("\n")
      const codeHeaderIndex = lines.findIndex((line) => line.includes("code ts"))
      const codeContentIndex = lines.findIndex((line) => line.includes("const answer = 42"))
      expect(codeContentIndex).toBe(codeHeaderIndex + 1)
    } finally {
      ui.destroy()
    }
  })

  test("interactive transcript omits role gutters and renders event strip surfaces", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      ui.append({ kind: "user", text: "inspect repo" })
      ui.append({ kind: "agent", text: "assistant prose" })
      ui.append({ kind: "tool", text: "read completed" })
      ui.append({ kind: "error", text: "failed to render" })
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("inspect repo")
      expect(frame).toContain("assistant prose")
      expect(frame).toContain("read completed")
      expect(frame).toContain("failed to render")
      expect(frame).not.toContain("● user")
      expect(frame).not.toContain("◆ assistant")
      expect(frame).not.toContain("◦ tool")
      expect(frame).not.toContain("× error")

      const assistantText = testRenderer.renderer.root.findDescendantById("transcript-node-2-text-block-2")
      expect(assistantText).toBeInstanceOf(TextRenderable)

      const userSurface = testRenderer.renderer.root.findDescendantById("transcript-node-1-event-block-1")
      const userStrip = testRenderer.renderer.root.findDescendantById("transcript-node-1-strip-block-1")
      const userBody = testRenderer.renderer.root.findDescendantById("transcript-node-1-event-body-block-1")
      expect(userSurface).toBeDefined()
      expect(userStrip).toBeDefined()
      expect(renderableColor(userSurface, "backgroundColor")).toBe("#211a2e")
      expect(renderableColor(userStrip, "borderColor")).toBe("#a78bfa")
      expect((userStrip as { width?: number } | undefined)?.width).toBe(1)
      expect(renderablePadding(userBody, "paddingTop")).toBe(1)
      expect(renderablePadding(userBody, "paddingBottom")).toBe(1)

      const toolSurface = testRenderer.renderer.root.findDescendantById("transcript-node-3-event-block-3")
      const toolStrip = testRenderer.renderer.root.findDescendantById("transcript-node-3-strip-block-3")
      const toolBody = testRenderer.renderer.root.findDescendantById("transcript-node-3-event-body-block-3")
      expect(toolSurface).toBeDefined()
      expect(toolStrip).toBeDefined()
      expect(renderableColor(toolSurface, "backgroundColor")).toBe("#10191b")
      expect(renderableColor(toolStrip, "borderColor")).toBe("#56b6c2")
      expect((toolStrip as { width?: number } | undefined)?.width).toBe(1)
      expect(renderablePadding(toolBody, "paddingTop")).toBe(1)
      expect(renderablePadding(toolBody, "paddingBottom")).toBe(1)

      const errorSurface = testRenderer.renderer.root.findDescendantById("transcript-node-4-event-block-4")
      const errorStrip = testRenderer.renderer.root.findDescendantById("transcript-node-4-strip-block-4")
      const errorBody = testRenderer.renderer.root.findDescendantById("transcript-node-4-event-body-block-4")
      const errorText = testRenderer.renderer.root.findDescendantById("transcript-node-4-text-block-4")
      expect(errorSurface).toBeDefined()
      expect(errorStrip).toBeDefined()
      expect(errorText).toBeInstanceOf(TextRenderable)
      expect(renderableColor(errorSurface, "backgroundColor")).toBe("#2a1114")
      expect(renderableColor(errorStrip, "borderColor")).toBe("#e06c75")
      expect(renderableColor(errorText, "fg")).toBe("#e06c75")
      expect((errorStrip as { width?: number } | undefined)?.width).toBe(1)
      expect(renderablePadding(errorBody, "paddingTop")).toBe(1)
      expect(renderablePadding(errorBody, "paddingBottom")).toBe(1)
    } finally {
      ui.destroy()
    }
  })

  test("renders tool lifecycle as one collapsed burst and toggles grouped history", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      ui.append({
        kind: "tool",
        text: "search pending: grep normalizeSessionUpdate",
        toolCallId: "search-1",
        toolKind: "search",
        toolStatus: "pending",
        toolTitle: "grep normalizeSessionUpdate",
      })
      ui.append({ kind: "tool", text: "in_progress", toolCallId: "search-1", toolStatus: "in_progress" })
      ui.append({ kind: "tool", text: "completed", toolCallId: "search-1", toolStatus: "completed" })
      ui.append({
        kind: "tool",
        text: "read pending: src/ui/transcript.ts",
        toolCallId: "read-1",
        toolKind: "read",
        toolStatus: "pending",
        toolTitle: "src/ui/transcript.ts",
      })
      ui.finishAgentMessage()
      ui.append({
        kind: "tool",
        text: "shell pending: npm test",
        toolCallId: "shell-1",
        toolKind: "shell",
        toolStatus: "pending",
        toolTitle: "npm test",
      })
      await testRenderer.flush()

      const collapsedFrame = testRenderer.captureCharFrame()
      expect(collapsedFrame).toContain("Using tools")
      expect(collapsedFrame).toContain("● src/ui/transcript.ts")
      expect(collapsedFrame).toContain("read · 1")
      expect(collapsedFrame).not.toContain("Ctrl+O tools")
      expect(collapsedFrame).not.toContain("Ctrl+T tools")
      expect(collapsedFrame).not.toContain("in_progress")
      expect(collapsedFrame).not.toContain("search pending")

      const transcriptScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
      expect(transcriptScroll?.getChildren().length).toBe(2)

      const toolBurstBody = testRenderer.renderer.root.findDescendantById("transcript-node-1-event-body-block-1") as { x?: number; y?: number } | undefined
      const toolBurstSurface = testRenderer.renderer.root.findDescendantById("transcript-node-1-event-block-1")
      const toolBurstStrip = testRenderer.renderer.root.findDescendantById("transcript-node-1-strip-block-1")
      expect(renderableColor(toolBurstSurface, "backgroundColor")).toBe("#10191b")
      expect(renderableColor(toolBurstStrip, "borderColor")).toBe("#56b6c2")
      expect(renderablePadding(toolBurstBody, "paddingTop")).toBe(1)
      expect(renderablePadding(toolBurstBody, "paddingBottom")).toBe(1)

      const toolBurstSummary = testRenderer.renderer.root.findDescendantById("transcript-node-1-tool-burst-block-1-summary") as { x?: number; y?: number } | undefined
      if (toolBurstSummary?.x === undefined || toolBurstSummary.y === undefined) throw new Error("Missing tool burst summary layout")

      await testRenderer.mockMouse.moveTo(toolBurstSummary.x + 2, toolBurstSummary.y)
      await testRenderer.flush()
      expect(renderableColor(toolBurstSurface, "backgroundColor")).toBe("#16282b")

      await testRenderer.mockMouse.moveTo(0, 0)
      await testRenderer.flush()
      expect(renderableColor(toolBurstSurface, "backgroundColor")).toBe("#10191b")

      await testRenderer.mockMouse.click(toolBurstSummary.x + 2, toolBurstSummary.y)
      await testRenderer.flush()

      const expandedFrame = testRenderer.captureCharFrame()
      expect(expandedFrame).toContain("Tool history")
      expect(expandedFrame).toContain("2 calls")
      expect(expandedFrame).toContain("search  done  grep normalizeSessionUpdate")
      expect(expandedFrame).toContain("read    pending  src/ui/transcript.ts")
      expect(expandedFrame).not.toContain("shell   pending  npm test")
      testRenderer.mockInput.pressKey("o", { ctrl: true })
      await testRenderer.flush()

      const latestExpandedFrame = testRenderer.captureCharFrame()
      expect(latestExpandedFrame).toContain("Tool history 1 call")
      expect(latestExpandedFrame).toContain("shell   pending  npm test")
    } finally {
      ui.destroy()
    }
  })

  test("records render diagnostics when render throws", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const records: unknown[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      diagnostics: {
        logFile: "test.jsonl",
        recordEvent() {},
        async recordRenderError(_error, snapshot) {
          records.push(snapshot)
        },
      },
    })

    const originalAdd = testRenderer.renderer.root.add
    let shouldThrow = true
    testRenderer.renderer.root.add = ((...args: Parameters<typeof testRenderer.renderer.root.add>) => {
      if (shouldThrow) {
        shouldThrow = false
        throw new Error("Failed to create TextBuffer")
      }
      return originalAdd.apply(testRenderer.renderer.root, args)
    }) as typeof testRenderer.renderer.root.add

    try {
      ui.append({ kind: "tool", blocks: [{ type: "code", language: "html", text: "<section>stress</section>" }] })
      await testRenderer.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(records.length).toBe(1)
      expect(records[0]).toMatchObject({
        status: "starting",
        transcript: { nodeCount: 1 },
        context: { phase: "render.root.add", renderable: "BoxRenderable" },
      })
    } finally {
      testRenderer.renderer.root.add = originalAdd as typeof testRenderer.renderer.root.add
      ui.destroy()
    }
  })

  test("destroys replaced app roots without destroying transcript scroll", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      const firstRoot = testRenderer.renderer.root.getRenderable("app-root")
      const firstScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
      expect(firstRoot).toBeDefined()
      expect(firstScroll).toBeDefined()

      ui.setStatus("rerender")
      await testRenderer.flush()

      expect(firstRoot?.isDestroyed).toBe(true)
      expect(firstScroll?.isDestroyed).toBe(false)
      expect(testRenderer.renderer.root.findDescendantById("transcript-scroll")).toBe(firstScroll)
    } finally {
      ui.destroy()
    }
  })

  test("updateLast updates the active agent row in place", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      ui.append({ kind: "agent", text: "stream-old-token" })
      await testRenderer.flush()

      ui.updateLast("stream-final-token")
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("stream-final-token")
      expect(frame).not.toContain("stream-old-token")
      expect(frame).not.toContain("◆ assistant")
      expect(frame.match(/stream-final-token/g)?.length ?? 0).toBe(1)
      expect(testRenderer.renderer.root.findDescendantById("transcript-node-1-text-block-1")).toBeInstanceOf(TextRenderable)
    } finally {
      ui.destroy()
    }
  })

  test("records transcript context when transcript add throws", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const records: unknown[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      diagnostics: {
        logFile: "test.jsonl",
        recordEvent() {},
        async recordRenderError(_error, snapshot) {
          records.push(snapshot)
        },
      },
    })

    const transcriptScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
    expect(transcriptScroll).toBeDefined()
    if (!transcriptScroll) {
      ui.destroy()
      return
    }

    const originalAdd = transcriptScroll.add
    let shouldThrow = true
    transcriptScroll.add = ((...args: Parameters<typeof transcriptScroll.add>) => {
      if (shouldThrow) {
        shouldThrow = false
        throw new Error("Failed to add transcript node")
      }
      return originalAdd.apply(transcriptScroll, args)
    }) as typeof transcriptScroll.add

    try {
      ui.append({ kind: "tool", blocks: [{ type: "code", language: "html", text: "<section>stress</section>" }] })
      await testRenderer.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(records.length).toBe(1)
      expect(records[0]).toMatchObject({
        transcript: { nodeCount: 1 },
        context: { phase: "syncTranscript.addNode", kind: "tool", renderable: "BoxRenderable" },
      })
    } finally {
      transcriptScroll.add = originalAdd
      ui.destroy()
    }
  })

  test("preserves outer context when nested transcript block add throws", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const records: unknown[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      diagnostics: {
        logFile: "test.jsonl",
        recordEvent() {},
        async recordRenderError(_error, snapshot) {
          records.push(snapshot)
        },
      },
    })

    const originalAdd = BoxRenderable.prototype.add
    let shouldThrow = true
    BoxRenderable.prototype.add = function patchedAdd(this: BoxRenderable, ...args: Parameters<typeof originalAdd>) {
      const id = (this as { id?: string }).id ?? ""
      if (shouldThrow && id.startsWith("transcript-") && !id.includes("-row-") && !id.includes("-block-")) {
        shouldThrow = false
        throw new Error("Failed to add transcript block")
      }
      return originalAdd.apply(this, args)
    } as typeof originalAdd

    try {
      ui.append({ kind: "tool", blocks: [{ type: "code", language: "html", text: "<section>stress</section>" }] })
      await testRenderer.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(records.length).toBe(1)
      expect(records[0]).toMatchObject({
        transcript: { nodeCount: 1 },
        context: { phase: "buildTranscriptMessage.addBlock", kind: "tool", blockType: "code", renderable: "BoxRenderable" },
      })
    } finally {
      BoxRenderable.prototype.add = originalAdd
      ui.destroy()
    }
  })

  test("records stream update context when text mutation throws", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const records: unknown[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      diagnostics: {
        logFile: "test.jsonl",
        recordEvent() {},
        async recordRenderError(_error, snapshot) {
          records.push(snapshot)
        },
      },
    })

    try {
      ui.append({ kind: "agent", text: "first" })
      await testRenderer.flush()

      const textRenderable = testRenderer.renderer.root.findDescendantById("transcript-node-1-text-block-1") as object | undefined
      expect(textRenderable).toBeDefined()
      if (!textRenderable) return

      const descriptor = Object.getOwnPropertyDescriptor(textRenderable, "content")
      Object.defineProperty(textRenderable, "content", {
        configurable: true,
        get() {
          return "first"
        },
        set() {
          throw new Error("Failed to update stream text")
        },
      })

      let restored = false
      try {
        ui.updateLast("second")
        if (descriptor) {
          Object.defineProperty(textRenderable, "content", descriptor)
        } else {
          delete (textRenderable as { content?: unknown }).content
        }
        restored = true
        await testRenderer.flush()
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(records.length).toBe(1)
        expect(records[0]).toMatchObject({
          context: { phase: "updateLast.activeStream", renderable: "TextRenderable" },
        })
      } finally {
        if (!restored) {
          if (descriptor) {
            Object.defineProperty(textRenderable, "content", descriptor)
          } else {
            delete (textRenderable as { content?: unknown }).content
          }
        }
      }
    } finally {
      ui.destroy()
    }
  })

  test("does not retry a failed stream mutation through the active stream fast path", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const records: unknown[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      diagnostics: {
        logFile: "test.jsonl",
        recordEvent() {},
        async recordRenderError(_error, snapshot) {
          records.push(snapshot)
        },
      },
    })

    try {
      ui.append({ kind: "agent", text: "first" })
      await testRenderer.flush()

      const textRenderable = testRenderer.renderer.root.findDescendantById("transcript-node-1-text-block-1") as object | undefined
      expect(textRenderable).toBeDefined()
      if (!textRenderable) return

      const descriptor = Object.getOwnPropertyDescriptor(textRenderable, "content")
      Object.defineProperty(textRenderable, "content", {
        configurable: true,
        get() {
          return "first"
        },
        set() {
          throw new Error("Failed to update stream text")
        },
      })

      try {
        ui.updateLast("second")
        await testRenderer.flush()
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(records.length).toBe(1)
        expect(records[0]).toMatchObject({
          context: { phase: "updateLast.activeStream", renderable: "TextRenderable" },
        })
      } finally {
        if (descriptor) {
          Object.defineProperty(textRenderable, "content", descriptor)
        } else {
          delete (textRenderable as { content?: unknown }).content
        }
      }
    } finally {
      ui.destroy()
    }
  })

  test("recovers partial transcript append without duplicating nodes", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const records: unknown[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      diagnostics: {
        logFile: "test.jsonl",
        recordEvent() {},
        async recordRenderError(_error, snapshot) {
          records.push(snapshot)
        },
      },
    })

    try {
      const transcriptScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
      expect(transcriptScroll).toBeDefined()
      if (!transcriptScroll) return

      ui.showPanel("hold transcript")
      ui.append({ kind: "tool", text: "first" })
      ui.append({ kind: "tool", text: "second" })

      const originalAdd = transcriptScroll.add
      let addCount = 0
      transcriptScroll.add = ((...args: Parameters<typeof transcriptScroll.add>) => {
        addCount += 1
        const result = originalAdd.apply(transcriptScroll, args)
        if (addCount === 2) {
          throw new Error("Failed after partial append")
        }
        return result
      }) as typeof transcriptScroll.add

      try {
        ui.hidePanel()
        await testRenderer.flush()
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(records.length).toBe(1)
      } finally {
        transcriptScroll.add = originalAdd
      }

      ui.setStatus("retry render")
      await testRenderer.flush()

      const recoveredScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
      expect(recoveredScroll?.getChildren().length).toBe(2)
    } finally {
      ui.destroy()
    }
  })

  test("transcript content ignores hjkl and arrow scroll keys", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 18 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      for (let i = 1; i <= 40; i += 1) {
        ui.append({ kind: "agent", text: `transcript line ${i}` })
      }
      await testRenderer.flush()

      const transcriptScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
      expect(transcriptScroll).toBeDefined()
      transcriptScroll?.scrollTo(0)
      transcriptScroll?.focus()
      await testRenderer.flush()

      const initialScrollTop = transcriptScroll?.scrollTop
      testRenderer.mockInput.pressKey("j")
      await testRenderer.flush()
      expect(transcriptScroll?.scrollTop).toBe(initialScrollTop)

      testRenderer.mockInput.pressKey("k")
      await testRenderer.flush()
      expect(transcriptScroll?.scrollTop).toBe(initialScrollTop)

      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()
      expect(transcriptScroll?.scrollTop).toBe(initialScrollTop)

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()
      expect(transcriptScroll?.scrollTop).toBe(initialScrollTop)
    } finally {
      ui.destroy()
    }
  })

  test("page keys scroll transcript by a partial viewport", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 18 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      for (let i = 1; i <= 80; i += 1) {
        ui.append({ kind: "agent", text: `transcript line ${i}` })
      }
      await testRenderer.flush()

      const transcriptScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
      expect(transcriptScroll).toBeDefined()

      transcriptScroll?.scrollTo(0)
      transcriptScroll?.focus()
      await testRenderer.flush()

      const initialScrollTop = transcriptScroll?.scrollTop ?? 0
      const visibleHeight = transcriptScroll?.height ?? 0

      testRenderer.mockInput.pressKey("\x1b[6~")
      await testRenderer.flush()

      const afterPageDown = transcriptScroll?.scrollTop ?? 0
      expect(afterPageDown).toBeGreaterThan(initialScrollTop)
      expect(afterPageDown - initialScrollTop).toBeLessThan(visibleHeight)

      testRenderer.mockInput.pressKey("\x1b[5~")
      await testRenderer.flush()

      const afterPageUp = transcriptScroll?.scrollTop ?? 0
      expect(afterPageUp).toBeLessThan(afterPageDown)
    } finally {
      ui.destroy()
    }
  })

  test("slash opens dropdown with mock ACP commands", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("/model")
      expect(frame).toContain("Switch mock model")
      expect(frame).toContain("/Skills")
      expect(frame).not.toContain("/pr-review")
    } finally {
      ui.destroy()
    }
  })

  test("slash skills child menu contains skill commands", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()
      await testRenderer.mockInput.typeText("skills")
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("/pr-review")
      expect(frame).toContain("Review pull request")
    } finally {
      ui.destroy()
    }
  })

  test("slash dropdown is attached above the input bar", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()

      const lines = testRenderer.captureCharFrame().split("\n")
      const dropdownIndex = lines.findIndex((line) => line.includes("/model") && line.includes("Switch mock model"))
      const inputIndex = lines.findIndex((line) => line.includes("│ >"))

      expect(dropdownIndex).toBeGreaterThan(-1)
      expect(inputIndex).toBeGreaterThan(-1)
      expect(dropdownIndex).toBeLessThan(inputIndex)
    } finally {
      ui.destroy()
    }
  })

  test("slash dropdown shares the user violet input family", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()

      const dropdown = testRenderer.renderer.root.findDescendantById("slash-dropdown")
      const selectedRow = testRenderer.renderer.root.findDescendantById("slash-dropdown-selected-row")
      const input = testRenderer.renderer.root.findDescendantById("input-bar")

      expect(renderableColor(dropdown, "borderColor")).toBe("#a78bfa")
      expect(renderableBorderStyle(dropdown)).toBe("rounded")
      expect(renderableColor(selectedRow, "backgroundColor")).toBe("#a78bfa")
      expect(renderableColor(input, "borderColor")).toBe("#a78bfa")
    } finally {
      ui.destroy()
    }
  })

  test("slash dropdown scrolls through many mock commands", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()

      for (let i = 0; i < 15; i += 1) {
        testRenderer.mockInput.pressArrow("down")
        await testRenderer.flush()
      }

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("/mock-11")
      expect(frame).toContain("Mock command 11")
      expect(frame).not.toContain("/model - Switch mock model")
    } finally {
      ui.destroy()
    }
  })

  test("slash dropdown arrow keys still navigate commands instead of prompt history", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit(() => {})

    try {
      await testRenderer.mockInput.typeText("remembered")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()
      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("/context")
      expect(frame).not.toContain("remembered█")
    } finally {
      ui.destroy()
    }
  })

  test("slash dropdown keeps drilldown items inside its border", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()
      await testRenderer.mockInput.typeText("output")
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      const lines = testRenderer.captureCharFrame().split("\n")
      const mixedLine = lines.find((line) => line.includes("mixed")) ?? ""
      const helpLine = lines.find((line) => line.includes("Enter select")) ?? ""

      expect(mixedLine).toContain("│ mixed")
      expect(mixedLine).not.toContain("└")
      expect(helpLine).toContain("│ ↑↓ navigate")
    } finally {
      ui.destroy()
    }
  })

  test("ctrl-p opens palette with local and mock ACP commands", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()

      let frame = testRenderer.captureCharFrame()
      expect(frame).toContain("/model")
      expect(frame).toContain("/context")
      expect(frame).toContain("Models")
      expect(frame).toContain("Skills")
      expect(frame).not.toContain("/Skills")
      expect(frame).not.toContain("/pr-review")

      await testRenderer.mockInput.typeText("skills")
      await testRenderer.flush()

      frame = testRenderer.captureCharFrame()
      expect(frame).toContain("Skills")

      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      frame = testRenderer.captureCharFrame()
      expect(frame).toContain("/pr-review")

      testRenderer.mockInput.pressEscape()
      await testRenderer.flush()
      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()
      await testRenderer.mockInput.typeText("Quit")
      await testRenderer.flush()

      frame = testRenderer.captureCharFrame()
      expect(frame).toContain("Quit")
    } finally {
      ui.destroy()
    }
  })

  test("ctrl-p palette is a global modal with a transparent backdrop", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("/model")
      expect(frame).toContain("● starting")
      expect(frame).toContain("session")
      expect(frame).toContain("● starting")
    } finally {
      ui.destroy()
    }
  })

  test("ctrl-p palette keeps app accent instead of user violet", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()

      const palette = testRenderer.renderer.root.findDescendantById("command-palette")
      const selectedRow = testRenderer.renderer.root.findDescendantById("command-palette-selected-row")

      expect(renderableColor(palette, "borderColor")).toBe("#9d7cd8")
      expect(renderableColor(selectedRow, "backgroundColor")).toBe("#9d7cd8")
    } finally {
      ui.destroy()
    }
  })

  test("ctrl-p palette arrow keys still navigate commands instead of prompt history", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit(() => {})

    try {
      await testRenderer.mockInput.typeText("remembered")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()
      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("sonnet")
      expect(frame).not.toContain("remembered█")
    } finally {
      ui.destroy()
    }
  })

  test("local app commands are not added to prompt history", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const registry = createMockCommandRegistry()
    registry.addLocalCommand({ name: "Toggle Session Panel", description: "Show/hide sidebar", source: "local", kind: "app" })
    const submissions: string[] = []
    const ui = await createAgentClientUi({
      registry,
      renderer: testRenderer.renderer,
    })
    ui.onSubmit((prompt) => {
      submissions.push(prompt)
    })

    try {
      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()
      await testRenderer.mockInput.typeText("Toggle")
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()

      expect(submissions).toEqual(["Toggle Session Panel"])
      expect(testRenderer.captureCharFrame()).not.toContain("Toggle Session Panel█")
    } finally {
      ui.destroy()
    }
  })

  test("slash commands are not added to prompt history", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const submissions: string[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      onFetchOptions: async () => [{ label: "sonnet", value: "claude-sonnet" }],
    })
    ui.onSubmit((prompt) => {
      submissions.push(prompt)
    })

    try {
      await testRenderer.mockInput.typeText("remembered")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("/")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()

      expect(submissions).toEqual(["remembered", "/model claude-sonnet"])
      expect(testRenderer.captureCharFrame()).toContain("remembered█")
      expect(testRenderer.captureCharFrame()).not.toContain("/model claude-sonnet█")
    } finally {
      ui.destroy()
    }
  })

  test("selects mock model option and submits full command", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const submissions: Array<{ prompt: string; panel?: boolean }> = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      onFetchOptions: async () => [
        { label: "sonnet", value: "claude-sonnet", description: "Balanced mock model" },
        { label: "opus", value: "claude-opus", description: "Largest mock model" },
        { label: "haiku", value: "claude-haiku", description: "Fast mock model" },
      ],
    })
    ui.onSubmit((prompt, options) => {
      submissions.push({ prompt, ...(options?.panel !== undefined ? { panel: options.panel } : {}) })
    })

    try {
      await testRenderer.mockInput.typeText("/")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("sonnet")
      expect(frame).toContain("opus")
      expect(frame).toContain("haiku")
      expect(frame).toContain("Largest")

      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      expect(submissions).toEqual([{ prompt: "/model claude-sonnet", panel: false }])
    } finally {
      ui.destroy()
    }
  })

  test("selects config command option and refreshes config commands", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const setConfigCalls: Array<{ configId: string; value: string }> = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      onSetConfigOption: async (configId, value) => {
        setConfigCalls.push({ configId, value })
        return [{
          id: "mode",
          name: "Mode",
          type: "select",
          currentValue: "plan",
          options: [{ value: "plan", name: "Plan" }],
        }]
      },
    })

    try {
      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()
      await testRenderer.mockInput.typeText("models")
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      expect(testRenderer.captureCharFrame()).toContain("sonnet")

      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))
      await testRenderer.flush()

      expect(setConfigCalls).toEqual([{ configId: "model", value: "anthropic/claude-sonnet" }])
      let frame = testRenderer.captureCharFrame()
      expect(frame).toContain("set model to anthropic/claude-sonnet")

      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()
      await testRenderer.mockInput.typeText("mode")
      await testRenderer.flush()

      frame = testRenderer.captureCharFrame()
      expect(frame).toContain("Mode")
    } finally {
      ui.destroy()
    }
  })

  test("arrow navigation scrolls through fetched command options", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const submissions: Array<{ prompt: string; panel?: boolean }> = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      onFetchOptions: async () => Array.from({ length: 10 }, (_, i) => {
        const n = i + 1
        return { label: `model-${n}`, value: `model-value-${n}`, description: `Mock model ${n}` }
      }),
    })
    ui.onSubmit((prompt, options) => {
      submissions.push({ prompt, ...(options?.panel !== undefined ? { panel: options.panel } : {}) })
    })

    try {
      await testRenderer.mockInput.typeText("/")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      for (let i = 0; i < 9; i += 1) {
        testRenderer.mockInput.pressArrow("down")
        await testRenderer.flush()
      }

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("model-10")

      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      expect(submissions).toEqual([{ prompt: "/model model-value-10", panel: false }])
    } finally {
      ui.destroy()
    }
  })

  test("routes mock context command as panel submission", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const submissions: Array<{ prompt: string; panel?: boolean }> = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit((prompt, options) => {
      submissions.push({ prompt, ...(options?.panel !== undefined ? { panel: options.panel } : {}) })
    })

    try {
      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()
      await testRenderer.mockInput.typeText("con")
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      expect(submissions).toEqual([{ prompt: "/context show", panel: true }])
    } finally {
      ui.destroy()
    }
  })
})
