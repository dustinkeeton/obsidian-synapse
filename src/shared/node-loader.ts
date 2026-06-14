import { Platform } from 'obsidian';

/**
 * Single sanctioned entry point for desktop-only Node.js builtins.
 *
 * Synapse ships with `isDesktopOnly: false` so the bundle MUST load on Obsidian
 * mobile, where `os`/`path`/`fs`/`child_process` do not exist. esbuild marks
 * these builtins as `external`, so a literal require of `fs` evaluated at module
 * load time would throw on mobile before any `Platform.isDesktop` guard could
 * run. Centralizing every Node-builtin access here keeps that invariant in ONE
 * place: the lazy loads live INSIDE {@link loadNodeModules} (never at module top
 * level), and the function refuses to run off-desktop.
 *
 * Privileged behavior reached through these handles (direct filesystem writes
 * under `os.tmpdir()`, `execFile` of yt-dlp/ffmpeg/ffprobe) is documented in the
 * README "Privileged access" section.
 */

/** Typed handles for the Node builtins the audio/video/transcription pipeline uses. */
export interface NodeModules {
	os: typeof import('os');
	path: typeof import('path');
	fs: typeof import('fs');
	execFile: typeof import('child_process')['execFile'];
}

/**
 * Thrown when Node builtins are requested off-desktop. A distinct, descriptive
 * error (rather than a raw `Cannot find module 'fs'`) makes the mobile-safety
 * violation obvious in logs and lets callers `catch` it intentionally.
 */
export class DesktopOnlyError extends Error {
	constructor(message = 'Node.js builtins are only available on desktop (Obsidian mobile has no os/path/fs/child_process).') {
		super(message);
		this.name = 'DesktopOnlyError';
	}
}

/**
 * Assert the current platform is desktop, throwing {@link DesktopOnlyError}
 * otherwise. Use at the entry point of any code path that will touch Node
 * builtins, the filesystem, or a subprocess — an explicit guard rather than
 * relying on construction-time gating or `this.extractor` truthiness.
 */
export function assertDesktop(context?: string): void {
	if (!Platform.isDesktop) {
		throw new DesktopOnlyError(
			context
				? `${context} requires desktop (Obsidian mobile has no os/path/fs/child_process).`
				: undefined
		);
	}
}

/**
 * Lazily resolve the real Node builtins via `require`, returning typed handles.
 *
 * Throws {@link DesktopOnlyError} off-desktop. The lazy loads live inside this
 * function body (never at module top level) so importing this module never
 * triggers a module load — the bundle stays loadable on mobile.
 *
 * This is the ONE place an `@typescript-eslint/no-var-requires` disable is
 * permitted; route every Node-builtin access through here.
 */
export function loadNodeModules(): NodeModules {
	assertDesktop();
	/* eslint-disable @typescript-eslint/no-var-requires -- the single sanctioned, lazy Node-builtin load; gated by assertDesktop() above so the bundle still loads on mobile (isDesktopOnly: false) */
	// `require` is untyped (returns `any`); cast each module to its
	// `typeof import(...)` form so member access stays typed rather than
	// unsafe-any. The require() imports themselves are deliberately left as-is.
	return {
		os: require('os') as typeof import('os'),
		path: require('path') as typeof import('path'),
		fs: require('fs') as typeof import('fs'),
		execFile: (require('child_process') as typeof import('child_process')).execFile,
	};
	/* eslint-enable @typescript-eslint/no-var-requires -- re-enable now that the lazy Node-builtin load is done */
}

/**
 * Build a NARROWED environment for spawning external tools (yt-dlp / ffmpeg /
 * ffprobe). The full `process.env` is deliberately NOT spread into the child:
 * an allowlist limits what these subprocesses inherit to only what they need.
 *
 * Included:
 * - `PATH` — augmented with common install locations. Obsidian's Electron
 *   process has a minimal PATH that often excludes user-installed tools, so we
 *   PREPEND `/usr/local/bin`, `/opt/homebrew/bin`, and `~/.local/bin`. Homebrew
 *   is ordered first so its binaries (with a proper Python) win over
 *   `~/.local/bin` or system versions.
 * - `HOME` — yt-dlp/ffmpeg resolve config and cache locations relative to it.
 * - `TMPDIR` — honored for scratch space when the user has set it.
 * - Proxy vars (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` + lowercase) — passed
 *   through only IF present, since yt-dlp needs them behind a corporate proxy.
 */
export function shellEnv(): NodeJS.ProcessEnv {
	const extraPaths = [
		'/usr/local/bin',
		'/opt/homebrew/bin',
		`${process.env.HOME ?? ''}/.local/bin`,
	];
	const current = process.env.PATH ?? '';
	const missing = extraPaths.filter(p => !current.includes(p));
	const PATH = missing.length ? missing.join(':') + ':' + current : current;

	const env: NodeJS.ProcessEnv = { PATH };
	if (process.env.HOME) env.HOME = process.env.HOME;
	if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;

	// Proxy vars are passed through only when set (both casings, as tools differ).
	for (const key of [
		'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
		'http_proxy', 'https_proxy', 'no_proxy',
	] as const) {
		const value = process.env[key];
		if (value) env[key] = value;
	}

	return env;
}
