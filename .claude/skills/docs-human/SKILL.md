---
name: docs-human
description: Human-readable documentation covering decisions, project status, and architecture. Derived from agent docs but formatted for human consumption. Use when creating or updating documentation intended for human stakeholders.
user-invocable: false
---

# Human Documentation

## Purpose

Produce documentation that humans can quickly scan to understand project status, decisions made, and how the system fits together. Prioritize:

- **Decision log** — what was decided, why, and what alternatives were considered
- **Status visibility** — what's done, what's in progress, what's blocked
- **Change history** — what changed and why, in reverse chronological order (newest on top)
- **Plain language** — avoid jargon where possible, explain technical terms

## Documentation Files

### `DECISIONS.md` (root)

Decision log in reverse chronological order:

```markdown
## YYYY-MM-DD: Decision Title

**Context**: What situation prompted this decision
**Decision**: What was decided
**Alternatives considered**: What else was evaluated
**Rationale**: Why this option was chosen
**Impact**: What this affects
```

### `STATUS.md` (root)

Current project status:

- Feature completion matrix (feature × status)
- Current sprint/focus area
- Known issues and blockers
- Dependency status (external tools, APIs)

### `ARCHITECTURE.md` (root)

High-level architecture overview for humans:

- System diagram (ASCII or Mermaid)
- Feature descriptions in plain language
- How features interact
- Configuration overview
- Getting started for new contributors

## Format Rules

1. Use headings liberally for scannability
2. Lead with the most important information
3. Use bullet points over paragraphs
4. Include dates on all log entries
5. Keep STATUS.md under 100 lines — it's a snapshot, not a history
