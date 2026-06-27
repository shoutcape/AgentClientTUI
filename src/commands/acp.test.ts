import { describe, expect, test } from "bun:test"
import { commandsFromStandardUpdate, configCommandsFromOptions, commandsFromKiroAvailable } from "./acp"

describe("ACP command mapping", () => {
  test("maps standard available_commands_update with display slash and input hint", () => {
    const commands = commandsFromStandardUpdate({
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "plan", description: "Create a plan", input: { hint: "task" } },
        ],
      },
    })

    expect(commands).toEqual([
      {
        name: "/plan",
        rawName: "plan",
        description: "Create a plan",
        source: "acp",
        kind: "server",
        hint: "task",
      },
    ])
  })

  test("maps Kiro available command metadata", () => {
    const commands = commandsFromKiroAvailable({
      commands: [
        {
          name: "/model",
          description: "Select model",
          meta: { inputType: "selection", optionsMethod: "_kiro.dev/commands/model/options" },
        },
      ],
    })

    expect(commands).toEqual([
      {
        name: "/model",
        rawName: "/model",
        description: "Select model",
        source: "acp",
        kind: "server",
        inputType: "selection",
        optionsMethod: "_kiro.dev/commands/model/options",
      },
    ])
  })

  test("maps top-level local commands as skills", () => {
    const commands = commandsFromStandardUpdate({
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "review", description: "Review changes", local: true },
        ],
      },
    })

    expect(commands).toEqual([
      {
        name: "/review",
        rawName: "review",
        description: "Review changes",
        source: "acp",
        kind: "skill",
      },
    ])
  })

  test("maps select config options into config commands", () => {
    const commands = configCommandsFromOptions([
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "anthropic/claude-sonnet",
        options: [
          { value: "anthropic/claude-sonnet", name: "Anthropic/Claude Sonnet" },
          { value: "openai/gpt", name: "OpenAI/GPT", description: "Fast" },
        ],
      },
      {
        id: "theme",
        name: "Theme",
        type: "select",
        currentValue: "dark",
        options: [{ value: "dark", name: "Dark" }],
      },
    ])

    expect(commands).toEqual([
      {
        name: "Models",
        description: "Select session model",
        source: "local",
        kind: "config",
        configId: "model",
        options: [
          { label: "Anthropic/Claude Sonnet", value: "anthropic/claude-sonnet" },
          { label: "OpenAI/GPT", value: "openai/gpt", description: "Fast" },
        ],
      },
    ])
  })
})
