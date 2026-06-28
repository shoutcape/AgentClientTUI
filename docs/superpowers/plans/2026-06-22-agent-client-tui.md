# AgentClientTUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable OpenTUI-based ACP client skeleton that defaults to a mock ACP agent and can launch real stdio ACP agent commands through `--agent`.

**Architecture:** Keep UI, transport, ACP lifecycle, and mock agent separate. The high-level smoke path runs through the CLI against the mock agent, while type checking protects module boundaries.

**Tech Stack:** Node/npm, TypeScript, `tsx`, `@opentui/core`, Node child process/readline APIs.

---

## File Structure

- Create `package.json`: scripts, dependencies, project metadata.
- Create `tsconfig.json`: strict TypeScript config for Node APIs.
- Create `README.md`: product framing and usage commands.
- Create `src/acp/types.ts`: shared JSON-RPC and ACP-shaped types used by app modules.
- Create `src/acp/transport.ts`: stdio JSON-RPC transport with request IDs, notifications, stderr logs, and shutdown.
- Create `src/acp/client.ts`: ACP lifecycle wrapper for initialize, session/new, and session/prompt.
- Create `src/ui.ts`: OpenTUI rendering adapter for status and transcript.
- Create `src/mock-agent.ts`: bundled mock ACP agent for deterministic local runs.
- Create `src/index.ts`: CLI entrypoint that wires UI, transport, ACP lifecycle, mock/default agent command, and demo prompt.
- Create `scripts/smoke.ts`: CLI smoke test using mock agent in headless mode.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `README.md`

- [ ] **Step 1: Create package metadata and scripts**

Write `package.json`:

```json
{
  "name": "agent-client-tui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Interactive terminal UI for ACP-compatible agent servers.",
  "scripts": {
    "dev": "tsx src/index.ts",
    "mock-agent": "tsx src/mock-agent.ts",
    "smoke": "tsx scripts/smoke.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opentui/core": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "tsx": "latest",
    "typescript": "latest"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Write `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts"]
}
```

- [ ] **Step 3: Create README product framing**

Write `README.md`:

```md
# AgentClientTUI

Interactive terminal UI for ACP-compatible agent servers.

AgentClientTUI is a client-side OpenTUI app. It does not implement an agent. It launches a stdio ACP server command, sends JSON-RPC messages over stdin, reads protocol messages from stdout, and renders the interaction as a terminal transcript.

The bundled mock agent is for development and learning. The primary product path is attaching to real ACP servers such as `opencode serve` or Kiro ACP when they expose stdio ACP.

## Install

```bash
npm install
```

## Run With Mock Agent

```bash
npm run dev
```

## Run With Real Agent

```bash
npm run dev -- --agent "opencode serve"
```

Replace the command with any ACP-compatible stdio server command.

## Verify

```bash
npm run typecheck
npm run smoke
```
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`

Expected: dependencies install and `package-lock.json` is created.

## Task 2: ACP Types

**Files:**
- Create: `src/acp/types.ts`

- [ ] **Step 1: Create shared protocol types**

Write `src/acp/types.ts`:

```ts
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type JsonRpcId = string | number

export type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: string
  params?: JsonValue
}

export type JsonRpcNotification = {
  jsonrpc: "2.0"
  method: string
  params?: JsonValue
}

export type JsonRpcSuccess = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result: JsonValue
}

export type JsonRpcError = {
  jsonrpc: "2.0"
  id: JsonRpcId | null
  error: {
    code: number
    message: string
    data?: JsonValue
  }
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcError

export type TransportEvent =
  | { type: "notification"; method: string; params: JsonValue | undefined }
  | { type: "stderr"; text: string }
  | { type: "protocol-error"; message: string; raw?: string }
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }

export type AgentCommand = {
  command: string
  args: string[]
  label: string
}
```

- [ ] **Step 2: Run typecheck expecting missing command**

Run: `npm run typecheck`

Expected: command may fail because dependencies may not be installed before Task 1 Step 4; after install, this file typechecks.

## Task 3: JSON-RPC Transport

**Files:**
- Create: `src/acp/transport.ts`

- [ ] **Step 1: Implement stdio JSON-RPC transport**

Write `src/acp/transport.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import type { AgentCommand, JsonRpcError, JsonRpcId, JsonRpcMessage, JsonRpcSuccess, JsonValue, TransportEvent } from "./types"

type PendingRequest = {
  resolve: (value: JsonValue) => void
  reject: (error: Error) => void
}

export class JsonRpcTransport {
  private child: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<JsonRpcId, PendingRequest>()
  private listeners = new Set<(event: TransportEvent) => void>()

  constructor(private readonly agent: AgentCommand) {
    this.child = spawn(agent.command, agent.args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    })

    createInterface({ input: this.child.stdout }).on("line", (line) => this.handleStdoutLine(line))

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.emit({ type: "stderr", text: chunk.toString("utf8") })
    })

    this.child.on("exit", (code, signal) => {
      this.emit({ type: "exit", code, signal })
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`Agent exited before response: ${this.agent.label}`))
      }
      this.pending.clear()
    })
  }

  onEvent(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  request(method: string, params?: JsonValue): Promise<JsonValue> {
    const id = this.nextId++
    const message = params === undefined
      ? { jsonrpc: "2.0" as const, id, method }
      : { jsonrpc: "2.0" as const, id, method, params }

    this.write(message)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  notify(method: string, params?: JsonValue): void {
    const message = params === undefined
      ? { jsonrpc: "2.0" as const, method }
      : { jsonrpc: "2.0" as const, method, params }

    this.write(message)
  }

  destroy(): void {
    if (!this.child.killed) {
      this.child.kill("SIGTERM")
    }
  }

  private write(message: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleStdoutLine(line: string): void {
    let message: JsonRpcMessage

    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch (error) {
      this.emit({ type: "protocol-error", message: `Invalid JSON from agent stdout: ${(error as Error).message}`, raw: line })
      return
    }

    if ("method" in message && !("id" in message)) {
      this.emit({ type: "notification", method: message.method, params: message.params })
      return
    }

    if ("id" in message && "result" in message) {
      this.resolveResponse(message)
      return
    }

    if ("id" in message && "error" in message) {
      this.rejectResponse(message)
      return
    }

    this.emit({ type: "protocol-error", message: "Unrecognized JSON-RPC message from agent stdout", raw: line })
  }

  private resolveResponse(message: JsonRpcSuccess): void {
    const pending = this.pending.get(message.id)
    if (!pending) {
      this.emit({ type: "protocol-error", message: `Response for unknown request id: ${String(message.id)}` })
      return
    }

    this.pending.delete(message.id)
    pending.resolve(message.result)
  }

  private rejectResponse(message: JsonRpcError): void {
    if (message.id === null) {
      this.emit({ type: "protocol-error", message: `Agent returned JSON-RPC error without request id: ${message.error.message}` })
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) {
      this.emit({ type: "protocol-error", message: `Error response for unknown request id: ${String(message.id)}` })
      return
    }

    this.pending.delete(message.id)
    pending.reject(new Error(message.error.message))
  }

  private emit(event: TransportEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
```

## Task 4: ACP Lifecycle Client

**Files:**
- Create: `src/acp/client.ts`

- [ ] **Step 1: Implement minimal ACP lifecycle wrapper**

Write `src/acp/client.ts`:

```ts
import type { JsonObject, JsonValue } from "./types"
import { JsonRpcTransport } from "./transport"

function asObject(value: JsonValue, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} response was not an object`)
  }

  return value
}

function asString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} was not a string`)
  }

  return value
}

export class AcpClient {
  constructor(private readonly transport: JsonRpcTransport) {}

  async initialize(): Promise<JsonObject> {
    return asObject(await this.transport.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "AgentClientTUI", version: "0.1.0" },
    }), "initialize")
  }

  async newSession(cwd: string): Promise<string> {
    const result = asObject(await this.transport.request("session/new", {
      cwd,
      mcpServers: [],
    }), "session/new")

    return asString(result.sessionId, "sessionId")
  }

  async prompt(sessionId: string, text: string): Promise<JsonObject> {
    return asObject(await this.transport.request("session/prompt", {
      sessionId,
      content: [{ type: "text", text }],
    }), "session/prompt")
  }
}
```

## Task 5: Mock ACP Agent

**Files:**
- Create: `src/mock-agent.ts`

- [ ] **Step 1: Implement bundled mock agent**

Write `src/mock-agent.ts`:

```ts
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
```

## Task 6: OpenTUI UI Adapter

**Files:**
- Create: `src/ui.ts`

- [ ] **Step 1: Implement UI with headless fallback**

Write `src/ui.ts`:

```ts
import { Box, Text, createCliRenderer } from "@opentui/core"

export type TranscriptKind = "user" | "agent" | "status" | "error" | "log"

export type TranscriptEntry = {
  kind: TranscriptKind
  text: string
}

export type AgentClientUi = {
  setStatus(status: string): void
  append(entry: TranscriptEntry): void
  destroy(): void
}

const colors: Record<TranscriptKind, string> = {
  user: "#A6E3A1",
  agent: "#89B4FA",
  status: "#F9E2AF",
  error: "#F38BA8",
  log: "#A6ADC8",
}

export async function createAgentClientUi(options: { headless?: boolean } = {}): Promise<AgentClientUi> {
  if (options.headless) {
    return {
      setStatus(status) {
        process.stdout.write(`[status] ${status}\n`)
      },
      append(entry) {
        process.stdout.write(`[${entry.kind}] ${entry.text}\n`)
      },
      destroy() {},
    }
  }

  const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })
  let status = "starting"
  const transcript: TranscriptEntry[] = []

  function render(): void {
    renderer.root.clear()
    renderer.root.add(
      Box(
        { flexDirection: "column", padding: 1, gap: 1 },
        Text({ content: "AgentClientTUI", fg: "#8BD5CA" }),
        Text({ content: `Status: ${status}`, fg: "#F9E2AF" }),
        Box(
          { flexDirection: "column", borderStyle: "rounded", padding: 1, gap: 0 },
          ...transcript.slice(-20).map((entry) => Text({ content: `[${entry.kind}] ${entry.text}`, fg: colors[entry.kind] })),
        ),
        Text({ content: "Headless smoke sends one prompt automatically. Press Ctrl+C to exit.", fg: "#A6ADC8" }),
      ),
    )
  }

  render()

  return {
    setStatus(nextStatus) {
      status = nextStatus
      render()
    },
    append(entry) {
      transcript.push(entry)
      render()
    },
    destroy() {
      renderer.destroy()
    },
  }
}
```

## Task 7: CLI Entrypoint

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement CLI wiring**

Write `src/index.ts`:

```ts
import { join } from "node:path"
import { cwd } from "node:process"
import { AcpClient } from "./acp/client"
import { JsonRpcTransport } from "./acp/transport"
import type { AgentCommand, TransportEvent } from "./acp/types"
import { createAgentClientUi } from "./ui"

function parseArgs(argv: string[]): { agent: AgentCommand; headless: boolean } {
  const agentFlag = argv.indexOf("--agent")
  const headless = argv.includes("--headless")

  if (agentFlag >= 0) {
    const commandText = argv[agentFlag + 1]
    if (!commandText) {
      throw new Error("--agent requires a command string")
    }

    return { agent: commandFromShellText(commandText), headless }
  }

  return {
    agent: {
      command: join(cwd(), "node_modules", ".bin", "tsx"),
      args: ["src/mock-agent.ts"],
      label: "mock-agent",
    },
    headless,
  }
}

function commandFromShellText(commandText: string): AgentCommand {
  const parts = commandText.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? []
  const [command, ...args] = parts
  if (!command) {
    throw new Error("Agent command was empty")
  }

  return { command, args, label: commandText }
}

function describeNotification(event: Extract<TransportEvent, { type: "notification" }>): string {
  return `${event.method}: ${JSON.stringify(event.params ?? {})}`
}

const { agent, headless } = parseArgs(process.argv.slice(2))
const ui = await createAgentClientUi({ headless })
const transport = new JsonRpcTransport(agent)
const client = new AcpClient(transport)

transport.onEvent((event) => {
  if (event.type === "notification") {
    ui.append({ kind: "agent", text: describeNotification(event) })
  } else if (event.type === "stderr") {
    ui.append({ kind: "log", text: event.text.trim() })
  } else if (event.type === "protocol-error") {
    ui.append({ kind: "error", text: event.raw ? `${event.message}: ${event.raw}` : event.message })
  } else if (event.type === "exit") {
    ui.setStatus(`agent exited (${event.code ?? event.signal ?? "unknown"})`)
  }
})

process.on("SIGINT", () => {
  transport.destroy()
  ui.destroy()
  process.exit(0)
})

try {
  ui.setStatus(`launching ${agent.label}`)
  await client.initialize()
  ui.setStatus("initialized")

  const sessionId = await client.newSession(cwd())
  ui.setStatus(`session ${sessionId}`)

  const prompt = "Say hello from AgentClientTUI."
  ui.append({ kind: "user", text: prompt })
  const response = await client.prompt(sessionId, prompt)
  ui.append({ kind: "status", text: `prompt response: ${JSON.stringify(response)}` })
  ui.setStatus("complete")

  if (headless) {
    transport.destroy()
    ui.destroy()
  }
} catch (error) {
  ui.append({ kind: "error", text: (error as Error).message })
  ui.setStatus("failed")
  transport.destroy()
  if (headless) {
    ui.destroy()
    process.exit(1)
  }
}
```

## Task 8: Smoke Test

**Files:**
- Create: `scripts/smoke.ts`

- [ ] **Step 1: Implement high-level CLI smoke test**

Write `scripts/smoke.ts`:

```ts
import { spawn } from "node:child_process"
import { join } from "node:path"

const child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/index.ts", "--headless"], {
  stdio: ["ignore", "pipe", "pipe"],
})

let stdout = ""
let stderr = ""

child.stdout.on("data", (chunk: Buffer) => {
  stdout += chunk.toString("utf8")
})

child.stderr.on("data", (chunk: Buffer) => {
  stderr += chunk.toString("utf8")
})

const code = await new Promise<number | null>((resolve) => {
  const timeout = setTimeout(() => {
    child.kill("SIGTERM")
    resolve(124)
  }, 5000)

  child.on("exit", (exitCode) => {
    clearTimeout(timeout)
    resolve(exitCode)
  })
})

const required = [
  "[status] initialized",
  "[status] session mock-session-1",
  "[user] Say hello from AgentClientTUI.",
  "session/update",
  "[status] prompt response",
  "[status] complete",
]

const missing = required.filter((needle) => !stdout.includes(needle))

if (code !== 0 || missing.length > 0) {
  console.error("Smoke test failed")
  console.error(`Exit code: ${code}`)
  console.error(`Missing: ${missing.join(", ")}`)
  console.error("stdout:")
  console.error(stdout)
  console.error("stderr:")
  console.error(stderr)
  process.exit(1)
}

console.log("Smoke test passed")
```

## Task 9: Verification

**Files:**
- Modify if needed: any files with type or smoke failures.

- [ ] **Step 1: Run TypeScript verification**

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Run high-level smoke test**

Run: `npm run smoke`

Expected: prints `Smoke test passed` and exits 0.

- [ ] **Step 3: Inspect git status**

Run: `git status --short`

Expected: only intended project files are listed.

## Self-Review

- Spec coverage: PRD stories for mock default, real `--agent`, status/transcript, stderr logs, protocol errors, JSON-RPC request IDs, module boundaries, README framing, and smoke seam are covered by Tasks 1-9.
- Placeholder scan: plan has no TBD/TODO placeholders and every code-writing step includes concrete content.
- Type consistency: `AgentCommand`, `JsonRpcTransport`, `AcpClient`, and UI methods are defined before use and names match across tasks.
