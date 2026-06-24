import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultTraceOutFile, redactedTraceValue, runTraceScenario, writeTraceEvent, type TraceEvent } from "./trace-harness"

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agent-client-tui-trace-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function mockAgentCommand() {
  return {
    command: join(process.cwd(), "node_modules", ".bin", "tsx"),
    args: ["src/mock-agent.ts"],
    label: "mock-agent",
  }
}

describe("ACP trace harness", () => {
  test("redacts sensitive fields while preserving protocol shape", () => {
    const redacted = redactedTraceValue({
      method: "initialize",
      params: {
        cwd: `${process.env.HOME}/project`,
        clientCapabilities: { terminal: false },
        apiKey: "secret-key",
        nested: { access_token: "secret-token", keep: "value" },
      },
    })

    expect(redacted).toEqual({
      method: "initialize",
      params: {
        cwd: "$HOME/project",
        clientCapabilities: { terminal: false },
        apiKey: "[REDACTED]",
        nested: { access_token: "[REDACTED]", keep: "value" },
      },
    })
  })

  test("writes trace events as JSONL", async () => {
    const dir = await createTempDir()
    const outFile = join(dir, "trace.jsonl")
    const event: TraceEvent = {
      ts: "2026-06-24T00:00:00.000Z",
      direction: "client_to_agent",
      message: { method: "initialize" },
    }

    await writeTraceEvent(outFile, event)
    await writeTraceEvent(outFile, { ...event, direction: "agent_to_client" })

    const lines = (await readFile(outFile, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] ?? "{}")).toEqual(event)
    expect(JSON.parse(lines[1] ?? "{}")).toEqual({ ...event, direction: "agent_to_client" })
  })

  test("builds stable default trace output paths", () => {
    expect(defaultTraceOutFile("opencode acp", "new-prompt", new Date("2026-06-24T01:02:03.456Z"))).toBe(
      "tmp/acp-traces/opencode-acp/2026-06-24-010203-new-prompt.jsonl",
    )
  })

  test("captures initialize scenario against mock agent", async () => {
    const dir = await createTempDir()
    const outFile = join(dir, "initialize.jsonl")

    const result = await runTraceScenario({
      agent: mockAgentCommand(),
      scenario: "initialize",
      outFile,
      timeoutMs: 5_000,
    })

    expect(result.summary.scenario).toBe("initialize")
    expect(result.summary.protocolVersion).toBe(1)
    expect(result.events.some((event) => event.direction === "client_to_agent" && event.message.method === "initialize")).toBe(true)
    expect(result.events.some((event) => event.direction === "agent_to_client" && event.message.result?.protocolVersion === 1)).toBe(true)
    expect(await readFile(outFile, "utf8")).toContain("initialize")
  })

  test("captures new-prompt scenario against mock agent", async () => {
    const result = await runTraceScenario({
      agent: mockAgentCommand(),
      scenario: "new-prompt",
      prompt: "Say hello from trace test.",
      timeoutMs: 5_000,
    })

    expect(result.summary).toMatchObject({ scenario: "new-prompt", sessionId: "mock-session-1", stopReason: "end_turn" })
    expect(result.events.some((event) => event.direction === "agent_to_client" && event.message.method === "session/update")).toBe(true)
  })

  test("captures list scenario against mock agent", async () => {
    const result = await runTraceScenario({
      agent: mockAgentCommand(),
      scenario: "list",
      timeoutMs: 5_000,
    })

    expect(result.summary).toMatchObject({ scenario: "list", sessionCount: 1 })
    expect(result.events.some((event) => event.direction === "client_to_agent" && event.message.method === "session/list")).toBe(true)
  })
})
