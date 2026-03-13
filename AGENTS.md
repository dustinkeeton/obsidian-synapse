---
last-updated: 2026-03-12
---

# Auto Notes — Agent Documentation

Obsidian plugin providing AI-powered note elaboration, audio transcription, and video transcription.

## Module Registry

| Path | Purpose | Public API |
|------|---------|------------|
| `src/main.ts` | Plugin entry point, module orchestration | `AutoNotesPlugin` (default export) |
| `src/settings.ts` | Settings interfaces and defaults | `AutoNotesSettings`, `DEFAULT_SETTINGS` |
| `src/settings-tab.ts` | Obsidian settings UI | `AutoNotesSettingTab` |
| `src/elaboration/` | Stub note detection and proposal generation | `ElaborationModule`, `PROPOSAL_VIEW_TYPE`, types |
| `src/audio/` | Audio transcription pipeline | `AudioModule`, `AudioTranscriptionModal`, types |
| `src/video/` | Video download, audio extraction, transcription | `VideoModule`, types, `detectPlatform`, `isSupportedUrl` |
| `src/shared/` | AI client, file utils, API helpers, validation | `AIClient`, `writeNote`, `readNote`, `ensureFolder`, `withRetry`, `notifyError`, `wordCount`, `sanitizeUrl`, `sanitizePath`, `ensureWithinVault`, `sanitizeAIResponse` |

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
    ├── audio/ (AudioModule — video delegates transcription to audio)
    ├── shared/file-utils.ts (ensureFolder, writeNote)
    ├── shared/api-utils.ts (notifyError)
    └── shared/validation.ts (sanitizeUrl, sanitizePath)
```

Key constraint: Video depends on Audio. Audio is initialized before Video in `main.ts:24`.

## Settings Schema

```ts
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
| `provider` | `'openai' \| 'anthropic' \| 'ollama'` | `'openai'` |
| `apiKey` | `string` | `''` |
| `ollamaEndpoint` | `string` | `'http://localhost:11434'` |
| `model` | `string` | `'gpt-4o'` |
| `maxTokens` | `number` | `2048` |
| `temperature` | `number` | `0.7` |

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

## Build Commands

```sh
npm run dev          # Development build (esbuild watch)
npm run build        # Production build (tsc check + esbuild)
```

No test framework configured.
