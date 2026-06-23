import { describe, expect, test } from "bun:test"
import { CommandRegistry, type CommandDescriptor } from "./registry"

const model: CommandDescriptor = {
  name: "/model",
  description: "Select model",
  source: "acp",
  inputType: "selection",
  optionsMethod: "_kiro.dev/commands/model/options",
}

const context: CommandDescriptor = {
  name: "/context",
  description: "Manage context files",
  source: "acp",
  inputType: "panel",
  subcommands: ["show", "add", "remove", "clear"],
  subcommandHints: { add: "[--force] <path>...", remove: "<path>..." },
}

const quit: CommandDescriptor = {
  name: "Quit",
  description: "Quit the application",
  source: "local",
}

describe("CommandRegistry", () => {
  test("search returns commands matching query substring", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, context])
    expect(reg.search("mod")).toEqual([model])
  })

  test("search with empty query returns all non-hidden commands", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, context])
    reg.addLocalCommand(quit)
    expect(reg.search("")).toHaveLength(3)
  })

  test("search filters by source", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, context])
    reg.addLocalCommand(quit)
    expect(reg.search("", { source: "local" })).toEqual([quit])
  })

  test("hidden commands excluded from search", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([{ ...model, hidden: true }])
    expect(reg.search("")).toEqual([])
  })

  test("get returns command by exact name", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model])
    expect(reg.get("/model")).toEqual(model)
    expect(reg.get("/nonexistent")).toBeUndefined()
  })

  test("getSubcommands returns subcommand list", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([context])
    expect(reg.getSubcommands("/context")).toEqual(["show", "add", "remove", "clear"])
    expect(reg.getSubcommands("/model")).toEqual([])
  })

  test("setAcpCommands replaces previous commands", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, context])
    reg.setAcpCommands([model])
    expect(reg.search("")).toEqual([model])
  })
})
