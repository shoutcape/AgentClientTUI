# Render Error Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture enough structured evidence around `[render error] Failed to create TextBuffer` to identify the exact transcript node/block/renderable that caused it.

**Architecture:** Add a small diagnostics sink that writes JSONL under `tmp/render-errors/`, then wire render construction to maintain a current render context. On render failure, log stack, terminal size, status, transcript stats, recent app events, and the last render context before falling back to current stderr behavior.

**Tech Stack:** TypeScript, Bun tests, Node fs/path APIs, OpenTUI renderables, existing `createAgentClientUi` options.

---

## File Structure

- Create `src/ui/render-diagnostics.ts`: owns JSONL logging, redaction, string/block summaries, and a small recent-event ring buffer.
- Modify `src/ui.ts`: tracks render context while constructing transcript renderables and records render failures through diagnostics.
- Modify `src/index.ts`: creates diagnostics once and records app/transport/fatal events.
- Modify `src/ui/e2e.test.ts`: verifies UI render failures invoke diagnostics without crashing.
- Create `src/ui/render-diagnostics.test.ts`: verifies JSONL output, redaction, string summaries, and ring buffer behavior.

## Diagnostic Shape

Each render error log line should be one JSON object:

```ts
type RenderErrorRecord = {
  ts: string
  type: "render-error"
  message: string
  stack?: string
  agentLabel: string
  status: string
  terminal?: { columns?: number; rows?: number }
  transcript: {
    version: number
    renderedNodeCount: number
    nodeCount: number
    activeAgentNodeId?: string
  }
  context?: {
    phase: string
    nodeId?: string
    kind?: string
    blockId?: string
    blockType?: string
    blockIndex?: number
    renderable?: "TextRenderable" | "CodeRenderable" | "DiffRenderable" | "BoxRenderable" | "ScrollBoxRenderable"
    text?: { chars: number; lines: number; preview: string }
  }
  recentEvents: Array<{ ts: string; event: string; detail?: Record<string, unknown> }>
}
```

Do not write full transcript content by default. Store lengths, line counts, and a short preview. Redact home path, token-like keys, authorization headers, cookies, passwords, and secrets.

---

### Task 1: Add Diagnostics Module

**Files:**
- Create: `src/ui/render-diagnostics.ts`
- Test: `src/ui/render-diagnostics.test.ts`

- [ ] **Step 1: Write failing diagnostics tests**

Create `src/ui/render-diagnostics.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createRenderDiagnostics,
  redactDiagnosticValue,
  summarizeText,
} from "./render-diagnostics"

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

describe("render diagnostics", () => {
  test("summarizes long text without storing full content", () => {
    const summary = summarizeText("alpha\nbeta\n" + "x".repeat(200), 24)
    expect(summary.chars).toBe(211)
    expect(summary.lines).toBe(3)
    expect(summary.preview).toBe("alpha\\nbeta\\nxxxxxxxxxxxxx...")
  })

  test("redacts sensitive keys and home directory", () => {
    const value = redactDiagnosticValue({
      path: "/home/tester/project",
      token: "abc",
      nested: { Authorization: "Bearer secret", ok: "value" },
    }, "/home/tester")

    expect(value).toEqual({
      path: "$HOME/project",
      token: "[REDACTED]",
      nested: { Authorization: "[REDACTED]", ok: "value" },
    })
  })

  test("writes render error JSONL with recent event ring buffer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-client-tui-test-"))
    tempDirs.push(dir)
    const diagnostics = createRenderDiagnostics({ logDir: dir, agentLabel: "opencode acp", maxRecentEvents: 2 })

    diagnostics.recordEvent("first")
    diagnostics.recordEvent("second", { requestId: 1 })
    diagnostics.recordEvent("third")
    await diagnostics.recordRenderError(new Error("Failed to create TextBuffer"), {
      status: "prompting",
      terminal: { columns: 80, rows: 24 },
      transcript: { version: 7, renderedNodeCount: 3, nodeCount: 4, activeAgentNodeId: "node-4" },
      context: {
        phase: "buildTranscriptBlock",
        nodeId: "node-4",
        kind: "tool",
        blockType: "code",
        renderable: "CodeRenderable",
        text: summarizeText("const answer = 42"),
      },
    })

    const text = await readFile(diagnostics.logFile, "utf8")
    const [line] = text.trim().split("\n")
    const record = JSON.parse(line)

    expect(record.type).toBe("render-error")
    expect(record.message).toBe("Failed to create TextBuffer")
    expect(record.agentLabel).toBe("opencode acp")
    expect(record.recentEvents.map((event: { event: string }) => event.event)).toEqual(["second", "third"])
    expect(record.context.renderable).toBe("CodeRenderable")
  })
})
```

- [ ] **Step 2: Run the failing diagnostics tests**

Run:

```bash
npm run test -- src/ui/render-diagnostics.test.ts
```

Expected: fails because `src/ui/render-diagnostics.ts` does not exist.

- [ ] **Step 3: Implement diagnostics module**

Create `src/ui/render-diagnostics.ts`:

```ts
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

export type TextSummary = {
  chars: number
  lines: number
  preview: string
}

export type RenderContext = {
  phase: string
  nodeId?: string
  kind?: string
  blockId?: string
  blockType?: string
  blockIndex?: number
  renderable?: "TextRenderable" | "CodeRenderable" | "DiffRenderable" | "BoxRenderable" | "ScrollBoxRenderable"
  text?: TextSummary
}

export type RenderErrorSnapshot = {
  status: string
  terminal?: { columns?: number; rows?: number }
  transcript: {
    version: number
    renderedNodeCount: number
    nodeCount: number
    activeAgentNodeId?: string
  }
  context?: RenderContext
}

export type DiagnosticEvent = {
  ts: string
  event: string
  detail?: Record<string, unknown>
}

export type RenderDiagnostics = {
  logFile: string
  recordEvent(event: string, detail?: Record<string, unknown>): void
  recordRenderError(error: unknown, snapshot: RenderErrorSnapshot): Promise<void>
}

type RenderDiagnosticsOptions = {
  logDir?: string
  agentLabel?: string
  now?: () => Date
  maxRecentEvents?: number
  home?: string
}

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|cookie)/i

export function summarizeText(text: string, maxPreview = 160): TextSummary {
  const escaped = text.replaceAll("\n", "\\n").replaceAll("\r", "\\r")
  return {
    chars: text.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
    preview: escaped.length > maxPreview ? `${escaped.slice(0, maxPreview)}...` : escaped,
  }
}

export function redactDiagnosticValue(value: unknown, home = process.env.HOME): unknown {
  if (typeof value === "string") return home ? value.replaceAll(home, "$HOME") : value
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item, home))
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactDiagnosticValue(item, home),
  ]))
}

function timestampForFile(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}

export function createRenderDiagnostics(options: RenderDiagnosticsOptions = {}): RenderDiagnostics {
  const now = options.now ?? (() => new Date())
  const maxRecentEvents = options.maxRecentEvents ?? 50
  const logDir = options.logDir ?? join(process.cwd(), "tmp", "render-errors")
  const logFile = join(logDir, `${timestampForFile(now())}.jsonl`)
  const recentEvents: DiagnosticEvent[] = []

  return {
    logFile,
    recordEvent(event, detail) {
      recentEvents.push({ ts: now().toISOString(), event, ...(detail ? { detail } : {}) })
      if (recentEvents.length > maxRecentEvents) recentEvents.splice(0, recentEvents.length - maxRecentEvents)
    },
    async recordRenderError(error, snapshot) {
      const record = redactDiagnosticValue({
        ts: now().toISOString(),
        type: "render-error",
        message: errorMessage(error),
        stack: errorStack(error),
        agentLabel: options.agentLabel ?? "unknown",
        ...snapshot,
        recentEvents,
      }, options.home)

      await mkdir(logDir, { recursive: true })
      await appendFile(logFile, `${JSON.stringify(record)}\n`)
    },
  }
}
```

- [ ] **Step 4: Run diagnostics tests**

Run:

```bash
npm run test -- src/ui/render-diagnostics.test.ts
```

Expected: pass.

---

### Task 2: Wire Render Context Capture Into UI

**Files:**
- Modify: `src/ui.ts`
- Test: `src/ui/e2e.test.ts`

- [ ] **Step 1: Add failing e2e test for render error callback**

Append this test inside `describe("OpenTUI command e2e", ...)` in `src/ui/e2e.test.ts`:

```ts
  test("records render diagnostics when render throws", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const records: unknown[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
      diagnostics: {
        logFile: "test.jsonl",
        recordEvent() {},
        async recordRenderError(_error, snapshot) {
          records.push(snapshot)
        },
      },
    })

    const originalAdd = testRenderer.renderer.root.add.bind(testRenderer.renderer.root)
    let shouldThrow = true
    testRenderer.renderer.root.add = ((...args: Parameters<typeof testRenderer.renderer.root.add>) => {
      if (shouldThrow) {
        shouldThrow = false
        throw new Error("Failed to create TextBuffer")
      }
      return originalAdd(...args)
    }) as typeof testRenderer.renderer.root.add

    try {
      ui.append({ kind: "tool", blocks: [{ type: "code", language: "html", text: "<section>stress</section>" }] })
      await testRenderer.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(records.length).toBe(1)
      expect(records[0]).toMatchObject({
        status: "starting",
        transcript: { nodeCount: 1 },
      })
    } finally {
      testRenderer.renderer.root.add = originalAdd as typeof testRenderer.renderer.root.add
      ui.destroy()
    }
  })
```

- [ ] **Step 2: Run e2e test to verify it fails**

Run:

```bash
npm run test -- src/ui/e2e.test.ts
```

Expected: TypeScript/test failure because `diagnostics` is not in `UiOptions` yet.

- [ ] **Step 3: Add diagnostics option and render context tracking**

Modify imports in `src/ui.ts`:

```ts
import type { RenderContext, RenderDiagnostics } from "./ui/render-diagnostics"
import { summarizeText } from "./ui/render-diagnostics"
```

Modify `UiOptions`:

```ts
export type UiOptions = {
  headless?: boolean
  agentLabel?: string
  registry?: CommandRegistry
  onFetchOptions?: (method: string) => Promise<CommandOption[]>
  renderer?: Awaited<ReturnType<typeof createCliRenderer>>
  diagnostics?: RenderDiagnostics
}
```

Add state near existing render state variables:

```ts
  const diagnostics = options.diagnostics
  let currentRenderContext: RenderContext | undefined
```

Add helper inside `createAgentClientUi`:

```ts
  function setRenderContext(context: RenderContext): void {
    currentRenderContext = context
  }

  function clearRenderContext(): void {
    currentRenderContext = undefined
  }

  function renderErrorSnapshot() {
    return {
      status,
      terminal: {
        columns: process.stdout.columns,
        rows: process.stdout.rows,
      },
      transcript: {
        version: transcriptContentVersion,
        renderedNodeCount,
        nodeCount: transcript.nodes.length,
        ...(transcript.activeAgentNodeId ? { activeAgentNodeId: transcript.activeAgentNodeId } : {}),
      },
      ...(currentRenderContext ? { context: currentRenderContext } : {}),
    }
  }
```

In each renderable construction path, set context immediately before creating the risky renderable.

For `buildTranscriptLabel` before `new TextRenderable` for the label:

```ts
    setRenderContext({
      phase: "buildTranscriptLabel.label",
      nodeId: node.id,
      kind: node.kind,
      blockIndex: index,
      renderable: "TextRenderable",
      text: summarizeText(label),
    })
```

Before `new TextRenderable` for the body:

```ts
    setRenderContext({
      phase: "buildTranscriptLabel.body",
      nodeId: node.id,
      kind: node.kind,
      blockIndex: index,
      renderable: "TextRenderable",
      text: summarizeText(text),
    })
```

Before `new CodeRenderable`:

```ts
      setRenderContext({
        phase: "buildTranscriptBlock.code",
        nodeId: node.id,
        kind: node.kind,
        blockId: block.id,
        blockType: block.type,
        blockIndex,
        renderable: "CodeRenderable",
        text: summarizeText(block.text),
      })
```

Before `new DiffRenderable`:

```ts
      const diff = buildUnifiedDiff(block)
      setRenderContext({
        phase: "buildTranscriptBlock.diff",
        nodeId: node.id,
        kind: node.kind,
        blockId: block.id,
        blockType: block.type,
        blockIndex,
        renderable: "DiffRenderable",
        text: summarizeText(diff),
      })
```

Then pass `diff` into `DiffRenderable` instead of calling `buildUnifiedDiff(block)` inline.

At the end of successful `render()` after `renderer.root.add(...)`, call:

```ts
      clearRenderContext()
```

In the `catch` block, record diagnostics without blocking render recovery:

```ts
    } catch (err) {
      process.stderr.write(`[render error] ${(err as Error).message}\n`)
      void diagnostics?.recordRenderError(err, renderErrorSnapshot()).catch((logError) => {
        process.stderr.write(`[render diagnostics error] ${(logError as Error).message}\n`)
      })
    }
```

- [ ] **Step 4: Run e2e test**

Run:

```bash
npm run test -- src/ui/e2e.test.ts
```

Expected: pass.

---

### Task 3: Record App Events and Fatal Errors

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Import and create diagnostics**

Modify `src/index.ts` imports:

```ts
import { createRenderDiagnostics } from "./ui/render-diagnostics"
```

After `const { agent, headless } = parseArgs(process.argv.slice(2))`, add:

```ts
const diagnostics = createRenderDiagnostics({ agentLabel: agent.label })
diagnostics.recordEvent("startup", {
  agentLabel: agent.label,
  headless,
  cwd: cwd(),
  argv: process.argv.slice(2),
})
```

Pass diagnostics into UI:

```ts
const ui = await createAgentClientUi({
  headless,
  agentLabel: agent.label,
  registry,
  diagnostics,
  onFetchOptions: (method) => client.fetchOptions(method),
})
```

- [ ] **Step 2: Record transport and prompt lifecycle events**

Inside `transport.onEvent`, add one event per branch:

```ts
diagnostics.recordEvent("transport-event", { type: event.type, method: "method" in event ? event.method : undefined })
```

Before `await client.prompt(sessionId, prompt)` in `runPrompt`, add:

```ts
diagnostics.recordEvent("prompt-start", { length: prompt.length, panel: Boolean(options?.panel) })
```

After successful prompt:

```ts
diagnostics.recordEvent("prompt-finish", { status: "ready" })
```

In `catch (error)` inside `runPrompt`:

```ts
diagnostics.recordEvent("prompt-error", { message: (error as Error).message })
```

- [ ] **Step 3: Add fatal process handlers**

Before the main `try` block in `src/index.ts`, add:

```ts
process.on("uncaughtException", (error) => {
  diagnostics.recordEvent("uncaughtException", { message: error.message, stack: error.stack })
  process.stderr.write(`[uncaughtException] ${error.stack ?? error.message}\n`)
})

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  diagnostics.recordEvent("unhandledRejection", { message, stack })
  process.stderr.write(`[unhandledRejection] ${stack ?? message}\n`)
})
```

Do not call `process.exit()` from these handlers. Let current app behavior decide lifecycle.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

---

### Task 4: Reproduce and Verify Capture

**Files:**
- No source file changes.
- Runtime output expected under `tmp/render-errors/*.jsonl`.

- [ ] **Step 1: Run automated tests**

Run:

```bash
npm run test
npm run typecheck
```

Expected: both pass.

- [ ] **Step 2: Re-run known tmux reproduction**

Start four panes in the treebranch:

```bash
tmux split-window -t "$TMUX_PANE" -c "/home/shoutcape/github/AgentClientTUI/.worktrees/proper-error-handling" -P -F '#{pane_id}' 'npm run dev -- --agent "opencode acp"'
```

Repeat until four pane IDs are available. Send this prompt to each pane, using unique filenames:

```text
Use the brainstorming skill if available. Get a good understanding of this codebase, then create a brainstorming HTML feature list file at tmp/feature-brainstorm-paneXX.html. Include current implemented features and future features. Use rich HTML with headings, cards, lists, status badges, code snippets, and enough content to stress transcript rendering. You may inspect and write files.
```

- [ ] **Step 3: Confirm JSONL capture exists**

Run:

```bash
ls tmp/render-errors
```

Expected: at least one `.jsonl` file if `[render error] Failed to create TextBuffer` appears.

- [ ] **Step 4: Inspect captured failure context**

Run:

```bash
node -e 'const fs=require("fs"); const f=fs.readdirSync("tmp/render-errors").sort().at(-1); const lines=fs.readFileSync(`tmp/render-errors/${f}`,"utf8").trim().split("\n"); console.log(JSON.stringify(JSON.parse(lines.at(-1)), null, 2));'
```

Expected: printed record includes `message`, `stack`, `context.phase`, `context.renderable`, text length/line count/preview, transcript node counts, terminal size, and recent events.

- [ ] **Step 5: Close panes and preserve logs**

Close only test panes:

```bash
tmux kill-pane -t %PANE_ID
```

Do not delete `tmp/render-errors`. Those logs are evidence for root-cause analysis.

---

## Self-Review

- Spec coverage: plan captures render error stack, terminal size, transcript stats, active context, recent app events, and reproduction evidence.
- Placeholder scan: no TBD/TODO/fill-in placeholders.
- Type consistency: `RenderDiagnostics`, `RenderContext`, and `RenderErrorSnapshot` names are consistent across tasks.
- Scope check: plan only adds observability. It does not try to fix TextBuffer failures yet.
