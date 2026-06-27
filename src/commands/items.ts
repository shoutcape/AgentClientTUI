import type { CommandDescriptor, CommandRegistry } from "./registry"
import type { CommandItem, CommandState } from "./state"

export type CommandListItem = { name: string; description: string }

function getItemLabel(item: CommandItem): string {
  return typeof item === "string" ? item : item.label
}

function getItemValue(item: CommandItem): string {
  return typeof item === "string" ? item : item.value
}

function getItemDescription(item: CommandItem): string {
  return typeof item === "string" ? "" : item.description ?? ""
}

function getFilteredDrilldownItems(state: Extract<CommandState, { phase: "drilldown" }>): CommandItem[] {
  const query = state.query.toLowerCase()
  return state.items.filter((item) => {
    const label = getItemLabel(item).toLowerCase()
    const value = getItemValue(item).toLowerCase()
    return !query || label.includes(query) || value.includes(query)
  })
}

function getCommandDisplayName(state: Extract<CommandState, { phase: "listing" }>, name: string): string {
  if (state.surface === "dropdown") return name.startsWith("/") ? name : `/${name}`
  return name
}

function getListingCommands(state: Extract<CommandState, { phase: "listing" }>, registry: CommandRegistry): CommandDescriptor[] {
  return state.surface === "dropdown"
    ? registry.searchSlash(state.query)
    : registry.searchPalette(state.query)
}

export function getCommandItems(state: CommandState, registry: CommandRegistry): CommandListItem[] {
  if (state.phase === "listing") {
    return getListingCommands(state, registry).map((command) => ({
      name: getCommandDisplayName(state, command.name),
      description: command.description,
    }))
  }

  if (state.phase === "drilldown") {
    return getFilteredDrilldownItems(state).map((item) => ({
      name: getItemLabel(item),
      description: getItemDescription(item),
    }))
  }

  return []
}

export function getSelectedCommandDescriptor(
  state: Extract<CommandState, { phase: "listing" }>,
  registry: CommandRegistry,
): CommandDescriptor | undefined {
  return getListingCommands(state, registry)[state.selectedIndex]
}

export function getSelectedDrilldownItem(
  state: Extract<CommandState, { phase: "drilldown" }>,
): CommandItem | undefined {
  return getFilteredDrilldownItems(state)[state.selectedIndex]
}

export function clampCommandSelectedIndex<T extends Extract<CommandState, { phase: "listing" | "drilldown" }>>(
  state: T,
  itemCount: number,
): T {
  const maxIndex = Math.max(0, itemCount - 1)
  if (state.selectedIndex >= 0 && state.selectedIndex <= maxIndex) return state
  return { ...state, selectedIndex: Math.max(0, Math.min(state.selectedIndex, maxIndex)) }
}
