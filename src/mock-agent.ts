import { createInterface } from "node:readline"

type JsonRpcMessage = {
  jsonrpc: "2.0"
  id?: string | number
  method?: string
  params?: unknown
}

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id: string | number | undefined, value: unknown): void {
  if (id === undefined) return
  write({ jsonrpc: "2.0", id, result: value })
}

function error(id: string | number | undefined, code: number, message: string): void {
  write({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })
}

const sessionId = "mock-session-1"

createInterface({ input: process.stdin }).on("line", async (line) => {
  let message: JsonRpcMessage

  try {
    message = JSON.parse(line) as JsonRpcMessage
  } catch {
    error(undefined, -32700, "Parse error")
    return
  }

  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        mcpCapabilities: { http: false, sse: false },
        sessionCapabilities: {},
        auth: {},
      },
      authMethods: [],
      agentInfo: { name: "AgentClientTUI Mock Agent", version: "0.1.0" },
    })
    return
  }

  if (message.method === "session/new") {
    result(message.id, { sessionId })
    return
  }

  if (message.method === "session/prompt") {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: { type: "agent_message_chunk", text: "Mock agent received your prompt." },
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: { type: "agent_message_chunk", text: " This proves stdio ACP wiring works." },
      },
    })

    result(message.id, { stopReason: "end_turn" })
    return
  }

  error(message.id, -32601, `Method not found: ${message.method ?? "unknown"}`)
})

process.stderr.write("mock-agent: ready\n")
