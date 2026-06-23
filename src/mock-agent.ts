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

const modelOptions = [
  { label: "sonnet", value: "sonnet", description: "Balanced mock model" },
  { label: "opus", value: "opus", description: "Largest mock model" },
  { label: "haiku", value: "haiku", description: "Fast mock model" },
]

function announceCommands(): void {
  write({
    jsonrpc: "2.0",
    method: "_kiro.dev/commands/available",
    params: {
      sessionId,
      commands: [
        {
          name: "/model",
          description: "Switch mock model",
          meta: { inputType: "selection", optionsMethod: "_mock/commands/model/options" },
        },
        {
          name: "/context",
          description: "Show mock context panel",
          meta: { inputType: "panel", subcommands: ["show", "add", "clear"] },
        },
        { name: "/long", description: "Stream a long mock transcript response", meta: {} },
        { name: "/fail", description: "Return a mock prompt error", meta: {} },
      ],
      prompts: [],
      tools: [],
      mcpServers: [],
    },
  })
}

function extractPrompt(params: unknown): string {
  if (!params || typeof params !== "object") return ""
  const p = params as Record<string, unknown>
  if (typeof p.prompt === "string") return p.prompt
  if (Array.isArray(p.prompt)) {
    return p.prompt.map((part) => {
      if (!part || typeof part !== "object") return ""
      const record = part as Record<string, unknown>
      return typeof record.text === "string" ? record.text : ""
    }).join("")
  }
  return ""
}

function streamText(text: string): void {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: { type: "agent_message_chunk", text },
    },
  })
}

function longLineCount(prompt: string): number {
  const raw = Number.parseInt(prompt.split(/\s+/)[1] ?? "20", 10)
  if (!Number.isFinite(raw)) return 20
  return Math.max(1, Math.min(raw, 200))
}

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
    announceCommands()
    return
  }

  if (message.method === "_mock/commands/model/options") {
    result(message.id, { options: modelOptions })
    return
  }

  if (message.method === "session/prompt") {
    const prompt = extractPrompt(message.params)

    if (prompt.startsWith("/fail")) {
      error(message.id, -32000, "Mock command failed")
      return
    }

    if (prompt.startsWith("/model")) {
      const model = prompt.split(/\s+/)[1] || "unknown"
      streamText(`Mock model switched to ${model}.`)
      result(message.id, { stopReason: "end_turn" })
      return
    }

    if (prompt.startsWith("/context show")) {
      streamText("Mock context: src/index.ts, src/ui.ts")
      result(message.id, { stopReason: "end_turn" })
      return
    }

    if (prompt.startsWith("/long")) {
      const count = longLineCount(prompt)
      for (let i = 1; i <= count; i += 1) {
        streamText(`Mock long line ${i} of ${count}.\n`)
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      result(message.id, { stopReason: "end_turn" })
      return
    }

    streamText("Mock agent received your prompt.")

    await new Promise((resolve) => setTimeout(resolve, 50))

    streamText(" This proves stdio ACP wiring works.")

    result(message.id, { stopReason: "end_turn" })
    return
  }

  error(message.id, -32601, `Method not found: ${message.method ?? "unknown"}`)
})

process.stderr.write("mock-agent: ready\n")
