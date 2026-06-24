import { join } from "node:path"
import { execPath } from "node:process"
import { commandFromShellText } from "../src/agent-command"
import { defaultTraceOutFile, runTraceScenario, type TraceScenario } from "../src/acp/trace-harness"
import type { AgentCommand } from "../src/acp/types"

type CliOptions = {
  agent: AgentCommand
  scenario: TraceScenario
  outFile?: string
  prompt?: string
  cwd?: string
}

const scenarios = new Set<TraceScenario>(["initialize", "new-prompt", "list"])

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  return argv[index + 1]
}

function isBunRuntime(): boolean {
  return typeof process.versions.bun === "string"
}

function defaultAgent(): AgentCommand {
  return {
    command: isBunRuntime() ? execPath : join(process.cwd(), "node_modules", ".bin", "tsx"),
    args: isBunRuntime() ? ["run", "src/mock-agent.ts"] : ["src/mock-agent.ts"],
    label: "mock-agent",
  }
}

function parseArgs(argv: string[]): CliOptions {
  const scenarioText = valueAfter(argv, "--scenario") ?? "initialize"
  if (!scenarios.has(scenarioText as TraceScenario)) {
    throw new Error(`Unsupported scenario: ${scenarioText}. Expected one of: ${[...scenarios].join(", ")}`)
  }

  const agentText = valueAfter(argv, "--agent")
  const agent = agentText ? commandFromShellText(agentText) : defaultAgent()
  const options: CliOptions = { agent, scenario: scenarioText as TraceScenario }
  const outFile = valueAfter(argv, "--out")
  const prompt = valueAfter(argv, "--prompt")
  const cwd = valueAfter(argv, "--cwd")
  if (outFile) options.outFile = outFile
  if (prompt) options.prompt = prompt
  if (cwd) options.cwd = cwd

  return options
}

try {
  const options = parseArgs(process.argv.slice(2))
  const outFile = options.outFile ?? defaultTraceOutFile(options.agent.label, options.scenario)
  const result = await runTraceScenario({ ...options, outFile })

  process.stdout.write(`trace: ${outFile}\n`)
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exit(1)
}
