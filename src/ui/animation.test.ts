import { describe, expect, test } from "bun:test"
import { frameAt, formatInfoStatus, opencodeSpinnerFrames, pickWorkingWord, staticLoaderText, tinyLoaderFrames, workingWords } from "./animation"

describe("terminal animation helpers", () => {
  test("uses the OpenCode braille spinner frames", () => {
    expect(opencodeSpinnerFrames).toEqual(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"])
  })

  test("wraps frame lookup in both directions", () => {
    expect(frameAt(["a", "b", "c"], 0)).toBe("a")
    expect(frameAt(["a", "b", "c"], 3)).toBe("a")
    expect(frameAt(["a", "b", "c"], -1)).toBe("c")
  })

  test("returns an empty frame for empty frame lists", () => {
    expect(frameAt([], 3)).toBe("")
  })

  test("formats static fallback loader text", () => {
    expect(staticLoaderText()).toBe("⋯")
    expect(staticLoaderText("Loading options")).toBe("⋯ Loading options")
  })

  test("keeps tiny loader presets one cell wide", () => {
    expect(tinyLoaderFrames.moon).toEqual(["◐", "◓", "◑", "◒"])
    for (const frames of Object.values(tinyLoaderFrames)) {
      for (const frame of frames) {
        expect(Array.from(frame)).toHaveLength(1)
      }
    }
  })

  test("picks working words deterministically from a random source", () => {
    expect(workingWords).toContain("noodling")
    expect(pickWorkingWord(() => 0)).toBe(workingWords[0])
    expect(pickWorkingWord(() => 0.999)).toBe("conjuring")
  })

  test("formats prompting with spinner frame and working word", () => {
    expect(formatInfoStatus("prompting", 1, "noodling")).toBe("⠙ noodling")
    expect(formatInfoStatus("ready", 1, "noodling")).toBe("✓ ready")
    expect(formatInfoStatus("failed", 1, "noodling")).toBe("× failed")
    expect(formatInfoStatus("starting", 1, "noodling")).toBe("● starting")
  })
})
