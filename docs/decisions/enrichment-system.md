# Enrichment System -- Design Decisions

**Date**: 2026-03-13
**Status**: Planned
**Module path**: `src/enrichment/`

---

## What the Enrichment System Does

After other plugin processes finish their work (elaboration rewrites a stub note, transcription produces a new note), the enrichment system analyzes the result and proposes additions:

- **Tags** drawn from what already exists in your vault, scored by relevance
- **Internal links** to related notes, ranked by folder proximity and content overlap
- **External references** (URLs) suggested by the AI based on note content
- **Frontmatter attributes** (e.g., `category`, `status`) inferred from context

The user reviews all proposals before anything is written. Nothing is applied automatically.

---

## Decision 1: Module Structure

**Context**: The enrichment system has many responsibilities -- vault analysis, scoring, prompt construction, UI. It needs to be organized without becoming a monolith.

**Decision**: Follow the existing module pattern (constructor takes `plugin`, `getSettings`, `notifications`) with these files:

| File | Responsibility |
|------|---------------|
| `types.ts` | Interfaces for enrichment proposals, scores, weights |
| `index.ts` | `EnrichmentModule` class (public API) |
| `vault-analyzer.ts` | Reads vault structure: existing tags, note paths, folder hierarchy |
| `weight-calculator.ts` | Computes folder proximity weights between notes |
| `tag-scorer.ts` | Scores candidate tags using proximity + global frequency |
| `link-resolver.ts` | Identifies and ranks candidate internal links |
| `prompt-builder.ts` | Constructs AI prompts for external references and frontmatter |
| `enrichment-applier.ts` | Writes accepted enrichments into note content |
| `enrichment-store.ts` | Persists pending/accepted/rejected enrichment proposals |
| `enrichment-view.ts` | Sidebar view for reviewing proposals |
| `enrichment-modal.ts` | Detail modal for individual proposal inspection |

A new shared utility, `src/shared/frontmatter-utils.ts`, handles frontmatter parsing and merging (used by both enrichment and potentially by elaboration in the future).

**Alternatives considered**:
- **Single large file**: Rejected because the scoring logic alone is complex enough to warrant isolation for testing.
- **Fewer files with combined responsibilities**: Rejected because vault analysis, scoring, and application are distinct concerns with different test strategies.

**Rationale**: Matches the granularity of the elaboration module (which has `detector.ts`, `proposer.ts`, `proposal-store.ts`, `proposal-view.ts`, `proposal-modal.ts`). Each file maps to a single testable concern.

---

## Decision 2: Weight Algorithm Design

**Context**: The system needs to rank tags and links by relevance. Pure keyword matching is brittle. AI-only scoring is expensive and non-deterministic. A hybrid approach uses local vault structure for deterministic scoring, with AI reserved for tasks that genuinely need it (external references, frontmatter inference).

**Decision**: Deterministic weight algorithm with six tunable parameters.

### Folder Proximity Scoring

Notes that are "near" the target note in the folder hierarchy get higher weights:

| Relationship | Default Weight |
|-------------|---------------|
| Same folder | 1.0 |
| Sibling folder (shared parent) | 0.8 |
| Cousin folder (shared grandparent) | 0.5 |
| Distant (3+ levels apart) | 0.2 |

Each additional level of separation reduces the weight by the **decay factor** (default: 0.15). Weights never drop below the **minimum floor** (default: 0.1).

### Tag Scoring Formula

```
tagScore = SUM(proximityWeight for each file using the tag) x log2(1 + globalTagCount)
```

- The sum rewards tags that appear in nearby notes (high proximity weight) over tags used only in distant parts of the vault.
- The logarithmic term gives a modest boost to widely-used tags without letting globally popular tags dominate. A tag used in 100 notes scores only ~3.3x higher than one used in 2 notes, all else being equal.
- The result is bounded to [0.1, 1.0] after normalization.

### Properties

- **Deterministic**: Same vault state always produces the same scores.
- **Monotonic**: Adding a nearby note with a tag can only increase (never decrease) that tag's score.
- **Bounded**: Scores always fall in [0.1, 1.0], making threshold settings predictable.

**All six parameters** (sameFolder, siblingFolder, cousinFolder, distantFolder, decayPerLevel, minimumFloor) are exposed in the plugin settings.

**Alternatives considered**:
- **TF-IDF**: Considered for tag ranking. Rejected because TF-IDF is designed for document retrieval against a query, not for scoring membership relevance within a knowledge graph. Folder proximity is a stronger signal in a personal vault.
- **AI-only scoring**: Rejected for tags and links because it would require sending vault metadata to an API on every enrichment, is non-deterministic, and is slow for large vaults. AI is reserved for external references and frontmatter where local signals are insufficient.
- **Simpler binary proximity** (nearby vs. far): Rejected because the gradient matters -- sibling folders often share a topic while cousin folders share a domain.

---

## Decision 3: Integration via Callback Injection

**Context**: Enrichment needs to run after elaboration acceptance and after transcription completion. The plugin needs a way to trigger enrichment from other modules.

**Decision**: Direct callback injection in `main.ts`. No event bus, no pub/sub.

```
elaboration.onProposalAccepted --> enrichment.enrich(file, 'elaboration')
audio.onTranscriptionComplete  --> enrichment.enrich(file, 'transcription')
video.onTranscriptionComplete  --> enrichment.enrich(file, 'transcription')
```

Plus a manual command: `auto-notes:enrich-current-note`.

**Alternatives considered**:
- **Event bus / pub-sub**: Rejected. The plugin currently has four modules and explicit wiring is easier to trace than indirect event dispatch. An event bus adds indirection that helps at scale but hurts readability in a small system. This can be revisited if the module count grows significantly.
- **Polling / file-watcher**: Rejected. Watching for vault file changes would trigger on every save, requiring complex debouncing and heuristics to distinguish enrichment-worthy changes from normal edits.

**Rationale**: Follows the existing pattern where `main.ts` is the only place that knows about module relationships. Modules remain unaware of each other (no circular dependencies). The dependency arrow goes: `main.ts` --> `enrichment/`, `main.ts` --> `elaboration/`, but never `elaboration/` --> `enrichment/`.

---

## Decision 4: Non-Destructive Guarantees

**Context**: Automatically modifying someone's notes is high-risk. Users must trust that the system will not silently alter their content. This is the most important design constraint.

**Decision**: Multiple layers of protection:

### Layer 1: Proposal Review (never auto-apply)

Even when `autoEnrich` is enabled, the system only *generates* proposals automatically. It never applies them. The user reviews proposals in a sidebar view with per-item toggles:

- Individual toggles for each tag, link, reference, and frontmatter attribute
- Accept selected / reject all controls
- Detail modal for inspecting the full proposal

### Layer 2: Marker Comments for Idempotent Updates

Enrichment content is wrapped in Obsidian-compatible marker comments:

```markdown
%% auto-notes-enrichment-start %%
... enrichment content ...
%% auto-notes-enrichment-end %%
```

This enables:
- **Idempotent re-enrichment**: Running enrichment again on the same note replaces the marked section rather than duplicating content.
- **Clean undo**: The `auto-notes:undo-enrichment` command can surgically remove everything between the markers without touching user-written content.
- **Visibility**: Users can see exactly what was added by searching for the markers.

### Layer 3: Additive-Only Operations

- **Tags**: Merged into the frontmatter `tags` array. Tags are never removed, only added.
- **Links**: Appended to a configurable "Related Notes" section (default heading: `## Related Notes`). Existing links in the note are never modified.
- **Frontmatter**: New keys are added; existing keys are never overwritten.

**Alternatives considered**:
- **Inline suggestions** (like code review comments): Rejected because Obsidian does not have a native suggestion/annotation layer. Marker comments are the closest equivalent that survives across sync and export.
- **Separate proposal files** (like elaboration uses): Rejected because enrichment additions are small and numerous. Storing each tag suggestion as a separate file would create excessive clutter. A single sidebar view is more appropriate.
- **Auto-apply with undo**: Rejected outright. Silent modification of notes violates user trust even if undo is available.

---

## Decision 5: Settings Design

**Context**: The enrichment system has many knobs. They need sensible defaults so most users never touch them, but power users should have full control.

**Decision**: `EnrichmentSettings` interface nested under `AutoNotesSettings.enrichment`:

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `enabled` | boolean | true | Master on/off |
| `autoEnrich` | boolean | true | Auto-generate proposals after elaboration/transcription |
| `maxTags` | number | 10 | Maximum tags to suggest |
| `maxInternalLinks` | number | 15 | Maximum internal links to suggest |
| `maxExternalLinks` | number | 3 | Maximum external references to suggest |
| `internalLinkThreshold` | number | 0.3 | Minimum score for a link to be suggested |
| `weights.sameFolder` | number | 1.0 | Proximity weight for same folder |
| `weights.siblingFolder` | number | 0.8 | Proximity weight for sibling folders |
| `weights.cousinFolder` | number | 0.5 | Proximity weight for cousin folders |
| `weights.distantFolder` | number | 0.2 | Proximity weight for distant folders |
| `weights.decayPerLevel` | number | 0.15 | Weight reduction per folder level |
| `weights.minimumFloor` | number | 0.1 | Minimum weight (never goes below this) |
| `excludeFolders` | string[] | ['templates', '.auto-notes'] | Folders to skip during vault analysis |
| `excludeTags` | string[] | ['no-enrich'] | Notes with these tags are skipped |
| `relatedNotesHeading` | string | 'Related Notes' | Heading for the internal links section |
| `referencesHeading` | string | 'References' | Heading for external references |

**Rationale**: The `max*` and `threshold` settings control output volume. The `weights.*` settings control ranking behavior. Most users will only ever change the max counts; the weight parameters are for users who want to fine-tune scoring for their vault structure.

---

## Decision 6: Shared Frontmatter Utility

**Context**: Both enrichment (adding tags, attributes) and elaboration (preserving frontmatter) need to parse and manipulate YAML frontmatter. The logic is currently ad-hoc in elaboration.

**Decision**: Extract frontmatter parsing into `src/shared/frontmatter-utils.ts` with functions for:

- Parsing frontmatter from note content
- Merging tags into an existing `tags` array without duplicates
- Adding new frontmatter keys without overwriting existing ones
- Serializing frontmatter back into the note

**Rationale**: Avoids duplicating YAML parsing logic across modules. Follows the existing pattern where `src/shared/` contains cross-cutting utilities (`file-utils.ts`, `ai-client.ts`, `api-utils.ts`).

---

## Open Questions

1. **Should enrichment proposals expire?** If a note is significantly edited after a proposal is generated, the suggestions may be stale. A staleness check (comparing file modification time to proposal creation time) could warn users.

2. **External reference quality**: AI-suggested URLs may be hallucinated. Should the system verify URLs are reachable before including them in proposals? This adds latency but prevents dead links.

3. **Performance at scale**: Vault analysis reads all markdown files to build the tag/link graph. For very large vaults (10,000+ notes), this may need caching or incremental updates. The current design assumes full re-analysis on each enrichment call.
