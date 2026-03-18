---
last-updated: 2026-03-18
---

# Audio Module

Transcribes audio files from the vault using configurable providers, with optional AI post-processing. Exposes public methods for unified transcription UI.

## Public API

Exported from `index.ts`:

```ts
class AudioModule {
  constructor(plugin: Plugin, getSettings: () => SynapseSettings, notifications: NotificationManager, checkpointManager: CheckpointManager)
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  transcribe(audioData: ArrayBuffer, fileName: string, options?: TranscribeOptions): Promise<TranscriptionResult>
  transcribeFileToActiveNote(file: TFile): Promise<void>
  transcribeAndInsert(noteFile: TFile, embeds: AudioEmbed[]): Promise<void>
  onTranscriptionComplete: ((filePath: string) => void) | null
}

function findAudioEmbeds(content: string, sourcePath: string, metadataCache: MetadataCache): AudioEmbed[]

const AUDIO_EXTENSIONS: RegExp   // /\.(mp3|wav|m4a|ogg|flac|webm|aac)$/i
const AUDIO_EMBED_REGEX: RegExp  // /!\[\[([^\]]+\.(?:mp3|wav|m4a|ogg|flac|webm|aac))\]\]/gi

interface TranscriptionResult {
  raw: string
  processed?: string
  language?: string
  duration?: number
  sourceName: string
  timestamps?: TimestampEntry[]
}

interface TimestampEntry { start: number; end: number; text: string }
interface TranscribeOptions { language?: string; postProcess?: boolean; sourceName?: string }
interface AudioEmbed { fileName: string; file: TFile; line: number }
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `TranscriptionResult`, `TimestampEntry`, `TranscribeOptions`, `AudioEmbed` | Types |
| `transcriber.ts` | `Transcriber` | Provider-routed transcription (Whisper, Deepgram, local) |
| `post-processor.ts` | `PostProcessor` | AI transcript cleanup via `AIClient` |
| `note-scanner.ts` | `findAudioEmbeds`, `hasTranscriptionBelow`, `AUDIO_EXTENSIONS`, `AUDIO_EMBED_REGEX` | Scan note content for audio embeds |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `index.ts` | `AudioModule` | Orchestrator, public transcription methods |

## Data Flow

```
1. User triggers via UnifiedTranscriptionModal or NoteMediaModal (in transcription/)
   |
2a. transcribeFileToActiveNote(file) -- single file to active note
   |  Reads binary, calls transcribe(), builds callout, appends to active note
   |
2b. transcribeAndInsert(noteFile, embeds) -- batch from note scan
   |  Processes embeds in reverse line order, 2s delay between API calls
   |  Cancellable via NotificationManager operation handle
   |
3. Transcriber.transcribe(audioData, fileName)
   |  Routes by transcriptionProvider:
   |  'whisper-api' --> OpenAI /v1/audio/transcriptions (fetch + FormData, 5min timeout)
   |       Key: audio.whisperApiKey || ai.apiKey
   |  'deepgram' --> Deepgram /v1/listen (fetch, 5min timeout)
   |  'local-whisper' --> throws (not implemented)
   |
4. PostProcessor.process(rawTranscript)  [if postProcess !== false]
   |  Builds instructions from settings flags, calls AIClient.complete()
   |  sanitizeAIResponse() on output
   |
5. Result wrapped in callout block:
   > [!synapse-transcription]- Transcription of filename.mp3
   > ...transcribed text...
```

## Note Scanning

`findAudioEmbeds(content, sourcePath, metadataCache)` in `note-scanner.ts`:
- Regex: `![[*.mp3|wav|m4a|ogg|flac|webm|aac]]`
- Resolves files via `metadataCache.getFirstLinkpathDest()`
- Skips embeds with existing transcription callout below (checks 3 lines)
- Returns `AudioEmbed[]` with file references and line numbers

## Settings Keys

All under `settings.audio`:

| Key | Controls |
|-----|----------|
| `transcriptionProvider` | Backend selection |
| `whisperApiKey` | Dedicated OpenAI key (fallback: `ai.apiKey`) |
| `deepgramApiKey` | Deepgram API key |
| `whisperModel` | Whisper model name |
| `language` | Language hint |
| `postProcessing.*` | AI cleanup flags |

## Video Module Integration

`AudioModule.transcribe()` is called by `VideoModule.processUrl()` at `video/index.ts:L93`. Video passes extracted audio as `ArrayBuffer` with `sourceName` set to video title.

## Commands

No commands registered directly. Commands are registered in `main.ts` (unified transcription):
- `synapse:transcribe-media` -> `AudioModule.transcribeFileToActiveNote(file)`
- `synapse:transcribe-note-media` -> `AudioModule.transcribeAndInsert(file, embeds)`
