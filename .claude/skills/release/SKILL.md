---
name: release
description: Cut a new release of the Synapse plugin — bump the version, draft the CHANGELOG entry, and open a release PR. Use whenever the user asks to release, cut a release, ship or publish a new version, or bump the version, with or without an explicit major/minor/patch level. Defaults to a patch bump when no level is given.
user-invocable: true
argument-hint: "[major | minor | patch] — omit for a patch bump"
---

# Release Synapse

Cut a release by bumping the version, drafting a CHANGELOG entry, and opening a
release PR against `main`. Merging that PR is what actually ships — see
[How the release ships](#how-the-release-ships).

**This skill only opens the PR. It never merges and never pushes to `main`.**
The user reviews and merges the PR themselves.

## The bump level (the only argument)

| Argument            | Effect            | Example         |
| ------------------- | ----------------- | --------------- |
| *(none)* / `patch`  | `x.y.Z` → `x.y.(Z+1)` | 1.0.8 → 1.0.9 |
| `minor`             | `x.Y.z` → `x.(Y+1).0` | 1.0.8 → 1.1.0 |
| `major`             | `X.y.z` → `(X+1).0.0` | 1.0.8 → 2.0.0 |

**No argument means `patch`.** An explicit `x.y.z` also works — the bump script
accepts it — but the normal contract is `major` / `minor` / `patch`.

## Why this repo needs more than "edit a number"

`scripts/version-bump.mjs` keeps four files in lockstep — `manifest.json`,
`package.json`, `versions.json`, and the test mock `src/__mocks__/obsidian.ts`.
CI (`node scripts/version-bump.mjs --check`) fails the build if they ever drift,
so **always bump via the script, never by hand.** And because this is an
explicit, user-requested version bump, it's the one time the CHANGELOG *should*
be updated (a normal fix/feat PR must not touch it).

## Workflow

### 1. Preconditions

- **Clean working tree.** Run `git status --porcelain`. If there are unrelated
  modified files (e.g. local `.claude/settings.json`), `git stash` them so they
  don't get swept into the release commit — you'll restore them at the end.
  Never `git add -A`; you'll stage release files by explicit path.
- **Up to date with `main`:**
  ```sh
  git fetch origin
  git checkout main
  git pull --ff-only origin main
  ```

### 2. Pre-flight — run the gates CI runs

A release that fails Obsidian's automated review is *silently pulled from
search* within ~24h, so catch it here. Run all four; if any fail, **stop, report
which failed, and do not bump:**

```sh
npx tsc --noEmit --skipLibCheck
npm run lint      # includes eslint-plugin-obsidianmd — mirrors Obsidian's review
npm test
node esbuild.config.mjs production
```

(`main.js` is gitignored, so the production build won't dirty the tree.)

### 3. Compute the new version and branch

Read the current version from `manifest.json`, apply the bump level to get
`NEW_VERSION`, then branch from `main`:

```sh
git -c user.email=bot@wafflenet.io -c user.name=bot checkout -b chore/release-NEW_VERSION
```

### 4. Run the bump script

```sh
node scripts/version-bump.mjs <level>     # patch | minor | major (or the x.y.z)
```

It prints `Bumped <old> → <new>`. **Confirm `<new>` equals `NEW_VERSION`** (and
matches the branch name). If it doesn't, you miscomputed — rename the branch to
match before continuing.

### 5. Draft the CHANGELOG entry

Add one dated section at the **top** of the version list in `CHANGELOG.md` —
directly above the current topmost `## [x.y.z]` section, below the header
paragraph. Use today's date:

```markdown
## [NEW_VERSION] - YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Security
- ...
```

**Derive the entries from what merged since the last release tag:**

```sh
LAST_TAG=$(git tag --list '[0-9]*.[0-9]*.[0-9]*' --sort=-version:refname | head -1)

# Exact list of merges since the tag (one line per PR):
git log --first-parent --merges "$LAST_TAG"..origin/main --pretty=format:'%s — %b'

# Richer context (titles, bodies, labels) for writing user-facing prose:
gh pr list --state merged --base main --json number,title,body,labels \
  --search "merged:>$(git log -1 --format=%cs "$LAST_TAG")"
```

Writing rules — match the voice of the existing entries:

- **User-facing prose, not commit messages.** Describe what the user gets:
  *"The Review button now respects each action's auto-accept setting"* — not
  *"fix: review button auto-accept"*.
- **No PR or issue numbers.** Sentence case. Keep a Changelog categories only.
- **Map by intent:** `feat` → Added (or Changed if it alters existing
  behavior); `fix` → Fixed; anything about secrets/redaction/injection →
  Security.
- **Omit internal-only changes** — `chore`, `refactor`, `test`, `docs`, `ci`
  that users never see. Drop empty categories entirely. Don't invent entries; if
  a release is genuinely maintenance-only, keep it short and honest.

### 6. Commit — release files only, by explicit path

```sh
git -c user.email=bot@wafflenet.io -c user.name=bot add \
  manifest.json package.json versions.json src/__mocks__/obsidian.ts CHANGELOG.md

git -c user.email=bot@wafflenet.io -c user.name=bot commit -m "$(cat <<'EOF'
chore: release NEW_VERSION

Co-Authored-By: Claude <bot@wafflenet.io>
EOF
)"
```

### 7. Push and open the PR

Push over the HTTPS remote (SSH to github.com times out in this environment):

```sh
git -c user.email=bot@wafflenet.io -c user.name=bot push -u origin chore/release-NEW_VERSION

gh pr create --base main --title "chore: release NEW_VERSION" --body "$(cat <<'EOF'
## Summary
- Bump version to NEW_VERSION (from OLD_VERSION)
- Add CHANGELOG entry for NEW_VERSION

## Changelog
<paste the new CHANGELOG section's bullets here>

## Test plan
- [x] `npx tsc --noEmit --skipLibCheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] `node esbuild.config.mjs production`

Merging to `main` auto-tags `NEW_VERSION` and publishes the GitHub Release
(see docs/RELEASING.md).

Co-Authored-By: Claude <bot@wafflenet.io>
EOF
)"
```

No `closes #N` — a release PR doesn't resolve a specific issue.

### 8. Finish up

- Restore any changes you stashed in step 1 (`git stash pop`).
- Report the PR URL.
- **Do not merge it.** State plainly that the version bumped `OLD → NEW`, the
  PR is open for review, and merging triggers the automated release below.

## How the release ships

Once the user merges the PR to `main`, everything is automated — there's no
Obsidian submission step:

1. The `manifest.json` change on `main` fires `tag-on-version-bump.yml`, which
   pushes a matching tag (**no `v` prefix** — e.g. `1.0.9`).
2. That calls `release.yml`, which builds, attests provenance, and creates the
   GitHub Release with `main.js`, `manifest.json`, `styles.css`.
3. Obsidian auto-reviews the release and delivers the update in-app within ~24h.

Full detail lives in `docs/RELEASING.md`; git/commit/PR conventions in the
`git-workflow` skill.

## If something fails

- **Pre-flight gate fails** → stop before bumping; report which gate and the
  error. Nothing to undo.
- **After the bump, before commit, you need to bail** → `git checkout -- .` to
  drop the version/CHANGELOG edits, then delete the branch.
- **Version files already drifted** → the bump script refuses and prints the
  mismatch; fix consistency first, then re-run.
