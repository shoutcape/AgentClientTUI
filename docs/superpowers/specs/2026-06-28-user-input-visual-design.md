# User Input Visual Design

Date: 2026-06-28
Status: Approved Draft

## Goal

Make user-authored content easier to spot by giving the user a dedicated visual color that appears in both the active input surface and submitted user prompts. The input should feel like the place where the user acts, while assistant text remains the quiet default reading surface.

## Context

The current interactive UI builds a bottom input bar from `buildInputBar()` and renders it in `src/ui.ts` as a bordered single-line box. The quiet transcript design changes transcript messages but explicitly left input redesign out of scope. This design adds a focused user-signal layer for input and user prompt recognition.

The command surfaces have two different meanings:

- Slash dropdown belongs to the input flow because it opens from `/` in the bottom input.
- `Ctrl+P` palette is an app-level command surface and should keep the existing app accent.

## Design Direction

Use a `User Signal Family` treatment:

- User color: violet `#a78bfa`.
- Input, submitted user prompt strips, and slash dropdown share the violet signal.
- `Ctrl+P` palette keeps the existing app accent.
- User and event strip thickness uses the thinnest practical terminal treatment: one colored terminal column with no extra colored gutter padding. In browser mockups this corresponded to a `2px` strip.
- Soft radius means OpenTUI `borderStyle: "rounded"` on bordered input-family surfaces. Plain unbordered transcript backgrounds should not fake CSS clipping with literal characters.

## Input Bar

The input bar uses violet as a persistent but restrained ownership cue:

- Prompt `>` uses violet.
- Cursor/caret uses violet.
- Border uses a faint violet color when idle.
- Border becomes stronger violet when the terminal is focused and the input is active.
- Border also becomes stronger while the slash dropdown is open.
- Typed text remains the normal foreground color.
- Empty input keeps the existing no-placeholder behavior.
- Shape uses OpenTUI `borderStyle: "rounded"` for the input border.

The input should read as user-owned without competing with transcript content.

## Submitted User Prompts

Submitted user prompts use the same violet color so prior user actions are easy to scan:

- Left strip uses violet `#a78bfa`.
- Background uses a faint violet tint.
- Text remains high-contrast foreground.
- The block has compact padding.
- If the user prompt block receives a visible border, that border uses `borderStyle: "rounded"`. If it remains an unbordered tinted block, keep the tint compact and do not fake rounded corners with text characters.
- No role badge or gutter is added.

The user prompt strip is an anchor in the transcript. It should be visible but smaller and calmer than the current thick block treatment.

## Event Strips

All non-user event strips from the quiet transcript design should use the thinnest practical left strip: one colored terminal column with no extra colored gutter padding. This is the terminal equivalent of the approved `2px` browser mockup strip.

Apply soft radius to event-strip blocks only when a visible border is used; otherwise keep the event-strip blocks compact and unbordered. Keep their existing semantic colors:

- Tool and informational events keep blue/muted treatment.
- Status/log/thought/plan/usage stay muted.
- Errors keep stronger red treatment.
- User prompts use violet.

This softens the transcript without turning the full app chrome into rounded cards.

## Slash Dropdown

The slash dropdown belongs to the input surface and should share user violet:

- Dropdown border uses violet.
- Selected row uses violet.
- Shape uses OpenTUI `borderStyle: "rounded"`, matching the input bar.
- Position and attachment above the input remain unchanged.
- Existing command navigation and drilldown behavior remain unchanged.

The dropdown should feel like an extension of typing, not a separate app modal.

## Palette

The `Ctrl+P` palette remains app-level:

- Keep existing accent color.
- Keep existing centered modal layout.
- Keep existing selection and border colors.

Do not convert all command surfaces to violet.

## Architecture

Add user-signal values to the interactive UI theme surface rather than scattering literal colors through render functions.

Theme additions:

- `user`: `#a78bfa`
- `userBorder`: `#4a3f62`
- `userBackground`: `#211a2e`

Rendering updates should stay close to existing owners:

- `buildInputBar()` exposes user-colored prompt and cursor metadata while keeping typed value text on the normal foreground color.
- `src/ui.ts` applies input border, active border state, slash dropdown placement, and focus-aware state.
- `src/ui/dropdown.ts` uses the user color for slash dropdown borders and selected rows.
- `src/ui/transcript-renderer.ts` uses the user color for submitted user prompt event strips and thinner event-strip bars.

Avoid adding settings, theme pickers, or persistent preferences.

## Behavior

- Existing keyboard input behavior remains unchanged.
- Existing prompt history behavior remains unchanged.
- Existing paste behavior remains unchanged.
- Existing slash command behavior remains unchanged.
- Existing `Ctrl+P` palette behavior remains unchanged.
- Existing sidebar behavior remains unchanged.
- Existing text-mode fallback can keep label-first output and does not need this visual treatment.

## Testing

Update or add coverage for:

- Input bar uses violet prompt and violet cursor when active.
- Empty input still shows only the cursor when active and no placeholder.
- Input bar has faint violet border by default and stronger violet border when active or when slash dropdown is open, if render tree inspection supports this.
- Submitted user prompts use violet event strip treatment in the interactive renderer.
- Event strip visual weight is reduced to the new thin value.
- Slash dropdown uses violet border and selected row color.
- `Ctrl+P` palette still uses the app accent, not violet.
- Existing prompt history, slash dropdown, palette, and transcript tests still pass.

Run `bun test src/ui/e2e.test.ts`, `bun test`, and `bun run typecheck` after implementation.

## Out Of Scope

- Multi-line input editing.
- Placeholder text.
- Input mode labels.
- A theme picker or persistent display preference.
- Global command palette recoloring.
- Full app chrome radius redesign.
- Sidebar redesign.
- Text-mode visual parity.
