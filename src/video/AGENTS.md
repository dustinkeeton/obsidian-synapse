---
last-updated: 2026-06-19
---

# Video Module

Downloads videos from YouTube/TikTok/Instagram/Twitter via yt-dlp, extracts audio, delegates transcription to AudioModule, optionally saves video to vault. Exposes public methods consumed by the unified transcription UI. Desktop-only: VideoModule is only constructed when `Platform.isDesktop`.

URL platform detection lives in `src/shared/url-detector.ts` (moved out of this module to break the shared-video cycle). Video re-exports `detectPlatform`, `isSupportedUrl`, `Platform`, and `UrlDetectionResult` from `../shared` for back-compat; new code should import them directly from `shared`.

## Public API

Exported from `index.ts`:

```ts
class VideoModule {
  onTranscriptionComplete: ((filePath: string) => void) | null
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    audioModule: AudioModule,
    notifications: NotificationManager,
    checkpointManager: CheckpointManager,
    registrar: CommandRegistrar
  )
  onload(): Promise<void>
  onunload(): void
  transcribeUrl(url: string, parentOp?: { update: (msg: string) => void }): Promise<string>
  processUrl(url: string, options?: VideoProcessOptions, parentOp?: { update: (msg: string) => void }): Promise<TranscriptionResult & { videoVaultPath?: string }>
  transcribeUrlToActiveNote(url: string, timeRange?: TimeRange): Promise<void>
  transcribeAndInsert(noteFile: TFile, embeds: VideoUrlEmbed[]): Promise<void>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
}

class AudioExtractor {
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
function isSupportedUrl(url: string): boolean
type Platform = 'youtube' | 'tiktok' | 'instagram' | 'twitter' | 'unknown'
interface UrlDetectionResult { platform: Platform; videoId: string; url: string }

// Owned by this module
function findVideoUrls(content: string): VideoUrlEmbed[]
function hasTranscriptionBelow(lines: string[], embedLine: number, url: string): boolean

// Settings renderer (#243)
function renderVideoSettings(ctx: SettingsSectionContext): void

// Types
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

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `VideoProcessOptions`, `ExtractionResult`, `VideoMetadata`, `VideoUrlEmbed`, `VideoSource` | Type definitions |
| `note-scanner.ts` | `findVideoUrls`, `hasTranscriptionBelow` | Scan note content for video URLs |
| `note-scanner.test.ts` | Tests | Note scanner unit tests |
| `audio-extractor.ts` | `AudioExtractor` | yt-dlp/ffmpeg via `execFile` (no shell); URL download, file extract, clip, concat, dependency check |
| `audio-extractor.test.ts` | Tests | AudioExtractor unit tests |
| `frame-extractor.ts` | `FrameExtractor` | Placeholder; throws on use (unimplemented) |
| `settings-section.ts` | `renderVideoSettings` | Video settings accordion renderer for settings-tab.ts |
| `settings-section.test.ts` | Tests | Settings section tests |
| `mobile-safety.test.ts` | Tests | Desktop-only guard tests |
| `index.ts` | `VideoModule` | Orchestrator; public API barrel |
| `index.test.ts` | Tests | VideoModule integration tests |

## Data Flow

```
1. User triggers via UnifiedTranscriptionModal or NoteMediaModal (in transcription/)
   |
2a. transcribeUrlToActiveNote(url, timeRange?) -- single URL to active note
   |  Checks path exclusion (#307); calls processUrl; builds callout; appends to note
   |
2b. transcribeAndInsert(noteFile, embeds) -- batch from note scan
   |  Creates checkpoint; processes embeds in reverse line order; 2s delay between
   |  API calls; atomic splice via vault.process; cancellable via NotificationManager
   |
2c. transcribeUrl(url, parentOp) -- returns transcript text only
   |  Used by SummarizeModule to auto-transcribe video URLs before summarizing
   |
3. sanitizeUrl(url) -- validates HTTP(S), rejects shell chars
   |
4. detectPlatform(url) [from shared/url-detector.ts]
   |  YouTube: youtube.com/watch, youtu.be, youtube.com/shorts|embed|live
   |  TikTok: tiktok.com/@user/video/id, tiktok.com/t/..., vm/vt.tiktok.com
   |  Instagram: instagram.com/reel|reels|p/CODE
   |  Twitter/X: (mobile.)twitter.com|x.com/.../status/id
   |  isSupportedUrl() returns true for all detected platforms EXCEPT twitter
   |
5. AudioExtractor.extractFromUrl(url)
   |  getMetadata() --> yt-dlp --dump-json --no-download
   |  Download audio --> yt-dlp -x --audio-format mp3
   |  Tool paths via sanitizePath(), env via shellEnv()
   |
5a. [if timeRange] AudioExtractor.clipAudio(audioPath, startSeconds, endSeconds)
   |  ffmpeg -ss/-to; cleans up original unclipped audio
   |
6. downloadVideoToVault() [if video.downloadFolder configured]
   |  AudioExtractor.downloadVideo() --> yt-dlp -f mp4/best to tmp
   |  vault.createBinary() with collision-safe path; cleans up temp file
   |
7. AudioModule.transcribe(audioData, fileName, { sourceName })
   |
8. Result wrapped in callout block + optional video embed (![[file.mp4]])
```

## Note Scanning

`findVideoUrls(content)` in `note-scanner.ts` (index.ts:L25):
- Regex: `/https?:\/\/[^\s)\]>]+/g`
- Skips blockquote lines (transcription output, `>` prefix)
- Skips Twitter/X URLs (`detected.platform === 'twitter'`)
- Skips URLs with existing transcription callout within 3 lines below
- Returns `VideoUrlEmbed[]` with line numbers

`hasTranscriptionBelow(lines, embedLine, url)` checks legacy `**Transcription of ...**` and callout formats.

## Commands Registered

| Command ID | Enabled condition | Description |
|-----------|------------------|-------------|
| `synapse:check-dependencies` | `video.enabled` | Check yt-dlp and ffmpeg availability |

Transcription commands are registered in `main.ts` (not here):
- `synapse:transcribe-media` -> `VideoModule.transcribeUrlToActiveNote` via `UnifiedTranscriptionModal`
- `synapse:transcribe-note-media` -> `VideoModule.transcribeAndInsert` via `NoteMediaModal`

## Settings Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `video.enabled` | `boolean` | `false` | Feature gate |
| `video.ytDlpPath` | `string` | `'yt-dlp'` | yt-dlp binary path |
| `video.ffmpegPath` | `string` | `'ffmpeg'` | ffmpeg binary path |
| `video.tempFolder` | `string` | - | Vault folder for temp audio extraction |
| `video.downloadFolder` | `string` | `''` | Vault folder to save downloaded videos (empty = do not save) |
| `video.embedInNote` | `boolean` | `false` | Add `![[video.mp4]]` embed to note when saving video |

## External Runtime Dependencies

| Tool | Setting key | Default | Purpose |
|------|-------------|---------|---------|
| yt-dlp | `video.ytDlpPath` | `'yt-dlp'` | Video download and metadata |
| ffmpeg | `video.ffmpegPath` | `'ffmpeg'` | Audio extraction, clipping, concatenation |

`shellEnv()` appends `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin` to PATH.
`execFile` timeout: 300s; maxBuffer: 10MB.

## Module Dependencies

In:
- `../audio` — `AudioModule`, `TranscriptionResult`
- `../shared` — `CheckpointManager`, `NotificationManager`, `CommandRegistrar`, `sanitizeUrl`, `sanitizePath`, `buildCallout`, `calloutForTranscriptionResult`, `ensureFolder`, `formatTimeRange`, `detectPlatform`, `isSupportedUrl`, `loadNodeModules`, `shellEnv`, `isPathExcluded`, `findMatchingRule`, `generateId`, `TimeRange`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask`

Out (consumed by):
- `src/transcription/` — `UnifiedTranscriptionModal`, `NoteMediaModal` import `VideoUrlEmbed`, `detectPlatform` from here
- `src/summarize/` — imports `transcribeUrl` behavior via `VideoModule` instance

## Security

- URLs validated via `sanitizeUrl()` (called in both `VideoModule.processUrl` and `AudioExtractor.extractFromUrl`)
- Tool paths validated via `sanitizePath()`
- All subprocess calls use `execFile` with explicit argument arrays (no shell interpolation)

## Invariants / Gotchas

- Desktop-only: `loadNodeModules()` throws `DesktopOnlyError` off-desktop; VideoModule is only constructed after `Platform.isDesktop` check in `main.ts`
- `FrameExtractor` in `frame-extractor.ts` is a placeholder and throws on use
- `AudioExtractor.concatAudio` re-encodes via ffmpeg filter (handles mixed formats: mp3/wav/m4a/ogg/flac/webm/aac)
- `downloadVideoToVault` uses `vault.createBinary()` (not adapter API) for first-class vault citizenship; collision-safe naming appends `-1`, `-2`, etc.
- Back-compat re-exports: `detectPlatform`, `isSupportedUrl`, `Platform`, `UrlDetectionResult` are re-exported from `../shared`; direct `shared` imports preferred in new code
