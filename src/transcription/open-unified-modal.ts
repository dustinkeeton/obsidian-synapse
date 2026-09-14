import type { TFile } from 'obsidian';
import type { TimeRange } from '../shared';
import { UnifiedTranscriptionModal } from './unified-modal';
import { insertUrlTranscript } from './insert-url-transcript';
import type { InsertUrlTranscriptDeps } from './insert-url-transcript';

/** Wiring for {@link openUnifiedTranscriptionModal}: the URL path reuses {@link InsertUrlTranscriptDeps}. */
export interface UnifiedTranscriptionDeps extends InsertUrlTranscriptDeps {
	onTranscribeFile: (file: TFile, timeRange?: TimeRange) => Promise<void>;
}

/** Open the unified transcription modal; local files go to `onTranscribeFile`, URLs through the tier router into the active note. */
export function openUnifiedTranscriptionModal(deps: UnifiedTranscriptionDeps): void {
	const settings = deps.getSettings();
	new UnifiedTranscriptionModal(
		deps.app,
		deps.getSettings,
		{
			audio: settings.audio.enabled,
			video: settings.video.enabled,
		},
		{
			onTranscribeFile: deps.onTranscribeFile,
			onTranscribeUrl: (url, timeRange, forceRefresh) =>
				insertUrlTranscript(deps, url, timeRange, forceRefresh),
		},
		deps.notifications
	).open();
}
