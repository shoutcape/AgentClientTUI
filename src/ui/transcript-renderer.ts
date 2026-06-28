import {
  BoxRenderable,
  CodeRenderable,
  DiffRenderable,
  TextRenderable,
  type Renderable,
  type createCliRenderer,
} from "@opentui/core"
import {
  formatToolBurstHistoryHeader,
  formatToolBurstHistoryRow,
  formatToolBurstSummary,
  getToolDisplayTypeColor,
  opencodeTranscriptTheme,
  type TranscriptBlock,
  type TranscriptKind,
  type TranscriptNode,
} from "./transcript"
import { getToolStatusIcon, type AnimationIconTheme } from "./animation-theme"
import { filetype } from "./filetype"
import { summarizeText, type RenderContext } from "./render-diagnostics"
import { getSyntaxStyle } from "./syntax"

type CliRenderer = Awaited<ReturnType<typeof createCliRenderer>>
type BuildWithRenderContext = <T>(context: RenderContext, build: () => T) => T

type BuildTranscriptMessageOptions = {
  withRenderContext?: BuildWithRenderContext
  onToolBurstMouseUp?: (nodeId: string) => void
  animationTheme?: AnimationIconTheme
}

type TranscriptSurfaceTreatment = "plain" | "event" | "muted-event" | "strong-event"

type TranscriptSurface = {
  treatment: TranscriptSurfaceTreatment
  fg: string
  strip?: string
  background?: string
}

const quietTranscriptSurfaces: Record<TranscriptKind, TranscriptSurface> = {
  agent: { treatment: "plain", fg: opencodeTranscriptTheme.text },
  user: { treatment: "event", fg: opencodeTranscriptTheme.text, strip: opencodeTranscriptTheme.user, background: opencodeTranscriptTheme.userBackground },
  tool: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.info, background: "#10191b" },
  status: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.secondary, background: "#111826" },
  log: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.textMuted, background: "#111111" },
  thought: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.accent, background: "#15111e" },
  plan: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.secondary, background: "#111826" },
  usage: { treatment: "muted-event", fg: opencodeTranscriptTheme.textMuted, strip: opencodeTranscriptTheme.warning, background: "#211a10" },
  error: { treatment: "strong-event", fg: opencodeTranscriptTheme.error, strip: opencodeTranscriptTheme.error, background: "#2a1114" },
}

const TOOL_BURST_HOVER_BACKGROUND = "#16282b"

function getTranscriptSurface(kind: TranscriptKind): TranscriptSurface {
  return quietTranscriptSurfaces[kind]
}

function transcriptBlockKey(block: TranscriptBlock, blockIndex: number): string {
  return block.id ?? String(blockIndex)
}

function transcriptTextId(nodeId: string, blockKey: string): string {
  return `transcript-${nodeId}-text-${blockKey}`
}

function transcriptEventId(nodeId: string, blockKey: string): string {
  return `transcript-${nodeId}-event-${blockKey}`
}

function transcriptStripId(nodeId: string, blockKey: string): string {
  return `transcript-${nodeId}-strip-${blockKey}`
}

function transcriptEventBodyId(nodeId: string, blockKey: string): string {
  return `transcript-${nodeId}-event-body-${blockKey}`
}

export function getTranscriptActiveTextRenderable(message: Renderable, node: TranscriptNode): TextRenderable | null {
  const [firstBlock] = node.blocks
  if (!firstBlock || firstBlock.type !== "text") return null

  const findDescendantById = (message as { findDescendantById?: (id: string) => unknown }).findDescendantById
  const renderable = findDescendantById?.call(message, transcriptTextId(node.id, transcriptBlockKey(firstBlock, 0)))
  return renderable instanceof TextRenderable ? renderable : null
}

function buildWithOptionalContext<T>(options: BuildTranscriptMessageOptions | undefined, context: RenderContext, build: () => T): T {
  return options?.withRenderContext ? options.withRenderContext(context, build) : build()
}

function buildPlainTextSurface(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: Extract<TranscriptBlock, { type: "text" | "status" }>,
  blockIndex: number,
  surface: TranscriptSurface,
  wrapMode: "word" | "none" = "word",
  options?: BuildTranscriptMessageOptions,
): Renderable {
  return buildWithOptionalContext(options, {
    phase: "buildPlainTextSurface.text",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "TextRenderable",
    text: summarizeText(block.text),
  }, () => new TextRenderable(renderer, {
    id: transcriptTextId(node.id, transcriptBlockKey(block, blockIndex)),
    content: block.text,
    fg: surface.fg,
    width: "100%",
    wrapMode,
  }))
}

function buildEventStripSurface(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: Extract<TranscriptBlock, { type: "text" | "status" }>,
  blockIndex: number,
  surface: TranscriptSurface,
  wrapMode: "word" | "none" = "word",
  options?: BuildTranscriptMessageOptions,
): Renderable {
  const blockKey = transcriptBlockKey(block, blockIndex)
  const event = new BoxRenderable(renderer, {
    id: transcriptEventId(node.id, blockKey),
    flexDirection: "row",
    width: "100%",
    backgroundColor: surface.background ?? opencodeTranscriptTheme.backgroundPanel,
  })

  buildWithOptionalContext(options, {
    phase: "buildEventStripSurface.strip",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "BoxRenderable",
  }, () => {
    event.add(new BoxRenderable(renderer, {
      id: transcriptStripId(node.id, blockKey),
      width: 1,
      flexShrink: 0,
      backgroundColor: opencodeTranscriptTheme.background,
      border: ["left"],
      borderStyle: "heavy",
      borderColor: surface.strip ?? surface.fg,
    }))
  })

  const body = new BoxRenderable(renderer, {
    id: transcriptEventBodyId(node.id, blockKey),
    flexDirection: "column",
    flexGrow: 1,
    paddingTop: 1,
    paddingLeft: 1,
    paddingRight: 1,
    paddingBottom: 1,
  })

  buildWithOptionalContext(options, {
    phase: "buildEventStripSurface.text",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "TextRenderable",
    text: summarizeText(block.text),
  }, () => {
    body.add(new TextRenderable(renderer, {
      id: transcriptTextId(node.id, blockKey),
      content: block.text,
      fg: surface.fg,
      width: "100%",
      wrapMode,
    }))
  })

  buildWithOptionalContext(options, {
    phase: "buildEventStripSurface.body",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "BoxRenderable",
  }, () => {
    event.add(body)
  })

  return event
}

function buildToolBurstSurface(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: Extract<TranscriptBlock, { type: "tool-burst" }>,
  blockIndex: number,
  surface: TranscriptSurface,
  options?: BuildTranscriptMessageOptions,
): Renderable {
  const blockKey = transcriptBlockKey(block, blockIndex)
  const onMouseUp = options?.onToolBurstMouseUp
    ? () => {
        if (renderer.getSelection()?.getSelectedText()) return
        options.onToolBurstMouseUp?.(node.id)
      }
    : undefined
  const event = new BoxRenderable(renderer, {
    id: transcriptEventId(node.id, blockKey),
    flexDirection: "row",
    width: "100%",
    backgroundColor: surface.background ?? opencodeTranscriptTheme.backgroundPanel,
    ...(onMouseUp ? { onMouseUp } : {}),
  })
  const baseBackground = surface.background ?? opencodeTranscriptTheme.backgroundPanel
  const onMouseOver = onMouseUp ? () => { event.backgroundColor = TOOL_BURST_HOVER_BACKGROUND } : undefined
  const onMouseOut = onMouseUp ? () => { event.backgroundColor = baseBackground } : undefined
  if (onMouseOver) event.onMouseOver = onMouseOver
  if (onMouseOut) event.onMouseOut = onMouseOut

  buildWithOptionalContext(options, {
    phase: "buildToolBurstSurface.strip",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "BoxRenderable",
  }, () => {
    event.add(new BoxRenderable(renderer, {
      id: transcriptStripId(node.id, blockKey),
      width: 1,
      flexShrink: 0,
      backgroundColor: opencodeTranscriptTheme.background,
      border: ["left"],
      borderStyle: "heavy",
      borderColor: surface.strip ?? surface.fg,
      ...(onMouseUp ? { onMouseUp } : {}),
      ...(onMouseOver ? { onMouseOver } : {}),
      ...(onMouseOut ? { onMouseOut } : {}),
    }))
  })

  const body = new BoxRenderable(renderer, {
    id: transcriptEventBodyId(node.id, blockKey),
    flexDirection: "column",
    flexGrow: 1,
    paddingTop: 1,
    paddingLeft: 1,
    paddingRight: 1,
    paddingBottom: 1,
    ...(onMouseUp ? { onMouseUp } : {}),
    ...(onMouseOver ? { onMouseOver } : {}),
    ...(onMouseOut ? { onMouseOut } : {}),
  })

  const currentCall = block.calls.find((call) => call.id === block.currentCallId) ?? block.calls[block.calls.length - 1]
  const summaryIcon = currentCall && options?.animationTheme ? `${getToolStatusIcon(options.animationTheme, currentCall.status)} ` : ""
  const rows = [
    { text: `${summaryIcon}${formatToolBurstSummary(block)}`, color: surface.fg, suffix: "summary" },
    ...(block.expanded ? [
      { text: formatToolBurstHistoryHeader(block), color: surface.fg, suffix: "history-header" },
      ...block.calls.map((call, callIndex) => {
        const icon = options?.animationTheme ? `${getToolStatusIcon(options.animationTheme, call.status)} ` : ""
        return {
          text: `${icon}${formatToolBurstHistoryRow(call)}`,
          color: getToolDisplayTypeColor(call.displayType),
          suffix: `history-${callIndex}`,
        }
      }),
    ] : []),
  ]

  rows.forEach((row, rowIndex) => {
    buildWithOptionalContext(options, {
      phase: "buildToolBurstSurface.text",
      nodeId: node.id,
      kind: node.kind,
      blockIndex,
      renderable: "TextRenderable",
      text: summarizeText(row.text),
    }, () => {
      body.add(new TextRenderable(renderer, {
        id: `transcript-${node.id}-tool-burst-${blockKey}-${row.suffix}`,
        content: row.text,
        fg: row.color,
        width: "100%",
        wrapMode: "none",
        selectable: rowIndex === 0,
        ...(rowIndex === 0 && onMouseUp ? { onMouseUp } : {}),
        ...(rowIndex === 0 && onMouseOver ? { onMouseOver } : {}),
        ...(rowIndex === 0 && onMouseOut ? { onMouseOut } : {}),
      }))
    })
  })

  buildWithOptionalContext(options, {
    phase: "buildToolBurstSurface.body",
    nodeId: node.id,
    kind: node.kind,
    blockIndex,
    renderable: "BoxRenderable",
  }, () => {
    event.add(body)
  })

  return event
}

function buildCodeMetadata(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: TranscriptBlock,
  blockIndex: number,
  text: string,
  surface: TranscriptSurface,
  options?: BuildTranscriptMessageOptions,
): Renderable {
  return buildWithOptionalContext(options, {
    phase: "buildCodeMetadata.text",
    nodeId: node.id,
    kind: node.kind,
    ...(block.id ? { blockId: block.id } : {}),
    blockType: block.type,
    blockIndex,
    renderable: "TextRenderable",
    text: summarizeText(text),
  }, () => new TextRenderable(renderer, {
    id: `transcript-${node.id}-metadata-${transcriptBlockKey(block, blockIndex)}`,
    content: text,
    fg: surface.fg,
    width: "100%",
    wrapMode: "none",
    selectable: false,
  }))
}

function buildUnifiedDiff(block: Extract<TranscriptBlock, { type: "diff" }>): string {
  if (block.patch) return block.patch
  const oldLines = (block.oldText ?? "").split("\n")
  const newLines = (block.newText ?? "").split("\n")
  const path = block.path ?? "diff"
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${Math.max(oldLines.length, 1)} +1,${Math.max(newLines.length, 1)} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n")
}

function buildTranscriptBlock(
  renderer: CliRenderer,
  node: TranscriptNode,
  block: TranscriptBlock,
  blockIndex: number,
  surface: TranscriptSurface,
  options?: BuildTranscriptMessageOptions,
): Renderable {
  if (block.type === "tool-burst") {
    return buildToolBurstSurface(renderer, node, block, blockIndex, surface, options)
  }

  if (block.type === "code") {
    const group = new BoxRenderable(renderer, {
      id: `transcript-${node.id}-block-${block.id ?? blockIndex}`,
      flexDirection: "column",
      width: "100%",
    })
    buildWithOptionalContext(options, {
      phase: "buildTranscriptBlock.addLabel",
      nodeId: node.id,
      kind: node.kind,
      ...(block.id ? { blockId: block.id } : {}),
      blockType: block.type,
      blockIndex,
      renderable: "BoxRenderable",
    }, () => {
      group.add(buildCodeMetadata(renderer, node, block, blockIndex, block.language ? `code ${block.language}` : "code", surface, options))
    })
    buildWithOptionalContext(options, {
      phase: "buildTranscriptBlock.code",
      nodeId: node.id,
      kind: node.kind,
      ...(block.id ? { blockId: block.id } : {}),
      blockType: block.type,
      blockIndex,
      renderable: "CodeRenderable",
      text: summarizeText(block.text),
    }, () => {
      group.add(new CodeRenderable(renderer, {
        id: `transcript-${node.id}-code-${block.id ?? blockIndex}`,
        content: block.text,
        filetype: filetype(block.language),
        syntaxStyle: getSyntaxStyle(),
        fg: opencodeTranscriptTheme.text,
        width: "100%",
        wrapMode: "none",
        conceal: false,
      }))
    })
    return group
  }

  if (block.type === "diff") {
    const group = new BoxRenderable(renderer, {
      id: `transcript-${node.id}-block-${block.id ?? blockIndex}`,
      flexDirection: "column",
      width: "100%",
    })
    buildWithOptionalContext(options, {
      phase: "buildTranscriptBlock.addLabel",
      nodeId: node.id,
      kind: node.kind,
      ...(block.id ? { blockId: block.id } : {}),
      blockType: block.type,
      blockIndex,
      renderable: "BoxRenderable",
    }, () => {
      group.add(buildCodeMetadata(renderer, node, block, blockIndex, block.path ? `diff ${block.path}` : "diff", surface, options))
    })
    const diff = buildUnifiedDiff(block)
    buildWithOptionalContext(options, {
      phase: "buildTranscriptBlock.diff",
      nodeId: node.id,
      kind: node.kind,
      ...(block.id ? { blockId: block.id } : {}),
      blockType: block.type,
      blockIndex,
      renderable: "DiffRenderable",
      text: summarizeText(diff),
    }, () => {
      group.add(new DiffRenderable(renderer, {
        id: `transcript-${node.id}-diff-${block.id ?? blockIndex}`,
        diff,
        filetype: filetype(block.path),
        syntaxStyle: getSyntaxStyle(),
        view: "unified",
        showLineNumbers: true,
        width: "100%",
        wrapMode: "none",
        fg: opencodeTranscriptTheme.text,
        addedBg: "#14331c",
        removedBg: "#3a1518",
        contextBg: opencodeTranscriptTheme.backgroundPanel,
        addedSignColor: opencodeTranscriptTheme.success,
        removedSignColor: opencodeTranscriptTheme.error,
        lineNumberFg: opencodeTranscriptTheme.textMuted,
        lineNumberBg: opencodeTranscriptTheme.backgroundPanel,
        addedLineNumberBg: "#14331c",
        removedLineNumberBg: "#3a1518",
      }))
    })
    return group
  }

  return surface.treatment === "plain"
    ? buildPlainTextSurface(renderer, node, block, blockIndex, surface, "word", options)
    : buildEventStripSurface(renderer, node, block, blockIndex, surface, "word", options)
}

export function buildTranscriptMessage(renderer: CliRenderer, node: TranscriptNode, options?: BuildTranscriptMessageOptions): Renderable {
  const surface = getTranscriptSurface(node.kind)
  const nodeBox = buildWithOptionalContext(options, {
    phase: "buildTranscriptMessage.node",
    nodeId: node.id,
    kind: node.kind,
    renderable: "BoxRenderable",
  }, () => new BoxRenderable(renderer, {
    id: `transcript-${node.id}`,
    flexDirection: "column",
    width: "100%",
    gap: 1,
    marginBottom: 1,
  }))

  node.blocks.forEach((block, index) => {
    buildWithOptionalContext(options, {
      phase: "buildTranscriptMessage.addBlock",
      nodeId: node.id,
      kind: node.kind,
      blockType: block.type,
      blockIndex: index,
      renderable: "BoxRenderable",
    }, () => {
      nodeBox.add(buildTranscriptBlock(renderer, node, block, index, surface, options))
    })
  })

  return nodeBox
}
