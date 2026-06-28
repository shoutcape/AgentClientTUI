# Quiet Stream Transcript Design

Date: 2026-06-28
Status: Draft

## Goal

Update AgentClientTUI transcript styling so assistant responses read as the default content stream, while non-default events are highlighted with compact colored strips. The transcript should become easier to scan without the current 13-column role-label gutter.

## Context

The interactive UI currently renders transcript nodes in `src/ui/transcript-renderer.ts` as rows with a fixed label column and a body column. Labels come from `getTranscriptLabel` in `src/ui/transcript.ts`, for example `◆ assistant`, `● user`, and `◦ tool`. This makes every message pay the same gutter cost, even though assistant prose is the main reading surface.

The text-mode fallback in `src/ui/text-ui.ts` uses `buildTranscriptRows` and can keep label-first output. This design targets the interactive OpenTUI transcript.

## Design Direction

Use the `Quiet Stream` style with soft event strips:

- Assistant responses are plain flow content.
- User prompts and operational events use compact colored strips.
- Code and diff blocks keep dedicated renderers and remain visually technical.
- The surrounding transcript frame becomes quieter so it does not compete with content.

Event strips mean "non-default event". No strip means assistant prose.

## Message Treatments

### Assistant

Assistant messages are the default surface:

- No left strip.
- No role gutter.
- No badge in the first pass.
- Text starts flush-left within the transcript content area.
- Background stays transparent against the transcript panel.
- Spacing is balanced, not dense and not spacious.

Streaming assistant updates must keep working. The implementation should not depend on the old label/body row structure when finding the active assistant text renderable. It should use a stable id or helper-owned structure that still exposes the live text renderable.

### User

User prompts are compact highlighted blocks:

- Colored left strip using the user color.
- Light tinted background.
- Compact vertical padding.
- No role gutter.
- No badge in the first pass.
- Prompt text remains flush-left after the strip padding.

User prompts are important anchors in the transcript, so they should be easy to spot without dominating assistant responses.

### Tool, Status, Log, Thought, Plan, Usage

Operational entries stay inline and muted:

- Colored left strip.
- Light tinted background.
- Muted foreground colors.
- Compact spacing.
- No nesting under assistant messages in this pass.

These entries should remain visible for debugging and context, but should not interrupt reading as much as assistant and user content.

### Error

Errors use the same event-strip pattern with stronger emphasis:

- Red left strip.
- Stronger red text.
- Subtle red tinted background.
- Compact block layout.

Errors should stand out clearly without introducing a separate interaction model.

### Code

Code blocks keep `CodeRenderable`:

- Preserve syntax highlighting via `getSyntaxStyle()`.
- Keep `wrapMode: "none"` unless a later design changes horizontal behavior.
- Keep code visually distinct from prose.
- Do not wrap code in the generic event-strip treatment.

Code block headers can become minimal inline metadata such as `code ts`, but the code body remains the main styled surface.

### Diff

Diff blocks keep `DiffRenderable`:

- Preserve unified diff rendering.
- Preserve added/removed backgrounds and signs.
- Preserve line numbers.
- Do not wrap diffs in the generic event-strip treatment.

Diff clarity is more important than matching the event-strip style.

## Transcript Frame

Keep the current transcript panel and surrounding layout, with a quieter treatment:

- Retain a subtle border around the transcript area.
- Keep the `transcript` label as a dim section label.
- Do not redesign the sidebar in this pass.
- Keep input and footer mostly unchanged unless spacing needs minor alignment after the transcript change.
- Preserve responsive sidebar behavior.

The frame should support reading and not compete with transcript content.

## Architecture

Keep the transcript state model unchanged. This is a rendering update, not a data model update.

Add a small surface mapping for interactive transcript rendering:

- `agent`: plain
- `user`: event strip
- `tool`: muted event strip
- `status`: muted event strip
- `log`: muted event strip
- `thought`: muted event strip
- `plan`: muted event strip
- `usage`: muted event strip
- `error`: strong event strip

The mapping can live in `src/ui/transcript-renderer.ts` unless it needs to be shared with tests. Avoid moving labels or text fallback behavior unless implementation demands it.

Replace the fixed role-gutter row in the interactive renderer with message-surface helpers:

- Plain text surface for assistant prose.
- Event strip surface for non-default text/status blocks.
- Dedicated code surface for code blocks.
- Dedicated diff surface for diff blocks.

The event strip can be implemented as a narrow colored child element plus a lightly tinted container background, or as a left border if OpenTUI supports that cleanly. Do not depend on literal `|` text as the visual design.

The text fallback can continue using `buildTranscriptRows` and existing labels because it is not the interactive visual surface.

## Behavior

- Assistant content starts at the main transcript text origin.
- User/tool/status/log/error content aligns with the same origin after strip padding.
- No interactive expand/collapse is added.
- No new command, setting, or theme picker is added.
- Existing transcript scrolling behavior remains unchanged.
- Existing command menus, prompt history, sidebar toggling, and input behavior remain unchanged.

## Testing

Use existing OpenTUI e2e tests and transcript unit tests.

Add or update coverage for:

- Assistant output no longer shows the old `◆ assistant` gutter in the interactive transcript.
- User output no longer shows the old `● user` gutter in the interactive transcript.
- Tool output no longer shows the old `◦ tool` gutter in the interactive transcript.
- User/tool/error entries use event strip renderables with tinted backgrounds and color-coded left strips.
- Tests may inspect render tree ids/options for event-strip surfaces when plain text frame capture cannot represent color or background.
- Code blocks still render through `CodeRenderable` and preserve syntax path behavior.
- Diff blocks still render through `DiffRenderable` and preserve diff path behavior.
- Active assistant streaming updates still replace the current assistant text instead of appending duplicates.
- Text-mode fallback still prints labeled rows.

Run `bun test src/ui/e2e.test.ts`, `bun test`, and `bun run typecheck` after implementation.

## Out Of Scope

- Nested tool/status entries under assistant messages.
- Collapsible transcript sections.
- Role badges.
- Full app chrome redesign.
- Sidebar redesign.
- Input bar redesign.
- Persistent display preferences.
- Theme picker or user-configurable transcript styles.
