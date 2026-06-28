import { describe, expect, test } from "bun:test"
import { normalizeSessionUpdate } from "./session-update"

describe("normalizeSessionUpdate", () => {
  test("extracts standard agent text chunks", () => {
    expect(normalizeSessionUpdate("session/update", {
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-1",
        content: { type: "text", text: "hello" },
      },
    })).toEqual({ type: "agent-text", text: "hello", messageId: "msg-1" })
  })

  test("extracts thought chunks", () => {
    expect(normalizeSessionUpdate("session/update", {
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "checking files" },
      },
    })).toEqual({ type: "thought", text: "checking files" })
  })

  test("formats plans", () => {
    expect(normalizeSessionUpdate("session/update", {
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "Read source", priority: "high", status: "completed" },
          { content: "Run tests", priority: "medium", status: "pending" },
        ],
      },
    })).toEqual({ type: "plan", text: "[completed] Read source\n[pending] Run tests" })
  })

  test("formats tool calls and updates", () => {
    expect(normalizeSessionUpdate("session/update", {
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Reading package.json",
        kind: "read",
        status: "pending",
      },
    })).toEqual({
      type: "tool",
      text: "read pending: Reading package.json",
      toolCallId: "tool-1",
      toolKind: "read",
      toolStatus: "pending",
      toolTitle: "Reading package.json",
    })

    expect(normalizeSessionUpdate("session/update", {
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "Found script test" } },
          { type: "diff", path: "/tmp/a.ts", oldText: "old", newText: "new" },
        ],
      },
    })).toEqual({
      type: "tool",
      text: "completed: Found script test\ndiff /tmp/a.ts",
      toolCallId: "tool-1",
      toolStatus: "completed",
      blocks: [
        { type: "text", text: "completed: Found script test" },
        { type: "diff", path: "/tmp/a.ts", oldText: "old", newText: "new" },
      ],
    })
  })

  test("formats code content blocks", () => {
    expect(normalizeSessionUpdate("session/update", {
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-2",
        status: "completed",
        content: [
          { type: "content", content: { type: "code", language: "ts", text: "const answer = 42" } },
        ],
      },
    })).toEqual({
      type: "tool",
      text: "completed:\ncode ts\nconst answer = 42",
      toolCallId: "tool-2",
      toolStatus: "completed",
      blocks: [
        { type: "text", text: "completed:" },
        { type: "code", language: "ts", text: "const answer = 42" },
      ],
    })
  })

  test("formats usage updates", () => {
    expect(normalizeSessionUpdate("session/update", {
      update: {
        sessionUpdate: "usage_update",
        used: 53000,
        size: 200000,
        cost: { amount: 0.045, currency: "USD" },
      },
    })).toEqual({ type: "metadata", text: "usage 53000/200000 tokens, 0.045 USD" })
  })

  test("does not normalize available command updates as transcript entries", () => {
    expect(normalizeSessionUpdate("session/update", {
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "model", description: "Switch model" },
          { name: "mode", description: "Switch mode" },
        ],
      },
    })).toBeNull()
  })

  test("keeps legacy mock text chunks working", () => {
    expect(normalizeSessionUpdate("session/update", {
      update: { type: "agent_message_chunk", text: "legacy" },
    })).toEqual({ type: "agent-text", text: "legacy" })
  })
})
