export type TranscriptKind = "user" | "agent" | "thought" | "tool" | "plan" | "usage" | "status" | "error" | "log"

export type ToolDisplayType = "search" | "read" | "edit" | "shell" | "web" | "task" | "attention" | "tool"

export type ToolBurstStatus = "pending" | "running" | "done" | "failed" | "blocked" | "rejected" | "updated"

export type ToolBurstCall = {
  id: string
  displayType: ToolDisplayType
  status: ToolBurstStatus
  title: string
  startedAtMs: number
  updatedAtMs: number
  endedAtMs?: number
  rawKind?: string
  rawStatus?: string
  blocks?: TranscriptContentBlock[]
}

export type TranscriptEntry = {
  kind: TranscriptKind
  text?: string
  blocks?: TranscriptContentBlock[]
  toolCallId?: string
  toolKind?: string
  toolStatus?: string
  toolTitle?: string
}

export type TranscriptContentBlock =
  | { id?: string; type: "text"; text: string }
  | { id?: string; type: "status"; text: string }
  | { id?: string; type: "code"; text: string; language?: string }
  | { id?: string; type: "diff"; text?: undefined; path?: string; oldText?: string; newText?: string; patch?: string }

export type ToolBurstBlock = {
  id?: string
  type: "tool-burst"
  expanded: boolean
  currentCallId: string
  currentType: ToolDisplayType
  currentText: string
  currentTypeCount: number
  totalCount: number
  calls: ToolBurstCall[]
}

export type TranscriptBlock = TranscriptContentBlock | ToolBurstBlock

export type TranscriptNode = {
  id: string
  kind: TranscriptKind
  blocks: TranscriptBlock[]
}

export type TranscriptState = {
  nodes: TranscriptNode[]
  nextNodeId: number
  nextBlockId: number
  currentTimeMs: () => number
  activeAgentNodeId?: string
  activeToolBurstNodeId?: string
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
  background: "#141414",
  backgroundPanel: "#141414",
  backgroundElement: "#1e1e1e",
  border: "#484848",
  borderActive: "#606060",
  borderSubtle: "#3c3c3c",
  primary: "#fab283",
  secondary: "#5c9cf5",
  accent: "#9d7cd8",
  user: "#a78bfa",
  userBorder: "#4a3f62",
  userBackground: "#211a2e",
  success: "#7fd88f",
  error: "#e06c75",
  warning: "#f5a742",
  info: "#56b6c2",
  text: "#eeeeee",
  textMuted: "#808080",
} as const

export function createTranscriptState(currentTimeMs: () => number = Date.now): TranscriptState {
  return { nodes: [], nextNodeId: 1, nextBlockId: 1, currentTimeMs }
}

export function appendTranscriptEntry(state: TranscriptState, entry: TranscriptEntry): TranscriptState {
  if (entry.kind === "tool" && entry.toolCallId) return appendToolBurstEntry(state, { ...entry, toolCallId: entry.toolCallId })
  return appendStandardTranscriptEntry(state, entry)
}

function appendStandardTranscriptEntry(state: TranscriptState, entry: TranscriptEntry): TranscriptState {
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

function appendToolBurstEntry(state: TranscriptState, entry: TranscriptEntry & { toolCallId: string }): TranscriptState {
  const activeNode = state.nodes.find((node) => node.id === state.activeToolBurstNodeId)
  const activeBlock = activeNode?.blocks[0]
  const nowMs = state.currentTimeMs()

  if (!activeNode || !activeBlock || activeBlock.type !== "tool-burst") {
    const nodeId = `node-${state.nextNodeId}`
    const call = toolBurstCallFromEntry(entry, undefined, nowMs)
    const block = buildToolBurstBlock({
      id: `block-${state.nextBlockId}`,
      expanded: false,
      calls: [call],
      currentCallId: call.id,
    })
    return {
      ...state,
      nodes: [...state.nodes, { id: nodeId, kind: "tool", blocks: [block] }],
      nextNodeId: state.nextNodeId + 1,
      nextBlockId: state.nextBlockId + 1,
      activeToolBurstNodeId: nodeId,
    }
  }

  const nextBlock = updateToolBurstBlock(activeBlock, entry, nowMs)
  return {
    ...state,
    nodes: state.nodes.map((node) => node.id === activeNode.id ? { ...node, blocks: [nextBlock] } : node),
  }
}

function updateToolBurstBlock(block: ToolBurstBlock, entry: TranscriptEntry & { toolCallId: string }, nowMs: number): ToolBurstBlock {
  const index = block.calls.findIndex((call) => call.id === entry.toolCallId)
  const previous = index >= 0 ? block.calls[index] : undefined
  const nextCall = toolBurstCallFromEntry(entry, previous, nowMs)
  const calls = index >= 0
    ? block.calls.map((call, callIndex) => callIndex === index ? nextCall : call)
    : [...block.calls, nextCall]
  return buildToolBurstBlock({
    ...(block.id ? { id: block.id } : {}),
    expanded: block.expanded,
    calls,
    currentCallId: nextCall.id,
  })
}

function buildToolBurstBlock(input: Pick<ToolBurstBlock, "id" | "expanded" | "calls" | "currentCallId">): ToolBurstBlock {
  const currentCall = input.calls.find((call) => call.id === input.currentCallId) ?? input.calls[input.calls.length - 1]
  const currentType = currentCall?.displayType ?? "tool"
  const currentTypeCount = input.calls.filter((call) => call.displayType === currentType).length
  return {
    ...(input.id ? { id: input.id } : {}),
    type: "tool-burst",
    expanded: input.expanded,
    currentCallId: currentCall?.id ?? "tool",
    currentType,
    currentText: currentCall ? formatToolCallCurrentText(currentCall) : "tool",
    currentTypeCount,
    totalCount: input.calls.length,
    calls: input.calls,
  }
}

function toolBurstCallFromEntry(entry: TranscriptEntry & { toolCallId: string }, previous: ToolBurstCall | undefined, nowMs: number): ToolBurstCall {
  const status = normalizeToolBurstStatus(entry.toolStatus ?? previous?.rawStatus ?? entry.text)
  const title = normalizeToolTitle(entry, previous)
  const displayType = getToolDisplayType(entry, previous, status)
  const rawKind = entry.toolKind ?? previous?.rawKind
  const rawStatus = entry.toolStatus ?? previous?.rawStatus
  const endedAtMs = isTerminalToolBurstStatus(status) ? nowMs : previous?.endedAtMs
  const blocks = entry.blocks?.length
    ? entry.blocks.map((block) => ({ ...block }))
    : previous?.blocks ? previous.blocks.map((block) => ({ ...block })) : undefined
  return {
    id: entry.toolCallId,
    displayType,
    status,
    title,
    startedAtMs: previous?.startedAtMs ?? nowMs,
    updatedAtMs: nowMs,
    ...(endedAtMs !== undefined ? { endedAtMs } : {}),
    ...(rawKind ? { rawKind } : {}),
    ...(rawStatus ? { rawStatus } : {}),
    ...(blocks ? { blocks } : {}),
  }
}

function isTerminalToolBurstStatus(status: ToolBurstStatus): boolean {
  return status === "done" || status === "failed" || status === "blocked" || status === "rejected"
}

function normalizeToolBurstStatus(value: string | undefined): ToolBurstStatus {
  const lower = (value ?? "").toLowerCase()
  if (lower.includes("completed") || lower.includes("complete") || lower.includes("done") || lower.includes("success")) return "done"
  if (lower.includes("in_progress") || lower.includes("running") || lower.includes("started")) return "running"
  if (lower.includes("reject") || lower.includes("denied")) return "rejected"
  if (lower.includes("blocked") || lower.includes("permission")) return "blocked"
  if (lower.includes("fail") || lower.includes("error")) return "failed"
  if (lower.includes("pending")) return "pending"
  return "updated"
}

function normalizeToolTitle(entry: TranscriptEntry & { toolCallId: string }, previous?: ToolBurstCall): string {
  if (entry.toolTitle?.trim()) return entry.toolTitle.trim()
  if (previous?.title) return previous.title

  const text = (entry.text ?? "tool").trim()
  const colonIndex = text.indexOf(":")
  const title = colonIndex >= 0 ? text.slice(colonIndex + 1).trim() : text
  return title || "tool"
}

function getToolDisplayType(entry: TranscriptEntry & { toolCallId: string }, previous: ToolBurstCall | undefined, status: ToolBurstStatus): ToolDisplayType {
  if (status === "failed" || status === "blocked" || status === "rejected") return "attention"
  if (!entry.toolKind && !entry.toolTitle && previous?.displayType) return previous.displayType

  const haystack = `${entry.toolKind ?? ""} ${entry.toolTitle ?? ""} ${entry.text ?? ""}`.toLowerCase()
  if (hasAny(haystack, ["glob", "grep", "ast-grep", "file search", "search"])) return "search"
  if (hasAny(haystack, ["read", "resource", "docs"])) return "read"
  if (hasAny(haystack, ["apply_patch", "write", "edit", "format", "rename"])) return "edit"
  if (hasAny(haystack, ["bash", "shell", "command", "test", "typecheck", "build", "npm", "bun", "pnpm", "yarn"])) return "shell"
  if (hasAny(haystack, ["web", "fetch", "browser", "context7", "exa", "docs query"])) return "web"
  if (hasAny(haystack, ["task", "subagent", "agent", "skill"])) return "task"
  return previous?.displayType ?? "tool"
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}

function formatToolCallCurrentText(call: ToolBurstCall): string {
  if (!call.title) return call.displayType
  const lowerTitle = call.title.toLowerCase()
  if (call.displayType === "tool" || lowerTitle.startsWith(`${call.displayType} `)) return call.title
  return call.title
}

export function getToolDisplayTypeColor(type: ToolDisplayType): string {
  switch (type) {
    case "search":
      return opencodeTranscriptTheme.info
    case "read":
      return opencodeTranscriptTheme.secondary
    case "edit":
      return opencodeTranscriptTheme.success
    case "shell":
      return opencodeTranscriptTheme.warning
    case "web":
      return opencodeTranscriptTheme.accent
    case "task":
      return opencodeTranscriptTheme.user
    case "attention":
      return opencodeTranscriptTheme.error
    case "tool":
      return opencodeTranscriptTheme.info
  }
}

export function formatToolBurstSummary(block: ToolBurstBlock): string {
  const chevron = block.expanded ? "▾" : "▸"
  return `${chevron} Using tools  ● ${formatToolBurstTarget(block.currentText)}  ${block.currentType} · ${block.currentTypeCount}`
}

function formatToolBurstTarget(text: string): string {
  const width = 28
  if (text.length > width) return `${text.slice(0, width - 1)}…`
  return text.padEnd(width)
}

function formatToolCallCount(count: number): string {
  return `${count} ${count === 1 ? "call" : "calls"}`
}

export function formatToolBurstHistoryHeader(block: ToolBurstBlock): string {
  return `Tool history ${formatToolCallCount(block.totalCount)}`
}

export function formatToolBurstHistoryRow(call: ToolBurstCall): string {
  return `${call.displayType.padEnd(7)} ${call.status.padEnd(4)}  ${call.title}  ${formatToolBurstDuration(call)}`.trimEnd()
}

function formatToolBurstDuration(call: ToolBurstCall): string {
  const elapsedMs = Math.max(0, (call.endedAtMs ?? call.updatedAtMs) - call.startedAtMs)
  return `${(Math.round(elapsedMs / 100) / 10).toFixed(1)}s`
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
  if (!state.activeAgentNodeId && !state.activeToolBurstNodeId) return state
  const { activeAgentNodeId: _activeAgentNodeId, activeToolBurstNodeId: _activeToolBurstNodeId, ...nextState } = state
  return nextState
}

export function toggleLatestToolBurstExpansion(state: TranscriptState): TranscriptState {
  let index = -1
  for (let i = state.nodes.length - 1; i >= 0; i -= 1) {
    if (state.nodes[i]?.blocks.some((block) => block.type === "tool-burst")) {
      index = i
      break
    }
  }
  if (index < 0) return state

  return {
    ...state,
    nodes: state.nodes.map((node, nodeIndex) => {
      if (nodeIndex !== index) return node
      return {
        ...node,
        blocks: node.blocks.map((block) => block.type === "tool-burst" ? { ...block, expanded: !block.expanded } : block),
      }
    }),
  }
}

export function toggleToolBurstExpansionAtNode(state: TranscriptState, nodeId: string): TranscriptState {
  const target = state.nodes.find((node) => node.id === nodeId)
  if (!target?.blocks.some((block) => block.type === "tool-burst")) return state

  return {
    ...state,
    nodes: state.nodes.map((node) => {
      if (node.id !== nodeId) return node
      return {
        ...node,
        blocks: node.blocks.map((block) => block.type === "tool-burst" ? { ...block, expanded: !block.expanded } : block),
      }
    }),
  }
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
    if (block.type === "tool-burst") {
      const rows: TranscriptRow[] = [{ label, text: formatToolBurstSummary(block), color: getToolDisplayTypeColor(block.currentType), wrapMode: "none" }]
      if (!block.expanded) return rows
      rows.push({ label: "", text: formatToolBurstHistoryHeader(block), color, wrapMode: "none" })
      rows.push(...block.calls.map((call) => ({
        label: "",
        text: formatToolBurstHistoryRow(call),
        color: getToolDisplayTypeColor(call.displayType),
        wrapMode: "none" as const,
      })))
      return rows
    }

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
