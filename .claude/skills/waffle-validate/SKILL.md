---
name: waffle-validate
description: Validate wafflestack's own toolkit definitions — manifests, frontmatter, and placeholder declarations. Use when authoring or forking the toolkit itself, not for a plain consuming repo.
user-invocable: true
argument-hint: "(no arguments)"
---

# Validate the toolkit definitions

Wraps `wafflestack validate` — the **toolkit-developer** lint. It loads every `stack.yaml`
plus its agents/skills/`files` and reports problems: missing descriptions, frontmatter `name`
mismatches, placeholders referencing dotted config keys the `stack.yaml` never declares,
declared config keys that are never referenced, dangling `requires:`/`optIn:` refs, and
`pattern:` defaults that fail their own regex. It exits non-zero when any problem is found.

## Scope — read this before running

`validate` checks the **toolkit source**, not this consuming repo's render. Run against the
published toolkit it just confirms the release is well-formed (always clean); its real value is
while **developing or forking** the toolkit — after editing a `stack.yaml`, a `SKILL.md`, an
agent, or a `files/` payload.

- **Toolkit checkout (the common case):** run the CLI against the working tree so you validate
  your edits, not the published copy:
  ```bash
  node installer/cli.mjs validate
  ```
- **Via the pinned ref (published toolkit):** confirms the release itself is valid:
  ```bash
  npx --yes github:dustinkeeton/wafflestack validate
  ```
  Point `github:dustinkeeton/wafflestack` at a local path to validate a fork without publishing.

## Interpret the result

- **`toolkit is valid`** — clean; safe to render/commit.
- **`N problems`** — each line is `stack <name>: <problem>`. Fix at the **source**: declare a
  missing placeholder in that `stack.yaml` `config:`, remove or reference an unused key, add a
  missing description, or correct a `requires:`/`optIn:` ref. Re-run until clean, then
  **`/waffle-render`** so the render and lock reflect the fixed source.
