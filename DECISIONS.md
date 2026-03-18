# Decision Log

Decisions listed in reverse chronological order.

---

## 2026-03-17: Unified transcription — 6 commands to 2 + 1 utility (Issue #20)

**Context**: Audio and video modules each had their own modal classes for transcription: `TranscriptionModal` and `NoteAudioModal` in `src/audio/`, `VideoModal` and `NoteVideoModal` in `src/video/`. This meant 6 separate transcription commands, 4 modal classes, and duplicated UI patterns across two modules.

**Decision**: Consolidate into a new `src/transcription/` module with two modal classes:
- **UnifiedTranscriptionModal** — combines audio file picker and video URL input in a single modal (replaces `TranscriptionModal` + `VideoModal`)
- **NoteMediaModal** — scans the current note for both audio embeds and video URLs, presents a unified selection UI (replaces `NoteAudioModal` + `NoteVideoModal`)

Reduce to 2 unified commands + 1 utility:
- `synapse:transcribe-media` — opens UnifiedTranscriptionModal
- `synapse:transcribe-note-media` — opens NoteMediaModal for the current note
- `synapse:check-dependencies` — checks yt-dlp/ffmpeg availability (retained from video module)

The transcription module is UI-only; it delegates all work to AudioModule and VideoModule via callbacks wired in `main.ts`. AudioModule and VideoModule expose new public methods (`transcribeFileToActiveNote`, `transcribeUrlToActiveNote`, `transcribeAndInsert`) for the unified orchestration.

Settings tab reorganized with a "Media Transcription" parent heading grouping both audio and video settings.

**Alternatives considered**:
- Keep separate commands with a "smart" command that auto-detects media type (still requires two modal implementations)
- Merge Audio and Video modules entirely (too much coupling; they have independent provider configurations and different external dependencies)
- Add transcription UI to each module's own modal but share via inheritance (fragile, tight coupling between UI classes)

**Rationale**: Users think in terms of "transcribe this media" — not "is this audio or video?" The unified modal handles both media types with a single entry point. Keeping AudioModule and VideoModule as separate backend modules preserves clean separation of concerns (different providers, different external tools). The transcription module acts as a thin UI layer that delegates to the right backend.

**Impact**:
- 4 modal files deleted (`audio/transcription-modal.ts`, `audio/note-audio-modal.ts`, `video/video-modal.ts`, `video/note-video-modal.ts`)
- 3 new files in `src/transcription/` (unified-modal.ts, note-media-modal.ts, index.ts)
- Command count reduced from ~25 to 21
- Single ribbon icon (`mic`) for all transcription
- Audio and video modules no longer register their own commands (except `check-dependencies`)

---

## 2026-03-16: Deep-dive generate-all-upfront model

**Context**: When a user triggers a deep dive, the system needs to decide whether to generate child notes one at a time (with user approval between each) or generate the entire tree upfront and let the user accept/reject afterward.

**Decision**: Generate the entire proposal tree upfront in a single BFS traversal, store all proposals, and present them in the unified sidebar for batch review. The user confirms once before generation starts, then reviews all proposals afterward.

**Alternatives considered**:
- Interactive step-by-step generation (user approves each level before proceeding -- more control but slow and tedious for large trees)
- Background generation with streaming UI updates (complex, hard to cancel cleanly)
- Generate only depth 0, let user trigger deeper dives manually (safe but loses the recursive discovery value)

**Rationale**: Upfront generation minimizes user friction. A deep dive into a note with 5 topics at depth 3 could produce 15-50 proposals -- asking for approval at each step would be exhausting. The BFS queue processes topics breadth-first, so proposals at depth 0 are ready for review while deeper levels are still generating. The single confirmation gate before generation prevents accidental API costs.

**Impact**: Users get a complete proposal tree to browse. They can accept individual notes or reject branches (cascade rejection removes children too). Progress tracking and cancellation are available during generation.

---

## 2026-03-16: Local heuristic quality scorer (no AI)

**Context**: The deep-dive module needs to decide when to stop recursing. A topic at depth 2 that produces thin, generic content shouldn't spawn more children.

**Decision**: Use a local heuristic scorer (`quality-scorer.ts`) with five weighted factors -- no AI call for scoring:
- Topic count (0.3): `min(1.0, childTopics / 3)`
- Word count (0.2): `min(1.0, wordCount / 200)`
- Generic penalty (0.2): penalizes 1-word titles or common words ("introduction", "overview", etc.)
- Overlap penalty (0.2): fraction of child topics already in ancestor list
- Depth decay (0.1): `1.0 - (depth / maxDepth * 0.5)`

Score below `qualityThreshold` (default 0.4) stops recursion for that branch.

**Alternatives considered**:
- AI-based quality assessment (adds an API call per proposal; doubles cost for marginal benefit)
- Fixed depth limit only (doesn't account for content quality; wastes API calls on thin branches)
- User-defined per-topic stop/continue (too interactive for upfront generation model)

**Rationale**: Local heuristics are free, fast, and surprisingly effective. The overlap penalty catches circular topics. The generic penalty avoids wasting API calls on "Introduction to X" or "Overview" notes that won't have rich subtopics. Word count correlates with generation quality. The configurable threshold lets users tune aggressiveness.

**Impact**: Deep dives terminate branches early when quality drops, saving API costs. The `earlyTerminations` stat in run metadata shows how many branches were pruned.

---

## 2026-03-16: Cascade rejection for deep-dive proposals

**Context**: Deep-dive proposals form a tree. When a user rejects a depth-0 proposal, its children (depth 1, 2, ...) become orphaned -- they reference a parent note that will never exist.

**Decision**: Rejecting a proposal automatically rejects all its descendants. The `DeepDiveStore.cascadeReject(id)` method walks the `childProposalIds` tree and marks all as rejected. The UI shows a count: "Rejected 5 proposals (including children)."

**Alternatives considered**:
- Reject only the selected proposal, leave children pending (orphaned proposals confuse users)
- Delete children entirely (loses the record for run statistics)
- Ask user per child whether to keep or reject (too much friction)

**Rationale**: An orphaned child proposal makes no sense -- it would create a note about a subtopic of a note that doesn't exist. Cascade rejection is the only consistent behavior. Keeping rejected proposals (rather than deleting) preserves run statistics for debugging quality thresholds.

**Impact**: Users can prune entire subtrees with a single reject. The run's proposal count and depth stats remain accurate.

---

## 2026-03-16: Deep-dive auto-enrich and auto-organize on accept

**Context**: When a user accepts a deep-dive proposal, the new note is created bare -- no tags, no links, no enrichment. Users would need to manually trigger enrichment and organize on each accepted note.

**Decision**: Add two opt-in callbacks:
- `autoEnrichOnAccept` (default: true): triggers `enrichment.enrich(filePath, 'deep-dive')` after note creation
- `autoOrganizeOnAccept` (default: false): triggers `organize.organizeNote(file)` after note creation

Both are wired in `main.ts` only when the corresponding modules are enabled.

**Alternatives considered**:
- Always enrich and organize (opinionated, hard to disable)
- Never auto-trigger (requires manual commands on every accepted note)
- Batch enrich/organize all accepted notes at once (complex, timing issues)

**Rationale**: Enrichment is low-risk and high-value -- newly generated notes benefit from tags and links immediately. Organize is off by default because moving a just-created note before the user has reviewed it can be surprising. Both are configurable per user preference.

**Impact**: Accepted deep-dive notes are automatically connected to the vault graph. Organize can be enabled for users who want fully automated file management.

---

## 2026-03-16: Organize module uses dual action model (move vs propose)

**Context**: The organize module analyzes note content and determines the best directory. Sometimes the best directory already exists; sometimes a new directory needs to be created.

**Decision**: Two action types:
- **move**: if the AI recommends an existing directory, move the note immediately with a snapshot for undo
- **propose-new-directory**: if a new directory is needed, create a proposal for user review in the sidebar

**Alternatives considered**:
- Always propose (too much friction for obvious moves to existing directories)
- Always move, create directories automatically (risky -- bad AI suggestions create folder clutter)
- Only move to existing directories, never suggest new ones (limits organization growth)

**Rationale**: Existing directories are user-validated locations. Moving to them is safe and reversible (via snapshot/undo). New directories deserve user confirmation because they change vault structure permanently. This split gives users speed where it's safe and control where it matters.

**Impact**: Most organizes are instant moves. Only novel directory suggestions require sidebar review.

---

## 2026-03-16: Summarize module creates standalone notes for enrichment-section links

**Context**: The summarize module handles two contexts: inline URLs/transcriptions in the note body, and external reference links added by enrichment (in the `## References` section). Inline summaries are simple blockquotes. But enrichment-section links are references to external resources -- summarizing them inline would clutter the references section.

**Decision**: When summarizing a URL in the enrichment section:
1. Fetch and summarize the content with a comprehensive prompt
2. Create a standalone summary note (new file in vault)
3. Replace the external `[title](url)` link with an internal `[[Summary - title]]` link in the source note

When summarizing outside the enrichment section, insert a blockquote summary inline after the URL.

**Alternatives considered**:
- Always inline (clutters enrichment sections)
- Always create standalone notes (overkill for simple URL summaries in note body)
- Never summarize enrichment links (misses opportunity to bring external knowledge into the graph)

**Rationale**: Enrichment-section links represent curated references. Converting them to internal notes with full summaries strengthens the knowledge graph. The external URL is preserved in the summary note, so no information is lost. Inline summaries are more appropriate for casual URL mentions in the note body.

**Impact**: Users can "internalize" their external references into vault notes. The original reference link is replaced with an internal link, keeping the references section clean.

---

## 2026-03-16: Unified view expanded to 4 proposal types with color coding

**Context**: The unified proposal view originally supported elaboration and enrichment. The organize and deep-dive modules added two new proposal types that needed review UI.

**Decision**: Extend `UnifiedItem` to a 4-way discriminated union: `elaboration | enrichment | organize | deep-dive`. Each type gets a distinct color (blue, green, orange, purple) and a specialized review pane:
- Organize: shows proposed directory, AI reasoning, accept/reject
- Deep-dive: shows topic title, depth badge, quality score, content preview, child count warning, accept/reject

**Alternatives considered**:
- Separate views per module (fragmented UX, already rejected this once)
- Tabs within the sidebar (adds navigation overhead)
- Only show deep-dive in a modal (inconsistent with other proposal types)

**Rationale**: Consistency -- all proposal types use the same browse-and-review workflow. Color coding provides instant visual differentiation. The deep-dive review pane is read-only (unlike elaboration's editable textarea) because generated notes are complete and shouldn't be hand-edited before acceptance.

**Impact**: One sidebar, four proposal types, four colors. Users have a single place to manage all pending proposals.

---

## 2026-03-13: On-demand folder creation in stores

**Context**: Store classes (ProposalStore, EnrichmentStore, TidyStore) relied on an `init()` call during plugin startup to create their storage folders. If the folder was deleted while the plugin was running, subsequent saves would fail.

**Decision**: Add `await ensureFolder(this.app, this.folderPath)` at the top of every `save()` method, in addition to the existing `init()` call. The `ensureFolder` function in `shared/file-utils.ts` handles the race condition where a folder exists on disk but not in the vault cache.

**Alternatives considered**:
- Rely solely on `init()` (fails if folder deleted mid-session)
- Create folder lazily on first save only, remove `init()` (startup validation is still useful)

**Rationale**: Belt-and-suspenders approach. The `init()` call catches configuration errors early (bad path, permissions); the `save()` call handles runtime deletion. `ensureFolder` is idempotent and cheap.

**Impact**: Stores are resilient to folder deletion during plugin runtime. No behavior change for normal usage.

---

## 2026-03-13: Git workflow -- protected main, feature branches, bot identity

**Context**: The project was growing beyond solo development. Multiple agents (human and AI) needed to contribute without stepping on each other's work or breaking main.

**Decision**: Establish a formal git workflow:
- **Protected main**: never push directly; all changes via pull requests
- **Feature branches**: `feat/`, `fix/`, `refactor/`, `chore/` prefixes
- **Bot identity**: all git operations use `bot@wafflenet.io` / `bot` (never personal identities)
- **Co-authored commits**: `Co-Authored-By: Claude <bot@wafflenet.io>` trailer
- **Pre-flight checklist**: type-check, test, build before pushing
- **Worktrees**: for parallel work on conflicting files

**Alternatives considered**:
- Trunk-based development (risky without CI/CD gate)
- Personal identity for commits (confuses authorship tracking)
- No formal workflow (works solo, breaks with multiple contributors)

**Rationale**: Protected main prevents accidental breakage. Feature branches isolate work-in-progress. The bot identity creates a clear audit trail distinguishing automated from manual commits. Worktrees enable parallel agent work without branch switching.

**Impact**: All contributors follow the same workflow. PRs are the only path to main. The git-workflow skill (`/.claude/skills/git-workflow/SKILL.md`) documents the full protocol.

---

## 2026-03-13: Teams infrastructure for multi-agent coordination

**Context**: The project uses multiple specialized AI agents (architect, security, docs, elaboration-designer, transcription-engineer). These agents need clear role boundaries, shared skills, and coordination mechanisms.

**Decision**: Create a teams infrastructure under `.claude/agents/` with dedicated agent definition files. Each agent has:
- A name and description
- A list of skills they can use
- A list of allowed tools
- Clear responsibility boundaries

**Alternatives considered**:
- Single monolithic agent (loses specialization benefits)
- Ad-hoc agent instructions (inconsistent, hard to maintain)
- External coordination tool (adds complexity, another dependency)

**Rationale**: Explicit agent definitions prevent role confusion and scope creep. Skills are shared (any agent can use `git-workflow`), but responsibilities are distinct (only `security` audits for vulnerabilities). The file-based approach is version-controlled and easy to extend.

**Impact**: Seven agents defined: architect, security, docs-agent, docs-human, elaboration-designer, plugin-architect, transcription-engineer. Adding a new agent means creating a new `.md` file in `.claude/agents/`.

---

## 2026-03-13: Enrichment redesign -- tags as metadata classifiers, topics as links

**Context**: The original enrichment module used a `TagScorer` that treated tags as topic labels (e.g., `#machine-learning`, `#python`). This conflicted with Obsidian best practices: tags work best as metadata classifiers (status, type, source), while topics belong as `[[internal links]]` in the knowledge graph.

**Decision**: Replace `TagScorer` with two new components:
- **MetadataClassifier** (`metadata-classifier.ts`): classifies notes using a user-defined tag vocabulary. Tags are rare, purposeful metadata (e.g., `#draft`, `#reference`, `#meeting-notes`). AI classifications are validated against the vocabulary -- hallucinated tags are rejected.
- **TopicExtractor** (`topic-extractor.ts`): extracts key concepts from note content and converts them to `[[internal link]]` candidates. Matched topics (existing vault notes) become link suggestions immediately. Unmatched topics are accumulated for cross-note resolution.

**Alternatives considered**:
- Keep TagScorer with frequency + proximity weighting (treats tags as topics, against Obsidian conventions)
- Tags only, no topic extraction (misses link graph opportunities)
- AI-only link suggestions without vault matching (ignores existing knowledge graph)

**Rationale**: This aligns with the Obsidian community consensus: tags are for classification/filtering, links are for building a knowledge graph. A user who searches `#draft` expects to find incomplete notes, not every note mentioning "drafts." Topic extraction surfaces the concepts that should be linked, not tagged.

**Impact**: The `TagVocabularyEntry` setting defines allowed tag categories. Users control exactly which tags the system can suggest. Topics become link candidates, enriching the knowledge graph. The old `TagScorer` class no longer exists.

---

## 2026-03-13: New-note suggestions require 2+ independent references

**Context**: During vault-wide enrichment scans, the `TopicExtractor` identifies topics that do not match any existing vault note. These could be suggested as "create this new note" candidates. However, a single AI mention of a topic is weak evidence -- it might be noise.

**Decision**: Only promote an unmatched topic to a new-note suggestion when 2 or more notes independently reference the same topic. The `TopicExtractor` accumulates unmatched topics in a `pendingNewTopics` map during the scan, then `resolveNewNoteCandidates()` filters for multi-reference topics in Phase 4.

**Alternatives considered**:
- Suggest new notes for any unmatched topic (too noisy, creates clutter)
- Require 3+ references (too conservative, misses genuine connections)
- Never suggest new notes (misses knowledge graph growth opportunities)
- Human threshold setting (adds settings complexity for marginal benefit)

**Rationale**: Two independent notes surfacing the same concept is strong evidence of a genuine hub topic worth creating. Single mentions are often contextual noise or AI hallucination. The 2-note threshold balances signal quality against discovery.

**Impact**: Vault scans produce fewer but higher-quality new-note suggestions. Single-note enrichment never suggests new notes (no cross-note evidence available).

---

## 2026-03-13: Proximity scoring weights lowered -- topical relevance dominates

**Context**: The original link scoring gave equal weight to folder proximity and topical relevance. This produced link suggestions biased toward nearby files even when topically unrelated.

**Decision**: Reduce proximity scoring multipliers in `LinkResolver`:
- Graph hop candidates: `proximity * 0.25` (was higher)
- Shared tag candidates: `proximity * sharedCount * 0.15` (was higher)
- Folder proximity candidates: `proximity * 0.15` (was higher)

In `mergeTopicCandidates()`, topic relevance dominates: graph proximity adds only `existing.score * 0.2` as a bonus when a candidate appears in both sources. Topic base score is 0.7; proximity contributes at most 0.2 * proximity.

**Alternatives considered**:
- Keep equal weighting (proximity bias overwhelms topical relevance)
- Remove proximity entirely (loses useful same-folder signal)
- User-configurable balance slider (adds UI complexity for a tuning parameter)

**Rationale**: Topic relevance is the primary signal -- a note about "React Hooks" should link to other React notes regardless of folder. Proximity is a tiebreaker, not a driver. The lowered weights ensure topically relevant notes in distant folders still surface.

**Impact**: Link suggestions are more topically relevant and less biased by folder structure. The `weights` settings still control proximity tiers, but their influence on final scores is reduced.

---

## 2026-03-13: Vault-wide enrichment scan with 4-phase flow

**Context**: Single-note enrichment worked well, but users needed a way to enrich their entire vault at once. A naive "loop over all files" approach would be expensive (many AI calls) and couldn't leverage cross-note evidence for new-note suggestions.

**Decision**: Implement a 4-phase vault scan in `EnrichmentModule.scanVault()`:
1. **Scan**: collect eligible files (respecting exclude rules), warm VaultAnalyzer caches
2. **Confirm**: user confirmation via NotificationManager (gates expensive AI calls)
3. **Generate**: per-file enrichment with progress tracking and cancellation. TopicExtractor accumulates unmatched topics across all files
4. **Resolve**: `TopicExtractor.resolveNewNoteCandidates()` -- topics referenced by 2+ notes become new-note link suggestions, injected into existing proposals via `LinkResolver.mergeTopicCandidates()`

On error or cancellation in Phase 3, all created proposals are rejected and pending topics are cleared.

**Alternatives considered**:
- Simple loop with per-note confirmation (too many dialogs)
- Background processing without confirmation (expensive surprise API bills)
- Batch AI calls for multiple notes at once (token limits, harder to cancel per-note)

**Rationale**: The 4-phase design separates cheap operations (scan) from expensive ones (AI calls), giving the user a gate before costs are incurred. Phase 4 is the key innovation: cross-note topic resolution can only happen after all notes have been processed, so it must be a separate post-processing step.

**Impact**: Users can enrich their entire vault with one command. The confirmation step prevents accidental API charges. Cross-note topic resolution produces new-note suggestions that single-note enrichment cannot.

---

## 2026-03-13: Tidy module uses immediate apply, no proposals

**Context**: The tidy feature (spelling/formatting correction) was being designed. Other modules (elaboration, enrichment) use a proposal-review workflow where changes are stored as JSON proposals and presented in a sidebar for user approval.

**Decision**: Tidy applies changes immediately to the note without a proposal step. A snapshot of the original content is saved to `.synapse/tidy-snapshots/` for undo capability.

**Alternatives considered**:
- Proposal workflow like elaboration/enrichment (adds friction for low-risk changes)
- Diff view showing before/after (complex UI for minimal benefit)
- No undo capability (risky if AI makes unwanted formatting changes)

**Rationale**: Tidy changes are cosmetic -- spelling fixes and markdown formatting only, no content addition or removal. The risk of unwanted changes is low, and the undo command provides a safety net. A full proposal workflow would slow down a feature that should feel instant. One snapshot per file (overwriting previous) keeps storage bounded.

**Impact**: Users run `Tidy current note` and see changes immediately. If unsatisfied, `Undo last tidy` restores the original content. No sidebar review needed.

---

## 2026-03-13: Unified proposal view replaces per-module sidebars

**Context**: Elaboration and enrichment each had their own sidebar view classes (`ProposalReviewView`, `EnrichmentReviewView`) and their own modals. Users had to navigate between separate UI surfaces to review different types of proposals.

**Decision**: Create a single `UnifiedProposalView` in `src/views/` that displays all proposal types in one sidebar. The view has multiple rendering modes: list (all proposals grouped by note), elaboration review (editable textarea), enrichment review (per-item checkboxes), organize review (directory + reasoning), and deep-dive review (topic + quality score + content preview). Legacy view classes remain in the codebase but are not registered by `main.ts`.

**Alternatives considered**:
- Keep separate views (fragmented UX, multiple ribbon icons needed)
- Tabbed view with one tab per module (added complexity)
- Modal-only workflow without sidebar (less persistent, harder to browse)

**Rationale**: A single sidebar reduces cognitive overhead -- users have one place to check for pending proposals. The `UnifiedItem` discriminated union keeps the data model clean. Color-coded cards (blue for elaboration, green for enrichment, orange for organize, purple for deep-dive) provide visual distinction without separate views.

**Impact**: One ribbon icon (sparkles) opens all proposals. Legacy views are dead code but preserved for reference. The view is refreshed via callbacks from all four proposal-generating modules through `main.refreshUnifiedView()`.

---

## 2026-03-13: Replace modals with inline review panes and clickable note links

**Context**: The initial proposal review flow used Obsidian `Modal` dialogs for viewing proposal details. Modals blocked interaction with the rest of the app and couldn't link back to source notes.

**Decision**: Replace modals with inline review panes within the unified sidebar view. Proposal headings are clickable links that open the source note in the main editor pane.

**Alternatives considered**:
- Keep modals (blocking, can't reference source note simultaneously)
- Open proposals in a new pane (too many panes)

**Rationale**: Inline review lets users see the proposal and the source note side by side. Clickable note links provide immediate navigation context. The sidebar persists while users navigate between notes.

**Impact**: Review workflow is non-blocking. Users can read the source note while deciding on a proposal.

---

## 2026-03-13: Centralized notification system with cancellation and two-phase vault scan

**Context**: Feature modules used ad-hoc `new Notice()` calls for progress reporting. Long-running operations (vault scans, batch transcriptions) had no cancellation mechanism, and there was no way to show progress or prevent duplicate operations.

**Decision**: Create `NotificationManager` in `src/shared/` providing:
- Tracked operations with animated status, progress counters, and cancel buttons
- Non-dismissible notices for running operations
- Confirmation snackbars (Proceed/Cancel) returning `Promise<boolean>`
- Status bar integration showing active operation count
- CSS injection for styled notices

Vault scanning uses a two-phase approach: Phase 1 scans without API calls, Phase 2 asks for confirmation before generating proposals (which costs API credits).

**Alternatives considered**:
- Per-module notification logic (duplicated, inconsistent)
- Obsidian's built-in `Notice` only (no cancellation, no progress, auto-dismisses)
- Custom status bar only without notices (not attention-getting enough)

**Rationale**: Centralized notifications ensure consistent UX across all modules. Cancellation is critical for operations that make paid API calls. The two-phase vault scan prevents accidental credit consumption when a scan finds many stub notes. All modules receive `NotificationManager` via constructor injection.

**Impact**: All modules use `NotificationManager` for user communication. Operations are cancellable via `handle.cancelled`. The confirmation snackbar gates expensive operations.

---

## 2026-03-13: Enrichment module with proximity-weighted tag scoring

**Context**: After notes are elaborated or transcribed, they lack connections to the rest of the vault -- no tags, no links to related notes, no external references.

**Decision**: Add an enrichment module that analyzes vault structure to suggest tags, internal links, external references, and frontmatter attributes. Tag scoring uses a proximity-weighted algorithm: candidate tags are scored by how often they appear in nearby notes (same folder > sibling > cousin > distant), combined with vault-wide frequency. Internal links are resolved from graph hops, shared tags, and folder proximity.

**Alternatives considered**:
- AI-only suggestions without vault context (ignores existing vault structure)
- Simple frequency-based tagging (doesn't account for note relationships)
- Manual tagging reminders (no automation)

**Rationale**: Proximity weighting produces tags that are contextually relevant to where the note lives in the vault hierarchy, not just globally popular tags. The pure function `computeProximityWeight()` is testable and configurable via six weight parameters. Combining AI suggestions with vault analysis produces better results than either alone.

**Impact**: Notes gain contextual tags and connections automatically. The enrichment runs after elaboration acceptance or transcription completion (when `autoEnrich` is enabled), or manually via command.

---

## 2026-03-13: Cross-module callbacks wired in main.ts

**Context**: When an elaboration proposal is accepted or a transcription completes, the resulting note should be enriched automatically. Modules need to communicate completion events without direct dependencies on each other.

**Decision**: Wire callbacks in `main.ts` using simple function assignments:
- `elaboration.onProposalAccepted(filePath)` -> `enrichment.enrich(filePath, 'elaboration')`
- `audio.onTranscriptionComplete(filePath)` -> `enrichment.enrich(filePath, 'transcription')`
- `video.onTranscriptionComplete(filePath)` -> `enrichment.enrich(filePath, 'transcription')`
- `summarize.onSummaryComplete(filePath)` -> `enrichment.enrich(filePath, 'summarization')`
- `deepDive.onNoteAccepted(filePath)` -> `enrichment.enrich(filePath, 'deep-dive')`
- `deepDive.onOrganizeRequested(file)` -> `organize.organizeNote(file)`
- `*.onViewRefreshNeeded()` -> `main.refreshUnifiedView()`

Callbacks are only wired when the relevant modules and settings are enabled.

**Alternatives considered**:
- Event bus / pub-sub pattern (over-engineered for <10 connections)
- Direct module imports (creates circular dependencies)
- Obsidian events on the workspace (global, hard to type-check)

**Rationale**: Simple callback assignment in the orchestrator (`main.ts`) is explicit and easy to trace. Each module declares nullable callback properties; `main.ts` assigns them. No event system overhead, no subscription management, no circular dependencies.

**Impact**: Enrichment runs automatically after elaboration, transcription, summarization, and deep-dive acceptance. Organize runs after deep-dive acceptance when enabled. View refresh is centralized. Adding new cross-module connections requires editing `main.ts`.

---

## 2026-03-13: Removed output folder settings from audio and video

**Context**: Audio and video modules originally had `outputFolder` settings specifying where transcription notes would be saved. These were redundant -- transcriptions are inserted inline into the current note (audio) or saved alongside video metadata (video).

**Decision**: Remove `audio.outputFolder` and `video.outputFolder` settings. Video retains `downloadFolder` (for saving video files to vault) and `embedInNote` (for embedding video file links in notes).

**Alternatives considered**:
- Keep output folders as optional settings (unused code, confusing settings)
- Add output folder support later if needed (YAGNI)

**Rationale**: Both modules insert content inline into existing notes rather than creating new files in an output folder. Keeping unused settings confuses users and adds maintenance burden.

**Impact**: Settings schema is simpler. Video `downloadFolder` and `embedInNote` remain for the video file download feature.

---

## 2026-03-13: AI response sanitization strategy

**Context**: AI providers (OpenAI, Anthropic, Ollama) return text that gets written directly into vault notes. Obsidian renders markdown, which means certain HTML constructs and URI schemes could execute code if injected.

**Decision**: `sanitizeAIResponse()` strips: `<script>` tags with content, HTML event handlers (`onclick`, `onerror`, etc.), dangerous URI schemes (`javascript:`, `data:`, `vbscript:`), and embedding tags (`<iframe>`, `<embed>`, `<object>`). Applied to all AI output before vault writes. The tidy module additionally strips code fences that AI sometimes wraps responses in.

**Alternatives considered**:
- Full HTML sanitizer library (adds runtime dependency, over-engineered for markdown context)
- No sanitization, trust AI providers (risky -- prompt injection is a real threat)
- Escape all HTML (breaks legitimate markdown rendering)

**Rationale**: Targeted stripping removes known dangerous patterns while preserving legitimate markdown and inline HTML that Obsidian renders safely. Defense-in-depth: even if AI output contains injected content, sanitization prevents execution. The pattern is applied consistently via a single shared function.

**Impact**: All AI-generated content is safe to render in Obsidian. Legitimate markdown formatting is preserved.

---

## 2026-03-13: Enrichment uses marker comments for idempotent updates

**Context**: Enrichment adds "Related Notes" and "References" sections to notes. If enrichment runs again on the same note (e.g., after re-elaboration), it needs to update these sections rather than duplicating them.

**Decision**: Wrap enrichment-added sections with HTML comment markers: `%% synapse-enrichment-start %%` and `%% synapse-enrichment-end %%`. On subsequent enrichments, content between markers is replaced. Undo removes everything between markers.

**Alternatives considered**:
- Heading-based detection only (fragile -- user might have a heading with the same name)
- Frontmatter flags (doesn't help with body content sections)
- Append-only without updates (causes duplication)

**Rationale**: Obsidian comment syntax (`%% ... %%`) is invisible in reading view but preserved in source. Markers provide reliable boundaries for idempotent section updates without depending on heading text matching.

**Impact**: Enrichment can safely re-run on the same note. Users don't see the markers in reading view. Undo cleanly removes only enrichment-added content.

---

## 2026-03-13: Frontmatter key validation with allowlist pattern and forbidden keys

**Context**: Enrichment suggests frontmatter attributes via AI. Without validation, AI could suggest keys that cause prototype pollution (`__proto__`, `constructor`) or overwrite Obsidian-reserved keys.

**Decision**: Validate frontmatter keys against pattern `^[a-z][a-z0-9_-]{0,49}$` and block a forbidden keys list (`__proto__`, `constructor`, `prototype`, etc.). Never overwrite existing frontmatter keys -- only add new ones.

**Alternatives considered**:
- No validation (prototype pollution risk)
- Strict allowlist of specific keys (too restrictive, can't adapt to vault conventions)
- Overwrite existing keys if AI suggests better values (data loss risk)

**Rationale**: The regex pattern is permissive enough for any reasonable frontmatter key while blocking injection vectors. The forbidden keys list catches the most dangerous prototype pollution keys. Never overwriting existing keys preserves user data.

**Impact**: AI-suggested frontmatter is safe to apply. Users keep their existing frontmatter values intact.

---

## 2026-03-12: TDD infrastructure with Vitest

**Context**: The project had no test framework despite having testable pure functions (URL detection, input validation) and injectable dependencies (AIClient, Transcriber). The codebase was growing and needed automated regression coverage.

**Decision**: Adopt Vitest 4.x as the test framework with the following infrastructure:
- `vitest.config.ts` at project root with globals enabled, node environment, and `src/**/*.test.ts` include pattern
- Centralized Obsidian mock at `src/__mocks__/obsidian.ts` with real class implementations for `TFile` and `TFolder` (so `instanceof` checks work in tests) and stubs for UI classes (`Modal`, `Plugin`, `Setting`, etc.)
- Setup file at `src/__test-utils__/setup.ts` that calls `vi.mock('obsidian')` globally
- Mock factories at `src/__test-utils__/mock-factories.ts` providing `mockFile()`, `createMockApp()`, `createMockPlugin()`, and `makeSettings()` helpers
- Test files co-located with source as `<name>.test.ts`
- Three npm scripts: `test` (single run), `test:watch`, `test:coverage`

**Alternatives considered**:
- Jest (heavier, slower startup, more configuration required for ESM/TypeScript)
- No tests, rely on manual QA (unsustainable as features grow)
- End-to-end tests with real Obsidian (fragile, slow, hard to automate)

**Rationale**: Vitest is fast, has native TypeScript and ESM support, and integrates well with the esbuild-based build pipeline. The centralized Obsidian mock means every test file automatically gets stubs for all Obsidian APIs without per-file setup. Real `TFile`/`TFolder` class implementations (instead of plain objects) ensure `instanceof` checks in production code work correctly in tests.

**Impact**: Tests can be run with `npm test`. The TDD skill (`/tdd`) guides the Red-Green-Refactor workflow for new features.

---

## 2026-03-12: Security hardening -- defense-in-depth approach

**Context**: A security audit reviewed the plugin for input validation gaps, output sanitization, credential handling, and subprocess security.

**Decision**: Implement a comprehensive security layer:
- `shared/validation.ts` with `sanitizeUrl()`, `sanitizePath()`, `ensureWithinVault()`, `sanitizeAIResponse()`
- `execFile` over `exec` for all subprocess calls (no shell invocation)
- `safeRequest()` wrapper for `requestUrl` with error body extraction and key redaction
- Password masking on all API key input fields
- Ollama endpoint protocol validation (HTTPS required, HTTP only for localhost)
- API key redaction in error messages
- 5-minute timeouts and 10MB buffer limits on all external calls
- Frontmatter key validation against allowlist + forbidden keys

**Alternatives considered**:
- Minimal hardening (validate only user-visible inputs)
- Third-party security libraries (adds runtime dependencies, violates zero-deps policy)
- No output sanitization (assumes AI providers return safe content)

**Rationale**: Defense-in-depth: multiple independent layers ensure a bypass in one layer does not compromise the system. Centralized in `shared/validation.ts` for easy auditing.

**Impact**: All external interactions are validated and sanitized. No user-facing behavior changes except masked API key fields and more descriptive error messages.

---

## 2026-03-12: VideoModule delegates transcription to AudioModule

**Context**: Video transcription requires downloading a video, extracting audio, and then transcribing it -- the same pipeline AudioModule already provides.

**Decision**: VideoModule accepts AudioModule as a constructor argument and calls `AudioModule.transcribe()` for the transcription step.

**Alternatives considered**:
- Duplicate transcription logic in VideoModule
- Create a shared transcription service extracted from both modules

**Rationale**: Keeps transcription logic in one place. The dependency is one-directional (Video -> Audio). Audio must be initialized before Video in `main.ts`.

**Impact**: Audio and Video modules are not fully independent. Audio must always be loaded if Video is enabled.

---

## 2026-03-12: Non-destructive proposal storage in `.synapse/`

**Context**: AI-generated elaborations and enrichments should never modify a user's notes without explicit consent. Proposals need to survive plugin reloads and Obsidian restarts.

**Decision**: Store proposals as JSON files in `.synapse/` with subdirectories per module:
- `.synapse/proposals/` -- elaboration proposals
- `.synapse/enrichments/` -- enrichment proposals
- `.synapse/tidy-snapshots/` -- tidy undo snapshots
- `.synapse/organize/proposals/` and `.synapse/organize/snapshots/` -- organize data
- `.synapse/deep-dive/` -- deep-dive proposals and `runs/` subdirectory

Each proposal is a separate file with metadata and proposed content.

**Alternatives considered**:
- In-memory only (lost on reload)
- Single database file (merge conflicts, corruption risk)
- Frontmatter annotations on original notes (modifies user files)

**Rationale**: JSON files are human-inspectable, diffable, and survive reloads. Individual files avoid corruption cascading across proposals. The `.synapse/` folder is excluded from all module scans by default.

**Impact**: Vault contains a `.synapse/` folder with module-specific subdirectories. Users can inspect, back up, or delete proposal/snapshot files manually.

---

## 2026-03-12: Modular architecture with FeatureModule contract

**Context**: The plugin has multiple distinct features that share infrastructure but are otherwise independent.

**Decision**: Each feature is a self-contained module following a common contract: `constructor(plugin, getSettings, notifications)`, `onload()`, `onunload()`. Modules are conditionally loaded based on settings. A shared utilities layer (`src/shared/`) provides cross-cutting concerns.

**Alternatives considered**:
- Monolithic single-file plugin
- Separate plugins per feature
- Event-bus architecture with loose coupling

**Rationale**: The module pattern balances isolation with simplicity. Features can be independently enabled/disabled. The `getSettings()` closure ensures modules always read fresh settings without event wiring.

**Impact**: Adding a new feature means creating a new module directory and wiring it in `main.ts`. Eight modules currently follow this pattern: elaboration, audio, video, enrichment, summarize, tidy, organize, deep-dive.

---

## 2026-03-12: Zero runtime npm dependencies

**Context**: Obsidian community plugins are reviewed for security and bundle size. Runtime dependencies increase both risk and review burden.

**Decision**: Zero runtime npm dependencies. All external API calls use Obsidian's `requestUrl` or native `fetch`. External tools (yt-dlp, ffmpeg) are invoked as subprocesses.

**Alternatives considered**:
- Use SDK packages for OpenAI, Anthropic, Deepgram
- Bundle a minimal HTTP client library

**Rationale**: Keeps the bundle small and avoids supply chain risk. API calls are simple enough to implement directly.

**Impact**: API integration code is hand-rolled but the plugin has no transitive dependency risk.

---

## 2026-03-12: Provider-specific model dropdowns

**Context**: The original model setting was a free-text input where users typed model identifiers. Typos caused silent API failures.

**Decision**: Replace free-text with dropdowns populated from `MODEL_OPTIONS`, keyed by provider. Anthropic uses simplified names mapped to full API IDs by `resolveModelId()`.

**Alternatives considered**:
- Free-text with validation (still requires users to know model IDs)
- Fetching available models from API at runtime (requires valid API key first)

**Rationale**: Eliminates typo risk and shows only relevant models per provider.

**Impact**: Users pick from curated lists. Adding a model requires updating `MODEL_OPTIONS` in `settings.ts`.

---

## 2026-03-12: `isDesktopOnly: true` in manifest

**Context**: The plugin uses `child_process` for yt-dlp/ffmpeg execution -- Node.js APIs unavailable on mobile.

**Decision**: Mark the plugin as desktop-only in `manifest.json`.

**Alternatives considered**:
- Graceful degradation (disable video features on mobile)
- API-based video processing service

**Rationale**: Core video functionality depends on local CLI tools. Desktop-only is clearly communicated.

**Impact**: Plugin will not appear in Obsidian's mobile plugin browser.

---

## 2026-03-12: Whisper API as default transcription provider with key fallback

**Context**: Audio transcription needs a reliable backend. Users may use Anthropic or Ollama as their AI provider, meaning their shared API key isn't an OpenAI key.

**Decision**: Default to OpenAI Whisper API. Add dedicated `audio.whisperApiKey` with fallback: `whisperApiKey || ai.apiKey`. The settings UI conditionally shows the Whisper key field only when needed.

**Alternatives considered**:
- Always require a separate Whisper key (redundant for OpenAI users)
- Require OpenAI as AI provider to use Whisper (unnecessarily restrictive)

**Rationale**: Zero extra configuration for OpenAI users; clear prompt for others. Conditional UI keeps settings clean.

**Impact**: Anthropic/Ollama users who want Whisper see an additional key field. OpenAI users see no change.

---

## 2026-03-12: yt-dlp for URL-based media fetching with PATH resolution

**Context**: Video transcription needs to download from YouTube/TikTok. Obsidian runs in Electron with a minimal PATH.

**Decision**: Use yt-dlp (external CLI) via `execFile`. A `shellEnv()` function prepends `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin` to PATH for subprocess calls. Use `os.tmpdir()` for temp files instead of vault-relative paths.

**Alternatives considered**:
- Require absolute paths in settings (poor UX)
- Use `shell: true` for PATH inheritance (reintroduces injection risk)

**Rationale**: Covers most installations automatically while preserving `execFile` security.

**Impact**: yt-dlp/ffmpeg found automatically on most systems. Users can verify via the dependency check command.
