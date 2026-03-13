---
name: docs-agent
description: Machine-readable documentation system optimized for LLMs and agents. Produces structured docs with explicit type signatures, dependency graphs, and decision context. Use when creating or updating documentation intended for AI consumption.
user-invocable: false
---

# Agent-Optimized Documentation

## Purpose

Produce documentation that LLMs and agents can parse efficiently. Prioritize:
- **Explicit over implicit** — spell out types, dependencies, and contracts
- **Structured data** — use tables, typed signatures, and consistent headings
- **No prose fluff** — eliminate narrative; use terse, factual descriptions
- **Cross-references** — link to source files with `path:line` format

## Documentation Files

### `AGENTS.md` (root)
Primary entry point for agents. Contains:
- Project purpose (1-2 sentences)
- Module registry: table of modules with path, purpose, public API summary
- Dependency graph (text-based DAG)
- Settings schema summary with types and defaults
- Command registry: table of command IDs, descriptions, callback types
- Build/test commands

### `src/<feature>/AGENTS.md`
Per-feature docs:
- Feature purpose (1 sentence)
- Public API: exported functions/classes with full type signatures
- Internal architecture: file-by-file descriptions
- Data flow: input → processing → output
- Configuration: relevant settings keys with types
- Error states and handling

## Format Rules

1. Use fenced code blocks for all type signatures and examples
2. Use tables for registries and enumerations
3. Use `file.ts:L42` format for source references
4. No markdown emphasis (bold/italic) in structured sections
5. Frontmatter with `last-updated` timestamp
6. Keep each file under 300 lines — split if larger
