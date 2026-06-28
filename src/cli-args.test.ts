import { describe, expect, test } from "bun:test"
import { parseArgs } from "./cli-args"

describe("CLI argument parsing", () => {
  test("defaults animation theme to quiet", () => {
    const result = parseArgs([], { isBunRuntime: true, execPath: "/bun", cwd: "/repo" })

    expect(result.animationTheme).toBe("quiet")
  })

  test("parses animation theme option", () => {
    const result = parseArgs(["--animation-theme", "cyber"], { isBunRuntime: true, execPath: "/bun", cwd: "/repo" })

    expect(result.animationTheme).toBe("cyber")
  })

  test("rejects missing animation theme value", () => {
    expect(() => parseArgs(["--animation-theme"], { isBunRuntime: true, execPath: "/bun", cwd: "/repo" })).toThrow("--animation-theme requires one of: quiet, playful, operational, cyber")
  })

  test("rejects invalid animation theme value", () => {
    expect(() => parseArgs(["--animation-theme", "loud"], { isBunRuntime: true, execPath: "/bun", cwd: "/repo" })).toThrow("Invalid --animation-theme loud. Expected one of: quiet, playful, operational, cyber")
  })

  test("still parses explicit agent command", () => {
    const result = parseArgs(["--agent", "opencode acp", "--animation-theme", "operational"], { isBunRuntime: false, execPath: "/node", cwd: "/repo" })

    expect(result.agent).toEqual({ command: "opencode", args: ["acp"], label: "opencode acp" })
    expect(result.animationTheme).toBe("operational")
  })
})
