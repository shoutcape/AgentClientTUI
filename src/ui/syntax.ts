import { SyntaxStyle } from "@opentui/core"
import { opencodeTranscriptTheme } from "./transcript"

let syntax: SyntaxStyle | undefined

export function getSyntaxStyle(): SyntaxStyle {
  syntax ??= SyntaxStyle.fromTheme([
    { scope: ["default"], style: { foreground: opencodeTranscriptTheme.text } },
    { scope: ["comment", "comment.documentation"], style: { foreground: opencodeTranscriptTheme.textMuted, italic: true } },
    { scope: ["string", "symbol"], style: { foreground: opencodeTranscriptTheme.success } },
    { scope: ["number", "boolean", "constant"], style: { foreground: opencodeTranscriptTheme.warning } },
    { scope: ["keyword"], style: { foreground: opencodeTranscriptTheme.accent, italic: true } },
    { scope: ["function", "function.call", "function.method", "function.method.call"], style: { foreground: opencodeTranscriptTheme.secondary } },
    { scope: ["type", "class", "module"], style: { foreground: opencodeTranscriptTheme.info } },
    { scope: ["operator", "punctuation", "punctuation.bracket", "punctuation.delimiter"], style: { foreground: opencodeTranscriptTheme.text } },
  ])
  return syntax
}
