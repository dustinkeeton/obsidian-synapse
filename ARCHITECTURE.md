# Architecture Overview

Auto Notes is an Obsidian plugin that provides five AI-powered features: note elaboration, audio transcription, video transcription, note enrichment, and note tidying. Desktop only (requires Node.js APIs for video processing).

---

## System Diagram

```mermaid
graph TD
    subgraph Obsidian Desktop
        Main[main.ts<br>AutoNotesPlugin]
        Settings[Settings + Settings Tab]
        UV[Unified Proposal View<br>src/views/]

        Elab[Elaboration Module]
        Audio[Audio Module]
        Video[Video Module]
        Enrich[Enrichment Module]
        Tidy[Tidy Module]

        Shared[Shared Layer<br>AIClient, Validation,<br>Notifications, File Utils]
    end

    subgraph External
        OpenAI[OpenAI API<br>GPT + Whisper]
        Anthropic[Anthropic API<br>Claude]
        Ollama[Ollama<br>Local models]
        YtDlp[yt-dlp CLI]
        FFmpeg[ffmpeg CLI]
        Deepgram[Deepgram API]
    end

    subgraph Vault Storage
        Proposals[.auto-notes/proposals/]
        Enrichments[.auto-notes/enrichments/]
        Snapshots[.auto-notes/tidy-snapshots/]
        Media[Media/]
    end

    Main --> Settings
    Main --> UV
    Main --> Elab
    Main --> Audio
    Main --> Video
    Main --> Enrich
    Main --> Tidy

    Elab --> Shared
    Audio --> Shared
    Video --> Shared
    Enrich --> Shared
    Tidy --> Shared

    Video -->|delegates transcription| Audio

    Shared --> OpenAI
    Shared --> Anthropic
    Shared --> Ollama
    Audio --> Deepgram

    Video --> YtDlp
    Video --> FFmpeg

    Elab -->|proposals| Proposals
    Enrich -->|proposals| Enrichments
    Tidy -->|snapshots| Snapshots
    Video -->|video files| Media

    Elab -.->|onProposalAccepted| Enrich
    Audio -.->|onTranscriptionComplete| Enrich
    Video -.->|onTranscriptionComplete| Enrich
    Elab -.->|onViewRefreshNeeded| UV
    Enrich -.->|onViewRefreshNeeded| UV
```

---

## Module Responsibilities

| Module | What It Does | Key Files |
|--------|-------------|-----------|
| **main.ts** | Plugin entry point. Loads settings, initializes modules, registers views/commands/ribbons, wires cross-module callbacks | `src/main.ts` |
| **Elaboration** | Detects stub/placeholder notes, generates AI-powered content proposals, manages proposal lifecycle | `src/elaboration/` |
| **Audio** | Transcribes audio files via Whisper/Deepgram APIs, with optional AI post-processing | `src/audio/` |
| **Video** | Downloads video from YouTube/TikTok via yt-dlp, extracts audio, delegates to Audio for transcription | `src/video/` |
| **Enrichment** | Suggests tags, internal links, external references, and frontmatter based on vault analysis + AI | `src/enrichment/` |
| **Tidy** | Fixes spelling and formats markdown via AI. No content changes — cosmetic only | `src/tidy/` |
| **Views** | Unified sidebar combining elaboration + enrichment proposals in one pane | `src/views/` |
| **Shared** | AI client (3 providers), validation/sanitization, notifications, file utilities, frontmatter parsing | `src/shared/` |
| **Settings** | Type definitions, defaults, model options for all modules | `src/settings.ts`, `src/settings-tab.ts` |

---

## Data Flow

### Elaboration: Detect → Propose → Review → Apply

```
Vault scan or single note scan
    ↓
PlaceholderDetector checks: word count, TODO markers, empty sections, sparse links
    ↓
Candidates confirmed via NotificationManager (two-phase for vault scans)
    ↓
ProposalGenerator gathers linked note context → AIClient.complete()
    ↓
sanitizeAIResponse() on AI output
    ↓
Proposal saved as JSON in .auto-notes/proposals/
    ↓
User reviews in Unified Proposal View (editable textarea)
    ↓
Accept: blockquote original content, append sanitized AI additions
Reject: mark status as rejected
    ↓
If accepted + autoEnrich enabled → enrichment.enrich(filePath)
```

### Audio Transcription: Record → Transcribe → Post-Process → Insert

```
User selects audio file (modal) or triggers inline transcription
    ↓
Audio data sent to Whisper API / Deepgram (via fetch with AbortController timeout)
    ↓
Optional: PostProcessor cleans transcript via AIClient
    ↓
Result inserted as blockquote below audio embed (inline) or as new note (standalone)
    ↓
If autoEnrich enabled → enrichment.enrich(filePath)
```

### Video Transcription: URL → Download → Extract → Transcribe

```
User pastes URL → sanitizeUrl() → detectPlatform()
    ↓
AudioExtractor: yt-dlp --dump-json (metadata), yt-dlp -x (audio download)
    ↓
Optional: download video file to vault (downloadFolder setting)
    ↓
AudioModule.transcribe(audioBuffer) — same pipeline as audio
    ↓
Insert blockquote + optional video embed in note
    ↓
Cleanup temp audio file from os.tmpdir()
    ↓
If autoEnrich enabled → enrichment.enrich(filePath)
```

### Enrichment: Analyze → Score → Propose → Apply

```
Triggered by callback (auto-enrich) or manual command
    ↓
VaultAnalyzer builds tag index + link graph from MetadataCache
    ↓
Parallel scoring:
  TagScorer: AI candidates × vault frequency × proximity weight
  LinkResolver: graph hops + shared tags + folder proximity
  PromptBuilder: AI-suggested external links + frontmatter
    ↓
Proposal saved as JSON in .auto-notes/enrichments/
    ↓
User reviews in Unified Proposal View (per-item checkboxes)
    ↓
Accept Selected: EnrichmentApplier merges tags, adds sections with markers
Reject: mark status as rejected
```

### Tidy: Snapshot → AI Fix → Apply (immediate)

```
User triggers tidy command on current note
    ↓
TidyStore saves snapshot of original content (for undo)
    ↓
parseFrontmatter() separates frontmatter from body
    ↓
AIClient.complete() with constrained prompt (spelling + formatting only)
    ↓
sanitizeAIResponse() + stripCodeFences()
    ↓
serializeFrontmatter(original_frontmatter, tidied_body) → vault.modify()
    ↓
Undo: TidyStore.load() → vault.modify(original) → TidyStore.remove()
```

---

## Cross-Module Communication

All inter-module communication flows through `main.ts` via simple callback assignments:

```
┌─────────────┐     onProposalAccepted(path)     ┌─────────────┐
│ Elaboration │ ─────────────────────────────────→│ Enrichment  │
└─────────────┘                                   └─────────────┘
                                                        ↑
┌─────────────┐     onTranscriptionComplete(path)       │
│   Audio     │ ────────────────────────────────────────┘
└─────────────┘                                         ↑
                                                        │
┌─────────────┐     onTranscriptionComplete(path)       │
│   Video     │ ────────────────────────────────────────┘
└─────────────┘

┌─────────────┐     onViewRefreshNeeded()         ┌─────────────┐
│ Elaboration │ ─────────────────────────────────→│  Unified    │
│ Enrichment  │ ─────────────────────────────────→│  View       │
└─────────────┘                                   └─────────────┘
```

Callbacks are only wired when `enrichment.enabled && enrichment.autoEnrich` is true. Modules declare nullable callback properties; `main.ts` assigns them during initialization. No event bus or pub-sub needed.

---

## Settings Hierarchy

Settings are organized into six groups, each mapping to a module:

```
AutoNotesSettings
├── ai          → Provider, API key, model, temperature
├── elaboration → Detection thresholds, scan behavior, proposal storage
│   ├── detection → Word threshold, TODO markers, empty sections, excludes
│   └── proposal  → Max per note, preserve frontmatter, include context
├── audio       → Transcription provider, API keys, post-processing
│   └── postProcessing → Filler removal, structure, key points, custom prompt
├── video       → yt-dlp/ffmpeg paths, download folder, embed setting
│   └── frameExtraction → (Not implemented) interval, vision model, max frames
├── enrichment  → Auto-enrich, max tags/links, proximity weights, excludes
│   └── weights → Same/sibling/cousin/distant folder weights, decay, minimum
└── tidy        → Snapshot folder path
```

Modules access settings via a `getSettings()` closure injected at construction time, ensuring they always read the latest values without event subscriptions.

---

## Proposal Lifecycle

Elaboration and enrichment both use a proposal-based workflow. Tidy does not.

```
                    ┌──────────┐
                    │ Generated│
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ Pending  │ ← stored as JSON in .auto-notes/
                    └────┬─────┘
                         │
              ┌──────────┴──────────┐
              │                     │
        ┌─────▼─────┐        ┌─────▼─────┐
        │ Accepted  │        │ Rejected  │
        └─────┬─────┘        └───────────┘
              │
              │ (enrichment only)
        ┌─────▼──────────┐
        │ Partially      │
        │ Accepted       │
        └────────────────┘
```

- **Elaboration proposals**: Accept applies full content (user can edit in textarea first). Original note content is blockquoted for preservation.
- **Enrichment proposals**: Accept Selected allows cherry-picking individual tags, links, refs, and frontmatter items. Sections are wrapped in `%% auto-notes-enrichment-start/end %%` markers for idempotent updates.
- **Tidy**: Immediate apply, undo via stored snapshot. No proposal UI.

---

## Getting Started for Contributors

1. Clone into Obsidian vault's plugin directory (see Development Setup in existing docs)
2. `npm install` → `npm run dev` (watch mode)
3. Module pattern: each feature in `src/<module>/` with `index.ts` exporting the module class
4. Follow the FeatureModule contract: `constructor(plugin, getSettings, notifications)`, `onload()`, `onunload()`
5. Types go in `<module>/types.ts`, tests co-located as `<name>.test.ts`
6. All shared utilities imported from `../shared` (barrel export)
7. Build check: `npm run build` (type-checks + bundles)
8. Tests: `npm test`
