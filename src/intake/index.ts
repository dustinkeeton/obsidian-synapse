import { Plugin, TFile, normalizePath } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import {
	NotificationManager,
	ensureFolder,
	fetchArticleContent,
	parseFrontmatter,
	serializeFrontmatter,
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
	 */
	private isInIntakeFolder(path: string, intakeFolder: string): boolean {
		if (!intakeFolder || intakeFolder.trim().length === 0) {
			return false;
		}
		const normalized = normalizePath(intakeFolder);
		return path.startsWith(normalized + '/');
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
	 */
	private async execute(
		file: TFile,
		route: IntakeRoute,
	): Promise<void> {
		switch (route.kind) {
			case 'transcription':
				// #112 — STUB. Surfaces a "coming soon" notice and no-ops.
				await this.deps.transcribeUrlToNote(route.url, route.mediaType, file);
				break;

			case 'article': {
				const articleContent = await fetchArticleContent(route.url);
				await this.appendArticleContent(file, articleContent);
				// Elaborate the now-fleshed-out note (single-note scope).
				await this.deps.elaborateFile(file);
				break;
			}

			case 'general':
				await this.deps.fireOnFile(file);
				break;
		}

		await this.markProcessedAndMaybeMove(file);
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
	 * Stamp the processed flag (when enabled) BEFORE any move, then move the
	 * note to `moveWhenDone` (when set). Stamping first guarantees idempotency
	 * survives the move and the move's own rename event.
	 */
	private async markProcessedAndMaybeMove(file: TFile): Promise<void> {
		const settings = this.getSettings().intake;

		if (settings.markProcessed) {
			await this.stampProcessed(file);
		}

		const destination = settings.moveWhenDone;
		if (destination && destination.trim().length > 0) {
			await this.moveNote(file, destination.trim());
		}
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
}
