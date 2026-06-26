---
last-updated: 2026-06-25
---

# Video Module

Downloads videos from YouTube/TikTok/Instagram via yt-dlp, extracts audio with ffmpeg, delegates transcription to AudioModule, and optionally saves the video file into the vault. Desktop-only: VideoModule is constructed only when `Platform.isDesktop` (it may be null off-desktop).

URL platform detection lives in `src/shared/url-detector.ts` (moved out of this module to break the shared/video cycle). Video re-exports `detectPlatform`, `isSupportedUrl`, `Platform`, and `UrlDetectionResult` for back-compat; new code should import them directly from `shared`.

## Public API

Re-exported from `index.ts` (the module barrel):

```ts
class VideoModule {
  onTranscriptionComplete: ((filePath: string) => void) | null  // index.ts:L31
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    audioModule: AudioModule,
    notifications: NotificationManager,
    checkpointManager: CheckpointManager,
    registrar: CommandRegistrar
  )                                                              // index.ts:L33
  onload(): Promise<void>                                        // index.ts:L44
  onunload(): void                                               // index.ts:L55
  transcribeUrl(url: string, parentOp?: { update: (msg: string) => void }): Promise<string>  // index.ts:L62
  processUrl(url: string, options?: VideoProcessOptions, parentOp?: { update: (msg: string) => void }): Promise<TranscriptionResult & { videoVaultPath?: string }>  // index.ts:L70
  transcribeUrlToActiveNote(url: string, timeRange?: TimeRange): Promise<void>  // index.ts:L149
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>    // index.ts:L208
  transcribeAndInsert(noteFile: TFile, embeds: VideoUrlEmbed[]): Promise<void>  // index.ts:L216
}

class AudioExtractor {                                           // audio-extractor.ts:L152
  constructor(getSettings: () => SynapseSettings)
  extractFromUrl(url: string): Promise<ExtractionResult>
  extractFromFile(filePath: string): Promise<ExtractionResult>
  downloadVideo(url: string): Promise<string>
  clipAudio(inputPath: string, startSeconds: number, endSeconds: number): Promise<string>
  concatAudio(inputPaths: string[]): Promise<string>
  checkDependencies(): Promise<{ ytDlp: boolean; ffmpeg: boolean }>
}

// Re-exported from ../shared (canonical home: shared/url-detector.ts)
function detectPlatform(url: string): UrlDetectionResult | null
function isSupportedUrl(url: string): boolean   // true for detected platforms EXCEPT twitter
type Platform = 'youtube' | 'tiktok' | 'instagram' | 'twitter' | 'unknown'
interface UrlDetectionResult { platform: Platform; videoId: string; url: string }

// Owned by this module
function findVideoUrls(content: string): VideoUrlEmbed[]   // re-exported via index.ts:L25
function renderVideoSettings(ctx: SettingsSectionContext): void  // re-exported via index.ts:L432

// Types (re-exported index.ts:L15-L22)
interface VideoProcessOptions {
  postProcess?: boolean
  extractFrames?: boolean
  outputPath?: string
  insertMode?: boolean
  timeRange?: TimeRange
}
interface ExtractionResult { audioPath: string; metadata: VideoMetadata }
interface VideoMetadata {
  title: string
  channel?: string
  duration?: number
  uploadDate?: string
  description?: string
  platform?: string
  url?: string
}
interface VideoUrlEmbed { url: string; platform: Platform; line: number }
interface VideoSource {
  type: 'url' | 'file'
  platform?: Platform
  url?: string
  filePath?: string
  title?: string
  channel?: string
  duration?: number
}
```

Exported by source files but NOT re-exported through `index.ts`:

```ts
class DependencyMissingError extends Error {   // audio-extractor.ts:L45
  readonly tool: 'yt-dlp' | 'ffmpeg'
}
function hasTranscriptionBelow(lines: string[], embedLine: number, url: string): boolean  // note-scanner.ts:L36
class FrameExtractor {                          // frame-extractor.ts:L6 — placeholder, throws on use
  constructor(getSettings: () => SynapseSettings)
  extractFrames(videoPath: string): Promise<string[]>
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `VideoProcessOptions`, `ExtractionResult`, `VideoMetadata`, `VideoUrlEmbed`, `VideoSource`, re-export `Platform` | Type definitions |
| `note-scanner.ts` | `findVideoUrls`, `hasTranscriptionBelow` | Scan note content for video URLs |
| `note-scanner.test.ts` | Tests | Note scanner unit tests |
| `audio-extractor.ts` | `AudioExtractor`, `DependencyMissingError` | yt-dlp/ffmpeg via `execFile` (no shell); URL download, file extract, clip, concat, dependency check, no-audio detection |
| `audio-extractor.test.ts` | Tests | AudioExtractor unit tests |
| `frame-extractor.ts` | `FrameExtractor` | Placeholder; `extractFrames` throws unless disabled (unimplemented) |
| `settings-section.ts` | `renderVideoSettings` | Video settings accordion renderer for settings-tab.ts |
| `settings-section.test.ts` | Tests | Settings section tests |
| `mobile-safety.test.ts` | Tests | Desktop-only guard tests |
| `index.ts` | `VideoModule` | Orchestrator; public API barrel |
| `index.test.ts` | Tests | VideoModule integration tests |

## Data Flow

```
1. User triggers via UnifiedTranscriptionModal or NoteMediaModal (src/transcription/)
   |
2a. transcribeUrlToActiveNote(url, timeRange?) -- single URL to active note
   |  Checks path exclusion via findMatchingRule (#307); calls processUrl;
   |  builds callout; appends via vault.process; fires onTranscriptionComplete
   |
2b. transcribeAndInsert(noteFile, embeds) -- batch from note scan
   |  isPathExcluded silent skip (#307); creates checkpoint; processes embeds in
   |  reverse line order; 2s delay between API calls; atomic splice via
   |  vault.process; cancellable via NotificationManager operation
   |
2c. transcribeUrl(url, parentOp) -- returns transcript text only
   |  processUrl({ insertMode:false }); used by SummarizeModule
   |
3. sanitizeUrl(url) -- validates HTTP(S), rejects shell chars (processUrl + extractFromUrl)
   |
4. detectPlatform(url) [shared/url-detector.ts]; platform defaults to 'unknown'
   |  YouTube: youtube.com/watch, youtu.be, youtube.com/shorts|embed|live
   |  TikTok: tiktok.com/@user/video/id, tiktok.com/t/..., vm/vt.tiktok.com
   |  Instagram: instagram.com/reel|reels|p/CODE
   |  Twitter/X: (mobile.)twitter.com|x.com/.../status/id (NOT supported)
   |
5. AudioExtractor.extractFromUrl(url)
   |  dumpJson() --> yt-dlp --dump-json --no-download (never throws; null on failure)
   |  toMetadata() builds VideoMetadata (fallback title 'Untitled')
   |  isNoAudioPost() proactive slideshow check --> throws NoAudioError
   |  yt-dlp -x --audio-format mp3 (retry once with -f bestaudio/best on soft failure)
   |  Tool paths via sanitizePath(); env via shellEnv(); --ffmpeg-location only when concrete path
   |
5a. [if timeRange] AudioExtractor.clipAudio(audioPath, startSeconds, endSeconds)
   |  ffmpeg -ss/-to -vn -acodec libmp3lame; deletes original unclipped audio;
   |  endSeconds > metadata.duration throws before clipping
   |
6. downloadVideoToVault() [if video.downloadFolder set]
   |  AudioExtractor.downloadVideo() --> yt-dlp -f mp4/best to OS tmp
   |  vault.createBinary() with collision-safe path; deletes temp file
   |
7. AudioModule.transcribe(audioData.buffer, title + '.mp3', { sourceName: title })
   |  temp audio file deleted afterward
   |
8. Result wrapped in callout (calloutForTranscriptionResult + buildCallout);
   optional ![[file.mp4]] embed when video.embedInNote and a video was saved
```

## Note Scanning

`findVideoUrls(content)` in `note-scanner.ts:L7`:
- Regex: `/https?:\/\/[^\s)\]>]+/g`
- Skips blockquote lines (`>` prefix — transcription output, not user content)
- Skips undetected URLs and `detected.platform === 'twitter'`
- Skips URLs with an existing transcription callout within 3 lines below
- Returns `VideoUrlEmbed[]` with line numbers

`hasTranscriptionBelow(lines, embedLine, url)` (`note-scanner.ts:L36`) matches the legacy `**Transcription of ...**` and the `[!<CALLOUT_TYPES.transcription>]` callout formats.

## Commands Registered

| Command ID | Enabled condition | Registry name |
|-----------|------------------|---------------|
| `synapse:check-dependencies` | `video.enabled` | Check external tool availability |

Registered via `registrar.register('check-dependencies', ...)` (index.ts:L50); Obsidian prefixes the manifest id with `synapse:`. The handler reports yt-dlp/ffmpeg presence and brew install hints. Transcription palette commands (`transcribe-media`, `transcribe-note-media`) are wired in `main.ts`, not here.

## Settings Keys (VideoSettings, settings.ts:L100)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `video.enabled` | `boolean` | `true` | Feature gate |
| `video.ytDlpPath` | `string` | `'yt-dlp'` | yt-dlp binary path (bare name = PATH lookup) |
| `video.ffmpegPath` | `string` | `'ffmpeg'` | ffmpeg binary path (bare name = PATH lookup) |
| `video.tempFolder` | `string` | `'.synapse/temp'` | Vault folder ensured on load for temp work |
| `video.downloadFolder` | `string` | `'Media'` | Vault folder to save downloaded videos (empty = do not save) |
| `video.embedInNote` | `boolean` | `true` | Add `![[video.mp4]]` embed to note when a video is saved |
| `video.frameExtraction.enabled` | `boolean` | `false` | Frame extraction gate (unimplemented) |
| `video.frameExtraction.intervalSeconds` | `number` | `30` | Seconds between extracted frames |
| `video.frameExtraction.visionModel` | `string` | `'gpt-4o'` | Vision model for frame analysis |
| `video.frameExtraction.maxFrames` | `number` | `20` | Max frames to extract |

Settings UI: `renderVideoSettings` (`settings-section.ts:L144`) renders the accordion; `addPathSetting` attaches per-OS install-help panels (#382/#383) to the yt-dlp and ffmpeg path fields. Invoked only on desktop by `settings-tab.ts`.

## External Runtime Dependencies

| Tool | Setting key | Default | Purpose |
|------|-------------|---------|---------|
| yt-dlp | `video.ytDlpPath` | `'yt-dlp'` | Video download and `--dump-json` metadata |
| ffmpeg (incl. ffprobe) | `video.ffmpegPath` | `'ffmpeg'` | Audio extraction, clipping, concatenation |

`shellEnv()` prepends `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` ahead of the existing PATH. `execFile` timeout: 300s; maxBuffer: 10MB (audio-extractor.ts:L438). No shell is invoked (explicit argument arrays).

## Module Dependencies

In:
- `../audio` — `AudioModule` (runtime value edge: reuses the transcription pipeline), `TranscriptionResult` (type)
- `../commands` — `CommandRegistrar`
- `../shared` — `ensureFolder`, `NotificationManager`, `sanitizeUrl`, `buildCallout`, `calloutForTranscriptionResult`, `CheckpointManager`, `generateId`, `formatTimeRange`, `detectPlatform`, `loadNodeModules`, `isPathExcluded`, `findMatchingRule`, `TimeRange`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask` (index.ts); `sanitizePath`, `describeNetworkError`, `isRecord`, `parseJson`, `shellEnv`, `NodeModules` (audio-extractor.ts); `CALLOUT_TYPES` (note-scanner.ts); `SettingsSectionContext` (settings-section.ts)
- `../settings` — `SynapseSettings`, `VideoSettings`, `FrameExtractionSettings` (types)

Out (consumed by):
- `src/transcription/note-media-modal.ts` — imports `VideoUrlEmbed`
- `src/transcription/unified-modal.ts` — imports `detectPlatform`
- `src/audio/index.ts` — imports `type AudioExtractor` (type-only; no runtime cycle)

VideoModule → AudioModule is the one documented cross-feature runtime dependency; the reverse edge is type-only.

## Error States

| Condition | Behavior |
|-----------|----------|
| Missing yt-dlp/ffmpeg (ENOENT, or ffmpeg/ffprobe stderr signature) | `DependencyMissingError` (carries `tool`); rethrown untouched through processUrl/summarize so callers can show an "Open settings" notice (#382) |
| TikTok photo slideshow / no audio stream | `NoAudioError` (internal); proactive from `--dump-json` (`isNoAudioPost`) and reactive from ffprobe `unable to obtain file audio codec` stderr |
| Network failure | `describeNetworkError`-classified message; not retried |
| Subprocess timeout (>5 min, SIGTERM) | `Error('<tool> timed out after 5 minutes')` |
| Other download/extract failure | Wrapped `Error('Download/audio extraction failed: ...')` after one looser-format retry |
| `endSeconds > metadata.duration` | Throws before clipping |
| Transcription failure | Wrapped `Error('Transcription failed: ...')` |
| No active file (transcribeUrlToActiveNote) | Info notice; returns without error |
| Path excluded (#307) | transcribeUrlToActiveNote: named notice; transcribeAndInsert: silent skip |

## Invariants / Gotchas

- Desktop-only: `loadNodeModules()` throws `DesktopOnlyError` off-desktop; VideoModule is constructed only after `Platform.isDesktop` in `main.ts` and may be null. AudioExtractor also asserts desktop at first fs/subprocess access.
- `FrameExtractor` (`frame-extractor.ts`) is a placeholder: `extractFrames` returns `[]` when disabled, otherwise throws "not yet implemented".
- `AudioExtractor.concatAudio` re-encodes via the ffmpeg concat filter (handles mixed mp3/wav/m4a/ogg/flac/webm/aac).
- `--ffmpeg-location` is emitted only when `ffmpegPath` is a concrete path (contains `/` or `\`); a bare name relies on PATH discovery.
- `downloadVideoToVault` uses `vault.createBinary()` (not the adapter API); collision-safe naming appends `-1`, `-2`, ... before the extension.
- Back-compat re-exports (`detectPlatform`, `isSupportedUrl`, `Platform`, `UrlDetectionResult`) come from `../shared`; prefer direct `shared` imports in new code.

## Security

- URLs validated via `sanitizeUrl()` in both `VideoModule.processUrl` and `AudioExtractor` entry points.
- Tool and file paths validated via `sanitizePath()`.
- All subprocess calls use `execFile` with explicit argument arrays — no shell interpolation.
