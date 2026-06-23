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
      prompt: [{ type: "text", text }],
    }), "session/prompt")
  }

  async fetchOptions(method: string): Promise<Array<{ label: string; value: string; description?: string }>> {
    const result = await this.transport.request(method, {})
    if (Array.isArray(result)) {
      return (result as string[]).map((v) => ({ label: String(v), value: String(v) }))
    }
    const obj = result as { options?: Array<{ label?: string; value?: string; name?: string; description?: string }> }
    return (obj.options ?? []).map((o) => ({
      label: o.label ?? o.name ?? o.value ?? "",
      value: o.value ?? o.name ?? o.label ?? "",
      ...(o.description != null ? { description: o.description } : {}),
    }))
  }
}
