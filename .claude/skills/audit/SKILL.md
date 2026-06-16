---
name: audit
description: Run a full codebase audit chain — architect, security, Obsidian submission-guideline compliance, docs-agent, docs-human, then security again. Creates a team, spawns agents consecutively, and reports results.
disable-model-invocation: true
argument-hint: [optional focus area]
---

# Codebase Audit Chain

Run the full audit pipeline in consecutive order. Each agent audits the codebase and implements fixes before the next one starts.

## Chain Order

1. **architect** — Audit and improve codebase structure (module patterns, file organization, naming, dependency rules, import paths)
2. **security** (pass 1) — Audit for secrets, command injection, input validation, API security, .gitignore, file system safety. Implement fixes.
3. **plugin-architect** (Obsidian compliance) — Verify the codebase still meets the Obsidian community plugin submission guidelines (manifest correctness, lifecycle cleanup, no internal/deprecated APIs, DOM safety, mobile/`isDesktopOnly` accuracy, command & UI-copy conventions). Implement fixes.
4. **docs-agent** — Create/update machine-readable AGENTS.md files (root + per-feature) optimized for LLM consumption
5. **docs-human** — Create/update DECISIONS.md, STATUS.md, ARCHITECTURE.md for human stakeholders
6. **security** (pass 2) — Re-audit the entire codebase including all changes made by docs agents. Ensure no new issues were introduced.

## Execution Steps

### 1. Create Team

```
TeamCreate(team_name: "audit-{timestamp}")
```

### 2. Create Tasks with Dependencies

```
task1 = TaskCreate(description: "architect audit", team_name: "audit-{timestamp}")
task2 = TaskCreate(description: "security pass 1", team_name: "audit-{timestamp}", addBlockedBy: [task1.id])
task3 = TaskCreate(description: "obsidian compliance", team_name: "audit-{timestamp}", addBlockedBy: [task2.id])
task4 = TaskCreate(description: "docs-agent", team_name: "audit-{timestamp}", addBlockedBy: [task3.id])
task5 = TaskCreate(description: "docs-human", team_name: "audit-{timestamp}", addBlockedBy: [task4.id])
task6 = TaskCreate(description: "security pass 2", team_name: "audit-{timestamp}", addBlockedBy: [task5.id])
```

### 3. Spawn Agents Sequentially

For each step, spawn the agent into the team, wait for completion, then proceed:

```
Agent(
  subagent_type: "architect",
  team_name: "audit-{timestamp}",
  name: "architect",
  prompt: <architect prompt>
)
# After completion:
TaskUpdate(id: task1.id, status: "completed")
```

```
Agent(
  subagent_type: "security",
  team_name: "audit-{timestamp}",
  name: "security-pass1",
  prompt: <security pass 1 prompt>
)
TaskUpdate(id: task2.id, status: "completed")
```

```
Agent(
  subagent_type: "plugin-architect",
  team_name: "audit-{timestamp}",
  name: "obsidian-compliance",
  prompt: <obsidian compliance prompt>
)
TaskUpdate(id: task3.id, status: "completed")
```

```
Agent(
  subagent_type: "docs-agent",
  team_name: "audit-{timestamp}",
  name: "docs-agent",
  prompt: <docs-agent prompt>
)
TaskUpdate(id: task4.id, status: "completed")
```

```
Agent(
  subagent_type: "docs-human",
  team_name: "audit-{timestamp}",
  name: "docs-human",
  prompt: <docs-human prompt>
)
TaskUpdate(id: task5.id, status: "completed")
```

```
Agent(
  subagent_type: "security",
  team_name: "audit-{timestamp}",
  name: "security-final",
  prompt: <security pass 2 prompt>
)
TaskUpdate(id: task6.id, status: "completed")
```

### 4. Summary and Cleanup

After all 6 complete, present the user a consolidated summary table of findings and fixes per agent, then clean up:

```
SendMessage(type: "shutdown_request", to: "architect")
SendMessage(type: "shutdown_request", to: "security-pass1")
SendMessage(type: "shutdown_request", to: "obsidian-compliance")
SendMessage(type: "shutdown_request", to: "docs-agent")
SendMessage(type: "shutdown_request", to: "docs-human")
SendMessage(type: "shutdown_request", to: "security-final")
TeamDelete(team_name: "audit-{timestamp}")
```

## Agent Prompts

Each agent should:
- Read its corresponding skill in `.claude/skills/` for standards and checklists
- Read the full codebase under `src/` and project root
- Implement fixes directly (not just report)
- Verify the build passes after changes (`npx tsc --noEmit`)
- Send a findings summary to the team lead: `SendMessage(to: "team-lead", content: <summary>)`
- Mark its task as completed: `TaskUpdate(id: <task_id>, status: "completed")`

### Architect (Task 1)
Audit for: module pattern adherence, file structure conventions, naming (kebab-case files, PascalCase classes, camelCase functions), dependency rules (no circular deps), import paths (through index.ts), type exports in types.ts, main.ts lifecycle-only, index.ts as public API. Fix all issues.

### Security Pass 1 (Task 2)
Full audit per `.claude/skills/security-audit/SKILL.md` checklist: secrets scan, child_process usage (execFile only), .gitignore coverage, input validation (URLs, paths, settings), API security (HTTPS, headers, timeouts, no key leakage), file system boundary enforcement, AI response sanitization. Fix all issues.

### Obsidian Compliance (Task 3)
Verify the plugin still satisfies the Obsidian community plugin submission guidelines, per `.claude/skills/obsidian-plugin-dev/SKILL.md` and the official policies (developer.obsidian.md plugin guidelines + the `obsidianmd/obsidian-releases` submission checklist). Audit and fix:
- **manifest.json**: required fields present and valid (`id`, `name`, `version` matching the release, `minAppVersion`, `description`, `author`, `authorUrl`, and an `isDesktopOnly` flag that matches actual Node/Electron/desktop-only API usage); `id` is unique, lowercase-kebab, and contains neither "obsidian" nor "plugin"; `versions.json` kept in sync with `minAppVersion`.
- **Lifecycle & cleanup**: every event, interval, and DOM listener is registered via `registerEvent` / `registerInterval` / `registerDomEvent` (or explicitly torn down in `onunload`); no leaked timers; `onunload` does not detach leaves it didn't create.
- **API hygiene**: no internal/undocumented APIs (e.g. `app.internalPlugins`, private fields) and no deprecated calls; use `this.app` rather than the global `app`; use `normalizePath` for vault paths; prefer `Vault.process` / `FileManager` over raw adapter writes; gate desktop-only Node usage behind the existing desktop assertions.
- **DOM safety**: no `innerHTML` / `outerHTML` / `insertAdjacentHTML` with dynamic content — build nodes with `createEl` / `createDiv`; move inline styles to CSS classes in `styles.css`.
- **Commands & UI copy**: command names in sentence case, no plugin-name prefix and not containing the word "plugin"; settings headings follow Obsidian conventions (sentence case, no "Settings for…").
- **Repo hygiene**: `main.js` / `manifest.json` / `styles.css` are the published release artifacts; `LICENSE` and `README` present; no committed secrets; any network usage is disclosed in the README.
Implement fixes directly (do not just report), then verify with `npx tsc --noEmit` and the production build. Respect the project's deliberate patterns (e.g. the type-only audio→video back-edge, desktop gating via `loadNodeModules`) — flag, don't "fix", anything that is intentional.

### Docs-Agent (Task 4)
Create/update AGENTS.md at root and `src/<feature>/AGENTS.md` files. Include: module registry, dependency graph, public APIs with type signatures, command registry, settings schema, build commands. Machine-readable format per `.claude/skills/docs-agent/SKILL.md`.

### Docs-Human (Task 5)
Create/update DECISIONS.md, STATUS.md, ARCHITECTURE.md per `.claude/skills/docs-human/SKILL.md`. Derive from codebase and agent docs. Decision log with context/alternatives/rationale, status snapshot, architecture overview with diagrams.

### Security Pass 2 (Task 6)
Repeat the full security audit checklist. Focus especially on: new files created by docs agents, any content written to project root, ensuring no sensitive information was documented, all previous fixes still intact. Fix any new issues.

## Focus Area

If `$ARGUMENTS` is provided, instruct all agents to pay special attention to that area while still performing their full audit. For example: `/audit transcription pipeline` focuses extra attention on `src/video/` and `src/audio/`.

## Summary Format

After all agents complete, present:

```
## Audit Complete

| # | Agent | Findings | Fixes Applied |
|---|-------|----------|---------------|
| 1 | architect | N issues | brief list |
| 2 | security (pass 1) | N issues | brief list |
| 3 | plugin-architect (Obsidian compliance) | N issues | brief list or "clean" |
| 4 | docs-agent | N files created/updated | file list |
| 5 | docs-human | N files created/updated | file list |
| 6 | security (pass 2) | N issues | brief list or "clean" |

Build status: passing/failing
```
