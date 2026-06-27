import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

export type TextSummary = {
  chars: number
  lines: number
  preview: string
}

export type RenderContext = {
  phase: string
  nodeId?: string
  kind?: string
  blockId?: string
  blockType?: string
  blockIndex?: number
  renderable?: "TextRenderable" | "CodeRenderable" | "DiffRenderable" | "BoxRenderable" | "ScrollBoxRenderable"
  text?: TextSummary
}

export type RenderErrorSnapshot = {
  status: string
  terminal?: { columns?: number; rows?: number }
  transcript: {
    version: number
    renderedNodeCount: number
    nodeCount: number
    activeAgentNodeId?: string
  }
  context?: RenderContext
}

export type DiagnosticEvent = {
  ts: string
  event: string
  detail?: Record<string, unknown>
}

export type RenderDiagnostics = {
  logFile: string
  recordEvent(event: string, detail?: Record<string, unknown>): void
  recordRenderError(error: unknown, snapshot: RenderErrorSnapshot): Promise<void>
}

export type RenderDiagnosticsOptions = {
  logDir?: string
  agentLabel?: string
  now?: () => Date
  maxRecentEvents?: number
  home?: string
}

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|cookie)/i

export function summarizeText(text: string, maxPreview = 160): TextSummary {
  const escaped = redactTextPreview(text).replaceAll("\n", "\\n").replaceAll("\r", "\\r")

  return {
    chars: text.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
    preview: escaped.length > maxPreview ? `${escaped.slice(0, maxPreview)}...` : escaped,
  }
}

function redactTextPreview(text: string): string {
  return text
    .replace(/(authorization\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/((?:[a-z0-9_./-]*?(?:api[_-]?key|token|secret|password|cookie)[a-z0-9_./-]*?)\s*[=:]\s*)[^\s;&\r\n]+/gi, "$1[REDACTED]")
}

export function redactDiagnosticValue(value: unknown, home = process.env.HOME): unknown {
  return redactValue(value, home, undefined, new WeakSet<object>())
}

export function createRenderDiagnostics(options: RenderDiagnosticsOptions = {}): RenderDiagnostics {
  const logDir = options.logDir ?? join(process.cwd(), "tmp", "render-errors")
  const agentLabel = options.agentLabel ?? "unknown"
  const now = options.now ?? (() => new Date())
  const maxRecentEvents = options.maxRecentEvents ?? 50
  const home = options.home ?? process.env.HOME
  const logFile = join(logDir, `${timestampForFile(now())}.jsonl`)
  const recentEvents: DiagnosticEvent[] = []

  return {
    logFile,
    recordEvent(event, detail) {
      recentEvents.push({
        ts: now().toISOString(),
        event,
        ...(detail === undefined ? {} : { detail: redactDiagnosticValue(detail, home) as Record<string, unknown> }),
      })

      while (recentEvents.length > maxRecentEvents) {
        recentEvents.shift()
      }
    },
    async recordRenderError(error, snapshot) {
      const record = {
        ts: now().toISOString(),
        type: "render-error",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        agentLabel,
        ...snapshot,
        recentEvents,
      }
      const redactedRecord = redactDiagnosticValue(record, home)

      await mkdir(logDir, { recursive: true })
      await appendFile(logFile, `${JSON.stringify(redactedRecord)}\n`, "utf8")
    },
  }
}

function timestampForFile(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-")
}

function redactValue(value: unknown, home: string | undefined, key?: string, seen = new WeakSet<object>()): unknown {
  if (key !== undefined && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]"
  }

  if (typeof value === "string") {
    return home ? value.replaceAll(home, "$HOME") : value
  }

  if (typeof value === "bigint") {
    return `${value}n`
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]"
    }

    seen.add(value)
    try {
      return value.map((item) => redactValue(item, home, undefined, seen))
    } finally {
      seen.delete(value)
    }
  }

  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]"
    }

    seen.add(value)
    try {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, home, entryKey, seen)]),
      )
    } finally {
      seen.delete(value)
    }
  }

  return value
}
