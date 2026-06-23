import { Box, Text } from "@opentui/core"
import type { CommandState } from "../commands/state"
import { opencodeTheme } from "./view"

export function buildDropdown(state: Extract<CommandState, { phase: "listing" | "drilldown" }>, items: Array<{ name: string; description: string }>) {
  const maxVisible = 8
  const visibleItems = items.slice(0, maxVisible)
  const isLoading = state.phase === "drilldown" && state.loading

  const children = []

  if (state.phase === "drilldown") {
    children.push(
      Box(
        { flexDirection: "row", width: "100%", paddingLeft: 1, paddingRight: 1 },
        Text({ content: `\u27F5 ${state.parent.name} \u2014 ${state.parent.description}`, fg: opencodeTheme.textMuted }),
      ),
    )
  }

  if (isLoading) {
    children.push(
      Box(
        { flexDirection: "row", paddingLeft: 1, paddingRight: 1 },
        Text({ content: "Loading...", fg: opencodeTheme.textMuted }),
      ),
    )
  } else {
    visibleItems.forEach((item, i) => {
      const selected = i === state.selectedIndex
      const boxOpts: Record<string, unknown> = {
        flexDirection: "row",
        width: "100%",
        paddingLeft: 1,
        paddingRight: 1,
      }
      if (selected) boxOpts.backgroundColor = opencodeTheme.primary
      children.push(
        Box(
          boxOpts,
          Text({
            content: item.name,
            fg: selected ? opencodeTheme.background : opencodeTheme.text,
          }),
          Text({
            content: ` \u2014 ${item.description}`,
            fg: selected ? opencodeTheme.background : opencodeTheme.textMuted,
          }),
        ),
      )
    })
  }

  children.push(
    Box(
      { flexDirection: "row", paddingLeft: 1, paddingRight: 1 },
      Text({ content: "\u2191\u2193 navigate \u00B7 Enter select \u00B7 Esc close", fg: opencodeTheme.textMuted }),
    ),
  )

  return Box(
    {
      flexDirection: "column",
      width: "100%",
      maxWidth: 60,
      borderStyle: "single",
      borderColor: opencodeTheme.primary,
      backgroundColor: opencodeTheme.backgroundElement,
    },
    ...children,
  )
}
