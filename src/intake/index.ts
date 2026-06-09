import { Plugin, TFile, normalizePath } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import {
	NotificationManager,
	ensureFolder,
	fetchArticleContent,
	parseFrontmatter,
	serializeFrontmatter,
	writeNote,
} from '../shared';
import { IntakeDispatcher } from './intake-dispatcher';
import {
	IntakeDeps,
	IntakeRoute,
	SYNAPSE_PROCESSED_AT_FLAG,
	SYNAPSE_PROCESSED_FLAG,
} from './types';

export { IntakeDispatcher } from './intake-dispatcher';
export type {
	IntakeDeps,
	IntakeRoute,
} from './types';
export {
	SYNAPSE_PROCESSED_FLAG,
	SYNAPSE_PROCESSED_AT_FLAG,
} from './types';

/**
 * Fallback settle window (ms) used only when `intake.settleSeconds` is missing
 * or not a positive number. The configured default is 5s (`settleSeconds`, see
 * `DEFAULT_SETTINGS.intake`); this constant just guards a malformed setting so
 * the watcher always has a sane debounce. See {@link IntakeModule.scheduleFlush}.
 */
const DEBOUNCE_MS = 5000;

/**
 * IntakeModule — watches a configurable intake folder and auto-processes new
 * notes (#111).
 *
 * Lifecycle mirrors the other feature modules (see src/tidy): `onload()`
 * registers two vault listeners (create + modify) when intake is enabled;
 * `onunload()` tears down every pending debounce timer.
 *
 * Per the architecture rule this module imports only `obsidian` and
 * `src/shared/*`; all cross-module work (running the pipeline on a note,
 * elaborating a note, future transcription) goes through the injected
 * {@link IntakeDeps} bundle.
 *
 * Flow for a settled note:
 *   create/modify event → cheap synchronous guards → per-path debounce →
 *   flush() reads + parses the note → idempotency guard → dispatcher.route →
 *   execute the branch → stamp `synapse-processed` (before any move) →
 *   optional move to `moveWhenDone`.
 */
export class IntakeModule {
	private readonly dispatcher = new IntakeDispatcher();

	/** Paths with a pending (debounced, not-yet-flushed) change. */
	private readonly pending = new Set<string>();
	/** Per-path debounce timer handles, so onunload can clear them all. */
	private readonly timers = new Map<string, number>();
	/**
	 * Paths currently being flushed/processed. Guards against the `modify`
	 * echo that our own frontmatter-stamp write triggers re-entering flush.
	 */
	private readonly inFlight = new Set<string>();

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
		private deps: IntakeDeps,
	) {}

	async onload(): Promise<void> {
		// Only watch when enabled and an intake folder is configured. An empty
		// folder must never fall back to watching the whole vault.
		if (!this.getSettings().intake.enabled) {
			return;
		}

		this.plugin.registerEvent(
			this.plugin.app.vault.on('create', (file) => this.handleEvent(file)),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', (file) => this.handleEvent(file)),
		);
	}

	onunload(): void {
		for (const handle of this.timers.values()) {
			window.clearTimeout(handle);
		}
		this.timers.clear();
		this.pending.clear();
		this.inFlight.clear();
	}

	/**
	 * Cheap synchronous gatekeeper run on every vault event, before any async
	 * work. Order is deliberately cheapest-first. Anything that passes is
	 * debounced; everything else is ignored outright.
	 */
	private handleEvent(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== 'md') {
			return;
		}

		const settings = this.getSettings().intake;
		if (!settings.enabled) {
			return;
		}

		if (!this.isInIntakeFolder(file.path, settings.intakeFolder)) {
			return;
		}

		// Suppress the self-echo from our own flag-stamp write.
		if (this.inFlight.has(file.path)) {
			return;
		}

		this.scheduleFlush(file.path);
	}

	/**
	 * True when `path` lives inside the configured intake folder. Mirrors
	 * getMarkdownFiles' membership rule (`startsWith(normalized + '/')`) so
	 * subpaths are handled consistently. An empty/whitespace folder matches
	 * nothing — we never watch the whole vault.
	 *
	 * The capture-log subfolder (`‹intakeFolder›/‹captureLogFolder›`, #224) is
	 * explicitly excluded so our own breadcrumbs — which live under the intake
	 * folder — are NEVER ingested. Without this the watcher would re-process
	 * every breadcrumb and, since breadcrumbs contain a link that organize would
	 * try to move, spin into an infinite ingest loop.
	 */
	private isInIntakeFolder(path: string, intakeFolder: string): boolean {
		if (!intakeFolder || intakeFolder.trim().length === 0) {
			return false;
		}
		const normalized = normalizePath(intakeFolder);
		if (!path.startsWith(normalized + '/')) {
			return false;
		}

		const captureLogPath = this.captureLogPath(normalized);
		if (
			captureLogPath !== null &&
			(path === captureLogPath || path.startsWith(captureLogPath + '/'))
		) {
			return false;
		}

		return true;
	}

	/**
	 * Absolute vault path of the capture-log subfolder for a given (already
	 * normalized) intake folder, or null when no capture-log folder is
	 * configured. Single source of truth for both the listener exclusion
	 * (above) and where breadcrumbs are written (#224).
	 */
	private captureLogPath(normalizedIntakeFolder: string): string | null {
		const folder = this.getSettings().intake.captureLogFolder;
		if (!folder || folder.trim().length === 0) {
			return null;
		}
		return normalizePath(`${normalizedIntakeFolder}/${folder.trim()}`);
	}

	/**
	 * Debounce a path against the configured settle window: (re)start its timer
	 * on every event so processing fires only after the note has been quiet for
	 * the full window. This coalesces a create immediately followed by a modify
	 * (the share-to-vault pattern) AND defers a note whose content is still
	 * arriving (chunked sync, the user still typing) — see #222.
	 */
	private scheduleFlush(path: string): void {
		this.pending.add(path);

		const existing = this.timers.get(path);
		if (existing !== undefined) {
			window.clearTimeout(existing);
		}

		const handle = window.setTimeout(() => {
			this.timers.delete(path);
			this.pending.delete(path);
			void this.flush(path);
		}, this.settleWindowMs());

		this.timers.set(path, handle);
	}

	/**
	 * Resolve the settle window in ms from `intake.settleSeconds`, falling back
	 * to {@link DEBOUNCE_MS} when the setting is missing or not a positive
	 * number. Read fresh on every schedule so changing the setting takes effect
	 * immediately, without reloading the watcher.
	 */
	private settleWindowMs(): number {
		const seconds = this.getSettings().intake.settleSeconds;
		if (typeof seconds === 'number' && seconds > 0) {
			return seconds * 1000;
		}
		return DEBOUNCE_MS;
	}

	/**
	 * Resolve, read, route, and process a single settled note. Skips silently
	 * if the file vanished or is already processed. Errors are surfaced via a
	 * notice and leave the note un-stamped so it can be retried.
	 */
	private async flush(path: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return;
		}

		this.inFlight.add(path);
		try {
			const content = await this.plugin.app.vault.read(file);
			const parsed = parseFrontmatter(content);

			// Idempotency: never reprocess a note we've already stamped.
			if (this.isProcessed(parsed.frontmatter)) {
				return;
			}

			const route = this.dispatcher.route(file, parsed);
			await this.execute(file, route);
		} catch (error) {
			// Do NOT stamp on failure — leave the note retriable.
			this.notifications.notifyError(
				`Intake processing failed for ${file.basename}`,
				error,
			);
		} finally {
			this.inFlight.delete(path);
		}
	}

	/**
	 * True when the note's frontmatter already carries the processed flag.
	 * Accepts both the canonical boolean `true` and a string `'true'` so a
	 * hand-written flag (or YAML that round-trips the value as a string) still
	 * makes processing idempotent.
	 */
	private isProcessed(frontmatter: Record<string, unknown>): boolean {
		const flag = frontmatter[SYNAPSE_PROCESSED_FLAG];
		return flag === true || flag === 'true';
	}

	/**
	 * Execute a resolved route, then (on success) stamp the processed flag and
	 * optionally move the note. Throws on processing failure so flush() can
	 * surface it and skip stamping.
	 *
	 * Every content-bearing branch ends in the full `fireOnFile` pipeline whose
	 * last phase (organize) is the primary, content-aware mover — it relocates
	 * the note to its proper vault folder (#223). We capture the note's path
	 * BEFORE running the pipeline so post-processing we can tell whether organize
	 * moved it out of the intake folder; that signal drives both the
	 * `moveWhenDone` fallback and (#224) the breadcrumb capture log.
	 */
	private async execute(
		file: TFile,
		route: IntakeRoute,
	): Promise<void> {
		// Organize mutates `file.path` in place on rename, so snapshot it now.
		const originalPath = file.path;

		switch (route.kind) {
			case 'transcription':
				// #112 — STUB. Surfaces a "coming soon" notice and no-ops. A
				// content-less URL note has nothing for organize to analyse; once
				// #112 produces a transcript this branch should also end in
				// `await this.deps.fireOnFile(file)` so the note is enriched and
				// organized like the others.
				await this.deps.transcribeUrlToNote(route.url, route.mediaType, file);
				break;

			case 'article': {
				const articleContent = await fetchArticleContent(route.url);
				await this.appendArticleContent(file, articleContent);
				// Run the full pipeline on the now-fleshed-out note. fireOnFile
				// runs elaboration as phase 1 and organize as the last phase, so
				// there is no separate elaborate-then-stop step anymore (#223).
				await this.deps.fireOnFile(file);
				break;
			}

			case 'general':
				await this.deps.fireOnFile(file);
				break;
		}

		const movedOut = await this.markProcessedAndMaybeMove(file, originalPath);

		// Leave a breadcrumb only when the note actually left the intake folder
		// (organize, or the moveWhenDone fallback, relocated it). No move → the
		// note is still browsable in the intake folder, so nothing to log (#224).
		if (movedOut && this.getSettings().intake.captureLog) {
			await this.writeCaptureBreadcrumb(originalPath, file.path);
		}
	}

	/**
	 * Append fetched readable article content to the note body, preserving any
	 * existing frontmatter via parse/serialize. Re-reads the file so we append
	 * to its current on-disk state rather than a stale buffer.
	 */
	private async appendArticleContent(
		file: TFile,
		articleContent: string,
	): Promise<void> {
		if (!articleContent.trim()) {
			return;
		}

		const current = await this.plugin.app.vault.read(file);
		const parsed = parseFrontmatter(current);

		const newBody = `${parsed.body.trimEnd()}\n\n${articleContent.trim()}\n`;
		const updated = serializeFrontmatter(parsed.frontmatter, newBody);
		await this.plugin.app.vault.modify(file, updated);
	}

	/**
	 * Stamp the processed flag (when enabled), then apply `moveWhenDone` as a
	 * FALLBACK mover only. Organize (run inside `fireOnFile`) is now the primary,
	 * content-aware mover; it may instead keep a note in place or create a
	 * proposal when confidence is low (< 0.9). So `moveWhenDone` runs only when
	 * organize did NOT move the note out of the intake folder, guaranteeing a
	 * note never gets stuck in the intake folder while avoiding a double move
	 * for notes organize already relocated (#223).
	 *
	 * Stamping happens first so idempotency survives any subsequent move and the
	 * move's own rename echo. Returns whether the note ended up moved out of the
	 * intake folder, so the caller can drive the breadcrumb capture log (#224).
	 *
	 * `originalPath` is the note's path captured BEFORE processing (organize
	 * mutates `file.path` in place on rename).
	 */
	private async markProcessedAndMaybeMove(
		file: TFile,
		originalPath: string,
	): Promise<boolean> {
		const settings = this.getSettings().intake;

		// Stamp first — this lands on the note's *current* path (post-organize).
		// If organize moved it out of the intake folder, isInIntakeFolder rejects
		// the resulting modify echo; if it stayed in the folder, the original-path
		// inFlight guard (keyed on originalPath in flush) suppresses the echo.
		if (settings.markProcessed) {
			await this.stampProcessed(file);
		}

		let movedOut = this.movedOutOfIntake(originalPath, file.path);

		// Fallback mover: only when organize left the note inside the intake
		// folder (low-confidence proposal / no-op). Skipped entirely when organize
		// already relocated the note, which also fixes the prior general-branch
		// double move.
		if (!movedOut) {
			const destination = settings.moveWhenDone;
			if (destination && destination.trim().length > 0) {
				await this.moveNote(file, destination.trim());
				movedOut = this.movedOutOfIntake(originalPath, file.path);
			}
		}

		return movedOut;
	}

	/**
	 * True when a note that started under the intake folder no longer lives
	 * there — i.e. organize (or the `moveWhenDone` fallback) relocated it out of
	 * the intake folder. The single source of truth for the "left the inbox?"
	 * signal, reused by the `moveWhenDone` fallback and the breadcrumb log (#224).
	 */
	private movedOutOfIntake(originalPath: string, currentPath: string): boolean {
		const intakeFolder = this.getSettings().intake.intakeFolder;
		return (
			this.isInIntakeFolder(originalPath, intakeFolder) &&
			!this.isInIntakeFolder(currentPath, intakeFolder)
		);
	}

	/** Write `synapse-processed: true` + an ISO timestamp into frontmatter. */
	private async stampProcessed(file: TFile): Promise<void> {
		const content = await this.plugin.app.vault.read(file);
		const parsed = parseFrontmatter(content);
		parsed.frontmatter[SYNAPSE_PROCESSED_FLAG] = true;
		parsed.frontmatter[SYNAPSE_PROCESSED_AT_FLAG] = new Date().toISOString();
		const stamped = serializeFrontmatter(parsed.frontmatter, parsed.body);
		await this.plugin.app.vault.modify(file, stamped);
	}

	/**
	 * Move the note into `destination`, creating the folder if needed and
	 * using fileManager.renameFile so inbound links stay intact.
	 */
	private async moveNote(file: TFile, destination: string): Promise<void> {
		const folder = normalizePath(destination);
		await ensureFolder(this.plugin.app, folder);

		const targetPath = normalizePath(`${folder}/${file.name}`);
		if (targetPath === file.path) {
			return;
		}

		await this.plugin.app.fileManager.renameFile(file, targetPath);
	}

	/**
	 * Drop a dated breadcrumb into the capture-log subfolder linking to a note
	 * that was just organized out of the intake folder (#224). The file is
	 * `‹intakeFolder›/‹captureLogFolder›/‹YYYY-MM-DD› — ‹sanitized title›.md`
	 * and holds a wiki-link to the moved note plus small metadata.
	 *
	 * The breadcrumb is stamped `synapse-processed: true` as defense-in-depth:
	 * the capture-log subfolder is already excluded from the watcher
	 * (isInIntakeFolder), but the stamp guarantees it is skipped even if that
	 * exclusion were ever bypassed.
	 *
	 * `movedPath` is the note's current (organized) path; `originalPath` its
	 * pre-processing path inside the intake folder.
	 */
	private async writeCaptureBreadcrumb(
		originalPath: string,
		movedPath: string,
	): Promise<void> {
		const intakeFolder = normalizePath(this.getSettings().intake.intakeFolder);
		const logFolder = this.captureLogPath(intakeFolder);
		if (logFolder === null) {
			return;
		}

		const date = new Date().toISOString().split('T')[0];
		const title = this.sanitizeTitle(this.basenameOf(movedPath));
		const breadcrumbPath = normalizePath(
			`${logFolder}/${date} — ${title}.md`,
		);

		const body = [
			this.wikiLink(movedPath),
			'',
			`- captured: ${date}`,
			`- from: ${originalPath}`,
			`- moved to: ${movedPath}`,
			'',
		].join('\n');
		const content = serializeFrontmatter(
			{ [SYNAPSE_PROCESSED_FLAG]: true },
			body,
		);

		await ensureFolder(this.plugin.app, logFolder);
		await writeNote(this.plugin.app, breadcrumbPath, content);
	}

	/** Basename (no extension) of a vault path, e.g. `A/B/note.md` → `note`. */
	private basenameOf(path: string): string {
		return path.replace(/\.md$/, '').split('/').pop() || path;
	}

	/**
	 * Build an Obsidian wiki-link to a path (mirrors deep-dive's `wikiLink`:
	 * `[[basename]]`). Inlined rather than imported to keep the intake module's
	 * import boundary (only `obsidian` + `src/shared/*`).
	 */
	private wikiLink(path: string): string {
		return `[[${this.basenameOf(path)}]]`;
	}

	/**
	 * Sanitize a note title for use in a filename — the same rule used for video
	 * download filenames (`src/video`): strip to `[a-zA-Z0-9-_ ]`, trim, cap
	 * length. Falls back to `note` when nothing printable survives.
	 */
	private sanitizeTitle(title: string): string {
		const cleaned = title
			.replace(/[^a-zA-Z0-9-_ ]/g, '')
			.trim()
			.slice(0, 60);
		return cleaned.length > 0 ? cleaned : 'note';
	}
}

// Settings section renderer (#243)
export { renderIntakeSettings } from './settings-section';
