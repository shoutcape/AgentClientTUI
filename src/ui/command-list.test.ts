import { describe, expect, test } from "bun:test"
import { buildCommandListWindow } from "./command-list"

const items = Array.from({ length: 6 }, (_, index) => ({
  name: `/item-${index + 1}`,
  description: `Item ${index + 1}`,
}))

describe("command list window", () => {
  test("returns visible rows with selected state", () => {
    expect(buildCommandListWindow(items, 1, 3)).toEqual({
      scrollStart: 0,
      rows: [
        { item: items[0]!, index: 0, selected: false },
        { item: items[1]!, index: 1, selected: true },
        { item: items[2]!, index: 2, selected: false },
      ],
    })
  })

  test("scrolls selected row into view", () => {
    expect(buildCommandListWindow(items, 5, 3)).toEqual({
      scrollStart: 3,
      rows: [
        { item: items[3]!, index: 3, selected: false },
        { item: items[4]!, index: 4, selected: false },
        { item: items[5]!, index: 5, selected: true },
      ],
    })
  })

  test("handles empty lists", () => {
    expect(buildCommandListWindow([], 0, 3)).toEqual({ scrollStart: 0, rows: [] })
  })
})
