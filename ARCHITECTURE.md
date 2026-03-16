# Architecture Overview

Auto Notes is an Obsidian plugin that provides eight AI-powered features: note elaboration, audio transcription, video transcription, note enrichment, summarization, note tidying, semantic organization, and recursive deep-dive note generation. Desktop only (requires Node.js APIs for video processing).

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Obsidian Desktop                             │
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────────┐   │
│  │ Settings │◄───│   main.ts    │───►│   Unified Proposal View  │   │
│  │ + Tab    │    │ AutoNotes    │    │   (sidebar)              │   │
│  └──────────┘    │ Plugin       │    │                          │   │
│                  └──────┬───────┘    │  ┌────┐ ┌────┐ ┌────┐   │   │
│                         │            │  │Elab│ │Enr │ │Org │   │   │
│           ┌─────────────┼──────┐     │  │blue│ │grn │ │org │   │   │
│           │             │      │     │  └────┘ └────┘ └────┘   │   │
│           ▼             ▼      ▼     │  ┌─────────┐            │   │
│  ┌────────────┐  ┌──────────┐  ...   │  │Deep Dive│            │   │
│  │Elaboration │  │  Audio   │        │  │ purple  │            │   │
│  │            │  │          │        │  └─────────┘            │   │
│  │ Detector   │  │Transcrib.│        └──────────────────────────┘   │
│  │ Proposer   │  │Post-Proc │                                       │
│  │ Store      │  │ Modal    │                                       │
│  └─────┬──────┘  └────┬─────┘                                      │
│        │               │                                             │
│        │   ┌───────────┼──────────────────────────────┐             │
│        │   │           │                              │             │
│        ▼   ▼           ▼                              ▼             │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │                    Shared Layer                           │       │
│  │  AIClient · NotificationManager · Validation · File Utils│       │
│  │  Frontmatter · API Utils                                 │       │
│  └────────┬──────────────────────┬──────────────────────────┘       │
│           │                      │                                   │
└───────────┼──────────────────────┼───────────────────────────────────┘
            │                      │
            ▼                      ▼
  ┌──────────────────┐   ┌──────────────────┐
  │  AI Providers    │   │  External Tools  │
  │  · OpenAI API    │   │  · yt-dlp        │
  │  · Anthropic API │   │  · ffmpeg        │
  │  · Ollama (local)│   └──────────────────┘
  │  · Deepgram API  │
  └──────────────────┘
```

---

## Module Map

```
src/
├── main.ts                 # Plugin entry, module orchestration, callback wiring
├── settings.ts             # Type definitions, defaults, model options
├── settings-tab.ts         # Obsidian settings UI
│
├── elaboration/            # Stub note detection + AI content proposals
│   ├── detector.ts         #   PlaceholderDetector (short notes, TODOs, empty sections)
│   ├── proposer.ts         #   ProposalGenerator (context gathering + AI generation)
│   ├── proposal-store.ts   #   JSON file persistence
│   └── index.ts            #   ElaborationModule orchestrator
│
├── audio/                  # Audio transcription
│   ├── transcriber.ts      #   Whisper API / Deepgram / local routing
│   ├── post-processor.ts   #   AI transcript cleanup
│   └── index.ts            #   AudioModule orchestrator
│
├── video/                  # Video download + transcription
│   ├── url-detector.ts     #   YouTube/TikTok URL parsing
│   ├── audio-extractor.ts  #   yt-dlp + ffmpeg via execFile
│   ├── note-scanner.ts     #   Find video URLs in note content
│   └── index.ts            #   VideoModule orchestrator (delegates to Audio)
│
├── enrichment/             # Tags, links, refs, frontmatter
│   ├── metadata-classifier.ts  # AI tag classification against vocabulary
│   ├── topic-extractor.ts      # AI topic extraction -> link candidates
│   ├── link-resolver.ts        # Graph-based link resolution + merge
│   ├── vault-analyzer.ts       # Cached vault tag index + link graph
│   ├── weight-calculator.ts    # Proximity weight scoring (pure function)
│   ├── prompt-builder.ts       # External links + frontmatter suggestions
│   ├── enrichment-applier.ts   # Apply/undo enrichments with markers
│   ├── enrichment-store.ts     # JSON file persistence
│   └── index.ts                # EnrichmentModule orchestrator
│
├── summarize/              # URL + transcription summarization
│   ├── summarizer.ts       #   AI summarization (bullets/paragraph/key-points)
│   ├── content-fetcher.ts  #   HTTP fetch + HTML-to-text extraction
│   ├── note-scanner.ts     #   Find summarizable targets in notes
│   └── index.ts            #   SummarizeModule orchestrator
│
├── tidy/                   # Spelling + formatting correction
│   ├── tidy-store.ts       #   Snapshot storage for undo
│   └── index.ts            #   TidyModule orchestrator
│
├── organize/               # AI-powered directory structuring
│   ├── content-analyzer.ts #   AI topic extraction for organization
│   ├── directory-matcher.ts#   Match topics to directories
│   ├── organize-store.ts   #   Proposal + snapshot persistence
│   └── index.ts            #   OrganizeModule orchestrator
│
├── deep-dive/              # Recursive topic exploration
│   ├── topic-analyzer.ts   #   AI topic extraction from note content
│   ├── note-generator.ts   #   AI content generation for topics
│   ├── quality-scorer.ts   #   Local heuristic quality scoring
│   ├── deep-dive-store.ts  #   Proposal + run persistence
│   └── index.ts            #   DeepDiveModule orchestrator
│
├── shared/                 # Cross-cutting utilities
│   ├── ai-client.ts        #   Multi-provider AI (OpenAI, Anthropic, Ollama)
│   ├── notifications.ts    #   Centralized notification system
│   ├── validation.ts       #   URL, path, AI response sanitization
│   ├── file-utils.ts       #   Vault file operations
│   ├── frontmatter-utils.ts#   YAML frontmatter parsing/serialization
│   ├── api-utils.ts        #   Retry logic, error handling
│   └── index.ts            #   Barrel export
│
└── views/                  # UI components
    └── unified-proposal-view.ts  # Single sidebar for all proposal types
```

---

## Plugin Lifecycle

```
onload()
  │
  ├── loadSettings()          # Deep-merge saved data with defaults
  ├── addSettingTab()          # Register settings UI
  ├── NotificationManager()   # Create shared notification system
  │
  ├── Initialize 8 modules    # Audio before Video (Video depends on Audio)
  │   ElaborationModule, AudioModule, VideoModule, EnrichmentModule,
  │   SummarizeModule, TidyModule, OrganizeModule, DeepDiveModule
  │
  ├── registerView()          # UnifiedProposalView (sidebar)
  ├── Wire refresh callbacks   # All 4 proposal modules -> refreshUnifiedView()
  │
  ├── Conditional module.onload()  # Only if module.enabled in settings
  │
  ├── Wire enrichment callbacks    # Only if enrichment.enabled && autoEnrich
  │   elaboration -> enrichment (on accept)
  │   audio -> enrichment (on transcription)
  │   video -> enrichment (on transcription)
  │   summarize -> enrichment (on summary)
  │   deep-dive -> enrichment (on accept, if autoEnrichOnAccept)
  │
  ├── Wire organize callback       # Only if deepDive.autoOrganizeOnAccept
  │   deep-dive -> organize (on accept)
  │
  ├── addRibbonIcon()          # sparkles (proposals), mic (audio)
  └── addCommand()             # review-proposals

onunload()
  └── module.onunload() for all 8 modules
```

---

## Cross-Module Communication

All inter-module communication flows through `main.ts` via nullable callback assignments. No event bus, no pub-sub.

```
Enrichment triggers (when autoEnrich enabled):

  Elaboration ──onProposalAccepted(path)──────► Enrichment.enrich(path, 'elaboration')
  Audio ────────onTranscriptionComplete(path)──► Enrichment.enrich(path, 'transcription')
  Video ────────onTranscriptionComplete(path)──► Enrichment.enrich(path, 'transcription')
  Summarize ────onSummaryComplete(path)────────► Enrichment.enrich(path, 'summarization')
  Deep Dive ────onNoteAccepted(path)───────────► Enrichment.enrich(path, 'deep-dive')

Organize triggers (when autoOrganizeOnAccept enabled):

  Deep Dive ────onOrganizeRequested(file)──────► Organize.organizeNote(file)

View refresh (always wired):

  Elaboration ──┐
  Enrichment  ──┤── onViewRefreshNeeded() ─────► main.refreshUnifiedView()
  Organize    ──┤
  Deep Dive   ──┘
```

---

## Proposal System Architecture

Four modules generate proposals that appear in the unified sidebar. Each has a different review workflow:

| Module | Proposal Type | Review UX | Accept Behavior |
|--------|--------------|-----------|-----------------|
| Elaboration | Content additions | Editable textarea | Blockquote original, append additions |
| Enrichment | Tags, links, refs, frontmatter | Per-item checkboxes | Cherry-pick items, apply with markers |
| Organize | New directory suggestion | Directory path + AI reasoning | Create directory, move file |
| Deep Dive | Generated child note | Read-only content preview | Create note at proposed path |

### Proposal States

```
 Generated ──► Pending ──┬──► Accepted
                         ├──► Rejected
                         └──► Partially Accepted (enrichment only)
```

Tidy and Summarize do NOT use proposals -- they apply changes immediately (tidy has undo via snapshots).

### Deep Dive: Cascade Rejection

Deep-dive proposals form a tree. Rejecting a parent cascades to all children:

```
Root Note
  ├── Topic A (rejected)
  │   ├── Subtopic A1 (auto-rejected)
  │   └── Subtopic A2 (auto-rejected)
  └── Topic B (pending)
      └── Subtopic B1 (pending)
```

---

## Deep Dive: Recursive Generation

The deep-dive module generates a tree of child notes from a root note using BFS:

```
Phase 1: Extract Topics
  TopicAnalyzer.extractTopics(rootContent) → [Topic A, Topic B, ...]
  Filter: skip topics that already exist in vault

Phase 2: User Confirmation
  "Found N new topics. Generate deep dive?"

Phase 3: BFS Generation Loop
  Queue: [(rootContent, rootTopics, depth=0)]

  While queue not empty and under maxNotesPerRun:
    Pop item from queue
    For each new topic:
      ├── NoteGenerator.generateContent(topic, parentTitle, parentContent)
      ├── TopicAnalyzer.extractTopics(generatedContent)  [if depth+1 < maxDepth]
      ├── scoreQuality({title, childTopics, wordCount, depth, ancestors})
      ├── DeepDiveStore.saveProposal()
      └── If score >= threshold AND depth+1 < maxDepth:
            Queue children for next iteration

Phase 4: Present Results
  All proposals appear in unified sidebar for review
```

### Quality Scoring (Local, No AI)

```
Score = topicCount × 0.3    min(1.0, childTopics / 3)
      + wordCount  × 0.2    min(1.0, words / 200)
      + generic    × 0.2    penalty for "Introduction", "Overview", etc.
      + overlap    × 0.2    penalty for child topics matching ancestors
      + depthDecay × 0.1    linear decay toward max depth

Below qualityThreshold (default 0.4) → stop recursion for this branch
```

---

## Enrichment Architecture

The enrichment module combines AI analysis with vault graph analysis:

```
Note content
    │
    ├──► MetadataClassifier.classify()
    │      AI classifies against user-defined tagVocabulary
    │      Validates: rejects hallucinated tags
    │      Output: tags like #draft, #reference, #meeting-notes
    │
    ├──► TopicExtractor.extractTopics()
    │      AI identifies 5-15 key concepts
    │      Matched topics → [[internal link]] candidates (score: 0.7 + proximity)
    │      Unmatched topics → accumulated for cross-note resolution
    │
    ├──► LinkResolver.findInternalLinks()
    │      Graph hops (1-2 hops in link graph)
    │      Shared tags (2+ tags in common)
    │      Folder proximity (same/sibling folders)
    │      All scored by computeProximityWeight()
    │
    ├──► PromptBuilder.suggestExternalLinks()
    │      AI suggests relevant external URLs
    │
    └──► PromptBuilder.suggestFrontmatter()
           AI suggests metadata with validated keys

    ↓
LinkResolver.mergeTopicCandidates()
    Topic relevance dominates; graph adds small bonus
    Deduplicates, sorts by score
    ↓
EnrichmentProposal → Unified Sidebar → User Review
```

### Vault-Wide Scan (4-Phase)

```
Phase 1: Scan      ─── Collect eligible files, warm caches (cheap)
Phase 2: Confirm   ─── User approval before AI calls (gates cost)
Phase 3: Generate  ─── Per-file enrichment, accumulate unmatched topics
Phase 4: Resolve   ─── Topics with 2+ references → new-note suggestions
```

---

## Storage Layer

All module data is stored as individual JSON files under `.auto-notes/`:

```
.auto-notes/
├── proposals/                    # Elaboration
│   └── {id}.json                 #   Proposal with detection reasons + AI content
├── enrichments/                  # Enrichment
│   └── {id}.json                 #   Tags, links, refs, frontmatter suggestions
├── tidy-snapshots/               # Tidy
│   └── {path-as-filename}.json   #   Original content for undo (one per file)
├── organize/
│   ├── proposals/{id}.json       # New-directory proposals
│   └── snapshots/{id}.json       # Move snapshots for undo
├── deep-dive/
│   ├── {id}.json                 # Individual note proposals
│   └── runs/{id}.json            # Run metadata (stats, depth breakdown)
└── temp/                         # Temporary video/audio (auto-cleaned)
```

Design principles:
- One file per proposal/snapshot (no corruption cascade)
- Human-inspectable JSON (debuggable)
- Survives plugin reloads and Obsidian restarts
- `.auto-notes/` excluded from all module scans by default

---

## AI Integration Pattern

```
┌────────────┐
│  AIClient  │  ← shared/ai-client.ts
└─────┬──────┘
      │
      ├── complete(prompt, systemPrompt?)  ← convenience wrapper
      └── chat(messages[])                  ← core method
           │
           ├── 'openai'    → POST api.openai.com/v1/chat/completions
           │                  Auth: Bearer {ai.apiKey}
           │
           ├── 'anthropic' → POST api.anthropic.com/v1/messages
           │                  Auth: x-api-key {ai.apiKey}
           │                  System message extracted to top-level field
           │                  Model IDs: opus→claude-opus-4-6, sonnet→claude-sonnet-4-6
           │
           └── 'ollama'    → POST {ollamaEndpoint}/api/chat
                              HTTPS required (HTTP for localhost only)

All requests go through safeRequest():
  - Obsidian requestUrl (not fetch)
  - 2-minute timeout
  - Error body extraction
  - API key redaction in error messages
```

Audio transcription uses separate APIs (not AIClient):
- Whisper: OpenAI `/v1/audio/transcriptions` via native `fetch` + `FormData`
- Deepgram: `/v1/listen` via native `fetch`

---

## Settings Hierarchy

```
AutoNotesSettings
├── ai              → Provider, API key, model, temperature, max tokens
├── elaboration     → Detection thresholds, scan behavior, proposal storage
│   ├── detection   → Word threshold, TODO markers, empty sections, excludes
│   └── proposal    → Max per note, preserve frontmatter, include context
├── audio           → Transcription provider, API keys, post-processing
│   └── postProcessing → Filler removal, structure, key points, custom prompt
├── video           → yt-dlp/ffmpeg paths, download folder, embed setting
│   └── frameExtraction → (Not implemented) interval, vision model, max frames
├── enrichment      → Auto-enrich, max tags/links, vocabulary, proximity weights
│   ├── tagVocabulary   → TagVocabularyEntry[] (category, tags, description)
│   └── weights         → Same/sibling/cousin/distant folder, decay, minimum
├── summarize       → Style (bullets/paragraph/key-points), max length, excludes
├── tidy            → Snapshot folder path
├── organize        → Proposal/snapshot folder paths, excludes
└── deepDive        → Max depth, quality threshold, max notes, output folder,
                      auto-enrich on accept, auto-organize on accept, excludes
```

Modules access settings via `getSettings()` closure -- always reads latest values, no event subscriptions needed.

---

## Security Layers

| Layer | Protection | Location |
|-------|-----------|----------|
| Input validation | `sanitizeUrl()`, `sanitizePath()`, `ensureWithinVault()` | `shared/validation.ts` |
| Output sanitization | `sanitizeAIResponse()` strips scripts, event handlers, dangerous URIs | `shared/validation.ts` |
| Subprocess security | `execFile` with argument arrays (no shell) | `video/audio-extractor.ts` |
| API key protection | `redactSecrets()` in error messages, password-masked inputs | `shared/ai-client.ts` |
| Frontmatter safety | Key validation regex + forbidden keys blocklist | `enrichment/enrichment-applier.ts` |
| Network security | Ollama HTTPS required (HTTP for localhost only), 2min timeouts | `shared/ai-client.ts` |
| Idempotent updates | `%% auto-notes-enrichment-start/end %%` markers | `enrichment/enrichment-applier.ts` |

---

## Getting Started for Contributors

1. Clone into Obsidian vault's plugin directory
2. `npm install` then `npm run dev` (watch mode)
3. Module pattern: each feature in `src/<module>/` with `index.ts` exporting the module class
4. Follow the FeatureModule contract: `constructor(plugin, getSettings, notifications)`, `onload()`, `onunload()`
5. Types go in `<module>/types.ts`, tests co-located as `<name>.test.ts`
6. All shared utilities imported from `../shared` (barrel export)
7. Build check: `npm run build` (type-checks + bundles)
8. Tests: `npm test`
9. Git: create a feature branch, push, open PR. See `.claude/skills/git-workflow/SKILL.md` for full protocol.
