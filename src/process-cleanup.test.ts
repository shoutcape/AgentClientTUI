import { describe, expect, test } from "bun:test"
import { installShutdownHandlers } from "./process-cleanup"

type SignalHandler = () => void

function createFakeProcess() {
  const handlers = new Map<string, SignalHandler>()
  return {
    handlers,
    on(signal: string, handler: SignalHandler) {
      handlers.set(signal, handler)
      return this
    },
    exitCode: undefined as number | undefined,
    exit(code?: number) {
      this.exitCode = code
      throw new Error(`exit:${code}`)
    },
  }
}

describe("installShutdownHandlers", () => {
  test("cleans up and exits on restart and interrupt signals", () => {
    const fakeProcess = createFakeProcess()
    const calls: string[] = []

    installShutdownHandlers(fakeProcess, () => calls.push("cleanup"))

    expect([...fakeProcess.handlers.keys()]).toEqual(["SIGINT", "SIGTERM", "SIGHUP"])

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      calls.length = 0
      expect(() => fakeProcess.handlers.get(signal)?.()).toThrow("exit:0")
      expect(calls).toEqual(["cleanup"])
      expect(fakeProcess.exitCode).toBe(0)
    }
  })
})
