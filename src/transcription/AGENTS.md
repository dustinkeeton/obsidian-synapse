---
last-updated: 2026-06-29
---

# Transcription Module

UI-only module providing unified transcription modals with duration-aware time-range clipping. Imports types and delegates all media processing work to the `audio`, `video`, and `image` modules. No transcription logic lives here.

## Public API

Re-exported from the `index.ts` barrel (`index.ts:L1`). `NodeDeps` is the one
exception: it is a module-level export of `duration-detector.ts` (`duration-detector.ts:L46`),
not re-exported by the barrel; it is only the type of the optional `deps?` param.

```ts
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

function showTimeRangeToast(options: TimeRangeToastOptions): Promise<TimeRange | undefined>

interface TimeRangeToastOptions {
  title: string
  duration: number
}

function detectLocalFileDuration(
  file: TFile,
  readBinary: (file: TFile) => Promise<ArrayBuffer>,
  getSettings: () => SynapseSettings,
  deps?: NodeDeps
): Promise<DurationResult>

function detectUrlDuration(
  url: string,
  getSettings: () => SynapseSettings,
  deps?: NodeDeps
): Promise<DurationResult>

function formatTimestamp(totalSeconds: number): string

const MIN_SLIDER_DURATION: number  // 10 seconds

interface DurationResult {
  durationSeconds: number | undefined
  title: string
}

type NodeDeps = NodeModules  // injection seam for tests; alias of shared NodeModules (not barrel-exported)
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `unified-modal.ts` | `UnifiedTranscriptionModal` | File picker + URL input modal with duration detection, platform badge, time-range slider |
| `note-media-modal.ts` | `NoteMediaModal` | Selection modal for media found in current note; audio/video/image toggles; combine-audio option |
| `time-range-slider.ts` | `TimeRangeSlider`, `TimeRangeSliderOptions` | Dual-handle range slider (pure DOM, no Obsidian deps beyond createEl) |
| `time-range-toast.ts` | `showTimeRangeToast`, `TimeRangeToastOptions` | Non-dismissible Notice with embedded TimeRangeSlider |
| `duration-detector.ts` | `detectLocalFileDuration`, `detectUrlDuration`, `formatTimestamp`, `MIN_SLIDER_DURATION`, `DurationResult`, `NodeDeps` | Duration detection via ffprobe (local) and yt-dlp (URL); desktop-only, mobile returns undefined |
| `duration-detector.test.ts` | Tests | Duration detector unit tests with NodeDeps injection |
| `note-media-modal.test.ts` | Tests | NoteMediaModal unit tests |
| `index.ts` | Re-exports | Barrel file |

## UnifiedTranscriptionModal

Single modal combining audio file selection and video URL input (`unified-modal.ts`):
- Local-file section rendered only when `enabledModules.audio || enabledModules.video` (`unified-modal.ts:L38`)
- Dropdown lists all audio files in vault (filtered by `AUDIO_EXTENSIONS`, honors audio path exclusions via `isPathExcluded(path, 'audio', settings)`, #323)
- URL section rendered only when `enabledModules.video && Platform.isDesktop` (`unified-modal.ts:L75`)
- URL text field with platform detection badge (`detectPlatform`); unknown non-empty input shows "Unsupported URL"
- File selection and URL input are mutually exclusive (setting one clears the other)
- On submit (`handleTranscribe`, `unified-modal.ts:L119`): rejects a URL that fails `detectPlatform` via `notifications.info` ("Unsupported URL"); empty input prompts to select a file or enter a URL; on mobile transcribes full file/URL (no duration step); on desktop attempts duration detection (ffprobe for files, yt-dlp for URLs)
  - Duration >= `MIN_SLIDER_DURATION` (10s): shows `showTimeRangeToast`
  - Duration defined but < 10s: transcribes full file (no slider)
  - Duration unknown: shows fallback text-input toast (`showFallbackTextInputToast`, MM:SS/HH:MM:SS manual entry via `validateTimeRange`)
- Callbacks receive `timeRange?: TimeRange` (undefined = full file)

Opened by `main.ts`: ribbon icon `synapse-transcribe` (desktop only) and command `synapse:transcribe-media` (plain `callback`; registration gated on a transcription module being enabled).

## NoteMediaModal

Selection modal for media embedded in the current note (`note-media-modal.ts`):
- Displays count of audio files, video URLs, and images found
- Toggle checkboxes per embed (audio, video, image sections)
- "Select all" / "Select none" buttons
- "Combine audio" toggle (#214): shown for 2+ audio embeds; with ffmpeg concatenates audio before transcribing (single API call); without ffmpeg merges text transcriptions
  - `ffmpegAvailable` param controls the toggle description text only; actual concat logic is in `AudioModule`
  - `combine` is passed true only when the toggle is on AND 2+ audio files are actually selected (`combine = this.combineAudio && chosenAudio.length >= 2`, `note-media-modal.ts:L111`)
  - `onTranscribeAudio` receives `combine: boolean` as second arg; caller decides behavior
- "Process selected" dispatches to separate audio/video/image callbacks

Opened by `main.ts` (`transcribeMediaFromNote`) via command `synapse:transcribe-note-media` (`editorCallback`; scans the active note's embeds, no-ops with a notice when none found).

## Duration Detection

`duration-detector.ts` — both functions return early with `{ durationSeconds: undefined }` on mobile (`!Platform.isDesktop`).

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

## Time-Range Toast

`showTimeRangeToast()` (`time-range-toast.ts`): non-dismissible Obsidian Notice (duration = 0):
- Title display
- Embedded `TimeRangeSlider` spanning full duration
- "Transcribe selection" button: resolves `TimeRange` only if range was adjusted from full; resolves `undefined` if full range unchanged
- "Full file" button: resolves `undefined`
- Background click blocked via capture-phase listener; button/input clicks pass through

## Data Flow

```
main.ts constructs modals and wires callbacks (main.ts:L543, main.ts:L580):

UnifiedTranscriptionModal (openUnifiedModal)
  enabledModules = { audio: settings.audio.enabled,
                     video: settings.video.enabled && this.video !== null }
  onTranscribeFile(file, timeRange?) --> AudioModule.transcribeFileToActiveNote(file, timeRange)
  onTranscribeUrl(url, timeRange?)   --> VideoModule.transcribeUrlToActiveNote(url, timeRange)
                                         (no-op when video module absent)

NoteMediaModal (transcribeMediaFromNote; embeds from findAudioEmbeds/findVideoUrls/findImageEmbeds)
  onTranscribeAudio(embeds, combine) --> combine
                                           ? AudioModule.transcribeAndInsertCombined(file, embeds)
                                           : AudioModule.transcribeAndInsert(file, embeds)
  onTranscribeVideo(embeds)          --> VideoModule.transcribeAndInsert(file, embeds)
  onExtractImages(embeds)            --> ImageModule.extractAndInsert(file, embeds)
  ffmpegAvailable                    <-- await main.isFfmpegAvailable()
```

## Module Dependencies

In (all imports; type-only where noted):

| Import | From | Type-only |
|--------|------|-----------|
| `AUDIO_EXTENSIONS` | `../audio` | no (runtime constant) |
| `AudioEmbed` | `../audio` | yes |
| `detectPlatform` | `../video` | no (runtime function) |
| `VideoUrlEmbed` | `../video` | yes |
| `ImageEmbed` | `../image` | yes |
| `TimeRange` | `../shared` | yes |
| `NotificationManager` | `../shared` | yes |
| `sanitizePath`, `sanitizeUrl`, `validateTimeRange`, `isPathExcluded` | `../shared` | no |
| `loadNodeModules`, `shellEnv`, `isRecord`, `parseJson` | `../shared` | no |
| `SynapseSettings` | `../settings` | yes |

Out: nothing — this module is consumed only by `main.ts` (modal construction) and has no downstream module consumers.

## Settings Keys Referenced

| Key | Source module | Used by |
|-----|--------------|---------|
| `audio.postProcessing.enabled` | audio | `UnifiedTranscriptionModal` (display only) |
| `video.ffmpegPath` | video | `detectLocalFileDuration` (derives ffprobe path) |
| `video.ytDlpPath` | video | `detectUrlDuration` |
| Folder exclusion rules | shared | `UnifiedTranscriptionModal` file filter (#323) |

## Invariants / Gotchas

- This module contains NO transcription logic; it is a pure UI delegation layer
- `detectPlatform` is imported from `../video` (not `../shared` directly); `../video` re-exports it from `../shared` for back-compat
- `NoteMediaModal` constructor signature changed: added `ffmpegAvailable?: boolean` parameter and `onTranscribeAudio` callback now receives `combine: boolean` as second arg (#214)
- Both modals take an injected `NotificationManager` and route all user-facing messages through `notifications.info(...)` instead of constructing `Notice` directly; `UnifiedTranscriptionModal.notifications` is the 5th constructor param, `NoteMediaModal.notifications` is the 6th (before `ffmpegAvailable`)
- Duration detection is desktop-only; mobile always receives `durationSeconds: undefined` (graceful degradation to full-file transcription)
- `TimeRangeSlider` has no Obsidian Modal/View coupling — safe to embed in Notice DOM
- `showTimeRangeToast` resolves `undefined` (not a `TimeRange`) when the user clicks "Transcribe selection" with the slider at its default full-range position
