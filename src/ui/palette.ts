import { Box, Text } from "@opentui/core"
import type { CommandState } from "../commands/state"
import { opencodeTheme } from "./view"

export function buildPalette(state: Extract<CommandState, { phase: "listing" | "drilldown" }>, items: Array<{ name: string; description: string }>) {
  const maxVisible = 12
  const scrollStart = Math.max(0, Math.min(state.selectedIndex - maxVisible + 1, items.length - maxVisible))
  const visibleItems = items.slice(scrollStart, scrollStart + maxVisible)
  const isLoading = state.phase === "drilldown" && state.loading
  const query = state.query

  const itemRows = []

  if (state.phase === "drilldown") {
    itemRows.push(
      Box(
        { flexDirection: "row", width: "100%", paddingLeft: 1 },
        Text({ content: `\u27F5 ${state.parent.name} \u2014 ${state.parent.description}`, fg: opencodeTheme.textMuted }),
      ),
    )
  }

  if (isLoading) {
    itemRows.push(
      Box(
        { flexDirection: "row", paddingLeft: 1 },
        Text({ content: "Loading...", fg: opencodeTheme.textMuted }),
      ),
    )
  } else {
    visibleItems.forEach((item, i) => {
      const selected = (i + scrollStart) === state.selectedIndex
      itemRows.push(
        Box(
          {
            flexDirection: "row",
            width: "100%",
            paddingLeft: 1,
            paddingRight: 1,
            ...(selected ? { backgroundColor: opencodeTheme.accent } : {}),
          },
          Text({ content: item.name, fg: selected ? "#fff" : opencodeTheme.text }),
          Text({ content: ` \u2014 ${item.description}`, fg: selected ? "#fff" : opencodeTheme.textMuted }),
        ),
      )
    })
  }

  return Box(
    {
      flexDirection: "column",
      width: "70%",
      borderStyle: "single",
      borderColor: opencodeTheme.accent,
      backgroundColor: opencodeTheme.backgroundPanel,
    },
    Box(
      {
        flexDirection: "row",
        width: "100%",
        paddingLeft: 1,
        paddingRight: 1,
        borderStyle: "single",
        borderColor: opencodeTheme.borderSubtle,
      },
      Text({ content: "\u2318 ", fg: opencodeTheme.accent }),
      Text({ content: query || " ", fg: opencodeTheme.text }),
    ),
    ...itemRows,
    Box(
      { flexDirection: "row", paddingLeft: 1, paddingRight: 1 },
      Text({ content: "\u2191\u2193 navigate \u00B7 Enter select \u00B7 Esc close", fg: opencodeTheme.textMuted }),
    ),
  )
}
