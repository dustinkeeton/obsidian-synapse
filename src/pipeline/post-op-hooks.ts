import type { TFile } from 'obsidian';
import { fireAndForget } from '../shared';
import type { NotificationManager } from '../shared';
import type { SynapseSettings, IllustrateRunAfterKey } from '../settings';
import type { PostOpContext, PostOpHook, PostOpSource, PostOpTrigger, AutoOrganizeTrigger } from './types';

export interface PostOpHookDeps {
	getSettings: () => SynapseSettings;
	notifications: NotificationManager;
	enrich: (filePath: string, trigger: PostOpTrigger) => Promise<void>;
	checkTitle: (filePath: string) => Promise<void>;
	organizeNote: (file: TFile) => Promise<unknown>;
	/** Illustrate the note from the material the action processed (#213); gated live by `illustrate.runAfter`. */
	illustrateNote: (filePath: string, ctx?: PostOpContext) => Promise<void>;
	/** REM-scan one note; links only to notes that exist (#581). */
	remNote: (filePath: string) => Promise<unknown>;
}

/** Enrichment trigger recorded on the proposal for each post-op source; enrichment never re-enriches itself. */
const TRIGGER_BY_SOURCE: Record<Exclude<PostOpSource, 'enrichment'>, PostOpTrigger> = {
	elaboration: 'elaboration',
	audio: 'transcription',
	video: 'transcription',
	image: 'transcription',
	summarize: 'summarization',
	'deep-dive': 'deep-dive',
};

/** `illustrate.runAfter` toggle each source answers to; audio/video/image share `transcription`. */
const RUN_AFTER_BY_SOURCE: Record<PostOpSource, IllustrateRunAfterKey> = {
	elaboration: 'elaboration',
	audio: 'transcription',
	video: 'transcription',
	image: 'transcription',
	summarize: 'summarize',
	'deep-dive': 'deepDive',
	enrichment: 'enrichment',
};

/**
 * Post-op chain for one source, each leg gated independently: auto-enrich
 * (wire time) + title check (live under auto-enrich, wire time standalone),
 * deep-dive REM (wire time, `deepDive.autoRemOnAccept`), then illustrate (wire-gated on `illustrate.enabled`, `runAfter` read live).
 * Returns null when no leg is wired so the module's hook slot stays untouched.
 */
export function buildPostOpHook(deps: PostOpHookDeps, source: PostOpSource): PostOpHook | null {
	const { getSettings, notifications } = deps;
	const settings = getSettings();
	const checkTitle = (filePath: string) =>
		fireAndForget(deps.checkTitle(filePath), 'Check note title', { notifications });
	const legs: PostOpHook[] = [];

	// Deep dive opts out of the whole enrich/title chain when autoEnrichOnAccept is off (pre-#213 behavior kept).
	const autoEnrich = settings.enrichment.enabled && settings.enrichment.autoEnrich;
	const deepDiveOptedOut = source === 'deep-dive' && autoEnrich && !settings.deepDive.autoEnrichOnAccept;
	if (source !== 'enrichment' && !deepDiveOptedOut) {
		const trigger = TRIGGER_BY_SOURCE[source];
		const titleCheck = settings.title.enabled && settings.title.checkAfterOperations;
		if (autoEnrich) {
			legs.push((filePath) => {
				fireAndForget(deps.enrich(filePath, trigger), 'Enrich note', { notifications });
				const live = getSettings();
				if (live.title.enabled && live.title.checkAfterOperations) checkTitle(filePath);
			});
		} else if (titleCheck) {
			legs.push((filePath) => checkTitle(filePath));
		}
	}

	if (source === 'deep-dive' && settings.rem.enabled && settings.deepDive.autoRemOnAccept) {
		legs.push((filePath) =>
			fireAndForget(deps.remNote(filePath), 'Discover REM links', { notifications }));
	}

	if (settings.illustrate.enabled) {
		const key = RUN_AFTER_BY_SOURCE[source];
		legs.push((filePath, ctx) => {
			const live = getSettings().illustrate;
			if (!live.enabled || !live.runAfter[key]) return;
			fireAndForget(deps.illustrateNote(filePath, ctx), 'Illustrate note', { notifications });
		});
	}

	if (legs.length === 0) return null;
	return (filePath, ctx) => { for (const leg of legs) leg(filePath, ctx); };
}

/** Single-note auto-organize hook, wired only when the trigger opts in and organize is enabled. */
export function buildAutoOrganizeHook(
	deps: PostOpHookDeps,
	trigger: AutoOrganizeTrigger
): ((file: TFile) => void) | null {
	const settings = deps.getSettings();
	if (!settings.organize.enabled) return null;
	const optedIn = trigger === 'deep-dive'
		? settings.deepDive.autoOrganizeOnAccept
		: settings.summarize.autoOrganizeOnSummarize;
	if (!optedIn) return null;
	return (file) =>
		fireAndForget(deps.organizeNote(file), 'Organize note', { notifications: deps.notifications });
}
