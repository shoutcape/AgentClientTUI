import type { CommandDescriptor } from "../commands/registry"

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function commandName(value: string): string {
  return value.startsWith("/") ? value : `/${value}`
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export function commandsFromAcpUpdate(params: unknown): CommandDescriptor[] | null {
  const record = asRecord(params)
  const update = asRecord(record?.update)
  if (update?.sessionUpdate !== "available_commands_update" || !Array.isArray(update.availableCommands)) return null

  return update.availableCommands.flatMap((command) => {
    const c = asRecord(command)
    if (!c || typeof c.name !== "string") return []
    return [{
      name: commandName(c.name),
      description: typeof c.description === "string" ? c.description : "",
      source: "acp" as const,
    }]
  })
}

export function commandsFromKiroAvailable(params: unknown): CommandDescriptor[] {
  const record = asRecord(params)
  const commands = Array.isArray(record?.commands) ? record.commands : []
  return commands.flatMap((command) => {
    const cmd = asRecord(command)
    if (!cmd || typeof cmd.name !== "string") return []
    const meta = asRecord(cmd.meta)
    const subcommands = Array.isArray(meta?.subcommands)
      ? meta.subcommands.filter((item): item is string => typeof item === "string")
      : undefined
    const subcommandHints = stringRecord(meta?.subcommandHints)
    return [{
      name: cmd.name,
      description: typeof cmd.description === "string" ? cmd.description : "",
      source: "acp" as const,
      ...(meta?.inputType === "selection" || meta?.inputType === "panel" ? { inputType: meta.inputType } : {}),
      ...(subcommands && subcommands.length > 0 ? { subcommands } : {}),
      ...(subcommandHints ? { subcommandHints } : {}),
      ...(typeof meta?.optionsMethod === "string" ? { optionsMethod: meta.optionsMethod } : {}),
      ...(typeof meta?.hint === "string" ? { hint: meta.hint } : {}),
      ...(typeof meta?.hidden === "boolean" ? { hidden: meta.hidden } : {}),
    }]
  })
}
