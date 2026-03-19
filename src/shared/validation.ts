/**
 * Input validation and sanitization utilities for security-sensitive operations.
 */

/**
 * Validates and sanitizes a URL before passing to external tools.
 * Rejects URLs containing shell metacharacters or non-HTTP(S) schemes.
 * @throws Error if the URL is invalid or contains dangerous characters.
 */
export function sanitizeUrl(url: string): string {
	// Reject null bytes
	if (url.includes('\0')) {
		throw new Error('Invalid URL: contains null bytes');
	}

	// Must be a valid URL with http or https scheme
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error('Invalid URL format');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Only HTTP and HTTPS URLs are supported');
	}

	// Reject shell metacharacters that could be used for injection
	// Even with execFile, we want defense-in-depth
	const shellMeta = /[;|&`$(){}!\n\r]/;
	if (shellMeta.test(url)) {
		throw new Error('URL contains invalid characters');
	}

	return url;
}

/**
 * Validates and sanitizes a file path.
 * Rejects paths with null bytes, path traversal, or shell metacharacters.
 * @throws Error if the path is invalid or contains dangerous characters.
 */
export function sanitizePath(filePath: string): string {
	if (!filePath || filePath.trim().length === 0) {
		throw new Error('File path cannot be empty');
	}

	// Reject null bytes
	if (filePath.includes('\0')) {
		throw new Error('Invalid path: contains null bytes');
	}

	// Reject path traversal
	const normalized = filePath.replace(/\\/g, '/');
	const segments = normalized.split('/');
	if (segments.includes('..')) {
		throw new Error('Path traversal is not allowed');
	}

	// Reject shell metacharacters
	const shellMeta = /[;|&`$(){}!\n\r]/;
	if (shellMeta.test(filePath)) {
		throw new Error('Path contains invalid characters');
	}

	return filePath;
}

/**
 * Validates that a path resolves within a given base directory (vault boundary check).
 * Uses portable string-based path resolution (no Node.js `path` module) so it works on mobile.
 * @throws Error if the path escapes the base directory.
 */
export function ensureWithinVault(filePath: string, vaultBasePath: string): string {
	const resolved = portableResolve(vaultBasePath, filePath);
	const resolvedBase = portableResolve(vaultBasePath);

	if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) {
		throw new Error('Path escapes vault boundary');
	}

	return resolved;
}

/**
 * Portable path.resolve replacement: normalizes slashes, resolves `.` and `..` segments.
 * If `relative` is absolute it is used as-is; otherwise it is joined to `base`.
 */
function portableResolve(base: string, relative?: string): string {
	let combined = base.replace(/\\/g, '/');
	if (relative) {
		const rel = relative.replace(/\\/g, '/');
		combined = rel.startsWith('/') ? rel : combined + '/' + rel;
	}

	const parts: string[] = [];
	for (const seg of combined.split('/')) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') {
			parts.pop();
		} else {
			parts.push(seg);
		}
	}

	const prefix = combined.startsWith('/') ? '/' : '';
	return prefix + parts.join('/');
}

/**
 * Strips potentially dangerous content from AI-generated text before writing to notes.
 * Removes script tags, data URIs, and HTML event handlers that could execute code.
 */
export function sanitizeAIResponse(text: string): string {
	// Remove script tags and their content
	let sanitized = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

	// Remove HTML event handlers (onclick, onerror, etc.)
	sanitized = sanitized.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');

	// Remove javascript: and data: URIs in markdown links/images
	sanitized = sanitized.replace(/\]\(\s*(?:javascript|data|vbscript):/gi, '](');

	// Remove HTML iframe/embed/object tags
	sanitized = sanitized.replace(/<(?:iframe|embed|object)\b[^>]*>[\s\S]*?<\/(?:iframe|embed|object)>/gi, '');
	sanitized = sanitized.replace(/<(?:iframe|embed|object)\b[^>]*\/?>/gi, '');

	return sanitized;
}

/**
 * A validated time range in seconds, used for clipping audio/video before transcription.
 */
export interface TimeRange {
	startSeconds: number;
	endSeconds: number;
}

/**
 * Parses a timestamp string into total seconds.
 * Accepts `HH:MM:SS`, `MM:SS`, or raw seconds (e.g. `"90"`).
 * @throws Error on malformed input.
 */
export function parseTimestamp(input: string): number {
	if (!input || input.trim().length === 0) {
		throw new Error('Timestamp cannot be empty');
	}
	const trimmed = input.trim();

	// Raw seconds (integer or decimal, no colons)
	if (/^\d+(\.\d+)?$/.test(trimmed)) {
		return parseFloat(trimmed);
	}

	// MM:SS or HH:MM:SS
	const parts = trimmed.split(':');
	if (parts.length < 2 || parts.length > 3) {
		throw new Error(`Invalid timestamp format: "${input}"`);
	}

	for (const part of parts) {
		if (!/^\d+$/.test(part)) {
			throw new Error(`Invalid timestamp format: "${input}"`);
		}
	}

	const nums = parts.map(Number);

	if (parts.length === 2) {
		// MM:SS
		const [minutes, seconds] = nums;
		if (seconds >= 60) throw new Error(`Invalid timestamp: seconds must be < 60 in "${input}"`);
		return minutes * 60 + seconds;
	}

	// HH:MM:SS
	const [hours, minutes, seconds] = nums;
	if (minutes >= 60) throw new Error(`Invalid timestamp: minutes must be < 60 in "${input}"`);
	if (seconds >= 60) throw new Error(`Invalid timestamp: seconds must be < 60 in "${input}"`);
	return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Validates that start < end and (if duration is known) end <= duration.
 * @throws Error on invalid range.
 */
export function validateTimeRange(start: string, end: string, duration?: number): TimeRange {
	const startSeconds = parseTimestamp(start);
	const endSeconds = parseTimestamp(end);

	if (endSeconds <= startSeconds) {
		throw new Error('End time must be after start time');
	}

	if (duration !== undefined && endSeconds > duration) {
		throw new Error(`End time (${endSeconds}s) exceeds media duration (${duration}s)`);
	}

	return { startSeconds, endSeconds };
}

/**
 * Formats a TimeRange for display in callout titles.
 * Returns `[MM:SS – MM:SS]` or `[HH:MM:SS – HH:MM:SS]` when hours > 0.
 */
export function formatTimeRange(range: TimeRange): string {
	const needsHours = range.startSeconds >= 3600 || range.endSeconds >= 3600;
	const fmt = (s: number): string => {
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = Math.floor(s % 60);
		if (needsHours) {
			return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
		}
		return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
	};
	return `[${fmt(range.startSeconds)} – ${fmt(range.endSeconds)}]`;
}

/**
 * Removes wrapping code fences that LLMs sometimes add despite instructions.
 * Only strips when the entire text is wrapped in a single code fence block.
 */
export function stripCodeFences(text: string): string {
	const trimmed = text.trim();
	if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
		const lines = trimmed.split('\n');
		return lines.slice(1, -1).join('\n');
	}
	return trimmed;
}

/**
 * Converts note body content into a blockquote with user-attribution.
 * Preserves YAML frontmatter (if present) outside the blockquote.
 */
export function blockquoteOriginal(content: string): string {
	let frontmatter = '';
	let body = content;

	// Separate frontmatter from body
	if (content.startsWith('---')) {
		const endIndex = content.indexOf('---', 3);
		if (endIndex !== -1) {
			const fmEnd = endIndex + 3;
			frontmatter = content.slice(0, fmEnd);
			body = content.slice(fmEnd);
			// Trim leading newlines from body but keep frontmatter's trailing newline
			body = body.replace(/^\n+/, '');
		}
	}

	if (body.trim().length === 0) {
		return content;
	}

	const quoted = body
		.split('\n')
		.map(line => `> ${line}`)
		.join('\n');

	const attribution = '> \n> — *Original note by author*';
	const blockquote = quoted + '\n' + attribution;

	if (frontmatter) {
		return frontmatter + '\n\n' + blockquote;
	}
	return blockquote;
}
