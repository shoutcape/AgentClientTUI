export type CommandListDisplayItem = { name: string; description: string }

export type CommandListRow = {
  item: CommandListDisplayItem
  index: number
  selected: boolean
}

export type CommandListWindow = {
  scrollStart: number
  rows: CommandListRow[]
}

export function buildCommandListWindow(
  items: CommandListDisplayItem[],
  selectedIndex: number,
  maxVisible: number,
): CommandListWindow {
  const scrollStart = Math.max(0, Math.min(selectedIndex - maxVisible + 1, items.length - maxVisible))
  const rows = items.slice(scrollStart, scrollStart + maxVisible).map((item, offset) => {
    const index = scrollStart + offset
    return { item, index, selected: index === selectedIndex }
  })
  return { scrollStart, rows }
}
