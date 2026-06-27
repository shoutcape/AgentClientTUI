import { describe, expect, test } from "bun:test"
import type { CommandDescriptor } from "./registry"
import { rankCommands } from "./search"

const command = (name: string, description: string): CommandDescriptor => ({
  name,
  description,
  source: "local",
})

describe("rankCommands", () => {
  test("empty query preserves original order", () => {
    const commands = [command("Quit", "Quit the application"), command("Mode", "Select session mode"), command("Models", "Select session model")]

    expect(rankCommands(commands, "")).toEqual(commands)
  })

  test("ranks exact short name before longer prefix for mode", () => {
    const mode = command("Mode", "Select session mode")
    const models = command("Models", "Select session model")

    expect(rankCommands([models, mode], "mode")).toEqual([mode, models])
  })

  test("ranks model-specific command before mode for model", () => {
    const mode = command("Mode", "Select session mode")
    const models = command("Models", "Select session model")

    const ranked = rankCommands([mode, models], "model")

    expect(ranked[0]).toBe(models)
  })

  test("tolerates typos", () => {
    const mode = command("Mode", "Select session mode")
    const quit = command("Quit", "Quit the application")

    expect(rankCommands([quit, mode], "mdoe")).toContain(mode)
  })

  test("ranks shorter fuzzy matches before longer fuzzy matches", () => {
    const mode = command("Mode", "Select session mode")
    const models = command("Models", "Select session model")

    expect(rankCommands([models, mode], "mde")).toEqual([mode, models])
  })

  test("does not return unrelated short commands for distant queries", () => {
    const mode = command("Mode", "Select session mode")
    const models = command("Models", "Select session model")

    expect(rankCommands([mode, models], "Ski")).toEqual([])
  })

  test("does not return weak fuzzy matches for short queries", () => {
    const context = command("/context", "Show mock context panel")
    const toggleSessionPanel = command("Toggle Session Panel", "Show/hide sidebar")

    expect(rankCommands([toggleSessionPanel, context], "con")).toEqual([context])
  })

  test("name matches outrank description-only matches", () => {
    const nameMatch = command("Mode", "Configure behavior")
    const descriptionMatch = command("Preferences", "Select session mode")

    expect(rankCommands([descriptionMatch, nameMatch], "mode")).toEqual([nameMatch, descriptionMatch])
  })

  test("one-letter search returns command name prefix matches alphabetically before description matches", () => {
    const settings = command("/settings", "Configure settings")
    const skills = command("/skills", "Manage skills")
    const status = command("/status", "Show status")
    const models = command("/models", "Switch models")

    expect(rankCommands([status, skills, settings, models], "s").map((cmd) => cmd.name)).toEqual(["/settings", "/skills", "/status", "/models"])
  })

  test("adding a second letter narrows search results", () => {
    const settings = command("/settings", "Configure settings")
    const skills = command("/skills", "Manage skills")
    const status = command("/status", "Show status")
    const models = command("/models", "Switch models")

    expect(rankCommands([status, skills, settings, models], "sk").map((cmd) => cmd.name)).toEqual(["/skills"])
  })

  test("ranks exact command name matches before fuzzy matches", () => {
    const skill = command("/skill", "Manage one skill")
    const skills = command("/skills", "Manage skills")
    const skils = command("/skils", "Typo command")

    expect(rankCommands([skils, skills, skill], "skill").map((cmd) => cmd.name)).toEqual(["/skill", "/skills", "/skils"])
  })
})
