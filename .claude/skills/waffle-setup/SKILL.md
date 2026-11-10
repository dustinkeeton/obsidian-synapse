---
name: waffle-setup
description: Onboard wafflestack in this repo — scaffolds `.waffle/waffle.yaml` if missing (never overwrites one), then prints the setup playbook and full stack/skill/agent inventory and helps pick stacks and config. Use to start an install, plan an update, or audit what the toolkit offers. /waffle-init is an alias.
user-invocable: true
argument-hint: "(no refs — add --gitignore to also seed the baseline .gitignore entries)"
---

# Setup playbook + inventory

Wraps `wafflestack setup` (alias: `wafflestack init`, #611). When no config exists at any
generation it first writes a starter `.waffle/waffle.yaml` (reported on stderr as `wrote …`);
it **never overwrites** an existing one. Then it prints the agent-driven install playbook
(`schema/SETUP.md`) followed by a generated inventory of **every** stack: its items, config schema (required vs.
defaulted keys), env prerequisites, opt-in syrup items, and any `setup:` notes. It reads
current config when one exists, adding a **"Current configuration — update mode"** section
(live targets/stacks/includes/ejects/effective config/unset required keys/opt-in syrup state),
so a re-run curates an update pass.

## Run it

```bash
npx --yes github:dustinkeeton/wafflestack#v0.20.0 setup
```

Pass `--gitignore` through if `$ARGUMENTS` asks for it — it appends the stack-independent
baseline (`.waffle/waffle.local.yaml`, `.waffle/waffle.local.lock.json`, `.waffle/avatars/`)
to `.gitignore`, idempotently, whether or not a config already existed.

## Interpret it for the user

Do not just dump the output — read it and help the user decide:

- **Recommend a starting selection.** From the inventory, name the stacks that fit this repo
  and the required config keys each would demand. Flag any **opt-in syrup** items (sensitive
  `files/` payloads, marked "do NOT install by default") and explain what enabling one implies.
- **Point at the next command.** Turning the plan into files is **`/waffle-install <ref…>`**
  (persists the choice, then renders). `/waffle-render` re-renders an existing selection.
- **Surface prerequisites.** If a stack lists `env:` or a `setup:` block (e.g. `gh auth`,
  labels, a Projects v2 board, secrets), call those out before rendering — the render will
  warn on missing env, but service-side setup is on the user.
- **Name the behavioral keys.** A key whose description lists modes (`true` / `false` /
  `prompt`) governs a behavior — a confirmation gate, auto-merge arming, a review loop — and the
  inventory shows it like any other defaulted key. Tell the user which ones their selection pulls
  in and how to set one: a value from the key's modes under `config:` in `.waffle/waffle.yaml`
  (shared) or `.waffle/waffle.local.yaml` (this machine), overridden per run by the skill's own
  token (`--yes`, `+automerge`, …), never by editing the rendered skill. Flag the locked ones: `autopilot.autoMerge` is
  `lockMode: prompt`, so config may not pre-answer it, and the three autopilot gates are
  `configModes: [false, prompt]`, so config may turn them off but never on. The
  playbook's step 3 subsection **"Behavioral keys — the three modes, precedence, `lockMode`"**
  has the precedence order, the error text, and the full key table.
