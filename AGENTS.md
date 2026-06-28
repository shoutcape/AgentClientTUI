# Repository Guide

## Runtime And Commands
- Install with `npm install`; this repo has `package-lock.json` but app/test scripts intentionally invoke Bun.
- OpenTUI native rendering needs Bun at `$HOME/.bun/bin/bun`; `npm run dev` runs `src/index.ts` with Bun.
- Use `npm run dev:node` when Bun/OpenTUI native FFI is unavailable; it uses `tsx` and can fall back to text mode.
- Run real ACP servers with `npm run dev -- --agent "opencode acp"`; `opencode serve` is HTTP and is not used here.
- Verify with `npm run typecheck` and `npm run smoke`; there is no lint script in `package.json`.
- Run tests with `npm test`; focus one Bun test via `npm test -- src/path/file.test.ts`.

## Architecture
- `src/index.ts` is the app entrypoint: parses `--agent`/`--headless`, launches the ACP transport, initializes a session, wires command registry and UI callbacks.
- The app is a client only. It launches a stdio ACP server, writes newline-delimited JSON-RPC to stdin, and reads JSON-RPC lines from stdout.
- `src/mock-agent.ts` is only the bundled dev/test ACP server; do not treat it as product agent behavior.
- `src/acp/transport.ts` owns child-process JSON-RPC plumbing; `src/acp/client.ts` owns ACP method shapes.
- `src/commands/*` owns slash/palette command state, registry, ACP command mapping, and search.
- `src/ui.ts` owns OpenTUI rendering and input orchestration; pure view/model helpers live under `src/ui/*` and have most focused tests.
- `src/ui/text-ui.ts` is the headless/text fallback used by smoke tests and `--headless`.

## Testing And Diagnostics
- `npm run smoke` starts `src/index.ts --headless` with the mock agent and asserts transcript text; failures print captured stdout/stderr.
- `npm run trace -- --scenario initialize|new-prompt|list [--agent "..."]` records ACP traffic under `tmp/acp-traces/...` with secrets and `$HOME` redacted.
- Render diagnostics redact sensitive keys and home paths; keep that behavior when adding error logging.

## Code Conventions
- TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; avoid adding optional properties with explicit `undefined`.
- Preserve JSON-RPC over stdout for protocol messages. Agent stderr is displayed as logs; invalid stdout lines are protocol errors.
- Permission requests are currently auto-rejected in `src/index.ts`; changing that affects real-agent safety behavior.
