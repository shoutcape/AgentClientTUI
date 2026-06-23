import { describe, expect, test } from "bun:test"
import { transition, idle, type CommandEvent, type CommandState, type TransitionResult } from "./state"
import type { CommandDescriptor } from "./registry"

const model: CommandDescriptor = {
  name: "/model",
  description: "Select model",
  source: "acp",
  inputType: "selection",
  optionsMethod: "_kiro.dev/commands/model/options",
}

const clear: CommandDescriptor = {
  name: "/clear",
  description: "Clear history",
  source: "acp",
}

const context: CommandDescriptor = {
  name: "/context",
  description: "Manage context",
  source: "acp",
  inputType: "panel",
  subcommands: ["show", "add", "remove", "clear"],
  subcommandHints: { add: "<path>" },
}

describe("Command State Machine", () => {
  test("slash in empty input transitions to listing (dropdown)", () => {
    const result = transition(idle(), { type: "slash-typed" })
    expect(result.state.phase).toBe("listing")
    if (result.state.phase === "listing") {
      expect(result.state.surface).toBe("dropdown")
      expect(result.state.query).toBe("")
    }
  })

  test("ctrl-p transitions to listing (palette)", () => {
    const result = transition(idle(), { type: "ctrl-p" })
    expect(result.state.phase).toBe("listing")
    if (result.state.phase === "listing") {
      expect(result.state.surface).toBe("palette")
    }
  })

  test("esc in listing returns to idle", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "esc" })
    expect(result.state.phase).toBe("idle")
  })

  test("select command with no subcommands executes", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "select", command: clear })
    expect(result.state.phase).toBe("idle")
    expect(result.effect).toEqual({ type: "execute", command: "/clear" })
  })

  test("select command with optionsMethod enters drilldown loading", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "select", command: model })
    expect(result.state.phase).toBe("drilldown")
    if (result.state.phase === "drilldown") {
      expect(result.state.loading).toBe(true)
      expect(result.state.parent).toBe(model)
    }
    expect(result.effect).toEqual({ type: "fetch-options", method: "_kiro.dev/commands/model/options" })
  })

  test("select command with subcommands enters drilldown with items", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "select", command: context })
    expect(result.state.phase).toBe("drilldown")
    if (result.state.phase === "drilldown") {
      expect(result.state.items).toEqual(["show", "add", "remove", "clear"])
      expect(result.state.loading).toBe(false)
    }
  })

  test("options-loaded populates drilldown items", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: model, items: [], loading: true,
      query: "", selectedIndex: 0, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "options-loaded", items: ["opus", "sonnet"] })
    if (result.state.phase === "drilldown") {
      expect(result.state.items).toEqual(["opus", "sonnet"])
      expect(result.state.loading).toBe(false)
    }
  })

  test("backspace on empty drilldown query returns to listing", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: context, items: ["show", "add"], loading: false,
      query: "", selectedIndex: 0, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "backspace" })
    expect(result.state.phase).toBe("listing")
  })

  test("select subcommand with hint enters argument mode", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: context, items: ["show", "add", "remove", "clear"], loading: false,
      query: "", selectedIndex: 1, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "select-item", item: "add" })
    expect(result.state.phase).toBe("argument")
    if (result.state.phase === "argument") {
      expect(result.state.commandText).toBe("/context add ")
    }
  })

  test("select subcommand without hint executes directly", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: context, items: ["show", "add", "remove", "clear"], loading: false,
      query: "", selectedIndex: 0, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "select-item", item: "show" })
    expect(result.state.phase).toBe("idle")
    expect(result.effect).toEqual({ type: "execute", command: "/context show" })
  })

  test("char event updates query in listing", () => {
    const listing: CommandState = { phase: "listing", query: "mo", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "char", char: "d" })
    if (result.state.phase === "listing") {
      expect(result.state.query).toBe("mod")
      expect(result.state.selectedIndex).toBe(0)
    }
  })

  test("arrow-down increments selectedIndex", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "arrow-down" })
    if (result.state.phase === "listing") {
      expect(result.state.selectedIndex).toBe(1)
    }
  })

  test("arrow-up decrements selectedIndex (min 0)", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "arrow-up" })
    if (result.state.phase === "listing") {
      expect(result.state.selectedIndex).toBe(0)
    }
  })
})
