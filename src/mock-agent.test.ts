import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { join } from "node:path"

type RpcMessage = { jsonrpc?: "2.0"; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown }

let child: ReturnType<typeof spawn> | undefined

function startMockAgent(): { send: (method: string, params?: unknown) => number; next: () => Promise<RpcMessage> } {
  const agentProcess = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/mock-agent.ts"], {
    stdio: ["pipe", "pipe", "ignore"],
  })
  child = agentProcess
  let nextId = 1
  const queue: RpcMessage[] = []
  const waiters: Array<(message: RpcMessage) => void> = []
  let buffer = ""

  agentProcess.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8")
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      const message = JSON.parse(line) as RpcMessage
      const waiter = waiters.shift()
      if (waiter) waiter(message)
      else queue.push(message)
    }
  })

  return {
    send(method, params) {
      const id = nextId++
      agentProcess.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      return id
    },
    next() {
      const message = queue.shift()
      if (message) return Promise.resolve(message)
      return new Promise<RpcMessage>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for mock-agent message")), 1000)
        waiters.push((nextMessage) => {
          clearTimeout(timeout)
          resolve(nextMessage)
        })
      })
    },
  }
}

afterEach(() => {
  child?.kill("SIGTERM")
  child = undefined
})

describe("mock ACP agent commands", () => {
  test("announces mock slash commands after session creation", async () => {
    const agent = startMockAgent()
    const initId = agent.send("initialize")
    expect(await agent.next()).toMatchObject({ id: initId })

    const sessionId = agent.send("session/new")
    expect(await agent.next()).toMatchObject({ id: sessionId, result: { sessionId: "mock-session-1" } })

    expect(await agent.next()).toMatchObject({
      method: "_kiro.dev/commands/available",
      params: {
        sessionId: "mock-session-1",
        commands: expect.arrayContaining([
          expect.objectContaining({ name: "/model", meta: expect.objectContaining({ inputType: "selection" }) }),
          expect.objectContaining({ name: "/context", meta: expect.objectContaining({ inputType: "panel" }) }),
          expect.objectContaining({ name: "/long" }),
          expect.objectContaining({ name: "/fail" }),
          expect.objectContaining({ name: "/output", meta: expect.objectContaining({ subcommands: ["text", "thought", "plan", "tools", "usage", "mixed"] }) }),
          expect.objectContaining({ name: "/mock-12", description: "Mock command 12" }),
        ]),
      },
    })
  })

  test("returns model options and command-specific responses", async () => {
    const agent = startMockAgent()
    agent.send("initialize")
    await agent.next()
    agent.send("session/new")
    await agent.next()
    await agent.next()

    const optionsId = agent.send("_mock/commands/model/options")
    expect(await agent.next()).toEqual({
      jsonrpc: "2.0",
      id: optionsId,
      result: { options: [
        { label: "sonnet", value: "sonnet", description: "Balanced mock model" },
        { label: "opus", value: "opus", description: "Largest mock model" },
        { label: "haiku", value: "haiku", description: "Fast mock model" },
      ] },
    })

    const promptId = agent.send("session/prompt", { prompt: "/model sonnet" })
    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { type: "agent_message_chunk", text: "Mock model switched to sonnet." } },
    })
    expect(await agent.next()).toMatchObject({ id: promptId, result: { stopReason: "end_turn" } })
  })

  test("streams long mock responses with requested line count", async () => {
    const agent = startMockAgent()
    agent.send("initialize")
    await agent.next()
    agent.send("session/new")
    await agent.next()
    await agent.next()

    const promptId = agent.send("session/prompt", { prompt: "/long 5" })
    const chunks: string[] = []
    for (let i = 0; i < 5; i += 1) {
      const message = await agent.next()
      expect(message).toMatchObject({ method: "session/update" })
      const params = message.params as { update?: { text?: string } }
      chunks.push(params.update?.text ?? "")
    }

    expect(chunks).toEqual([
      "Mock long line 1 of 5.\n",
      "Mock long line 2 of 5.\n",
      "Mock long line 3 of 5.\n",
      "Mock long line 4 of 5.\n",
      "Mock long line 5 of 5.\n",
    ])
    expect(await agent.next()).toMatchObject({ id: promptId, result: { stopReason: "end_turn" } })
  })

  test("emits standard ACP output update variants", async () => {
    const agent = startMockAgent()
    agent.send("initialize")
    await agent.next()
    agent.send("session/new")
    await agent.next()
    await agent.next()

    const promptId = agent.send("session/prompt", { prompt: "/output mixed" })

    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { sessionUpdate: "plan", entries: expect.arrayContaining([expect.objectContaining({ content: "Inspect workspace" })]) } },
    })
    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking through mock output types." } } },
    })
    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call", toolCallId: "mock-tool-1", title: "Reading package.json" } },
    })
    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call_update", toolCallId: "mock-tool-1", status: "completed" } },
    })
    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { sessionUpdate: "usage_update", used: 53000, size: 200000 } },
    })
    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Mock mixed output complete." } } },
    })
    expect(await agent.next()).toMatchObject({ id: promptId, result: { stopReason: "end_turn" } })
  })
})
