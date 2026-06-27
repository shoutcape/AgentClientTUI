# Render Resource Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent OpenTUI native `TextBuffer` and `SyntaxStyle` allocation failures by destroying replaced UI roots instead of only detaching them.

**Architecture:** Keep the existing transcript cache because it avoids rebuilding transcript renderables on every frame. Before replacing `app-root`, detach the reusable `transcriptScroll`, then destroy the old app root recursively so native resources owned by header, footer, input, sidebar, and palette renderables are freed. On recovery paths that discard the transcript cache, destroy the old transcript scroll recursively before clearing references.

**Tech Stack:** TypeScript, Bun tests, OpenTUI renderables, existing `createAgentClientUi` test renderer.

---

## File Structure

- Modify `.gitignore`: ignore `/tmp/` so diagnostic JSONL logs are not committed.
- Modify `src/ui.ts`: replace root removal with recursive destruction while preserving `transcriptScroll`; destroy discarded transcript cache on render recovery.
- Modify `src/ui/e2e.test.ts`: add lifecycle regression test proving replaced roots are destroyed and the transcript scroll survives.

## Evidence

- Log file: `tmp/render-errors/2026-06-27T12-59-00-115Z.jsonl`
- First error: `Failed to create SyntaxStyle` at `render.root.add`.
- Later errors: repeated `Failed to create TextBuffer` at `buildTranscriptLabel.label` for `node-1`, `kind: status`, preview `● status`.
- The repeated failing text is 8 chars, so content size is not the root cause.
- OpenTUI `remove()` calls `onRemove()` and detaches children, but does not call `destroy()` or `destroyRecursively()`.

---

### Task 1: Ignore Runtime Diagnostics

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Update `.gitignore`**

Replace the two specific tmp trace entries with one project tmp ignore:

```gitignore
node_modules/
dist/
.env
*.log

.worktrees/
.superpowers/
/tmp/
```

- [ ] **Step 2: Check status**

Run:

```bash
git status --short
```

Expected: no `tmp/` files appear in status.

---

### Task 2: Add Resource Lifecycle Regression Test

**Files:**
- Modify: `src/ui/e2e.test.ts`

- [ ] **Step 1: Write failing test**

Add this test inside `describe("OpenTUI command e2e", ...)`, after the existing render diagnostics test:

```ts
  test("destroys replaced app roots without destroying transcript scroll", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      const firstRoot = testRenderer.renderer.root.getRenderable("app-root")
      const firstScroll = testRenderer.renderer.root.findDescendantById("transcript-scroll") as ScrollBoxRenderable | undefined
      expect(firstRoot).toBeDefined()
      expect(firstScroll).toBeDefined()

      ui.setStatus("rerender")
      await testRenderer.flush()

      expect(firstRoot?.isDestroyed).toBe(true)
      expect(firstScroll?.isDestroyed).toBe(false)
      expect(testRenderer.renderer.root.findDescendantById("transcript-scroll")).toBe(firstScroll)
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -- src/ui/e2e.test.ts -t "destroys replaced app roots"
```

Expected: FAIL because `firstRoot?.isDestroyed` is `false`.

---

### Task 3: Destroy Replaced App Roots

**Files:**
- Modify: `src/ui.ts`

- [ ] **Step 1: Update `resetTranscriptRenderCache()`**

Change the helper so it destroys any discarded transcript scroll before clearing references:

```ts
  function resetTranscriptRenderCache(): void {
    transcriptScroll?.destroyRecursively()
    transcriptScroll = undefined
    renderedTranscriptVersion = -1
    renderedNodeCount = 0
    activeStreamRenderable = null
    activeStreamNodeId = null
  }
```

- [ ] **Step 2: Replace root removal in `render()`**

Replace this code:

```ts
      if (renderer.root.getRenderable("app-root")) {
        renderer.root.remove("app-root")
      }
```

With this code:

```ts
      const existingRoot = renderer.root.getRenderable("app-root")
      if (existingRoot) {
        transcriptScroll?.parent?.remove(transcriptScroll.id)
        existingRoot.destroyRecursively()
      }
```

Why: `transcriptScroll` is reused across renders, so detach it before destroying old root. Everything else in old root is disposable and should free native resources.

- [ ] **Step 3: Run lifecycle test to verify GREEN**

Run:

```bash
npm run test -- src/ui/e2e.test.ts -t "destroys replaced app roots"
```

Expected: PASS.

---

### Task 4: Verify Diagnostics and Recovery Tests

**Files:**
- Test: `src/ui/e2e.test.ts`
- Test: `src/ui/render-diagnostics.test.ts`

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm run test -- src/ui/e2e.test.ts src/ui/render-diagnostics.test.ts
```

Expected: all tests pass. Existing diagnostic tests intentionally write `[render error]` lines during simulated failures.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run test
npm run typecheck
```

Expected: all tests pass and TypeScript reports no errors.

---

### Task 5: Runtime Retest

**Files:**
- No source changes.

- [ ] **Step 1: Restart dev process**

Stop any existing `npm run dev` process for this worktree, then start a fresh one:

```bash
npm run dev -- --agent "opencode acp"
```

Expected: fresh process starts without carrying previously leaked native resources.

- [ ] **Step 2: Reproduce prior crash scenario**

Use same prompt/workload that previously produced the 62-node transcript crash.

Expected: UI does not crash with `Failed to create SyntaxStyle` or `Failed to create TextBuffer`.

- [ ] **Step 3: Check diagnostics logs**

Run:

```bash
ls tmp/render-errors
```

Expected: no new `.jsonl` file for the retest. If a new log exists, inspect it before making any further fix.

---

## Self-Review

- Spec coverage: plan covers gitignore, failing lifecycle test, root destruction, transcript preservation, targeted and full verification, and runtime restart.
- Placeholder scan: no TBD, TODO, or vague implementation steps remain.
- Type consistency: uses existing `transcriptScroll`, `destroyRecursively()`, `renderer.root.getRenderable()`, and `createAgentClientUi()` APIs.
