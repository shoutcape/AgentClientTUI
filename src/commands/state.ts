import type { CommandDescriptor, CommandOption } from "./registry"

export type { CommandOption }
export type CommandItem = string | CommandOption

export type CommandState =
  | { phase: "idle" }
  | { phase: "listing"; query: string; surface: "dropdown" | "palette"; selectedIndex: number }
  | { phase: "drilldown"; parent: CommandDescriptor; items: CommandItem[]; loading: boolean; query: string; selectedIndex: number; surface: "dropdown" | "palette" }
  | { phase: "argument"; commandText: string }

export type CommandEvent =
  | { type: "slash-typed" }
  | { type: "ctrl-p" }
  | { type: "esc" }
  | { type: "char"; char: string }
  | { type: "backspace" }
  | { type: "arrow-up" }
  | { type: "arrow-down" }
  | { type: "select"; command: CommandDescriptor }
  | { type: "select-item"; item: CommandItem }
  | { type: "options-loaded"; items: CommandOption[] }

export type CommandEffect =
  | { type: "execute"; command: string }
  | { type: "fetch-options"; method: string }
  | { type: "set-input"; text: string }
  | { type: "set-config-option"; configId: string; value: string }

export type TransitionResult = {
  state: CommandState
  effect?: CommandEffect
}

export function idle(): CommandState {
  return { phase: "idle" }
}

export function transition(state: CommandState, event: CommandEvent): TransitionResult {
  switch (state.phase) {
    case "idle":
      return transitionIdle(event)
    case "listing":
      return transitionListing(state, event)
    case "drilldown":
      return transitionDrilldown(state, event)
    case "argument":
      return transitionArgument(state, event)
  }
}

function transitionIdle(event: CommandEvent): TransitionResult {
  if (event.type === "slash-typed") {
    return { state: { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 } }
  }
  if (event.type === "ctrl-p") {
    return { state: { phase: "listing", query: "", surface: "palette", selectedIndex: 0 } }
  }
  return { state: { phase: "idle" } }
}

function transitionListing(state: Extract<CommandState, { phase: "listing" }>, event: CommandEvent): TransitionResult {
  if (event.type === "esc") {
    return { state: idle() }
  }
  if (event.type === "backspace") {
    if (state.query === "") return { state: idle() }
    return { state: { ...state, query: state.query.slice(0, -1), selectedIndex: 0 } }
  }
  if (event.type === "char") {
    return { state: { ...state, query: state.query + event.char, selectedIndex: 0 } }
  }
  if (event.type === "arrow-down") {
    return { state: { ...state, selectedIndex: state.selectedIndex + 1 } }
  }
  if (event.type === "arrow-up") {
    return { state: { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) } }
  }
  if (event.type === "select") {
    const cmd = event.command
    if (cmd.optionsMethod) {
      return {
        state: { phase: "drilldown", parent: cmd, items: [], loading: true, query: "", selectedIndex: 0, surface: state.surface },
        effect: { type: "fetch-options", method: cmd.optionsMethod },
      }
    }
    if (cmd.options && cmd.options.length > 0) {
      return {
        state: { phase: "drilldown", parent: cmd, items: cmd.options, loading: false, query: "", selectedIndex: 0, surface: state.surface },
      }
    }
    if (cmd.subcommands && cmd.subcommands.length > 0) {
      return {
        state: { phase: "drilldown", parent: cmd, items: cmd.subcommands, loading: false, query: "", selectedIndex: 0, surface: state.surface },
      }
    }
    return { state: idle(), effect: { type: "execute", command: cmd.name } }
  }
  return { state }
}

function transitionDrilldown(state: Extract<CommandState, { phase: "drilldown" }>, event: CommandEvent): TransitionResult {
  if (event.type === "esc") {
    return { state: idle() }
  }
  if (event.type === "backspace") {
    if (state.query === "") {
      return { state: { phase: "listing", query: "", surface: state.surface, selectedIndex: 0 } }
    }
    return { state: { ...state, query: state.query.slice(0, -1), selectedIndex: 0 } }
  }
  if (event.type === "char") {
    return { state: { ...state, query: state.query + event.char, selectedIndex: 0 } }
  }
  if (event.type === "arrow-down") {
    return { state: { ...state, selectedIndex: state.selectedIndex + 1 } }
  }
  if (event.type === "arrow-up") {
    return { state: { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) } }
  }
  if (event.type === "options-loaded") {
    return { state: { ...state, items: event.items, loading: false } }
  }
  if (event.type === "select-item") {
    const itemName = typeof event.item === "string" ? event.item : event.item.label
    const itemValue = typeof event.item === "string" ? event.item : event.item.value
    if (state.parent.kind === "config" && state.parent.configId) {
      return { state: idle(), effect: { type: "set-config-option", configId: state.parent.configId, value: itemValue } }
    }
    if (state.parent.name === "Skills") {
      return { state: idle(), effect: { type: "execute", command: itemValue } }
    }
    const hint = state.parent.subcommandHints?.[itemName]
    if (hint) {
      return {
        state: { phase: "argument", commandText: `${state.parent.name} ${itemValue} ` },
      }
    }
    return { state: idle(), effect: { type: "execute", command: `${state.parent.name} ${itemValue}` } }
  }
  return { state }
}

function transitionArgument(state: Extract<CommandState, { phase: "argument" }>, event: CommandEvent): TransitionResult {
  if (event.type === "esc") {
    return { state: idle() }
  }
  return { state }
}
