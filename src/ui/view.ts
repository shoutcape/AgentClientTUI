import { opencodeTranscriptTheme as opencodeTheme } from "./transcript"

export {
  buildTranscriptRows,
  type TranscriptEntry,
  type TranscriptKind,
  type TranscriptRow,
} from "./transcript"

export { opencodeTheme }

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
