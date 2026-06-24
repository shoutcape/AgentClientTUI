import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { JsonRpcTransport } from "./acp/transport"

type RpcMessage = { jsonrpc?: "2.0"; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown }

let child: ReturnType<typeof spawn> | undefined

function startMockAgent(): { send: (method: string, params?: unknown) => number; write: (message: RpcMessage) => void; next: () => Promise<RpcMessage> } {
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
    write(message) {
      agentProcess.stdin.write(`${JSON.stringify(message)}\n`)
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
          expect.objectContaining({ name: "/output", meta: expect.objectContaining({ subcommands: ["text", "thought", "plan", "tools", "usage", "code", "diff", "mixed"] }) }),
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
      params: { update: { sessionUpdate: "tool_call_update", toolCallId: "mock-code-1", content: [{ type: "content", content: { type: "code" } }] } },
    })
    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call_update", toolCallId: "mock-diff-1", content: [{ type: "diff", path: "src/example.ts" }] } },
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

  test("emits code and diff output variants", async () => {
    const agent = startMockAgent()
    agent.send("initialize")
    await agent.next()
    agent.send("session/new")
    await agent.next()
    await agent.next()

    const codePromptId = agent.send("session/prompt", { prompt: "/output code" })
    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call_update", content: [{ type: "content", content: { type: "code", language: "ts", text: expect.stringContaining("const answer") } }] } },
    })
    expect(await agent.next()).toMatchObject({ id: codePromptId, result: { stopReason: "end_turn" } })

    const diffPromptId = agent.send("session/prompt", { prompt: "/output diff" })
    expect(await agent.next()).toMatchObject({
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call_update", content: [{ type: "diff", path: "src/example.ts", oldText: expect.stringContaining("before"), newText: expect.stringContaining("after") }] } },
    })
    expect(await agent.next()).toMatchObject({ id: diffPromptId, result: { stopReason: "end_turn" } })
  })

  test("continues after unsupported incoming client request response", async () => {
    const agent = startMockAgent()
    agent.send("initialize")
    await agent.next()
    agent.send("session/new")
    await agent.next()
    await agent.next()

    const promptId = agent.send("session/prompt", { prompt: "/client-request unsupported" })
    const clientRequest = await agent.next()
    expect(clientRequest.jsonrpc).toBe("2.0")
    expect(clientRequest.method).toBe("mock/unsupportedClientRequest")
    expect(typeof clientRequest.id).toBe("number")
    const clientRequestId = clientRequest.id as number

    agent.write({
      jsonrpc: "2.0",
      id: clientRequestId,
      error: { code: -32601, message: "Unsupported client request: mock/unsupportedClientRequest" },
    })

    expect(await agent.next()).toMatchObject({ id: promptId, result: { stopReason: "end_turn" } })
  })

  test("transport responds to unsupported incoming client requests", async () => {
    const transport = new JsonRpcTransport({
      command: join(process.cwd(), "node_modules", ".bin", "tsx"),
      args: ["src/mock-agent.ts"],
      label: "mock-agent",
    })
    const protocolErrors: string[] = []
    transport.onEvent((event) => {
      if (event.type === "protocol-error") protocolErrors.push(event.message)
    })

    try {
      await transport.request("initialize")
      await transport.request("session/new")
      const result = await transport.request("session/prompt", { prompt: "/client-request unsupported" })

      expect(result).toEqual({ stopReason: "end_turn" })
      expect(protocolErrors).toEqual([])
    } finally {
      transport.destroy()
    }
  })

  test("requests permission and streams selected option", async () => {
    const transport = new JsonRpcTransport({
      command: join(process.cwd(), "node_modules", ".bin", "tsx"),
      args: ["src/mock-agent.ts"],
      label: "mock-agent",
    })
    const agentText: string[] = []
    transport.onEvent((event) => {
      if (event.type !== "notification") return
      const params = event.params as { update?: { text?: string } } | undefined
      if (event.method === "session/update" && params?.update?.text) agentText.push(params.update.text)
    })
    transport.onRequest("session/request_permission", () => ({
      outcome: {
        outcome: "selected",
        optionId: "allow-once",
      },
    }))

    try {
      await transport.request("initialize")
      await transport.request("session/new")
      const result = await transport.request("session/prompt", { prompt: "/permission" })

      expect(result).toEqual({ stopReason: "end_turn" })
      expect(agentText.join("")).toContain("Permission selected: allow-once")
    } finally {
      transport.destroy()
    }
  })

  test("permission request fails when client has no handler", async () => {
    const transport = new JsonRpcTransport({
      command: join(process.cwd(), "node_modules", ".bin", "tsx"),
      args: ["src/mock-agent.ts"],
      label: "mock-agent",
    })

    try {
      await transport.request("initialize")
      await transport.request("session/new")

      await expect(transport.request("session/prompt", { prompt: "/permission" }))
        .rejects.toThrow("Unsupported client request: session/request_permission")
    } finally {
      transport.destroy()
    }
  })

  test("permission request fails on malformed client response", async () => {
    const transport = new JsonRpcTransport({
      command: join(process.cwd(), "node_modules", ".bin", "tsx"),
      args: ["src/mock-agent.ts"],
      label: "mock-agent",
    })
    transport.onRequest("session/request_permission", () => ({ outcome: { outcome: "rejected" } }))

    try {
      await transport.request("initialize")
      await transport.request("session/new")

      await expect(transport.request("session/prompt", { prompt: "/permission" }))
        .rejects.toThrow("Invalid permission response")
    } finally {
      transport.destroy()
    }
  })

  test("permission request surfaces non-error handler throws", async () => {
    const transport = new JsonRpcTransport({
      command: join(process.cwd(), "node_modules", ".bin", "tsx"),
      args: ["src/mock-agent.ts"],
      label: "mock-agent",
    })
    transport.onRequest("session/request_permission", () => {
      throw "permission exploded"
    })

    try {
      await transport.request("initialize")
      await transport.request("session/new")

      await expect(transport.request("session/prompt", { prompt: "/permission" }))
        .rejects.toThrow("permission exploded")
    } finally {
      transport.destroy()
    }
  })
})
