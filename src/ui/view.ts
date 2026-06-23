export type TranscriptKind = "user" | "agent" | "status" | "error" | "log"

export type TranscriptEntry = {
  kind: TranscriptKind
  text: string
}

export type TranscriptRow = {
  label: string
  text: string
  color: string
}

export type InputBar = {
  prompt: string
  value?: string
  promptColor: string
  valueColor?: string
}

export type InputKey = {
  name: string
  sequence: string
  ctrl?: boolean
  meta?: boolean
}

export type InputKeyResult = {
  value: string
  submit?: string
  activate?: "slash"
}

export type InputBarOptions = {
  cursorVisible?: boolean
}

export const opencodeTheme = {
  background: "#0a0a0a",
  backgroundPanel: "#141414",
  backgroundElement: "#1e1e1e",
  border: "#484848",
  borderActive: "#606060",
  borderSubtle: "#3c3c3c",
  primary: "#fab283",
  secondary: "#5c9cf5",
  accent: "#9d7cd8",
  success: "#7fd88f",
  error: "#e06c75",
  warning: "#f5a742",
  info: "#56b6c2",
  text: "#eeeeee",
  textMuted: "#808080",
} as const

export function buildTranscriptRows(entries: TranscriptEntry[]): TranscriptRow[] {
  return entries.map((entry) => {
    switch (entry.kind) {
      case "user":
        return { label: "● user", text: entry.text, color: opencodeTheme.success }
      case "agent":
        return { label: "◆ assistant", text: entry.text, color: opencodeTheme.primary }
      case "status":
        return { label: "● status", text: entry.text, color: opencodeTheme.secondary }
      case "error":
        return { label: "× error", text: entry.text, color: opencodeTheme.error }
      case "log":
        return { label: "· log", text: entry.text, color: opencodeTheme.textMuted }
    }
  })
}

export function buildInputBar(value = "", options: InputBarOptions = {}): InputBar {
  const displayValue = options.cursorVisible ? `${value}█` : value

  return {
    prompt: ">",
    ...(displayValue ? { value: displayValue, valueColor: opencodeTheme.text } : {}),
    promptColor: opencodeTheme.primary,
  }
}

export function handleInputKey(value: string, key: InputKey): InputKeyResult {
  if (key.ctrl || key.meta) {
    return { value }
  }

  if (key.name === "return") {
    const submit = value.trim()
    return submit ? { value: "", submit } : { value: "" }
  }

  if (key.name === "backspace") {
    return { value: value.slice(0, -1) }
  }

  if (key.name === "space") {
    return { value: `${value} ` }
  }

  if (key.sequence === "/" && value === "") {
    return { value: "/", activate: "slash" }
  }

  if (key.sequence.length === 1 && key.sequence >= " ") {
    return { value: `${value}${key.sequence}` }
  }

  return { value }
}
