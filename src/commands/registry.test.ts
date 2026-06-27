import { describe, expect, test } from "bun:test"
import { CommandRegistry, type CommandDescriptor } from "./registry"

const model: CommandDescriptor = {
  name: "/model",
  description: "Select model",
  source: "acp",
  kind: "server",
  inputType: "selection",
  optionsMethod: "_kiro.dev/commands/model/options",
}

const context: CommandDescriptor = {
  name: "/context",
  description: "Manage context files",
  source: "acp",
  kind: "server",
  inputType: "panel",
  subcommands: ["show", "add", "remove", "clear"],
  subcommandHints: { add: "[--force] <path>...", remove: "<path>..." },
}

const skill: CommandDescriptor = {
  name: "/pr-review",
  description: "Review pull request",
  source: "acp",
  kind: "skill",
}

const models: CommandDescriptor = {
  name: "Models",
  description: "Select session model",
  source: "local",
  kind: "config",
  configId: "model",
  options: [
    { label: "Anthropic/Claude Sonnet", value: "anthropic/claude-sonnet" },
    { label: "OpenAI/GPT", value: "openai/gpt" },
  ],
}

const mode: CommandDescriptor = {
  name: "Mode",
  description: "Select session mode",
  source: "local",
  kind: "config",
  configId: "mode",
  options: [
    { label: "Build", value: "build" },
    { label: "Plan", value: "plan" },
  ],
}

const quit: CommandDescriptor = {
  name: "Quit",
  description: "Quit the application",
  source: "local",
  kind: "app",
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

  test("slash search excludes skills and adds Skills child menu", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, skill, context])

    expect(reg.searchSlash("").map((cmd) => cmd.name)).toEqual(["/model", "/context", "Skills"])
  })

  test("slash search includes config commands before skills menu", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([skill, context])
    reg.setConfigCommands([models])

    expect(reg.searchSlash("").map((cmd) => cmd.name)).toEqual(["/context", "Models", "Skills"])
  })

  test("slash search ranks Skills first for skill query", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, skill])
    reg.setConfigCommands([models, mode])

    expect(reg.searchSlash("Ski").map((cmd) => cmd.name)).toEqual(["Skills"])
  })

  test("slash search ranks names starting with query before other matches", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([{ ...context, description: "Show mock context panel" }, { ...model, description: "Switch mock model" }, skill])

    expect(reg.searchSlash("s").map((cmd) => cmd.name)).toEqual(["Skills", "/context", "/model"])
  })

  test("palette search includes app config server and Skills child menu", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, skill])
    reg.addLocalCommand(quit)
    reg.setConfigCommands([models])

    expect(reg.searchPalette("").map((cmd) => cmd.name)).toEqual(["Quit", "Models", "/model", "Skills"])
  })

  test("palette search ranks exact name matches before longer prefix matches", () => {
    const reg = new CommandRegistry()
    reg.setConfigCommands([models, mode])

    expect(reg.searchPalette("mode").map((cmd) => cmd.name)).toEqual(["Mode", "Models"])
  })

  test("palette search ranks names starting with query before other matches", () => {
    const reg = new CommandRegistry()
    const toggleSessionPanel: CommandDescriptor = {
      name: "Toggle Session Panel",
      description: "Show/hide sidebar",
      source: "local",
      kind: "app",
    }
    reg.addLocalCommand(toggleSessionPanel)
    reg.setAcpCommands([{ ...context, description: "Show mock context panel" }, { ...model, description: "Switch mock model" }, skill])

    expect(reg.searchPalette("s").map((cmd) => cmd.name)).toEqual(["Skills", "Toggle Session Panel", "/context", "/model"])
  })

  test("palette search tolerates typos", () => {
    const reg = new CommandRegistry()
    reg.setConfigCommands([models, mode])

    expect(reg.searchPalette("mdoe").map((cmd) => cmd.name)).toContain("Mode")
  })

  test("palette search does not expose individual skill commands", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, skill])

    expect(reg.searchPalette("pr").map((cmd) => cmd.name)).toEqual([])
    expect(reg.searchPalette("skill").map((cmd) => cmd.name)).toEqual(["Skills"])
  })

  test("getSkills returns non-hidden skills", () => {
    const reg = new CommandRegistry()
    reg.setAcpCommands([model, skill, { ...skill, name: "/hidden-skill", hidden: true }])

    expect(reg.getSkills()).toEqual([skill])
  })
})
