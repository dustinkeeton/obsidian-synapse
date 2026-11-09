import { CaptionStrategy } from './caption-strategy';
import { LocalExtractionStrategy } from './local-extraction-strategy';
import { UrlTranscriptionRouter } from './url-transcription';
import type { UrlTranscriptionRouterDeps, UrlTranscriptionStrategy } from './types';

/** Compose the tier router (#184): captions on every platform, local extraction only when a delegate is given. */
export function createUrlTranscriptionRouter(deps: UrlTranscriptionRouterDeps): UrlTranscriptionRouter {
	const strategies: UrlTranscriptionStrategy[] = [
		new CaptionStrategy(deps.getSettings, deps.processTranscriptText),
	];
	if (deps.extract) strategies.push(new LocalExtractionStrategy(deps.extract));
	return new UrlTranscriptionRouter(strategies, deps.store);
}
