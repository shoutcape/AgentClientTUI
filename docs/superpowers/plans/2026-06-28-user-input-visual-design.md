# User Input Visual Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved violet user signal to the input bar, submitted user prompts, and slash dropdown while preserving app-level palette styling.

**Architecture:** Keep changes in current UI owners. Theme tokens live in `src/ui/transcript.ts`, view-model shape lives in `src/ui/view.ts`, input render state stays in `src/ui.ts`, slash dropdown styling stays in `src/ui/dropdown.ts`, and transcript event colors stay in `src/ui/transcript-renderer.ts`.

**Tech Stack:** TypeScript, Bun test runner, OpenTUI `BoxRenderable`/`TextRenderable`, existing OpenTUI test renderer.

**Policy:** Do not commit unless the user explicitly asks. Follow TDD: write failing tests, run them and observe failure, then implement minimal code.

---

## Spec

Read first: `docs/superpowers/specs/2026-06-28-user-input-visual-design.md`.

## File Map

- Modify `src/ui/transcript.ts`: add user theme tokens.
- Modify `src/ui/view.ts`: split input value and cursor so cursor can be violet while typed text stays normal foreground.
- Modify `src/ui/view.test.ts`: update input view-model tests for split cursor and user color.
- Modify `src/ui.ts`: render split cursor, add input box id, rounded input border, faint/strong violet border state.
- Modify `src/ui/dropdown.ts`: give slash dropdown stable ids, rounded border, violet border, violet selected row.
- Modify `src/ui/palette.ts`: add stable ids only if needed to assert palette remains app accent.
- Modify `src/ui/transcript-renderer.ts`: switch user event strip/background to violet tokens and keep strip at one terminal column.
- Modify `src/ui/e2e.test.ts`: add render-tree tests for input, dropdown, palette, and transcript colors.

## Task 1: Theme Tokens And Input View Model

**Files:**
- Modify: `src/ui/transcript.ts:42-58`
- Modify: `src/ui/view.ts:12-43`
- Modify: `src/ui/view.test.ts:37-59`

- [ ] **Step 1: Write failing view-model tests**

In `src/ui/view.test.ts`, update the palette test and input tests to expect user tokens and split cursor:

```ts
  test("uses the OpenCode dark theme palette", () => {
    expect(opencodeTheme.background).toBe("#0a0a0a")
    expect(opencodeTheme.backgroundPanel).toBe("#141414")
    expect(opencodeTheme.primary).toBe("#fab283")
    expect(opencodeTheme.secondary).toBe("#5c9cf5")
    expect(opencodeTheme.accent).toBe("#9d7cd8")
    expect(opencodeTheme.textMuted).toBe("#808080")
    expect(opencodeTheme.user).toBe("#a78bfa")
    expect(opencodeTheme.userBorder).toBe("#4a3f62")
    expect(opencodeTheme.userBackground).toBe("#211a2e")
  })
```

Replace the current input tests with:

```ts
  test("builds an empty user-owned input bar without placeholder text", () => {
    expect(buildInputBar()).toEqual({
      prompt: ">",
      promptColor: opencodeTheme.user,
    })
  })

  test("shows typed input and a violet cursor when active", () => {
    expect(buildInputBar("hello", { cursorVisible: true })).toEqual({
      prompt: ">",
      value: "hello",
      cursor: "█",
      promptColor: opencodeTheme.user,
      valueColor: opencodeTheme.text,
      cursorColor: opencodeTheme.user,
    })
  })

  test("shows only the violet cursor in an empty active input", () => {
    expect(buildInputBar("", { cursorVisible: true })).toEqual({
      prompt: ">",
      cursor: "█",
      promptColor: opencodeTheme.user,
      cursorColor: opencodeTheme.user,
    })
  })

  test("hides input cursor when inactive or blinked off", () => {
    expect(buildInputBar("hello", { cursorVisible: false })).toEqual({
      prompt: ">",
      value: "hello",
      promptColor: opencodeTheme.user,
      valueColor: opencodeTheme.text,
    })
  })
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
bun test src/ui/view.test.ts
```

Expected: FAIL because `opencodeTheme.user`/`userBorder`/`userBackground` do not exist and `buildInputBar()` still appends the cursor into `value`.

- [ ] **Step 3: Add minimal theme tokens**

In `src/ui/transcript.ts`, extend `opencodeTranscriptTheme`:

```ts
  user: "#a78bfa",
  userBorder: "#4a3f62",
  userBackground: "#211a2e",
```

Place these after `accent` so color roles stay grouped.

- [ ] **Step 4: Split input cursor from typed value**

In `src/ui/view.ts`, update `InputBar`:

```ts
export type InputBar = {
  prompt: string
  value?: string
  cursor?: string
  promptColor: string
  valueColor?: string
  cursorColor?: string
}
```

Replace `buildInputBar()` with:

```ts
export function buildInputBar(value = "", options: InputBarOptions = {}): InputBar {
  return {
    prompt: ">",
    ...(value ? { value, valueColor: opencodeTheme.text } : {}),
    ...(options.cursorVisible ? { cursor: "█", cursorColor: opencodeTheme.user } : {}),
    promptColor: opencodeTheme.user,
  }
}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
bun test src/ui/view.test.ts
```

Expected: PASS.

## Task 2: Input Rendering State

**Files:**
- Modify: `src/ui.ts:465-479`
- Modify: `src/ui/e2e.test.ts`

- [ ] **Step 1: Write failing input render-tree tests**

In `src/ui/e2e.test.ts`, update `renderableColor()` to include `borderColor`, then add `renderableBorderStyle()` after it:

```ts
function renderableColor(renderable: unknown, key: "backgroundColor" | "borderColor" | "fg"): string | undefined {
  const color = (renderable as Record<"backgroundColor" | "borderColor" | "fg", string | { toInts?: () => number[] } | undefined>)[key]
  if (typeof color === "string" || color === undefined) return color
  const [r, g, b] = color.toInts?.() ?? []
  if (r === undefined || g === undefined || b === undefined) return undefined
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`
}

function renderableBorderStyle(renderable: unknown): string | undefined {
  return (renderable as { borderStyle?: string } | undefined)?.borderStyle
}
```

Then add these tests near the existing input tests:

```ts
  test("input bar uses faint violet border while idle and strong violet while typing", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.flush()
      const idleInput = testRenderer.renderer.root.findDescendantById("input-bar")
      expect(renderableColor(idleInput, "borderColor")).toBe("#4a3f62")
      expect(renderableBorderStyle(idleInput)).toBe("rounded")

      await testRenderer.mockInput.typeText("hello")
      await testRenderer.flush()

      const activeInput = testRenderer.renderer.root.findDescendantById("input-bar")
      expect(renderableColor(activeInput, "borderColor")).toBe("#a78bfa")
      expect(testRenderer.captureCharFrame()).toContain("hello█")
    } finally {
      ui.destroy()
    }
  })

  test("input cursor is a separate violet renderable from typed text", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("hello")
      await testRenderer.flush()

      const inputValue = testRenderer.renderer.root.findDescendantById("input-value")
      const inputCursor = testRenderer.renderer.root.findDescendantById("input-cursor")

      expect(renderableColor(inputValue, "fg")).toBe("#eeeeee")
      expect(renderableColor(inputCursor, "fg")).toBe("#a78bfa")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
bun test src/ui/e2e.test.ts --grep "input bar uses faint violet|input cursor is a separate violet"
```

Expected: FAIL because `input-bar`, `input-value`, and `input-cursor` ids do not exist and input has no split cursor renderable.

- [ ] **Step 3: Implement minimal input render changes**

In `src/ui.ts`, after `showDropdown` is computed, add:

```ts
    const inputActive = windowActive && (inputValue.length > 0 || showDropdown)
    const inputBorderColor = inputActive ? opencodeTheme.user : opencodeTheme.userBorder
```

Replace `inputElement` with:

```ts
    const inputElement = Box(
      {
        id: "input-bar",
        flexDirection: "row",
        width: "100%",
        minHeight: 3,
        backgroundColor: opencodeTheme.backgroundElement,
        borderStyle: "rounded",
        borderColor: inputBorderColor,
        paddingLeft: 1,
        paddingRight: 1,
        gap: 1,
      },
      Text({ id: "input-prompt", content: inputBar.prompt, fg: inputBar.promptColor, attributes: TextAttributes.BOLD }),
      inputBar.value
        ? Text({ id: "input-value", content: inputBar.value, fg: inputBar.valueColor ?? opencodeTheme.text })
        : null,
      inputBar.cursor
        ? Text({ id: "input-cursor", content: inputBar.cursor, fg: inputBar.cursorColor ?? opencodeTheme.user })
        : null,
    )
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
bun test src/ui/e2e.test.ts --grep "input bar uses faint violet|input cursor is a separate violet|hides input cursor"
```

Expected: PASS. Existing frame still contains `hello█` because value and cursor render adjacent text nodes.

## Task 3: Transcript User Color And Strip Width

**Files:**
- Modify: `src/ui/transcript-renderer.ts:35-45, 133-138`
- Modify: `src/ui/e2e.test.ts:406-459`

- [ ] **Step 1: Update transcript test expectations**

In `src/ui/e2e.test.ts`, inside `interactive transcript omits role gutters and renders event strip surfaces`, change user assertions and add width assertion:

```ts
      expect(renderableColor(userSurface, "backgroundColor")).toBe("#211a2e")
      expect(renderableColor(userStrip, "backgroundColor")).toBe("#a78bfa")
      expect((userStrip as { width?: number } | undefined)?.width).toBe(1)
```

Also add strip width checks for tool and error:

```ts
      expect((toolStrip as { width?: number } | undefined)?.width).toBe(1)
      expect((errorStrip as { width?: number } | undefined)?.width).toBe(1)
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
bun test src/ui/e2e.test.ts --grep "interactive transcript omits role gutters"
```

Expected: FAIL because user background/strip still use green values `#102018` and `#7fd88f`.

- [ ] **Step 3: Implement transcript color change**

In `src/ui/transcript-renderer.ts`, change the `user` surface entry to:

```ts
  user: { treatment: "event", fg: opencodeTranscriptTheme.text, strip: opencodeTranscriptTheme.user, background: opencodeTranscriptTheme.userBackground },
```

Keep the strip renderable at `width: 1`. If it is not already `1`, set it to exactly `1`.

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
bun test src/ui/e2e.test.ts --grep "interactive transcript omits role gutters"
```

Expected: PASS.

## Task 4: Slash Dropdown Violet, Palette Unchanged

**Files:**
- Modify: `src/ui/dropdown.ts:33-73`
- Modify: `src/ui/palette.ts:31-56`
- Modify: `src/ui/e2e.test.ts:895-1104`

- [ ] **Step 1: Write failing dropdown and palette tests**

In `src/ui/e2e.test.ts`, add this test near slash dropdown tests:

```ts
  test("slash dropdown shares the user violet input family", async () => {
    const testRenderer = await createTestRenderer({ width: 100, height: 30 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      await testRenderer.mockInput.typeText("/")
      await testRenderer.flush()

      const dropdown = testRenderer.renderer.root.findDescendantById("slash-dropdown")
      const selectedRow = testRenderer.renderer.root.findDescendantById("slash-dropdown-selected-row")
      const input = testRenderer.renderer.root.findDescendantById("input-bar")

      expect(renderableColor(dropdown, "borderColor")).toBe("#a78bfa")
      expect(renderableBorderStyle(dropdown)).toBe("rounded")
      expect(renderableColor(selectedRow, "backgroundColor")).toBe("#a78bfa")
      expect(renderableColor(input, "borderColor")).toBe("#a78bfa")
    } finally {
      ui.destroy()
    }
  })
```

Add this test near palette tests:

```ts
  test("ctrl-p palette keeps app accent instead of user violet", async () => {
    const testRenderer = await createTestRenderer({ width: 120, height: 34 })
    const ui = await createAgentClientUi({
      registry: createMockCommandRegistry(),
      renderer: testRenderer.renderer,
    })

    try {
      testRenderer.mockInput.pressKey("p", { ctrl: true })
      await testRenderer.flush()

      const palette = testRenderer.renderer.root.findDescendantById("command-palette")
      const selectedRow = testRenderer.renderer.root.findDescendantById("command-palette-selected-row")

      expect(renderableColor(palette, "borderColor")).toBe("#9d7cd8")
      expect(renderableColor(selectedRow, "backgroundColor")).toBe("#9d7cd8")
    } finally {
      ui.destroy()
    }
  })
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
bun test src/ui/e2e.test.ts --grep "slash dropdown shares|ctrl-p palette keeps"
```

Expected: FAIL because `slash-dropdown`, `slash-dropdown-selected-row`, `command-palette`, and `command-palette-selected-row` ids do not exist, and dropdown still uses primary color.

- [ ] **Step 3: Implement dropdown styling**

In `src/ui/dropdown.ts`, when building each item row, include a stable id on the selected row:

```ts
      const boxOpts: Record<string, unknown> = {
        ...(selected ? { id: "slash-dropdown-selected-row" } : {}),
        flexDirection: "row",
        width: "100%",
        height: 1,
        paddingLeft: 1,
        paddingRight: 1,
      }
      if (selected) boxOpts.backgroundColor = opencodeTheme.user
```

Keep selected text readable by changing the selected foreground to background:

```ts
            fg: selected ? opencodeTheme.background : opencodeTheme.text,
```

In the returned dropdown `Box`, add id and rounded violet border:

```ts
    {
      id: "slash-dropdown",
      flexDirection: "column",
      width: "100%",
      height: Math.min(totalHeight, 12),
      borderStyle: "rounded",
      borderColor: opencodeTheme.user,
      backgroundColor: opencodeTheme.backgroundElement,
    },
```

- [ ] **Step 4: Add palette ids without changing colors**

In `src/ui/palette.ts`, give the selected row an id while preserving accent background:

```ts
            ...(selected ? { id: "command-palette-selected-row", backgroundColor: opencodeTheme.accent } : {}),
```

In the returned palette root `Box`, add id without changing color:

```ts
      id: "command-palette",
      flexDirection: "column",
      width: "70%",
      borderStyle: "single",
      borderColor: opencodeTheme.accent,
      backgroundColor: opencodeTheme.backgroundPanel,
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
bun test src/ui/e2e.test.ts --grep "slash dropdown shares|ctrl-p palette keeps|slash dropdown is attached|ctrl-p opens palette"
```

Expected: PASS. If `slash dropdown is attached above the input bar` now searches for `│ >`, update it to find `╭`/rounded input frame or use `findDescendantById("input-bar")` plus frame content checks instead of relying on single-border glyphs.

## Task 5: Full Verification

**Files:**
- Potentially modify tests only if existing assertions depend on old single-border glyphs.

- [ ] **Step 1: Run focused UI tests**

Run:

```bash
bun test src/ui/view.test.ts src/ui/e2e.test.ts
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

- [ ] **Step 4: Report results**

Report changed files and exact verification commands/output. Do not commit.
