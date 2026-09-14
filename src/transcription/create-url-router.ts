import type { SynapseSettings } from '../settings';
import { CaptionStrategy } from './caption-strategy';
import type { ProcessTranscript } from './caption-strategy';
import { LocalExtractionStrategy } from './local-extraction-strategy';
import type { LocalExtractionDelegate } from './local-extraction-strategy';
import { UrlTranscriptionRouter } from './url-transcription';
import type { TranscriptStore, UrlTranscriptionStrategy } from './url-transcription';

export interface UrlTranscriptionRouterDeps {
	getSettings: () => SynapseSettings;
	processTranscriptText: ProcessTranscript;
	/** Desktop-only yt-dlp/ffmpeg tier; omit where VideoModule does not exist. */
	extract?: LocalExtractionDelegate;
	store: TranscriptStore;
}

/** Compose the tier router (#184): captions on every platform, local extraction only when a delegate is given. */
export function createUrlTranscriptionRouter(deps: UrlTranscriptionRouterDeps): UrlTranscriptionRouter {
	const strategies: UrlTranscriptionStrategy[] = [
		new CaptionStrategy(deps.getSettings, deps.processTranscriptText),
	];
	if (deps.extract) strategies.push(new LocalExtractionStrategy(deps.extract));
	return new UrlTranscriptionRouter(strategies, deps.store);
}
