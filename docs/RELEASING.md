# Releasing Synapse

Synapse is published in the **Obsidian Community Plugin store**
([community.obsidian.md/plugins/synapse](https://community.obsidian.md/plugins/synapse)).
Once a plugin is in the store, **publishing a new version is automatic** — there is no
per-release submission, no button to click, and no PR to `obsidianmd/obsidian-releases`. This
document describes the actual flow so it isn't re-litigated.

## TL;DR

Bump the version on `main`. Everything else is automated.

```sh
node scripts/version-bump.mjs patch    # or minor | major | x.y.z
git add manifest.json package.json versions.json src/__mocks__/obsidian.ts
git commit -m "chore: release vX.Y.Z"
git push
```

## What happens, step by step

1. **You bump the version.** `scripts/version-bump.mjs` updates, in lockstep:
   `manifest.json`, `package.json`, `versions.json` (appends `"<newVersion>": "<minAppVersion>"`),
   and the test mock `src/__mocks__/obsidian.ts`. (`node scripts/version-bump.mjs --check`, run in
   CI, fails if these ever drift.)
2. **You commit + push to `main`.** This is the only manual step.
3. **Auto-tag.** `.github/workflows/tag-on-version-bump.yml` fires on any push to `main` that
   touches `manifest.json`, reads the version, and pushes a matching git tag. Obsidian requires the
   tag to equal the manifest version exactly, so tags have **no `v` prefix** (e.g. `1.0.8`).
4. **Auto-release.** That workflow then calls `.github/workflows/release.yml`, which runs the lint
   gate + build, verifies `manifest`/`versions.json`/tag agree, attests build provenance, and
   creates the **GitHub Release** with `main.js`, `manifest.json`, and `styles.css` attached.
5. **Obsidian auto-reviews + delivers.** Obsidian automatically scans every new GitHub release for
   security, code quality, and malware. If it passes, the update is available in-app **within ~24
   hours**. Users on older app versions are served the newest release whose `versions.json`
   `minAppVersion` they satisfy.

## Pre-flight checklist (before you bump)

Run the same gates CI does — a release that fails Obsidian's automated review is **silently
removed from search within ~24 hours**, so catch problems here:

```sh
npx tsc --noEmit --skipLibCheck
npm run lint          # includes eslint-plugin-obsidianmd — the local mirror of Obsidian's review
npm test
node esbuild.config.mjs production
```

Optionally, run a **preview scan** on a branch/tag/commit from the Obsidian developer dashboard
before you push — it runs the same automated review without publishing.

## Things to know

- **No submission step.** Publishing a GitHub release *is* the submission. Do **not** open a PR
  against `obsidianmd/obsidian-releases` — that legacy path is superseded by the
  community.obsidian.md hub and the automatic release review.
- **Failed review is silent.** If a release fails the automated review it is pulled from search;
  the error details live on the developer dashboard. The `eslint-plugin-obsidianmd` gate in CI
  (`eslint.config.mjs`, #389) is the pre-flight that keeps this from happening — it flags the same
  guideline issues the reviewer does (Obsidian API usage, detached-view leaks, popout-safe timers,
  sentence-case UI text, etc.).
- **`versions.json` only needs editing when `minAppVersion` changes.** The bump script appends an
  entry for every version regardless, which is harmless and keeps the release workflow's
  consistency check happy.
- **Updates need no resubmission.** After the one-time store acceptance (already done), every
  future release flows through automatically.
- **Betas** ship via BRAT against this repo, independent of the store (see the README).
