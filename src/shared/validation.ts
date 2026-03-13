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
 * @throws Error if the path escapes the base directory.
 */
export function ensureWithinVault(filePath: string, vaultBasePath: string): string {
	const path = require('path') as typeof import('path');
	const resolved = path.resolve(vaultBasePath, filePath);
	const resolvedBase = path.resolve(vaultBasePath);

	if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) {
		throw new Error('Path escapes vault boundary');
	}

	return resolved;
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
