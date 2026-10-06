import type { AudioClipper } from '../audio';

/** Memoized ffmpeg probe for audio combining (#214); always false without an extractor (mobile). */
export function createFfmpegAvailability(extractor: AudioClipper | undefined): () => Promise<boolean> {
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
