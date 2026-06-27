import { describe, expect, test } from "bun:test"
import { AcpClient } from "./client"
import type { JsonValue } from "./types"

class FakeTransport {
  requests: Array<{ method: string; params?: JsonValue }> = []

  async request(method: string, params?: JsonValue): Promise<JsonValue> {
    this.requests.push(params === undefined ? { method } : { method, params })
    if (method === "session/new") {
      return {
        sessionId: "session-1",
        configOptions: [
          { id: "mode", name: "Mode", type: "select", currentValue: "build", options: [] },
        ],
      }
    }
    if (method === "session/set_config_option") {
      return {
        configOptions: [
          { id: "model", name: "Model", type: "select", currentValue: "openai/gpt", options: [] },
        ],
      }
    }
    return {}
  }

  notify(): void {}
}

describe("AcpClient", () => {
  test("new session returns session id and config options", async () => {
    const transport = new FakeTransport()
    const client = new AcpClient(transport as never)

    const result = await client.newSession("/repo")

    expect(result).toEqual({
      sessionId: "session-1",
      configOptions: [
        { id: "mode", name: "Mode", type: "select", currentValue: "build", options: [] },
      ],
    })
  })

  test("sets session config option and returns config options", async () => {
    const transport = new FakeTransport()
    const client = new AcpClient(transport as never)

    const result = await client.setConfigOption("session-1", "model", "openai/gpt")

    expect(transport.requests).toEqual([
      {
        method: "session/set_config_option",
        params: { sessionId: "session-1", configId: "model", value: "openai/gpt" },
      },
    ])
    expect(result).toEqual([
      { id: "model", name: "Model", type: "select", currentValue: "openai/gpt", options: [] },
    ])
  })
})
