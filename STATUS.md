# Project Status

**Last updated**: 2026-03-12
**Phase**: Architecture audited, security hardened, inline transcription added

---

## Feature Completion Matrix

| Feature | Scaffolded | Core Logic | Security | Tests | Status |
|---------|:---:|:---:|:---:|:---:|--------|
| Plugin shell (main.ts, settings) | Yes | Yes | Yes | No | Working |
| Settings tab (model dropdowns, password masking) | Yes | Yes | Yes | No | Working |
| Elaboration -- detection | Yes | Stub | Yes | No | Needs implementation |
| Elaboration -- proposal generation | Yes | Stub | Yes | No | Needs implementation |
| Elaboration -- proposal storage | Yes | Scaffold | -- | No | Needs implementation |
| Elaboration -- review UI | Yes | Stub | -- | No | Needs implementation |
| Audio -- file transcription (Whisper) | Yes | Scaffold | Yes | No | Needs implementation |
| Audio -- file transcription (Deepgram) | Yes | Scaffold | Yes | No | Needs implementation |
| Audio -- inline note transcription | Yes | Yes | Yes | No | **Done** |
| Audio -- transcription (local) | Yes | -- | -- | No | Not started |
| Audio -- post-processing | Yes | Scaffold | Yes | No | Needs implementation |
| Video -- URL detection | Yes | Scaffold | Yes | No | Needs implementation |
| Video -- yt-dlp integration | Yes | Scaffold | Yes | No | Needs implementation |
| Video -- transcription modal | Yes | Stub | -- | No | Needs implementation |
| Video -- local file transcription | Yes | -- | -- | No | Not started |
| Video -- frame extraction | Yes | -- | -- | No | Not started (stretch) |
| Shared -- AIClient (with model resolution) | Yes | Scaffold | Yes | No | Needs implementation |
| Shared -- validation | Yes | Yes | Yes | No | **Done** |
| Shared -- file utils (ensureFolder, writeNote) | Yes | Yes | -- | No | **Done** |
| Shared -- barrel export (index.ts) | Yes | Yes | -- | No | **Done** |

---

## What's Working

- Plugin loads in Obsidian with settings tab
- Module initialization and lifecycle (load/unload)
- Conditional feature loading based on settings
- Ribbon icons and commands registered
- Settings schema with deep merge on load
- **Inline note transcription**: Scans current note for `![[audio.mp3]]` embeds, presents selection modal, inserts blockquote transcriptions below each embed
- **Model selection**: Provider-specific dropdowns; Anthropic uses simplified names mapped to current API IDs (`claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`)
- **safeRequest wrapper**: API errors now include provider error messages instead of generic HTTP codes
- **Vault cache miss handling**: `ensureFolder()` handles "already exists" race condition; `ProposalStore` uses adapter methods to bypass cache
- **Whisper API key separation**: Dedicated `whisperApiKey` field with fallback to shared `ai.apiKey`
- **Password masking**: All API key inputs use `type="password"` with `autocomplete="off"`
- **Input validation layer**: URL sanitization, path sanitization, vault boundary checks
- **AI response sanitization**: Script tags, event handlers, dangerous URIs stripped
- **Subprocess security**: `execFile` with argument arrays (no shell), 5-min timeout, 10MB buffer limit
- **API key redaction** in error messages
- **Request timeouts** on all external calls (5 minutes)

## Known Issues / Architectural Notes

- **No test framework**: No test runner configured
- **AudioEmbed type in wrong file**: `AudioEmbed` interface is in `note-audio-modal.ts` instead of `types.ts` (violates types convention)
- **Ribbon icons always visible**: Register unconditionally regardless of module enabled state; no `removeRibbonIcon` API
- **Status bar is static**: Shows "Auto Notes: idle" permanently; not updated during operations
- **Local Whisper**: `local-whisper` provider throws "not implemented"
- **Local video file**: `transcribe-video-file` command shows "coming soon" notice
- **Frame extraction**: `FrameExtractor` is a placeholder class
- **Platform filtering**: `supportedPlatforms` toggles defined but not enforced
- **Proposal limits**: `maxProposalsPerNote` setting exists but is not enforced
- **Append mode**: `output.appendToExisting` audio setting exists but is not used

## External Dependencies

| Dependency | Required For | Status |
|------------|-------------|--------|
| yt-dlp | Video download | User must install separately |
| ffmpeg | Audio extraction from video | User must install separately |
| OpenAI API key | Whisper transcription, GPT AI | User configures in settings |
| Anthropic API key | Claude AI (elaboration) | User configures in settings |
| Deepgram API key | Deepgram transcription (optional) | User configures if selected |

## Next Steps

1. Implement core elaboration detection logic (scored heuristics)
2. Implement proposal generation with AI integration
3. Build proposal review sidebar UI
4. Implement audio transcription pipeline end-to-end
5. Implement video download and audio extraction pipeline
6. Move `AudioEmbed` to `audio/types.ts`
7. Make ribbon icons conditional on module enabled state
8. Update status bar dynamically during operations
9. Set up test framework
