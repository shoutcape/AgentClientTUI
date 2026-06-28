import { Box, Text } from "@opentui/core"
import type { CommandState } from "../commands/state"
import { buildCommandListWindow, type CommandListDisplayItem } from "./command-list"
import { opencodeTheme } from "./view"

export type PaletteRenderOptions = {
  loadingText?: string
}

export function buildPalette(
  state: Extract<CommandState, { phase: "listing" | "drilldown" }>,
  items: CommandListDisplayItem[],
  options: PaletteRenderOptions = {},
) {
  const maxVisible = 12
  const listWindow = buildCommandListWindow(items, state.selectedIndex, maxVisible)
  const isLoading = state.phase === "drilldown" && state.loading
  const query = state.query

  const itemRows = []

  if (state.phase === "drilldown") {
    itemRows.push(
      Box(
        { flexDirection: "row", width: "100%", height: 1, paddingLeft: 1 },
        Text({ content: `\u27F5 ${state.parent.name} \u2014 ${state.parent.description}`, fg: opencodeTheme.textMuted }),
      ),
    )
  }

  if (isLoading) {
    itemRows.push(
      Box(
        { flexDirection: "row", height: 1, paddingLeft: 1 },
        Text({ content: options.loadingText ?? "Loading...", fg: opencodeTheme.textMuted }),
      ),
    )
  } else {
    listWindow.rows.forEach(({ item, selected }) => {
      itemRows.push(
        Box(
          {
            flexDirection: "row",
            width: "100%",
            height: 1,
            paddingLeft: 1,
            paddingRight: 1,
            ...(selected ? { id: "command-palette-selected-row", backgroundColor: opencodeTheme.accent } : {}),
          },
          Text({ content: item.name, fg: selected ? "#fff" : opencodeTheme.text }),
          Text({ content: ` \u2014 ${item.description}`, fg: selected ? "#fff" : opencodeTheme.textMuted }),
        ),
      )
    })
  }

  return Box(
    {
      id: "command-palette",
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
        height: 3,
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
      { flexDirection: "row", height: 1, paddingLeft: 1, paddingRight: 1 },
      Text({ content: "\u2191\u2193 navigate \u00B7 Enter select \u00B7 Esc close", fg: opencodeTheme.textMuted }),
    ),
  )
}
