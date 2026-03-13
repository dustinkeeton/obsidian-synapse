---
last-updated: 2026-03-12
---

# Audio Module

Transcribes audio files from the vault (standalone or inline note embeds) using configurable providers, with optional AI post-processing.

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
  // Private methods (inline note transcription):
  // transcribeFromNote(noteFile: TFile): Promise<void>
  // findAudioEmbeds(content: string, sourcePath: string): AudioEmbed[]
  // hasTranscriptionBelow(lines: string[], embedLine: number, fileName: string): boolean
  // transcribeAndInsert(noteFile: TFile, embeds: AudioEmbed[]): Promise<void>
}

class AudioTranscriptionModal extends Modal {
  constructor(app: App, getSettings: () => AutoNotesSettings, onTranscribe: (file: TFile) => Promise<void>)
}

interface AudioEmbed {
  fileName: string
  file: TFile
  line: number
}

class NoteAudioModal extends Modal {
  constructor(app: App, embeds: AudioEmbed[], onTranscribe: (embeds: AudioEmbed[]) => Promise<void>)
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
| `transcriber.ts` | `Transcriber` | Provider-routed transcription (Whisper API, Deepgram, local); `getWhisperApiKey()` fallback logic |
| `post-processor.ts` | `PostProcessor` | AI-powered transcript cleanup via `AIClient` |
| `transcription-modal.ts` | `AudioTranscriptionModal` | File picker modal for vault audio files |
| `note-audio-modal.ts` | `NoteAudioModal`, `AudioEmbed` | Selection modal for audio embeds found in a note |
| `index.ts` | `AudioModule` | Orchestrator, registers commands (transcribe-audio, transcribe-note-audio) |

## Data Flow

```
1. User triggers command or VideoModule calls transcribe()
   │
2. AudioModule.transcribe(audioData, fileName, options?)
   │
3. Transcriber.transcribe(audioData, fileName)
   │  Routes by settings.audio.transcriptionProvider:
   │  ├── 'whisper-api' → OpenAI /v1/audio/transcriptions (FormData + fetch + AbortController 5min timeout)
   │  │     Key resolution: getWhisperApiKey() → audio.whisperApiKey || ai.apiKey
   │  ├── 'deepgram' → Deepgram /v1/listen (fetch + AbortController 5min timeout)
   │  │     Guard: throws if deepgramApiKey is empty
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
| `whisperApiKey` | Dedicated OpenAI key for Whisper (fallback: `ai.apiKey`) |
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
- Whisper API uses `fetch` (not `requestUrl`) due to FormData requirement, with AbortController timeout (5min)
- Deepgram uses `fetch` with AbortController timeout (5min); throws if `deepgramApiKey` is empty
- Local whisper throws `Error` with guidance to use other providers
- Post-processed AI output sanitized via `sanitizeAIResponse()` (strips scripts, event handlers, dangerous URIs)

## Inline Note Transcription Flow

```
1. User triggers command `auto-notes:transcribe-note-audio` (editorCallback)
   │
2. AudioModule.transcribeFromNote(noteFile)
   │  Reads note content, calls findAudioEmbeds()
   │
3. findAudioEmbeds(content, sourcePath)
   │  Regex: /!\[\[(.+\.(?:mp3|wav|m4a|ogg|flac|webm|aac))\]\]/gi
   │  Resolves each embed to TFile via metadataCache.getFirstLinkpathDest()
   │  Skips embeds that already have a transcription block below (hasTranscriptionBelow)
   │
4. NoteAudioModal — user selects which embeds to transcribe
   │
5. transcribeAndInsert(noteFile, selectedEmbeds)
   │  Processes in reverse line order (so insertions don't shift line numbers)
   │  2s delay between API requests (rate limit avoidance)
   │  Inserts blockquote transcription block after each embed line:
   │    > **Transcription of filename.mp3**
   │    > ...transcribed text...
   │  Writes modified content via vault.modify()
```

## Video Module Integration

`AudioModule.transcribe()` is called by `VideoModule.processUrl()` at `video/index.ts:L78`. The video module passes extracted audio as `ArrayBuffer` with `sourceName` set to the video title.
