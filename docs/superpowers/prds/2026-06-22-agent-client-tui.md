# AgentClientTUI PRD

> **Date:** 2026-06-22
> **Status:** Draft

## Problem Statement

Users need an interactive terminal UI for ACP-compatible agent servers without being locked into one agent product. Today, tools such as OpenCode and Kiro can expose agent behavior through ACP, but a user who wants to experiment with ACP clients needs either a product-specific UI or a raw protocol harness. Raw protocol harnesses are useful for debugging but poor for real interaction because they expose JSON-RPC mechanics instead of a chat-style agent workflow.

AgentClientTUI should make ACP agents feel usable from the terminal. The user should be able to attach the TUI to a launchable ACP server such as `opencode serve` or Kiro ACP, send prompts, observe streaming updates, see status/errors, and later build toward a richer OpenCode-like terminal experience.

## Solution

Build AgentClientTUI as an OpenTUI-based interactive terminal client for ACP-compatible agent servers. The product is client-side only: it does not implement an agent. It launches or attaches to an ACP server command, communicates over stdio JSON-RPC, and renders the interaction as a terminal UI with transcript, prompt area, status line, and visible agent events.

The first version includes a bundled mock ACP agent as a development fixture so the TUI can run without OpenCode, Kiro, or another real server. The real-agent path is first-class through an `--agent "<command>"` option.

## User Stories

1. As a terminal user, I want to launch AgentClientTUI and see an interactive terminal interface, so that I can use ACP agents without reading or writing raw JSON-RPC by hand.
2. As an ACP learner, I want the app to run against a bundled mock agent by default, so that I can understand the client loop before configuring a real server.
3. As an OpenCode user, I want to pass an agent command such as `opencode serve`, so that the same TUI can attach to OpenCode when it exposes ACP over stdio.
4. As a Kiro user, I want to pass a Kiro ACP command, so that AgentClientTUI can interact with Kiro through the same ACP client path.
5. As a user, I want the UI to show connection status, so that I know whether the agent process is starting, initialized, in-session, processing, failed, or exited.
6. As a user, I want a transcript area, so that prompts, agent messages, tool/update events, errors, and logs appear in chronological order.
7. As a user, I want a prompt entry path, so that I can send at least one prompt through ACP and see the result in the transcript.
8. As a user, I want streaming `session/update` notifications to appear as they arrive, so that the TUI feels interactive rather than waiting only for the final prompt response.
9. As a user, I want stderr logs to be visible but clearly separate from ACP protocol messages, so that debugging real-agent compatibility does not corrupt protocol parsing.
10. As a user, I want malformed stdout messages to be shown as protocol errors, so that incompatible agents fail visibly instead of hanging silently.
11. As a user, I want JSON-RPC error responses to show in the transcript/status area, so that agent-side failures are understandable.
12. As a user, I want the app to cleanly restore the terminal on exit, so that failed runs do not leave the shell in a broken state.
13. As a developer, I want ACP transport code separate from UI rendering code, so that protocol fixes do not require touching OpenTUI layout.
14. As a developer, I want ACP lifecycle calls separate from the raw transport, so that schema/version differences in real agents can be isolated.
15. As a developer, I want the mock agent to exercise initialize, session creation, prompt, updates, and final response, so that the app has a reliable local smoke path.
16. As a developer, I want a high-level CLI smoke test against the mock agent, so that the most important external behavior is verified without overfitting tests to internals.
17. As a maintainer, I want the README to position AgentClientTUI as an interactive ACP TUI, not a protocol demo, so that contributors understand the product direction.
18. As a maintainer, I want unsupported ACP capabilities to show clear "not implemented" messages, so that the app can interoperate incrementally without pretending full ACP coverage.

## Implementation Decisions

- AgentClientTUI is an interactive terminal UI for ACP-compatible agent servers. Its UX target is closer to OpenCode's terminal interaction model than to a protocol tester.
- AgentClientTUI is client-side only. It does not reimplement OpenCode, Kiro, or any other agent.
- ACP is the interoperability layer. OpenTUI is the interaction layer. Normal users should interact with prompts and transcript events, not JSON-RPC envelopes.
- The default run mode uses a bundled mock ACP agent. This is a development and learning fixture, not the primary product story.
- Real ACP servers are attached through an `--agent "<command>"` command-line option. The command is launched as a child process with piped stdin, stdout, and stderr.
- The transport uses newline-delimited UTF-8 JSON-RPC over stdio. The client writes requests and notifications to agent stdin. The agent writes protocol messages to stdout. Agent stderr is treated as logs.
- Requests carry JSON-RPC IDs and are resolved through a pending-request map. Notifications have no response and are routed by method name.
- The first ACP lifecycle slice covers initialize, creating a new session, sending one prompt, receiving session updates, and handling the final prompt response.
- The UI includes status and transcript in the first version. Prompt input may start as a minimal input path, but the product direction is an interactive prompt area.
- Unsupported client-side capabilities, including filesystem, terminal, and permission flows, should fail with explicit "not implemented" behavior rather than silent success.
- Real-agent schema differences should be isolated to the ACP lifecycle wrapper. The UI and raw transport should not contain product-specific OpenCode or Kiro behavior.
- The README should lead with the product goal: "Interactive terminal UI for ACP-compatible agent servers."

## Testing Decisions

- Primary test seam: high-level CLI smoke test against the bundled mock ACP agent.
- The smoke test should verify external behavior: the app starts, launches the mock agent, sends initialize, creates a session, sends a prompt, receives a session update, receives a final response, and exits cleanly.
- Type checking should be part of verification because the skeleton is TypeScript and the module boundaries matter.
- Real-agent testing is a manual smoke path until a concrete ACP server command is available in the environment. The expected command shape is `npm run dev -- --agent "<command>"`.
- Unit tests are not the first priority. They can be added later around transport framing and request matching if regressions appear.

## Out of Scope

- Full ACP schema implementation.
- HTTP or non-stdio transports.
- Reimplementing OpenCode, Kiro, or another agent.
- Full IDE/editor integration.
- File read/write tool support beyond clear "not implemented" handling.
- Terminal tool support beyond clear "not implemented" handling.
- Permission UI beyond clear "not implemented" handling.
- Advanced session management such as load, resume, list, close, and delete.
- Rich tool-call rendering beyond readable transcript events.

## Further Notes

- The mock agent exists to make local development deterministic. It should not cause the product to drift into a toy-only demo.
- Capability negotiation should drive future UI affordances. The client should adapt to the agent's advertised capabilities rather than assume every ACP server behaves like OpenCode or Kiro.
- The first implementation should favor small, readable files and stable boundaries over completeness.
- Future work may add cancellation, auth, richer prompt content, filesystem/terminal capabilities, session resume, and better real-agent compatibility tests.
