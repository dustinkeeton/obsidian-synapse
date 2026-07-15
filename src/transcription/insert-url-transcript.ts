import type { App } from 'obsidian';
import { findMatchingRule } from '../shared';
import type { NotificationManager, TimeRange } from '../shared';
import type { SynapseSettings } from '../settings';
import { buildUrlTranscriptBlock, UrlTranscriptionRouter } from './url-transcription';

/** Wiring for {@link insertUrlTranscript}, injected by main.ts. */
export interface InsertUrlTranscriptDeps {
	app: App;
	getSettings: () => SynapseSettings;
	notifications: NotificationManager;
	router: UrlTranscriptionRouter;
	/** Post-transcription hook (enrichment/title check), same contract as the module `onTranscriptionComplete` callbacks. */
	onComplete?: (filePath: string) => void;
}

/**
 * Transcribe a media URL through the tier router and append the transcript to
 * the ACTIVE note — the platform-agnostic sibling of the desktop-only
 * `VideoModule.transcribeUrlToActiveNote`, and the path the unified
 * transcription modal takes on every platform. Mirrors that method's guards
 * (active note required, #307 path exclusion) and its output block shape.
 */
export async function insertUrlTranscript(
	deps: InsertUrlTranscriptDeps,
	url: string,
	timeRange?: TimeRange
): Promise<void> {
	const { app, getSettings, notifications, router } = deps;

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
	try {
		const result = await router.transcribe(url, {
			timeRange,
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
		op.finish('Transcription added to note');
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		op.error(`URL transcription failed -- ${msg}`);
	}
}
