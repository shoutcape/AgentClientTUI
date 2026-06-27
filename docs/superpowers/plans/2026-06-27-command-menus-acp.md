# Command Menus ACP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` server-command focused, group skills under `/skills`, and turn `Ctrl+P` into a broad app palette using ACP commands and ACP config options.

**Architecture:** Keep the existing shared command registry and state machine, but enrich descriptors with command kind and config metadata. Parse standard ACP `available_commands_update`, Kiro `_kiro.dev/commands/available`, and standard ACP `configOptions` into one registry, then let each UI surface choose an appropriate search view.

**Tech Stack:** TypeScript, Bun test runner, OpenTUI, JSON-RPC over stdio ACP.

---

### Task 1: Registry Command Kinds And Surface Search

**Files:**
- Modify: `src/commands/registry.ts`
- Modify: `src/commands/registry.test.ts`

- [ ] **Step 1: Add failing tests for slash and palette grouping**

Add tests covering skill exclusion from top-level slash search, `/skills` synthetic menu, palette inclusion of local/config/skills, and config command storage.

- [ ] **Step 2: Run failing registry tests**

Run: `bun test src/commands/registry.test.ts`
Expected: FAIL until registry supports command kinds and surface searches.

- [ ] **Step 3: Implement registry kinds and search helpers**

Add `CommandKind`, config descriptors, `setConfigCommands`, `searchSlash`, `searchPalette`, and `getSkills`.

- [ ] **Step 4: Run registry tests**

Run: `bun test src/commands/registry.test.ts`
Expected: PASS.

---

### Task 2: ACP Command And Config Parsing

**Files:**
- Modify: `src/acp/client.ts`
- Modify: `src/index.ts`
- Test: `src/commands/registry.test.ts`

- [ ] **Step 1: Add config option types and client method**

Add `SessionConfigOption`, `SessionConfigOptionItem`, `setConfigOption(sessionId, configId, value)`, and config option normalization.

- [ ] **Step 2: Parse standard ACP command hints**

Map `availableCommands[].input.hint` to command `hint`, prefix display names with `/`, and preserve raw command names.

- [ ] **Step 3: Parse session config options from `session/new`**

After creating a session, map `configOptions` into registry config commands for `model`, `mode`, and `effort`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

---

### Task 3: State Machine For `/skills` And Config Selection

**Files:**
- Modify: `src/commands/state.ts`
- Modify: `src/commands/state.test.ts`

- [ ] **Step 1: Add failing state tests**

Cover selecting `/skills`, selecting a skill from its child menu, and selecting config option values.

- [ ] **Step 2: Run failing state tests**

Run: `bun test src/commands/state.test.ts`
Expected: FAIL until state supports descriptor drilldown items and config effects.

- [ ] **Step 3: Implement descriptor/options drilldown**

Allow `CommandItem` to carry command descriptors, execute selected skill commands, and emit `set-config-option` effects for config commands.

- [ ] **Step 4: Run state tests**

Run: `bun test src/commands/state.test.ts`
Expected: PASS.

---

### Task 4: UI Surface Behavior And Execution

**Files:**
- Modify: `src/ui.ts`
- Modify: `src/ui/e2e.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update UI search surfaces**

Use `registry.searchSlash` for `/` dropdown and `registry.searchPalette` for `Ctrl+P`.

- [ ] **Step 2: Wire config selection effect**

When config option is selected, call `session/set_config_option`, update registry from returned `configOptions`, and show a status line.

- [ ] **Step 3: Add e2e coverage**

Cover top-level slash exclusion of skills, `/skills` drilldown, and palette inclusion of app/config/skills.

- [ ] **Step 4: Run e2e tests**

Run: `bun test src/ui/e2e.test.ts`
Expected: PASS.

---

### Task 5: Full Verification

**Files:**
- Modify: `TODO.md` if completed items are now true.

- [ ] **Step 1: Run targeted tests**

Run: `bun test src/commands/registry.test.ts src/commands/state.test.ts src/ui/e2e.test.ts`
Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `bun test`
Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Update TODO status**

Mark command menu items complete only if tests prove the behavior.
