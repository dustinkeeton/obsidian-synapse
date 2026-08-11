---
name: waffle-install
description: Install wafflestack stacks or individual items into this repo — persists the refs to `.waffle/waffle.yaml`, then re-renders. Use to add a stack (e.g. github-workflow) or an item (skills/issue).
user-invocable: true
argument-hint: "<ref…> e.g. github-workflow skills/issue files/.github/workflows/waffle-doctor.yml (bare = re-render only; --force overrides the overwrite guard; --gitignore adds recommended entries)"
---

# Install a stack or item

Wraps `wafflestack install <ref…>` — it **resolves** each ref, **persists** it to
`.waffle/waffle.yaml` (a stack name → `stacks:`; an item ref → `include:`, stack-qualified only
when ambiguous), then runs a full render. Persisting is required, not cosmetic: the
frozen-image contract deletes any locked file the next render doesn't reproduce, so an
un-persisted ad-hoc install would be silently removed. A **bare** `install` (no refs) is just a
re-render of the current selection.

## Resolve `$ARGUMENTS`

Treat `$ARGUMENTS` as a space-separated list of **refs** plus optional flags:

| Ref form | Example | Meaning |
|----------|---------|---------|
| stack name | `github-workflow` | adopt a whole stack |
| item | `skills/issue`, `agents/docs-agent`, `files/.github/workflows/waffle-doctor.yml` | one item + its dependency closure |
| stack-qualified item | `engineering-team/skills/webapp-security-audit` | disambiguates a name defined in more than one stack |

Flags to pass through when asked: `--force` (overwrite an unmanaged file collision) and
`--gitignore` (append recommended entries after a clean render). If the user names a stack or
item you are unsure of, run **`/waffle-setup`** first to confirm the exact ref.

## Run it

```bash
npx --yes github:dustinkeeton/wafflestack install <refs…> [--force] [--gitignore]
```

## Interpret the result

- **Report what was pulled in.** Installing an item drags its **dependency closure**
  (an agent's `skills:` and any `requires:`) transitively across stacks — the CLI prints the
  added refs. Name them so the user isn't surprised by extra rendered files.
- **Report the render.** Relay the `rendered N files` / `removed stale: …` lines.
- **Missing config.** If the render fails demanding a required key
  (`config.<stack>.<key>`), add it to `.waffle/waffle.yaml` `config:` (or the gitignored
  `.waffle/waffle.local.yaml` for account-specific values) and re-run.
- **Unmanaged-file collision.** If it refuses to overwrite a pre-existing, unmanaged file,
  do **not** blindly `--force` (that discards their file). Explain the collision, offer to move
  the file aside or fold it into a `.waffle/extensions/` file, and only `--force` once the user
  agrees the toolkit's version should own that path.
