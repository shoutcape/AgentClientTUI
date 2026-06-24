export type QueuedPrompt = {
  prompt: string
  options?: { panel?: boolean }
}

export type PromptQueueCallbacks = {
  /** Called immediately when a prompt is accepted into the queue while the agent is busy. */
  onQueued: (prompt: string, options?: { panel?: boolean }) => void
  /** Called just before a prompt starts executing (i.e. it was previously queued). */
  onDequeued: (prompt: string, options?: { panel?: boolean }) => void
  /** Execute one prompt. Should resolve when the agent response is complete. */
  run: (prompt: string, options?: { panel?: boolean }) => Promise<void>
}

export type PromptQueue = {
  /** Enqueue a prompt. Returns a promise that resolves when the prompt has been fully processed. */
  enqueue: (prompt: string, options?: { panel?: boolean }) => void
  /** How many prompts are currently queued (not counting the one in flight). */
  readonly pendingCount: number
}

export function createPromptQueue(callbacks: PromptQueueCallbacks): PromptQueue {
  const queue: QueuedPrompt[] = []
  let draining = false

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    while (queue.length > 0) {
      const item = queue.shift()!
      try {
        await callbacks.run(item.prompt, item.options)
      } catch {
        // Individual prompt errors are handled inside `run`. The queue keeps draining.
      }
    }
    draining = false
  }

  return {
    enqueue(prompt, options) {
      if (draining || queue.length > 0) {
        callbacks.onQueued(prompt, options)
      }
      queue.push(options !== undefined ? { prompt, options } : { prompt })
      void drain()
    },
    get pendingCount() {
      return queue.length
    },
  }
}
