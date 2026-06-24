import type { AgentCommand } from "./acp/types"

function displayLabel(parts: string[], fallback: string): string {
  let start = 0
  if (parts[0] === "env") {
    start = 1
    while (parts[start]?.includes("=") && !parts[start]?.startsWith("-") ) {
      start += 1
    }
  }

  const command = parts[start]
  const firstArg = parts[start + 1]
  if (command === "opencode" && firstArg === "acp") return "opencode acp"
  return command ?? fallback
}

export function commandFromShellText(commandText: string): AgentCommand {
  const parts = commandText.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? []
  const [command, ...args] = parts
  if (!command) {
    throw new Error("Agent command was empty")
  }

  return { command, args, label: displayLabel(parts, commandText) }
}
