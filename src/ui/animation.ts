export const opencodeSpinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

export const tinyLoaderFrames = {
  braille: opencodeSpinnerFrames,
  arc: ["◜", "◠", "◝", "◞", "◡", "◟"],
  moon: ["◐", "◓", "◑", "◒"],
  quarter: ["◴", "◷", "◶", "◵"],
  square: ["▖", "▘", "▝", "▗"],
  line: ["-", "\\", "|", "/"],
  diamond: ["◇", "◈", "◆", "◈"],
  pulse: ["░", "▒", "▓", "█", "▓", "▒"],
  arrows: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
} as const

export const workingWords = [
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

export function frameAt(frames: readonly string[], index: number): string {
  if (frames.length === 0) return ""
  const wrapped = ((index % frames.length) + frames.length) % frames.length
  return frames[wrapped] ?? ""
}

export function staticLoaderText(label?: string): string {
  return label ? `⋯ ${label}` : "⋯"
}

export function pickWorkingWord(random: () => number = Math.random): string {
  return workingWords[Math.min(workingWords.length - 1, Math.floor(random() * workingWords.length))] ?? workingWords[0]
}

export function formatInfoStatus(status: string, frameIndex: number, workingWord: string): string {
  if (status === "prompting") return `${frameAt(opencodeSpinnerFrames, frameIndex)} ${workingWord}`
  if (status === "ready") return "✓ ready"
  if (status === "failed") return "× failed"
  return `● ${status}`
}
