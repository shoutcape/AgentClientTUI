import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createRenderDiagnostics,
  redactDiagnosticValue,
  summarizeText,
} from "./render-diagnostics"

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

describe("render diagnostics", () => {
  test("summarizes long text without storing full content", () => {
    const summary = summarizeText("alpha\nbeta\n" + "x".repeat(200), 24)
    expect(summary.chars).toBe(211)
    expect(summary.lines).toBe(3)
    expect(summary.preview).toBe("alpha\\nbeta\\nxxxxxxxxxxx...")
  })

  test("redacts secret-like values from text previews", () => {
    const summary = summarizeText("OPENAI_API_KEY=sk-test\nAuthorization: Bearer token-value\nok=true", 120)

    expect(summary.preview).toBe("OPENAI_API_KEY=[REDACTED]\\nAuthorization: [REDACTED]\\nok=true")
  })

  test("redacts sensitive keys and home directory", () => {
    const value = redactDiagnosticValue({
      path: "/home/tester/project",
      token: "abc",
      nested: { Authorization: "Bearer secret", ok: "value" },
    }, "/home/tester")

    expect(value).toEqual({
      path: "$HOME/project",
      token: "[REDACTED]",
      nested: { Authorization: "[REDACTED]", ok: "value" },
    })
  })

  test("redacts arbitrary values into JSON-safe diagnostics", () => {
    const value: { count: bigint; self?: unknown; items: unknown[] } = { count: 123n, items: [] }
    value.self = value
    value.items.push(value)

    const redacted = redactDiagnosticValue(value)

    expect(redacted).toEqual({
      count: "123n",
      self: "[Circular]",
      items: ["[Circular]"],
    })
    expect(() => JSON.stringify(redacted)).not.toThrow()
  })

  test("preserves repeated non-circular objects", () => {
    const shared = { ok: "value" }

    expect(redactDiagnosticValue({ first: shared, second: shared })).toEqual({
      first: { ok: "value" },
      second: { ok: "value" },
    })
  })

  test("writes render error JSONL with recent event ring buffer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-client-tui-test-"))
    tempDirs.push(dir)
    const diagnostics = createRenderDiagnostics({
      logDir: dir,
      agentLabel: "/home/tester/opencode acp",
      maxRecentEvents: 2,
      home: "/home/tester",
    })

    diagnostics.recordEvent("first")
    diagnostics.recordEvent("second", { requestId: 1 })
    diagnostics.recordEvent("third")
    await diagnostics.recordRenderError(new Error("Failed to create TextBuffer in /home/tester/project"), {
      status: "prompting",
      terminal: { columns: 80, rows: 24 },
      transcript: { version: 7, renderedNodeCount: 3, nodeCount: 4, activeAgentNodeId: "node-4" },
      context: {
        phase: "buildTranscriptBlock",
        nodeId: "node-4",
        kind: "tool",
        blockType: "code",
        renderable: "CodeRenderable",
        text: summarizeText("const answer = 42"),
      },
    })

    const text = await readFile(diagnostics.logFile, "utf8")
    const [line] = text.trim().split("\n")
    expect(line).toBeDefined()
    if (line === undefined) {
      throw new Error("missing diagnostics log line")
    }
    const record = JSON.parse(line)

    expect(record.type).toBe("render-error")
    expect(record.message).toBe("Failed to create TextBuffer in $HOME/project")
    expect(record.stack).not.toContain("/home/tester")
    expect(record.agentLabel).toBe("$HOME/opencode acp")
    expect(record.recentEvents.map((event: { event: string }) => event.event)).toEqual(["second", "third"])
    expect(record.context.renderable).toBe("CodeRenderable")
  })
})
