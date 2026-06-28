type ShutdownSignal = "SIGINT" | "SIGTERM" | "SIGHUP"

type ProcessLike = {
  on(signal: ShutdownSignal, handler: () => void): unknown
  exit(code?: number): never
}

const SHUTDOWN_SIGNALS: ShutdownSignal[] = ["SIGINT", "SIGTERM", "SIGHUP"]

export function installShutdownHandlers(processLike: ProcessLike, cleanup: () => void): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    processLike.on(signal, () => {
      cleanup()
      processLike.exit(0)
    })
  }
}
