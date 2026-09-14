import type { TFile } from 'obsidian';
import { fireAndForget } from '../shared';
import type { NotificationManager } from '../shared';
import type { SynapseSettings } from '../settings';
import type { PostOpHook, PostOpSource, PostOpTrigger, AutoOrganizeTrigger } from './types';

export interface PostOpHookDeps {
	getSettings: () => SynapseSettings;
	notifications: NotificationManager;
	enrich: (filePath: string, trigger: PostOpTrigger) => Promise<void>;
	checkTitle: (filePath: string) => Promise<void>;
	organizeNote: (file: TFile) => Promise<unknown>;
}

/** Enrichment trigger recorded on the proposal for each post-op source. */
const TRIGGER_BY_SOURCE: Record<PostOpSource, PostOpTrigger> = {
	elaboration: 'elaboration',
	audio: 'transcription',
	video: 'transcription',
	image: 'transcription',
	summarize: 'summarization',
	'deep-dive': 'deep-dive',
};

/**
 * Post-op chain for one source: auto-enrich (when enabled at wire time) plus a
 * title check. Under auto-enrich the title gate is read live per call; the
 * standalone title hook is gated once at wire time. Returns null when nothing
 * is wired so the module's hook slot stays untouched.
 */
export function buildPostOpHook(deps: PostOpHookDeps, source: PostOpSource): PostOpHook | null {
	const { getSettings, notifications } = deps;
	const settings = getSettings();
	const autoEnrich = settings.enrichment.enabled && settings.enrichment.autoEnrich;
	const titleCheck = settings.title.enabled && settings.title.checkAfterOperations;
	const checkTitle = (filePath: string) =>
		fireAndForget(deps.checkTitle(filePath), 'Check note title', { notifications });

	if (autoEnrich) {
		if (source === 'deep-dive' && !settings.deepDive.autoEnrichOnAccept) return null;
		const trigger = TRIGGER_BY_SOURCE[source];
		return (filePath) => {
			fireAndForget(deps.enrich(filePath, trigger), 'Enrich note', { notifications });
			const live = getSettings();
			if (live.title.enabled && live.title.checkAfterOperations) checkTitle(filePath);
		};
	}
	if (titleCheck) return (filePath) => checkTitle(filePath);
	return null;
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
