---
name: electron-security-audit
description: Security auditing for the Synapse plugin. Covers secret detection, input validation, command injection prevention, API key handling, and .gitignore enforcement. Use when reviewing code for security vulnerabilities or setting up security guardrails.
user-invocable: false
---

# Security Audit Standards

## Priority Areas

### 1. Secret Prevention
- **No hardcoded secrets** — API keys, tokens, passwords must never appear in source
- **`.gitignore` enforcement** — ensure `.env`, `data.json`, `.synapse/` are gitignored
- **Settings storage** — API keys stored via Obsidian's `saveData()` (encrypted at rest by OS)
- **Audit**: grep for patterns like `sk-`, `key-`, API key formats, base64-encoded strings

### 2. Command Injection
- **child_process** — NEVER use `exec()` or `execSync()` with string commands
- **ALWAYS use `execFile()`** with argument arrays — prevents shell injection
- **Validate all inputs** before passing to external processes (yt-dlp, ffmpeg)
- **URL validation** — sanitize URLs before passing to yt-dlp (reject shell metacharacters)
- **Path validation** — reject paths with `..`, null bytes, or shell metacharacters

### 3. Input Validation
- **User-provided URLs** — validate against allowlisted URL patterns before processing
- **File paths** — normalize and validate within vault boundaries
- **Settings values** — validate types and ranges on load
- **AI responses** — treat as untrusted; sanitize before rendering in UI or writing to files

### 4. API Security
- **HTTPS only** — all API calls must use HTTPS
- **No API keys in URLs** — use Authorization headers
- **Request timeout** — enforce timeouts on all external requests
- **Error messages** — never leak API keys or tokens in error messages/logs

### 5. File System Safety
- **Vault boundary** — never read/write outside the vault directory
- **Proposal files** — validate proposal paths resolve within `.synapse/`
- **Temp files** — clean up temporary audio/video files after processing
- **Symlink safety** — resolve symlinks and verify they stay within vault

## Audit Checklist
1. Scan all `child_process` usage for injection vectors
2. Scan for hardcoded secrets/keys
3. Verify .gitignore covers sensitive paths
4. Check all `requestUrl`/`fetch` calls use HTTPS and headers (not URL params) for auth
5. Verify user input validation at all entry points
6. Check file operations stay within vault boundaries
7. Review error handling for information leakage
