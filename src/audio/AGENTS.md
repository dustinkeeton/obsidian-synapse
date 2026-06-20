---
last-updated: 2026-06-19
---

# Audio Module

Transcribes audio files from the vault using configurable providers (Whisper API, Deepgram, Gemini, local Whisper stub), with optional AI post-processing and optional lyrics auto-formatting. Exposes public methods for the unified transcription UI. All HTTP goes through Obsidian `requestUrl` (CSP-safe on mobile), not native `fetch`.

## Public API

Barrel (`index.ts`) re-exports: `AudioModule`, `findAudioEmbeds`, `AUDIO_EXTENSIONS`, `AUDIO_EMBED_REGEX`, and types `AudioEmbed`, `TranscribeOptions`, `TranscriptionResult`, `TimestampEntry`. `transcriber.ts` symbols below are module-internal (reached via `audio/transcriber`, not the barrel) and consumed by tests + `transcription-credentials.ts`.

```ts
class AudioModule {
  constructor(plugin: Plugin, getSettings: () => SynapseSettings, notifications: NotificationManager, checkpointManager: CheckpointManager, extractor?: AudioExtractor)
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  transcribe(audioData: ArrayBuffer, fileName: string, options?: TranscribeOptions): Promise<TranscriptionResult>
  transcribeFileToActiveNote(file: TFile, timeRange?: TimeRange): Promise<void>
  transcribeAndInsert(noteFile: TFile, embeds: AudioEmbed[]): Promise<void>
  transcribeAndInsertCombined(noteFile: TFile, embeds: AudioEmbed[]): Promise<void>   // #214; <2 embeds falls back to transcribeAndInsert
  transcribeAudioCombined(files: TFile[]): Promise<string>                            // #214; concat (ffmpeg) or sequential fallback -> combined text
  onTranscriptionComplete: ((filePath: string) => void) | null
}

function findAudioEmbeds(content: string, sourcePath: string, metadataCache: MetadataCache): AudioEmbed[]

// transcriber.ts (module-internal: imported directly, NOT via the barrel)
function buildMultipartBody(
  fields: { name: string; value: string }[],
  file: { name: string; fieldName: string; data: ArrayBuffer }
): { contentType: string; body: ArrayBuffer }   // manual multipart/form-data (requestUrl has no FormData); header values sanitized
const GEMINI_MAX_INLINE_AUDIO_BYTES: number      // 15 MB raw ceiling for Gemini inline transcription (20 MB request cap / ~4/3 base64 inflation)
class Transcriber {
  constructor(getSettings: () => SynapseSettings)
  transcribe(audioData: ArrayBuffer, fileName: string): Promise<TranscriptionResult>   // routes by audio.transcriptionProvider
}

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
interface TranscribeOptions { language?: string; postProcess?: boolean; sourceName?: string; timeRange?: TimeRange }
interface AudioEmbed { fileName: string; file: TFile; line: number }
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `TranscriptionResult`, `TimestampEntry`, `TranscribeOptions`, `AudioEmbed` | Types |
| `transcriber.ts` | `Transcriber`, `buildMultipartBody`, `GEMINI_MAX_INLINE_AUDIO_BYTES` | Provider-routed transcription (Whisper, Deepgram, Gemini, local stub) over `requestUrl`; manual multipart with sanitized headers (internal `sanitizeMultipartHeaderValue`, `geminiMimeType`); Gemini text via shared `extractGeminiResponseText` |
| `transcriber.test.ts` | Tests | Transcriber + multipart + provider routing tests |
| `post-processor.ts` | `PostProcessor` | AI transcript cleanup via `AIClient` |
| `settings-section.ts` | `renderAudioSettings` | Audio settings UI section |
| `transcription-credentials.ts` | `renderTranscriptionCredentials(body: HTMLElement, ctx: SettingsSectionContext)` | Transcription-provider dropdown + per-provider API-key fields rendered into the AI Configuration section (#332/#335). Imports `PROVIDER_METADATA`/`decorateCredentialField` and types `CredentialProvider`/`CredentialFieldHandle`/`SettingsSectionContext` via the `../shared` barrel (audit Stage-1 barrel-import refactor — no deep `../shared/<file>` imports) |
| `note-scanner.ts` | `findAudioEmbeds`, `hasTranscriptionBelow`, `AUDIO_EXTENSIONS`, `AUDIO_EMBED_REGEX` | Scan note content for audio embeds |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `index.ts` | `AudioModule` (+ note-scanner & type re-exports) | Orchestrator, public transcription methods; gates writes via `isPathExcluded`/`findMatchingRule` (#307) |

## Data Flow

```
1. User triggers via UnifiedTranscriptionModal or NoteMediaModal (in transcription/)
   |
2a. transcribeFileToActiveNote(file, timeRange?) -- single file to active note
   |  Reads binary, clips audio via AudioExtractor if timeRange provided (desktop only)
   |  Calls transcribe(), builds callout with time-range label, appends to active note
   |
2b. transcribeAndInsert(noteFile, embeds) -- batch from note scan
   |  Processes embeds in reverse line order, 2s delay between API calls
   |  Cancellable via NotificationManager operation handle
   |
3. Transcriber.transcribe(audioData, fileName)
   |  Routes by transcriptionProvider (all via requestUrl, 5min timeout, retry on connection/dns/offline only):
   |  'whisper-api' --> OpenAI /v1/audio/transcriptions
   |       Body: buildMultipartBody() manual multipart/form-data (requestUrl has no FormData)
   |       Key: audio.whisperApiKey || ai.apiKey
   |  'deepgram' --> Deepgram /v1/listen (raw ArrayBuffer body)
   |       Key: audio.deepgramApiKey
   |  'gemini' --> generativelanguage /v1beta/models/gemini-3.5-flash:generateContent
   |       Inline base64 audio (rejects > GEMINI_MAX_INLINE_AUDIO_BYTES = 15 MB)
   |       Instruction in system_instruction (prompt-injection hardening); text via extractGeminiResponseText()
   |       Key: audio.geminiApiKey || ai.apiKey
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
| `transcriptionProvider` | Backend: `whisper-api` \| `deepgram` \| `gemini` \| `local-whisper` |
| `whisperApiKey` | Dedicated OpenAI key (fallback: `ai.apiKey`) |
| `deepgramApiKey` | Deepgram API key |
| `geminiApiKey` | Dedicated Gemini key (fallback: `ai.apiKey`) |
| `whisperModel` | Whisper model name |
| `language` | Language hint |
| `autoFormatLyrics` | Auto-detect song transcripts and reformat as structured lyrics (#234); default `true` |
| `postProcessing.*` | AI cleanup flags |

Path exclusion: write paths gate on the centralized `settings.exclusions` (#307) via `isPathExcluded(path, 'audio', settings)` (batch insert = silent skip; single-file = `findMatchingRule` Notice). No per-module `excludeFolders`/`excludeTags`.

## Time-Range Clipping

When `timeRange` is provided to `transcribeFileToActiveNote()`:
1. Audio file written to temp directory
2. `AudioExtractor.clipAudio(tempPath, start, end)` clips via ffmpeg (desktop only)
3. Clipped audio data passed to `transcribe()`
4. Callout title includes time range: "Transcription of file.mp3 [01:30 - 05:00]"
5. Falls back to full-file transcription on mobile (no AudioExtractor)

## Multipart Construction & Hardening

`buildMultipartBody(fields, file)` assembles a `multipart/form-data` body as an `ArrayBuffer` (Obsidian
`requestUrl` does not accept `FormData`). Random boundary: `----SynapseFormBoundary{base36}`.

Untrusted input safety: field names and the file name are vault-/settings-derived, so they pass through
`sanitizeMultipartHeaderValue()` before interpolation into `Content-Disposition` header lines — it strips
all CR/LF and replaces `"`/`\` with `_`, the only characters that can break out of a quoted header
parameter. Field values strip CR/LF to ` ` so they cannot start a new part. This blocks header/multipart
injection from filenames like `x"\r\nContent-Disposition: ...`. The binary file payload is appended raw and
never interpreted as text.

## Video Module Integration

`AudioModule.transcribe()` is called by `VideoModule.processUrl()` (video passes extracted audio as `ArrayBuffer` with `sourceName` set to the video title) — a runtime `video → audio` edge.

`audio/index.ts` has only a type-only back-edge to video: `import type { AudioExtractor } from '../video'` (constructor `extractor?` param, desktop-only clipping/concat). Type-only = erased at compile time, so there is no runtime `audio ⇄ video` cycle.

## Commands

No commands registered directly by this module; `main.ts` registers the unified transcription commands and routes them here:
- `synapse:transcribe-media` (registry `status: disabled` — gated out) -> `UnifiedTranscriptionModal` -> `AudioModule.transcribeFileToActiveNote(file, timeRange?)`
- `synapse:transcribe-note-media` (active) -> `NoteMediaModal` -> `transcribeAndInsert(file, embeds)` or `transcribeAndInsertCombined(file, embeds)` when the user opts to combine (ffmpeg-gated)
