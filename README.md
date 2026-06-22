# AgentClientTUI

Interactive terminal UI for ACP-compatible agent servers.

AgentClientTUI is a client-side OpenTUI app. It does not implement an agent. It launches a stdio ACP server command, sends JSON-RPC messages over stdin, reads protocol messages from stdout, and renders the interaction as a terminal transcript.

The bundled mock agent is for development and learning. The primary product path is attaching to real ACP servers such as `opencode serve` or Kiro ACP when they expose stdio ACP.

## Install

```bash
npm install
```

OpenTUI native rendering requires Bun in this project. If `bun` is not on your PATH, install it from <https://bun.sh> or use the absolute binary installed at `$HOME/.bun/bin/bun`.

## Run With Mock Agent

```bash
npm run dev
```

This script uses Bun for OpenTUI rendering.

## Run Without OpenTUI Native Rendering

```bash
npm run dev:node
```

Node mode falls back to text output if native OpenTUI FFI is unavailable.

## Run With Real Agent

```bash
npm run dev -- --agent "opencode serve"
```

Replace the command with any ACP-compatible stdio server command.

## Verify

```bash
npm run typecheck
npm run smoke
```
