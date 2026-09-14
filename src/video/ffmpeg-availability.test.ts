import { describe, it, expect, vi } from 'vitest';
import { createFfmpegAvailability } from './ffmpeg-availability';
import type { AudioExtractor } from './audio-extractor';

function extractorWith(checkDependencies: () => Promise<{ ytDlp: boolean; ffmpeg: boolean }>) {
	return { checkDependencies: vi.fn(checkDependencies) } as unknown as AudioExtractor & { checkDependencies: ReturnType<typeof vi.fn> };
}

describe('createFfmpegAvailability', () => {
	it('is false without an extractor', async () => {
		await expect(createFfmpegAvailability(undefined)()).resolves.toBe(false);
	});

	it('probes once and caches the result', async () => {
		const extractor = extractorWith(async () => ({ ytDlp: true, ffmpeg: true }));
		const isAvailable = createFfmpegAvailability(extractor);
		await expect(isAvailable()).resolves.toBe(true);
		await expect(isAvailable()).resolves.toBe(true);
		expect(extractor.checkDependencies).toHaveBeenCalledTimes(1);
	});

	it('treats a failed probe as unavailable and does not re-probe', async () => {
		const extractor = extractorWith(async () => { throw new Error('spawn'); });
		const isAvailable = createFfmpegAvailability(extractor);
		await expect(isAvailable()).resolves.toBe(false);
		await expect(isAvailable()).resolves.toBe(false);
		expect(extractor.checkDependencies).toHaveBeenCalledTimes(1);
	});
});
