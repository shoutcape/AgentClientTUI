import { join } from "node:path"
import { cwd, execPath } from "node:process"
import { commandFromShellText } from "./agent-command"
import { AcpClient } from "./acp/client"
import { selectPermissionOption } from "./acp/permission"
import { normalizeSessionUpdate } from "./acp/session-update"
import { JsonRpcTransport } from "./acp/transport"
import type { AgentCommand, TransportEvent } from "./acp/types"
import { CommandRegistry } from "./commands/registry"
import { createPromptQueue } from "./prompt-queue"
import { createAgentClientUi } from "./ui"

function parseArgs(argv: string[]): { agent: AgentCommand; headless: boolean } {
  const agentFlag = argv.indexOf("--agent")
  const headless = argv.includes("--headless")

  if (agentFlag >= 0) {
    const commandText = argv[agentFlag + 1]
    if (!commandText) {
      throw new Error("--agent requires a command string")
    }

    return { agent: commandFromShellText(commandText), headless }
  }

  return {
    agent: {
      command: isBunRuntime() ? execPath : join(cwd(), "node_modules", ".bin", "tsx"),
      args: isBunRuntime() ? ["run", "src/mock-agent.ts"] : ["src/mock-agent.ts"],
      label: "mock-agent",
    },
    headless,
  }
}

function isBunRuntime(): boolean {
  return typeof process.versions.bun === "string"
}

function commandsFromAvailableCommandsUpdate(params: unknown): Array<{ name: string; description: string; source: "acp" }> | null {
  const record = params && typeof params === "object" && !Array.isArray(params) ? params as { update?: unknown } : null
  const update = record?.update && typeof record.update === "object" && !Array.isArray(record.update)
    ? record.update as { sessionUpdate?: unknown; availableCommands?: unknown }
    : null
  if (update?.sessionUpdate !== "available_commands_update" || !Array.isArray(update.availableCommands)) return null
  return update.availableCommands.flatMap((command) => {
    if (!command || typeof command !== "object" || Array.isArray(command)) return []
    const c = command as { name?: unknown; description?: unknown }
    if (typeof c.name !== "string") return []
    const name = c.name.startsWith("/") ? c.name : `/${c.name}`
    return [{ name, description: typeof c.description === "string" ? c.description : "", source: "acp" as const }]
  })
}

const { agent, headless } = parseArgs(process.argv.slice(2))
const registry = new CommandRegistry()
registry.addLocalCommand({ name: "Quit", description: "Exit AgentClientTUI", source: "local" })
registry.addLocalCommand({ name: "Toggle Session Panel", description: "Show/hide sidebar", source: "local" })
const transport = new JsonRpcTransport(agent)
const client = new AcpClient(transport)

const ui = await createAgentClientUi({
  headless,
  agentLabel: agent.label,
  registry,
  onFetchOptions: (method) => client.fetchOptions(method),
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

let isStreaming = false
let streamingText = ""
let activePanelCommand: string | null = null
let panelText = ""

transport.onEvent((event) => {
  if (event.type === "notification") {
    if (event.method === "_kiro.dev/commands/available") {
      const params = event.params as { commands?: Array<{ name: string; description: string; meta?: Record<string, unknown> }> } | undefined
      const descriptors = (params?.commands ?? []).map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        source: "acp" as const,
        ...(cmd.meta?.inputType ? { inputType: cmd.meta.inputType as "selection" | "panel" } : {}),
        ...(cmd.meta?.subcommands ? { subcommands: cmd.meta.subcommands as string[] } : {}),
        ...(cmd.meta?.subcommandHints ? { subcommandHints: cmd.meta.subcommandHints as Record<string, string> } : {}),
        ...(cmd.meta?.optionsMethod ? { optionsMethod: cmd.meta.optionsMethod as string } : {}),
        ...(cmd.meta?.hint ? { hint: cmd.meta.hint as string } : {}),
        ...(cmd.meta?.hidden ? { hidden: cmd.meta.hidden as boolean } : {}),
      }))
      registry.setAcpCommands(descriptors)
      return
    }

    if (event.method === "session/update") {
      const descriptors = commandsFromAvailableCommandsUpdate(event.params)
      if (descriptors) {
        registry.setAcpCommands(descriptors)
        ui.append({ kind: "status", text: `commands updated (${descriptors.length})` })
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
    } else if (update) {
      ui.append({ kind: update.type, text: update.text, ...("blocks" in update ? { blocks: update.blocks } : {}) })
    }
  } else if (event.type === "stderr") {
    ui.append({ kind: "log", text: event.text.trim() })
  } else if (event.type === "protocol-error") {
    ui.append({ kind: "error", text: event.raw ? `${event.message}: ${event.raw}` : event.message })
  } else if (event.type === "exit") {
    ui.setStatus(`agent exited (${event.code ?? event.signal ?? "unknown"})`)
  }
})

process.on("SIGINT", () => {
  transport.destroy()
  ui.destroy()
  process.exit(0)
})

try {
  ui.setStatus(`launching ${agent.label}`)
  await client.initialize()
  ui.setStatus("initialized")

  const sessionId = await client.newSession(cwd())
  ui.setStatus(`session ${sessionId}`)

  async function runPrompt(prompt: string, options?: { panel?: boolean }): Promise<void> {
    streamingText = ""
    isStreaming = false

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
      ui.setStatus("ready")
    } catch (error) {
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
      ui.append({ kind: "status", text: "Toggle sidebar (not yet implemented)" })
      return
    }

    promptQueue.enqueue(prompt, options)
  }

  ui.onSubmit(sendPrompt)

  if (headless) {
    await runPrompt("Say hello from AgentClientTUI.")
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
