import { buildTranscriptRows, type TranscriptEntry } from "./view"

export type TextAgentClientUi = {
  isInteractive: false
  setStatus(status: string): void
  onSubmit(): void
  append(entry: TranscriptEntry): void
  updateLast(): void
  finishAgentMessage(): void
  showPanel(): void
  updatePanel(): void
  hidePanel(): void
  toggleSidebar(): void
  destroy(): void
}

export function createTextUi(): TextAgentClientUi {
  return {
    isInteractive: false,
    setStatus(status) {
      process.stdout.write(`● status ${status}\n`)
    },
    onSubmit() {},
    append(entry) {
      for (const row of buildTranscriptRows([entry])) {
        process.stdout.write(`${row.label} ${row.text}\n`)
      }
    },
    updateLast() {},
    finishAgentMessage() {},
    showPanel() {},
    updatePanel() {},
    hidePanel() {},
    toggleSidebar() {},
    destroy() {},
  }
}
