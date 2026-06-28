import { join } from "node:path"
import { commandFromShellText } from "./agent-command"
import type { AgentCommand } from "./acp/types"
import { animationThemeNames, isAnimationThemeName, type AnimationThemeName } from "./ui/animation-theme"

export type ParsedArgs = {
  agent: AgentCommand
  headless: boolean
  demoTranscript: boolean
  animationTheme: AnimationThemeName
}

export type ParseArgsEnvironment = {
  isBunRuntime: boolean
  execPath: string
  cwd: string
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  return argv[index + 1]
}

function parseAnimationTheme(argv: string[]): AnimationThemeName {
  const index = argv.indexOf("--animation-theme")
  if (index < 0) return "quiet"
  const value = argv[index + 1]
  const expected = animationThemeNames.join(", ")
  if (!value) throw new Error(`--animation-theme requires one of: ${expected}`)
  if (!isAnimationThemeName(value)) throw new Error(`Invalid --animation-theme ${value}. Expected one of: ${expected}`)
  return value
}

export function parseArgs(argv: string[], env: ParseArgsEnvironment): ParsedArgs {
  const commandText = readFlagValue(argv, "--agent")
  const headless = argv.includes("--headless")
  const demoTranscript = argv.includes("--demo-transcript")
  const animationTheme = parseAnimationTheme(argv)

  if (argv.includes("--agent")) {
    if (!commandText) throw new Error("--agent requires a command string")
    return { agent: commandFromShellText(commandText), headless, demoTranscript, animationTheme }
  }

  return {
    agent: {
      command: env.isBunRuntime ? env.execPath : join(env.cwd, "node_modules", ".bin", "tsx"),
      args: env.isBunRuntime ? ["run", "src/mock-agent.ts"] : ["src/mock-agent.ts"],
      label: "mock-agent",
    },
    headless,
    demoTranscript,
    animationTheme,
  }
}
