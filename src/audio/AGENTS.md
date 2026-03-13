---
last-updated: 2026-03-12
---

# Audio Module

Transcribes audio files from the vault using configurable providers, with optional AI post-processing.

## Public API

Exported from `index.ts`:

```ts
class AudioModule {
  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings)
  onload(): Promise<void>
  onunload(): void
  transcribe(audioData: ArrayBuffer, fileName: string, options?: TranscribeOptions): Promise<TranscriptionResult>
  saveTranscription(result: TranscriptionResult, targetPath?: string): Promise<void>
  openTranscriptionModal(): void
}

class AudioTranscriptionModal extends Modal {
  constructor(app: App, getSettings: () => AutoNotesSettings, onTranscribe: (file: TFile) => Promise<void>)
}

interface TranscriptionResult {
  raw: string
  processed?: string
  language?: string
  duration?: number
  sourceName: string
  timestamps?: TimestampEntry[]
}

interface TimestampEntry {
  start: number
  end: number
  text: string
}

interface TranscribeOptions {
  language?: string
  postProcess?: boolean
  sourceName?: string
}
```

## Internal Files

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `TranscriptionResult`, `TimestampEntry`, `TranscribeOptions` | Type definitions |
| `transcriber.ts` | `Transcriber` | Provider-routed transcription (Whisper API, Deepgram, local) |
| `post-processor.ts` | `PostProcessor` | AI-powered transcript cleanup via `AIClient` |
| `transcription-modal.ts` | `AudioTranscriptionModal` | File picker modal for vault audio files |
| `index.ts` | `AudioModule` | Orchestrator, registers command |

## Data Flow

```
1. User triggers command or VideoModule calls transcribe()
   │
2. AudioModule.transcribe(audioData, fileName, options?)
   │
3. Transcriber.transcribe(audioData, fileName)
   │  Routes by settings.audio.transcriptionProvider:
   │  ├── 'whisper-api' → OpenAI /v1/audio/transcriptions (FormData + fetch)
   │  ├── 'deepgram' → Deepgram /v1/listen (requestUrl)
   │  └── 'local-whisper' → not implemented (throws)
   │
4. PostProcessor.process(rawTranscript)  [if postProcess !== false]
   │  Builds instruction list from settings flags
   │  Calls AIClient.complete() to clean transcript
   │  Sanitizes AI response via sanitizeAIResponse()
   │
5. AudioModule.saveTranscription(result)
   │  Formats frontmatter (source, date, language, duration)
   │  Writes to output.folder/{{date}}-{{source}}.md via writeNote()
```

## Settings Keys

All under `settings.audio`:

| Key | Controls |
|-----|----------|
| `enabled` | Module activation at startup |
| `transcriptionProvider` | Which transcription backend to use |
| `deepgramApiKey` | API key for Deepgram provider |
| `whisperModel` | Model name for Whisper API |
| `localWhisperPath` | Path to local whisper binary (unused) |
| `language` | Language hint for transcription |
| `postProcessing.enabled` | Enable AI post-processing |
| `postProcessing.removeFiller` | Strip filler words |
| `postProcessing.addStructure` | Add punctuation and headings |
| `postProcessing.extractKeyPoints` | Add bullet summary at top |
| `postProcessing.customPrompt` | Additional post-processing instruction |
| `output.folder` | Output folder for transcription notes |
| `output.fileNameTemplate` | Template with `{{date}}` and `{{source}}` |
| `output.appendToExisting` | Append to existing file (not yet used) |

## Error Handling

- `openTranscriptionModal` callback: catches errors, calls `notifyError()`
- Whisper API uses `fetch` (not `requestUrl`) due to FormData requirement
- Deepgram uses Obsidian `requestUrl`
- Local whisper throws `Error` with guidance to use other providers
- Post-processed AI output sanitized via `sanitizeAIResponse()` (strips scripts, event handlers, dangerous URIs)

## Video Module Integration

`AudioModule.transcribe()` is called by `VideoModule.processUrl()` at `video/index.ts:L77`. The video module passes extracted audio as `ArrayBuffer` with `sourceName` set to the video title.
