import { describe, expect, test } from "bun:test"
import { buildInputBar, buildTranscriptRows, handleInputKey, opencodeTheme } from "./view"

describe("OpenCode-inspired UI view model", () => {
  test("uses the OpenCode dark theme palette", () => {
    expect(opencodeTheme.background).toBe("#141414")
    expect(opencodeTheme.backgroundPanel).toBe("#141414")
    expect(opencodeTheme.primary).toBe("#fab283")
    expect(opencodeTheme.secondary).toBe("#5c9cf5")
    expect(opencodeTheme.accent).toBe("#9d7cd8")
    expect(opencodeTheme.textMuted).toBe("#808080")
    expect(opencodeTheme.user).toBe("#a78bfa")
    expect(opencodeTheme.userBorder).toBe("#4a3f62")
    expect(opencodeTheme.userBackground).toBe("#211a2e")
  })

  test("formats transcript entries with OpenCode-like labels", () => {
    expect(buildTranscriptRows([
      { kind: "user", text: "inspect repo" },
      { kind: "agent", text: "session/update: working" },
      { kind: "thought", text: "checking files" },
      { kind: "tool", text: "read completed" },
      { kind: "tool", blocks: [{ id: "code-1", type: "code", language: "ts", text: "const answer = 42" }] },
      { kind: "plan", text: "[pending] run tests" },
      { kind: "usage", text: "usage 10/100 tokens" },
      { kind: "log", text: "mock-agent: ready" },
    ])).toEqual([
      { label: "● user", text: "inspect repo", color: opencodeTheme.success },
      { label: "◆ assistant", text: "session/update: working", color: opencodeTheme.primary },
      { label: "◇ thought", text: "checking files", color: opencodeTheme.textMuted },
      { label: "◦ tool", text: "read completed", color: opencodeTheme.info },
      { label: "◦ tool", text: "code ts", color: opencodeTheme.info, wrapMode: "none" },
      { label: "", text: "  const answer = 42", color: opencodeTheme.text, wrapMode: "none" },
      { label: "□ plan", text: "[pending] run tests", color: opencodeTheme.secondary },
      { label: "↯ usage", text: "usage 10/100 tokens", color: opencodeTheme.warning },
      { label: "· log", text: "mock-agent: ready", color: opencodeTheme.textMuted },
    ])
  })

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
