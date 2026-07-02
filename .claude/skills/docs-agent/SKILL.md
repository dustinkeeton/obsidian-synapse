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
- Settings/configuration schema summary with types and defaults
- Command registry: table of commands / entry points with descriptions
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

1. Use language-tagged fenced code blocks (e.g. ` ```ts `) for all type signatures and examples
2. Use tables for registries and enumerations
3. Use `file.ts:42` format for source references (line number after the colon — harnesses render it as a clickable link)
4. No markdown emphasis (bold/italic) in structured sections
5. Frontmatter with `last-updated` timestamp (YYYY-MM-DD)
6. Keep each file under 300 lines — split if larger

## Type-signature conventions

- Show exports as full signatures in the source language, not pseudocode.
- Treat the module's re-export surface (e.g. `index.ts`) as the public API — anything not re-exported is internal and belongs under "Internal architecture", not "Public API".
