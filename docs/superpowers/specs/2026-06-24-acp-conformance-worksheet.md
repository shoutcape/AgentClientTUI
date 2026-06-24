# ACP Conformance Worksheet

Date: 2026-06-24
Status: Draft
Scope: OpenCode first, Kiro second, mock agent as control.

## Goal

Capture real ACP wire behavior from target agents and turn it into acceptance criteria for AgentClientTUI.

## Principles

- Treat actual wire traffic as source of truth.
- Keep ACP core capability-driven.
- Do not encode vendor behavior into core reducer or session logic.
- Do not advertise filesystem or terminal capabilities during MVP tests.
- Record deviations without immediately working around them.
- Preserve raw redacted traces for every observed mismatch.

## Agent Matrix

| Agent | Launch Command | Installed Version | Auth State | Notes |
|---|---|---:|---|---|
| Mock | `bun run src/mock-agent.ts` | repo | none | control agent |
| OpenCode | `opencode acp` | TBD | TBD | first target |
| Kiro | `kiro-cli acp` | TBD | TBD | second target |

## Client Initialize Payload

Use this baseline payload unless testing a specific variation:

```json
{
  "protocolVersion": 1,
  "clientCapabilities": {},
  "clientInfo": {
    "name": "AgentClientTUI",
    "version": "0.1.0"
  }
}
```

MVP must also test current app payload:

```json
{
  "protocolVersion": 1,
  "clientCapabilities": {
    "fs": {
      "readTextFile": false,
      "writeTextFile": false
    },
    "terminal": false
  },
  "clientInfo": {
    "name": "AgentClientTUI",
    "version": "0.1.0"
  }
}
```

## Result Columns

| Field | Meaning |
|---|---|
| Test ID | Stable ID for issue and test references |
| Request | Method and important params |
| Expected ACP v1 | Spec expectation |
| Observed | Actual agent behavior |
| Pass | Yes, No, Partial, or N/A |
| Trace | Path to redacted JSONL trace |
| Notes | Deviation, bug, or implementation implication |

## 1. Transport

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| T-001 | launch process | agent speaks NDJSON JSON-RPC over stdout | TBD | TBD | TBD | stderr must be logs only |
| T-002 | malformed stdout simulation | client reports protocol error | TBD | TBD | TBD | mock only |
| T-003 | agent stderr output | client records log, does not parse as protocol | TBD | TBD | TBD | |
| T-004 | clean process exit | pending requests reject clearly | TBD | TBD | TBD | |
| T-005 | crash during prompt | prompt fails, connection state updates | TBD | TBD | TBD | |

## 2. Initialize

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| I-001 | `initialize` baseline | returns protocol version, capabilities, agent info | TBD | TBD | TBD | |
| I-002 | omitted fs/terminal caps | agent treats absent caps as unsupported | TBD | TBD | TBD | |
| I-003 | explicit fs/terminal false | agent treats false caps as unsupported | TBD | TBD | TBD | |
| I-004 | unsupported protocol version | clear error or negotiated rejection | TBD | TBD | TBD | |
| I-005 | `_meta` extensions | unknown metadata preserved, not required | TBD | TBD | TBD | |

## 3. Authentication

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| A-001 | initialize unauthenticated | auth methods or clear auth error | TBD | TBD | TBD | |
| A-002 | agent auth hint | external login command discoverable if advertised | TBD | TBD | TBD | OpenCode may expose terminal-auth |
| A-003 | prompt unauthenticated | clear auth failure, not reducer crash | TBD | TBD | TBD | |
| A-004 | authenticated initialize | normal capabilities returned | TBD | TBD | TBD | |

## 4. Session Setup

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| S-001 | `session/new` | creates empty session, returns session ID | TBD | TBD | TBD | |
| S-002 | `session/load` valid ID | replays conversation history | TBD | TBD | TBD | |
| S-003 | `session/load` invalid ID | clear not-found error | TBD | TBD | TBD | |
| S-004 | `session/resume` valid ID | resumes without replay | TBD | TBD | TBD | OpenCode caveat |
| S-005 | `session/resume` invalid ID | clear not-found error | TBD | TBD | TBD | |
| S-006 | `session/close` | releases active resources | TBD | TBD | TBD | capability-gated |
| S-007 | `session/delete` | deletes persisted history | TBD | TBD | TBD | capability-gated |
| S-008 | multiple sessions one connection | separate session IDs work | TBD | TBD | TBD | Stage 2 maybe |

## 5. Session List

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| L-001 | `session/list` no filter | returns sessions and optional cursor | TBD | TBD | TBD | capability-gated |
| L-002 | `session/list` cwd filter | filters by CWD if supported | TBD | TBD | TBD | |
| L-003 | cursor pagination | cursor is opaque and accepted | TBD | TBD | TBD | do not parse cursor |
| L-004 | unsupported list | method error or absent capability | TBD | TBD | TBD | Kiro likely |

## 6. Prompt

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| P-001 | text prompt | streams updates, response has stop reason | TBD | TBD | TBD | |
| P-002 | empty prompt | clear validation behavior | TBD | TBD | TBD | |
| P-003 | image prompt if advertised | accepted only when capability present | TBD | TBD | TBD | |
| P-004 | image prompt when not advertised | client should not send | TBD | TBD | TBD | mock negative |
| P-005 | prompt with omitted fs/terminal caps | agent still works or requests permission only | TBD | TBD | TBD | MVP security boundary |

## 7. Session Updates

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| U-001 | agent text | `session/update` with `agent_message_chunk` | TBD | TBD | TBD | |
| U-002 | history replay user text | `user_message_chunk` during load | TBD | TBD | TBD | required for load |
| U-003 | thought chunks | `agent_thought_chunk` normalized | TBD | TBD | TBD | |
| U-004 | plan update | plan state updates idempotently | TBD | TBD | TBD | |
| U-005 | usage update | tokens/cost captured | TBD | TBD | TBD | |
| U-006 | available commands | command registry updates | TBD | TBD | TBD | standard only |
| U-007 | session info/config update | sidebar/config state updates | TBD | TBD | TBD | |
| U-008 | unknown update type | preserved/logged, no crash | TBD | TBD | TBD | |
| U-009 | vendor update method | recorded outside core | TBD | TBD | TBD | Kiro `_kiro.dev` |

## 8. Tool Calls

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| TC-001 | tool start | `tool_call` creates keyed tool state | TBD | TBD | TBD | |
| TC-002 | partial tool update | absent fields remain unchanged | TBD | TBD | TBD | |
| TC-003 | duplicate update | reducer remains idempotent | TBD | TBD | TBD | |
| TC-004 | out-of-order update | reducer tolerates or records warning | TBD | TBD | TBD | |
| TC-005 | code content | code block rendered | TBD | TBD | TBD | |
| TC-006 | diff content | diff block rendered | TBD | TBD | TBD | |
| TC-007 | terminal content | placeholder if no terminal cap | TBD | TBD | TBD | |
| TC-008 | resource/image content | preserved or rendered if supported | TBD | TBD | TBD | |

## 9. Permissions

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| PR-001 | `session/request_permission` | client receives options from agent | TBD | TBD | TBD | |
| PR-002 | allow once | client returns provided `allow_once` option ID | TBD | TBD | TBD | |
| PR-003 | allow always | client returns provided `allow_always` option ID | TBD | TBD | TBD | |
| PR-004 | reject once | client returns provided `reject_once` option ID | TBD | TBD | TBD | |
| PR-005 | reject always | client returns provided `reject_always` option ID | TBD | TBD | TBD | |
| PR-006 | no reject option | client does not invent option ID | TBD | TBD | TBD | current app risk |
| PR-007 | permission while streaming | composer switches to permission UI | TBD | TBD | TBD | |
| PR-008 | malformed response | agent returns clear error | TBD | TBD | TBD | mock negative |
| PR-009 | cancel during permission | final stop reason is meaningful | TBD | TBD | TBD | |

## 10. Cancellation

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| C-001 | cancel during text | prompt response stop reason `cancelled` | TBD | TBD | TBD | |
| C-002 | cancel during tool | tool/prompt stops cleanly | TBD | TBD | TBD | |
| C-003 | cancel during permission | pending permission resolved or rejected cleanly | TBD | TBD | TBD | |
| C-004 | cancel idle session | harmless or clear error | TBD | TBD | TBD | |
| C-005 | late updates after cancel | reducer tolerates late notifications | TBD | TBD | TBD | |

## 11. Configuration

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| CFG-001 | initialize config options | options captured if returned | TBD | TBD | TBD | |
| CFG-002 | config update notification | UI model updates dynamically | TBD | TBD | TBD | |
| CFG-003 | legacy mode list | fallback only if needed | TBD | TBD | TBD | |
| CFG-004 | `session/set_mode` | works only if supported | TBD | TBD | TBD | |
| CFG-005 | `session/set_model` | works only if supported | TBD | TBD | TBD | |

## 12. Commands

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| CMD-001 | standard command update | command palette updates | TBD | TBD | TBD | |
| CMD-002 | command options fetch | dynamic options normalized | TBD | TBD | TBD | |
| CMD-003 | Kiro command extension | recorded, not core MVP | TBD | TBD | TBD | |
| CMD-004 | unknown command metadata | preserved, no crash | TBD | TBD | TBD | |

## 13. Discovery And Recents

| Test ID | Request | Expected ACP v1 | Observed | Pass | Trace | Notes |
|---|---|---|---|---|---|---|
| D-001 | OpenCode list provider | uses ACP `session/list` when advertised | TBD | TBD | TBD | |
| D-002 | Kiro manual ID | load by manual ID works if supported | TBD | TBD | TBD | |
| D-003 | local recents | stores session references only | TBD | TBD | TBD | no transcript duplication |
| D-004 | missing list capability | UI hides browser, shows manual entry | TBD | TBD | TBD | |

## Acceptance Criteria For MVP

- Initialize result is parsed and displayed.
- UI actions are derived from capabilities, not agent name.
- New session works with OpenCode and mock.
- Load by session ID works when advertised.
- OpenCode session listing works when advertised.
- Kiro does not require undocumented ACP list or resume methods.
- Text prompt works with fs and terminal capabilities omitted.
- Permission requests are handled with real agent-provided options.
- Cancellation produces visible cancelled state, not generic failure.
- Session reducer survives replay, duplicates, partial tool updates, and unknown update types.
- Raw protocol diagnostics are redacted before storage or display.
- OpenCode conformance run has no unexplained failures.
- Kiro deviations are documented before any compatibility shim is added.

## Trace File Convention

Store traces under:

```text
tmp/acp-traces/<agent>/<YYYY-MM-DD-HHMMSS>-<scenario>.jsonl
```

Each line:

```json
{
  "ts": "2026-06-24T00:00:00.000Z",
  "direction": "client_to_agent",
  "message": {}
}
```

Allowed directions:

```text
client_to_agent
agent_to_client
agent_stderr
process_event
harness_event
```

Redaction rules:

- Replace absolute home paths with `$HOME`.
- Replace tokens, API keys, cookies, and auth headers with `[REDACTED]`.
- Keep session IDs unless user requests stricter privacy.
- Keep method names and capability shapes intact.

## Known Questions

- Does released OpenCode replay history on `session/resume`?
- Does Kiro actually use current ACP v1 `session/update` and `prompt`, or older documented names?
- Do either agents require filesystem or terminal client capabilities for normal coding prompts?
- What exact permission option IDs and kinds do real tool calls use?
- Does auth failure happen during `initialize`, `session/new`, or `session/prompt`?
