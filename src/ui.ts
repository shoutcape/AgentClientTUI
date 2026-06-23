import { Box, Text, TextAttributes, createCliRenderer, fg, t, type KeyEvent } from "@opentui/core"
import { CommandRegistry } from "./commands/registry"
import { transition, idle, type CommandState, type CommandEvent } from "./commands/state"
import { buildDropdown } from "./ui/dropdown"
import { buildPalette } from "./ui/palette"
import { buildPanelOverlay } from "./ui/panel-overlay"
import { buildInputBar, buildTranscriptRows, handleInputKey, opencodeTheme, type TranscriptEntry } from "./ui/view"

export type UiOptions = {
  headless?: boolean
  registry?: CommandRegistry
  onFetchOptions?: (method: string) => Promise<string[]>
}

export type AgentClientUi = {
  isInteractive: boolean
  setStatus(status: string): void
  onSubmit(handler: (prompt: string, options?: { panel?: boolean }) => void | Promise<void>): void
  append(entry: TranscriptEntry): void
  updateLast(text: string): void
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

  try {
    renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })
  } catch (error) {
    process.stderr.write(`OpenTUI unavailable, falling back to text mode: ${(error as Error).message}\n`)
    return createTextUi()
  }

  let status = "starting"
  let inputValue = ""
  let windowActive = true
  let cursorVisible = true
  let submitHandler: ((prompt: string, options?: { panel?: boolean }) => void | Promise<void>) | undefined
  const transcript: TranscriptEntry[] = []
  let commandState: CommandState = idle()
  const registry = options.registry ?? new CommandRegistry()
  const fetchOptions = options.onFetchOptions
  let panelOverlay: { title: string; content: string } | null = null

  function getCommandItems(): Array<{ name: string; description: string }> {
    if (commandState.phase === "listing") {
      const source = commandState.surface === "dropdown" ? "acp" as const : undefined
      return registry.search(commandState.query, source ? { source } : undefined).map((c) => ({ name: c.name, description: c.description }))
    }
    if (commandState.phase === "drilldown") {
      const q = commandState.query.toLowerCase()
      return commandState.items
        .filter((i) => !q || i.toLowerCase().includes(q))
        .map((i) => ({ name: i, description: "" }))
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
        const filtered = commandState.items.filter((item) => !q || item.toLowerCase().includes(q))
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

  function render(): void {
    if (renderer.root.getRenderable("app-root")) {
      renderer.root.remove("app-root")
    }

    const rows = buildTranscriptRows(transcript.slice(-24))
    const inputBar = buildInputBar(inputValue, { cursorVisible: windowActive && cursorVisible })
    const cwdPath = process.cwd()

    const showPalette = commandState.phase !== "idle" && "surface" in commandState && commandState.surface === "palette"
    const showDropdown = commandState.phase !== "idle" && "surface" in commandState && commandState.surface === "dropdown"

    const mainContent = (() => {
      if (showPalette && (commandState.phase === "listing" || commandState.phase === "drilldown")) {
        return Box(
          { flexDirection: "column", flexGrow: 1, width: "100%", alignItems: "center", justifyContent: "center" },
          buildPalette(commandState, getCommandItems()),
        )
      }

      if (panelOverlay) {
        return Box(
          { flexDirection: "column", flexGrow: 1, width: "100%", alignItems: "center", padding: 1 },
          buildPanelOverlay(panelOverlay.title, panelOverlay.content),
        )
      }

      const dropdownElement = showDropdown && (commandState.phase === "listing" || commandState.phase === "drilldown")
        ? [buildDropdown(commandState, getCommandItems())]
        : []

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
            ...rows.map((row) =>
              Box(
                { flexDirection: "row", gap: 1, width: "100%" },
                Text({ content: row.label.padEnd(12), fg: row.color }),
                Text({ content: row.text, fg: opencodeTheme.text }),
              ),
            ),
          ),
          ...dropdownElement,
          Box(
            {
              flexDirection: "row",
              width: "100%",
              backgroundColor: opencodeTheme.backgroundElement,
              borderStyle: "single",
              borderColor: opencodeTheme.borderSubtle,
              paddingLeft: 1,
              paddingRight: 1,
              gap: 1,
            },
            Text({ content: inputBar.prompt, fg: inputBar.promptColor, attributes: TextAttributes.BOLD }),
            Text({ content: inputBar.value ?? "", fg: inputBar.valueColor ?? opencodeTheme.text }),
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
        Box(
          {
            flexDirection: "row",
            justifyContent: "space-between",
            width: "100%",
            backgroundColor: opencodeTheme.background,
          },
          Text({ content: cwdPath, fg: opencodeTheme.textMuted }),
          Text({ content: "/ commands · Ctrl+P palette · Ctrl+C exit", fg: opencodeTheme.textMuted }),
        ),
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

        if (result.effect?.type === "execute") {
          const cmdText = result.effect.command
          const cmdName = cmdText.split(" ")[0]
          const descriptor = cmdName ? registry.get(cmdName) : undefined
          const isPanel = descriptor?.inputType === "panel"
          if (submitHandler) void submitHandler(cmdText, { panel: isPanel })
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

        if (commandState.phase === "argument") {
          inputValue = commandState.commandText
          commandState = idle()
        }
      }
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
      transcript.push(entry)
      render()
    },
    updateLast(text) {
      const last = transcript[transcript.length - 1]
      if (last) {
        last.text = text
        render()
      }
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
    showPanel() {},
    updatePanel() {},
    hidePanel() {},
    destroy() {},
  }
}
