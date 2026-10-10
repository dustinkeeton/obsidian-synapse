---
last-updated: 2026-10-09
---

# Transcription Module

Transcription UI (unified modal, note-media modal, time-range modal, duration detection) plus the tiered URL-transcription router (#184: YouTube captions on every platform → desktop yt-dlp/ffmpeg extraction) fronted by the shared transcript store (#488: read-through / write-through, `forceRefresh` escape hatch). Media transcription/OCR itself lives in `audio`, `video`, `image`; this module reaches them only through injected callbacks and delegates.

## Public API

Re-exported from the `index.ts` barrel (`index.ts:1-39`). Every data type of the router/tiers (`UrlTranscriptOptions`, `TranscriptStore`, `UrlTranscript`, `UrlTranscriptionStrategy`, `ProcessedTranscript`, `ProcessTranscriptOptions`, `ProcessTranscript`, `LocalExtractionDelegate`, `YouTubeTranscript`, `CaptionCue`, `VideoChapter`, `DurationResult`) is declared in `types.ts` and re-exported via `index.ts:21-31` (except `ProcessTranscriptOptions`, `CaptionCue`, `VideoChapter`, which stay module-internal). `NodeDeps` (`duration-detector.ts:38`) is not barrel-exported; it is only the type of the optional `deps?` param.

```ts
// unified-modal.ts:13
class UnifiedTranscriptionModal extends Modal {
  constructor(
    app: App,
    getSettings: () => SynapseSettings,
    enabledModules: { audio: boolean; video: boolean },
    callbacks: {
      onTranscribeFile: (file: TFile, timeRange?: TimeRange) => Promise<void>;
      onTranscribeUrl: (url: string, timeRange?: TimeRange, forceRefresh?: boolean) => Promise<void>;   // forceRefresh = "Fetch a fresh transcript" toggle (#488)
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

// time-range-modal.ts:10 / :18 / :39 (#464; replaced the former toast prompt)
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

// duration-detector.ts:56 / :120 / :173 / :167; DurationResult = types.ts:131
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

// url-transcription.ts — ordered-tier router for URL transcription (#184); its contracts live in types.ts
interface UrlTranscriptOptions {                                   // types.ts:4
  timeRange?: TimeRange                 // set range forces the extraction tier (captions cannot clip); part of the store key
  update?: (message: string) => void
  forceRefresh?: boolean                // skip the transcript store, re-run the tiers, and dispatch their AI post-processing fresh (#488, #527)
}
interface TranscriptStore {                                        // types.ts:17; read/write slice of shared `TranscriptCache` (#488)
  get(url: string, timeRange?: TimeRange): Promise<TranscriptCacheEntry | null>
  put(url: string, transcript: CachedTranscript, timeRange?: TimeRange): Promise<void>
}
interface UrlTranscript {                                          // types.ts:22
  text: string                          // post-processed when available, else raw
  raw: string
  source: 'captions' | 'local-extraction'
  title?: string
  thumbnailUrl?: string                 // poster frame for post-op illustrate (#213); never stored in the transcript cache
  language?: string
  videoVaultPath?: string               // local extraction only
  reformatted?: boolean
  schemaId?: string                     // content schema that reformatted the text (#234)
  cached?: boolean                      // true when served from the transcript store (#488)
  aiCached?: boolean                    // #527; fresh transcript whose AI post-processing replayed a cached response; never stored
}
interface UrlTranscriptionStrategy {                              // types.ts:47
  readonly id: string
  canHandle(url: string, opts: UrlTranscriptOptions): boolean   // cheap gate: platform/url/settings only, no network
  transcribe(url: string, opts: UrlTranscriptOptions): Promise<UrlTranscript | null>   // null = fall through to next tier
}
class NoTranscriptionPathError extends Error {                    // url-transcription.ts:34
  constructor(url: string, attempts: string[])                    // message is platform-aware (mobile → desktop/sync handoff)
  readonly url: string
  readonly attempts: string[]
}
class UrlTranscriptionRouter {                                    // url-transcription.ts:56
  constructor(strategies: UrlTranscriptionStrategy[], cache?: TranscriptStore)   // array order IS the tier order; cache = shared TranscriptCache (#488)
  transcribe(url: string, opts?: UrlTranscriptOptions): Promise<UrlTranscript>   // store hit (unless forceRefresh) -> `cached: true`; tier result -> cache.put, never on failure
}
function buildUrlTranscriptBlock(result: UrlTranscript, url: string, embedInNote: boolean, timeRange?: TimeRange): string   // url-transcription.ts:115; embed lines come from shared `buildMediaEmbedLines` (#561)

// caption-strategy.ts — tier 1: YouTube captions over HTTP (free, mobile-capable)
interface ProcessedTranscript { text: string; reformatted?: boolean; schemaId?: string; aiCached?: boolean }   // types.ts:64
interface ProcessTranscriptOptions { update?: (message: string) => void; bypassCache?: boolean }   // types.ts:71; not barrel-exported; bypassCache = opts.forceRefresh (#527)
type ProcessTranscript = (raw: string, opts?: ProcessTranscriptOptions) => Promise<ProcessedTranscript>   // types.ts:76; opts.update carries "Post-processing (n/total)" (#467)
class CaptionStrategy implements UrlTranscriptionStrategy {                                // caption-strategy.ts:17
  readonly id = 'captions'
  constructor(getSettings: () => SynapseSettings, postProcess: ProcessTranscript)          // postProcess = AudioModule.processTranscriptText (injected)
}

// local-extraction-strategy.ts — tier 2: desktop yt-dlp/ffmpeg
type LocalExtractionDelegate = (url: string, opts: UrlTranscriptOptions) => Promise<TranscriptionResult & { videoVaultPath?: string }>   // types.ts:84; TranscriptionResult is `import type`-d from ../audio (types.ts:2)
class LocalExtractionStrategy implements UrlTranscriptionStrategy {                        // local-extraction-strategy.ts:12
  readonly id = 'local-extraction'
  constructor(delegate: LocalExtractionDelegate)                  // delegate wraps VideoModule.processUrl, wired in main.ts
}

// youtube-captions.ts
interface YouTubeTranscript { text: string; language: string; auto: boolean; title?: string; thumbnailUrl?: string; structured: boolean }   // types.ts:89
function fetchYouTubeTranscript(url: string, preferredLanguages: string[]): Promise<YouTubeTranscript | null>          // youtube-captions.ts:89

// insert-url-transcript.ts:8 / :26
interface InsertUrlTranscriptDeps {
  app: App
  getSettings: () => SynapseSettings
  notifications: NotificationManager
  router: UrlTranscriptionRouter
  noteQueue: NoteOperationQueue                     // #483; the one shared instance, injected by main.ts
  onComplete?: (filePath: string) => void           // post-transcription hook (enrichment/title check)
}
function insertUrlTranscript(deps: InsertUrlTranscriptDeps, url: string, timeRange?: TimeRange, forceRefresh?: boolean): Promise<void>   // forceRefresh default false (#488)
// insert-url-transcript.ts:89 — intake variant (#112/#184): appends to `file` under toast `intake-url-<path>`; RETHROWS on failure, except no speech (#524): notice, no write, resolves
function appendUrlTranscript(
  deps: Pick<InsertUrlTranscriptDeps, 'app' | 'getSettings' | 'notifications' | 'router'>,
  url: string,
  file: TFile
): Promise<void>

// create-url-router.ts:7 / :16 — composes [CaptionStrategy, LocalExtractionStrategy?] over the store
interface UrlTranscriptionRouterDeps {
  getSettings: () => SynapseSettings
  processTranscriptText: ProcessTranscript
  extract?: LocalExtractionDelegate          // desktop-only tier; omitted when VideoModule does not exist
  store: TranscriptStore
}
function createUrlTranscriptionRouter(deps: UrlTranscriptionRouterDeps): UrlTranscriptionRouter

// open-unified-modal.ts:8 / :13 — opens UnifiedTranscriptionModal; URLs go through insertUrlTranscript(deps, ...)
interface UnifiedTranscriptionDeps extends InsertUrlTranscriptDeps {
  onTranscribeFile: (file: TFile, timeRange?: TimeRange) => Promise<void>
}
function openUnifiedTranscriptionModal(deps: UnifiedTranscriptionDeps): void

// note-media-transcription.ts:13 / :25 — scans a note's embeds per enabled feature, opens NoteMediaModal
interface NoteMediaTranscriptionDeps {
  app: App
  getSettings: () => SynapseSettings
  notifications: NotificationManager
  isFfmpegAvailable: () => Promise<boolean>
  onTranscribeAudio: (file: TFile, embeds: AudioEmbed[], combine: boolean) => Promise<void>
  onTranscribeVideo?: (file: TFile, embeds: VideoUrlEmbed[]) => Promise<void>   // absent on mobile: video embeds never scanned
  onExtractImages: (file: TFile, embeds: ImageEmbed[]) => Promise<void>
}
function transcribeNoteMedia(deps: NoteMediaTranscriptionDeps, file: TFile): Promise<void>
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `unified-modal.ts` | `UnifiedTranscriptionModal` | File picker + URL input modal with duration detection, platform badge, time-range prompt |
| `note-media-modal.ts` | `NoteMediaModal` | Selection modal for media found in current note; audio/video/image toggles; combine-audio option |
| `time-range-slider.ts` | `TimeRangeSlider`, `TimeRangeSliderOptions` | Dual-handle range slider (pure DOM, no Obsidian deps beyond createEl) |
| `time-range-modal.ts` | `TimeRangeModal`, `TimeRangeChoice`, `TimeRangeModalOptions` | First-class modal asking what to transcribe: slider (known duration) or manual inputs (unknown); settle-once, dismiss = cancelled (#464) |
| `types.ts` | `UrlTranscriptOptions`, `TranscriptStore`, `UrlTranscript`, `UrlTranscriptionStrategy`, `ProcessedTranscript`, `ProcessTranscriptOptions`, `ProcessTranscript`, `LocalExtractionDelegate`, `YouTubeTranscript`, `CaptionCue`, `VideoChapter`, `DurationResult` | Every transcription contract in one file; the runtime files below import from it. Only `import type` edges out: `../shared` (`CachedTranscript`, `TimeRange`, `TranscriptCacheEntry`), `../audio` (`TranscriptionResult`) |
| `duration-detector.ts` | `detectLocalFileDuration`, `detectUrlDuration`, `formatTimestamp`, `MIN_SLIDER_DURATION`, `NodeDeps` | Duration detection via ffprobe (local) and yt-dlp (URL); desktop-only, mobile returns undefined |
| `url-transcription.ts` | `UrlTranscriptionRouter`, `NoTranscriptionPathError`, `buildUrlTranscriptBlock` | Tier router fronted by the transcript store (#488) + shared note-block builder (embed + collapsed transcription/lyrics callout) |
| `caption-strategy.ts` | `CaptionStrategy` | Tier 1: YouTube captions; post-processing through the injected audio pipeline |
| `local-extraction-strategy.ts` | `LocalExtractionStrategy` | Tier 2: desktop yt-dlp/ffmpeg via injected `VideoModule.processUrl` delegate |
| `youtube-captions.ts` | `fetchYouTubeTranscript` (barrel); module-level `INNERTUBE_ANDROID_CLIENT`, `extractJsonAfterMarker`, `extractCaptionTracks`, `extractVideoThumbnail`, `selectCaptionTrack`, `collectJson3Cues`, `parseChaptersFromDescription`, `formatCaptionTranscript` (internal, test seams) | Caption fetch + deterministic transcript formatting over Obsidian `requestUrl` |
| `insert-url-transcript.ts` | `insertUrlTranscript`, `appendUrlTranscript`, `InsertUrlTranscriptDeps` | `insertUrlTranscript`: transcribes a media URL through the injected router (store-first, `forceRefresh` bypass) and appends the block to the ACTIVE note inside its `NoteOperationQueue` slot (#483); finish message via `withCacheReport('Transcription added to note', [transcriptCacheUse(result)])` (#527). `appendUrlTranscript`: intake variant appending to a given `file` under toast `intake-url-<path>`, unqueued, rethrows; finish via `withCacheReport('Transcript added', ...)` (#527). Both: `isNoSpeechError` -> `op.finish(noSpeechNotice('this video'))`, no write (#524) |
| `create-url-router.ts` | `createUrlTranscriptionRouter`, `UrlTranscriptionRouterDeps` | Tier-router factory (#184): `CaptionStrategy` always, `LocalExtractionStrategy` only when `deps.extract` is given |
| `open-unified-modal.ts` | `openUnifiedTranscriptionModal`, `UnifiedTranscriptionDeps` | Builds + opens `UnifiedTranscriptionModal` from `settings.audio.enabled` / `settings.video.enabled`; URL submit -> `insertUrlTranscript` |
| `note-media-transcription.ts` | `transcribeNoteMedia`, `NoteMediaTranscriptionDeps` | Scans a note (`findAudioEmbeds` / `findVideoUrls` / `findImageEmbeds`, each gated by its feature's `enabled`), notices when empty, else opens `NoteMediaModal` |
| `index.ts` | Re-exports | Barrel file |
| `*.test.ts` | Tests | `caption-strategy`, `duration-detector`, `insert-url-transcript` (store reuse + forceRefresh, #488), `fresh-transcript-bypass` (#527: forceRefresh reaches every AI pass on both tiers), `local-extraction-strategy`, `note-media-modal`, `time-range-modal`, `unified-modal`, `url-transcription`, `youtube-captions`. No dedicated tests for `create-url-router.ts`, `open-unified-modal.ts`, or `note-media-transcription.ts` |

## UnifiedTranscriptionModal

Single modal combining audio file selection and video URL input (`unified-modal.ts`):
- Local-file section rendered only when `enabledModules.audio || enabledModules.video` (`unified-modal.ts:38`)
- Dropdown lists all audio files in vault (filtered by `AUDIO_EXTENSIONS`, honors audio path exclusions via `isPathExcluded(path, 'audio', settings)`, #323)
- URL section rendered when `enabledModules.video` on every platform (`unified-modal.ts:76`; no desktop gate since #184)
- URL text field with platform detection badge (`detectPlatform`); unknown non-empty input shows "Unsupported URL"
- "Fetch a fresh transcript" toggle (`Setting.addToggle`, default off) sets `forceRefresh`, forwarded as the third `onTranscribeUrl` argument on both platforms (#488)
- File selection and URL input are mutually exclusive (setting one clears the other)
- On submit (`handleTranscribe`, `unified-modal.ts:129`): rejects a URL that fails `detectPlatform` via `notifications.info` (`:134`); empty input prompts to select a file or enter a URL
  - Mobile (`!Platform.isDesktop`): transcribes the full file/URL with no duration step (`unified-modal.ts:144`, `:165`)
  - Desktop: duration detection (ffprobe for files, yt-dlp for URLs) → `chooseTimeRange` (`unified-modal.ts:186`)
    - Duration defined but < `MIN_SLIDER_DURATION` (10s): full file, no prompt
    - Otherwise `TimeRangeModal.openAndChoose()`: `selection` → `TimeRange`; `full` → `undefined`; `cancelled` → return without calling any callback
- Callbacks receive `timeRange?: TimeRange` (undefined = full file)

Opened by `openUnifiedTranscriptionModal` (`open-unified-modal.ts:13`), whose deps are built in `main.ts:203-211` (`onTranscribeFile` -> `AudioModule.transcribeFileToActiveNote`, `onComplete` -> `audio.onTranscriptionComplete`). Triggered by ribbon `synapse-transcribe` (`main.ts:215`, registered on every platform). The registry entry `transcribe-media` is `status: 'disabled'` (`commands/registry.ts:22`), so `main.ts:228-230` attempts registration for the audit but no palette command ships.

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

Opened by `transcribeNoteMedia` (`note-media-transcription.ts:25`) via command `synapse:transcribe-note-media` (`editorCallback`, `main.ts:231-246`; scans `ctx.file`'s embeds, `notifications.info('No media found in this note')` when none, `:40-43`). Video embeds are collected only when `settings.video.enabled && deps.onTranscribeVideo` (`:33`); `main.ts:242` passes `onTranscribeVideo` only when `VideoModule` exists (desktop), so on mobile the modal's `onTranscribeVideo` is an unreachable no-op (`:57`).

## Duration Detection

`duration-detector.ts` — both functions return early with `{ durationSeconds: undefined }` on mobile (`!Platform.isDesktop`, `duration-detector.ts:64`, `:125`).

Local files (`detectLocalFileDuration`):
1. Writes audio binary to OS temp dir (`synapse-probe-<ts>-<safeName>`); `safeName` strips path-unsafe chars via `/[^A-Za-z0-9._-]/g`
2. Runs ffprobe (derived from `video.ffmpegPath` via `replace(/ffmpeg$/, 'ffprobe')`), `env: shellEnv()`, `timeout: 15_000`ms
3. Parses `-show_entries format=duration -of csv=p=0` output
4. Cleans up temp file in `execFile` callback (fire-and-forget `fs.promises.unlink`)

URLs (`detectUrlDuration`):
1. Validates URL via `sanitizeUrl`
2. Runs `yt-dlp --dump-json --no-download -- <url>` (`duration-detector.ts:139`; the `--` keeps a URL that starts with `-` from being parsed as a flag; timeout: 30s, maxBuffer: 10MB)
3. Parses `duration` and `title` from JSON; narrows with `asYtDlpDurationJson`

`NodeDeps` is the injection seam for tests; production code passes `undefined` and the function resolves real builtins via `loadNodeModules()`.

## Time-Range Slider

`TimeRangeSlider` (`time-range-slider.ts`): pure DOM component with no Obsidian dependencies beyond `createEl`/`createDiv`:
- Two overlapping `<input type="range">` on a shared track
- Visual highlight for selected region: `trackHighlight.setCssProps({ '--synapse-range-start', '--synapse-range-width' })` with percentage values (`time-range-slider.ts:145`); `styles.css` `.synapse-time-range-track-highlight` reads them as `left: var(--synapse-range-start, 0%)` / `width: var(--synapse-range-width, 0%)` — no inline `style.left`/`style.width` (the obsidian test mock stubs `setCssProps`, `__mocks__/obsidian.ts:230`)
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

Tier order is the array built by `createUrlTranscriptionRouter` (`create-url-router.ts:17-21`): `[CaptionStrategy, LocalExtractionStrategy?]` (extraction tier appended only when `deps.extract` is given; `main.ts:87-89` passes it only when `VideoModule` exists, i.e. desktop).

| Tier | `canHandle` | `transcribe` |
|------|-------------|--------------|
| `captions` (`caption-strategy.ts:25`) | no `timeRange` AND `video.captionsFirst` AND `detectPlatform(url).platform === 'youtube'` | `fetchYouTubeTranscript(url, [audio.language, 'en'])`; `null` or speechless caption text (#524) → fall through; `structured` captions returned as-is; otherwise `postProcess(raw, { update: opts.update, bypassCache: opts.forceRefresh })` (#527), degrading to raw captions on failure (`console.warn` via `redactError`) |
| `local-extraction` (`local-extraction-strategy.ts:17`) | `Platform.isDesktop && isSupportedUrl(url)` | delegate (`VideoModule.processUrl(url, { insertMode: false, timeRange, bypassCache: opts.forceRefresh }, { update })`, `main.ts:87-89`, #527); failures propagate unchanged (keeps `DependencyMissingError` onboarding, #382); blank `raw` → `NoSpeechDetectedError` (#524) |

Router (`url-transcription.ts`): with a `cache` and no `forceRefresh`, `cache.get(url, timeRange)` first — a hit returns `{ ...entry, cached: true }` (source narrowed to the tier union) after `update('Using cached transcript')`. Otherwise `canHandle` false → `"<id>: not applicable"`; `null` result → `"<id>: unavailable for this video"`; first transcript wins and is written through (`cache.put(url, fields, timeRange)`); a result with blank `raw` throws `NoSpeechDetectedError` before the write-through and a stored entry with blank `raw` is treated as a miss (#524); every tier exhausted → `NoTranscriptionPathError(url, attempts)` with nothing stored. Store keys are `canonicalMediaUrl(url)` + `#t=<start>-<end>` for clipped requests (shared `transcript-cache.ts`), so a clipped transcript never satisfies a full-length request or vice versa. `TranscriptStore` is the two-method slice the router depends on; production passes `SynapsePlugin.transcriptCache`.

`fetchYouTubeTranscript` (`youtube-captions.ts:89`):
1. `sanitizeUrl` (only throw path) → `detectPlatform` must be `youtube`, else `null`
2. Attempt A: POST Innertube `/youtubei/v1/player` as the pinned ANDROID client (`INNERTUBE_ANDROID_CLIENT`, `:57`; bump `clientVersion` when YouTube answers 400 FAILED_PRECONDITION)
3. Attempt B (only when A yields no tracks): GET watch page, balanced-brace extraction of `ytInitialPlayerResponse` (`extractJsonAfterMarker`, `:229`); web track URLs may be POT-gated (200 + empty body)
4. `selectCaptionTrack` (`:366`): manual tracks before ASR, preferred languages in order, else first available
5. Fetch json3 cues (`collectJson3Cues`, `:449`); empty → `null`
6. `parseChaptersFromDescription` (`:510`) + `formatCaptionTranscript` (`:592`) → `{ text, structured }` (speaker-turn `>>` markers / chapters = structured)
7. Any fetch/parse failure → `console.warn(redactError)` + `null`; per-request timeout 30s (`:37`); consent cookies sent unconditionally (`:49`)

## Data Flow

```
main.ts:57,84-91    transcriptCache = new TranscriptCache(app)                                    // .synapse/transcript-cache.json (#488)
                 router = createUrlTranscriptionRouter({ getSettings, processTranscriptText: audio.processTranscriptText,
                                                         extract: video ? video.processUrl(...) : undefined, store: transcriptCache })
                 video.urlTranscriber = (url, parentOp) => router.transcribe(url, { update })   // batch note-media path (#184); store-first like every other consumer

UnifiedTranscriptionModal (openUnifiedTranscriptionModal, open-unified-modal.ts:13; deps built main.ts:203-211)
  enabledModules = { audio: settings.audio.enabled, video: settings.video.enabled }
  onTranscribeFile(file, timeRange?) --> deps.onTranscribeFile  (= AudioModule.transcribeFileToActiveNote(file, timeRange))
  onTranscribeUrl(url, timeRange?, forceRefresh?) --> insertUrlTranscript(deps, url, timeRange, forceRefresh)
                                           (deps.onComplete = audio.onTranscriptionComplete)

NoteMediaModal (transcribeNoteMedia, note-media-transcription.ts:25; deps built main.ts:234-244;
                embeds from findAudioEmbeds / findVideoUrls / findImageEmbeds, each gated by <feature>.enabled)
  onTranscribeAudio(embeds, combine) --> deps.onTranscribeAudio(file, embeds, combine)
                                           (= combine ? AudioModule.transcribeAndInsertCombined : AudioModule.transcribeAndInsert)
  onTranscribeVideo(embeds)          --> deps.onTranscribeVideo?.(file, embeds)  (= VideoModule.transcribeAndInsert; desktop only)
  onExtractImages(embeds)            --> deps.onExtractImages(file, embeds)      (= ImageModule.extractAndInsert)
  ffmpegAvailable                    <-- await deps.isFfmpegAvailable()          (= createFfmpegAvailability(audio.extractor), main.ts:212)

Intake (appendUrlTranscript, insert-url-transcript.ts:89; wired main.ts:72-79 as IntakeDeps.transcribeUrlToNote)
  router.transcribe(url, { update }) --> buildUrlTranscriptBlock(result, url, video.embedInNote) --> vault.process(file) append; rethrows

Other router consumers: summarize transcribeUrl callback (modules/registry.ts summarize entry via ModuleWiring.transcribeUrl), intake (above) — all four entry points (unified modal, note-media batch, summarize, intake) share the ONE router and therefore the one transcript store: any of them populates it and any of them reuses it (#488). Only the unified modal exposes `forceRefresh`; "Clear transcript cache" in the Video settings section (`video/settings-section.ts`) empties the store for every path.
```

`insertUrlTranscript` (`insert-url-transcript.ts`): active note required (`notifications.info` otherwise); `findMatchingRule(path, 'video', settings)` exclusion → Notice naming the rule; `noteQueue.run(activeFile.path, ...)` with `onWait` toast update; `router.transcribe(url, { timeRange, forceRefresh, update })` → `buildUrlTranscriptBlock(result, url, video.embedInNote, timeRange)` → `vault.process` append → `deps.onComplete?.(path)` from inside the slot; `op.finish(withCacheReport('Transcription added to note', [transcriptCacheUse(result)]))` (#527: store hit and/or replayed post-processing); no speech (#524) → `op.finish(noSpeechNotice('this video'))` with no write and no `onComplete`; other errors → `op.error(...)`, never rethrown.

## Module Dependencies

In (type-only where noted):

| Import | From | File | Type-only |
|--------|------|------|-----------|
| `AUDIO_EXTENSIONS` | `../audio` | `unified-modal.ts:3` | no |
| `findAudioEmbeds` | `../audio` | `note-media-transcription.ts:2` | no |
| `AudioEmbed` | `../audio` | `note-media-modal.ts:2`, `note-media-transcription.ts:3` | yes |
| `TranscriptionResult` | `../audio` | `types.ts:2` | yes |
| `findVideoUrls` | `../video` | `note-media-transcription.ts:4` | no (the ONLY runtime `../video` import) |
| `VideoUrlEmbed` | `../video` | `note-media-modal.ts:3`, `note-media-transcription.ts:5` | yes |
| `findImageEmbeds` | `../image` | `note-media-transcription.ts:6` | no |
| `ImageEmbed` | `../image` | `note-media-modal.ts:4`, `note-media-transcription.ts:7` | yes |
| `detectPlatform`, `isSupportedUrl`, `redactError`, `sanitizeUrl`, `isRecord`, `parseJson` | `../shared` | `unified-modal.ts:4`, `caption-strategy.ts:1`, `local-extraction-strategy.ts:2`, `youtube-captions.ts:3` | no |
| `buildCallout`, `buildMediaEmbedLines`, `calloutForTranscriptionResult`, `formatTimeRange` | `../shared` | `url-transcription.ts:2` | no |
| `NoSpeechDetectedError`, `hasSpeechContent`, `isNoSpeechError`, `noSpeechNotice` | `../shared` | `url-transcription.ts`, `caption-strategy.ts`, `local-extraction-strategy.ts`, `insert-url-transcript.ts` | no |
| `findMatchingRule`, `isPathExcluded`, `validateTimeRange`, `loadNodeModules`, `shellEnv` | `../shared` | `insert-url-transcript.ts`, `unified-modal.ts`, `time-range-modal.ts`, `duration-detector.ts` | no |
| `TimeRange`, `NotificationManager`, `NoteOperationQueue`, `CachedTranscript`, `TranscriptCacheEntry` | `../shared` | various | yes |
| `SynapseSettings` | `../settings` | various | yes |
| `requestUrl`, `Platform`, `Modal`, `Setting` | `obsidian` | various | no |
| `App`, `TFile` | `obsidian` | `note-media-transcription.ts:1`, `open-unified-modal.ts:1`, `insert-url-transcript.ts:1` | yes |

Out: consumed by `main.ts` only (`createUrlTranscriptionRouter`, `openUnifiedTranscriptionModal`, `transcribeNoteMedia`, `appendUrlTranscript`; `main.ts:19`). No feature module imports `../transcription`.

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

- `insertUrlTranscript` / `appendUrlTranscript` run the transcript block through `stripUnresolvedLinks` before appending (#581).
- No media decoding or AI calls live here; the caption tier's post-processing and the extraction tier's download/transcribe run inside `audio`/`video` through the injected callbacks
- `insertUrlTranscript` owns the active note's `NoteOperationQueue` slot for the transcribe → append cycle (#483) and must never be called from inside another queued operation on the same note; `appendUrlTranscript` (intake) takes no queue slot and rethrows so the intake note stays un-stamped/retriable
- Tier order is the array order handed to `UrlTranscriptionRouter`; a strategy returning `null` falls through; only a real failure throws; all tiers declining raises `NoTranscriptionPathError`
- The transcript store is consulted BEFORE any tier and written AFTER a tier succeeds, never on failure; `forceRefresh` is the only bypass, always overwrites the entry (#488), and also sets `bypassCache` on the tier's AI post-processing so a re-fetched transcript is never re-cleaned from a replayed AI response (#527). A store hit still honors `timeRange` because the range is part of the key
- A set `timeRange` forces the extraction tier (`CaptionStrategy.canHandle` returns false), so desktop clipping never routes through captions
- `detectPlatform` is imported from `../shared` everywhere (`unified-modal.ts:4` included); the `video` barrel no longer re-exports it. `note-media-modal.ts:2-4` imports `AudioEmbed` / `VideoUrlEmbed` / `ImageEmbed` as `import type`, so the only runtime feature edges are the three note-scanner functions in `note-media-transcription.ts:2-6` and `AUDIO_EXTENSIONS` in `unified-modal.ts:3`
- Both modals take an injected `NotificationManager` and route all user-facing messages through `notifications.info(...)`; `UnifiedTranscriptionModal.notifications` is the 5th constructor param, `NoteMediaModal.notifications` the 6th (before `ffmpegAvailable`)
- Duration detection is desktop-only; mobile always receives `durationSeconds: undefined` and the modal skips the time-range step entirely
- `TimeRangeModal` dismissal is `cancelled` (do nothing), never a default action; the "Transcribe selection" button with an untouched full-range slider settles `full` (`undefined` range downstream)
- `TimeRangeSlider` has no Obsidian Modal/View coupling
- Downloaded → embedded (#561): a `UrlTranscript` with `videoVaultPath` set means the extraction tier wrote a file into the vault, and every consumer of the router (`buildUrlTranscriptBlock`, `video/index.ts` batch path, summarize `fetchContentForUrl`, any future `transcribeUrl` caller) must embed it in the note it worked on through shared `buildMediaEmbedLines(videoVaultPath, video.embedInNote, noteContent?)` — never an inline `![[...]]`; the store persists `videoVaultPath`, so a cached transcript carries it too
