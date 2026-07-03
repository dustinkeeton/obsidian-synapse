# Synapse overrides — how THIS repo releases

The generic steps above are adjusted below; where they conflict, this section wins.
Full ship detail lives in `docs/RELEASING.md`.

## Bump level

**No argument means `patch`** — do not infer the level from changes. An explicit
`minor` / `major` / `x.y.z` is honored as usual.

## Preconditions

- Clean working tree: `git status --porcelain`. `git stash` unrelated modified files
  (e.g. local `.claude/settings.json`) so they don't get swept into the release commit;
  restore them at the end.
- Branch name is `chore/release-X.Y.Z` (not `chore/bump-X.Y.Z`).

## Version bump — use the bump script, never `npm version`

`scripts/version-bump.mjs` keeps four files in lockstep — `manifest.json`,
`package.json`, `versions.json`, and the test mock `src/__mocks__/obsidian.ts` — and CI
(`node scripts/version-bump.mjs --check`) fails the build if they ever drift. So:

- Do **not** run `npm version` — it touches only package.json/lockfile and leaves
  `manifest.json` (the version Obsidian actually reads) behind.
- Run `node scripts/version-bump.mjs <level>` (`patch` | `minor` | `major`, or an
  explicit `x.y.z`). It prints `Bumped <old> → <new>`; confirm `<new>` matches the
  version in your branch name.
- The lockfile's own `version` field is deliberately not synced — leave it alone.
- If the script refuses because the version files already drifted, fix consistency
  first, then re-run.

## CHANGELOG — no `[Unreleased]` section

This CHANGELOG keeps dated sections only. Instead of renaming `[Unreleased]`, add one
new `## [X.Y.Z] - YYYY-MM-DD` section at the **top** of the version list (below the
header paragraph), deriving entries from what merged since the last release tag:

```sh
LAST_TAG=$(git tag --list '[0-9]*.[0-9]*.[0-9]*' --sort=-version:refname | head -1)

# One line per merged PR:
git log --first-parent --merges "$LAST_TAG"..origin/main --pretty=format:'%s — %b'

# Richer context (titles, bodies, labels) for user-facing prose:
gh pr list --state merged --base main --json number,title,body,labels \
  --search "merged:>$(git log -1 --format=%cs "$LAST_TAG")"
```

Writing rules — match the voice of the existing entries:

- **User-facing prose, not commit messages** — describe what the user gets.
- **No PR or issue numbers.** Sentence case. Keep a Changelog categories only.
- Map by intent: `feat` → Added (or Changed if it alters existing behavior);
  `fix` → Fixed; anything about secrets/redaction/injection → Security.
- Omit internal-only changes (`chore`, `refactor`, `test`, `docs`, `ci`). Drop empty
  categories. Don't invent entries — a maintenance-only release stays short and honest.

## Pre-flight — run the FULL ci.yml gate set

A release that fails Obsidian's automated review is *silently pulled from search*
within ~24h, so catch it here (`npm run lint` includes eslint-plugin-obsidianmd, which
mirrors that review). Beyond the four generic gates, also run the repo's custom guards:

```sh
node scripts/check-top-level-requires.mjs
node scripts/version-bump.mjs --check
```

## Commit — release files only, by explicit path

```
manifest.json package.json versions.json src/__mocks__/obsidian.ts CHANGELOG.md
```

Nothing else (`main.js` is gitignored, so the production build won't dirty the tree).

## Ship mechanism — no release label, no v-prefix, never tag by hand

This repo does **not** install `waffle-release-hook` and does **not** use the
`waffle:release` label — skip the generic label steps entirely. Merging the release PR
to `main` ships automatically:

1. The `manifest.json` version change fires `.github/workflows/tag-on-version-bump.yml`,
   which pushes the release tag — **no `v` prefix** (Obsidian requires the tag to match
   `manifest.json`'s version exactly, e.g. `1.0.12`).
2. That workflow calls `release.yml` via `workflow_call` (a `GITHUB_TOKEN` tag push
   cannot trigger it), which builds, attests provenance, and publishes the GitHub
   Release with `main.js`, `manifest.json`, `styles.css`.
3. Obsidian auto-reviews the release and delivers the update in-app within ~24h — there
   is no submission step.

The generic guardrail stands doubly here: never `git tag` or `git push --tags` — the
tag must come from the workflow so it always matches the merged manifest.

## PR body

State that merging to `main` auto-tags `X.Y.Z` and publishes the GitHub Release (see
`docs/RELEASING.md`) — not the generic waffle-release-hook paragraph. No `closes #N`;
a release PR doesn't resolve a specific issue.

## If something fails

- **Pre-flight gate fails** → stop before bumping; report which gate and the error.
- **After the bump, before commit** → `git checkout -- .` drops the version/CHANGELOG
  edits; delete the branch.
- **Version files already drifted** → the bump script refuses and prints the mismatch;
  fix consistency first, then re-run.
