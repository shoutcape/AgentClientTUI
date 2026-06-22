# AgentClientTUI Design

## Goal

Build a minimal OpenTUI terminal client for ACP agents. It must run without a real agent by default using a bundled mock agent, and it must allow a real stdio ACP agent command through `--agent`.

## Scope

- Create a Node/npm TypeScript project using `tsx` for local TypeScript execution.
- Render a simple OpenTUI interface with status and transcript.
- Implement newline-delimited JSON-RPC over stdio.
- Implement enough ACP lifecycle for learning: `initialize`, `session/new`, `session/prompt`, and `session/update` notifications.
- Provide a mock agent that demonstrates the lifecycle.
- Provide `--agent <cmd>` for real agents such as OpenCode or Kiro when they expose ACP over stdio.

## Non-Goals

- Full ACP schema coverage.
- Full editor or IDE integration.
- File system, terminal, or permission tool implementations beyond clear "not implemented" status messages.
- HTTP transport.

## Architecture

The app is split into narrow modules:

- `src/index.ts`: CLI entrypoint. Parses args, chooses mock or real agent command, starts UI and ACP flow.
- `src/ui.ts`: OpenTUI rendering. Owns status and transcript renderables.
- `src/acp/transport.ts`: JSON-RPC stdio transport. Owns process spawning, line parsing, request IDs, pending requests, notifications, stderr logs, and shutdown.
- `src/acp/client.ts`: ACP lifecycle wrapper. Owns `initialize`, `newSession`, and `prompt` calls.
- `src/mock-agent.ts`: tiny mock ACP agent. Reads JSON-RPC lines from stdin and writes ACP-shaped responses/notifications to stdout.

## Data Flow

1. App starts OpenTUI renderer.
2. App starts mock agent by default, or real command from `--agent`.
3. Transport sends `initialize` and resolves response by JSON-RPC ID.
4. ACP client sends `session/new` and stores returned session ID.
5. ACP client sends one demo `session/prompt`.
6. Agent emits `session/update` notifications while prompt request is pending.
7. UI appends updates, responses, logs, and errors to transcript.

## Error Handling

- Invalid JSON from agent stdout is shown as protocol error.
- JSON-RPC error responses reject the matching request.
- Agent stderr is shown as logs, not parsed as ACP.
- Agent exit updates status and rejects pending requests.
- Renderer is destroyed on exit to restore terminal state.

## Testing And Verification

- `npm install` installs dependencies.
- `npm run mock-agent` can be launched manually for protocol inspection.
- `npm run dev` runs the TUI against mock agent.
- `npm run typecheck` verifies TypeScript.
- Real agent smoke test uses `npm run dev -- --agent "<command>"` once a concrete ACP command is available.

## Teaching Notes

This skeleton intentionally prioritizes readable boundaries over completeness. Real ACP schema differences should be fixed in `src/acp/client.ts`, not leaked into UI or transport.
