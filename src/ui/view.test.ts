import { describe, expect, test } from "bun:test"
import { buildInputBar, buildTranscriptRows, handleInputKey, opencodeTheme } from "./view"

describe("OpenCode-inspired UI view model", () => {
  test("uses the OpenCode dark theme palette", () => {
    expect(opencodeTheme.background).toBe("#0a0a0a")
    expect(opencodeTheme.backgroundPanel).toBe("#141414")
    expect(opencodeTheme.primary).toBe("#fab283")
    expect(opencodeTheme.secondary).toBe("#5c9cf5")
    expect(opencodeTheme.accent).toBe("#9d7cd8")
    expect(opencodeTheme.textMuted).toBe("#808080")
  })

  test("formats transcript entries with OpenCode-like labels", () => {
    expect(buildTranscriptRows([
      { kind: "user", text: "inspect repo" },
      { kind: "agent", text: "session/update: working" },
      { kind: "log", text: "mock-agent: ready" },
    ])).toEqual([
      { label: "● user", text: "inspect repo", color: opencodeTheme.success },
      { label: "◆ assistant", text: "session/update: working", color: opencodeTheme.primary },
      { label: "· log", text: "mock-agent: ready", color: opencodeTheme.textMuted },
    ])
  })

  test("builds an empty OpenCode-like input bar without placeholder text", () => {
    expect(buildInputBar()).toEqual({
      prompt: ">",
      promptColor: opencodeTheme.primary,
    })
  })

  test("shows typed input with a cursor when active", () => {
    expect(buildInputBar("hello", { cursorVisible: true })).toEqual({
      prompt: ">",
      value: "hello█",
      promptColor: opencodeTheme.primary,
      valueColor: opencodeTheme.text,
    })
  })

  test("shows only the cursor in an empty active input", () => {
    expect(buildInputBar("", { cursorVisible: true }).value).toBe("█")
  })

  test("hides input cursor when inactive or blinked off", () => {
    expect(buildInputBar("hello", { cursorVisible: false }).value).toBe("hello")
  })

  test("edits and submits the input buffer from key events", () => {
    let state = handleInputKey("", { name: "h", sequence: "h" })
    state = handleInputKey(state.value, { name: "i", sequence: "i" })
    state = handleInputKey(state.value, { name: "backspace", sequence: "" })
    state = handleInputKey(state.value, { name: "!", sequence: "!" })

    expect(state).toEqual({ value: "h!" })
    expect(handleInputKey(state.value, { name: "return", sequence: "\r" })).toEqual({ value: "", submit: "h!" })
    expect(handleInputKey("   ", { name: "return", sequence: "\r" })).toEqual({ value: "" })
  })
})
