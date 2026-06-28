import {
  Box,
  BoxRenderable,
  ScrollBoxRenderable,
  Text,
  TextAttributes,
  TextRenderable,
  createCliRenderer,
  decodePasteBytes,
  fg,
  t,
  type KeyEvent,
} from "@opentui/core"
import {
  clampCommandSelectedIndex,
  getCommandItems,
  getSelectedCommandDescriptor,
  getSelectedDrilldownItem,
} from "./commands/items"
import { CommandRegistry } from "./commands/registry"
import { configCommandsFromOptions, type SessionConfigOption } from "./commands/acp"
import { transition, idle, type CommandOption, type CommandState, type CommandEvent } from "./commands/state"
import { buildDropdown } from "./ui/dropdown"
import { buildPalette } from "./ui/palette"
import { buildPanelOverlay } from "./ui/panel-overlay"
import { summarizeText, type RenderContext, type RenderDiagnostics } from "./ui/render-diagnostics"
import { createTextUi } from "./ui/text-ui"
import { buildTranscriptMessage } from "./ui/transcript-renderer"
import { buildInputBar, handleInputKey, opencodeTheme, type TranscriptEntry } from "./ui/view"
import {
  appendTranscriptEntry,
  createTranscriptState,
  finishAgentMessage as finishTranscriptAgentMessage,
  routeTranscriptScrollAction,
  updateActiveAgentMessage,
} from "./ui/transcript"

const SIDEBAR_AUTO_HIDE_WIDTH = 90
const TRANSCRIPT_PAGE_SCROLL_FRACTION = 0.5

type SidebarMode = "auto" | "forced-visible" | "forced-hidden"

export type UiOptions = {
  headless?: boolean
  agentLabel?: string
  registry?: CommandRegistry
  onFetchOptions?: (method: string) => Promise<CommandOption[]>
  onSetConfigOption?: (configId: string, value: string) => Promise<SessionConfigOption[]>
  renderer?: Awaited<ReturnType<typeof createCliRenderer>>
  diagnostics?: RenderDiagnostics
}

export type AgentClientUi = {
  isInteractive: boolean
  setStatus(status: string): void
  onSubmit(handler: (prompt: string, options?: { panel?: boolean }) => void | Promise<void>): void
  append(entry: TranscriptEntry): void
  updateLast(text: string): void
  finishAgentMessage(): void
  showPanel(title: string): void
  updatePanel(content: string): void
  hidePanel(): void
  toggleSidebar(): void
  destroy(): void
}

type TerminalFocusRenderer = {
  stdout?: Pick<NodeJS.WriteStream, "write">
}

function enableTerminalFocusReporting(renderer: TerminalFocusRenderer): () => void {
  const stdout = renderer.stdout ?? process.stdout
  stdout.write("\x1b[?1004h")

  let disabled = false
  return () => {
    if (disabled) return
    disabled = true
    stdout.write("\x1b[?1004l")
  }
}

export async function createAgentClientUi(options: UiOptions = {}): Promise<AgentClientUi> {
  if (options.headless) {
    return createTextUi()
  }

  let renderer: Awaited<ReturnType<typeof createCliRenderer>>

  if (options.renderer) {
    renderer = options.renderer
  } else {
    try {
      renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 })
    } catch (error) {
      process.stderr.write(`OpenTUI unavailable, falling back to text mode: ${(error as Error).message}\n`)
      return createTextUi()
    }
  }

  const disableTerminalFocusReporting = enableTerminalFocusReporting(renderer as unknown as TerminalFocusRenderer)

  let status = "starting"
  const agentLabel = options.agentLabel ?? "mock-agent"
  let inputValue = ""
  const promptHistory: string[] = []
  let historyIndex: number | null = null
  let historyDraft = ""
  let windowActive = true
  let cursorVisible = true
  let submitHandler: ((prompt: string, options?: { panel?: boolean }) => void | Promise<void>) | undefined
  let transcript = createTranscriptState()
  let commandState: CommandState = idle()
  const registry = options.registry ?? new CommandRegistry()
  const fetchOptions = options.onFetchOptions
  const diagnostics = options.diagnostics
  const setConfigOption = options.onSetConfigOption
  let panelOverlay: { title: string; content: string } | null = null
  let sidebarMode: SidebarMode = "auto"
  let pendingExit = false
  let transcriptScroll: ScrollBoxRenderable | undefined
  let transcriptContentVersion = 0
  let renderedTranscriptVersion = -1
  let renderedNodeCount = 0
  let activeStreamRenderable: TextRenderable | null = null
  let activeStreamNodeId: string | null = null
  let renderScheduled = false
  let currentRenderContext: RenderContext | undefined

  function setRenderContext(context: RenderContext): void {
    currentRenderContext = context
  }

  function clearRenderContext(): void {
    currentRenderContext = undefined
  }

  function buildWithRenderContext<T>(context: RenderContext, build: () => T): T {
    const previousContext = currentRenderContext
    setRenderContext(context)
    try {
      const renderable = build()
      currentRenderContext = previousContext
      return renderable
    } catch (error) {
      throw error
    }
  }

  function recordRenderError(err: unknown): void {
    try {
      void diagnostics?.recordRenderError(err, renderErrorSnapshot()).catch((logError) => {
        process.stderr.write(`[render diagnostics error] ${(logError as Error).message}\n`)
      })
    } catch (logError) {
      process.stderr.write(`[render diagnostics error] ${(logError as Error).message}\n`)
    }
  }

  function resetTranscriptRenderCache(): void {
    transcriptScroll?.destroyRecursively()
    transcriptScroll = undefined
    renderedTranscriptVersion = -1
    renderedNodeCount = 0
    activeStreamRenderable = null
    activeStreamNodeId = null
  }

  function renderErrorSnapshot() {
    return {
      status,
      terminal: {
        columns: process.stdout.columns,
        rows: process.stdout.rows,
      },
      transcript: {
        version: transcriptContentVersion,
        renderedNodeCount,
        nodeCount: transcript.nodes.length,
        ...(transcript.activeAgentNodeId ? { activeAgentNodeId: transcript.activeAgentNodeId } : {}),
      },
      ...(currentRenderContext ? { context: currentRenderContext } : {}),
    }
  }

  function mapKeyToCommandEvent(key: KeyEvent): CommandEvent | null {
    if (key.name === "escape") return { type: "esc" }
    if (key.name === "up") return { type: "arrow-up" }
    if (key.name === "down") return { type: "arrow-down" }
    if (key.name === "backspace") return { type: "backspace" }
    if (key.name === "return") {
      if (commandState.phase === "listing") {
        const selected = getSelectedCommandDescriptor(commandState, registry)
        if (selected) return { type: "select", command: selected }
      } else if (commandState.phase === "drilldown" && !commandState.loading) {
        const item = getSelectedDrilldownItem(commandState)
        if (item) return { type: "select-item", item }
      }
      return null
    }
    if (key.sequence && key.sequence.length === 1 && key.sequence >= " ") {
      return { type: "char", char: key.sequence }
    }
    return null
  }

  function resetPromptHistoryBrowse(): void {
    historyIndex = null
    historyDraft = ""
  }

  function shouldRememberPrompt(prompt: string): boolean {
    if (prompt.startsWith("/")) return false
    const descriptor = registry.get(prompt)
    return !(descriptor?.source === "local" && (descriptor.kind ?? "app") === "app")
  }

  function rememberPrompt(prompt: string): void {
    if (shouldRememberPrompt(prompt)) {
      promptHistory.push(prompt)
    }
    resetPromptHistoryBrowse()
  }

  function navigatePromptHistory(direction: "older" | "newer"): boolean {
    if (promptHistory.length === 0) return false

    if (direction === "older") {
      if (historyIndex === null) {
        historyDraft = inputValue
        historyIndex = promptHistory.length - 1
      } else {
        historyIndex = Math.max(0, historyIndex - 1)
      }
      inputValue = promptHistory[historyIndex] ?? ""
      return true
    }

    if (historyIndex === null) return false

    if (historyIndex >= promptHistory.length - 1) {
      inputValue = historyDraft
      resetPromptHistoryBrowse()
      return true
    }

    historyIndex += 1
    inputValue = promptHistory[historyIndex] ?? ""
    return true
  }

  function isNarrowSidebarWidth(): boolean {
    return renderer.width < SIDEBAR_AUTO_HIDE_WIDTH
  }

  function isSidebarVisible(): boolean {
    if (sidebarMode === "forced-visible") return true
    if (sidebarMode === "forced-hidden") return false
    return !isNarrowSidebarWidth()
  }

  function syncTranscript(): void {
    if (!transcriptScroll) return
    if (renderedTranscriptVersion === transcriptContentVersion) return

    // If the active streaming node changed, update its text in place
    if (activeStreamNodeId && transcript.activeAgentNodeId === activeStreamNodeId && activeStreamRenderable) {
      const node = transcript.nodes.find((n) => n.id === activeStreamNodeId)
      if (node && node.blocks[0]?.type === "text") {
        const streamRenderable = activeStreamRenderable
        const textBlock = node.blocks[0]
        buildWithRenderContext({
          phase: "syncTranscript.activeStream",
          nodeId: node.id,
          kind: node.kind,
          blockType: textBlock.type,
          blockIndex: 0,
          renderable: "TextRenderable",
          text: summarizeText(textBlock.text),
        }, () => {
          streamRenderable.content = textBlock.text
        })
        renderedTranscriptVersion = transcriptContentVersion
        return
      }
    }

    // Append only new nodes
    const nodes = transcript.nodes
    for (let i = renderedNodeCount; i < nodes.length; i++) {
      const node = nodes[i]
      if (!node) continue
      const msg = buildTranscriptMessage(renderer, node, { withRenderContext: buildWithRenderContext })
      const scroll = transcriptScroll
      buildWithRenderContext({
        phase: "syncTranscript.addNode",
        nodeId: node.id,
        kind: node.kind,
        renderable: "BoxRenderable",
      }, () => {
        scroll.add(msg)
      })

      // Track the active streaming node's text renderable
      if (node.id === transcript.activeAgentNodeId && node.kind === "agent") {
        activeStreamNodeId = node.id
        const nodeBox = msg as BoxRenderable
        const children = nodeBox.getChildren()
        if (children.length > 0) {
          const row = children[0] as BoxRenderable
          const rowChildren = row.getChildren()
          if (rowChildren.length > 1 && rowChildren[1] instanceof TextRenderable) {
            activeStreamRenderable = rowChildren[1]
          }
        }
      }
    }
    renderedNodeCount = nodes.length

    // If active agent finished, clear tracking
    if (!transcript.activeAgentNodeId) {
      activeStreamRenderable = null
      activeStreamNodeId = null
    }

    renderedTranscriptVersion = transcriptContentVersion
  }

  function handleTranscriptScrollKey(key: KeyEvent): boolean {
    if (!transcriptScroll) return false
    const action = routeTranscriptScrollAction(key.name, { panelOpen: panelOverlay !== null })

    if (action === "page-up") {
      const distance = Math.max(1, Math.floor(transcriptScroll.height * TRANSCRIPT_PAGE_SCROLL_FRACTION))
      transcriptScroll.scrollBy(-distance)
      return true
    }
    if (action === "page-down") {
      const distance = Math.max(1, Math.floor(transcriptScroll.height * TRANSCRIPT_PAGE_SCROLL_FRACTION))
      transcriptScroll.scrollBy(distance)
      return true
    }
    if (action === "top") {
      transcriptScroll.scrollTo({ x: transcriptScroll.scrollLeft, y: 0 })
      return true
    }
    if (action === "bottom") {
      transcriptScroll.scrollTo({ x: transcriptScroll.scrollLeft, y: transcriptScroll.scrollHeight })
      transcriptScroll.stickyScroll = true
      transcriptScroll.stickyStart = "bottom"
      return true
    }

    return false
  }

  function scheduleRender(): void {
    if (renderScheduled) return
    renderScheduled = true
    queueMicrotask(() => {
      renderScheduled = false
      render()
    })
  }

  function render(): void {
    try {
      const existingRoot = renderer.root.getRenderable("app-root")
      if (existingRoot) {
        transcriptScroll?.parent?.remove(transcriptScroll.id)
        existingRoot.destroyRecursively()
      }

    const inputBar = buildInputBar(inputValue, { cursorVisible: windowActive && cursorVisible })
    const cwdPath = process.cwd()

    const showPalette = commandState.phase !== "idle" && "surface" in commandState && commandState.surface === "palette"
    const showDropdown = commandState.phase !== "idle" && "surface" in commandState && commandState.surface === "dropdown"

    const mainContent = (() => {
      if (panelOverlay) {
        return Box(
          { flexDirection: "column", flexGrow: 1, width: "100%", alignItems: "center", padding: 1 },
          buildPanelOverlay(panelOverlay.title, panelOverlay.content),
        )
      }

      if (!transcriptScroll) {
        transcriptScroll = buildWithRenderContext({
          phase: "render.transcriptScroll",
          renderable: "ScrollBoxRenderable",
        }, () => new ScrollBoxRenderable(renderer, {
          id: "transcript-scroll",
          flexGrow: 1,
          width: "100%",
          scrollY: true,
          scrollX: false,
          stickyScroll: true,
          stickyStart: "bottom",
          viewportCulling: true,
          verticalScrollbarOptions: {
            showArrows: false,
          },
        }))
        transcriptScroll.focusable = false
      }
      syncTranscript()

      const sidebar = isSidebarVisible()
        ? Box(
            {
              flexDirection: "column",
              width: 34,
              backgroundColor: opencodeTheme.backgroundPanel,
              borderStyle: "single",
              borderColor: opencodeTheme.borderSubtle,
              padding: 1,
              gap: 1,
            },
            Text({ content: "session", fg: opencodeTheme.primary, attributes: TextAttributes.BOLD }),
            Text({ content: `status  ${status}`, fg: opencodeTheme.text }),
            Text({ content: `server  ${agentLabel}`, fg: opencodeTheme.textMuted }),
            Text({ content: "", fg: opencodeTheme.textMuted }),
            Text({ content: "capabilities", fg: opencodeTheme.accent }),
            Text({ content: "● prompt", fg: opencodeTheme.success }),
            Text({ content: "● stream", fg: opencodeTheme.success }),
            Text({ content: "· tools pending", fg: opencodeTheme.textMuted }),
          )
        : null

      return Box(
        { flexDirection: "row", flexGrow: 1, width: "100%", gap: 1 },
        Box(
          {
            flexDirection: "column",
            flexGrow: 1,
            backgroundColor: opencodeTheme.backgroundPanel,
            borderStyle: "single",
            borderColor: opencodeTheme.borderSubtle,
            padding: 1,
            gap: 0,
          },
          Box(
            { flexDirection: "column", flexGrow: 1, width: "100%" },
            Text({ content: "transcript", fg: opencodeTheme.textMuted }),
            transcriptScroll,
          ),
        ),
        sidebar,
      )
    })()

    const dropdownElement = showDropdown && (commandState.phase === "listing" || commandState.phase === "drilldown")
      ? buildDropdown(commandState, getCommandItems(commandState, registry))
      : null

    const paletteElement = showPalette && (commandState.phase === "listing" || commandState.phase === "drilldown")
      ? Box(
          {
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          },
          buildPalette(commandState, getCommandItems(commandState, registry)),
        )
      : null

    const inputElement = Box(
      {
        flexDirection: "row",
        width: "100%",
        minHeight: 3,
        backgroundColor: opencodeTheme.backgroundElement,
        borderStyle: "single",
        borderColor: opencodeTheme.borderSubtle,
        paddingLeft: 1,
        paddingRight: 1,
        gap: 1,
      },
      Text({ content: inputBar.prompt, fg: inputBar.promptColor, attributes: TextAttributes.BOLD }),
      Text({ content: inputBar.value ?? "", fg: inputBar.valueColor ?? opencodeTheme.text }),
    )

    const inputStack = Box(
      { position: "relative", flexDirection: "column", width: "100%", height: 3 },
      inputElement,
      dropdownElement
        ? Box(
            { position: "absolute", left: 0, right: 0, bottom: 3 },
            dropdownElement,
          )
        : null,
    )

    buildWithRenderContext({
      phase: "render.root.add",
      renderable: "BoxRenderable",
    }, () => {
      renderer.root.add(
        Box(
          {
            id: "app-root",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            backgroundColor: opencodeTheme.background,
            padding: 1,
            gap: 1,
          },
          Box(
            { flexDirection: "row", justifyContent: "space-between", width: "100%" },
            Text({ content: t`${fg(opencodeTheme.primary)("Agent")}Client${fg(opencodeTheme.accent)("TUI")}`, attributes: TextAttributes.BOLD }),
            Text({ content: `● ${status}`, fg: opencodeTheme.secondary }),
          ),
          mainContent,
          inputStack,
          Box(
            {
              flexDirection: "row",
              justifyContent: "space-between",
              width: "100%",
              backgroundColor: opencodeTheme.background,
            },
            Text({ content: cwdPath, fg: opencodeTheme.textMuted }),
            Text({ content: pendingExit ? "press Ctrl+C again to exit" : "/ commands · Ctrl+P palette · Ctrl+C exit", fg: pendingExit ? opencodeTheme.warning : opencodeTheme.textMuted }),
          ),
          paletteElement,
        ),
      )
    })
    clearRenderContext()
    } catch (err) {
      // Prevent permanent blank screen - attempt recovery on next frame
      process.stderr.write(`[render error] ${(err as Error).message}\n`)
      recordRenderError(err)
      resetTranscriptRenderCache()
      clearRenderContext()
    }
  }

  render()

  const blinkTimer = setInterval(() => {
    if (!windowActive) return
    cursorVisible = !cursorVisible
    render()
  }, 500)

  renderer.on("focus", () => {
    windowActive = true
    cursorVisible = true
    render()
  })

  renderer.on("blur", () => {
    windowActive = false
    cursorVisible = false
    render()
  })

  renderer.on("resize", () => {
    if (!isNarrowSidebarWidth()) {
      sidebarMode = "auto"
    }
    render()
  })

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.name === "c" && key.ctrl) {
      if (inputValue) {
        inputValue = ""
        pendingExit = false
      } else if (!pendingExit) {
        pendingExit = true
      } else {
        renderer.destroy()
        process.exit(0)
      }
      render()
      return
    }

    pendingExit = false

    if (key.name === "p" && key.ctrl) {
      const result = transition(commandState, { type: "ctrl-p" })
      commandState = result.state
      render()
      return
    }

    if (key.name === "escape" && panelOverlay) {
      panelOverlay = null
      render()
      return
    }

    if (commandState.phase !== "idle") {
      const event = mapKeyToCommandEvent(key)
      if (event) {
        const result = transition(commandState, event)
        commandState = result.state

        // Clamp selectedIndex to item bounds
        if (commandState.phase === "listing" || commandState.phase === "drilldown") {
          const itemCount = getCommandItems(commandState, registry).length
          commandState = clampCommandSelectedIndex(commandState, itemCount)
        }

        if (result.effect?.type === "execute") {
          const cmdText = result.effect.command
          const cmdName = cmdText.split(" ")[0]
          const descriptor = cmdName ? registry.get(cmdName) : undefined
          const isPanel = descriptor?.inputType === "panel"
          rememberPrompt(cmdText)
          if (submitHandler) void submitHandler(cmdText, { panel: isPanel })
          inputValue = ""
        } else if (result.effect?.type === "fetch-options" && fetchOptions) {
          const method = result.effect.method
          void (async () => {
            try {
              const items = await fetchOptions(method)
              if (commandState.phase === "drilldown") {
                const loaded = transition(commandState, { type: "options-loaded", items })
                commandState = loaded.state
                render()
              }
            } catch (error) {
              transcript = appendTranscriptEntry(transcript, { kind: "error", text: `Failed to fetch options: ${(error as Error).message}` })
              transcriptContentVersion += 1
              commandState = idle()
              render()
            }
          })()
        } else if (result.effect?.type === "set-config-option" && setConfigOption) {
          const { configId, value } = result.effect
          void (async () => {
            try {
              const configOptions = await setConfigOption(configId, value)
              registry.setConfigCommands(configCommandsFromOptions(configOptions))
              transcript = appendTranscriptEntry(transcript, { kind: "status", text: `set ${configId} to ${value}` })
              transcriptContentVersion += 1
              render()
            } catch (error) {
              transcript = appendTranscriptEntry(transcript, { kind: "error", text: `Failed to set ${configId}: ${(error as Error).message}` })
              transcriptContentVersion += 1
              render()
            }
          })()
        }

        // Sync inputValue with command query
        if (commandState.phase === "listing" && commandState.surface === "dropdown") {
          inputValue = `/${commandState.query}`
        } else if (commandState.phase === "drilldown" && commandState.surface === "dropdown") {
          inputValue = `${commandState.parent.name} ${commandState.query}`
        } else if (commandState.phase === "idle") {
          inputValue = ""
        }

        if (commandState.phase === "argument") {
          inputValue = commandState.commandText
          commandState = idle()
        }
      }
      render()
      return
    }

    if (key.name === "up" || key.name === "down") {
      const navigated = navigatePromptHistory(key.name === "up" ? "older" : "newer")
      if (navigated) {
        cursorVisible = true
        render()
        return
      }
    }

    if (handleTranscriptScrollKey(key)) {
      pendingExit = false
      render()
      return
    }

    const previousInputValue = inputValue
    const wasBrowsingPromptHistory = historyIndex !== null
    const result = handleInputKey(inputValue, key)
    inputValue = result.value
    if (wasBrowsingPromptHistory && (result.value !== previousInputValue || result.submit !== undefined || result.activate !== undefined)) {
      resetPromptHistoryBrowse()
    }
    cursorVisible = true

    if (result.activate === "slash") {
      const tr = transition(commandState, { type: "slash-typed" })
      commandState = tr.state
    }

    render()

    if (result.submit && submitHandler) {
      rememberPrompt(result.submit)
      void submitHandler(result.submit)
    }
  })

  renderer.keyInput.on("paste", (event: { bytes: Uint8Array }) => {
    const text = decodePasteBytes(event.bytes).replace(/\r\n?/g, " ")
    if (historyIndex !== null) resetPromptHistoryBrowse()
    inputValue += text
    cursorVisible = true
    render()
  })

  return {
    isInteractive: true,
    setStatus(nextStatus) {
      status = nextStatus
      render()
    },
    onSubmit(handler) {
      submitHandler = handler
    },
    append(entry) {
      transcript = appendTranscriptEntry(transcript, entry)
      transcriptContentVersion += 1
      render()
    },
    updateLast(text) {
      transcript = updateActiveAgentMessage(transcript, text)
      transcriptContentVersion += 1
      // Fast path: update text in place without full tree rebuild
      if (activeStreamRenderable && activeStreamNodeId === transcript.activeAgentNodeId) {
        const streamRenderable = activeStreamRenderable
        const streamNodeId = activeStreamNodeId
        try {
          buildWithRenderContext({
            phase: "updateLast.activeStream",
            nodeId: streamNodeId,
            kind: "agent",
            blockType: "text",
            blockIndex: 0,
            renderable: "TextRenderable",
            text: summarizeText(text),
          }, () => {
            streamRenderable.content = text
          })
          renderedTranscriptVersion = transcriptContentVersion
        } catch (err) {
          process.stderr.write(`[render error] ${(err as Error).message}\n`)
          recordRenderError(err)
          resetTranscriptRenderCache()
          clearRenderContext()
          scheduleRender()
        }
      } else {
        scheduleRender()
      }
    },
    finishAgentMessage() {
      transcript = finishTranscriptAgentMessage(transcript)
    },
    showPanel(title) {
      panelOverlay = { title, content: "" }
      render()
    },
    updatePanel(content) {
      if (panelOverlay) {
        panelOverlay.content = content
        render()
      }
    },
    hidePanel() {
      panelOverlay = null
      render()
    },
    toggleSidebar() {
      sidebarMode = isSidebarVisible() ? "forced-hidden" : "forced-visible"
      render()
    },
    destroy() {
      clearInterval(blinkTimer)
      disableTerminalFocusReporting()
      renderer.destroy()
    },
  }
}
