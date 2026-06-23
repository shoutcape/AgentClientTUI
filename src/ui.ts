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
  type Renderable,
} from "@opentui/core"
import { CommandRegistry } from "./commands/registry"
import { transition, idle, type CommandItem, type CommandOption, type CommandState, type CommandEvent } from "./commands/state"
import { buildDropdown } from "./ui/dropdown"
import { buildPalette } from "./ui/palette"
import { buildPanelOverlay } from "./ui/panel-overlay"
import { buildInputBar, buildTranscriptRows, handleInputKey, opencodeTheme, type TranscriptEntry } from "./ui/view"
import {
  appendTranscriptEntry,
  createTranscriptState,
  finishAgentMessage as finishTranscriptAgentMessage,
  routeTranscriptScrollAction,
  updateActiveAgentMessage,
  type TranscriptNode,
} from "./ui/transcript"

export type UiOptions = {
  headless?: boolean
  registry?: CommandRegistry
  onFetchOptions?: (method: string) => Promise<CommandOption[]>
  renderer?: Awaited<ReturnType<typeof createCliRenderer>>
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
  destroy(): void
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

  let status = "starting"
  let inputValue = ""
  let windowActive = true
  let cursorVisible = true
  let submitHandler: ((prompt: string, options?: { panel?: boolean }) => void | Promise<void>) | undefined
  let transcript = createTranscriptState()
  let commandState: CommandState = idle()
  const registry = options.registry ?? new CommandRegistry()
  const fetchOptions = options.onFetchOptions
  let panelOverlay: { title: string; content: string } | null = null
  let pendingExit = false
  let transcriptScroll: ScrollBoxRenderable | undefined
  let transcriptContentVersion = 0
  let renderedTranscriptVersion = -1

  function getItemLabel(item: CommandItem): string {
    return typeof item === "string" ? item : item.label
  }

  function getItemDescription(item: CommandItem): string {
    return typeof item === "string" ? "" : item.description ?? ""
  }

  function getCommandItems(): Array<{ name: string; description: string }> {
    if (commandState.phase === "listing") {
      const source = commandState.surface === "dropdown" ? "acp" as const : undefined
      return registry.search(commandState.query, source ? { source } : undefined).map((c) => ({ name: c.name, description: c.description }))
    }
    if (commandState.phase === "drilldown") {
      const q = commandState.query.toLowerCase()
      return commandState.items
        .filter((i) => {
          const label = getItemLabel(i).toLowerCase()
          const value = typeof i === "string" ? i.toLowerCase() : i.value.toLowerCase()
          return !q || label.includes(q) || value.includes(q)
        })
        .map((i) => ({ name: getItemLabel(i), description: getItemDescription(i) }))
    }
    return []
  }

  function mapKeyToCommandEvent(key: KeyEvent): CommandEvent | null {
    if (key.name === "escape") return { type: "esc" }
    if (key.name === "up") return { type: "arrow-up" }
    if (key.name === "down") return { type: "arrow-down" }
    if (key.name === "backspace") return { type: "backspace" }
    if (key.name === "return") {
      if (commandState.phase === "listing") {
        const items = registry.search(
          commandState.query,
          commandState.surface === "dropdown" ? { source: "acp" } : undefined,
        )
        const selected = items[commandState.selectedIndex]
        if (selected) return { type: "select", command: selected }
      } else if (commandState.phase === "drilldown" && !commandState.loading) {
        const q = commandState.query.toLowerCase()
        const filtered = commandState.items.filter((item) => {
          const label = getItemLabel(item).toLowerCase()
          const value = typeof item === "string" ? item.toLowerCase() : item.value.toLowerCase()
          return !q || label.includes(q) || value.includes(q)
        })
        const item = filtered[commandState.selectedIndex]
        if (item) return { type: "select-item", item }
      }
      return null
    }
    if (key.sequence && key.sequence.length === 1 && key.sequence >= " ") {
      return { type: "char", char: key.sequence }
    }
    return null
  }

  function buildTranscriptMessage(node: TranscriptNode): Renderable {
    const rows = buildTranscriptRows([node])
    const nodeBox = new BoxRenderable(renderer, {
      id: `transcript-${node.id}`,
      flexDirection: "column",
      width: "100%",
    })

    rows.forEach((transcriptRow, index) => {
      const row = new BoxRenderable(renderer, {
        id: `transcript-${node.id}-row-${index}`,
        flexDirection: "row",
        width: "100%",
        gap: 1,
      })
      row.add(new TextRenderable(renderer, {
        id: `transcript-${node.id}-row-${index}-label`,
        content: transcriptRow.label.padEnd(12),
        fg: transcriptRow.color,
        width: 13,
        wrapMode: "none",
        selectable: false,
      }))
      row.add(new TextRenderable(renderer, {
        id: `transcript-${node.id}-row-${index}-body`,
        content: transcriptRow.text,
        fg: transcriptRow.color,
        width: "100%",
        wrapMode: transcriptRow.wrapMode ?? "word",
      }))
      nodeBox.add(row)
    })

    return nodeBox
  }

  function syncTranscript(): void {
    if (!transcriptScroll) return
    if (renderedTranscriptVersion === transcriptContentVersion) return

    for (const child of [...transcriptScroll.getChildren()]) {
      transcriptScroll.remove(child.id)
    }

    for (const node of transcript.nodes) {
      transcriptScroll.add(buildTranscriptMessage(node))
    }

    renderedTranscriptVersion = transcriptContentVersion
  }

  function handleTranscriptScrollKey(key: KeyEvent): boolean {
    if (!transcriptScroll) return false
    const action = routeTranscriptScrollAction(key.name, { panelOpen: panelOverlay !== null })

    if (action === "page-up") {
      transcriptScroll.scrollBy(-1, "viewport")
      return true
    }
    if (action === "page-down") {
      transcriptScroll.scrollBy(1, "viewport")
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

  function render(): void {
    if (renderer.root.getRenderable("app-root")) {
      renderer.root.remove("app-root")
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
        transcriptScroll = new ScrollBoxRenderable(renderer, {
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
        })
      }
      syncTranscript()

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
        Box(
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
          Text({ content: "server  mock-agent", fg: opencodeTheme.textMuted }),
          Text({ content: "mode    demo", fg: opencodeTheme.textMuted }),
          Text({ content: "", fg: opencodeTheme.textMuted }),
          Text({ content: "capabilities", fg: opencodeTheme.accent }),
          Text({ content: "● prompt", fg: opencodeTheme.success }),
          Text({ content: "● stream", fg: opencodeTheme.success }),
          Text({ content: "· tools pending", fg: opencodeTheme.textMuted }),
        ),
      )
    })()

    const dropdownElement = showDropdown && (commandState.phase === "listing" || commandState.phase === "drilldown")
      ? buildDropdown(commandState, getCommandItems())
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
          buildPalette(commandState, getCommandItems()),
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
          const itemCount = getCommandItems().length
          if (commandState.selectedIndex >= itemCount) {
            commandState = { ...commandState, selectedIndex: Math.max(0, itemCount - 1) }
          }
        }

        if (result.effect?.type === "execute") {
          const cmdText = result.effect.command
          const cmdName = cmdText.split(" ")[0]
          const descriptor = cmdName ? registry.get(cmdName) : undefined
          const isPanel = descriptor?.inputType === "panel"
          if (submitHandler) void submitHandler(cmdText, { panel: isPanel })
          inputValue = ""
        } else if (result.effect?.type === "fetch-options" && fetchOptions) {
          const method = result.effect.method
          void (async () => {
            const items = await fetchOptions(method)
            if (commandState.phase === "drilldown") {
              const loaded = transition(commandState, { type: "options-loaded", items })
              commandState = loaded.state
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

    if (handleTranscriptScrollKey(key)) {
      pendingExit = false
      render()
      return
    }

    const result = handleInputKey(inputValue, key)
    inputValue = result.value
    cursorVisible = true

    if (result.activate === "slash") {
      const tr = transition(commandState, { type: "slash-typed" })
      commandState = tr.state
    }

    render()

    if (result.submit && submitHandler) {
      void submitHandler(result.submit)
    }
  })

  renderer.keyInput.on("paste", (event: { bytes: Uint8Array }) => {
    const text = decodePasteBytes(event.bytes).replace(/\r\n?/g, " ")
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
      render()
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
    destroy() {
      clearInterval(blinkTimer)
      renderer.destroy()
    },
  }
}

function createTextUi(): AgentClientUi {
  return {
    isInteractive: false,
    setStatus(status) {
      process.stdout.write(`● status ${status}\n`)
    },
    onSubmit() {},
    append(entry) {
      const [row] = buildTranscriptRows([entry])
      if (!row) return
      process.stdout.write(`${row.label} ${row.text}\n`)
    },
    updateLast() {},
    finishAgentMessage() {},
    showPanel() {},
    updatePanel() {},
    hidePanel() {},
    destroy() {},
  }
}
