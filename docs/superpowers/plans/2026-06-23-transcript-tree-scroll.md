# Transcript Tree Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor AgentClientTUI's transcript into a structured, natively scrollable OpenTUI transcript that handles long and streaming content without breaking layout.

**Architecture:** Add a focused transcript model that stores stable message nodes and active assistant stream state. Render those nodes inside an OpenTUI `ScrollBoxRenderable` with bottom stickiness, viewport culling, and native wrapped `Text` bodies. Keep scroll keys always active unless panel or command UI consumes them first.

**Tech Stack:** TypeScript, Bun test runner, OpenTUI `@opentui/core`, JSON-RPC ACP client flow

**References:**
- Design Spec: `docs/superpowers/specs/2026-06-23-transcript-tree-scroll-design.md`
- Existing UI: `src/ui.ts`
- Existing view model tests: `src/ui/view.test.ts`
- OpenTUI docs: `ScrollBoxRenderable`, `TextRenderable.wrapMode`

**Repo Note:** Do not commit during implementation unless the user explicitly requests it.

---

## File Structure

- Create: `src/ui/transcript.ts`
  - Owns transcript node/block types, state mutation helpers, labels/colors, and text fallback flattening.
- Create: `src/ui/transcript.test.ts`
  - Tests append, stream update, finish, fallback rows, and error/status behavior.
- Modify: `src/ui/view.ts`
  - Keep input handling and theme. Move transcript row formatting to `src/ui/transcript.ts` or re-export compatibility helpers.
- Modify: `src/ui/view.test.ts`
  - Update imports if transcript formatting moves.
- Modify: `src/ui.ts`
  - Replace flat transcript array with transcript state. Render interactive transcript using native `ScrollBoxRenderable`. Add always-active scroll key routing. Add `finishAgentMessage()` to UI API.
- Modify: `src/index.ts`
  - Call `ui.finishAgentMessage()` when `client.prompt(...)` resolves for normal transcript prompts.

---

### Task 1: Transcript Model

**Files:**
- Create: `src/ui/transcript.ts`
- Create: `src/ui/transcript.test.ts`
- Modify: `src/ui/view.ts`
- Modify: `src/ui/view.test.ts`

- [ ] **Step 1: Write failing transcript model tests**

Create `src/ui/transcript.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import {
  appendTranscriptEntry,
  buildTranscriptRows,
  createTranscriptState,
  finishAgentMessage,
  opencodeTranscriptTheme,
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
})
```

- [ ] **Step 2: Run model tests to verify failure**

Run: `npm run test -- src/ui/transcript.test.ts`

Expected: FAIL because `src/ui/transcript.ts` does not exist.

- [ ] **Step 3: Implement transcript model**

Create `src/ui/transcript.ts`:

```typescript
export type TranscriptKind = "user" | "agent" | "status" | "error" | "log"

export type TranscriptEntry = {
  kind: TranscriptKind
  text: string
}

export type TranscriptBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "status"; text: string }

export type TranscriptNode = {
  id: string
  kind: TranscriptKind
  blocks: TranscriptBlock[]
}

export type TranscriptState = {
  nodes: TranscriptNode[]
  nextNodeId: number
  nextBlockId: number
  activeAgentNodeId?: string
}

export type TranscriptRow = {
  label: string
  text: string
  color: string
}

export const opencodeTranscriptTheme = {
  background: "#0a0a0a",
  backgroundPanel: "#141414",
  backgroundElement: "#1e1e1e",
  border: "#484848",
  borderActive: "#606060",
  borderSubtle: "#3c3c3c",
  primary: "#fab283",
  secondary: "#5c9cf5",
  accent: "#9d7cd8",
  success: "#7fd88f",
  error: "#e06c75",
  warning: "#f5a742",
  info: "#56b6c2",
  text: "#eeeeee",
  textMuted: "#808080",
} as const

export function createTranscriptState(): TranscriptState {
  return { nodes: [], nextNodeId: 1, nextBlockId: 1 }
}

export function appendTranscriptEntry(state: TranscriptState, entry: TranscriptEntry): TranscriptState {
  const nodeId = `node-${state.nextNodeId}`
  const blockId = `block-${state.nextBlockId}`
  const node: TranscriptNode = {
    id: nodeId,
    kind: entry.kind,
    blocks: [{ id: blockId, type: "text", text: entry.text }],
  }

  return {
    ...state,
    nodes: [...state.nodes, node],
    nextNodeId: state.nextNodeId + 1,
    nextBlockId: state.nextBlockId + 1,
    activeAgentNodeId: entry.kind === "agent" ? nodeId : state.activeAgentNodeId,
  }
}

export function updateActiveAgentMessage(state: TranscriptState, text: string): TranscriptState {
  if (!state.activeAgentNodeId) return state

  return {
    ...state,
    nodes: state.nodes.map((node) => {
      if (node.id !== state.activeAgentNodeId || node.kind !== "agent") return node
      const [firstBlock, ...rest] = node.blocks
      if (!firstBlock || firstBlock.type !== "text") return node
      return { ...node, blocks: [{ ...firstBlock, text }, ...rest] }
    }),
  }
}

export function finishAgentMessage(state: TranscriptState): TranscriptState {
  if (!state.activeAgentNodeId) return state
  return { ...state, activeAgentNodeId: undefined }
}

export function getTranscriptLabel(kind: TranscriptKind): { label: string; color: string } {
  switch (kind) {
    case "user":
      return { label: "● user", color: opencodeTranscriptTheme.success }
    case "agent":
      return { label: "◆ assistant", color: opencodeTranscriptTheme.primary }
    case "status":
      return { label: "● status", color: opencodeTranscriptTheme.secondary }
    case "error":
      return { label: "× error", color: opencodeTranscriptTheme.error }
    case "log":
      return { label: "· log", color: opencodeTranscriptTheme.textMuted }
  }
}

export function buildTranscriptRows(nodes: TranscriptNode[]): TranscriptRow[] {
  return nodes.flatMap((node) => {
    const { label, color } = getTranscriptLabel(node.kind)
    return node.blocks.map((block) => ({ label, text: block.text, color }))
  })
}
```

To keep existing `src/ui/view.test.ts` and text fallback callers green during this task, implement a compatibility wrapper that accepts both old entries and new nodes:

```typescript
function isTranscriptNode(item: TranscriptNode | TranscriptEntry): item is TranscriptNode {
  return "blocks" in item
}

export function buildTranscriptRows(items: Array<TranscriptNode | TranscriptEntry>): TranscriptRow[] {
  return items.flatMap((item) => {
    const { label, color } = getTranscriptLabel(item.kind)
    if (!isTranscriptNode(item)) return [{ label, text: item.text, color }]
    return item.blocks.map((block) => ({ label, text: block.text, color }))
  })
}
```

- [ ] **Step 4: Update `view.ts` compatibility exports**

Modify `src/ui/view.ts`:

```typescript
export {
  buildTranscriptRows,
  opencodeTranscriptTheme as opencodeTheme,
  type TranscriptEntry,
  type TranscriptKind,
  type TranscriptRow,
} from "./transcript"
```

Keep `InputBar`, `handleInputKey`, and input-related exports in `view.ts`.

- [ ] **Step 5: Run transcript and view tests**

Run: `npm run test -- src/ui/transcript.test.ts src/ui/view.test.ts`

Expected: PASS.

---

### Task 2: UI API Stream Finalization

**Files:**
- Modify: `src/ui.ts`
- Modify: `src/index.ts`
- Modify: `src/ui/transcript.test.ts`

- [ ] **Step 1: Add UI API method type**

Modify `AgentClientUi` in `src/ui.ts`:

```typescript
finishAgentMessage(): void
```

- [ ] **Step 2: Wire interactive UI to transcript state**

Replace the flat transcript declaration in `createAgentClientUi`:

```typescript
let transcript = createTranscriptState()
```

Update return methods:

```typescript
append(entry) {
  transcript = appendTranscriptEntry(transcript, entry)
  render()
},
updateLast(text) {
  transcript = updateActiveAgentMessage(transcript, text)
  render()
},
finishAgentMessage() {
  transcript = finishAgentMessage(transcript)
},
```

Use an alias import if needed to avoid name collision:

```typescript
import { finishAgentMessage as finishTranscriptAgentMessage } from "./ui/transcript"
```

Do not call `syncTranscript()` in this task. Native scroll rendering is introduced in Task 3. Task 2 should still typecheck with the current row-based renderer by deriving rows from `transcript.nodes`.

- [ ] **Step 3: Wire text UI fallback**

In `createTextUi`, add:

```typescript
finishAgentMessage() {},
```

Keep text fallback `append` using `buildTranscriptRows` with a one-node temporary state or a helper from `transcript.ts`.

- [ ] **Step 4: Finalize stream in `index.ts`**

In the normal prompt path, call `ui.finishAgentMessage()` in a `finally` block around `client.prompt(...)`:

```typescript
try {
  await client.prompt(sessionId, prompt)
} finally {
  ui.finishAgentMessage()
}
```

For panel commands, also clear normal transcript stream state defensively in `finally`. Panel content is routed separately, so this should be a no-op unless an agent transcript stream was started.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run test -- src/ui/transcript.test.ts src/ui/view.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

---

### Task 3: Native ScrollBox Transcript Rendering

**Files:**
- Modify: `src/ui.ts`
- Modify: `src/ui/transcript.ts`

- [ ] **Step 1: Import OpenTUI renderables and transcript helpers**

Add needed imports in `src/ui.ts`:

```typescript
import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type Renderable,
} from "@opentui/core"
import { getTranscriptLabel, type TranscriptNode } from "./ui/transcript"
```

- [ ] **Step 2: Create transcript scroll references**

Inside `createAgentClientUi`, define refs:

```typescript
let transcriptScroll: ScrollBoxRenderable | undefined
let transcriptContentVersion = 0
let renderedTranscriptVersion = -1
```

Increment `transcriptContentVersion` in `append` and `updateLast` after model mutation.

- [ ] **Step 3: Add transcript renderable builder**

Add local helper in `createAgentClientUi`:

```typescript
function buildTranscriptMessage(node: TranscriptNode): Renderable {
  const { label, color } = getTranscriptLabel(node.kind)
  const row = new BoxRenderable(renderer, {
    id: `transcript-${node.id}`,
    flexDirection: "row",
    width: "100%",
    gap: 1,
  })
  row.add(new TextRenderable(renderer, {
    id: `transcript-${node.id}-label`,
    content: label.padEnd(12),
    fg: color,
    width: 13,
    wrapMode: "none",
    selectable: false,
  }))

  const body = new BoxRenderable(renderer, {
    id: `transcript-${node.id}-body`,
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  })

  for (const block of node.blocks) {
    body.add(new TextRenderable(renderer, {
      id: `transcript-${node.id}-${block.id}`,
      content: block.text,
      fg: opencodeTheme.text,
      width: "100%",
      wrapMode: "word",
    }))
  }

  row.add(body)
  return row
}
```

- [ ] **Step 4: Add sync helper**

Add local helper:

```typescript
function syncTranscript(): void {
  if (!transcriptScroll) return
  if (renderedTranscriptVersion === transcriptContentVersion) return

  for (const child of transcriptScroll.getChildren()) {
    transcriptScroll.remove(child.id)
  }

  for (const node of transcript.nodes) {
    transcriptScroll.add(buildTranscriptMessage(node))
  }

  renderedTranscriptVersion = transcriptContentVersion
}
```

If removing children by iterating live children causes skipped nodes, copy first:

```typescript
for (const child of [...transcriptScroll.getChildren()]) {
  transcriptScroll.remove(child.id)
}
```

- [ ] **Step 5: Replace transcript rows in render tree**

Replace the `...rows.map(...)` transcript area with a persistent native scroll box. The simplest safe path is to create or reuse `transcriptScroll` before building the transcript panel:

```typescript
if (!transcriptScroll) {
  transcriptScroll = new ScrollBoxRenderable(renderer, {
    id: "transcript-scroll",
    flexGrow: 1,
    width: "100%",
    scrollY: true,
    scrollX: false,
    stickyScroll: true,
    stickyStart: "bottom",
    viewportCulling: true,
    verticalScrollbarOptions: {
      showArrows: false,
    },
  })
}
syncTranscript()
```

Then include `transcriptScroll` after the transcript title:

```typescript
Box(
  { flexDirection: "column", flexGrow: 1, width: "100%" },
  Text({ content: "transcript", fg: opencodeTheme.textMuted }),
  transcriptScroll,
)
```

If OpenTUI disallows reusing a renderable after parent removal, switch this task to a fully persistent transcript panel: create the panel once outside `render()` and update its children in place.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

---

### Task 4: Always-Active Scroll Keys

**Files:**
- Modify: `src/ui.ts`
- Modify: `src/ui/transcript.ts`
- Modify: `src/ui/transcript.test.ts`

- [ ] **Step 1: Add failing scroll action tests**

Extend `src/ui/transcript.test.ts`:

```typescript
import { getTranscriptScrollAction } from "./transcript"

test("maps always-active transcript scroll keys", () => {
  expect(getTranscriptScrollAction("pageup")).toBe("page-up")
  expect(getTranscriptScrollAction("pagedown")).toBe("page-down")
  expect(getTranscriptScrollAction("home")).toBe("top")
  expect(getTranscriptScrollAction("end")).toBe("bottom")
  expect(getTranscriptScrollAction("a")).toBeNull()
})
```

- [ ] **Step 2: Run scroll action test to verify failure**

Run: `npm run test -- src/ui/transcript.test.ts`

Expected: FAIL because `getTranscriptScrollAction` does not exist.

- [ ] **Step 3: Implement scroll action helper**

Add to `src/ui/transcript.ts`:

```typescript
export type TranscriptScrollAction = "page-up" | "page-down" | "top" | "bottom"

export function getTranscriptScrollAction(keyName: string): TranscriptScrollAction | null {
  switch (keyName) {
    case "pageup":
      return "page-up"
    case "pagedown":
      return "page-down"
    case "home":
      return "top"
    case "end":
      return "bottom"
    default:
      return null
  }
}
```

- [ ] **Step 4: Add transcript scroll key helper**

Inside `createAgentClientUi`, add:

```typescript
function handleTranscriptScrollKey(key: KeyEvent): boolean {
  if (!transcriptScroll) return false
  const action = getTranscriptScrollAction(key.name)

  if (action === "page-up") {
    transcriptScroll.scrollBy(-1, "viewport")
    return true
  }
  if (action === "page-down") {
    transcriptScroll.scrollBy(1, "viewport")
    return true
  }
  if (action === "top") {
    transcriptScroll.scrollTo({ y: 0 })
    return true
  }
  if (action === "bottom") {
    transcriptScroll.scrollTo({ y: transcriptScroll.scrollHeight })
    transcriptScroll.stickyScroll = true
    transcriptScroll.stickyStart = "bottom"
    return true
  }

  return false
}
```

If OpenTUI emits different key names for PageUp/PageDown, adjust based on observed `KeyEvent.name` values.

- [ ] **Step 5: Place scroll routing after higher-priority UI**

In `renderer.keyInput.on("keypress", ...)`, preserve this priority:

1. Ctrl+C exit handling.
2. Ctrl+P palette open.
3. Esc panel close.
4. Command state handling.
5. Transcript scroll key handling.
6. Normal input handling.

Add before `handleInputKey`:

```typescript
if (handleTranscriptScrollKey(key)) {
  pendingExit = false
  render()
  return
}
```

- [ ] **Step 6: Keep command UI priority**

Verify the existing command-state branch remains before transcript scroll routing so dropdown/palette arrow and selection keys still work. PageUp/PageDown can be consumed by transcript only when command state is idle unless command UI later implements them.

Also verify panel overlay handling remains before transcript scroll routing. With a panel open, Esc closes the panel and transcript scroll keys should not interfere with panel-specific key behavior added later.

- [ ] **Step 7: Run tests and typecheck**

Run: `npm run test -- src/ui/transcript.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

---

### Task 5: Integration Tests and Smoke Checks

**Files:**
- Modify: `src/ui/transcript.test.ts`
- Modify: `scripts/smoke.ts` only if smoke expectations break.

- [ ] **Step 1: Add tests for empty update and multiple stream cycles**

Extend `src/ui/transcript.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run all unit tests**

Run: `npm run test`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Run smoke test**

Run: `npm run smoke`

Expected: PASS. If smoke checks exact transcript output and fails due to expected labels/stream finalization, update only expectations that changed intentionally.

---

### Task 6: Manual Verification

**Files:**
- No file changes expected.

- [ ] **Step 1: Start mock app**

Run: `npm run dev`

Expected: TUI opens with transcript panel, input bar, and session sidebar.

- [ ] **Step 2: Verify normal short prompt**

Type a prompt and press Enter.

Expected: User message appears, assistant response streams below it, input remains pinned.

- [ ] **Step 3: Verify long content wrapping**

Paste or type a long prompt, then press Enter.

Expected: User and assistant text wrap inside transcript body. No horizontal layout break.

- [ ] **Step 4: Verify keyboard scroll**

Create enough transcript content to exceed the viewport. Press PageUp, PageDown, Home, and End.

Expected: Transcript scrolls globally while command UI is closed. End returns to latest content.

- [ ] **Step 5: Verify command UI priority**

Open `/` dropdown or `Ctrl+P` palette and press keys used by command UI.

Expected: Command UI behavior wins. Transcript does not steal command navigation keys.

- [ ] **Step 6: Verify streaming while scrolled up**

Scroll up during an assistant response if feasible.

Expected: Manual scroll position remains stable. Press End to rejoin bottom-follow behavior.

- [ ] **Step 7: Verify resize**

Resize terminal smaller and larger.

Expected: Transcript remains clipped inside panel and text rewraps to available width.
