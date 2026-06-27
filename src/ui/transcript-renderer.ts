import {
  BoxRenderable,
  CodeRenderable,
  DiffRenderable,
  TextRenderable,
  type Renderable,
  type createCliRenderer,
} from "@opentui/core"
import {
  getTranscriptLabel,
  opencodeTranscriptTheme,
  type TranscriptBlock,
  type TranscriptNode,
} from "./transcript"
import { filetype } from "./filetype"
import { summarizeText, type RenderContext } from "./render-diagnostics"
import { getSyntaxStyle } from "./syntax"

type CliRenderer = Awaited<ReturnType<typeof createCliRenderer>>
type BuildWithRenderContext = <T>(context: RenderContext, build: () => T) => T

type BuildTranscriptMessageOptions = {
  withRenderContext?: BuildWithRenderContext
}

function buildWithOptionalContext<T>(options: BuildTranscriptMessageOptions | undefined, context: RenderContext, build: () => T): T {
  return options?.withRenderContext ? options.withRenderContext(context, build) : build()
}

function buildTranscriptLabel(
  renderer: CliRenderer,
  node: TranscriptNode,
  index: number,
  label: string,
  color: string,
  text: string,
  wrapMode: "word" | "none" = "word",
  options?: BuildTranscriptMessageOptions,
): Renderable {
  const row = new BoxRenderable(renderer, {
    id: `transcript-${node.id}-row-${index}`,
    flexDirection: "row",
    width: "100%",
    gap: 1,
  })
  buildWithOptionalContext(options, {
    phase: "buildTranscriptLabel.label",
    nodeId: node.id,
    kind: node.kind,
    blockIndex: index,
    renderable: "TextRenderable",
    text: summarizeText(label),
  }, () => {
    row.add(new TextRenderable(renderer, {
      id: `transcript-${node.id}-row-${index}-label`,
      content: label.padEnd(12),
      fg: color,
      width: 13,
      wrapMode: "none",
      selectable: false,
    }))
  })
  buildWithOptionalContext(options, {
    phase: "buildTranscriptLabel.body",
    nodeId: node.id,
    kind: node.kind,
    blockIndex: index,
    renderable: "TextRenderable",
    text: summarizeText(text),
  }, () => {
    row.add(new TextRenderable(renderer, {
      id: `transcript-${node.id}-row-${index}-body`,
      content: text,
      fg: color,
      width: "100%",
      wrapMode,
    }))
  })
  return row
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
  label: string,
  color: string,
  options?: BuildTranscriptMessageOptions,
): Renderable {
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
      group.add(buildTranscriptLabel(renderer, node, blockIndex, label, color, block.language ? `code ${block.language}` : "code", "none", options))
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
      group.add(buildTranscriptLabel(renderer, node, blockIndex, label, color, block.path ? `diff ${block.path}` : "diff", "none", options))
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

  return buildTranscriptLabel(renderer, node, blockIndex, label, color, block.text, "word", options)
}

export function buildTranscriptMessage(renderer: CliRenderer, node: TranscriptNode, options?: BuildTranscriptMessageOptions): Renderable {
  const { label, color } = getTranscriptLabel(node.kind)
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
    ...(node.kind === "tool"
      ? { backgroundColor: "#101010", padding: 1 }
      : {}),
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
      nodeBox.add(buildTranscriptBlock(renderer, node, block, index, label, color, options))
    })
  })

  return nodeBox
}
