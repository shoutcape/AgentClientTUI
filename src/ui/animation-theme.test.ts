import { describe, expect, test } from "bun:test"
import {
  animationThemeNames,
  formatThemeCursor,
  formatThemeLoading,
  formatThemedInfoStatus,
  getAnimationTheme,
  getToolStatusIcon,
  isAnimationThemeName,
} from "./animation-theme"

describe("animation icon themes", () => {
  test("validates animation theme names", () => {
    expect(animationThemeNames).toEqual(["quiet", "playful", "operational", "cyber"])
    expect(isAnimationThemeName("quiet")).toBe(true)
    expect(isAnimationThemeName("cyber")).toBe(true)
    expect(isAnimationThemeName("unknown")).toBe(false)
  })

  test("looks up the quiet theme as the default-compatible theme", () => {
    const theme = getAnimationTheme("quiet")

    expect(theme.name).toBe("quiet")
    expect(theme.busyFrames[0]).toBe("⠋")
    expect(theme.statusIcons.ready).toBe("✓")
    expect(theme.staticBusyText).toBe("⋯ working")
  })

  test("formats animated and static info status", () => {
    const quiet = getAnimationTheme("quiet")
    const cyber = getAnimationTheme("cyber")

    expect(formatThemedInfoStatus(quiet, "prompting", 1, "noodling", true)).toBe("⠙ noodling")
    expect(formatThemedInfoStatus(quiet, "prompting", 1, "noodling", false)).toBe("⋯ working")
    expect(formatThemedInfoStatus(cyber, "prompting", 0, "scanning", true)).toBe("▰▱▱ scanning")
    expect(formatThemedInfoStatus(cyber, "ready", 0, "scanning", true)).toBe("󰄬 ready")
    expect(formatThemedInfoStatus(cyber, "failed", 0, "scanning", true)).toBe("󰅚 failed")
    expect(formatThemedInfoStatus(cyber, "launching", 0, "scanning", true)).toBe(" launching")
  })

  test("formats cursor and loading frames with reduced motion fallback", () => {
    const operational = getAnimationTheme("operational")

    expect(formatThemeCursor(operational, 0, true)).toBe("▌")
    expect(formatThemeCursor(operational, 1, true)).toBe("")
    expect(formatThemeCursor(operational, 3, false)).toBe("▌")
    expect(formatThemeLoading(operational, 2, true, "Loading options")).toBe("▝ Loading options")
    expect(formatThemeLoading(operational, 2, false, "Loading options")).toBe("󰔟 Loading options")
  })

  test("maps tool statuses to themed icons", () => {
    const playful = getAnimationTheme("playful")

    expect(getToolStatusIcon(playful, "pending")).toBe("󰇥")
    expect(getToolStatusIcon(playful, "running")).toBe("󰚩")
    expect(getToolStatusIcon(playful, "done")).toBe("󰄬")
    expect(getToolStatusIcon(playful, "failed")).toBe("󰅚")
    expect(getToolStatusIcon(playful, "blocked")).toBe("󰅚")
    expect(getToolStatusIcon(playful, "rejected")).toBe("󰅚")
    expect(getToolStatusIcon(playful, "updated")).toBe("󰚩")
  })
})
