import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { CommandRegistry } from "../commands/registry"
import { createAgentClientUi } from "../ui"

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
  ])
  registry.addLocalCommand({ name: "Quit", description: "Exit AgentClientTUI", source: "local" })
  return registry
}

describe("OpenTUI command e2e", () => {
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

  test("renders ACP output transcript kinds", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
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
      expect(frame).toContain("□ plan")
      expect(frame).toContain("[completed] Inspect workspace")
      expect(frame).toContain("◇ thought")
      expect(frame).toContain("◦ tool")
      expect(frame).toContain("code ts")
      expect(frame).toContain("diff src/example.ts")
      expect(frame).toContain("- const before = 1")
      expect(frame).toContain("+ const after = 2")
      expect(frame).toContain("↯ usage")

      const lines = frame.split("\n")
      const codeHeaderIndex = lines.findIndex((line) => line.includes("code ts"))
      const codeContentIndex = lines.findIndex((line) => line.includes("const answer = 42"))
      expect(codeContentIndex).toBe(codeHeaderIndex + 1)
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
      expect(frame).toContain("/mock-12")
      expect(frame).toContain("Mock command 12")
      expect(frame).not.toContain("/model - Switch mock model")
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
      expect(frame).toContain("/ commands")
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
