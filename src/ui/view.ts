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
  cursor?: string
  promptColor: string
  valueColor?: string
  cursorColor?: string
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
  cursor?: string
}

export function buildInputBar(value = "", options: InputBarOptions = {}): InputBar {
  return {
    prompt: ">",
    ...(value ? { value, valueColor: opencodeTheme.text } : {}),
    ...(options.cursorVisible ? { cursor: options.cursor ?? "█", cursorColor: opencodeTheme.user } : {}),
    promptColor: opencodeTheme.user,
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
