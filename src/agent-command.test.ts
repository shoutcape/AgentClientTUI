import { describe, expect, test } from "bun:test"
import { commandFromShellText } from "./agent-command"

describe("commandFromShellText", () => {
  test("uses opencode ACP as the display label for env-wrapped commands", () => {
    expect(commandFromShellText("env OPENCODE_CONFIG_CONTENT={\"model\":\"openai/gpt-5.5\"} opencode acp --cwd /tmp/project")).toEqual({
      command: "env",
      args: ["OPENCODE_CONFIG_CONTENT={\"model\":\"openai/gpt-5.5\"}", "opencode", "acp", "--cwd", "/tmp/project"],
      label: "opencode acp",
    })
  })

  test("uses command and first subcommand for opencode ACP commands", () => {
    expect(commandFromShellText("opencode acp --cwd /tmp/project").label).toBe("opencode acp")
  })
})
