import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import type {
  AgentCommand,
  ClientRequestHandler,
  JsonRpcError,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonValue,
  TransportEvent,
} from "./types"

type PendingRequest = {
  resolve: (value: JsonValue) => void
  reject: (error: Error) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class JsonRpcTransport {
  private child: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<JsonRpcId, PendingRequest>()
  private requestHandlers = new Map<string, ClientRequestHandler>()
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

  onRequest(method: string, handler: ClientRequestHandler): () => void {
    this.requestHandlers.set(method, handler)
    return () => this.requestHandlers.delete(method)
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

    if ("id" in message && "method" in message) {
      void this.handleRequest(message)
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

  private async handleRequest(message: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(message.method)
    if (!handler) {
      this.write({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported client request: ${message.method}`,
        },
      })
      return
    }

    try {
      const result = await handler(message.method, message.params)
      this.write({ jsonrpc: "2.0", id: message.id, result })
    } catch (error) {
      this.write({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: errorMessage(error),
        },
      })
    }
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
