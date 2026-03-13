---
name: audit
description: Run a full codebase audit chain — architect, security, docs-agent, docs-human, then security again. Creates a team, spawns agents consecutively, and reports results.
disable-model-invocation: true
argument-hint: [optional focus area]
---

# Codebase Audit Chain

Run the full audit pipeline in consecutive order. Each agent audits the codebase and implements fixes before the next one starts.

## Chain Order

1. **architect** — Audit and improve codebase structure (module patterns, file organization, naming, dependency rules, import paths)
2. **security** (pass 1) — Audit for secrets, command injection, input validation, API security, .gitignore, file system safety. Implement fixes.
3. **docs-agent** — Create/update machine-readable AGENTS.md files (root + per-feature) optimized for LLM consumption
4. **docs-human** — Create/update DECISIONS.md, STATUS.md, ARCHITECTURE.md for human stakeholders
5. **security** (pass 2) — Re-audit the entire codebase including all changes made by docs agents. Ensure no new issues were introduced.

## Execution Steps

1. Create a team named `audit-{timestamp}` with yourself as team lead
2. Create 5 tasks with sequential blocking dependencies (task N+1 blocked by task N)
3. Spawn agents one at a time. After each completes:
   - Mark its task completed
   - Shut it down
   - Spawn the next agent
4. For the second security pass, spawn a new security agent named `security-final`
5. After all 5 complete, present the user a consolidated summary table of findings and fixes per agent
6. Clean up: shut down all agents, delete the team

## Agent Prompts

Each agent should:
- Read its corresponding skill in `.claude/skills/` for standards and checklists
- Read the full codebase under `src/` and project root
- Implement fixes directly (not just report)
- Verify the build passes after changes (`npx tsc --noEmit`)
- Send a findings summary to the team lead via SendMessage
- Mark its task as completed via TaskUpdate

### Architect (Task 1)
Audit for: module pattern adherence, file structure conventions, naming (kebab-case files, PascalCase classes, camelCase functions), dependency rules (no circular deps), import paths (through index.ts), type exports in types.ts, main.ts lifecycle-only, index.ts as public API. Fix all issues.

### Security Pass 1 (Task 2)
Full audit per `.claude/skills/security-audit/SKILL.md` checklist: secrets scan, child_process usage (execFile only), .gitignore coverage, input validation (URLs, paths, settings), API security (HTTPS, headers, timeouts, no key leakage), file system boundary enforcement, AI response sanitization. Fix all issues.

### Docs-Agent (Task 3)
Create/update AGENTS.md at root and `src/<feature>/AGENTS.md` files. Include: module registry, dependency graph, public APIs with type signatures, command registry, settings schema, build commands. Machine-readable format per `.claude/skills/docs-agent/SKILL.md`.

### Docs-Human (Task 4)
Create/update DECISIONS.md, STATUS.md, ARCHITECTURE.md per `.claude/skills/docs-human/SKILL.md`. Derive from codebase and agent docs. Decision log with context/alternatives/rationale, status snapshot, architecture overview with diagrams.

### Security Pass 2 (Task 5)
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
| 3 | docs-agent | N files created/updated | file list |
| 4 | docs-human | N files created/updated | file list |
| 5 | security (pass 2) | N issues | brief list or "clean" |

Build status: passing/failing
```
