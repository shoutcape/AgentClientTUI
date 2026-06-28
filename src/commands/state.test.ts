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
  kind: "server",
}

const context: CommandDescriptor = {
  name: "/context",
  description: "Manage context",
  source: "acp",
  inputType: "panel",
  subcommands: ["show", "add", "remove", "clear"],
  subcommandHints: { add: "<path>" },
}

const skills: CommandDescriptor = {
  name: "Skills",
  description: "Browse skill slash commands",
  source: "local",
  kind: "app",
  subcommands: ["/pr-review"],
}

const models: CommandDescriptor = {
  name: "Models",
  description: "Select session model",
  source: "local",
  kind: "config",
  configId: "model",
  options: [
    { label: "sonnet", value: "anthropic/claude-sonnet", description: "Balanced" },
  ],
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

  test("select Skills enters drilldown with skill command items", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "dropdown", selectedIndex: 0 }
    const result = transition(listing, { type: "select", command: skills })

    expect(result.state.phase).toBe("drilldown")
    if (result.state.phase === "drilldown") {
      expect(result.state.items).toEqual(["/pr-review"])
    }
  })

  test("select skill from Skills executes the skill command only", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: skills, items: ["/pr-review"], loading: false,
      query: "", selectedIndex: 0, surface: "dropdown",
    }

    const result = transition(drilldown, { type: "select-item", item: "/pr-review" })

    expect(result.state.phase).toBe("idle")
    expect(result.effect).toEqual({ type: "execute", command: "/pr-review" })
  })

  test("select config command enters drilldown with configured options", () => {
    const listing: CommandState = { phase: "listing", query: "", surface: "palette", selectedIndex: 0 }
    const result = transition(listing, { type: "select", command: models })

    expect(result.state.phase).toBe("drilldown")
    if (result.state.phase === "drilldown") {
      expect(result.state.items).toEqual([{ label: "sonnet", value: "anthropic/claude-sonnet", description: "Balanced" }])
    }
  })

  test("select config option emits set-config-option effect", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: models, items: [{ label: "sonnet", value: "anthropic/claude-sonnet" }], loading: false,
      query: "", selectedIndex: 0, surface: "palette",
    }

    const result = transition(drilldown, { type: "select-item", item: { label: "sonnet", value: "anthropic/claude-sonnet" } })

    expect(result.state.phase).toBe("idle")
    expect(result.effect).toEqual({ type: "set-config-option", configId: "model", value: "anthropic/claude-sonnet" })
  })

  test("options-loaded populates drilldown items", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: model, items: [], loading: true,
      query: "", selectedIndex: 0, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "options-loaded", items: [
      { label: "opus", value: "claude-opus", description: "Largest model" },
      { label: "sonnet", value: "claude-sonnet" },
    ] })
    if (result.state.phase === "drilldown") {
      expect(result.state.items).toEqual([
        { label: "opus", value: "claude-opus", description: "Largest model" },
        { label: "sonnet", value: "claude-sonnet" },
      ])
      expect(result.state.loading).toBe(false)
    }
  })

  test("select option submits value instead of display label", () => {
    const drilldown: CommandState = {
      phase: "drilldown", parent: model, items: [{ label: "opus", value: "claude-opus" }], loading: false,
      query: "", selectedIndex: 0, surface: "dropdown",
    }
    const result = transition(drilldown, { type: "select-item", item: { label: "opus", value: "claude-opus" } })
    expect(result.state.phase).toBe("idle")
    expect(result.effect).toEqual({ type: "execute", command: "/model claude-opus" })
  })

  test("select animation theme option executes app command with selected value", () => {
    const animationTheme: CommandDescriptor = {
      name: "/animation-theme",
      description: "Switch animation/icon theme",
      source: "local",
      kind: "app",
      options: [{ label: "cyber", value: "cyber" }],
    }
    const drilldown: CommandState = {
      phase: "drilldown",
      parent: animationTheme,
      items: [{ label: "cyber", value: "cyber" }],
      loading: false,
      query: "",
      selectedIndex: 0,
      surface: "dropdown",
    }

    const result = transition(drilldown, { type: "select-item", item: { label: "cyber", value: "cyber" } })

    expect(result.state.phase).toBe("idle")
    expect(result.effect).toEqual({ type: "execute", command: "/animation-theme cyber" })
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
