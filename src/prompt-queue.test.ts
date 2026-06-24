import { describe, expect, test } from "bun:test"
import { createPromptQueue } from "./prompt-queue"

type RunCall = { prompt: string; options?: { panel?: boolean } }

function makeDeferred() {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe("createPromptQueue", () => {
  test("runs a single prompt immediately", async () => {
    const ran: RunCall[] = []
    const q = createPromptQueue({
      onQueued: () => {},
      onDequeued: () => {},
      run: async (prompt, options) => { ran.push(options !== undefined ? { prompt, options } : { prompt }) },
    })

    q.enqueue("hello")
    await new Promise<void>((r) => setTimeout(r, 0))

    expect(ran).toEqual([{ prompt: "hello" }])
  })

  test("FIFO: runs prompts in submission order", async () => {
    const ran: string[] = []
    const deferreds = [makeDeferred(), makeDeferred(), makeDeferred()]
    let callCount = 0

    const q = createPromptQueue({
      onQueued: () => {},
      onDequeued: () => {},
      run: async (prompt) => {
        const d = deferreds[callCount++]
        ran.push(`start:${prompt}`)
        await d!.promise
        ran.push(`end:${prompt}`)
      },
    })

    q.enqueue("A")
    q.enqueue("B")
    q.enqueue("C")

    // A started, B+C queued
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(ran).toEqual(["start:A"])

    deferreds[0]!.resolve()
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(ran).toContain("end:A")
    expect(ran).toContain("start:B")

    deferreds[1]!.resolve()
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(ran).toContain("end:B")
    expect(ran).toContain("start:C")

    deferreds[2]!.resolve()
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(ran).toContain("end:C")
  })

  test("only one prompt in-flight at a time", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const d = [makeDeferred(), makeDeferred()]
    let callCount = 0

    const q = createPromptQueue({
      onQueued: () => {},
      onDequeued: () => {},
      run: async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await d[callCount++]!.promise
        inFlight--
      },
    })

    q.enqueue("A")
    q.enqueue("B")
    await new Promise<void>((r) => setTimeout(r, 0))

    expect(maxInFlight).toBe(1)
    d[0]!.resolve()
    await new Promise<void>((r) => setTimeout(r, 0))
    d[1]!.resolve()
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(maxInFlight).toBe(1)
  })

  test("queue keeps draining after a failed prompt", async () => {
    const ran: string[] = []
    const q = createPromptQueue({
      onQueued: () => {},
      onDequeued: () => {},
      run: async (prompt) => {
        ran.push(prompt)
        if (prompt === "bad") throw new Error("agent error")
      },
    })

    q.enqueue("bad")
    q.enqueue("good")
    await new Promise<void>((r) => setTimeout(r, 10))

    expect(ran).toEqual(["bad", "good"])
  })

  test("calls onQueued for prompts submitted while busy", async () => {
    const queued: string[] = []
    const d = [makeDeferred(), makeDeferred()]
    let callCount = 0

    const q = createPromptQueue({
      onQueued: (prompt) => queued.push(prompt),
      onDequeued: () => {},
      run: async () => { await d[callCount++]!.promise },
    })

    q.enqueue("A")
    q.enqueue("B")
    q.enqueue("C")

    expect(queued).toEqual(["B", "C"])

    d[0]!.resolve()
    d[1]!.resolve()
    d[2]?.resolve()
  })

  test("does not call onQueued for the first prompt", async () => {
    const queued: string[] = []
    const q = createPromptQueue({
      onQueued: (p) => queued.push(p),
      onDequeued: () => {},
      run: async () => {},
    })

    q.enqueue("only")
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(queued).toEqual([])
  })

  test("passes options through to run", async () => {
    const ran: RunCall[] = []
    const q = createPromptQueue({
      onQueued: () => {},
      onDequeued: () => {},
      run: async (prompt, options) => { ran.push(options !== undefined ? { prompt, options } : { prompt }) },
    })

    q.enqueue("/context show", { panel: true })
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(ran).toEqual([{ prompt: "/context show", options: { panel: true } }])
  })

  test("pendingCount reflects queued items (not in-flight)", async () => {
    const d = [makeDeferred(), makeDeferred(), makeDeferred()]
    let callCount = 0

    const q = createPromptQueue({
      onQueued: () => {},
      onDequeued: () => {},
      run: async () => { await d[callCount++]!.promise },
    })

    expect(q.pendingCount).toBe(0)
    q.enqueue("A")
    q.enqueue("B")
    q.enqueue("C")

    // A is in flight, B+C still in queue
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(q.pendingCount).toBe(2)

    d[0]!.resolve()
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(q.pendingCount).toBe(1)

    d[1]!.resolve()
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(q.pendingCount).toBe(0)

    d[2]!.resolve()
  })
})
