import { Box, Text } from "@opentui/core"
import type { CommandState } from "../commands/state"
import { opencodeTheme } from "./view"

export function buildDropdown(
  state: Extract<CommandState, { phase: "listing" | "drilldown" }>,
  items: Array<{ name: string; description: string }>,
) {
  const maxVisible = 8
  const scrollStart = Math.max(0, Math.min(state.selectedIndex - maxVisible + 1, items.length - maxVisible))
  const visibleItems = items.slice(scrollStart, scrollStart + maxVisible)
  const isLoading = state.phase === "drilldown" && state.loading

  const children = []

  if (state.phase === "drilldown") {
    children.push(
      Box(
        { flexDirection: "row", width: "100%", height: 1, paddingLeft: 1, paddingRight: 1 },
        Text({ content: `\u27F5 ${state.parent.name} - ${state.parent.description}`, fg: opencodeTheme.textMuted }),
      ),
    )
  }

  if (isLoading) {
    children.push(
      Box(
        { flexDirection: "row", height: 1, paddingLeft: 1, paddingRight: 1 },
        Text({ content: "Loading...", fg: opencodeTheme.textMuted }),
      ),
    )
  } else {
    visibleItems.forEach((item, i) => {
      const selected = (i + scrollStart) === state.selectedIndex
      const boxOpts: Record<string, unknown> = {
        flexDirection: "row",
        width: "100%",
        height: 1,
        paddingLeft: 1,
        paddingRight: 1,
      }
      if (selected) boxOpts.backgroundColor = opencodeTheme.primary
      children.push(
        Box(
          boxOpts,
          Text({
            content: item.name + (item.description ? ` - ${item.description}` : ""),
            fg: selected ? opencodeTheme.background : opencodeTheme.text,
            width: "100%",
            wrapMode: "none",
          }),
        ),
      )
    })
  }

  children.push(
    Box(
      { flexDirection: "row", height: 1, paddingLeft: 1, paddingRight: 1 },
      Text({ content: "\u2191\u2193 navigate \u00B7 Enter select \u00B7 Esc close", fg: opencodeTheme.textMuted }),
    ),
  )

  const rowCount = (state.phase === "drilldown" ? 1 : 0) + (isLoading ? 1 : visibleItems.length) + 1
  const totalHeight = rowCount + 2
  return Box(
    {
      flexDirection: "column",
      width: "100%",
      height: Math.min(totalHeight, 12),
      borderStyle: "single",
      borderColor: opencodeTheme.primary,
      backgroundColor: opencodeTheme.backgroundElement,
    },
    ...children,
  )
}
