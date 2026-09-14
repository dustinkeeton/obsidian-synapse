import type { AudioExtractor } from './audio-extractor';

/** Memoized ffmpeg probe for audio combining (#214); always false without an extractor (mobile). */
export function createFfmpegAvailability(extractor: AudioExtractor | undefined): () => Promise<boolean> {
	let cached: boolean | null = null;
	return async () => {
		if (!extractor) return false;
		if (cached === null) {
			try {
				cached = (await extractor.checkDependencies()).ffmpeg;
			} catch {
				cached = false;
			}
		}
		return cached;
	};
}
