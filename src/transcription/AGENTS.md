---
last-updated: 2026-09-14
---

# Transcription Module

Transcription UI (unified modal, note-media modal, time-range modal, duration detection) plus the tiered URL-transcription router (#184: YouTube captions on every platform → desktop yt-dlp/ffmpeg extraction). Media transcription/OCR itself lives in `audio`, `video`, `image`; this module reaches them only through injected callbacks and delegates.

## Public API

Re-exported from the `index.ts` barrel (`index.ts:1-31`). `NodeDeps` (`duration-detector.ts:46`) is not barrel-exported; it is only the type of the optional `deps?` param.

```ts
// unified-modal.ts:14
class UnifiedTranscriptionModal extends Modal {
  constructor(
    app: App,
    getSettings: () => SynapseSettings,
    enabledModules: { audio: boolean; video: boolean },
    callbacks: {
      onTranscribeFile: (file: TFile, timeRange?: TimeRange) => Promise<void>;
      onTranscribeUrl: (url: string, timeRange?: TimeRange) => Promise<void>;
    },
    notifications: NotificationManager
  )
}

// note-media-modal.ts:7
class NoteMediaModal extends Modal {
  constructor(
    app: App,
    audioEmbeds: AudioEmbed[],
    videoEmbeds: VideoUrlEmbed[],
    imageEmbeds: ImageEmbed[],
    callbacks: {
      onTranscribeAudio: (embeds: AudioEmbed[], combine: boolean) => Promise<void>;
      onTranscribeVideo: (embeds: VideoUrlEmbed[]) => Promise<void>;
      onExtractImages: (embeds: ImageEmbed[]) => Promise<void>;
    },
    notifications: NotificationManager,
    ffmpegAvailable?: boolean   // default false; controls combine-audio description text
  )
}

// time-range-slider.ts
class TimeRangeSlider {
  readonly containerEl: HTMLElement
  get start(): number
  get end(): number
  constructor(parentEl: HTMLElement, options: TimeRangeSliderOptions)
}
interface TimeRangeSliderOptions {
  duration: number
  initialStart?: number
  initialEnd?: number
  onChange?: (start: number, end: number) => void
}

// time-range-modal.ts:10 / :18 / :39 (#464; replaced time-range-toast.ts)
type TimeRangeChoice =
  | { kind: 'selection'; range: TimeRange }
  | { kind: 'full' }
  | { kind: 'cancelled' }                 // Escape / click-away → caller does nothing
interface TimeRangeModalOptions {
  title: string
  duration?: number                       // undefined → manual start/end inputs
}
class TimeRangeModal extends Modal {
  constructor(app: App, options: TimeRangeModalOptions, notifications: NotificationManager)
  openAndChoose(): Promise<TimeRangeChoice>   // time-range-modal.ts:79; settles exactly once
}

// duration-detector.ts:64 / :128 / :181 / :175
function detectLocalFileDuration(
  file: TFile,
  readBinary: (file: TFile) => Promise<ArrayBuffer>,
  getSettings: () => SynapseSettings,
  deps?: NodeDeps
): Promise<DurationResult>
function detectUrlDuration(url: string, getSettings: () => SynapseSettings, deps?: NodeDeps): Promise<DurationResult>
function formatTimestamp(totalSeconds: number): string
const MIN_SLIDER_DURATION: number  // 10 seconds
interface DurationResult { durationSeconds: number | undefined; title: string }
type NodeDeps = NodeModules        // injection seam for tests (not barrel-exported)

// url-transcription.ts — ordered-tier router for URL transcription (#184)
interface UrlTranscriptOptions {                                  // url-transcription.ts:25
  timeRange?: TimeRange                 // set range forces the extraction tier (captions cannot clip)
  update?: (message: string) => void
}
interface UrlTranscript {                                         // url-transcription.ts:35
  text: string                          // post-processed when available, else raw
  raw: string
  source: 'captions' | 'local-extraction'
  title?: string
  language?: string
  videoVaultPath?: string               // local extraction only
  reformatted?: boolean
  schemaId?: string                     // content schema that reformatted the text (#234)
}
interface UrlTranscriptionStrategy {                              // url-transcription.ts:54
  readonly id: string
  canHandle(url: string, opts: UrlTranscriptOptions): boolean   // cheap gate: platform/url/settings only, no network
  transcribe(url: string, opts: UrlTranscriptOptions): Promise<UrlTranscript | null>   // null = fall through to next tier
}
class NoTranscriptionPathError extends Error {                    // url-transcription.ts:72
  constructor(url: string, attempts: string[])                    // message is platform-aware (mobile → desktop/sync handoff)
  readonly url: string
  readonly attempts: string[]
}
class UrlTranscriptionRouter {                                    // url-transcription.ts:94
  constructor(strategies: UrlTranscriptionStrategy[])             // array order IS the tier order
  transcribe(url: string, opts?: UrlTranscriptOptions): Promise<UrlTranscript>
}
function buildUrlTranscriptBlock(result: UrlTranscript, url: string, embedInNote: boolean, timeRange?: TimeRange): string   // url-transcription.ts:125

// caption-strategy.ts — tier 1: YouTube captions over HTTP (free, mobile-capable)
interface ProcessedTranscript { text: string; reformatted?: boolean; schemaId?: string }   // caption-strategy.ts:12
interface ProcessTranscriptOptions { update?: (message: string) => void }                  // caption-strategy.ts:18; not barrel-exported
type ProcessTranscript = (raw: string, opts?: ProcessTranscriptOptions) => Promise<ProcessedTranscript>   // caption-strategy.ts:22; opts.update carries "Post-processing (n/total)" (#467)
class CaptionStrategy implements UrlTranscriptionStrategy {                                // caption-strategy.ts:31
  readonly id = 'captions'
  constructor(getSettings: () => SynapseSettings, postProcess: ProcessTranscript)          // postProcess = AudioModule.processTranscriptText (injected)
}

// local-extraction-strategy.ts — tier 2: desktop yt-dlp/ffmpeg
type LocalExtractionDelegate = (url: string, opts: UrlTranscriptOptions) => Promise<TranscriptionResult & { videoVaultPath?: string }>   // :12
class LocalExtractionStrategy implements UrlTranscriptionStrategy {                        // local-extraction-strategy.ts:24
  readonly id = 'local-extraction'
  constructor(delegate: LocalExtractionDelegate)                  // delegate wraps VideoModule.processUrl, wired in main.ts
}

// youtube-captions.ts
interface YouTubeTranscript { text: string; language: string; auto: boolean; title?: string; structured: boolean }   // :27
function fetchYouTubeTranscript(url: string, preferredLanguages: string[]): Promise<YouTubeTranscript | null>          // :112

// insert-url-transcript.ts:8 / :26
interface InsertUrlTranscriptDeps {
  app: App
  getSettings: () => SynapseSettings
  notifications: NotificationManager
  router: UrlTranscriptionRouter
  noteQueue: NoteOperationQueue                     // #483; the one shared instance, injected by main.ts
  onComplete?: (filePath: string) => void           // post-transcription hook (enrichment/title check)
}
function insertUrlTranscript(deps: InsertUrlTranscriptDeps, url: string, timeRange?: TimeRange): Promise<void>
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `unified-modal.ts` | `UnifiedTranscriptionModal` | File picker + URL input modal with duration detection, platform badge, time-range prompt |
| `note-media-modal.ts` | `NoteMediaModal` | Selection modal for media found in current note; audio/video/image toggles; combine-audio option |
| `time-range-slider.ts` | `TimeRangeSlider`, `TimeRangeSliderOptions` | Dual-handle range slider (pure DOM, no Obsidian deps beyond createEl) |
| `time-range-modal.ts` | `TimeRangeModal`, `TimeRangeChoice`, `TimeRangeModalOptions` | First-class modal asking what to transcribe: slider (known duration) or manual inputs (unknown); settle-once, dismiss = cancelled (#464) |
| `duration-detector.ts` | `detectLocalFileDuration`, `detectUrlDuration`, `formatTimestamp`, `MIN_SLIDER_DURATION`, `DurationResult`, `NodeDeps` | Duration detection via ffprobe (local) and yt-dlp (URL); desktop-only, mobile returns undefined |
| `url-transcription.ts` | `UrlTranscriptionRouter`, `UrlTranscriptionStrategy`, `UrlTranscript`, `UrlTranscriptOptions`, `NoTranscriptionPathError`, `buildUrlTranscriptBlock` | Tier router + shared note-block builder (embed + collapsed transcription/lyrics callout) |
| `caption-strategy.ts` | `CaptionStrategy`, `ProcessedTranscript`, `ProcessTranscript` | Tier 1: YouTube captions; post-processing through the injected audio pipeline |
| `local-extraction-strategy.ts` | `LocalExtractionStrategy`, `LocalExtractionDelegate` | Tier 2: desktop yt-dlp/ffmpeg via injected `VideoModule.processUrl` delegate |
| `youtube-captions.ts` | `fetchYouTubeTranscript`, `YouTubeTranscript` (barrel); module-level `INNERTUBE_ANDROID_CLIENT`, `extractJsonAfterMarker`, `extractCaptionTracks`, `selectCaptionTrack`, `collectJson3Cues`, `parseChaptersFromDescription`, `formatCaptionTranscript`, `CaptionCue`, `VideoChapter` (internal, test seams) | Caption fetch + deterministic transcript formatting over Obsidian `requestUrl` |
| `insert-url-transcript.ts` | `insertUrlTranscript`, `InsertUrlTranscriptDeps` | Transcribes a media URL through the injected router and appends the block to the ACTIVE note inside its `NoteOperationQueue` slot (#483, `insert-url-transcript.ts:53`) |
| `index.ts` | Re-exports | Barrel file |
| `*.test.ts` | Tests | `caption-strategy`, `duration-detector`, `local-extraction-strategy`, `note-media-modal`, `time-range-modal`, `unified-modal`, `url-transcription`, `youtube-captions` |

## UnifiedTranscriptionModal

Single modal combining audio file selection and video URL input (`unified-modal.ts`):
- Local-file section rendered only when `enabledModules.audio || enabledModules.video` (`unified-modal.ts:38`)
- Dropdown lists all audio files in vault (filtered by `AUDIO_EXTENSIONS`, honors audio path exclusions via `isPathExcluded(path, 'audio', settings)`, #323)
- URL section rendered when `enabledModules.video` on every platform (`unified-modal.ts:76`; no desktop gate since #184)
- URL text field with platform detection badge (`detectPlatform`); unknown non-empty input shows "Unsupported URL"
- File selection and URL input are mutually exclusive (setting one clears the other)
- On submit (`handleTranscribe`, `unified-modal.ts:120`): rejects a URL that fails `detectPlatform` via `notifications.info`; empty input prompts to select a file or enter a URL
  - Mobile (`!Platform.isDesktop`): transcribes the full file/URL with no duration step (`unified-modal.ts:135`, `:156`)
  - Desktop: duration detection (ffprobe for files, yt-dlp for URLs) → `chooseTimeRange` (`unified-modal.ts:177`)
    - Duration defined but < `MIN_SLIDER_DURATION` (10s): full file, no prompt
    - Otherwise `TimeRangeModal.openAndChoose()`: `selection` → `TimeRange`; `full` → `undefined`; `cancelled` → return without calling any callback
- Callbacks receive `timeRange?: TimeRange` (undefined = full file)

Opened by `main.ts:398` (ribbon `synapse-transcribe`, registered on every platform) via `openUnifiedModal` (`main.ts:602`). The registry entry `transcribe-media` is `status: 'disabled'` (`commands/registry.ts:22`), so `main.ts:429` attempts registration for the audit but no palette command ships.

## NoteMediaModal

Selection modal for media embedded in the current note (`note-media-modal.ts`):
- Displays count of audio files, video URLs, and images found
- Toggle checkboxes per embed (audio, video, image sections)
- "Select all" / "Select none" buttons
- "Combine audio" toggle (#214): shown for 2+ audio embeds; with ffmpeg concatenates audio before transcribing (single API call); without ffmpeg merges text transcriptions
  - `ffmpegAvailable` param controls the toggle description text only; actual concat logic is in `AudioModule`
  - `combine` is passed true only when the toggle is on AND 2+ audio files are actually selected (`note-media-modal.ts:111`)
  - `onTranscribeAudio` receives `combine: boolean` as second arg; caller decides behavior
- "Process selected" dispatches to separate audio/video/image callbacks

Opened by `main.ts:633` (`transcribeMediaFromNote`) via command `synapse:transcribe-note-media` (`editorCallback`, `main.ts:433`; scans the active note's embeds, no-ops with a notice when none found). Video embeds are collected only when `this.video` exists (desktop); `onTranscribeVideo` is an unreachable no-op on mobile (`main.ts:662-664`).

## Duration Detection

`duration-detector.ts` — both functions return early with `{ durationSeconds: undefined }` on mobile (`!Platform.isDesktop`, `duration-detector.ts:72`, `:133`).

Local files (`detectLocalFileDuration`):
1. Writes audio binary to OS temp dir (`synapse-probe-<ts>-<safeName>`); `safeName` strips path-unsafe chars via `/[^A-Za-z0-9._-]/g`
2. Runs ffprobe (derived from `video.ffmpegPath` via `replace(/ffmpeg$/, 'ffprobe')`), `env: shellEnv()`, `timeout: 15_000`ms
3. Parses `-show_entries format=duration -of csv=p=0` output
4. Cleans up temp file in `execFile` callback (fire-and-forget `fs.promises.unlink`)

URLs (`detectUrlDuration`):
1. Validates URL via `sanitizeUrl`
2. Runs `yt-dlp --dump-json --no-download` (timeout: 30s, maxBuffer: 10MB)
3. Parses `duration` and `title` from JSON; narrows with `asYtDlpDurationJson`

`NodeDeps` is the injection seam for tests; production code passes `undefined` and the function resolves real builtins via `loadNodeModules()`.

## Time-Range Slider

`TimeRangeSlider` (`time-range-slider.ts`): pure DOM component with no Obsidian dependencies beyond `createEl`/`createDiv`:
- Two overlapping `<input type="range">` on a shared track
- Visual highlight for selected region (percentage-based CSS left/width)
- Timestamp labels update live (`MM:SS` or `HH:MM:SS`)
- Step size: 1s for media <= 600s (10min), 5s otherwise
- Handles cannot cross (enforced via input event handlers; clamped to `end - 1` / `start + 1`)

## Time-Range Modal (#464)

`TimeRangeModal` (`time-range-modal.ts:39`), CSS prefix `synapse-time-range-modal`:
- Known duration (`renderSlider`, `:94`): embedded `TimeRangeSlider`; "Transcribe selection" with the slider untouched at full range settles `{ kind: 'full' }`, otherwise `{ kind: 'selection', range }`
- Unknown duration (`renderManualInputs`, `:116`): start/end text inputs (`HH:MM:SS` or `MM:SS`) validated via `validateTimeRange`; missing or invalid input shows `notifications.info` and keeps the modal open
- Button row (`renderButtons`, `:152`): "Full file" → `{ kind: 'full' }`; "Transcribe selection" (`mod-cta`)
- Dismiss (Escape / click-away) → `onClose` (`:70`) settles `{ kind: 'cancelled' }`; `resolved` flag guarantees a single settle

## URL Transcription Router (#184)

Tier order is the array handed to `UrlTranscriptionRouter` in `main.ts:150-163`: `[CaptionStrategy, LocalExtractionStrategy?]` (extraction tier appended only when `VideoModule` exists, i.e. desktop).

| Tier | `canHandle` | `transcribe` |
|------|-------------|--------------|
| `captions` (`caption-strategy.ts:39`) | no `timeRange` AND `video.captionsFirst` AND `detectPlatform(url).platform === 'youtube'` | `fetchYouTubeTranscript(url, [audio.language, 'en'])`; `null` → fall through; `structured` captions returned as-is; otherwise `postProcess(raw, { update: opts.update })`, degrading to raw captions on failure (`console.warn` via `redactError`) |
| `local-extraction` (`local-extraction-strategy.ts:29`) | `Platform.isDesktop && isSupportedUrl(url)` | delegate (`VideoModule.processUrl(url, { insertMode: false, timeRange }, { update })`, `main.ts:155-161`); failures propagate unchanged (keeps `DependencyMissingError` onboarding, #382) |

Router (`url-transcription.ts:102`): `canHandle` false → `"<id>: not applicable"`; `null` result → `"<id>: unavailable for this video"`; first transcript wins; every tier exhausted → `NoTranscriptionPathError(url, attempts)`.

`fetchYouTubeTranscript` (`youtube-captions.ts:112`):
1. `sanitizeUrl` (only throw path) → `detectPlatform` must be `youtube`, else `null`
2. Attempt A: POST Innertube `/youtubei/v1/player` as the pinned ANDROID client (`INNERTUBE_ANDROID_CLIENT`, `:92`; bump `clientVersion` when YouTube answers 400 FAILED_PRECONDITION)
3. Attempt B (only when A yields no tracks): GET watch page, balanced-brace extraction of `ytInitialPlayerResponse` (`extractJsonAfterMarker`, `:244`); web track URLs may be POT-gated (200 + empty body)
4. `selectCaptionTrack` (`:341`): manual tracks before ASR, preferred languages in order, else first available
5. Fetch json3 cues (`collectJson3Cues`, `:411`); empty → `null`
6. `parseChaptersFromDescription` (`:472`) + `formatCaptionTranscript` (`:554`) → `{ text, structured }` (speaker-turn `>>` markers / chapters = structured)
7. Any fetch/parse failure → `console.warn(redactError)` + `null`; per-request timeout 30s (`:72`); consent cookies sent unconditionally (`:84`)

## Data Flow

```
main.ts:150-172  router = new UrlTranscriptionRouter([CaptionStrategy(getSettings, audio.processTranscriptText), LocalExtractionStrategy(video.processUrl)?])
                 video.urlTranscriber = (url, parentOp) => router.transcribe(url, { update })   // batch note-media path (#184)

UnifiedTranscriptionModal (openUnifiedModal, main.ts:602-631)
  enabledModules = { audio: settings.audio.enabled, video: settings.video.enabled }
  onTranscribeFile(file, timeRange?) --> AudioModule.transcribeFileToActiveNote(file, timeRange)
  onTranscribeUrl(url, timeRange?)   --> insertUrlTranscript({ app, getSettings, notifications, router, noteQueue,
                                           onComplete: audio.onTranscriptionComplete }, url, timeRange)

NoteMediaModal (transcribeMediaFromNote, main.ts:633-672; embeds from findAudioEmbeds/findVideoUrls/findImageEmbeds)
  onTranscribeAudio(embeds, combine) --> combine ? AudioModule.transcribeAndInsertCombined(file, embeds)
                                                 : AudioModule.transcribeAndInsert(file, embeds)
  onTranscribeVideo(embeds)          --> VideoModule.transcribeAndInsert(file, embeds)   (desktop only)
  onExtractImages(embeds)            --> ImageModule.extractAndInsert(file, embeds)
  ffmpegAvailable                    <-- await main.isFfmpegAvailable()

Other router consumers: summarize transcribeUrl callback (main.ts:176-181), intake transcribeUrlToNote (main.ts:466-489)
```

`insertUrlTranscript` (`insert-url-transcript.ts:26`): active note required (`notifications.info` otherwise); `findMatchingRule(path, 'video', settings)` exclusion → Notice naming the rule; `noteQueue.run(activeFile.path, ...)` with `onWait` toast update; `router.transcribe` → `buildUrlTranscriptBlock(result, url, video.embedInNote, timeRange)` → `vault.process` append → `deps.onComplete?.(path)` from inside the slot; errors → `op.error(...)`, never rethrown.

## Module Dependencies

In (type-only where noted):

| Import | From | File | Type-only |
|--------|------|------|-----------|
| `AUDIO_EXTENSIONS` | `../audio` | `unified-modal.ts:3` | no |
| `AudioEmbed` | `../audio` | `note-media-modal.ts:2` | yes |
| `TranscriptionResult` | `../audio` | `local-extraction-strategy.ts:3` | yes |
| `detectPlatform` | `../video` (re-export of `shared/url-detector`) | `unified-modal.ts:4` | no |
| `VideoUrlEmbed` | `../video` | `note-media-modal.ts:3` | yes |
| `ImageEmbed` | `../image` | `note-media-modal.ts:4` | yes |
| `detectPlatform`, `isSupportedUrl`, `redactError`, `sanitizeUrl`, `isRecord`, `parseJson` | `../shared` | `caption-strategy.ts`, `local-extraction-strategy.ts`, `youtube-captions.ts` | no |
| `buildCallout`, `calloutForTranscriptionResult`, `formatTimeRange` | `../shared` | `url-transcription.ts:2` | no |
| `findMatchingRule`, `isPathExcluded`, `validateTimeRange`, `loadNodeModules`, `shellEnv` | `../shared` | `insert-url-transcript.ts`, `unified-modal.ts`, `time-range-modal.ts`, `duration-detector.ts` | no |
| `TimeRange`, `NotificationManager`, `NoteOperationQueue` | `../shared` | various | yes |
| `SynapseSettings` | `../settings` | various | yes |
| `requestUrl`, `Platform`, `Modal`, `Setting` | `obsidian` | various | no |

Out: consumed by `main.ts` only (router construction, modal construction, `insertUrlTranscript`, `buildUrlTranscriptBlock`). No feature module imports `../transcription`.

## Settings Keys Referenced

| Key | Source module | Used by |
|-----|--------------|---------|
| `audio.postProcessing.enabled` | audio | `UnifiedTranscriptionModal` (display only) |
| `audio.language` | audio | `CaptionStrategy` preferred caption language (then `'en'`) |
| `video.captionsFirst` | video | `CaptionStrategy.canHandle` (off = tier skipped, desktop always downloads) |
| `video.embedInNote` | video | `buildUrlTranscriptBlock` callers (`insertUrlTranscript`, intake) |
| `video.ffmpegPath` | video | `detectLocalFileDuration` (derives ffprobe path) |
| `video.ytDlpPath` | video | `detectUrlDuration` |
| `exclusions` | shared | `UnifiedTranscriptionModal` file filter (#323); `insertUrlTranscript` (`'video'` feature id) |

## Invariants / Gotchas

- No media decoding or AI calls live here; the caption tier's post-processing and the extraction tier's download/transcribe run inside `audio`/`video` through the injected callbacks
- `insert-url-transcript.ts` owns the active note's `NoteOperationQueue` slot for the transcribe → append cycle (#483) and must never be called from inside another queued operation on the same note
- Tier order is the array order handed to `UrlTranscriptionRouter`; a strategy returning `null` falls through; only a real failure throws; all tiers declining raises `NoTranscriptionPathError`
- A set `timeRange` forces the extraction tier (`CaptionStrategy.canHandle` returns false), so desktop clipping never routes through captions
- `detectPlatform` is imported from `../video` in `unified-modal.ts` and from `../shared` in the strategies; both resolve to `shared/url-detector`
- Both modals take an injected `NotificationManager` and route all user-facing messages through `notifications.info(...)`; `UnifiedTranscriptionModal.notifications` is the 5th constructor param, `NoteMediaModal.notifications` the 6th (before `ffmpegAvailable`)
- Duration detection is desktop-only; mobile always receives `durationSeconds: undefined` and the modal skips the time-range step entirely
- `TimeRangeModal` dismissal is `cancelled` (do nothing), never a default action; the "Transcribe selection" button with an untouched full-range slider settles `full` (`undefined` range downstream)
- `TimeRangeSlider` has no Obsidian Modal/View coupling
