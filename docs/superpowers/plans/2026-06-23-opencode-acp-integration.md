# OpenCode ACP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AgentClientTUI work against real OpenCode ACP via `opencode acp`.

**Architecture:** Keep the existing stdio JSON-RPC ACP transport. Add missing agent-to-client request handling, minimal permission responses, OpenCode command documentation, and smoke coverage. Do not implement the `opencode serve` HTTP/OpenAPI path in this plan.

**Tech Stack:** TypeScript, Bun test, Node child process stdio, ACP JSON-RPC v1.

---

## File Structure

- Modify `README.md`: document `opencode acp` as the real OpenCode integration command and clarify that `opencode serve` is HTTP/OpenAPI, not ACP stdio.
- Modify `src/acp/types.ts`: add the client request handler type used by transport request handling.
- Modify `src/acp/transport.ts`: handle incoming JSON-RPC requests from the agent and respond with either handler output or JSON-RPC errors.
- Modify `src/acp/client.ts`: add `cancel(sessionId)` notification support.
- Modify `src/index.ts`: register a minimal `session/request_permission` client request handler and wire cancel support only if current UI has an existing cancel path.
- Modify `src/mock-agent.ts`: add a mock prompt path that requests permission from the client before completing.
- Modify `src/mock-agent.test.ts`: verify permission request/response behavior.
- Modify `src/acp/session-update.ts`: only add OpenCode-specific update normalization if real smoke output exposes a missing variant.
- Modify `src/acp/session-update.test.ts`: add matching tests only if `session-update.ts` changes.

---

### Task 1: Fix README Real-Agent Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the real-agent command**

Replace this command in `README.md`:

```bash
npm run dev -- --agent "opencode serve"
```

with:

```bash
npm run dev -- --agent "opencode acp"
```

- [ ] **Step 2: Add explicit cwd example**

Add this example after the real-agent command:

```bash
npm run dev -- --agent "opencode acp --cwd /absolute/project/path"
```

- [ ] **Step 3: Clarify ACP versus server mode**

Add this text after the examples:

```md
`opencode acp` is OpenCode's ACP stdio server. `opencode serve` starts OpenCode's HTTP/OpenAPI server and is not used by AgentClientTUI yet.
```

- [ ] **Step 4: Verify docs-only change does not break types**

Run: `npm run typecheck`

Expected: exit code 0.

---

### Task 2: Add Incoming ACP Request Handling

**Files:**
- Modify: `src/acp/types.ts`
- Modify: `src/acp/transport.ts`
- Test: `src/mock-agent.test.ts`

- [ ] **Step 1: Write failing test for unsupported incoming request**

Add a mock-agent test that sends a prompt causing the mock agent to issue an unknown client request. The assertion should verify the mock agent receives JSON-RPC error code `-32601` and then completes normally.

Suggested test name:

```ts
test("responds to unsupported incoming client requests", async () => {
  // Spawn mock agent through JsonRpcTransport, send initialize/session/new, then prompt /unknown-request.
  // Expect a session/update containing "Unsupported client request" or a mock completion line proving the error was received.
})
```

- [ ] **Step 2: Run failing test**

Run: `npm run test src/mock-agent.test.ts`

Expected: fail because `JsonRpcTransport` treats incoming requests as protocol errors and never responds.

- [ ] **Step 3: Add request handler type**

In `src/acp/types.ts`, add:

```ts
export type ClientRequestHandler = (method: string, params: JsonValue | undefined) => Promise<JsonValue> | JsonValue
```

- [ ] **Step 4: Add handler registration to transport**

In `src/acp/transport.ts`, import `ClientRequestHandler` and add:

```ts
private requestHandlers = new Map<string, ClientRequestHandler>()

onRequest(method: string, handler: ClientRequestHandler): () => void {
  this.requestHandlers.set(method, handler)
  return () => this.requestHandlers.delete(method)
}
```

- [ ] **Step 5: Handle incoming agent requests**

In `handleStdoutLine`, before notification handling, add:

```ts
if ("id" in message && "method" in message) {
  void this.handleRequest(message)
  return
}
```

Then add:

```ts
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
        message: (error as Error).message,
      },
    })
  }
}
```

- [ ] **Step 6: Verify**

Run: `npm run test src/mock-agent.test.ts`

Expected: pass.

Run: `npm run typecheck`

Expected: pass.

---

### Task 3: Implement Minimal Permission Handler

**Files:**
- Modify: `src/index.ts`
- Modify: `src/mock-agent.ts`
- Test: `src/mock-agent.test.ts`

- [ ] **Step 1: Write failing permission test**

Add a mock-agent test that sends `/permission` and expects the final agent text to include:

```text
Permission selected: allow-once
```

- [ ] **Step 2: Run failing test**

Run: `npm run test src/mock-agent.test.ts`

Expected: fail because no `session/request_permission` handler is registered.

- [ ] **Step 3: Add mock permission prompt path**

In `src/mock-agent.ts`, add request tracking for agent-originated requests, then add this behavior inside `session/prompt`:

```ts
if (prompt.startsWith("/permission")) {
  const permission = await requestClient("session/request_permission", {
    sessionId,
    toolCall: { toolCallId: "mock-permission", title: "Mock permission" },
    options: [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject-once", name: "Reject", kind: "reject_once" },
    ],
  })
  const selected = extractSelectedOption(permission)
  streamText(`Permission selected: ${selected}.`)
  result(message.id, { stopReason: "end_turn" })
  return
}
```

- [ ] **Step 4: Add permission selection helper in `src/index.ts`**

Add:

```ts
function selectPermissionOption(params: unknown): string {
  const record = params && typeof params === "object" && !Array.isArray(params)
    ? params as { options?: Array<{ optionId?: string; kind?: string }> }
    : {}

  const allowOnce = record.options?.find((option) => option.kind === "allow_once" && option.optionId)
  const first = record.options?.find((option) => option.optionId)

  return allowOnce?.optionId ?? first?.optionId ?? "allow-once"
}
```

- [ ] **Step 5: Register `session/request_permission` handler**

After transport/client creation in `src/index.ts`, add:

```ts
transport.onRequest("session/request_permission", (_method, params) => {
  ui.append({ kind: "status", text: "permission requested" })
  return {
    outcome: {
      outcome: "selected",
      optionId: selectPermissionOption(params),
    },
  }
})
```

If `ui` is not initialized yet at that location, register immediately after `createAgentClientUi` returns.

- [ ] **Step 6: Verify**

Run: `npm run test src/mock-agent.test.ts`

Expected: pass.

Run: `npm run typecheck`

Expected: pass.

---

### Task 4: Add Cancel Support

**Files:**
- Modify: `src/acp/client.ts`
- Modify: `src/index.ts` only if an existing non-exit cancel UI path exists

- [ ] **Step 1: Add client cancel method**

In `src/acp/client.ts`, add:

```ts
cancel(sessionId: string): void {
  this.transport.notify("session/cancel", { sessionId })
}
```

- [ ] **Step 2: Avoid new UX unless existing UI supports cancellation**

Inspect `src/ui.ts` and `src/ui/view.ts`. If only `Ctrl+C` exits, do not invent new cancel UX in this task.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`

Expected: pass.

---

### Task 5: Smoke Test Real OpenCode ACP

**Files:**
- No planned file edits.

- [ ] **Step 1: Run headless OpenCode ACP smoke**

Run: `npm run dev -- --agent "opencode acp" --headless`

Expected: initializes, creates session, sends prompt, receives assistant text or clear auth/provider error. It must not hang on `session/request_permission`.

- [ ] **Step 2: Record result**

If the smoke reveals unsupported methods, note exact method names and output. Only code fixes should happen in Task 6.

---

### Task 6: Normalize OpenCode ACP Updates From Smoke

**Files:**
- Modify: `src/acp/session-update.ts` only if Task 5 shows unhandled update variants worth rendering better.
- Modify: `src/acp/session-update.test.ts` only if `session-update.ts` changes.

- [ ] **Step 1: Add failing test for observed update shape**

Use exact JSON shape observed in Task 5.

- [ ] **Step 2: Run failing test**

Run: `npm run test src/acp/session-update.test.ts`

Expected: fail before implementation.

- [ ] **Step 3: Implement minimal normalization**

Add only the branch needed for the observed update. Unknown updates should still render as status and not crash.

- [ ] **Step 4: Verify**

Run: `npm run test src/acp/session-update.test.ts`

Expected: pass.

Run: `npm run typecheck`

Expected: pass.

---

### Task 7: Final Verification

**Files:**
- No planned file edits unless verification finds a bug.

- [ ] **Step 1: Run full test suite**

Run: `npm run test`

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: pass.

- [ ] **Step 3: Run existing smoke**

Run: `npm run smoke`

Expected: pass.

- [ ] **Step 4: Run real OpenCode ACP smoke**

Run: `npm run dev -- --agent "opencode acp" --headless`

Expected: pass, or produce a clear external auth/provider error rather than protocol failure.

---

## Not In Scope

- `opencode serve` HTTP/OpenAPI integration.
- Full interactive permission modal.
- Client filesystem methods.
- Terminal methods.
- Session list/load UI.
- Model/mode config UI beyond rendering OpenCode-provided commands/options already supported.
