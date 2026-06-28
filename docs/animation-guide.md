# Terminal Animation Guide

Date: 2026-06-28

## Goal

Keep AgentClientTUI animations terminal-native, small, and easy to disable. For letter-sized loader icons, prefer Unicode frame strings over SVG or image protocols.

## What Official OpenCode Does

Local reference repo: `/home/shoutcape/github/opencode`.

OpenCode's current TUI package lives under `packages/tui`. The old `packages/opencode/src/cli/cmd/tui` path is no longer the main implementation.

Important files:

| File | Pattern |
|---|---|
| `packages/tui/src/component/spinner.tsx` | Shared Solid wrapper around `opentui-spinner/solid` using braille frames and an `animations_enabled` fallback |
| `packages/tui/src/ui/spinner.ts` | Custom Knight Rider frame and color generators for branded prompt status animation |
| `packages/tui/src/component/prompt/index.tsx` | Uses custom scanner frames/colors at `interval={40}` while the session is busy |
| `packages/tui/src/util/signal.ts` | `createFadeIn()` uses a 16ms timer and jumps to final alpha when animations are disabled |
| `packages/tui/src/component/bg-pulse.tsx` | Custom `FrameBufferRenderable` with `live: true`, `renderSelf(buffer, deltaTime)`, and a temporary FPS cap |
| `packages/tui/src/app.tsx` | Registers `app.toggle.animations` and persists `animations_enabled` in KV state |

OpenCode's terminal TUI uses Unicode frames, generated text frames, RGBA colors, timers, and FrameBuffer rendering. Its web UI has SVG/CSS animations, but those are not the terminal path.

## Repo Helper

This repo has a small helper in `src/ui/animation.ts`:

```ts
import { frameAt, opencodeSpinnerFrames, staticLoaderText, tinyLoaderFrames } from "./ui/animation"

frameAt(opencodeSpinnerFrames, frameIndex)
frameAt(tinyLoaderFrames.moon, frameIndex)
staticLoaderText("Loading options")
```

Use this helper for:

| Export | Use |
|---|---|
| `opencodeSpinnerFrames` | Official OpenCode-style braille spinner frames |
| `tinyLoaderFrames` | Shared one-cell frame presets |
| `frameAt(frames, index)` | Safe wrapped frame lookup, including negative indexes |
| `staticLoaderText(label?)` | Fallback text for disabled animations, headless UI, or tests |

## Animation/Icon Themes

Animation and icon themes live in `src/ui/animation-theme.ts`. They control glyphs, frame strings, status words, cursor frames, and static fallbacks only. They do not control colors, borders, layout, spacing, or transcript density.

Available themes:

| Theme | Use |
|---|---|
| `quiet` | Default, subtle, best for long reading sessions |
| `playful` | Nerd Font personality and livelier status words |
| `operational` | High-signal status and tool-state icons |
| `cyber` | Powerline and scanline-inspired terminal energy |

Startup selection:

```bash
npm run dev -- --animation-theme operational
```

Runtime selection:

```text
/animation-theme cyber
```

## Recommended Tiers

### Tier 1: Static Fallback

Every animated loader needs a non-animated fallback. Use `⋯` with optional label text.

```ts
import { staticLoaderText } from "./ui/animation"

Text({ content: staticLoaderText("Loading options"), fg: opencodeTheme.textMuted })
```

Use this in headless/text UI and anywhere animations are disabled.

### Tier 2: Simple Text Frame Animation

For this repo's current core OpenTUI code, a `TextRenderable` timer is enough. Keep timers owned by `createAgentClientUi()` and clear them in `destroy()`.

```ts
import { frameAt, opencodeSpinnerFrames } from "./ui/animation"

let spinnerTimer: ReturnType<typeof setInterval> | undefined
let spinnerFrame = 0

spinnerTimer = setInterval(() => {
  spinnerFrame += 1
  loadingRenderable.content = frameAt(opencodeSpinnerFrames, spinnerFrame)
}, 80)

function destroy() {
  if (spinnerTimer) clearInterval(spinnerTimer)
}
```

Rules:

| Rule | Why |
|---|---|
| Use 80ms for one-cell spinners | Matches official OpenCode shared spinner |
| Use 40ms only for wider scanner effects | Matches official OpenCode busy prompt scanner |
| Mutate existing renderables when possible | Avoids rebuilding the tree every frame |
| Clear timers in `destroy()` | Prevents leaks after fallback, tests, or app exit |
| Keep frame lists one or two cells wide | Avoids layout jitter |

### Tier 3: `opentui-spinner`

If we want the official package behavior, add `opentui-spinner` and use it for new spinner components instead of writing timer plumbing repeatedly.

Potential install:

```bash
bun add opentui-spinner
```

Core OpenTUI shape:

```ts
import { SpinnerRenderable } from "opentui-spinner"
import { opencodeSpinnerFrames } from "./ui/animation"

const spinner = new SpinnerRenderable(renderer, {
  frames: opencodeSpinnerFrames,
  interval: 80,
  color: opencodeTheme.textMuted,
})

renderer.root.add(spinner)
```

Do not add this dependency until we have at least one real render path that uses it.

### Tier 4: Generated Frame And Color Effects

For branded status bars or prompt activity, copy the official OpenCode idea from `packages/tui/src/ui/spinner.ts`: generate full string frames and a color function from one theme color.

Example shape:

```ts
const frames = [
  "■⬝⬝⬝",
  "⬝■⬝⬝",
  "⬝⬝■⬝",
  "⬝⬝⬝■",
]
```

Use this only when one-cell loaders are not expressive enough.

### Tier 5: FrameBuffer Animation

Use `FrameBufferRenderable` only for cell-level effects: alpha blending, background pulses, pseudo-pixels, or multi-cell art.

OpenCode's `BgPulse` pattern:

| Technique | Purpose |
|---|---|
| `live: true` | Keep renderable updating through the renderer loop |
| `renderSelf(buffer, deltaTime)` | Drive animation from elapsed frame time |
| frame cache | Avoid recalculating expensive cells every frame |
| temporary `targetFps = 30` | Bound animation cost |
| restore FPS on cleanup | Avoid changing global renderer behavior permanently |

Use this only for rare high-value visuals. For loaders, text frames are simpler and more portable.

## Where To Add First

Good first targets in this repo:

| File | Current state | Animation option |
|---|---|---|
| `src/ui/dropdown.ts` | Shows `Loading...` for drilldown option fetches | Replace with static fallback now, later animated frame passed from `ui.ts` |
| `src/ui/palette.ts` | Shows `Loading...` for drilldown option fetches | Same as dropdown |
| `src/ui.ts` footer/sidebar status | Shows status text only | Add tiny spinner while prompt is active or agent is busy |
| `src/ui/transcript-renderer.ts` tool burst rows | Shows tool status summaries | Add tiny spinner only for active burst rows |

Recommended first implementation after this guide:

1. Add an `animationsEnabled` setting in `createAgentClientUi()` defaulting to true.
2. Add one shared timer in `ui.ts` that increments `animationFrame` while any visible animation is active.
3. Pass `animationFrame` into pure view builders that need it.
4. Use `frameAt(opencodeSpinnerFrames, animationFrame)` for active busy rows.
5. Use `staticLoaderText()` when disabled or headless.

## Testing Guidance

Keep most animation behavior testable without a terminal:

| Test | File |
|---|---|
| Frame wrapping and fallback text | `src/ui/animation.test.ts` |
| Loading row content for dropdown/palette | focused view tests near `dropdown.ts` or `palette.ts` |
| Full render tree IDs and colors | `src/ui/e2e.test.ts` with OpenTUI test renderer |

Do not snapshot every animation frame. Test one known frame and the static fallback. Animation timing should stay thin and boring.

## Design Rules

| Do | Avoid |
|---|---|
| Unicode glyph frames | SVG or terminal image protocols for tiny loaders |
| Static fallback | Animation with no reduced-motion escape |
| One shared timer | Timer per row or per renderable unless isolated by a package |
| Existing theme colors | New hardcoded palettes in render paths |
| Small frame lists | Double-width emoji or font-dependent icons |
| Cleanup on destroy | Orphaned timers after renderer fallback or tests |
