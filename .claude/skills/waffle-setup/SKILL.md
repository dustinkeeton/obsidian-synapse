---
name: waffle-setup
description: Print the wafflestack setup playbook and full stack/skill/agent inventory for this repo, then help pick stacks and config. Use to plan an install or audit what the toolkit offers.
user-invocable: true
argument-hint: "(no arguments)"
---

# Setup playbook + inventory

Wraps `wafflestack setup` — it prints the agent-driven install playbook (`schema/SETUP.md`)
followed by a generated inventory of **every** stack: its items, config schema (required vs.
defaulted keys), env prerequisites, opt-in syrup items, and any `setup:` notes. It reads
current config when one exists, adding a **"Current configuration — update mode"** section
(live targets/stacks/includes/ejects/effective config/unset required keys/opt-in syrup state),
so a re-run curates an update pass.

## Run it

```bash
npx --yes github:dustinkeeton/wafflestack setup
```

## Interpret it for the user

Do not just dump the output — read it and help the user decide:

- **Recommend a starting selection.** From the inventory, name the stacks that fit this repo
  and the required config keys each would demand. Flag any **opt-in syrup** items (sensitive
  `files/` payloads, marked "do NOT install by default") and explain what enabling one implies.
- **Point at the next command.** Turning the plan into files is **`/waffle-install <ref…>`**
  (persists the choice, then renders) — or, on a repo with no config yet, **`/waffle-init`**
  first. `/waffle-render` re-renders an existing selection.
- **Surface prerequisites.** If a stack lists `env:` or a `setup:` block (e.g. `gh auth`,
  labels, a Projects v2 board, secrets), call those out before rendering — the render will
  warn on missing env, but service-side setup is on the user.
