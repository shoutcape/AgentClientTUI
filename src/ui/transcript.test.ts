import { describe, expect, test } from "bun:test"
import {
  appendTranscriptEntry,
  buildTranscriptRows,
  createTranscriptState,
  finishAgentMessage,
  getTranscriptScrollAction,
  opencodeTranscriptTheme,
  routeTranscriptScrollAction,
  updateActiveAgentMessage,
} from "./transcript"

describe("transcript model", () => {
  test("appends entries as stable nodes with text blocks", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "user", text: "hello" })

    expect(state.nodes).toHaveLength(1)
    expect(state.nodes[0]).toMatchObject({ kind: "user" })
    expect(state.nodes[0]?.blocks).toEqual([
      { id: "block-1", type: "text", text: "hello" },
    ])
    expect(state.activeAgentNodeId).toBeUndefined()
  })

  test("agent append starts active assistant stream", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "agent", text: "part 1" })

    expect(state.activeAgentNodeId).toBe("node-1")
    expect(state.nodes[0]?.blocks[0]?.text).toBe("part 1")
  })

  test("updateActiveAgentMessage mutates active assistant block", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "agent", text: "part 1" })
    state = updateActiveAgentMessage(state, "part 1 part 2")

    expect(state.nodes[0]?.blocks[0]?.text).toBe("part 1 part 2")
  })

  test("finishAgentMessage clears active assistant stream", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "agent", text: "done" })
    state = finishAgentMessage(state)
    state = updateActiveAgentMessage(state, "should not replace")

    expect(state.activeAgentNodeId).toBeUndefined()
    expect(state.nodes[0]?.blocks[0]?.text).toBe("done")
  })

  test("status appended during stream does not receive later agent updates", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "agent", text: "stream" })
    state = appendTranscriptEntry(state, { kind: "status", text: "working" })
    state = updateActiveAgentMessage(state, "stream continued")

    expect(state.nodes[0]?.blocks[0]?.text).toBe("stream continued")
    expect(state.nodes[1]?.blocks[0]?.text).toBe("working")
  })

  test("buildTranscriptRows preserves existing labels and colors", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "user", text: "inspect repo" })
    state = appendTranscriptEntry(state, { kind: "agent", text: "working" })
    state = appendTranscriptEntry(state, { kind: "log", text: "ready" })

    expect(buildTranscriptRows(state.nodes)).toEqual([
      { label: "● user", text: "inspect repo", color: opencodeTranscriptTheme.success },
      { label: "◆ assistant", text: "working", color: opencodeTranscriptTheme.primary },
      { label: "· log", text: "ready", color: opencodeTranscriptTheme.textMuted },
    ])
  })

  test("maps always-active transcript scroll keys", () => {
    expect(getTranscriptScrollAction("pageup")).toBe("page-up")
    expect(getTranscriptScrollAction("pagedown")).toBe("page-down")
    expect(getTranscriptScrollAction("home")).toBe("top")
    expect(getTranscriptScrollAction("end")).toBe("bottom")
    expect(getTranscriptScrollAction("a")).toBeNull()
  })

  test("does not route transcript scroll keys when higher-priority UI is active", () => {
    expect(routeTranscriptScrollAction("pageup")).toBe("page-up")
    expect(routeTranscriptScrollAction("pageup", { panelOpen: true })).toBeNull()
    expect(routeTranscriptScrollAction("pageup", { commandActive: true })).toBeNull()
  })

  test("updateActiveAgentMessage is safe with empty transcript", () => {
    const state = updateActiveAgentMessage(createTranscriptState(), "ignored")
    expect(state.nodes).toEqual([])
  })

  test("new agent append replaces active stream target", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "agent", text: "first" })
    state = appendTranscriptEntry(state, { kind: "agent", text: "second" })
    state = updateActiveAgentMessage(state, "second updated")

    expect(state.nodes[0]?.blocks[0]?.text).toBe("first")
    expect(state.nodes[1]?.blocks[0]?.text).toBe("second updated")
  })
})
