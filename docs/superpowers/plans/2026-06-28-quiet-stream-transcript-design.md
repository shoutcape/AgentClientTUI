# Quiet Stream Transcript Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interactive transcript role gutter with quiet assistant prose and compact event-strip surfaces for non-assistant entries.

**Architecture:** Keep the transcript data model and text-mode fallback unchanged. Update only the OpenTUI renderer in `src/ui/transcript-renderer.ts`, then use an exported helper from that renderer so `src/ui.ts` tracks the active assistant text renderable by stable ID instead of child position.

**Tech Stack:** TypeScript, Bun test runner, OpenTUI `@opentui/core`, existing `createTestRenderer` e2e tests.

---

## File Structure

- Modify: `src/ui/transcript-renderer.ts`
- Modify: `src/ui.ts`
- Modify: `src/ui/e2e.test.ts`

Do not modify `src/ui/transcript.ts`, `src/ui/text-ui.ts`, or `src/ui/view.ts` unless implementation reveals a type error that cannot be solved in the renderer. The text-mode fallback must keep using `buildTranscriptRows` and the existing labels.

---

### Task 1: Add Failing E2E Coverage For Quiet Transcript Surfaces

**Files:**
- Modify: `src/ui/e2e.test.ts`

- [ ] **Step 1: Import `TextRenderable` in e2e tests**

Change the OpenTUI import at the top of `src/ui/e2e.test.ts` from:

```ts
import { BoxRenderable, createCliRenderer, ScrollBoxRenderable } from "@opentui/core"
```

to:

```ts
import { BoxRenderable, createCliRenderer, ScrollBoxRenderable, TextRenderable } from "@opentui/core"
```

- [ ] **Step 2: Add renderable color helper**

Add this helper after `createMockCommandRegistry()`:

```ts
function renderableColor(renderable: unknown, key: "backgroundColor" | "fg"): string | undefined {
  return (renderable as Record<"backgroundColor" | "fg", string | undefined>)[key]
}
```

- [ ] **Step 3: Add quiet surface structure test**

Add this test after `renders ACP output transcript kinds`:

```ts
  test("interactive transcript omits role gutters and renders event strip surfaces", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      ui.append({ kind: "user", text: "inspect repo" })
      ui.append({ kind: "agent", text: "assistant prose" })
      ui.append({ kind: "tool", text: "read completed" })
      ui.append({ kind: "error", text: "failed to render" })
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("inspect repo")
      expect(frame).toContain("assistant prose")
      expect(frame).toContain("read completed")
      expect(frame).toContain("failed to render")
      expect(frame).not.toContain("● user")
      expect(frame).not.toContain("◆ assistant")
      expect(frame).not.toContain("◦ tool")
      expect(frame).not.toContain("× error")

      const assistantText = testRenderer.renderer.root.findDescendantById("transcript-node-2-text-block-2")
      expect(assistantText).toBeInstanceOf(TextRenderable)

      const userSurface = testRenderer.renderer.root.findDescendantById("transcript-node-1-event-block-1")
      const userStrip = testRenderer.renderer.root.findDescendantById("transcript-node-1-strip-block-1")
      expect(userSurface).toBeDefined()
      expect(userStrip).toBeDefined()
      expect(renderableColor(userSurface, "backgroundColor")).toBe("#102018")
      expect(renderableColor(userStrip, "backgroundColor")).toBe("#7fd88f")

      const toolSurface = testRenderer.renderer.root.findDescendantById("transcript-node-3-event-block-3")
      const toolStrip = testRenderer.renderer.root.findDescendantById("transcript-node-3-strip-block-3")
      expect(toolSurface).toBeDefined()
      expect(toolStrip).toBeDefined()
      expect(renderableColor(toolSurface, "backgroundColor")).toBe("#10191b")
      expect(renderableColor(toolStrip, "backgroundColor")).toBe("#56b6c2")

      const errorSurface = testRenderer.renderer.root.findDescendantById("transcript-node-4-event-block-4")
      const errorStrip = testRenderer.renderer.root.findDescendantById("transcript-node-4-strip-block-4")
      const errorText = testRenderer.renderer.root.findDescendantById("transcript-node-4-text-block-4")
      expect(errorSurface).toBeDefined()
      expect(errorStrip).toBeDefined()
      expect(errorText).toBeInstanceOf(TextRenderable)
      expect(renderableColor(errorSurface, "backgroundColor")).toBe("#2a1114")
      expect(renderableColor(errorStrip, "backgroundColor")).toBe("#e06c75")
      expect(renderableColor(errorText, "fg")).toBe("#e06c75")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 4: Update ACP transcript kind expectations**

In `renders ACP output transcript kinds`, replace the old label assertions:

```ts
      expect(frame).toContain("□ plan")
      expect(frame).toContain("[completed] Inspect workspace")
      expect(frame).toContain("◇ thought")
      expect(frame).toContain("◦ tool")
      expect(frame).toContain("code ts")
      expect(frame).toContain("diff src/example.ts")
      expect(frame).toContain("- const before = 1")
      expect(frame).toContain("+ const after = 2")
      expect(frame).toContain("↯ usage")
```

with:

```ts
      expect(frame).toContain("[completed] Inspect workspace")
      expect(frame).toContain("Thinking through mock output types.")
      expect(frame).toContain("read completed: Found package metadata.")
      expect(frame).toContain("code ts")
      expect(frame).toContain("diff src/example.ts")
      expect(frame).toContain("- const before = 1")
      expect(frame).toContain("+ const after = 2")
      expect(frame).toContain("usage 53000/200000 tokens, 0.045 USD")
      expect(frame).not.toContain("□ plan")
      expect(frame).not.toContain("◇ thought")
      expect(frame).not.toContain("◦ tool")
      expect(frame).not.toContain("↯ usage")
```

- [ ] **Step 5: Update active stream e2e assertion**

In `updateLast updates the active agent row in place`, replace:

```ts
      expect(frame.match(/◆ assistant/g)?.length ?? 0).toBe(1)
```

with:

```ts
      expect(frame).not.toContain("◆ assistant")
      expect(frame.match(/stream-final-token/g)?.length ?? 0).toBe(1)
      expect(testRenderer.renderer.root.findDescendantById("transcript-node-1-text-block-1")).toBeInstanceOf(TextRenderable)
```

- [ ] **Step 6: Update stream mutation diagnostics tests to use stable text ID**

In `records stream update context when text mutation throws`, replace the child-position lookup:

```ts
      const transcriptScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
      const nodeBox = transcriptScroll?.getChildren()[0] as { getChildren(): unknown[] } | undefined
      const row = nodeBox?.getChildren()[0] as { getChildren(): unknown[] } | undefined
      const textRenderable = row?.getChildren()[1] as object | undefined
```

with:

```ts
      const textRenderable = testRenderer.renderer.root.findDescendantById("transcript-node-1-text-block-1") as object | undefined
```

Make the same replacement in `does not retry a failed stream mutation through the active stream fast path`.

- [ ] **Step 7: Run focused e2e tests and confirm failure**

Run:

```bash
bun test src/ui/e2e.test.ts
```

Expected: FAIL. The renderer still emits old role labels, lacks `event` and `strip` IDs, and active assistant text is still exposed through the old row/body shape.

- [ ] **Step 8: Commit failing tests**

```bash
git add src/ui/e2e.test.ts
git commit -m "test: cover quiet transcript surfaces"
```

---

### Task 2: Implement Quiet Stream Surfaces In The Renderer

**Files:**
- Modify: `src/ui/transcript-renderer.ts`
- Test: `src/ui/e2e.test.ts`

- [ ] **Step 1: Update transcript renderer imports**

Change the transcript import in `src/ui/transcript-renderer.ts` from:

```ts
import {
  getTranscriptLabel,
  opencodeTranscriptTheme,
  type TranscriptBlock,
  type TranscriptNode,
} from "./transcript"
```

to:

```ts
import {
  opencodeTranscriptTheme,
  type TranscriptBlock,
  type TranscriptKind,
  type TranscriptNode,
} from "./transcript"
```

- [ ] **Step 2: Add quiet surface mapping and stable ID helpers**

Add this after `type BuildTranscriptMessageOptions`:

```ts
type TranscriptSurfaceTreatment = "plain" | "event" | "muted-event" | "strong-event"

type TranscriptSurface = {
  treatment: TranscriptSurfaceTreatment
  fg: string
  strip?: string
  background?: string
}

const quietTranscriptSurfaces: Record<TranscriptKind, TranscriptSurface> = {
  agent: { treatment: "plain", fg: opencodeTranscriptTheme.text },
  user: { treatment: "event", fg: opencodeTranscriptTheme.text, strip: opencodeTranscriptTheme.success, background: "#102018" },
  tool: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.info, background: "#10191b" },
  status: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.secondary, background: "#111826" },
  log: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.textMuted, background: "#111111" },
  thought: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.accent, background: "#15111e" },
  plan: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.secondary, background: "#111826" },
  usage: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.warning, background: "#211a10" },
  error: { treatment: "strong-event", fg: opencodeTranscriptTheme.error, strip: opencodeTranscriptTheme.error, background: "#2a1114" },
}

function getTranscriptSurface(kind: TranscriptKind): TranscriptSurface {
  return quietTranscriptSurfaces[kind]
}

function transcriptBlockKey(block: TranscriptBlock, blockIndex: number): string {
  return block.id ?? String(blockIndex)
}

function transcriptTextId(nodeId: string, blockKey: string): string {
  return `transcript-${nodeId}-text-${blockKey}`
}

function transcriptEventId(nodeId: string, blockKey: string): string {
  return `transcript-${nodeId}-event-${blockKey}`
}

function transcriptStripId(nodeId: string, blockKey: string): string {
  return `transcript-${nodeId}-strip-${blockKey}`
}

function transcriptEventBodyId(nodeId: string, blockKey: string): string {
  return `transcript-${nodeId}-event-body-${blockKey}`
}

export function getTranscriptActiveTextRenderable(message: Renderable, node: TranscriptNode): TextRenderable | null {
  const [firstBlock] = node.blocks
  if (!firstBlock || firstBlock.type !== "text") return null

  const findDescendantById = (message as { findDescendantById?: (id: string) => unknown }).findDescendantById
  const renderable = findDescendantById?.call(message, transcriptTextId(node.id, transcriptBlockKey(firstBlock, 0)))
  return renderable instanceof TextRenderable ? renderable : null
}
```

- [ ] **Step 3: Replace `buildTranscriptLabel` with plain and event surface helpers**

Delete the existing `buildTranscriptLabel` function and replace it with:

```ts
function buildPlainTextSurface(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: Extract<TranscriptBlock, { type: "text" | "status" }>,
  blockIndex: number,
  surface: TranscriptSurface,
  wrapMode: "word" | "none" = "word",
  options?: BuildTranscriptMessageOptions,
): Renderable {
  return buildWithOptionalContext(options, {
    phase: "buildPlainTextSurface.text",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "TextRenderable",
    text: summarizeText(block.text),
  }, () => new TextRenderable(renderer, {
    id: transcriptTextId(node.id, transcriptBlockKey(block, blockIndex)),
    content: block.text,
    fg: surface.fg,
    width: "100%",
    wrapMode,
  }))
}

function buildEventStripSurface(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: Extract<TranscriptBlock, { type: "text" | "status" }>,
  blockIndex: number,
  surface: TranscriptSurface,
  wrapMode: "word" | "none" = "word",
  options?: BuildTranscriptMessageOptions,
): Renderable {
  const blockKey = transcriptBlockKey(block, blockIndex)
  const event = new BoxRenderable(renderer, {
    id: transcriptEventId(node.id, blockKey),
    flexDirection: "row",
    width: "100%",
    backgroundColor: surface.background,
  })

  buildWithOptionalContext(options, {
    phase: "buildEventStripSurface.strip",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "BoxRenderable",
  }, () => {
    event.add(new BoxRenderable(renderer, {
      id: transcriptStripId(node.id, blockKey),
      width: 1,
      flexShrink: 0,
      backgroundColor: surface.strip,
    }))
  })

  const body = new BoxRenderable(renderer, {
    id: transcriptEventBodyId(node.id, blockKey),
    flexDirection: "column",
    flexGrow: 1,
    paddingLeft: 1,
    paddingRight: 1,
  })

  buildWithOptionalContext(options, {
    phase: "buildEventStripSurface.text",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "TextRenderable",
    text: summarizeText(block.text),
  }, () => {
    body.add(new TextRenderable(renderer, {
      id: transcriptTextId(node.id, blockKey),
      content: block.text,
      fg: surface.fg,
      width: "100%",
      wrapMode,
    }))
  })

  buildWithOptionalContext(options, {
    phase: "buildEventStripSurface.body",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "BoxRenderable",
  }, () => {
    event.add(body)
  })

  return event
}

function buildCodeMetadata(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: TranscriptBlock,
  blockIndex: number,
  text: string,
  surface: TranscriptSurface,
  options?: BuildTranscriptMessageOptions,
): Renderable {
  return buildWithOptionalContext(options, {
    phase: "buildCodeMetadata.text",
    nodeId: node.id,
    kind: node.kind,
    ...(block.id ? { blockId: block.id } : {}),
    blockType: block.type,
    blockIndex,
    renderable: "TextRenderable",
    text: summarizeText(text),
  }, () => new TextRenderable(renderer, {
    id: `transcript-${node.id}-metadata-${transcriptBlockKey(block, blockIndex)}`,
    content: text,
    fg: surface.fg,
    width: "100%",
    wrapMode: "none",
    selectable: false,
  }))
}
```

- [ ] **Step 4: Update `buildTranscriptBlock` signature and code path**

Change the signature from:

```ts
function buildTranscriptBlock(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: TranscriptBlock,
  blockIndex: number,
  label: string,
  color: string,
  options?: BuildTranscriptMessageOptions,
): Renderable {
```

to:

```ts
function buildTranscriptBlock(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: TranscriptBlock,
  blockIndex: number,
  surface: TranscriptSurface,
  options?: BuildTranscriptMessageOptions,
): Renderable {
```

Inside the `code` branch, replace the metadata row add:

```ts
      group.add(buildTranscriptLabel(renderer, node, blockIndex, label, color, block.language ? `code ${block.language}` : "code", "none", options))
```

with:

```ts
      group.add(buildCodeMetadata(renderer, node, block, blockIndex, block.language ? `code ${block.language}` : "code", surface, options))
```

Inside the `diff` branch, replace the metadata row add:

```ts
      group.add(buildTranscriptLabel(renderer, node, blockIndex, label, color, block.path ? `diff ${block.path}` : "diff", "none", options))
```

with:

```ts
      group.add(buildCodeMetadata(renderer, node, block, blockIndex, block.path ? `diff ${block.path}` : "diff", surface, options))
```

Replace the final return:

```ts
  return buildTranscriptLabel(renderer, node, blockIndex, label, color, block.text, "word", options)
```

with:

```ts
  return surface.treatment === "plain"
    ? buildPlainTextSurface(renderer, node, block, blockIndex, surface, "word", options)
    : buildEventStripSurface(renderer, node, block, blockIndex, surface, "word", options)
```

After the `code` and `diff` branches return, TypeScript narrows `block` to the existing `text | status` union members.

- [ ] **Step 5: Update `buildTranscriptMessage` to stop using labels**

Replace the beginning of `buildTranscriptMessage`:

```ts
export function buildTranscriptMessage(renderer: CliRenderer, node: TranscriptNode, options?: BuildTranscriptMessageOptions): Renderable {
  const { label, color } = getTranscriptLabel(node.kind)
  const nodeBox = buildWithOptionalContext(options, {
```

with:

```ts
export function buildTranscriptMessage(renderer: CliRenderer, node: TranscriptNode, options?: BuildTranscriptMessageOptions): Renderable {
  const surface = getTranscriptSurface(node.kind)
  const nodeBox = buildWithOptionalContext(options, {
```

In the node box options, replace:

```ts
    gap: 1,
    marginBottom: 1,
    ...(node.kind === "tool"
      ? { backgroundColor: "#101010", padding: 1 }
      : {}),
```

with:

```ts
    gap: 1,
    marginBottom: 1,
```

Replace the block add call:

```ts
      nodeBox.add(buildTranscriptBlock(renderer, node, block, index, label, color, options))
```

with:

```ts
      nodeBox.add(buildTranscriptBlock(renderer, node, block, index, surface, options))
```

- [ ] **Step 6: Run focused e2e tests and confirm renderer failures are reduced**

Run:

```bash
bun test src/ui/e2e.test.ts
```

Expected: most quiet-surface assertions pass. Stream tests may still fail until `src/ui.ts` uses `getTranscriptActiveTextRenderable` instead of child indexing.

- [ ] **Step 7: Commit renderer implementation**

```bash
git add src/ui/transcript-renderer.ts src/ui/e2e.test.ts
git commit -m "feat: render quiet transcript surfaces"
```

---

### Task 3: Track Active Assistant Text Through Renderer Helper

**Files:**
- Modify: `src/ui.ts`
- Test: `src/ui/e2e.test.ts`

- [ ] **Step 1: Import active text helper**

Change the transcript renderer import in `src/ui.ts` from:

```ts
import { buildTranscriptMessage } from "./ui/transcript-renderer"
```

to:

```ts
import { buildTranscriptMessage, getTranscriptActiveTextRenderable } from "./ui/transcript-renderer"
```

- [ ] **Step 2: Replace child-position active stream lookup**

In `syncTranscript`, replace:

```ts
      if (node.id === transcript.activeAgentNodeId && node.kind === "agent") {
        activeStreamNodeId = node.id
        const nodeBox = msg as BoxRenderable
        const children = nodeBox.getChildren()
        if (children.length > 0) {
          const row = children[0] as BoxRenderable
          const rowChildren = row.getChildren()
          if (rowChildren.length > 1 && rowChildren[1] instanceof TextRenderable) {
            activeStreamRenderable = rowChildren[1]
          }
        }
      }
```

with:

```ts
      if (node.id === transcript.activeAgentNodeId && node.kind === "agent") {
        activeStreamNodeId = node.id
        activeStreamRenderable = getTranscriptActiveTextRenderable(msg, node)
      }
```

- [ ] **Step 3: Remove unused imports if TypeScript reports them**

After the replacement, `TextRenderable` is still used by `activeStreamRenderable`. Remove `BoxRenderable` from the `@opentui/core` import if `bun run typecheck` reports it as unused.

- [ ] **Step 4: Run focused e2e tests and confirm pass**

Run:

```bash
bun test src/ui/e2e.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit active stream lookup**

```bash
git add src/ui.ts src/ui/e2e.test.ts
git commit -m "fix: track active transcript text by stable id"
```

---

### Task 4: Verify Text Fallback And Transcript Model Stay Unchanged

**Files:**
- Test: `src/ui/transcript.test.ts`
- Test: `src/ui/view.test.ts`
- Test: `src/ui/e2e.test.ts`

- [ ] **Step 1: Run transcript model tests**

Run:

```bash
bun test src/ui/transcript.test.ts
```

Expected: PASS. The `buildTranscriptRows` assertions still show labels such as `● user`, `◆ assistant`, and `· log`.

- [ ] **Step 2: Run view model tests**

Run:

```bash
bun test src/ui/view.test.ts
```

Expected: PASS. The text fallback contract still uses label-first rows.

- [ ] **Step 3: Run e2e text-mode fallback coverage**

Run:

```bash
bun test src/ui/e2e.test.ts
```

Expected: PASS, including `headless mode uses text UI output`, which must still contain `◆ assistant hello text mode`.

- [ ] **Step 4: Commit only if a test-only adjustment was needed**

If no files changed in this task, do not create a commit. If a test expectation needed a legitimate text-fallback clarification, commit it with:

```bash
git add src/ui/transcript.test.ts src/ui/view.test.ts src/ui/e2e.test.ts
git commit -m "test: preserve text transcript fallback"
```

---

### Task 5: Final Verification

**Files:**
- Verify repository state only

- [ ] **Step 1: Run required focused e2e test**

Run:

```bash
bun test src/ui/e2e.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect diff**

Run:

```bash
git diff -- src/ui/transcript-renderer.ts src/ui.ts src/ui/e2e.test.ts
```

Expected: only the quiet-stream rendering changes, active stream helper wiring, and tests are present. No transcript model or text fallback files changed.

---

## Self-Review

- Spec coverage: assistant prose becomes plain content, user/tool/status/log/thought/plan/usage/error use event strips, code and diff keep dedicated renderables, transcript frame and sidebar remain unchanged, text fallback remains labeled, and active streaming no longer depends on row/body child position.
- Placeholder scan: no placeholders remain in this plan.
- Type consistency: renderer IDs use `transcript-${node.id}-text-${blockKey}`, `transcript-${node.id}-event-${blockKey}`, and `transcript-${node.id}-strip-${blockKey}` consistently across tests, renderer helpers, and active stream lookup.
