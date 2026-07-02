---
name: docs
description: Orchestrates documentation updates by spawning the architect, docs-agent, and docs-human agents in sequence. The first pass audits the codebase and reports changes, docs-agent writes machine-readable docs, docs-human writes human-readable docs.
user-invocable: true
---

# Documentation Orchestration

When this skill is invoked, run the following pipeline:

## Step 1: Architecture Audit

Spawn the `architect` agent with this prompt:

> Audit the current codebase for any architectural changes since the docs were last updated. Read the existing AGENTS.md files and compare against the actual code. Produce a concise **change report** covering:
>
> - New or removed modules, files, commands, settings
> - Changed public APIs or type signatures
> - Dependency changes between modules
> - Any architectural violations or inconsistencies
>
> Output ONLY the change report as structured text. Do NOT modify any files.

## Step 2: Agent Documentation

Take the change report and spawn the `docs-agent` agent with this prompt:

> Here is the architecture change report for the Synapse codebase:
>
> {step-1 output}
>
> Update all AGENTS.md files (root and per-feature in src/) to reflect the current state of the codebase. Read the actual source files to verify details — do not rely solely on the change report. Follow the docs-agent skill guidelines for format and structure.

## Step 3: Human Documentation

After docs-agent completes, spawn the `docs-human` agent with this prompt:

> The agent documentation (AGENTS.md files) has just been updated. Update the human-facing documentation:
>
> - DECISIONS.md — add entries for any new decisions reflected in code changes
> - STATUS.md — update to reflect current project state
> - ARCHITECTURE.md — update if architecture has changed
>
> Read the updated AGENTS.md files and the actual source code to ensure accuracy. Follow the docs-human skill guidelines for format and structure.

## Important

- Each step must complete before the next begins — the output of each informs the next.
- Step 1 is **read-only** — the audit agent only reports.
- docs-agent and docs-human SHOULD modify their respective documentation files.
