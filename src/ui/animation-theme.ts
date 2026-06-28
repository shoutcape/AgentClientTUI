import { frameAt, opencodeSpinnerFrames } from "./animation"
import type { ToolBurstStatus } from "./transcript"

export const animationThemeNames = ["quiet", "playful", "operational", "cyber"] as const

export type AnimationThemeName = typeof animationThemeNames[number]

export type AnimationIconTheme = {
  name: AnimationThemeName
  busyFrames: readonly string[]
  loadingFrames: readonly string[]
  workingWords: readonly string[]
  cursorFrames: readonly string[]
  statusIcons: {
    ready: string
    failed: string
    generic: string
  }
  toolIcons: {
    running: string
    success: string
    error: string
    waiting: string
  }
  commandIcons: {
    loading: string
    selected: string
  }
  staticBusyText: string
}

const quietWorkingWords = [
  "pondering",
  "crunching",
  "spelunking",
  "noodling",
  "simmering",
  "scheming",
  "rummaging",
  "brewing",
  "wrangling",
  "conjuring",
] as const

export const animationThemes: Record<AnimationThemeName, AnimationIconTheme> = {
  quiet: {
    name: "quiet",
    busyFrames: opencodeSpinnerFrames,
    loadingFrames: ["◜", "◠", "◝", "◞", "◡", "◟"],
    workingWords: quietWorkingWords,
    cursorFrames: ["█", ""],
    statusIcons: { ready: "✓", failed: "×", generic: "●" },
    toolIcons: { running: "⠋", success: "✓", error: "×", waiting: "·" },
    commandIcons: { loading: "⋯", selected: ">" },
    staticBusyText: "⋯ working",
  },
  playful: {
    name: "playful",
    busyFrames: ["󰚩", "󰚪", "󰚫", "󰚬"],
    loadingFrames: ["󰇥", "󰇦", "󰇧", "󰇨"],
    workingWords: ["brewing", "summoning", "sparkling", "juggling", "wandering", "sketching"],
    cursorFrames: ["█", "▓", "▒", "░"],
    statusIcons: { ready: "󰄬", failed: "󰅚", generic: "󰚩" },
    toolIcons: { running: "󰚩", success: "󰄬", error: "󰅚", waiting: "󰇥" },
    commandIcons: { loading: "󰇥", selected: "󰜄" },
    staticBusyText: "󰚩 brewing",
  },
  operational: {
    name: "operational",
    busyFrames: ["󰝤", "󰝥", "󰝦", "󰝧"],
    loadingFrames: ["▖", "▘", "▝", "▗"],
    workingWords: ["routing", "indexing", "running", "checking", "resolving", "tracking"],
    cursorFrames: ["▌", ""],
    statusIcons: { ready: "󰄬", failed: "󰅚", generic: "󰙵" },
    toolIcons: { running: "󰏗", success: "󰄬", error: "󰅚", waiting: "󰔟" },
    commandIcons: { loading: "󰔟", selected: "󰜄" },
    staticBusyText: "󰙵 running",
  },
  cyber: {
    name: "cyber",
    busyFrames: ["▰▱▱", "▱▰▱", "▱▱▰", "▱▰▱"],
    loadingFrames: ["▰▱▱", "▱▰▱", "▱▱▰", "▱▰▱"],
    workingWords: ["scanning", "tracing", "syncing", "routing", "compiling", "charging"],
    cursorFrames: ["▰", "▱"],
    statusIcons: { ready: "󰄬", failed: "󰅚", generic: "" },
    toolIcons: { running: "󰊠", success: "󰄬", error: "󰅚", waiting: "󰌵" },
    commandIcons: { loading: "󰊠", selected: "" },
    staticBusyText: " scanning",
  },
}

export function isAnimationThemeName(value: string): value is AnimationThemeName {
  return (animationThemeNames as readonly string[]).includes(value)
}

export function getAnimationTheme(name: AnimationThemeName): AnimationIconTheme {
  return animationThemes[name]
}

export function pickThemeWorkingWord(theme: AnimationIconTheme, random: () => number = Math.random): string {
  return theme.workingWords[Math.min(theme.workingWords.length - 1, Math.floor(random() * theme.workingWords.length))] ?? theme.workingWords[0] ?? "working"
}

export function formatThemeCursor(theme: AnimationIconTheme, frameIndex: number, animationsEnabled: boolean): string {
  return animationsEnabled ? frameAt(theme.cursorFrames, frameIndex) : theme.cursorFrames[0] ?? "█"
}

export function formatThemeLoading(theme: AnimationIconTheme, frameIndex: number, animationsEnabled: boolean, label: string): string {
  const icon = animationsEnabled ? frameAt(theme.loadingFrames, frameIndex) : theme.commandIcons.loading
  return `${icon} ${label}`
}

export function getToolStatusIcon(theme: AnimationIconTheme, status: ToolBurstStatus): string {
  if (status === "pending") return theme.toolIcons.waiting
  if (status === "done") return theme.toolIcons.success
  if (status === "failed" || status === "blocked" || status === "rejected") return theme.toolIcons.error
  return theme.toolIcons.running
}

export function formatThemedInfoStatus(theme: AnimationIconTheme, status: string, frameIndex: number, workingWord: string, animationsEnabled: boolean): string {
  if (status === "prompting") {
    if (!animationsEnabled) return theme.staticBusyText
    return `${frameAt(theme.busyFrames, frameIndex)} ${workingWord}`
  }
  if (status === "ready") return `${theme.statusIcons.ready} ready`
  if (status === "failed") return `${theme.statusIcons.failed} failed`
  return `${theme.statusIcons.generic} ${status}`
}
