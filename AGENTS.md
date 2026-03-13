---
last-updated: 2026-03-12
---

# Auto Notes -- Agent Documentation

Obsidian plugin providing AI-powered note elaboration, audio transcription, and video transcription.

## Module Registry

| Path | Purpose | Public API |
|------|---------|------------|
| `src/main.ts` | Plugin entry point, module orchestration | `AutoNotesPlugin` (default export) |
| `src/settings.ts` | Settings interfaces, defaults, model options | `AutoNotesSettings`, `DEFAULT_SETTINGS`, `AIProvider`, `MODEL_OPTIONS` |
| `src/settings-tab.ts` | Obsidian settings UI | `AutoNotesSettingTab` |
| `src/elaboration/` | Stub note detection and proposal generation | `ElaborationModule`, `PROPOSAL_VIEW_TYPE`, types |
| `src/audio/` | Audio transcription pipeline (file + inline note embeds) | `AudioModule`, `AudioTranscriptionModal`, types |
| `src/video/` | Video download, audio extraction, transcription | `VideoModule`, `detectPlatform`, `isSupportedUrl`, types |
| `src/shared/` | AI client, file utils, API helpers, validation | `AIClient`, `writeNote`, `ensureFolder`, `sanitizeUrl`, `sanitizePath`, `sanitizeAIResponse`, `notifyError`, `withRetry`, `wordCount` |

## Dependency Graph

```
main.ts
├── settings.ts (AutoNotesSettings, DEFAULT_SETTINGS)
├── settings-tab.ts (AutoNotesSettingTab)
├── elaboration/
│   ├── shared/ai-client.ts (AIClient)
│   ├── shared/file-utils.ts (ensureFolder)
│   ├── shared/api-utils.ts (notifyError)
│   └── shared/validation.ts (sanitizeAIResponse)
├── audio/
│   ├── shared/ai-client.ts (AIClient)
│   ├── shared/file-utils.ts (writeNote)
│   ├── shared/api-utils.ts (notifyError)
│   └── shared/validation.ts (sanitizeAIResponse)
└── video/
    ├── audio/ (AudioModule -- video delegates transcription to audio)
    ├── shared/file-utils.ts (ensureFolder, writeNote)
    ├── shared/api-utils.ts (notifyError)
    └── shared/validation.ts (sanitizeUrl, sanitizePath)
```

Key constraint: Video depends on Audio. Audio initialized at `main.ts:L23`, Video at `main.ts:L24`.

## Settings Schema

```typescript
type AIProvider = 'openai' | 'anthropic' | 'ollama'

interface AutoNotesSettings {
  ai: AISettings;
  elaboration: ElaborationSettings;
  audio: AudioSettings;
  video: VideoSettings;
}
```

### ai

| Key | Type | Default |
|-----|------|---------|
| `provider` | `AIProvider` | `'openai'` |
| `apiKey` | `string` | `''` |
| `ollamaEndpoint` | `string` | `'http://localhost:11434'` |
| `model` | `string` | `'gpt-4o'` |
| `maxTokens` | `number` | `2048` |
| `temperature` | `number` | `0.7` |

Note: `model` stores simplified names (e.g. `'opus'`). `AIClient` resolves these to full API IDs via `resolveModelId()` (e.g. `'opus'` -> `'claude-opus-4-6'`).

Model options per provider:

| Provider | Models |
|----------|--------|
| openai | gpt-4o, gpt-4o-mini, o3, o3-mini, o4-mini |
| anthropic | opus (Claude Opus), sonnet (Claude Sonnet), haiku (Claude Haiku) |
| ollama | llama3, mistral, codellama, gemma |

### elaboration

| Key | Type | Default |
|-----|------|---------|
| `enabled` | `boolean` | `true` |
| `proposalFolderPath` | `string` | `'.auto-notes/proposals'` |
| `scanOnStartup` | `boolean` | `false` |
| `autoScanInterval` | `number` (minutes, 0=off) | `0` |
| `detection.minWordThreshold` | `number` | `50` |
| `detection.detectTodoMarkers` | `boolean` | `true` |
| `detection.detectEmptySections` | `boolean` | `true` |
| `detection.detectSparseLinks` | `boolean` | `true` |
| `detection.excludeFolders` | `string[]` | `['templates', '.auto-notes']` |
| `detection.excludeTags` | `string[]` | `['no-elaborate']` |
| `proposal.maxProposalsPerNote` | `number` | `3` |
| `proposal.preserveFrontmatter` | `boolean` | `true` |
| `proposal.includeSourceContext` | `boolean` | `true` |

### audio

| Key | Type | Default |
|-----|------|---------|
| `enabled` | `boolean` | `true` |
| `transcriptionProvider` | `'whisper-api' \| 'deepgram' \| 'local-whisper'` | `'whisper-api'` |
| `whisperApiKey` | `string` | `''` |
| `deepgramApiKey` | `string` | `''` |
| `whisperModel` | `string` | `'whisper-1'` |
| `localWhisperPath` | `string` | `''` |
| `language` | `string` | `''` |
| `postProcessing.enabled` | `boolean` | `true` |
| `postProcessing.removeFiller` | `boolean` | `true` |
| `postProcessing.addStructure` | `boolean` | `true` |
| `postProcessing.extractKeyPoints` | `boolean` | `false` |
| `postProcessing.customPrompt` | `string` | `''` |
| `output.folder` | `string` | `'Transcriptions'` |
| `output.fileNameTemplate` | `string` | `'{{date}}-{{source}}'` |
| `output.appendToExisting` | `boolean` | `false` |

### video

| Key | Type | Default |
|-----|------|---------|
| `enabled` | `boolean` | `true` |
| `ytDlpPath` | `string` | `'yt-dlp'` |
| `ffmpegPath` | `string` | `'ffmpeg'` |
| `tempFolder` | `string` | `'.auto-notes/temp'` |
| `supportedPlatforms.youtube` | `boolean` | `true` |
| `supportedPlatforms.tiktok` | `boolean` | `true` |
| `frameExtraction.enabled` | `boolean` | `false` |
| `frameExtraction.intervalSeconds` | `number` | `30` |
| `frameExtraction.visionModel` | `string` | `'gpt-4o'` |
| `frameExtraction.maxFrames` | `number` | `20` |
| `output.folder` | `string` | `'Video Notes'` |
| `output.fileNameTemplate` | `string` | `'{{date}}-{{title}}'` |
| `output.includeVideoMetadata` | `boolean` | `true` |

## Command Registry

| ID | Description | Type |
|----|-------------|------|
| `auto-notes:scan-vault` | Scan vault for stub notes | `callback` |
| `auto-notes:scan-current-note` | Scan current note for elaboration | `editorCallback` |
| `auto-notes:review-proposals` | Open proposal review sidebar | `callback` |
| `auto-notes:clear-proposals` | Clear all pending proposals | `callback` |
| `auto-notes:transcribe-audio` | Transcribe audio file | `callback` |
| `auto-notes:transcribe-note-audio` | Transcribe audio embeds from current note | `editorCallback` |
| `auto-notes:transcribe-video-url` | Transcribe video from URL | `callback` |
| `auto-notes:transcribe-video-file` | Transcribe local video file (stub) | `callback` |
| `auto-notes:check-dependencies` | Check external tool availability | `callback` |

## Ribbon Icons

| Icon | Tooltip | Action |
|------|---------|--------|
| `sparkles` | Review elaboration proposals | `ElaborationModule.activateProposalView()` |
| `mic` | Transcribe audio | `AudioModule.openTranscriptionModal()` |

## Custom View

| View Type | Class | Location |
|-----------|-------|----------|
| `auto-notes-proposal-review` | `ProposalReviewView` | Right sidebar leaf |

## Build and Test

```sh
npm run dev            # Development build (esbuild watch)
npm run build          # Production build (tsc -noEmit -skipLibCheck + esbuild)
npm test               # vitest run (single pass)
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest run --coverage
```

Output: `main.js` (single bundle, loaded by Obsidian)

## Test Infrastructure

| Component | Path |
|-----------|------|
| Config | `vitest.config.ts` |
| Setup file | `src/__test-utils__/setup.ts` |
| Obsidian mock | `src/__mocks__/obsidian.ts` |
| Mock factories | `src/__test-utils__/mock-factories.ts` |
| Test files | `src/**/*.test.ts` |
| Existing tests | `src/video/url-detector.test.ts` |

- Framework: Vitest 4.x, globals enabled, node environment
- `vi.mock('obsidian')` auto-resolves to `src/__mocks__/obsidian.ts` via setup file
- Mock factories: `mockFile(path)`, `createMockApp()`, `createMockPlugin()`, `makeSettings(defaults, overrides?)`
- Obsidian mock provides real classes for `TFile`, `TFolder` (instanceof checks work), stubs for `Plugin`, `Modal`, `Setting`, `ItemView`, `Notice`, `PluginSettingTab`, `WorkspaceLeaf`

## External Dependencies (Runtime)

No npm runtime dependencies. Uses:
- `obsidian` API (`requestUrl` for HTTP, vault API for files)
- `child_process.execFile` for `yt-dlp` and `ffmpeg` (Electron environment)
- `fetch` for Whisper API and Deepgram API calls (FormData requirement)

## Security Notes

- All URLs validated via `sanitizeUrl()` before passing to external tools
- All file paths validated via `sanitizePath()` (rejects `..`, null bytes, shell metacharacters)
- AI responses sanitized via `sanitizeAIResponse()` before writing to vault
- API keys redacted from error messages via `redactSecrets()` in `ai-client.ts` and `notifyError()` in `api-utils.ts`
- Ollama endpoint enforces HTTPS (HTTP allowed only for localhost)
- External commands use `execFile` with argument arrays (not `exec`) to prevent shell injection
- API key fields in settings UI use `type='password'` and `autocomplete='off'`
