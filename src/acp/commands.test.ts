import { describe, expect, test } from "bun:test"
import { CommandRegistry } from "../commands/registry"
import { commandsFromAcpUpdate, commandsFromKiroAvailable } from "./commands"

describe("ACP command parsing", () => {
  test("parses standard available command updates", () => {
    expect(commandsFromAcpUpdate({
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "model", description: "Switch model" },
          { name: "/mode", description: "Switch mode" },
        ],
      },
    })).toEqual([
      { name: "/model", description: "Switch model", source: "acp" },
      { name: "/mode", description: "Switch mode", source: "acp" },
    ])
  })

  test("parses Kiro command metadata", () => {
    expect(commandsFromKiroAvailable({
      commands: [{
        name: "/context",
        description: "Show context",
        meta: {
          inputType: "panel",
          subcommands: ["show"],
          subcommandHints: { add: "<path>" },
          optionsMethod: "_mock/options",
          hint: "context command",
          hidden: false,
        },
      }],
    })).toEqual([{
      name: "/context",
      description: "Show context",
      source: "acp",
      inputType: "panel",
      subcommands: ["show"],
      subcommandHints: { add: "<path>" },
      optionsMethod: "_mock/options",
      hint: "context command",
      hidden: false,
    }])
  })

  test("preserves Kiro hidden metadata for registry filtering", () => {
    const registry = new CommandRegistry()
    registry.setAcpCommands(commandsFromKiroAvailable({
      commands: [{ name: "/internal", description: "Hidden command", meta: { hidden: true } }],
    }))

    expect(registry.get("/internal")).toEqual({
      name: "/internal",
      description: "Hidden command",
      source: "acp",
      hidden: true,
    })
    expect(registry.search("")).toEqual([])
  })

  test("ignores malformed command payloads", () => {
    expect(commandsFromAcpUpdate({ update: { sessionUpdate: "available_commands_update", availableCommands: [null, { description: "missing name" }] } })).toEqual([])
    expect(commandsFromKiroAvailable({ commands: [null, { description: "missing name" }] })).toEqual([])
  })

  test("filters malformed Kiro metadata fields", () => {
    expect(commandsFromKiroAvailable({
      commands: [{
        name: "/context",
        description: "Show context",
        meta: {
          inputType: "freeform",
          subcommands: ["show", 42],
          subcommandHints: { add: "<path>", remove: 42 },
          optionsMethod: 123,
          hint: false,
          hidden: "yes",
        },
      }],
    })).toEqual([{
      name: "/context",
      description: "Show context",
      source: "acp",
      subcommands: ["show"],
      subcommandHints: { add: "<path>" },
    }])
  })
})
