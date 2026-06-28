import type { JsonValue } from "./types"
import { recordOrNull as asRecord } from "./json"

export type NormalizedSessionUpdate =
  | { type: "agent-text"; text: string; messageId?: string }
  | { type: "thought"; text: string; messageId?: string }
  | { type: "tool"; text: string; toolCallId?: string; toolKind?: string; toolStatus?: string; toolTitle?: string; blocks?: NormalizedBlock[] }
  | { type: "plan"; text: string }
  | { type: "metadata"; text: string }
  | { type: "usage"; text: string }
  | { type: "status"; text: string }

export type NormalizedBlock =
  | { type: "text"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "diff"; path?: string; oldText?: string; newText?: string; patch?: string }

function textFromContent(content: unknown): string | null {
  const c = asRecord(content)
  if (!c) return null
  if (c.type === "text" && typeof c.text === "string") return c.text
  if (c.type === "code" && typeof c.text === "string") return c.text
  return null
}

function blockFromContent(content: unknown): NormalizedBlock | null {
  const c = asRecord(content)
  if (!c) return null
  if (c.type === "text" && typeof c.text === "string") return { type: "text", text: c.text }
  if (c.type === "code" && typeof c.text === "string") {
    return {
      type: "code",
      text: c.text,
      ...(typeof c.language === "string" ? { language: c.language } : {}),
    }
  }
  return null
}

function textFromBlock(block: NormalizedBlock): string {
  if (block.type === "text") return block.text
  if (block.type === "code") return `${block.language ? `code ${block.language}` : "code"}\n${block.text}`
  return block.path ? `diff ${block.path}` : "diff"
}

function formatToolContent(content: unknown): NormalizedBlock[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    if (record.type === "content") {
      const block = blockFromContent(record.content)
      return block ? [block] : []
    }
    if (record.type === "diff") {
      return [{
        type: "diff" as const,
        ...(typeof record.path === "string" ? { path: record.path } : {}),
        ...(typeof record.oldText === "string" ? { oldText: record.oldText } : {}),
        ...(typeof record.newText === "string" ? { newText: record.newText } : {}),
        ...(typeof record.patch === "string" ? { patch: record.patch } : {}),
      }]
    }
    if (record.type === "terminal" && typeof record.terminalId === "string") return [{ type: "text", text: `terminal ${record.terminalId}` }]
    return []
  })
}

export function normalizeSessionUpdate(method: string, params: JsonValue | undefined): NormalizedSessionUpdate | null {
  if (method !== "session/update" && method !== "_kiro.dev/session/update") return null

  const p = asRecord(params)
  const update = asRecord(p?.update)
  if (!update) return null

  const updateType = typeof update.sessionUpdate === "string"
    ? update.sessionUpdate
    : typeof update.type === "string" ? update.type : undefined

  if (updateType === "agent_message_chunk") {
    const text = typeof update.text === "string" ? update.text : textFromContent(update.content)
    if (text == null) return null
    return {
      type: "agent-text",
      text,
      ...(typeof update.messageId === "string" ? { messageId: update.messageId } : {}),
    }
  }

  if (updateType === "agent_thought_chunk") {
    const text = typeof update.text === "string" ? update.text : textFromContent(update.content)
    if (text == null) return null
    return {
      type: "thought",
      text,
      ...(typeof update.messageId === "string" ? { messageId: update.messageId } : {}),
    }
  }

  if (updateType === "plan") {
    const entries = Array.isArray(update.entries) ? update.entries : []
    const lines = entries.flatMap((entry) => {
      const e = asRecord(entry)
      if (!e || typeof e.content !== "string") return []
      const status = typeof e.status === "string" ? e.status : "pending"
      return [`[${status}] ${e.content}`]
    })
    return { type: "plan", text: lines.join("\n") }
  }

  if (updateType === "tool_call") {
    const kind = typeof update.kind === "string" ? update.kind : "tool"
    const status = typeof update.status === "string" ? update.status : "pending"
    const title = typeof update.title === "string" ? update.title : "tool call"
    return {
      type: "tool",
      text: `${kind} ${status}: ${title}`,
      ...(typeof update.toolCallId === "string" ? { toolCallId: update.toolCallId } : {}),
      toolKind: kind,
      toolStatus: status,
      toolTitle: title,
    }
  }

  if (updateType === "tool_call_update") {
    const status = typeof update.status === "string" ? update.status : "updated"
    const contentBlocks = formatToolContent(update.content)
    const statusBlock = contentBlocks.length ? { type: "text" as const, text: `${status}:` } : null
    const blocks = contentBlocks.length
      ? [
          ...(contentBlocks[0]?.type === "text" ? [{ type: "text" as const, text: `${status}: ${contentBlocks[0].text}` }, ...contentBlocks.slice(1)] : [statusBlock, ...contentBlocks]),
        ].filter((block): block is NormalizedBlock => block !== null)
      : []
    const lines = blocks.map(textFromBlock)
    return {
      type: "tool",
      text: lines.length ? lines.join("\n") : status,
      ...(blocks.length ? { blocks } : {}),
      ...(typeof update.toolCallId === "string" ? { toolCallId: update.toolCallId } : {}),
      toolStatus: status,
      ...(typeof update.title === "string" ? { toolTitle: update.title } : {}),
    }
  }

  if (updateType === "usage_update") {
    const used = typeof update.used === "number" ? update.used : 0
    const size = typeof update.size === "number" ? update.size : 0
    const cost = asRecord(update.cost)
    const costText = cost && typeof cost.amount === "number" && typeof cost.currency === "string"
      ? `, ${cost.amount} ${cost.currency}`
      : ""
    return { type: "metadata", text: `usage ${used}/${size} tokens${costText}` }
  }

  if (updateType === "available_commands_update") {
    return null
  }

  if (updateType === "current_mode_update" && typeof update.currentModeId === "string") {
    return { type: "metadata", text: `mode ${update.currentModeId}` }
  }

  return updateType ? { type: "status", text: `unhandled ${updateType}` } : null
}
