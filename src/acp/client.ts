import type { JsonObject, JsonValue } from "./types"
import { JsonRpcTransport } from "./transport"
import type { SessionConfigOption } from "../commands/acp"

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

  async newSession(cwd: string): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const result = asObject(await this.transport.request("session/new", {
      cwd,
      mcpServers: [],
    }), "session/new")

    return {
      sessionId: asString(result.sessionId, "sessionId"),
      configOptions: Array.isArray(result.configOptions) ? result.configOptions as SessionConfigOption[] : [],
    }
  }

  async prompt(sessionId: string, text: string): Promise<JsonObject> {
    return asObject(await this.transport.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    }), "session/prompt")
  }

  cancel(sessionId: string): void {
    this.transport.notify("session/cancel", { sessionId })
  }

  async setConfigOption(sessionId: string, configId: string, value: string): Promise<SessionConfigOption[]> {
    const result = asObject(await this.transport.request("session/set_config_option", {
      sessionId,
      configId,
      value,
    }), "session/set_config_option")
    return Array.isArray(result.configOptions) ? result.configOptions as SessionConfigOption[] : []
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
