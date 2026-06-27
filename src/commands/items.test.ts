import { describe, expect, test } from "bun:test"
import { CommandRegistry } from "./registry"
import type { CommandState } from "./state"
import {
  clampCommandSelectedIndex,
  getCommandItems,
  getSelectedCommandDescriptor,
  getSelectedDrilldownItem,
} from "./items"

function registryWithCommands(): CommandRegistry {
  const registry = new CommandRegistry()
  registry.setAcpCommands([
    { name: "/model", description: "Switch model", source: "acp" },
    { name: "/context", description: "Show context", source: "acp" },
  ])
  registry.addLocalCommand({ name: "Quit", description: "Exit", source: "local" })
  return registry
}

describe("command item helpers", () => {
  test("lists ACP commands only for slash dropdown", () => {
    const state: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    expect(getCommandItems(state, registryWithCommands())).toEqual([
      { name: "/model", description: "Switch model" },
      { name: "/context", description: "Show context" },
    ])
  })

  test("lists ACP and local commands for palette", () => {
    const state: CommandState = { phase: "listing", query: "", surface: "palette", selectedIndex: 0 }
    expect(getCommandItems(state, registryWithCommands()).map((item) => item.name)).toEqual([
      "Quit",
      "/model",
      "/context",
    ])
  })

  test("filters drilldown items by label or value", () => {
    const state: CommandState = {
      phase: "drilldown",
      parent: { name: "/model", description: "Switch model", source: "acp" },
      items: [{ label: "sonnet", value: "claude-sonnet" }, { label: "opus", value: "claude-opus" }],
      loading: false,
      query: "claude-s",
      selectedIndex: 0,
      surface: "dropdown",
    }
    expect(getCommandItems(state, registryWithCommands())).toEqual([
      { name: "sonnet", description: "" },
    ])
    expect(getSelectedDrilldownItem(state)).toEqual({ label: "sonnet", value: "claude-sonnet" })
  })

  test("gets selected command descriptor for listing state", () => {
    const state: CommandState = { phase: "listing", query: "context", surface: "dropdown", selectedIndex: 0 }
    expect(getSelectedCommandDescriptor(state, registryWithCommands())?.name).toBe("/context")
  })

  test("clamps selected index to visible item count", () => {
    const state: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 20 }
    expect(clampCommandSelectedIndex(state, 2)).toEqual({ ...state, selectedIndex: 1 })
    expect(clampCommandSelectedIndex(state, 0)).toEqual({ ...state, selectedIndex: 0 })
  })

  test("clamps negative selected index", () => {
    const state: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: -1 }
    expect(clampCommandSelectedIndex(state, 2)).toEqual({ ...state, selectedIndex: 0 })
  })
})
