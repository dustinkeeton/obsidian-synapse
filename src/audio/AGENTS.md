---
last-updated: 2026-03-13
---

# Audio Module

Transcribes audio files from the vault (standalone or inline note embeds) using configurable providers, with optional AI post-processing.

## Public API

Exported from `index.ts`:

```ts
class AudioModule {
  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings, notifications: NotificationManager)
  onload(): Promise<void>
  onunload(): void
  transcribe(audioData: ArrayBuffer, fileName: string, options?: TranscribeOptions): Promise<TranscriptionResult>
  openTranscriptionModal(): void
  onTranscriptionComplete: ((filePath: string) => void) | null
}

class AudioTranscriptionModal extends Modal { ... }

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
| `transcription-modal.ts` | `AudioTranscriptionModal` | File picker modal |
| `note-audio-modal.ts` | `NoteAudioModal` | Selection modal for note embeds |
| `index.ts` | `AudioModule` | Orchestrator, commands, embed detection |

## Data Flow

```
1. User triggers command or VideoModule calls transcribe()
   |
2. Transcriber.transcribe(audioData, fileName)
   |  Routes by transcriptionProvider:
   |  'whisper-api' --> OpenAI /v1/audio/transcriptions (fetch + FormData, 5min timeout)
   |       Key: audio.whisperApiKey || ai.apiKey
   |  'deepgram' --> Deepgram /v1/listen (fetch, 5min timeout)
   |  'local-whisper' --> throws (not implemented)
   |
3. PostProcessor.process(rawTranscript)  [if postProcess !== false]
   |  Builds instructions from settings flags, calls AIClient.complete()
   |  sanitizeAIResponse() on output
   |
4. Result inserted as blockquote in active note:
   > **Transcription of filename.mp3**
   > ...transcribed text...
```

## Inline Note Transcription

```
1. transcribeFromNote(noteFile)
   |  findAudioEmbeds(): regex ![[*.mp3|wav|m4a|ogg|flac|webm|aac]]
   |  Skips embeds with existing transcription block below
   |
2. NoteAudioModal -- user selects embeds
   |
3. transcribeAndInsert() -- reverse line order, 2s delay between API calls
   |  Cancellable via NotificationManager operation handle
```

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

`AudioModule.transcribe()` is called by `VideoModule.processUrl()` at `video/index.ts:L105`. Video passes extracted audio as `ArrayBuffer` with `sourceName` set to video title.
