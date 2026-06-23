# Transcript Tree Scroll Design - AgentClientTUI

Date: 2026-06-23
Status: Approved

## Overview

Refactor the transcript area so long and streaming content stays readable, scrollable, and responsive. The current UI stores a flat `TranscriptEntry[]`, renders only `transcript.slice(-24)`, and rebuilds the root render tree on each update. Long content can overrun the transcript box, and there is no persistent scroll state.

The new design uses a structured transcript model plus OpenTUI's native `ScrollBoxRenderable`. The transcript source of truth becomes a message tree. The UI renders that tree as stable child renderables inside a persistent native scroll box. Streaming updates mutate the active assistant message block, while the scroll box handles viewport clipping, mouse scrolling, scrollbar state, and bottom stickiness.

## Goals

- Keep transcript content inside the transcript panel when messages are long.
- Allow transcript scrolling with keyboard and mouse.
- Follow the bottom during streaming by default.
- Preserve user scroll position when content streams, status changes, cursor blinks, or input changes.
- Keep the input bar pinned below the transcript.
- Preserve current visual style and avoid broad UI redesign.
- Provide a model that can later support tool calls, status blocks, markdown, folding, and richer message rendering.

## Non-Goals

- No full markdown rendering in the first version.
- No transcript persistence across application restarts.
- No search, filtering, folding, or copy-mode UI in the first version.
- No split-footer terminal scrollback mode for the primary app UI.
- No new agent protocol behavior.

## Architecture

### Transcript Model

The transcript becomes a message tree, not a pre-rendered row list.

```typescript
type TranscriptKind = "user" | "agent" | "status" | "error" | "log"

type TranscriptBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "status"; text: string }

type TranscriptNode = {
  id: string
  kind: TranscriptKind
  blocks: TranscriptBlock[]
}
```

Initial implementation can keep one `text` block per message, but the block layer is intentional. It gives future tool/status/code rendering a stable place without changing transcript ownership again.

### Streaming Semantics

Streaming assistant output updates an active assistant node instead of replacing an arbitrary last flat entry.

Expected behavior:

- User prompt appends a new `user` node.
- First assistant chunk appends a new `agent` node with one text block and marks that node as the active assistant stream.
- Later assistant chunks update that active node's text block.
- When the prompt promise resolves in `src/index.ts`, the UI receives an explicit stream-finished operation and clears the active assistant stream.
- Errors, logs, and status entries append their own nodes and do not accidentally overwrite the active assistant message.

The first implementation may preserve the existing external UI API shape (`append` and `updateLast`) if that keeps integration small, but stream ownership must be explicit internally:

- `append({ kind: "agent", text })` starts or replaces the active assistant stream with the appended agent node.
- `updateLast(text)` updates the active assistant stream when one exists.
- `updateLast(text)` no-ops when no active assistant stream exists.
- A new internal or public operation, for example `finishAgentMessage()`, clears the active assistant stream after `client.prompt(...)` resolves.

A later cleanup can expose a more explicit streaming API such as `startAgentMessage`, `updateAgentMessage`, and `finishAgentMessage`.

### Native Scroll Box

The interactive UI renders transcript content inside one persistent OpenTUI `ScrollBoxRenderable` or `ScrollBox` construct.

Configuration:

```typescript
{
  id: "transcript-scroll",
  flexGrow: 1,
  width: "100%",
  scrollY: true,
  scrollX: false,
  stickyScroll: true,
  stickyStart: "bottom",
  viewportCulling: true,
}
```

OpenTUI features used:

- `stickyScroll` and `stickyStart: "bottom"` keep the transcript pinned to new content while the user is at the bottom.
- Manual scroll disengages sticky bottom behavior.
- `scrollTo` or `scrollBy` handles keyboard navigation.
- Native mouse scroll works through `ScrollBoxRenderable` event handling.
- `viewportCulling` prevents rendering all children when many nodes exist.
- `TextRenderable` uses `wrapMode: "word"` so long text wraps inside the available width.

### Why Not Split-Footer Scrollback

OpenTUI also has split-footer scrollback APIs: `writeToScrollback` and `createScrollbackSurface`. They are strong for apps where output should become terminal scrollback above a fixed footer. AgentClientTUI is currently a full-screen alternate-screen app with a sidebar, overlays, palette, and transcript panel. Split-footer would change the product model and make overlays/sidebar coordination harder.

Use `ScrollBoxRenderable` for the first version. Revisit split-footer only if the product later wants terminal-native scrollback output instead of an in-app transcript panel.

## Rendering Design

### Persistent Transcript Subtree

The current render function removes `app-root` and rebuilds the entire tree on every render. That resets native renderable state and conflicts with scroll persistence.

The new design should keep transcript scrolling state stable by preserving the transcript scroll box across renders. There are two acceptable implementation paths:

1. Preferred: create the main app tree once, keep references to important renderables, and update child/content renderables in place.
2. Fallback: if full tree persistence is too large for this pass, isolate the transcript into a persistent scroll box and only rebuild non-transcript areas.

Do not rely on `transcript.slice(-24)` in the interactive UI. The scroll box owns viewport clipping.

### Message Render Shape

Each transcript node renders as a small vertical group:

```text
● user        prompt text wraps here
◆ assistant   assistant text wraps here
              continuation lines align under content
```

Implementation can render each message as:

- Outer `Box` with `flexDirection: "row"`, `width: "100%"`, and a small gap.
- Label `Text` with fixed width or min width.
- Body `Box` with `flexGrow: 1`, `flexDirection: "column"`.
- Body `Text` with `wrapMode: "word"`, `width: "100%"`, and kind-specific color.

Status and error kinds use existing labels and colors from `opencodeTheme`.

### Text Mode Fallback

The headless text UI can keep using flattened row output. It does not need native scroll support. It should format each node/block into the same label and text shape used today.

## Keyboard Behavior

Transcript scrolling is always active unless a higher-priority UI state consumes the key first.

Priority order:

1. Exit confirmation and global lifecycle keys.
2. Panel overlay, if open.
3. Command palette or dropdown, if open.
4. Transcript scroll keys.
5. Normal input editing.

Initial scroll keys:

| Key | Action |
|-----|--------|
| PageUp | Scroll transcript up by one viewport. |
| PageDown | Scroll transcript down by one viewport. |
| Home | Scroll transcript to top. |
| End | Scroll transcript to bottom and re-engage sticky bottom behavior. |

Mouse wheel should scroll the transcript through native `ScrollBoxRenderable` behavior when pointer is over the transcript.

## Responsive Behavior

The transcript should remain within the existing main content layout:

- Header remains at top.
- Footer/status bar remains at bottom.
- Input bar remains pinned below transcript content.
- Sidebar remains on the right at desktop width.
- Transcript uses remaining vertical space with `flexGrow: 1`.
- Text wraps to the current transcript body width after terminal resize.

If a small terminal width makes the existing sidebar layout unusable, that is outside this feature. This refactor should not worsen the current behavior.

## Error Handling

- If `append({ kind: "agent", text })` is called, create a new active assistant stream even if another active stream exists. This matches the existing first-chunk behavior and avoids dropping content.
- If `updateLast` is called when no active assistant stream exists, no-op as current code does.
- If a non-agent entry is appended during an active assistant stream, do not mutate that non-agent entry through later assistant chunks.
- Keep protocol errors visible as `error` nodes.

## Testing

Unit tests should cover model and routing behavior without requiring native rendering:

- Appending nodes creates stable IDs and expected kind/block structure.
- Updating streamed assistant text mutates the active assistant block.
- Finishing an assistant stream clears the active stream so later `updateLast` calls no-op.
- Updating when transcript is empty is safe.
- Appending error/log/status entries does not corrupt active assistant state.
- Flattening for text fallback preserves labels and colors.
- Scroll key routing gives command UI and panel overlay priority over transcript scrolling.
- PageUp/PageDown/Home/End route to transcript scroll when no higher-priority UI consumes them.

Manual verification should cover:

- Long user prompt wraps inside transcript box.
- Long assistant stream wraps and follows bottom.
- User can PageUp during streaming and remain at manual scroll position.
- End returns to bottom-follow streaming.
- Mouse wheel scrolls transcript.
- Terminal resize does not break transcript layout.

## Implementation Notes

- Start with the smallest correct boundary. A new `src/ui/transcript.ts` module is acceptable if it keeps model and view helpers out of `ui.ts`.
- Avoid adding full markdown support in the first pass. Use `Text` with `wrapMode: "word"`.
- Keep existing labels and theme colors from `buildTranscriptRows` to limit visual churn.
- Prefer preserving current `AgentClientUi` public methods unless a cleaner internal helper is needed.
- Do not introduce backward compatibility for persisted transcript data because no transcript persistence exists.
