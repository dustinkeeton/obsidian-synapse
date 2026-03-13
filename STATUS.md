# Project Status

**Last updated**: 2026-03-12
**Phase**: Architecture audited, security hardened, ready for implementation

---

## Feature Completion Matrix

| Feature | Scaffolded | Core Logic | Security | Tests | Status |
|---------|:---:|:---:|:---:|:---:|--------|
| Plugin shell (main.ts, settings) | Yes | Yes | Yes | No | Working |
| Elaboration — detection | Yes | Stub | Yes | No | Needs implementation |
| Elaboration — proposal generation | Yes | Stub | Yes | No | Needs implementation |
| Elaboration — proposal storage | Yes | Stub | — | No | Needs implementation |
| Elaboration — review UI | Yes | Stub | — | No | Needs implementation |
| Audio — transcription (Whisper) | Yes | Scaffold | Yes | No | Needs implementation |
| Audio — transcription (Deepgram) | Yes | Scaffold | — | No | Needs implementation |
| Audio — transcription (local) | Yes | — | — | No | Not started |
| Audio — post-processing | Yes | Scaffold | Yes | No | Needs implementation |
| Video — URL detection | Yes | Scaffold | Yes | No | Needs implementation |
| Video — yt-dlp integration | Yes | Scaffold | Yes | No | Needs implementation |
| Video — transcription modal | Yes | Stub | — | No | Needs implementation |
| Video — local file transcription | Yes | — | — | No | Not started |
| Video — frame extraction | Yes | — | — | No | Not started (stretch) |
| Shared — AIClient | Yes | Scaffold | Yes | No | Needs implementation |
| Shared — validation | Yes | Yes | Yes | No | **Done** |
| Shared — file utils | Yes | Scaffold | — | No | Needs implementation |
| Shared — barrel export (index.ts) | Yes | Yes | — | No | **Done** |

---

## What's Working

- Plugin loads in Obsidian with settings tab
- Module initialization and lifecycle (load/unload)
- Conditional feature loading based on settings
- Ribbon icons and commands registered
- Settings schema with deep merge on load
- **Input validation layer**: URL sanitization, path sanitization, vault boundary checks
- **AI response sanitization**: Script tags, event handlers, dangerous URIs stripped
- **Subprocess security**: `execFile` with argument arrays (no shell), 5-min timeout, 10MB buffer limit
- **API key redaction** in error messages
- **Ollama endpoint validation**: HTTPS required (HTTP for localhost only)
- **Request timeouts** on Whisper API and subprocess calls
- **Standardized imports** via shared barrel export

## Known Issues / Blockers

- **No test framework**: No test runner configured. Unit and integration tests not yet possible.
- **Local Whisper**: `local-whisper` transcription provider throws "not implemented".
- **Local video file**: `transcribe-video-file` command shows "coming soon" notice.
- **Frame extraction**: `FrameExtractor` is a placeholder class that throws on use.
- **Platform filtering**: `supportedPlatforms` settings (YouTube/TikTok toggles) are defined but not enforced in URL detection.
- **Proposal limits**: `maxProposalsPerNote` setting exists but is not enforced.
- **Append mode**: `output.appendToExisting` audio setting exists but is not used.

## External Dependencies

| Dependency | Required For | Install Status |
|------------|-------------|----------------|
| yt-dlp | Video download | User must install separately |
| ffmpeg | Audio extraction from video | User must install separately |
| OpenAI API key | Whisper transcription, GPT AI | User must configure in settings |
| Anthropic API key | Claude AI (elaboration) | User must configure in settings |
| Deepgram API key | Deepgram transcription (optional) | User must configure if selected |

Run `Auto Notes: Check dependencies` command to verify yt-dlp and ffmpeg availability.

---

## Recent Audit Work (2026-03-12)

- **Architecture audit**: Standardized import paths, added shared barrel export, verified module boundaries
- **Security hardening**: Added `validation.ts` (URL/path sanitization, vault boundary check, AI response sanitization), switched `exec` to `execFile`, added request timeouts, added API key redaction in error messages, added Ollama endpoint protocol validation
- **Documentation**: AGENTS.md files created for all modules, machine-readable and human-readable docs updated

## Next Steps

1. Implement core elaboration detection logic (scored heuristics)
2. Implement proposal generation with AI integration
3. Build proposal review sidebar UI
4. Implement audio transcription pipeline end-to-end
5. Implement video download and audio extraction pipeline
6. Set up test framework
