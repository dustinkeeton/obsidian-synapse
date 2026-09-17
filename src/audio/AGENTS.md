---
last-updated: 2026-09-17
---

# Audio Module

Transcribes audio files from the vault using configurable providers (Whisper API, Deepgram, Gemini, local Whisper stub), with optional AI post-processing and optional lyrics auto-formatting. Exposes public methods for the unified transcription UI. All HTTP goes through Obsidian `requestUrl` (CSP-safe on mobile), not native `fetch`.

## Public API

Barrel (`index.ts`) re-exports: `AudioModule`, `renderAudioSettings`, `renderTranscriptionCredentials`, `findAudioEmbeds`, `AUDIO_EXTENSIONS`, `AUDIO_EMBED_REGEX`, and types `AudioEmbed`, `TranscribeOptions`, `TranscriptionResult`, `TimestampEntry`. `transcriber.ts` symbols below are module-internal (reached via `audio/transcriber`, not the barrel) and consumed by tests + `transcription-credentials.ts`.

```ts
class AudioModule {
  constructor(plugin: Plugin, getSettings: () => SynapseSettings, notifications: NotificationManager, checkpointManager: CheckpointManager, noteQueue: NoteOperationQueue, extractor?: AudioExtractor)   // noteQueue (#483) inserted before the optional extractor
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  transcribe(audioData: ArrayBuffer, fileName: string, options?: TranscribeOptions): Promise<TranscriptionResult>   // options.update receives "Post-processing (n/total)" for sectioned runs (#467); throws NoSpeechDetectedError (#524) before any AI call
  processTranscriptText(raw: string, opts?: PostProcessOptions): Promise<{ text: string; reformatted?: boolean; schemaId?: string }>   // caption-tier seam (#184); sanitize -> PostProcessor -> schema reformat; failures propagate; blank input -> zero AI calls, returned unchanged (#524)
  transcribeFileToActiveNote(file: TFile, timeRange?: TimeRange): Promise<void>   // queued on the active note (#483)
  transcribeAndInsert(noteFile: TFile, embeds: AudioEmbed[]): Promise<void>   // queued on noteFile (#483)
  transcribeAndInsertCombined(noteFile: TFile, embeds: AudioEmbed[]): Promise<void>   // #214; queued on noteFile (#483); <2 embeds falls back to transcribeAndInsert; ffmpeg concat (desktop) or per-file text merge (mobile) -> one combined callout
  onTranscriptionComplete: ((filePath: string) => void) | null
}

function renderAudioSettings(ctx: SettingsSectionContext): void   // settings UI; from settings-section.ts
function renderTranscriptionCredentials(body: HTMLElement, ctx: SettingsSectionContext): void   // re-exported on the barrel (#332/#335); from transcription-credentials.ts; settings-tab.ts imports it via `./audio`
function findAudioEmbeds(content: string, sourcePath: string, metadataCache: MetadataCache): AudioEmbed[]

// transcriber.ts (module-internal: imported directly, NOT via the barrel)
function buildMultipartBody(
  fields: { name: string; value: string }[],
  file: { name: string; fieldName: string; data: ArrayBuffer }
): { contentType: string; body: ArrayBuffer }   // manual multipart/form-data (requestUrl has no FormData); header values sanitized
const GEMINI_MAX_INLINE_AUDIO_BYTES: number      // 15 MB raw ceiling for Gemini inline transcription (20 MB request cap / ~4/3 base64 inflation)
class Transcriber {
  constructor(getSettings: () => SynapseSettings)
  transcribe(audioData: ArrayBuffer, fileName: string): Promise<TranscriptionResult>   // routes by audio.transcriptionProvider; throws NoSpeechDetectedError for a speechless transcript (#524)
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
  reformatted?: boolean   // #234; true when a content schema (e.g. lyrics) reformatted the transcript
  schemaId?: string       // #234; id of the schema that reformatted (e.g. 'lyrics')
}

interface TimestampEntry { start: number; end: number; text: string }
interface TranscribeOptions { language?: string; postProcess?: boolean; sourceName?: string; timeRange?: TimeRange; update?: (message: string) => void }

// post-processor.ts (module-internal; AudioModule owns the instance)
interface PostProcessOptions { update?: (message: string) => void }          // progress sink, called once per AI call in sectioned runs
interface PostProcessorDeps { notify?: (message: string) => void; delayMs?: number }   // notify = single end-of-run notice; delayMs default 2000
class PostProcessor {
  constructor(getSettings: () => SynapseSettings, deps?: PostProcessorDeps)
  process(rawTranscript: string, opts?: PostProcessOptions): Promise<string>   // !isWorthPostProcessing(raw) -> returns input, zero AI calls (#524); fits ai.maxTokens -> one call; over -> sectioned (#467)
}

// transcript-segmenter.ts (module-internal, pure)
interface TranscriptSegment { body: string; context: string }   // bodies concatenate back to the input exactly; context = word-aligned tail of the previous body
function segmentTranscript(text: string, maxChars: number, overlapChars: number): TranscriptSegment[]   // paragraph -> line -> sentence -> word boundaries, then hard cut
function trimRepeatedContext(output: string, context: string): string   // drops a verbatim repeat of context from the start of a rewritten section
interface AudioEmbed { fileName: string; file: TFile; line: number }
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `TranscriptionResult`, `TimestampEntry`, `TranscribeOptions`, `AudioEmbed` | Types |
| `transcriber.ts` | `Transcriber`, `buildMultipartBody`, `GEMINI_MAX_INLINE_AUDIO_BYTES` | Provider-routed transcription (Whisper, Deepgram, Gemini, local stub) over `requestUrl`; manual multipart with sanitized headers (internal `sanitizeMultipartHeaderValue`, `geminiMimeType`); Gemini text via shared `extractGeminiResponseText` |
| `transcriber.test.ts` | Tests | Transcriber + multipart + provider routing tests |
| `post-processor.ts` | `PostProcessor`, `PostProcessOptions`, `PostProcessorDeps` | AI transcript cleanup via `AIClient`; transcripts over `ai.maxTokens` run in sections (#467) |
| `no-speech.test.ts` | Tests | `AudioModule` no-speech paths (#524): zero AI calls, note untouched, notices, batch/combined partial results |
| `post-processor.test.ts` | Tests | Blank/short-input guard (#524), single-call path, sectioning, overlap trim, raw fallback, progress, key points, inter-call delay |
| `transcript-segmenter.ts` | `segmentTranscript`, `trimRepeatedContext`, `TranscriptSegment` | Pure boundary-aware splitter used by `PostProcessor` |
| `transcript-segmenter.test.ts` | Tests | Boundary selection, budget, round-trip, overlap context |
| `settings-section.ts` | `renderAudioSettings` | Audio settings UI section |
| `transcription-credentials.ts` | `renderTranscriptionCredentials(body: HTMLElement, ctx: SettingsSectionContext)` | Transcription-provider dropdown + per-provider API-key fields rendered into the AI Configuration section (#332/#335). Re-exported from `index.ts` (the module's public API) so `settings-tab.ts` wires it through the `./audio` barrel rather than deep-importing this file. Imports `PROVIDER_METADATA`/`decorateCredentialField` and types `CredentialProvider`/`CredentialFieldHandle`/`SettingsSectionContext` via the `../shared` barrel (no deep `../shared/<file>` imports) |
| `note-scanner.ts` | `findAudioEmbeds`, `hasTranscriptionBelow`, `AUDIO_EXTENSIONS`, `AUDIO_EMBED_REGEX` | Scan note content for audio embeds |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `index.ts` | `AudioModule` (+ `renderAudioSettings`, `renderTranscriptionCredentials`, note-scanner & type re-exports) | Orchestrator, public transcription methods; gates writes via `isPathExcluded`/`findMatchingRule` (#307); serializes every note-mutating insert through the shared `NoteOperationQueue` (internal `queued`, `insertFileTranscription`, `insertTranscriptions`, `insertCombinedTranscription`, #483); schema-reformat failures log through shared `redactError` |

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
   |  No speech (#524) --> NoSpeechDetectedError, never a result:
   |       every provider: !hasSpeechContent(transcript)
   |       whisper verbose_json only (whisper-1): every segment no_speech_prob >= 0.8
   |       gemini: reply is the `[NO_SPEECH]` sentinel the system instruction asks for, or finishReason STOP with no parts
   |  AudioModule.transcribe re-checks after sanitizeAIResponse, before post-processing
   |  Write sites: single-file / combined -> op.finish(noSpeechNotice(...)), no vault.process, no onTranscriptionComplete;
   |       batch + per-file merge -> notifications.info per silent file, the rest still inserted
   |
4. PostProcessor.process(rawTranscript, { update })  [if postProcess !== false]
   |  !isWorthPostProcessing(raw) -> return raw, no AI call (#524)
   |  Builds instructions from settings flags
   |  ceil(chars/4) <= ai.maxTokens: one AIClient.complete() call, sanitizeAIResponse() on output
   |  otherwise (#467): segmentTranscript(text, maxTokens*0.6*4 chars, 10% overlap) -> one call per section,
   |    sequential with a 2s pause, update("Post-processing (n/total)") before each call;
   |    section prompt = instructions (minus key points) + "Preceding context" (overlap, continuity only) + "Transcript section";
   |    error / empty reply / reply >= maxTokens*4 chars -> raw slice kept; rejoin with blank lines;
   |    extractKeyPoints -> one extra call over the rejoined text, appended at the END;
   |    >0 raw sections -> single notifications.info("Post-processing kept k of n sections raw")
   |
5. Result wrapped in callout block:
   > [!synapse-transcription]- Transcription of filename.mp3
   > ...transcribed text...
```

## Per-Note Serialization (#483)

Every public insert path acquires the target note's slot on the shared `NoteOperationQueue` exactly once, then delegates to a private core that must NOT re-enter the queue.

| Public entry point | Queue key | Private core |
|---|---|---|
| `transcribeFileToActiveNote(file, timeRange?)` | active note path | `insertFileTranscription(activeFile, file, op, timeRange?)` (index.ts:L200) |
| `transcribeAndInsert(noteFile, embeds)` | `noteFile.path` | `insertTranscriptions(noteFile, embeds, op)` (index.ts:L287) |
| `transcribeAndInsertCombined(noteFile, embeds)` | `noteFile.path` (2+ embeds only) | `insertCombinedTranscription(noteFile, embeds, op)` (index.ts:L420) |

- `private queued<T>(file, op, run)` (index.ts:L87) wraps `noteQueue.run(file.path, run, { onWait })`; `onWait` updates the operation toast to `Waiting for another Synapse operation on <basename>` (audio commands are user-invoked, so a wait is surfaced).
- `transcribeAndInsertCombined` with `<2` embeds short-circuits to the PUBLIC `transcribeAndInsert` BEFORE acquiring (index.ts:L406), so the slot is still taken exactly once.
- The combined-transcription fallbacks call `insertTranscriptions` DIRECTLY (index.ts:L451) — they already hold the note's slot, and re-entering would self-deadlock.
- `transcribe(audioData, fileName, options?)` is queue-free: it takes bytes, not a note, and is also called by `VideoModule.processUrl()`.

## Note Scanning

`findAudioEmbeds(content, sourcePath, metadataCache)` in `note-scanner.ts:L8`:
- Regex `AUDIO_EMBED_REGEX`: `![[*.mp3|wav|m4a|ogg|flac|webm|aac]]`
- Resolves files via `metadataCache.getFirstLinkpathDest()`; only `TFile` matches passing `AUDIO_EXTENSIONS` are kept
- Skips embeds already transcribed via `hasTranscriptionBelow` (`note-scanner.ts:L38`): scans lines `embedLine+1..+3` for the legacy `**Transcription of X**`, the `[!synapse-transcription]` callout, or the `[!...lyrics]` callout `Lyrics of X` (#234)
- Returns `AudioEmbed[]` with file references and line numbers

## Settings Keys

All under `settings.audio` (interface `AudioSettings`, `settings.ts:93`; defaults `settings.ts:411`):

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | `true` | Feature toggle for the audio module |
| `transcriptionProvider` | `'whisper-api' \| 'deepgram' \| 'gemini' \| 'local-whisper'` | `'whisper-api'` | Transcription backend (routed in `transcriber.ts:L294`) |
| `whisperApiKey` | string | `''` | Dedicated OpenAI key (fallback: `ai.apiKey`, `transcriber.ts:L313`) |
| `deepgramApiKey` | string | `''` | Deepgram API key (no fallback) |
| `geminiApiKey` | string | `''` | Dedicated Gemini key (fallback: `ai.apiKey`, `transcriber.ts:L426`) |
| `transcriptionModel` | string | `'whisper-1'` | Model for the active provider; resolved against `TRANSCRIPTION_MODEL_OPTIONS` (`transcription-models.ts`) |
| `localWhisperPath` | string | `''` | Reserved for `local-whisper` CLI path (provider not implemented) |
| `language` | string | `''` | Language hint; empty = auto-detect |
| `autoFormatLyrics` | boolean | `true` | Auto-detect song transcripts and reformat as structured lyrics (#234) |
| `postProcessing` | `PostProcessingSettings` | see below | AI transcript cleanup block (`settings.ts:L85`) |

`postProcessing` (`PostProcessingSettings`, `settings.ts:L85`), consumed by `post-processor.ts`:

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `postProcessing.enabled` | boolean | `true` | Master switch; off returns the raw transcript unchanged |
| `postProcessing.removeFiller` | boolean | `false` | Strip filler words / false starts (opt-in per vault, `settings.ts:426`; #465) |
| `postProcessing.addStructure` | boolean | `true` | Add punctuation, paragraph breaks, headers |
| `postProcessing.extractKeyPoints` | boolean | `false` | Prepend a "Key Points" summary section |
| `postProcessing.customPrompt` | string | `''` | Extra instruction appended to the cleanup prompt |

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
