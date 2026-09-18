---
last-updated: 2026-09-17
---

# Video Module

Downloads videos from YouTube/TikTok/Instagram via yt-dlp, extracts audio with ffmpeg, delegates transcription to AudioModule, and optionally saves the video file into the vault. Desktop-only: VideoModule is constructed only when `Platform.isDesktop` (it may be null off-desktop).

URL platform detection lives in `src/shared/url-detector.ts` (moved out of this module to break the shared/video cycle). Video re-exports `detectPlatform`, `isSupportedUrl`, `Platform`, and `UrlDetectionResult` for back-compat; new code should import them directly from `shared`.

## Public API

Re-exported from `index.ts` (the module barrel):

```ts
class VideoModule {
  onTranscriptionComplete: ((filePath: string) => void) | null  // index.ts:42
  urlTranscriber: RoutedUrlTranscriber | null                   // index.ts:50; set by modules/registry.ts so the batch insert uses the tier router (#184)
  constructor(deps: ModuleDeps, audioModule: AudioModule)        // index.ts:52; deps = plugin, getSettings, notifications, checkpointManager, registrar, noteQueue (#483)
  onload(): Promise<void>                                        // index.ts:63
  onunload(): void                                               // index.ts:74
  processUrl(url: string, options?: VideoProcessOptions, parentOp?: { update: (msg: string) => void }): Promise<TranscriptionResult & { videoVaultPath?: string }>  // index.ts:76
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>    // index.ts:156
  transcribeAndInsert(noteFile: TFile, embeds: VideoUrlEmbed[]): Promise<void>  // index.ts:164; acquires noteFile's queue slot (#483), then delegates
}
```

`transcribeUrl` and `transcribeUrlToActiveNote` no longer exist on `VideoModule`. URL
transcription moved to `src/transcription/`: the tier routing lives in
`UrlTranscriptionRouter` and the active-note insert in `insertUrlTranscript`
(`src/transcription/insert-url-transcript.ts`) — see `src/transcription/AGENTS.md`. Only
`processUrl` remains here, as the download+extract tier the router calls through
`LocalExtractionStrategy`; it returns text and writes no note.

```ts
class AudioExtractor {                                           // audio-extractor.ts:184
  constructor(getSettings: () => SynapseSettings)
  extractFromUrl(url: string): Promise<ExtractionResult>
  extractFromFile(filePath: string): Promise<ExtractionResult>
  downloadVideo(url: string): Promise<string>
  clipAudio(inputPath: string, startSeconds: number, endSeconds: number): Promise<string>
  concatAudio(inputPaths: string[]): Promise<string>
  checkDependencies(): Promise<{ ytDlp: boolean; ffmpeg: boolean }>
}

// ffmpeg-availability.ts:4 — memoized `extractor.checkDependencies().ffmpeg` probe (#214); always false without an extractor (mobile); probe failure caches false
function createFfmpegAvailability(extractor: AudioExtractor | undefined): () => Promise<boolean>

// Re-exported from ../shared (canonical home: shared/url-detector.ts)
function detectPlatform(url: string): UrlDetectionResult | null
function isSupportedUrl(url: string): boolean   // true for detected platforms EXCEPT twitter
type Platform = 'youtube' | 'tiktok' | 'instagram' | 'twitter' | 'unknown'
interface UrlDetectionResult { platform: Platform; videoId: string; url: string }

// Owned by this module
function findVideoUrls(content: string): VideoUrlEmbed[]   // re-exported via index.ts:29
function renderVideoSettings(ctx: SettingsSectionContext): void  // re-exported via index.ts:383

// Types (re-exported index.ts:16-24)
interface VideoProcessOptions {
  postProcess?: boolean
  extractFrames?: boolean
  outputPath?: string
  insertMode?: boolean
  timeRange?: TimeRange
  bypassCache?: boolean          // types.ts:24; forwarded to AudioModule.transcribe as TranscribeOptions.bypassCache (index.ts:139, #527)
}
interface RoutedUrlTranscript {  // types.ts:54; structurally compatible with transcription's UrlTranscript, declared here to avoid a video -> transcription import
  text: string
  videoVaultPath?: string
  reformatted?: boolean
  schemaId?: string
  cached?: boolean               // served from the transcript store (#488)
  aiCached?: boolean             // fresh transcript whose AI post-processing replayed a cached response (#527)
}
type RoutedUrlTranscriber = (url: string, parentOp?: { update: (message: string) => void }) => Promise<RoutedUrlTranscript>  // types.ts:69; throws when no tier can handle the URL
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

Private (index.ts), documented because it is the queue-free core of `transcribeAndInsert`:

```ts
private insertTranscriptions(noteFile: TFile, embeds: VideoUrlEmbed[], op: OperationHandle): Promise<void>  // index.ts:183
```

Exported by source files but NOT re-exported through `index.ts`:

```ts
class DependencyMissingError extends Error {   // audio-extractor.ts:77
  readonly tool: 'yt-dlp' | 'ffmpeg'
}
class AudioCodecReadError extends Error {}     // audio-extractor.ts:57; ffprobe could not read the audio codec
function hasTranscriptionBelow(lines: string[], embedLine: number, url: string): boolean  // note-scanner.ts:36
class FrameExtractor {                          // frame-extractor.ts:6 — placeholder, throws on use
  constructor(getSettings: () => SynapseSettings)
  extractFrames(videoPath: string): Promise<string[]>
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `VideoProcessOptions`, `ExtractionResult`, `VideoMetadata`, `VideoUrlEmbed`, `VideoSource`, `RoutedUrlTranscript`, `RoutedUrlTranscriber`, re-export `Platform` | Type definitions |
| `note-scanner.ts` | `findVideoUrls`, `hasTranscriptionBelow` | Scan note content for video URLs |
| `note-scanner.test.ts` | Tests | Note scanner unit tests |
| `audio-extractor.ts` | `AudioExtractor`, `DependencyMissingError`, `AudioCodecReadError` | yt-dlp/ffmpeg via `execFile` (no shell); URL download, file extract, clip, concat, dependency check, no-audio detection |
| `audio-extractor.test.ts` | Tests | AudioExtractor unit tests |
| `ffmpeg-availability.ts` | `createFfmpegAvailability` | Memoized ffmpeg probe factory; consumed by `main.ts:205` as `NoteMediaTranscriptionDeps.isFfmpegAvailable` (combine-audio gate in `NoteMediaModal`) |
| `ffmpeg-availability.test.ts` | Tests | Memoization, no-extractor false, probe-failure false |
| `frame-extractor.ts` | `FrameExtractor` | Placeholder; `extractFrames` throws unless disabled (unimplemented) |
| `settings-section.ts` | `renderVideoSettings` | Video settings accordion renderer for settings-tab.ts |
| `settings-section.test.ts` | Tests | Settings section tests |
| `mobile-safety.test.ts` | Tests | Desktop-only guard tests |
| `index.ts` | `VideoModule` | Orchestrator; public API barrel; serializes the batch note insert through the shared `NoteOperationQueue` (private `insertTranscriptions` is the queue-free core, #483) |
| `index.test.ts` | Tests | VideoModule integration tests |
| `transcribe-and-insert.test.ts` | Tests | `transcribeAndInsert` tier routing (#184: injected transcriber used, vault-path embed, per-embed routed failure, no-speech notice #524, direct-extraction fallback) and cache reporting (#527: plain finish for fresh, single cached-transcript line, aggregated line over several embeds) |

## Data Flow

```
1. User triggers via UnifiedTranscriptionModal or NoteMediaModal (src/transcription/)
   |
2a. transcribeAndInsert(noteFile, embeds) -- batch from note scan; the ONLY
   |  note-writing entry point left on this module
   |  isPathExcluded silent skip (#307); acquires noteFile's NoteOperationQueue
   |  slot (#483, index.ts:175) then delegates to private insertTranscriptions
   |  (index.ts:183); creates checkpoint; routes each embed through
   |  urlTranscriber (the #184 tier router) with a processUrl fallback;
   |  processes in reverse line order; 2s delay between API calls; atomic splice
   |  via vault.process; cancellable via NotificationManager operation
   |  finish message via withCacheReport(..., one CacheUse per inserted embed) (#527;
   |  RoutedUrlTranscript carries cached/aiCached from the router)
   |
2b. Single URL to the active note is NOT here -- src/transcription/
   |  insertUrlTranscript(deps, url, timeRange?) owns that flow (and its own
   |  queue slot), reusing this module's onTranscriptionComplete contract
   |
2c. processUrl(url, options?, parentOp?) -- returns transcript text only
   |  the download+extract tier the router reaches via LocalExtractionStrategy;
   |  writes no note, so the caller that writes owns the queue slot
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

`findVideoUrls(content)` in `note-scanner.ts:7`:
- Regex: `/https?:\/\/[^\s)\]>]+/g`
- Skips blockquote lines (`>` prefix — transcription output, not user content)
- Skips undetected URLs and `detected.platform === 'twitter'`
- Skips URLs with an existing transcription callout within 3 lines below
- Returns `VideoUrlEmbed[]` with line numbers

`hasTranscriptionBelow(lines, embedLine, url)` (`note-scanner.ts:36`) matches the legacy `**Transcription of ...**` and the `[!<CALLOUT_TYPES.transcription>]` callout formats.

## Commands Registered

| Command ID | Enabled condition | Registry name |
|-----------|------------------|---------------|
| `synapse:check-dependencies` | `video.enabled` | Check external tool availability |

Registered via `registrar.register('check-dependencies', ...)` (index.ts:69); Obsidian prefixes the manifest id with `synapse:`. The handler reports yt-dlp/ffmpeg presence and brew install hints. Transcription palette commands (`transcribe-media`, `transcribe-note-media`) are wired in `main.ts`, not here.

## Settings Keys (VideoSettings, settings.ts:173)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `video.enabled` | `boolean` | `true` | Feature gate |
| `video.ytDlpPath` | `string` | `'yt-dlp'` | yt-dlp binary path (bare name = PATH lookup) |
| `video.ffmpegPath` | `string` | `'ffmpeg'` | ffmpeg binary path (bare name = PATH lookup) |
| `video.tempFolder` | `string` | `'.synapse/temp'` | Vault folder ensured on load for temp work |
| `video.downloadFolder` | `string` | `'Media'` | Vault folder to save downloaded videos (empty = do not save) |
| `video.embedInNote` | `boolean` | `true` | Add `![[video.mp4]]` embed to note when a video is saved |
| `video.captionsFirst` | `boolean` | `true` | Prefer the YouTube caption tier over download+transcribe (#184; `settings.ts:186`); consumed by `transcription/caption-strategy.ts` `canHandle`, toggle rendered at `settings-section.ts:173` |
| `video.frameExtraction.enabled` | `boolean` | `false` | Frame extraction gate (unimplemented) |
| `video.frameExtraction.intervalSeconds` | `number` | `30` | Seconds between extracted frames |
| `video.frameExtraction.visionModel` | `string` | `'gpt-5.6-sol'` | Vision model for frame analysis |
| `video.frameExtraction.maxFrames` | `number` | `20` | Max frames to extract |

Settings UI: `renderVideoSettings` (`settings-section.ts:152`) renders the accordion; `addPathSetting` attaches per-OS install-help panels (#382/#383) to the yt-dlp and ffmpeg path fields. Invoked only on desktop by `settings-tab.ts`.

## External Runtime Dependencies

| Tool | Setting key | Default | Purpose |
|------|-------------|---------|---------|
| yt-dlp | `video.ytDlpPath` | `'yt-dlp'` | Video download and `--dump-json` metadata |
| ffmpeg (incl. ffprobe) | `video.ffmpegPath` | `'ffmpeg'` | Audio extraction, clipping, concatenation |

`shellEnv()` prepends `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` ahead of the existing PATH. `execFile` timeout: 300s; maxBuffer: 10MB (audio-extractor.ts:516). No shell is invoked (explicit argument arrays).

## Module Dependencies

In:
- `../audio` — `AudioModule` (runtime value edge: reuses the transcription pipeline), `TranscriptionResult` (type)
- `../commands` — `CommandRegistrar`
- `../shared` — `NoteOperationQueue` (#483), `ensureFolder`, `NotificationManager`, `sanitizeUrl`, `buildCallout`, `calloutForTranscriptionResult`, `CheckpointManager`, `generateId`, `detectPlatform`, `loadNodeModules`, `isPathExcluded`, `findAvailableVaultPath`, `isNoSpeechError`, `noSpeechNotice`, `transcriptCacheUse`, `withCacheReport` (index.ts:5-10); type-only `CacheUse`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask`, `OperationHandle`, `ModuleDeps`, `FeatureModule` (index.ts:11); `TimeRange` (types.ts); `sanitizePath`, `describeNetworkError`, `isRecord`, `parseJson`, `shellEnv`, `NodeModules` (audio-extractor.ts); `CALLOUT_TYPES` (note-scanner.ts); `SettingsSectionContext`, `NotificationManager` (settings-section.ts)
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
| Media has audio but no speech (#524) | `NoSpeechDetectedError` (shared) from `AudioModule.transcribe`; `processUrl` rethrows it unflattened and always unlinks the temp audio; batch insert shows `notifications.info(noSpeechNotice(url))`, completes the checkpoint item, inserts nothing for that URL |
| TikTok photo slideshow / no audio stream | `NoAudioError` (internal); proactive from `--dump-json` (`isNoAudioPost`) and reactive from ffprobe `unable to obtain file audio codec` stderr |
| Network failure | `describeNetworkError`-classified message; not retried |
| Subprocess timeout (>5 min, SIGTERM) | `Error('<tool> timed out after 5 minutes')` |
| Other download/extract failure | Wrapped `Error('Download/audio extraction failed: ...')` after one looser-format retry |
| `endSeconds > metadata.duration` | Throws before clipping |
| Transcription failure | Wrapped `Error('Transcription failed: ...')` |
| Path excluded (#307) | transcribeAndInsert: silent skip. The active-note variants (named notice, no-active-file notice) live in src/transcription/insert-url-transcript.ts |

## Invariants / Gotchas

- Desktop-only: `loadNodeModules()` throws `DesktopOnlyError` off-desktop; VideoModule is constructed only when the registry entry's `platform: () => Platform.isDesktop` predicate passes (`modules/registry.ts`) and may be null. AudioExtractor also asserts desktop at first fs/subprocess access.
- `FrameExtractor` (`frame-extractor.ts`) is a placeholder: `extractFrames` returns `[]` when disabled, otherwise throws "not yet implemented".
- `AudioExtractor.concatAudio` re-encodes via the ffmpeg concat filter (handles mixed mp3/wav/m4a/ogg/flac/webm/aac).
- `--ffmpeg-location` is emitted only when `ffmpegPath` is a concrete path (contains `/` or `\`); a bare name relies on PATH discovery.
- `downloadVideoToVault` uses `vault.createBinary()` (not the adapter API); collision-safe naming is delegated to `findAvailableVaultPath` (shared) on a `normalizePath`-ed target, appending `-1`, `-2`, ... before the extension.
- Back-compat re-exports (`detectPlatform`, `isSupportedUrl`, `Platform`, `UrlDetectionResult`) come from `../shared`; prefer direct `shared` imports in new code.
- Per-note serialization (#483): `transcribeAndInsert` acquires `noteFile.path` on the shared `NoteOperationQueue` (index.ts:175) with an `onWait` that updates the operation toast (`Waiting for another Synapse operation on <basename>`), then runs private `insertTranscriptions` (index.ts:183). The core must never re-enter the queue — acquire at most once per operation. `processUrl`/`transcribe` paths that only produce text (no note write) stay unqueued; the caller that writes owns the slot.

## Security

- URLs validated via `sanitizeUrl()` in both `VideoModule.processUrl` and `AudioExtractor` entry points.
- Tool and file paths validated via `sanitizePath()`.
- All subprocess calls use `execFile` with explicit argument arrays — no shell interpolation.
