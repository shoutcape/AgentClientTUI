# Animation Icon Themes Design

Date: 2026-06-28

## Goal

Add selectable animation and icon themes for AgentClientTUI. Themes should let users try quiet, playful, operational, and cyber terminal motion styles without changing layout, colors, borders, or transcript density.

## Non-Goals

- No color theme system.
- No layout or spacing theme system.
- No custom frame-buffer animation in the first pass.
- No dependency on image protocols, SVG, or emoji-width-sensitive icons.

## Theme Scope

Themes control only terminal-native glyphs and frame strings:

- Busy status frames.
- Loading frames.
- Working words.
- Cursor frames.
- Status icons.
- Tool icons.
- Command icons.
- Static fallback text.

Themes may use Nerd Font glyphs. Glyphs should remain one or two cells wide where they appear inline, to avoid layout jitter.

## Theme Set

### Quiet

Default theme. Uses subtle braille frames and existing low-motion status language. Best for long reading sessions.

Initial values:

- Busy frames: `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`.
- Loading frames: `◜ ◠ ◝ ◞ ◡ ◟`.
- Working words: `pondering`, `crunching`, `spelunking`, `noodling`, `simmering`, `scheming`, `rummaging`, `brewing`, `wrangling`, `conjuring`.
- Cursor frames: `█` and blank.
- Status icons: ready `✓`, failed `×`, generic `●`.
- Tool icons: running `⠋`, success `✓`, error `×`, waiting `·`.
- Command icons: loading `⋯`, selected `>`.
- Static busy text: `⋯ working`.

### Playful

Uses more expressive Nerd Font glyphs and livelier working words. Best for personality and discoverability.

Initial values:

- Busy frames: `󰚩 󰚪 󰚫 󰚬`.
- Loading frames: `󰇥 󰇦 󰇧 󰇨`.
- Working words: `brewing`, `summoning`, `sparkling`, `juggling`, `wandering`, `sketching`.
- Cursor frames: `█ ▓ ▒ ░`.
- Status icons: ready `󰄬`, failed `󰅚`, generic `󰚩`.
- Tool icons: running `󰚩`, success `󰄬`, error `󰅚`, waiting `󰇥`.
- Command icons: loading `󰇥`, selected `󰜄`.
- Static busy text: `󰚩 brewing`.

### Operational

Uses icons that map clearly to state: streaming, running, success, warning, error, waiting. Best for high-signal agent monitoring.

Initial values:

- Busy frames: `󰝤 󰝥 󰝦 󰝧`.
- Loading frames: `▖ ▘ ▝ ▗`.
- Working words: `routing`, `indexing`, `running`, `checking`, `resolving`, `tracking`.
- Cursor frames: `▌` and blank.
- Status icons: ready `󰄬`, failed `󰅚`, generic `󰙵`.
- Tool icons: running `󰏗`, success `󰄬`, error `󰅚`, waiting `󰔟`.
- Command icons: loading `󰔟`, selected `󰜄`.
- Static busy text: `󰙵 running`.

### Cyber

Uses powerline-style glyphs, scanline-like frames, and denser terminal motifs. Best as an opt-in high-energy theme.

Initial values:

- Busy frames: `▰▱▱ ▱▰▱ ▱▱▰ ▱▰▱`.
- Loading frames: `▰▱▱ ▱▰▱ ▱▱▰ ▱▰▱`.
- Working words: `scanning`, `tracing`, `syncing`, `routing`, `compiling`, `charging`.
- Cursor frames: `▰ ▱`.
- Status icons: ready `󰄬`, failed `󰅚`, generic ``.
- Tool icons: running `󰊠`, success `󰄬`, error `󰅚`, waiting `󰌵`.
- Command icons: loading `󰊠`, selected ``.
- Static busy text: ` scanning`.

## Architecture

Add `src/ui/animation-theme.ts` as the semantic theme layer. Keep `src/ui/animation.ts` as low-level frame utilities.

Suggested exports:

```ts
export type AnimationThemeName = "quiet" | "playful" | "operational" | "cyber"

export type AnimationIconTheme = {
  name: AnimationThemeName
  busyFrames: readonly string[]
  loadingFrames: readonly string[]
  workingWords: readonly string[]
  cursorFrames: readonly string[]
  statusIcons: {
    ready: string
    failed: string
    generic: string
  }
  toolIcons: {
    running: string
    success: string
    error: string
    waiting: string
  }
  commandIcons: {
    loading: string
    selected: string
  }
  staticBusyText: string
}

export function isAnimationThemeName(value: string): value is AnimationThemeName
export function getAnimationTheme(name: AnimationThemeName): AnimationIconTheme
export function formatThemedInfoStatus(theme: AnimationIconTheme, status: string, frameIndex: number, workingWord: string, animationsEnabled: boolean): string
```

The registry should be a plain typed object. This keeps themes testable without OpenTUI.

## UI Integration

`createAgentClientUi()` should accept:

```ts
animationTheme?: AnimationThemeName
```

Behavior:

- Default to `quiet`.
- Keep existing `animationsEnabled` as the master motion gate.
- Keep one shared `animationFrame` timer in `src/ui.ts`.
- Choose `workingWord` from the active theme's `workingWords`.
- When theme changes, choose a new working word and rerender.

Render paths:

- Info bar uses `formatThemedInfoStatus()`.
- Input cursor uses `theme.cursorFrames` when animations are enabled.
- Dropdown and palette loading rows use `theme.loadingFrames` when animations are enabled, else static fallback.
- Tool burst rows use `theme.toolIcons` from existing `ToolBurstStatus` values: `pending` maps to waiting, `running` maps to running, `done` maps to success, and `failed`, `blocked`, or `rejected` map to error.

## User Switching

Support both startup and runtime selection.

Startup:

```bash
npm run dev -- --animation-theme operational
```

Runtime:

- Add local command `/animation-theme`.
- Drilldown options: quiet, playful, operational, cyber.
- Selecting an option updates the active theme immediately and rerenders.

Invalid CLI values should fail with a clear error. Silent fallback would hide typos and make screenshots hard to reproduce.

## Reduced Motion And Headless

- `animationsEnabled: false` uses static theme fallback text and icons.
- Headless text UI remains static.
- Smoke tests should not depend on animation timing.

## Testing

Add focused tests for pure logic:

- Theme name validation.
- Registry lookup.
- Info status formatting for busy, ready, failed, and generic statuses.
- Static fallback when animations are disabled.

Add UI-level tests only where existing tests already cover render output:

- CLI option parsing rejects invalid theme names.
- Runtime command exposes all four theme options.
- Dropdown or palette loading content can render themed static fallback.

Do not snapshot every animation frame. Test one representative frame and one static fallback.

## Risks

- Nerd Font glyphs may render poorly if the user lacks the font. Existing environment has Nerd Fonts, but keep fallbacks readable.
- Overly wide glyphs can jitter inline rows. Keep inline frames short.
- More frequent rerenders can hurt TUI responsiveness. Keep one shared timer and animate only visible state.

## Implementation Constraint

- Tool burst state mapping should use existing transcript state only. Do not invent new ACP state unless current data is insufficient.
