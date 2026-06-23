import { Box, Text } from "@opentui/core"
import { opencodeTheme } from "./view"

export function buildPanelOverlay(title: string, content: string, hints?: string) {
  return Box(
    {
      flexDirection: "column",
      width: "90%",
      borderStyle: "single",
      borderColor: opencodeTheme.secondary,
      backgroundColor: opencodeTheme.backgroundPanel,
      padding: 1,
      gap: 1,
    },
    Text({ content: title, fg: opencodeTheme.secondary }),
    Text({ content, fg: opencodeTheme.text }),
    Text({ content: hints ?? "Esc close", fg: opencodeTheme.textMuted }),
  )
}
