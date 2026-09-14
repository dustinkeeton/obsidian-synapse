import type { App, TFile } from 'obsidian';
import { findMatchingRule } from '../shared';
import type { NoteOperationQueue, NotificationManager, TimeRange } from '../shared';
import type { SynapseSettings } from '../settings';
import { buildUrlTranscriptBlock, UrlTranscriptionRouter } from './url-transcription';

/** Wiring for {@link insertUrlTranscript}, injected by main.ts. */
export interface InsertUrlTranscriptDeps {
	app: App;
	getSettings: () => SynapseSettings;
	notifications: NotificationManager;
	router: UrlTranscriptionRouter;
	/** Per-note operation queue (#483): the insert is serialized against every other AI operation on the active note. */
	noteQueue: NoteOperationQueue;
	/** Post-transcription hook (enrichment/title check), same contract as the module `onTranscriptionComplete` callbacks. */
	onComplete?: (filePath: string) => void;
}

/**
 * Transcribe a media URL through the tier router and append the transcript to
 * the ACTIVE note — the path the unified transcription modal takes on every
 * platform (it replaced the desktop-only VideoModule equivalent). Guards:
 * active note required, #307 path exclusion; output mirrors the standard
 * transcription block shape.
 */
export async function insertUrlTranscript(
	deps: InsertUrlTranscriptDeps,
	url: string,
	timeRange?: TimeRange,
	forceRefresh = false
): Promise<void> {
	const { app, getSettings, notifications, router, noteQueue } = deps;

	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		notifications.info('Open a note first to insert the transcription');
		return;
	}

	// Path exclusion (#307): transcription lands in the ACTIVE note. Explicit
	// command → Notice naming the rule.
	const rule = findMatchingRule(activeFile.path, 'video', getSettings());
	if (rule) {
		notifications.info(
			`Skipped — "${activeFile.path}" is excluded by rule "${rule.pattern}"`
		);
		return;
	}

	const op = notifications.startOperation(
		'Processing video URL...',
		`video-url-${Date.now()}`
	);
	await noteQueue.run(activeFile.path, async () => {
		try {
			const result = await router.transcribe(url, {
				timeRange,
				forceRefresh,
				update: (message) => op.update(message),
			});
			const block = buildUrlTranscriptBlock(
				result,
				url,
				getSettings().video.embedInNote,
				timeRange
			);
			await app.vault.process(activeFile, (data) => data + block);
			deps.onComplete?.(activeFile.path);
			op.finish(result.cached ? 'Cached transcription added to note' : 'Transcription added to note');
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`URL transcription failed -- ${msg}`);
		}
	}, {
		onWait: () => op.update(`Waiting for another Synapse operation on ${activeFile.basename}`),
	});
}

/** Intake variant (#112/#184): append the transcript to `file` under an operation toast; rethrows so the note stays un-stamped/retriable. */
export async function appendUrlTranscript(
	deps: Pick<InsertUrlTranscriptDeps, 'app' | 'getSettings' | 'notifications' | 'router'>,
	url: string,
	file: TFile
): Promise<void> {
	const op = deps.notifications.startOperation(
		'Transcribing shared URL...',
		`intake-url-${file.path}`
	);
	try {
		const result = await deps.router.transcribe(url, {
			update: (msg) => op.update(msg),
		});
		const block = buildUrlTranscriptBlock(
			result, url, deps.getSettings().video.embedInNote
		);
		await deps.app.vault.process(file, (data) => data + block);
		op.finish('Transcript added');
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		op.error(`URL transcription failed -- ${msg}`);
		throw error;
	}
}
