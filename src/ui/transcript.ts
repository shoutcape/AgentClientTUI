export type TranscriptKind = "user" | "agent" | "thought" | "tool" | "plan" | "usage" | "status" | "error" | "log"

export type TranscriptEntry = {
  kind: TranscriptKind
  text?: string
  blocks?: TranscriptBlock[]
}

export type TranscriptBlock =
  | { id?: string; type: "text"; text: string }
  | { id?: string; type: "status"; text: string }
  | { id?: string; type: "code"; text: string; language?: string }
  | { id?: string; type: "diff"; text?: undefined; path?: string; oldText?: string; newText?: string; patch?: string }

export type TranscriptNode = {
  id: string
  kind: TranscriptKind
  blocks: TranscriptBlock[]
}

export type TranscriptState = {
  nodes: TranscriptNode[]
  nextNodeId: number
  nextBlockId: number
  activeAgentNodeId?: string
}

export type TranscriptRow = {
  label: string
  text: string
  color: string
  wrapMode?: "word" | "none"
}

export type TranscriptScrollAction = "page-up" | "page-down" | "top" | "bottom"

export type TranscriptScrollRoutingContext = {
  panelOpen?: boolean
  commandActive?: boolean
}

export const opencodeTranscriptTheme = {
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

export function createTranscriptState(): TranscriptState {
  return { nodes: [], nextNodeId: 1, nextBlockId: 1 }
}

export function appendTranscriptEntry(state: TranscriptState, entry: TranscriptEntry): TranscriptState {
  const nodeId = `node-${state.nextNodeId}`
  const blocks = entry.blocks?.length
    ? entry.blocks.map((block, index) => ({ ...block, id: block.id || `block-${state.nextBlockId + index}` }))
    : [{ id: `block-${state.nextBlockId}`, type: "text" as const, text: entry.text ?? "" }]
  const node: TranscriptNode = {
    id: nodeId,
    kind: entry.kind,
    blocks,
  }

  const nextState: TranscriptState = {
    ...state,
    nodes: [...state.nodes, node],
    nextNodeId: state.nextNodeId + 1,
    nextBlockId: state.nextBlockId + blocks.length,
  }
  return entry.kind === "agent" ? { ...nextState, activeAgentNodeId: nodeId } : nextState
}

export function updateActiveAgentMessage(state: TranscriptState, text: string): TranscriptState {
  if (!state.activeAgentNodeId) return state

  return {
    ...state,
    nodes: state.nodes.map((node) => {
      if (node.id !== state.activeAgentNodeId || node.kind !== "agent") return node
      const [firstBlock, ...rest] = node.blocks
      if (!firstBlock || firstBlock.type !== "text") return node
      return { ...node, blocks: [{ ...firstBlock, text }, ...rest] }
    }),
  }
}

export function finishAgentMessage(state: TranscriptState): TranscriptState {
  if (!state.activeAgentNodeId) return state
  const { activeAgentNodeId: _activeAgentNodeId, ...nextState } = state
  return nextState
}

export function getTranscriptLabel(kind: TranscriptKind): { label: string; color: string } {
  switch (kind) {
    case "user":
      return { label: "● user", color: opencodeTranscriptTheme.success }
    case "agent":
      return { label: "◆ assistant", color: opencodeTranscriptTheme.primary }
    case "thought":
      return { label: "◇ thought", color: opencodeTranscriptTheme.textMuted }
    case "tool":
      return { label: "◦ tool", color: opencodeTranscriptTheme.info }
    case "plan":
      return { label: "□ plan", color: opencodeTranscriptTheme.secondary }
    case "usage":
      return { label: "↯ usage", color: opencodeTranscriptTheme.warning }
    case "status":
      return { label: "● status", color: opencodeTranscriptTheme.secondary }
    case "error":
      return { label: "× error", color: opencodeTranscriptTheme.error }
    case "log":
      return { label: "· log", color: opencodeTranscriptTheme.textMuted }
  }
}

function isTranscriptNode(item: TranscriptNode | TranscriptEntry): item is TranscriptNode {
  return "blocks" in item
}

export function buildTranscriptRows(items: Array<TranscriptNode | TranscriptEntry>): TranscriptRow[] {
  return items.flatMap((item) => {
    const { label, color } = getTranscriptLabel(item.kind)
    if (!isTranscriptNode(item)) {
      if (item.blocks?.length) return buildBlockRows(item.blocks, label, color)
      return [{ label, text: item.text ?? "", color }]
    }
    return buildBlockRows(item.blocks, label, color)
  })
}

function buildBlockRows(blocks: TranscriptBlock[], label: string, color: string): TranscriptRow[] {
  return blocks.flatMap((block) => {
    if (block.type === "code") {
      const header = block.language ? `code ${block.language}` : "code"
      return [
        { label, text: header, color, wrapMode: "none" as const },
        ...block.text.split("\n").map((line) => ({ label: "", text: `  ${line}`, color: opencodeTranscriptTheme.text, wrapMode: "none" as const })),
      ]
    }

    if (block.type === "diff") {
      const header = block.path ? `diff ${block.path}` : "diff"
      const lines = block.patch ? block.patch.split("\n") : [
        ...(block.oldText ? block.oldText.split("\n").map((line) => `- ${line}`) : []),
        ...(block.newText ? block.newText.split("\n").map((line) => `+ ${line}`) : []),
      ]
      return [
        { label, text: header, color, wrapMode: "none" as const },
        ...lines.map((line) => ({
          label: "",
          text: line,
          color: line.startsWith("-") ? opencodeTranscriptTheme.error : line.startsWith("+") ? opencodeTranscriptTheme.success : opencodeTranscriptTheme.textMuted,
          wrapMode: "none" as const,
        })),
      ]
    }

    return [{ label, text: block.text, color }]
  })
}

export function getTranscriptScrollAction(keyName: string): TranscriptScrollAction | null {
  switch (keyName) {
    case "pageup":
      return "page-up"
    case "pagedown":
      return "page-down"
    case "home":
      return "top"
    case "end":
      return "bottom"
    default:
      return null
  }
}

export function routeTranscriptScrollAction(
  keyName: string,
  context: TranscriptScrollRoutingContext = {},
): TranscriptScrollAction | null {
  if (context.panelOpen || context.commandActive) return null
  return getTranscriptScrollAction(keyName)
}
