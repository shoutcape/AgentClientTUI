import { cwd, execPath } from "node:process"
import { AcpClient } from "./acp/client"
import { selectPermissionOption } from "./acp/permission"
import { normalizeQuestionRequest } from "./acp/question"
import { normalizeSessionUpdate } from "./acp/session-update"
import { JsonRpcTransport } from "./acp/transport"
import type { TransportEvent } from "./acp/types"
import { parseArgs } from "./cli-args"
import { commandsFromKiroAvailable, commandsFromStandardUpdate, configCommandsFromOptions } from "./commands/acp"
import { CommandRegistry } from "./commands/registry"
import { installShutdownHandlers } from "./process-cleanup"
import { createPromptQueue } from "./prompt-queue"
import { createAgentClientUi } from "./ui"
import { animationThemeNames, isAnimationThemeName } from "./ui/animation-theme"
import { createRenderDiagnostics } from "./ui/render-diagnostics"

const STARTUP_TRANSCRIPT_DEMO_PROMPT = "AgentClientTUI transcript container startup demo: cover status, markdown text, thought, plan, tools, usage, code, diff, and long scrolling output. Make it intentionally verbose so HMR restarts show wrapping, tool grouping, code blocks, diffs, metadata, and sticky scrolling behavior."

const SENSITIVE_ARG_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|cookie)/i

function redactArgv(argv: string[]): string[] {
  let redactNext = false
  return argv.map((arg) => {
    if (redactNext) {
      redactNext = false
      return "[REDACTED]"
    }
    const name = arg.split("=", 1)[0] ?? arg
    if (SENSITIVE_ARG_PATTERN.test(name)) {
      if (arg.includes("=")) return `${name}=[REDACTED]`
      if (/^-{1,2}\S+$/.test(arg)) {
        redactNext = true
        return arg
      }
      return "[REDACTED]"
    }
    if (SENSITIVE_ARG_PATTERN.test(arg)) {
      return "[REDACTED]"
    }
    return arg
  })
}
const { agent, headless, demoTranscript, animationTheme } = parseArgs(process.argv.slice(2), {
  isBunRuntime: typeof process.versions.bun === "string",
  execPath,
  cwd: cwd(),
})
const diagnostics = createRenderDiagnostics({ agentLabel: agent.label })
diagnostics.recordEvent("startup", {
  agentLabel: agent.label,
  headless,
  cwd: cwd(),
  argv: redactArgv(process.argv.slice(2)),
})
const registry = new CommandRegistry()
registry.addLocalCommand({ name: "Quit", description: "Exit AgentClientTUI", source: "local", kind: "app" })
registry.addLocalCommand({ name: "Toggle Session Panel", description: "Show/hide sidebar", source: "local", kind: "app" })
registry.addLocalCommand({
  name: "/animation-theme",
  description: "Switch animation/icon theme",
  source: "local",
  kind: "app",
  options: animationThemeNames.map((name) => ({ label: name, value: name, description: `${name} animation/icon theme` })),
})
const transport = new JsonRpcTransport(agent)
const client = new AcpClient(transport)
let activeSessionId = ""

const ui = await createAgentClientUi({
  headless,
  agentLabel: agent.label,
  registry,
  diagnostics,
  animationTheme,
  onFetchOptions: (method) => client.fetchOptions(method),
  onSetConfigOption: (configId, value) => client.setConfigOption(activeSessionId, configId, value),
})

transport.onRequest("session/request_permission", (_method, params) => {
  ui.append({ kind: "status", text: "permission requested (auto-rejected)" })
  return {
    outcome: {
      outcome: "selected",
      optionId: selectPermissionOption(params),
    },
  }
})

function handleQuestionRequest(_method: string, params: unknown) {
  return ui.askQuestions(normalizeQuestionRequest(params))
}

for (const method of ["session/question", "session/request_question", "session/request_questions", "tools/question", "question"]) {
  transport.onRequest(method, handleQuestionRequest)
}

let isStreaming = false
let streamingText = ""
let activePanelCommand: string | null = null
let panelText = ""

transport.onEvent((event) => {
  diagnostics.recordEvent("transport-event", { type: event.type, method: "method" in event ? event.method : undefined })

  if (event.type === "notification") {
    if (event.method === "_kiro.dev/commands/available") {
      registry.setAcpCommands(commandsFromKiroAvailable(event.params))
      return
    }

    if (event.method === "session/update") {
      const descriptors = commandsFromStandardUpdate(event.params)
      if (descriptors) {
        registry.setAcpCommands(descriptors)
        return
      }
    }

    const update = normalizeSessionUpdate(event.method, event.params)
    if (update?.type === "agent-text") {
      if (activePanelCommand) {
        panelText += update.text
        ui.updatePanel(panelText)
      } else if (!isStreaming) {
        isStreaming = true
        streamingText = update.text
        ui.append({ kind: "agent", text: streamingText })
      } else {
        streamingText += update.text
        ui.updateLast(streamingText)
      }
    } else if (update?.type === "metadata") {
      ui.setStatus(update.text)
    } else if (update?.type === "tool") {
      ui.append({
        kind: "tool",
        text: update.text,
        ...(update.blocks ? { blocks: update.blocks } : {}),
        ...(update.toolCallId ? { toolCallId: update.toolCallId } : {}),
        ...(update.toolKind ? { toolKind: update.toolKind } : {}),
        ...(update.toolStatus ? { toolStatus: update.toolStatus } : {}),
        ...(update.toolTitle ? { toolTitle: update.toolTitle } : {}),
      })
    } else if (update) {
      ui.append({ kind: update.type, text: update.text })
    }
  } else if (event.type === "stderr") {
    ui.append({ kind: "log", text: event.text.trim() })
  } else if (event.type === "protocol-error") {
    ui.append({ kind: "error", text: event.raw ? `${event.message}: ${event.raw}` : event.message })
  } else if (event.type === "exit") {
    ui.setStatus(`agent exited (${event.code ?? event.signal ?? "unknown"})`)
  }
})

installShutdownHandlers(process, () => {
  transport.destroy()
  ui.destroy()
})

process.on("uncaughtExceptionMonitor", (error) => {
  diagnostics.recordEvent("uncaughtException", { message: error.message, stack: error.stack })
  process.stderr.write(`[uncaughtException] ${error.stack ?? error.message}\n`)
})

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  diagnostics.recordEvent("unhandledRejection", { message, stack })
  process.stderr.write(`[unhandledRejection] ${stack ?? message}\n`)
  queueMicrotask(() => {
    throw reason instanceof Error ? reason : new Error(message)
  })
})

try {
  ui.setStatus(`launching ${agent.label}`)
  await client.initialize()
  ui.setStatus("initialized")

  const session = await client.newSession(cwd())
  const sessionId = session.sessionId
  activeSessionId = sessionId
  registry.setConfigCommands(configCommandsFromOptions(session.configOptions))
  ui.setStatus(`session ${sessionId}`)

  async function runPrompt(prompt: string, options?: { panel?: boolean }): Promise<void> {
    streamingText = ""
    isStreaming = false
    diagnostics.recordEvent("prompt-start", { length: prompt.length, panel: Boolean(options?.panel) })

    if (options?.panel) {
      activePanelCommand = prompt
      panelText = ""
      ui.showPanel(prompt)
    } else {
      ui.append({ kind: "user", text: prompt })
    }

    ui.setStatus("prompting")

    try {
      await client.prompt(sessionId, prompt)
      diagnostics.recordEvent("prompt-finish", { status: "ready" })
      ui.setStatus("ready")
    } catch (error) {
      diagnostics.recordEvent("prompt-error", { message: (error as Error).message })
      ui.append({ kind: "error", text: (error as Error).message })
      ui.setStatus("failed")
    } finally {
      isStreaming = false
      ui.finishAgentMessage()
      activePanelCommand = null
    }
  }

  const promptQueue = createPromptQueue({
    onQueued(prompt) {
      ui.append({ kind: "status", text: `queued: ${prompt}` })
    },
    onDequeued() {},
    run: runPrompt,
  })

  function sendPrompt(prompt: string, options?: { panel?: boolean }): void {
    // Local commands bypass the queue — they are not agent prompts.
    if (prompt === "Quit") {
      transport.destroy()
      ui.destroy()
      process.exit(0)
    }
    if (prompt === "Toggle Session Panel") {
      ui.toggleSidebar()
      return
    }
    if (prompt.startsWith("/animation-theme ")) {
      const themeName = prompt.slice("/animation-theme ".length).trim()
      if (!isAnimationThemeName(themeName)) {
        ui.append({ kind: "error", text: `Unknown animation theme: ${themeName}` })
        return
      }
      ui.setAnimationTheme(themeName)
      ui.append({ kind: "status", text: `animation theme set to ${themeName}` })
      return
    }

    promptQueue.enqueue(prompt, options)
  }

  ui.onSubmit(sendPrompt)

  const startupPrompt = demoTranscript ? STARTUP_TRANSCRIPT_DEMO_PROMPT : headless ? "Say hello from AgentClientTUI." : null
  if (startupPrompt) {
    await runPrompt(startupPrompt)
  }

  if (headless) {
    transport.destroy()
    ui.destroy()
  }
} catch (error) {
  ui.append({ kind: "error", text: (error as Error).message })
  ui.setStatus("failed")
  transport.destroy()
  if (headless) {
    ui.destroy()
    process.exit(1)
  }
}
