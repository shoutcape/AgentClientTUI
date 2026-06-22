import { Box, Text, TextAttributes, createCliRenderer, fg, t, type KeyEvent } from "@opentui/core"
import { buildInputBar, buildTranscriptRows, handleInputKey, opencodeTheme, type TranscriptEntry } from "./ui/view"

export type AgentClientUi = {
  isInteractive: boolean
  setStatus(status: string): void
  onSubmit(handler: (prompt: string) => void | Promise<void>): void
  append(entry: TranscriptEntry): void
  destroy(): void
}

export async function createAgentClientUi(options: { headless?: boolean } = {}): Promise<AgentClientUi> {
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
  let submitHandler: ((prompt: string) => void | Promise<void>) | undefined
  const transcript: TranscriptEntry[] = []

  function render(): void {
    if (renderer.root.getRenderable("app-root")) {
      renderer.root.remove("app-root")
    }

    const rows = buildTranscriptRows(transcript.slice(-24))
    const inputBar = buildInputBar(inputValue, { cursorVisible: windowActive && cursorVisible })
    const cwd = process.cwd()

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
        Box(
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
        ),
        Box(
          {
            flexDirection: "row",
            justifyContent: "space-between",
            width: "100%",
            backgroundColor: opencodeTheme.background,
          },
          Text({ content: cwd, fg: opencodeTheme.textMuted }),
          Text({ content: "ctrl+c exit · demo sends one prompt", fg: opencodeTheme.textMuted }),
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
    const result = handleInputKey(inputValue, key)
    inputValue = result.value
    cursorVisible = true
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
    destroy() {},
  }
}
