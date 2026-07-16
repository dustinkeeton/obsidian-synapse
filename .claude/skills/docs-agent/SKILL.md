---
name: docs-agent
description: Machine-readable documentation standard optimized for LLMs and agents — structured, terse, explicit. Defines the project's machine-doc file set and format rules. Use when creating or updating documentation intended for AI consumption.
user-invocable: false
---

# Agent-Optimized Documentation

## Purpose

Produce documentation that LLMs and agents can parse efficiently. The machine docs for this project are a root `AGENTS.md`, plus a per-feature `AGENTS.md` in each `src/<feature>/` directory where the codebase is organized that way. Prioritize:

- **Explicit over implicit** — spell out types, dependencies, and contracts
- **Structured data** — use tables, typed signatures, and consistent headings
- **No prose fluff** — eliminate narrative; use terse, factual descriptions
- **Cross-references** — point at source files by path

## Documentation Files

Match the doc set to how the codebase is actually organized: always produce
the root `AGENTS.md`; add per-feature files only when the code is split into
feature or module directories.

### `AGENTS.md` (root) — always

Primary entry point for agents. Contains:

- Project purpose (1-2 sentences)
- Module/component registry: table of the codebase's units — feature/module
  directories when they exist, otherwise the individual source files or
  layers of a flat `src/` — with path, purpose, and public API summary
- Dependency graph (text-based DAG)
- Settings/configuration schema summary with types and defaults
- Command registry: table of commands / entry points with descriptions
- Build/test commands

### `src/<feature>/AGENTS.md` — only when the codebase has feature/module directories

Add one per feature directory. Skip this entirely for a flat `src/` (a handful
of files rather than per-feature subdirectories): do not create docs for
directories that don't exist — fold that detail into the root registry above.
When feature directories do exist, each file contains:

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


