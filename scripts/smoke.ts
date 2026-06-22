import { spawn } from "node:child_process"
import { join } from "node:path"

const child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/index.ts", "--headless"], {
  stdio: ["ignore", "pipe", "pipe"],
})

let stdout = ""
let stderr = ""

child.stdout.on("data", (chunk: Buffer) => {
  stdout += chunk.toString("utf8")
})

child.stderr.on("data", (chunk: Buffer) => {
  stderr += chunk.toString("utf8")
})

const code = await new Promise<number | null>((resolve) => {
  const timeout = setTimeout(() => {
    child.kill("SIGTERM")
    resolve(124)
  }, 5000)

  child.on("exit", (exitCode) => {
    clearTimeout(timeout)
    resolve(exitCode)
  })
})

const required = [
  "● status initialized",
  "● status session mock-session-1",
  "● user Say hello from AgentClientTUI.",
  "session/update",
  "● status prompt response",
  "● status complete",
]

const missing = required.filter((needle) => !stdout.includes(needle))

if (code !== 0 || missing.length > 0) {
  console.error("Smoke test failed")
  console.error(`Exit code: ${code}`)
  console.error(`Missing: ${missing.join(", ")}`)
  console.error("stdout:")
  console.error(stdout)
  console.error("stderr:")
  console.error(stderr)
  process.exit(1)
}

console.log("Smoke test passed")
