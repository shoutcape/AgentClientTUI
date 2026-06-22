import { join } from "node:path"
import { cwd, execPath } from "node:process"
import { AcpClient } from "./acp/client"
import { JsonRpcTransport } from "./acp/transport"
import type { AgentCommand, TransportEvent } from "./acp/types"
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

function describeNotification(event: Extract<TransportEvent, { type: "notification" }>): string {
  return `${event.method}: ${JSON.stringify(event.params ?? {})}`
}

const { agent, headless } = parseArgs(process.argv.slice(2))
const ui = await createAgentClientUi({ headless })
const transport = new JsonRpcTransport(agent)
const client = new AcpClient(transport)

transport.onEvent((event) => {
  if (event.type === "notification") {
    ui.append({ kind: "agent", text: describeNotification(event) })
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
  async function sendPrompt(prompt: string): Promise<void> {
    if (promptInFlight) {
      ui.append({ kind: "status", text: "prompt already running" })
      return
    }

    promptInFlight = true
    ui.append({ kind: "user", text: prompt })
    ui.setStatus("prompting")

    try {
      const response = await client.prompt(sessionId, prompt)
      ui.append({ kind: "status", text: `prompt response: ${JSON.stringify(response)}` })
      ui.setStatus("complete")
    } catch (error) {
      ui.append({ kind: "error", text: (error as Error).message })
      ui.setStatus("failed")
    } finally {
      promptInFlight = false
    }
  }

  ui.onSubmit(sendPrompt)

  const prompt = "Say hello from AgentClientTUI."
  await sendPrompt(prompt)

  if (headless || !ui.isInteractive) {
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
