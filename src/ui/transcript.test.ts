import { describe, expect, test } from "bun:test"
import {
  appendTranscriptEntry,
  buildTranscriptRows,
  createTranscriptState,
  finishAgentMessage,
  getTranscriptScrollAction,
  opencodeTranscriptTheme,
  routeTranscriptScrollAction,
  toggleLatestToolBurstExpansion,
  updateActiveAgentMessage,
} from "./transcript"

function firstBlockText(state: ReturnType<typeof createTranscriptState>, nodeIndex: number): string | undefined {
  const block = state.nodes[nodeIndex]?.blocks[0]
  return block && "text" in block ? block.text : undefined
}

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
    expect(firstBlockText(state, 0)).toBe("part 1")
  })

  test("updateActiveAgentMessage mutates active assistant block", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "agent", text: "part 1" })
    state = updateActiveAgentMessage(state, "part 1 part 2")

    expect(firstBlockText(state, 0)).toBe("part 1 part 2")
  })

  test("finishAgentMessage clears active assistant stream", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "agent", text: "done" })
    state = finishAgentMessage(state)
    state = updateActiveAgentMessage(state, "should not replace")

    expect(state.activeAgentNodeId).toBeUndefined()
    expect(firstBlockText(state, 0)).toBe("done")
  })

  test("status appended during stream does not receive later agent updates", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, { kind: "agent", text: "stream" })
    state = appendTranscriptEntry(state, { kind: "status", text: "working" })
    state = updateActiveAgentMessage(state, "stream continued")

    expect(firstBlockText(state, 0)).toBe("stream continued")
    expect(firstBlockText(state, 1)).toBe("working")
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

  test("buildTranscriptRows keeps code and diff content available for text fallback", () => {
    const rows = buildTranscriptRows([{ kind: "tool", blocks: [
      { id: "block-1", type: "code", language: "ts", text: "const before = 1\nconst after = 2" },
      { id: "block-2", type: "diff", path: "src/example.ts", oldText: "const before = 1", newText: "const after = 2" },
    ] }])

    expect(rows.map((row) => row.text)).toEqual(expect.arrayContaining([
      "code ts",
      "  const before = 1",
      "  const after = 2",
      "diff src/example.ts",
      "- const before = 1",
      "+ const after = 2",
    ]))
    expect(rows.some((row) => row.color === opencodeTranscriptTheme.error)).toBe(true)
    expect(rows.some((row) => row.color === opencodeTranscriptTheme.success)).toBe(true)
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

    expect(firstBlockText(state, 0)).toBe("first")
    expect(firstBlockText(state, 1)).toBe("second updated")
  })

  test("groups tool lifecycle updates into one collapsed burst node", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "read pending: package.json",
      toolCallId: "read-1",
      toolKind: "read",
      toolStatus: "pending",
      toolTitle: "package.json",
    })
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "in_progress",
      toolCallId: "read-1",
      toolStatus: "in_progress",
    })
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "completed: package name agent-client-tui",
      toolCallId: "read-1",
      toolStatus: "completed",
      blocks: [{ type: "text", text: "completed: package name agent-client-tui" }],
    })

    expect(state.nodes).toHaveLength(1)
    const block = state.nodes[0]?.blocks[0]
    expect(block).toMatchObject({
      type: "tool-burst",
      expanded: false,
      currentType: "read",
      currentTypeCount: 1,
      totalCount: 1,
    })
    expect(block && "calls" in block ? block.calls[0] : undefined).toMatchObject({
      id: "read-1",
      displayType: "read",
      status: "done",
      title: "package.json",
      blocks: [{ type: "text", text: "completed: package name agent-client-tui" }],
    })

    const rowText = buildTranscriptRows(state.nodes).map((row) => row.text).join("\n")
    expect(rowText).toContain("Using tools")
    expect(rowText).toContain("package.json")
    expect(rowText).toContain("read · 1")
    expect(rowText).not.toContain("in_progress")
  })

  test("multiple tool calls in one assistant turn stay in one burst with type counts", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "search pending: grep normalizeSessionUpdate",
      toolCallId: "search-1",
      toolKind: "search",
      toolStatus: "pending",
      toolTitle: "grep normalizeSessionUpdate",
    })
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "read pending: src/acp/session-update.ts",
      toolCallId: "read-1",
      toolKind: "read",
      toolStatus: "pending",
      toolTitle: "src/acp/session-update.ts",
    })
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "read pending: src/ui/transcript.ts",
      toolCallId: "read-2",
      toolKind: "read",
      toolStatus: "pending",
      toolTitle: "src/ui/transcript.ts",
    })

    expect(state.nodes).toHaveLength(1)
    const block = state.nodes[0]?.blocks[0]
    expect(block).toMatchObject({
      type: "tool-burst",
      currentType: "read",
      currentTypeCount: 2,
      totalCount: 3,
    })

    const rowText = buildTranscriptRows(state.nodes).map((row) => row.text).join("\n")
    expect(rowText).toContain("Using tools")
    expect(rowText).toContain("src/ui/transcript.ts")
    expect(rowText).toContain("read · 2")
    expect(rowText).not.toContain("search pending")
  })

  test("collapsed tool burst uses fixed target and metadata columns", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "web pending: exa_web_search_exa documentation query with long target",
      toolCallId: "web-1",
      toolKind: "web",
      toolStatus: "pending",
      toolTitle: "exa_web_search_exa documentation query with long target",
    })

    const shortState = appendTranscriptEntry(createTranscriptState(), {
      kind: "tool",
      text: "read pending: package.json",
      toolCallId: "read-1",
      toolKind: "read",
      toolStatus: "pending",
      toolTitle: "package.json",
    })

    const longSummary = buildTranscriptRows(state.nodes)[0]?.text ?? ""
    const shortSummary = buildTranscriptRows(shortState.nodes)[0]?.text ?? ""
    expect(longSummary).toContain("exa_web_search_exa document…")
    expect(shortSummary).toContain("package.json")
    expect(longSummary.indexOf("search · 1")).toBe(shortSummary.indexOf("read · 1"))
  })

  test("expanded tool burst keeps grouped history available", () => {
    let now = 1_000
    const currentTimeMs = () => now
    let state = createTranscriptState(currentTimeMs)
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "search pending: grep normalizeSessionUpdate",
      toolCallId: "search-1",
      toolKind: "search",
      toolStatus: "pending",
      toolTitle: "grep normalizeSessionUpdate",
    })
    now = 1_250
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "completed",
      toolCallId: "search-1",
      toolStatus: "completed",
    })
    state = toggleLatestToolBurstExpansion(state)

    const block = state.nodes[0]?.blocks[0]
    expect(block).toMatchObject({ type: "tool-burst", expanded: true })

    const rowText = buildTranscriptRows(state.nodes).map((row) => row.text).join("\n")
    expect(rowText).toContain("Tool history")
    expect(rowText).toContain("1 call")
    expect(rowText).toContain("search  done  grep normalizeSessionUpdate  0.3s")
  })

  test("expanded tool burst keeps target text and duration columns", () => {
    let now = 10_000
    const currentTimeMs = () => now
    let state = createTranscriptState(currentTimeMs)
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "shell pending: npm test -- src/ui/transcript.test.ts",
      toolCallId: "shell-1",
      toolKind: "shell",
      toolStatus: "pending",
      toolTitle: "npm test -- src/ui/transcript.test.ts",
    })
    now = 11_600
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "completed",
      toolCallId: "shell-1",
      toolStatus: "completed",
    })
    state = toggleLatestToolBurstExpansion(state)

    const rowText = buildTranscriptRows(state.nodes).map((row) => row.text).join("\n")
    expect(rowText).toContain("shell   done  npm test -- src/ui/transcript.test.ts  1.6s")
  })

  test("finishing an assistant turn closes the active tool burst", () => {
    let state = createTranscriptState()
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "read pending: package.json",
      toolCallId: "read-1",
      toolKind: "read",
      toolStatus: "pending",
      toolTitle: "package.json",
    })
    state = finishAgentMessage(state)
    state = appendTranscriptEntry(state, {
      kind: "tool",
      text: "read pending: tsconfig.json",
      toolCallId: "read-2",
      toolKind: "read",
      toolStatus: "pending",
      toolTitle: "tsconfig.json",
    })

    expect(state.nodes).toHaveLength(2)
  })
})
