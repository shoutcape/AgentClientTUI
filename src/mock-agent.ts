import { createInterface } from "node:readline"

type JsonRpcMessage = {
  jsonrpc: "2.0"
  id?: string | number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string }
}

type PendingClientRequest = {
  resolve: (message: JsonRpcMessage) => void
  reject: (error: Error & { code?: number }) => void
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
let nextClientRequestId = 1
const pendingClientRequests = new Map<string | number, PendingClientRequest>()

const modelOptions = [
  { label: "sonnet", value: "sonnet", description: "Balanced mock model" },
  { label: "opus", value: "opus", description: "Largest mock model" },
  { label: "haiku", value: "haiku", description: "Fast mock model" },
]

const highCountCommands = Array.from({ length: 16 }, (_, i) => {
  const n = i + 1
  return { name: `/mock-${n}`, description: `Mock command ${n}`, meta: {} }
})

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
        {
          name: "/output",
          description: "Emit mock ACP output variants",
          meta: { subcommands: ["text", "thought", "plan", "tools", "usage", "code", "diff", "mixed"] },
        },
        ...highCountCommands,
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

function extractSelectedOption(message: JsonRpcMessage): string {
  const result = message.result
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid permission response")
  const outcome = (result as { outcome?: unknown }).outcome
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) throw new Error("Invalid permission response")
  const record = outcome as { outcome?: unknown; optionId?: unknown }
  if (record.outcome !== "selected" || typeof record.optionId !== "string") throw new Error("Invalid permission response")
  return record.optionId
}

function extractQuestionAnswers(message: JsonRpcMessage): string {
  const result = message.result
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid question response")
  const answers = (result as { answers?: unknown }).answers
  if (!Array.isArray(answers)) throw new Error("Invalid question response")
  return answers.map((answer) => {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw new Error("Invalid question response")
    const record = answer as { questionId?: unknown; answer?: unknown }
    if (typeof record.questionId !== "string" || typeof record.answer !== "string") throw new Error("Invalid question response")
    return `${record.questionId}=${record.answer}`
  }).join(", ")
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

function sessionUpdate(update: unknown): void {
  write({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } })
}

function streamStandardText(text: string, messageId = "mock-agent-message"): void {
  sessionUpdate({
    sessionUpdate: "agent_message_chunk",
    messageId,
    content: { type: "text", text },
  })
}

function streamThought(text: string): void {
  sessionUpdate({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text },
  })
}

function streamPlan(): void {
  sessionUpdate({
    sessionUpdate: "plan",
    entries: [
      { content: "Inspect workspace", priority: "high", status: "completed" },
      { content: "Run tool mock", priority: "medium", status: "in_progress" },
      { content: "Summarize output", priority: "low", status: "pending" },
    ],
  })
}

function streamToolLifecycle(): void {
  sessionUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "mock-tool-1",
    title: "Reading package.json",
    kind: "read",
    status: "pending",
  })
  sessionUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "mock-tool-1",
    status: "completed",
    content: [
      { type: "content", content: { type: "text", text: "Found package metadata." } },
      { type: "diff", path: "/tmp/mock.patch", oldText: "before", newText: "after" },
    ],
  })
}

function streamUsage(): void {
  sessionUpdate({
    sessionUpdate: "usage_update",
    used: 53000,
    size: 200000,
    cost: { amount: 0.045, currency: "USD" },
  })
}

function streamCode(): void {
  sessionUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "mock-code-1",
    status: "completed",
    content: [
      { type: "content", content: { type: "code", language: "ts", text: "const answer = 42\nconsole.log(answer)" } },
    ],
  })
}

function streamDiff(): void {
  sessionUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "mock-diff-1",
    status: "completed",
    content: [
      { type: "diff", path: "src/example.ts", oldText: "const before = 1", newText: "const after = 2" },
    ],
  })
}

function isStartupTranscriptDemoPrompt(prompt: string): boolean {
  return prompt.toLowerCase().includes("transcript container startup demo")
}

function streamStartupTranscriptDemo(): void {
  streamStandardText("AgentClientTUI transcript container demo starting. This text is intentionally wordy so wrapping, row spacing, and streaming updates are visible after every watch restart.\n")
  streamThought("Checking transcript treatments for reasoning, tool grouping, structured blocks, metadata, and long scrollback.")
  streamPlan()
  streamToolLifecycle()
  streamCode()
  streamDiff()
  streamUsage()
  for (let i = 1; i <= 18; i += 1) {
    streamStandardText(`Transcript demo line ${i}: sample output for scrollback, sticky bottom behavior, and visual density checks.\n`)
  }
  streamStandardText("Startup transcript demo complete. Edit UI code and Bun watch will restart back to this populated state.")
}

function clientRequest(method: string, params?: unknown): Promise<JsonRpcMessage> {
  const id = nextClientRequestId++
  write(params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params })

  return new Promise((resolve, reject) => {
    pendingClientRequests.set(id, { resolve, reject })
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

  if (message.id !== undefined && message.method === undefined) {
    const pendingClientRequest = pendingClientRequests.get(message.id)
    if (pendingClientRequest) {
      pendingClientRequests.delete(message.id)
      if (message.error) {
        const requestError = new Error(message.error.message ?? "Client request failed") as Error & { code?: number }
        if (message.error.code !== undefined) requestError.code = message.error.code
        pendingClientRequest.reject(requestError)
      } else {
        pendingClientRequest.resolve(message)
      }
      return
    }
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

  if (message.method === "session/list") {
    result(message.id, {
      sessions: [
        {
          sessionId,
          title: "Mock session",
          cwd: process.cwd(),
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    })
    return
  }

  if (message.method === "_mock/commands/model/options") {
    result(message.id, { options: modelOptions })
    return
  }

  if (message.method === "session/prompt") {
    const prompt = extractPrompt(message.params)

    if (isStartupTranscriptDemoPrompt(prompt)) {
      streamStartupTranscriptDemo()
      result(message.id, { stopReason: "end_turn" })
      return
    }

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

    if (prompt.startsWith("/client-request unsupported")) {
      try {
        await clientRequest("mock/unsupportedClientRequest")
      } catch (requestError) {
        if ((requestError as Error & { code?: number }).code === -32601) {
          result(message.id, { stopReason: "end_turn" })
          return
        }
        error(message.id, -32000, (requestError as Error).message)
        return
      }
      error(message.id, -32000, "Expected unsupported client request response")
      return
    }

    if (prompt.startsWith("/permission")) {
      try {
        const permission = await clientRequest("session/request_permission", {
          sessionId,
          toolCall: { toolCallId: "mock-permission", title: "Mock permission" },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        })
        const selected = extractSelectedOption(permission)
        streamText(`Permission selected: ${selected}.`)
        result(message.id, { stopReason: "end_turn" })
      } catch (requestError) {
        error(message.id, -32000, (requestError as Error).message)
      }
      return
    }

    if (prompt.startsWith("/question")) {
      try {
        const answers = await clientRequest("session/question", {
          sessionId,
          title: "Mock questions",
          questions: [
            {
              id: "color",
              question: "Choose a color",
              options: [
                { id: "red", label: "Red" },
                { id: "blue", label: "Blue" },
              ],
            },
            { id: "snack", question: "Name a snack" },
          ],
        })
        streamText(`Question answers: ${extractQuestionAnswers(answers)}.`)
        result(message.id, { stopReason: "end_turn" })
      } catch (requestError) {
        error(message.id, -32000, (requestError as Error).message)
      }
      return
    }

    if (prompt.startsWith("/output")) {
      const variant = prompt.split(/\s+/)[1] || "mixed"
      if (variant === "text") streamStandardText("Mock standard text output.")
      else if (variant === "thought") streamThought("Thinking through mock output types.")
      else if (variant === "plan") streamPlan()
      else if (variant === "tools") streamToolLifecycle()
      else if (variant === "usage") streamUsage()
      else if (variant === "code") streamCode()
      else if (variant === "diff") streamDiff()
      else {
        streamPlan()
        streamThought("Thinking through mock output types.")
        streamToolLifecycle()
        streamCode()
        streamDiff()
        streamUsage()
        streamStandardText("Mock mixed output complete.")
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
