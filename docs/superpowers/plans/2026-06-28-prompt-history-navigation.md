# Prompt History Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-memory Up/Down prompt history navigation for normal input while preserving draft text and leaving ACP provider session history separate.

**Architecture:** Keep prompt recall as local interactive UI state in `createAgentClientUi`. Add small helper functions in `src/ui.ts` for remembering prompts, browsing history, and skipping local app commands. Verify behavior through OpenTUI e2e tests because key routing is the important integration point.

**Tech Stack:** TypeScript, Bun test runner, OpenTUI `@opentui/core`, existing ACP command registry.

---

## File Structure

- Modify: `src/ui.ts`
  - Owns interactive keyboard routing and local prompt history state.
  - Adds prompt-history helpers scoped inside `createAgentClientUi`.
- Modify: `src/ui/e2e.test.ts`
  - Adds OpenTUI key-routing tests for prompt history and draft restoration.

Do not modify ACP client/provider code. ACP session history remains separate from local input recall.

---

### Task 1: Add Failing E2E Tests For Prompt History

**Files:**
- Modify: `src/ui/e2e.test.ts`

- [ ] **Step 1: Add test for submitted prompt navigation and draft restore**

Add this test near the other input/key-routing tests:

```ts
  test("normal input navigates submitted prompt history and restores draft", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const submissions: string[] = []
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit((prompt) => {
      submissions.push(prompt)
    })

    try {
      await testRenderer.mockInput.typeText("first")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("second")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("draft")
      await testRenderer.flush()

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("second█")

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first█")

      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("second█")

      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("draft█")

      expect(submissions).toEqual(["first", "second"])
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 2: Add test for editing while browsing history**

Add this test after the draft restore test:

```ts
  test("editing while browsing prompt history exits history mode", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit(() => {})

    try {
      await testRenderer.mockInput.typeText("first")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("draft")
      await testRenderer.flush()

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first█")

      testRenderer.mockInput.pressKey("!")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first!█")
      expect(testRenderer.captureCharFrame()).not.toContain("draft█")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 3: Add test for paste while browsing history**

Add this test after the edit test:

```ts
  test("paste while browsing prompt history exits history mode", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit(() => {})

    try {
      await testRenderer.mockInput.typeText("first")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("draft")
      await testRenderer.flush()

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()

      testRenderer.renderer.keyInput.processPaste(new TextEncoder().encode(" pasted"))
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first pasted█")

      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()
      expect(testRenderer.captureCharFrame()).toContain("first pasted█")
      expect(testRenderer.captureCharFrame()).not.toContain("draft█")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 3: Run focused e2e tests and confirm failure**

Run:

```bash
bun test src/ui/e2e.test.ts
```

Expected: the new prompt-history tests fail because Up/Down and paste do not currently coordinate with prompt history state.

- [ ] **Step 4: Commit failing tests**

```bash
git add src/ui/e2e.test.ts
git commit -m "test: cover prompt history navigation"
```

---

### Task 2: Implement Local Prompt History State

**Files:**
- Modify: `src/ui.ts`
- Test: `src/ui/e2e.test.ts`

- [ ] **Step 1: Add history state variables**

In `createAgentClientUi`, near the existing local UI state variables, add:

```ts
  const promptHistory: string[] = []
  let historyIndex: number | null = null
  let historyDraft = ""
```

- [ ] **Step 2: Add helper to reset browsing state**

Add this helper inside `createAgentClientUi`, near other small UI helpers:

```ts
  function resetPromptHistoryBrowse(): void {
    historyIndex = null
    historyDraft = ""
  }
```

- [ ] **Step 3: Add helper to detect exact local app commands**

Add:

```ts
  function shouldRememberPrompt(prompt: string): boolean {
    const descriptor = registry.get(prompt)
    return !(descriptor?.source === "local" && (descriptor.kind ?? "app") === "app")
  }
```

This skips exact local UI app commands while still remembering free-text prompts such as `Quit now` and ACP slash commands such as `/context show`.

- [ ] **Step 4: Add helper to remember submitted prompts**

Add:

```ts
  function rememberPrompt(prompt: string): void {
    if (shouldRememberPrompt(prompt)) {
      promptHistory.push(prompt)
    }
    resetPromptHistoryBrowse()
  }
```

- [ ] **Step 5: Add helper to navigate history**

Add:

```ts
  function navigatePromptHistory(direction: "older" | "newer"): boolean {
    if (promptHistory.length === 0) return false

    if (direction === "older") {
      if (historyIndex === null) {
        historyDraft = inputValue
        historyIndex = promptHistory.length - 1
      } else {
        historyIndex = Math.max(0, historyIndex - 1)
      }
      inputValue = promptHistory[historyIndex] ?? ""
      return true
    }

    if (historyIndex === null) return false

    if (historyIndex >= promptHistory.length - 1) {
      inputValue = historyDraft
      resetPromptHistoryBrowse()
      return true
    }

    historyIndex += 1
    inputValue = promptHistory[historyIndex] ?? ""
    return true
  }
```

- [ ] **Step 6: Route Up/Down to history in normal input mode**

In the `renderer.keyInput.on("keypress", ...)` handler, after command-menu handling and before transcript scrolling, add:

```ts
    if (key.name === "up" || key.name === "down") {
      const navigated = navigatePromptHistory(key.name === "up" ? "older" : "newer")
      if (navigated) {
        cursorVisible = true
        render()
        return
      }
    }
```

Do not put this before `if (commandState.phase !== "idle")`; command menus must keep owning arrow navigation.

- [ ] **Step 7: Exit browsing when normal editing changes input**

Around the existing `handleInputKey` call, preserve whether browsing was active and whether the key caused a real input action:

```ts
    const previousInputValue = inputValue
    const wasBrowsingPromptHistory = historyIndex !== null
    const result = handleInputKey(inputValue, key)
    inputValue = result.value
    if (wasBrowsingPromptHistory && (result.value !== previousInputValue || result.submit !== undefined || result.activate !== undefined)) {
      resetPromptHistoryBrowse()
    }
    cursorVisible = true
```

This preserves draft restore state for unsupported non-edit keys, while typing, backspace, slash activation, and submit all exit history browsing.

- [ ] **Step 8: Remember normal submissions**

Near the existing submit block:

```ts
    if (result.submit && submitHandler) {
      rememberPrompt(result.submit)
      void submitHandler(result.submit)
    }
```

Keep submission behavior otherwise unchanged.

- [ ] **Step 9: Remember command-menu executions when not local app commands**

In the command effect execute branch, before clearing input or submitting, add:

```ts
          rememberPrompt(cmdText)
```

Place it after `cmdText` is known and before `inputValue = ""`. `rememberPrompt` will skip local app commands by consulting the registry.

- [ ] **Step 10: Exit browsing on paste**

In the paste handler, before appending pasted text, add:

```ts
    if (historyIndex !== null) resetPromptHistoryBrowse()
```

- [ ] **Step 11: Run focused e2e tests**

Run:

```bash
bun test src/ui/e2e.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit implementation**

```bash
git add src/ui.ts src/ui/e2e.test.ts
git commit -m "feat: add prompt history navigation"
```

---

### Task 3: Add Regression Coverage For Command Routing

**Files:**
- Modify: `src/ui/e2e.test.ts`
- Test: `src/ui/e2e.test.ts`

- [ ] **Step 1: Add test that slash dropdown still owns arrow keys**

Add this test near command dropdown tests:

```ts
  test("slash dropdown arrow keys still navigate commands instead of prompt history", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit(() => {})

    try {
      await testRenderer.mockInput.typeText("remembered")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()
      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("/context")
      expect(frame).not.toContain("remembered█")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 2: Add test that Ctrl+P palette still owns arrow keys**

Add this test near command palette tests:

```ts
  test("ctrl-p palette arrow keys still navigate commands instead of prompt history", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })
    ui.onSubmit(() => {})

    try {
      await testRenderer.mockInput.typeText("remembered")
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()
      testRenderer.mockInput.pressArrow("down")
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      const frame = testRenderer.captureCharFrame()
      expect(frame).toContain("sonnet")
      expect(frame).not.toContain("remembered█")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 3: Add test that local app commands are not remembered**

Add a focused test if the command palette can select `Quit` without exiting the test process. If selecting `Quit` would call `process.exit`, use `Toggle Session Panel` by registering it in the test registry or skip this test and rely on unit-level review.

Suggested safer path:

```ts
  test("local app commands are not added to prompt history", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const registry = createMockCommandRegistry()
    registry.addLocalCommand({ name: "Toggle Session Panel", description: "Show/hide sidebar", source: "local", kind: "app" })
    const submissions: string[] = []
    const ui = await createAgentClientUi({
      registry,
      renderer: testRenderer.renderer,
    })
    ui.onSubmit((prompt) => {
      submissions.push(prompt)
    })

    try {
      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()
      await testRenderer.mockInput.typeText("Toggle")
      await testRenderer.flush()
      testRenderer.mockInput.pressEnter()
      await testRenderer.flush()

      testRenderer.mockInput.pressArrow("up")
      await testRenderer.flush()

      expect(submissions).toEqual(["Toggle Session Panel"])
      expect(testRenderer.captureCharFrame()).not.toContain("Toggle Session Panel█")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 4: Run focused e2e tests**

Run:

```bash
bun test src/ui/e2e.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit regression tests**

```bash
git add src/ui/e2e.test.ts
git commit -m "test: protect prompt history key routing"
```

---

### Task 4: Verify Everything

**Files:**
- Verify: full repository test suite

- [ ] **Step 1: Run all tests**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Optional manual tmux smoke**

If key behavior feels uncertain, run the app in tmux:

```bash
tmux split-window -v -c "/home/shoutcape/github/AgentClientTUI/.worktrees/prompt-history-navigation-plan" "bun run dev"
```

Manual check:

- Submit `first` and `second`.
- Type `draft`.
- Press Up twice: see `second`, then `first`.
- Press Down twice: see `second`, then restored `draft`.
- Open `/` and verify Up/Down navigate the dropdown, not prompt history.

- [ ] **Step 4: Commit verification-ready state if any final files changed**

```bash
git status --short
```

Expected: no uncommitted changes unless a previous step intentionally changed files after the implementation commits.

---

## Notes For Implementers

- Use @test-driven-development for implementation.
- Use @verification-before-completion before claiming done.
- Do not add persistent storage in this task.
- Do not add ACP methods for prompt history.
- Do not change `src/acp/client.ts`, `src/acp/session-update.ts`, or provider behavior for this feature.
- Keep history behavior in normal input mode only. Command menus own arrow keys while open.
