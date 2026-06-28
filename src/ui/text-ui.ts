import { buildTranscriptRows, type TranscriptEntry } from "./view"
import type { QuestionRequest, QuestionResponse } from "../acp/question"
import type { AnimationThemeName } from "./animation-theme"

export type TextAgentClientUi = {
  isInteractive: false
  setStatus(status: string): void
  setAnimationTheme(themeName: AnimationThemeName): void
  onSubmit(): void
  append(entry: TranscriptEntry): void
  updateLast(): void
  finishAgentMessage(): void
  showPanel(): void
  updatePanel(): void
  hidePanel(): void
  toggleSidebar(): void
  askQuestions(request: QuestionRequest): Promise<QuestionResponse>
  destroy(): void
}

export function createTextUi(): TextAgentClientUi {
  return {
    isInteractive: false,
    setStatus(status) {
      process.stdout.write(`● status ${status}\n`)
    },
    setAnimationTheme() {},
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
    askQuestions() {
      return Promise.reject(new Error("Question prompts require interactive UI"))
    },
    destroy() {},
  }
}
