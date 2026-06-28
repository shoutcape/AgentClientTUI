# Prompt History Navigation Design

Date: 2026-06-28
Status: Draft

## Goal

Add normal input prompt history navigation to AgentClientTUI. Pressing Up moves backward through submitted prompts, pressing Down moves forward, and moving past the newest history entry restores the draft that was being edited before history browsing started.

## ACP Boundary

ACP providers own conversation and session history, not input-line recall. Provider-backed history belongs to `session/list`, `session/load`, `session/resume`, and replayed `session/update` messages. Local Up/Down prompt recall is client UI state, similar to shell input history.

This feature must not call ACP for history navigation. It should only record prompts already submitted through the UI. Future session-load work may optionally seed local prompt recall from replayed `user_message_chunk` updates, but that is out of scope here.

## Behavior

- In normal input mode, Up shows the most recent remembered prompt.
- Repeated Up moves older until the first remembered prompt, then stays there.
- Down moves newer.
- Down past the newest remembered prompt restores the draft that existed before browsing began.
- If no history exists, Up and Down do nothing.
- Typing, backspace, paste, or submitting while browsing exits history browsing and keeps the visible input as the new draft/submission.
- Command menus keep current behavior. Up and Down still navigate `/` dropdowns and `Ctrl+P` palettes.
- Transcript scrolling keeps current behavior. PageUp/PageDown scroll transcript content; Up/Down are not transcript scroll keys.

## Remembered Entries

Remember submitted user prompts and ACP slash commands. Do not remember exact local UI app commands such as `Quit` or `Toggle Session Panel`.

This means:

- Free-text prompt `explain this code` is remembered.
- Free-text prompt `Quit now` is remembered.
- ACP command `/model sonnet` is remembered.
- ACP command `/context show` is remembered.
- Local palette command `Quit` is not remembered.
- Local palette command `Toggle Session Panel` is not remembered.

Repeated prompts may be stored as repeated entries. This keeps the model simple and preserves the exact submitted sequence.

## Architecture

Keep history state inside `createAgentClientUi` because it is interactive UI state. The text-mode UI does not process keyboard input and does not need history support.

Add small local helper functions in `src/ui.ts`:

- `resetPromptHistoryBrowse()` clears browsing state.
- `shouldRememberPrompt(prompt)` checks the command registry and skips local app commands.
- `rememberPrompt(prompt)` appends remembered prompts and exits browsing.
- `navigatePromptHistory(direction)` updates `inputValue` for Up/Down and restores saved drafts.

No new protocol, storage, or provider API is needed.

## Data Model

Use three local variables in `createAgentClientUi`:

```ts
let promptHistory: string[] = []
let historyIndex: number | null = null
let historyDraft = ""
```

`historyIndex === null` means the user is not currently browsing history. When browsing starts, store the current `inputValue` in `historyDraft` before replacing input with the newest history item.

## Control Flow

Normal key handling order should stay mostly unchanged:

1. Global Ctrl+C and Ctrl+P handling stays first.
2. Active command menus handle Up/Down before history logic.
3. Normal input mode handles Up/Down as history navigation.
4. PageUp/PageDown still route to transcript scrolling.
5. Text edit keys go through `handleInputKey`.

Remember prompts when they are accepted for submission, not when typed. For command-menu execution, use the selected command descriptor to decide whether it is a local app command before remembering.

## Error Handling

History navigation should be no-op safe. Empty history, invalid index state, and local commands should not throw. The feature has no async work and no I/O.

## Testing

Use existing OpenTUI e2e tests because key routing is the main behavior. Add coverage for:

- Submitted prompt order: `first`, `second`, Up, Up, Down, Down.
- Draft restoration: type `draft`, Up to latest history, Down restores `draft`.
- Browse exit on edit: Up to history, type `!`, input becomes edited history item and exits browsing.
- Local app command exclusion if practical through `Ctrl+P` selection.
- Command menu Up/Down remains command navigation.

Run `bun test src/ui/e2e.test.ts`, `bun test`, and `bun run typecheck`.

## Out Of Scope

- Persistent history across app restarts.
- Provider session listing/loading.
- Seeding prompt recall from loaded session replay.
- Recently used command ranking.
- Multi-line input editing.
