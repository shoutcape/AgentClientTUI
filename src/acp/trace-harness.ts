import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { createInterface } from "node:readline"
import type { AgentCommand, JsonRpcId, JsonValue } from "./types"

export type TraceDirection = "client_to_agent" | "agent_to_client" | "agent_stderr" | "process_event" | "harness_event"

export type TraceMessage = Record<string, any>

export type TraceEvent = {
  ts: string
  direction: TraceDirection
  message: TraceMessage
}

export type TraceScenario = "initialize" | "new-prompt" | "list"

export type TraceScenarioResult = {
  events: TraceEvent[]
  summary: TraceMessage
}

type RunTraceScenarioOptions = {
  agent: AgentCommand
  scenario: TraceScenario
  outFile?: string
  prompt?: string
  cwd?: string
  timeoutMs?: number
}

type PendingRequest = {
  resolve: (message: TraceMessage) => void
  reject: (error: Error) => void
}

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|cookie)/i

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent"
}

export function defaultTraceOutFile(agentLabel: string, scenario: TraceScenario, now = new Date()): string {
  const timestamp = now.toISOString().replace(/T(\d{2}):(\d{2}):(\d{2}).*/, "-$1$2$3")
  return `tmp/acp-traces/${slug(agentLabel)}/${timestamp}-${scenario}.jsonl`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function redactedTraceValue(value: unknown, home = process.env.HOME): any {
  if (typeof value === "string") {
    return home ? value.replaceAll(home, "$HOME") : value
  }

  if (Array.isArray(value)) return value.map((item) => redactedTraceValue(item, home))

  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactedTraceValue(item, home),
    ]))
  }

  return value
}

export async function writeTraceEvent(outFile: string, event: TraceEvent): Promise<void> {
  await mkdir(dirname(outFile), { recursive: true })
  await appendFile(outFile, `${JSON.stringify(redactedTraceValue(event))}\n`)
}

function asObject(value: JsonValue | undefined, label: string): TraceMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} response was not an object`)
  }
  return value as TraceMessage
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

class TraceConnection {
  private child: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<JsonRpcId, PendingRequest>()
  readonly events: TraceEvent[] = []

  constructor(private readonly agent: AgentCommand, private readonly outFile?: string) {
    this.child = spawn(agent.command, agent.args, { stdio: ["pipe", "pipe", "pipe"], shell: false })

    createInterface({ input: this.child.stdout }).on("line", (line) => {
      this.handleStdoutLine(line).catch((error) => {
        void this.record("harness_event", { error: (error as Error).message })
      })
    })

    this.child.stderr.on("data", (chunk: Buffer) => {
      void this.record("agent_stderr", { text: chunk.toString("utf8") })
    })

    this.child.on("exit", (code, signal) => {
      void this.record("process_event", { event: "exit", code, signal, agent: this.agent.label })
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`Agent exited before response: ${this.agent.label}`))
      }
      this.pending.clear()
    })
  }

  async request(method: string, params?: JsonValue): Promise<TraceMessage> {
    const id = this.nextId++
    const message = params === undefined
      ? { jsonrpc: "2.0" as const, id, method }
      : { jsonrpc: "2.0" as const, id, method, params }

    await this.record("client_to_agent", message)
    this.child.stdin.write(`${JSON.stringify(message)}\n`)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  close(): void {
    if (!this.child.killed) this.child.kill("SIGTERM")
  }

  private async handleStdoutLine(line: string): Promise<void> {
    let message: TraceMessage
    try {
      message = JSON.parse(line) as TraceMessage
    } catch (error) {
      await this.record("harness_event", { error: `Invalid JSON from agent stdout: ${(error as Error).message}`, raw: line })
      return
    }

    await this.record("agent_to_client", message)

    if (("result" in message || "error" in message) && (typeof message.id === "number" || typeof message.id === "string")) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) {
        const error = isObject(message.error) && typeof message.error.message === "string"
          ? new Error(message.error.message)
          : new Error("Agent returned JSON-RPC error")
        pending.reject(error)
      } else {
        pending.resolve(message)
      }
    }
  }

  private async record(direction: TraceDirection, message: TraceMessage): Promise<void> {
    const event: TraceEvent = {
      ts: new Date().toISOString(),
      direction,
      message: redactedTraceValue(message),
    }
    this.events.push(event)
    if (this.outFile) await writeTraceEvent(this.outFile, event)
  }
}

export async function runTraceScenario(options: RunTraceScenarioOptions): Promise<TraceScenarioResult> {
  const timeoutMs = options.timeoutMs ?? 15_000
  return withTimeout(runTraceScenarioInner(options), timeoutMs, `trace scenario ${options.scenario}`)
}

async function runTraceScenarioInner(options: RunTraceScenarioOptions): Promise<TraceScenarioResult> {
  const connection = new TraceConnection(options.agent, options.outFile)

  try {
    const initialize = await connection.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "AgentClientTUI", version: "0.1.0" },
    })
    const initializeResult = asObject(initialize.result as JsonValue | undefined, "initialize")

    if (options.scenario === "initialize") {
      return {
        events: connection.events,
        summary: {
          scenario: options.scenario,
          protocolVersion: initializeResult.protocolVersion,
          agentInfo: initializeResult.agentInfo,
        },
      }
    }

    if (options.scenario === "list") {
      const list = await connection.request("session/list", options.cwd ? { cwd: options.cwd } : {})
      const result = asObject(list.result as JsonValue | undefined, "session/list")
      const sessions = Array.isArray(result.sessions) ? result.sessions : []
      return {
        events: connection.events,
        summary: {
          scenario: options.scenario,
          sessionCount: sessions.length,
          nextCursor: result.nextCursor,
        },
      }
    }

    const newSession = await connection.request("session/new", {
      cwd: options.cwd ?? process.cwd(),
      mcpServers: [],
    })
    const session = asObject(newSession.result as JsonValue | undefined, "session/new")
    const sessionId = typeof session.sessionId === "string" ? session.sessionId : undefined
    if (!sessionId) throw new Error("session/new response did not include sessionId")

    const prompt = await connection.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: options.prompt ?? "Say hello from AgentClientTUI trace." }],
    })
    const promptResult = asObject(prompt.result as JsonValue | undefined, "session/prompt")

    return {
      events: connection.events,
      summary: {
        scenario: options.scenario,
        sessionId,
        stopReason: promptResult.stopReason,
      },
    }
  } finally {
    connection.close()
  }
}
