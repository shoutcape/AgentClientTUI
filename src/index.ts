import { join } from "node:path"
import { cwd, execPath } from "node:process"
import { AcpClient } from "./acp/client"
import { JsonRpcTransport } from "./acp/transport"
import type { AgentCommand, TransportEvent } from "./acp/types"
import { CommandRegistry } from "./commands/registry"
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

function commandFromShellText(commandText: string): AgentCommand {
  const parts = commandText.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? []
  const [command, ...args] = parts
  if (!command) {
    throw new Error("Agent command was empty")
  }

  return { command, args, label: commandText }
}

const { agent, headless } = parseArgs(process.argv.slice(2))
const registry = new CommandRegistry()
registry.addLocalCommand({ name: "Quit", description: "Exit AgentClientTUI", source: "local" })
registry.addLocalCommand({ name: "Toggle Session Panel", description: "Show/hide sidebar", source: "local" })
const transport = new JsonRpcTransport(agent)
const client = new AcpClient(transport)

const ui = await createAgentClientUi({
  headless,
  registry,
  onFetchOptions: async (method) => {
    const options = await client.fetchOptions(method)
    return options.map((o) => o.label)
  },
})

let isStreaming = false
let streamingText = ""
let activePanelCommand: string | null = null
let panelText = ""

function extractAgentText(params: unknown): string | null {
  if (!params || typeof params !== "object") return null
  const p = params as Record<string, unknown>
  if (typeof p.text === "string") return p.text
  if (typeof p.content === "string") return p.content
  if (typeof p.delta === "string") return p.delta
  if (p.update && typeof p.update === "object") {
    const u = p.update as Record<string, unknown>
    if (typeof u.text === "string") return u.text
  }
  return null
}

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

    const text = extractAgentText(event.params)
    if (text !== null) {
      if (activePanelCommand) {
        panelText += text
        ui.updatePanel(panelText)
      } else if (!isStreaming) {
        isStreaming = true
        streamingText = text
        ui.append({ kind: "agent", text: streamingText })
      } else {
        streamingText += text
        ui.updateLast(streamingText)
      }
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

  let promptInFlight = false

  async function sendPrompt(prompt: string, options?: { panel?: boolean }): Promise<void> {
    // Handle local commands
    if (prompt === "Quit") {
      transport.destroy()
      ui.destroy()
      process.exit(0)
    }
    if (prompt === "Toggle Session Panel") {
      ui.append({ kind: "status", text: "Toggle sidebar (not yet implemented)" })
      return
    }

    if (promptInFlight) {
      ui.append({ kind: "status", text: "prompt already running" })
      return
    }

    promptInFlight = true
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
      promptInFlight = false
      isStreaming = false
      activePanelCommand = null
    }
  }

  ui.onSubmit(sendPrompt)

  if (headless) {
    await sendPrompt("Say hello from AgentClientTUI.")
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
