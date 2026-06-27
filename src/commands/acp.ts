import type { CommandDescriptor, CommandKind } from "./registry"

type RawCommand = {
  name?: unknown
  description?: unknown
  input?: { hint?: unknown }
  local?: unknown
  meta?: Record<string, unknown>
}

export type SessionConfigOption = {
  id: string
  name: string
  type?: string
  currentValue?: string
  options?: Array<{ value?: string; name?: string; description?: string }>
}

const serverCommandNames = new Set([
  "agent",
  "agents",
  "chat",
  "clear",
  "compact",
  "context",
  "help",
  "init",
  "login",
  "logout",
  "model",
  "models",
  "output",
  "plan",
  "redo",
  "share",
  "undo",
])

const configLabels: Record<string, { name: string; description: string }> = {
  model: { name: "Models", description: "Select session model" },
  mode: { name: "Mode", description: "Select session mode" },
  effort: { name: "Effort", description: "Select reasoning effort" },
}

export function commandsFromStandardUpdate(params: unknown): CommandDescriptor[] | null {
  const record = objectRecord(params)
  const update = objectRecord(record?.update)
  if (update?.sessionUpdate !== "available_commands_update" || !Array.isArray(update.availableCommands)) return null
  return update.availableCommands.flatMap((command) => mapCommand(command, "standard"))
}

export function commandsFromKiroAvailable(params: unknown): CommandDescriptor[] {
  const record = objectRecord(params)
  if (!Array.isArray(record?.commands)) return []
  return record.commands.flatMap((command) => mapCommand(command, "kiro"))
}

export function configCommandsFromOptions(options: unknown): CommandDescriptor[] {
  if (!Array.isArray(options)) return []
  return options.flatMap((option) => {
    const record = objectRecord(option) as SessionConfigOption | null
    if (!record || typeof record.id !== "string" || record.type !== "select" || !Array.isArray(record.options)) return []
    const label = configLabels[record.id]
    if (!label) return []

    return [{
      name: label.name,
      description: label.description,
      source: "local" as const,
      kind: "config" as const,
      configId: record.id,
      options: record.options.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const value = typeof item.value === "string" ? item.value : undefined
        if (!value) return []
        return [{
          label: typeof item.name === "string" ? item.name : value,
          value,
          ...(typeof item.description === "string" ? { description: item.description } : {}),
        }]
      }),
    }]
  })
}

function mapCommand(command: unknown, vendor: "standard" | "kiro"): CommandDescriptor[] {
  const record = objectRecord(command) as RawCommand | null
  if (!record || typeof record.name !== "string") return []
  const displayName = record.name.startsWith("/") ? record.name : `/${record.name}`
  const rawName = record.name
  const meta = objectRecord(record.meta)
  const kind = commandKind(rawName, record, meta)

  return [{
    name: displayName,
    rawName,
    description: typeof record.description === "string" ? record.description : "",
    source: "acp" as const,
    kind,
    ...(typeof record.input?.hint === "string" ? { hint: record.input.hint } : {}),
    ...(meta?.inputType === "selection" || meta?.inputType === "panel" ? { inputType: meta.inputType } : {}),
    ...(Array.isArray(meta?.subcommands) ? { subcommands: meta.subcommands.filter((item): item is string => typeof item === "string") } : {}),
    ...(isStringRecord(meta?.subcommandHints) ? { subcommandHints: meta.subcommandHints } : {}),
    ...(typeof meta?.optionsMethod === "string" ? { optionsMethod: meta.optionsMethod } : {}),
    ...(typeof meta?.hint === "string" ? { hint: meta.hint } : {}),
    ...(typeof meta?.hidden === "boolean" ? { hidden: meta.hidden } : {}),
    ...(vendor === "kiro" ? {} : {}),
  }]
}

function commandKind(name: string, record: RawCommand, meta: Record<string, unknown> | null): CommandKind {
  if (record.local === true || meta?.local === true) return "skill"
  const normalized = name.replace(/^\//, "").split(" ")[0]
  if (normalized && serverCommandNames.has(normalized)) return "server"
  return "skill"
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "string"))
}
