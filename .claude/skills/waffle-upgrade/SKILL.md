---
name: waffle-upgrade
description: Move this repo's wafflestack pin to the toolkit's current version — runs migrations, re-renders, and doctors. Use to adopt a new toolkit release; review the diff before committing.
user-invocable: true
argument-hint: "(no arguments)"
---

# Upgrade the toolkit pin

Wraps `wafflestack upgrade` — it moves this repo's version pin to the toolkit version being
run, applies any ordered **migrations** between the two versions, **bumps the pinned
`toolkitRef` config keys** to the toolkit that rendered, re-renders the current selection, and
runs **doctor**. It takes no refs. Your job is to run it and then **review what changed**
before anything is committed.

## Run it

```bash
npx --yes github:dustinkeeton/wafflestack upgrade
```

## The version this moves TO is the version you RAN (read this before reporting "already up to date")

`upgrade` renders the content of the toolkit npx just fetched — it cannot render a version it is
not. So when `github:dustinkeeton/wafflestack` is pinned to an old tag, the **old** CLI runs and reports
`already on toolkit X`. That is not "you are up to date". **Escalate, in this order:**

1. **The run printed `a newer toolkit release exists: vX.Y.Z — … run:` followed by a command.**
   Run *that* command verbatim, and review *its* output instead. It is the release you actually
   want, and the pinned CLI just told you how to reach it.
2. **It said `already on toolkit X` and printed no such line** (a CLI predating this check).
   Probe with the ref **unpinned** — strip the `#tag`:
   ```bash
   npx --yes github:OWNER/REPO upgrade
   ```
   That normally runs at a genuine release, or **refuses and names the exact pinned command** to
   run instead. The refusal is the answer, not a failure — run the command it prints.

   > **There is a third outcome, and it is the dangerous one.** The gate refuses only what it can
   > *prove* is unreleased; a probe that cannot establish its own provenance (a network blip, a
   > `dlx`-shaped layout) resolves to `unverified`, which **fails open** — it warns and renders
   > anyway, from the default branch. So if the probe neither refuses nor reports a real release,
   > **stop and report — do not let it render.** Rendering default-branch content into the repo is
   > the exact failure this pinning exists to prevent.
3. Only after one of those actually moves the version is "already up to date" a true report.

The pins move themselves from there on: a successful `upgrade` rewrites a release-pinned
`waffle.toolkitRef` / `doctor.toolkitRef` in `.waffle/waffle.yaml` to the toolkit that rendered,
before the render — so the new pin lands in the skills and the doctor workflow in the same run.
An **unpinned** key is left floating and an absent one is never introduced; that is deliberate,
not a miss.

## Review the diff (the point of this skill)

`upgrade` narrates the version move, the changelog between versions, migrations applied, any
pin bumps, and the render. After it completes:

1. **Read the changelog span** it printed — call out anything a **consuming** repo must act on
   (behavior changes, renamed keys, new required config, removed items).
2. **Diff the rendered output** so the user sees exactly what moved in their tree — including
   `.github/`, which carries the doctor workflow's pinned ref:
   ```bash
   git diff -- .waffle/ .claude/ .github/
   ```
   Summarize the substantive changes; distinguish pure re-renders from behavior changes. Call
   out any `toolkitRef` bump explicitly: it changes which toolkit CI and the skills fetch.
3. **Handle doctor's verdict.** If `upgrade` ends with drift or warnings, surface them and
   recommend the fix (usually **`/waffle-render`** to restore, or resolving a migration note),
   rather than reporting success.
4. **Do not commit automatically.** Present the diff and let the user (or the git-workflow
   skill) commit the render + lock + version bump together.
