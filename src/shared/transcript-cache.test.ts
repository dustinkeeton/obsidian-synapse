import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranscriptCache, canonicalMediaUrl, transcriptCacheKey } from './transcript-cache';
import type { CachedTranscript } from './transcript-cache';

const mockFiles = new Map<string, string>();

const mockAdapter = {
	write: vi.fn(async (path: string, content: string) => {
		mockFiles.set(path, content);
	}),
	read: vi.fn(async (path: string) => {
		const content = mockFiles.get(path);
		if (content === undefined) throw new Error(`File not found: ${path}`);
		return content;
	}),
	exists: vi.fn(async (path: string) => mockFiles.has(path)),
	remove: vi.fn(async (path: string) => {
		mockFiles.delete(path);
	}),
};

const mockApp = {
	vault: {
		adapter: mockAdapter,
		getAbstractFileByPath: vi.fn(() => null),
		createFolder: vi.fn(),
	},
} as unknown as import('obsidian').App;

const YT = 'https://www.youtube.com/watch?v=abc123xyz00';
const YT_SHORT = 'https://youtu.be/abc123xyz00?t=42';

function transcript(overrides: Partial<CachedTranscript> = {}): CachedTranscript {
	return { text: 'processed', raw: 'raw', source: 'captions', title: 'A Video', ...overrides };
}

beforeEach(() => {
	mockFiles.clear();
	vi.clearAllMocks();
});

describe('canonicalMediaUrl', () => {
	it('collapses YouTube URL variants onto the watch URL', () => {
		expect(canonicalMediaUrl(YT_SHORT)).toBe(YT);
		expect(canonicalMediaUrl('https://www.youtube.com/shorts/abc123xyz00')).toBe(YT);
		expect(canonicalMediaUrl('https://m.youtube.com/watch?feature=share&v=abc123xyz00')).toBe(YT);
	});

	it('strips query and fragment from TikTok and Instagram URLs', () => {
		expect(canonicalMediaUrl('https://www.tiktok.com/@user/video/123?lang=en#x')).toBe(
			'https://www.tiktok.com/@user/video/123'
		);
		expect(canonicalMediaUrl('https://www.instagram.com/reels/CODE_1/?igsh=abc')).toBe(
			'https://www.instagram.com/p/CODE_1'
		);
	});

	it('leaves unknown URLs untouched except for the fragment and trailing slash', () => {
		expect(canonicalMediaUrl('https://example.com/a/?q=1#frag')).toBe('https://example.com/a/?q=1');
	});
});

describe('transcriptCacheKey', () => {
	it('separates full-length and clipped transcripts of the same URL', () => {
		const full = transcriptCacheKey(YT);
		const clipped = transcriptCacheKey(YT_SHORT, { startSeconds: 10, endSeconds: 20 });
		expect(full).toBe(YT);
		expect(clipped).toBe(`${YT}#t=10-20`);
	});
});

describe('TranscriptCache', () => {
	it('returns null for a URL never stored', async () => {
		const cache = new TranscriptCache(mockApp);
		expect(await cache.get(YT)).toBeNull();
	});

	it('round-trips a transcript through the vault file under the canonical key', async () => {
		const cache = new TranscriptCache(mockApp);
		await cache.put(YT_SHORT, transcript());

		const fresh = new TranscriptCache(mockApp);
		const entry = await fresh.get(YT);

		expect(entry).toMatchObject({ url: YT, text: 'processed', raw: 'raw', source: 'captions', title: 'A Video' });
		expect(typeof entry?.fetchedAt).toBe('number');
		expect(mockAdapter.write).toHaveBeenCalledWith(
			'.synapse/transcript-cache.json',
			expect.stringContaining('"processed"')
		);
	});

	it('keys clipped transcripts separately from the full transcript', async () => {
		const cache = new TranscriptCache(mockApp);
		const range = { startSeconds: 5, endSeconds: 9 };
		await cache.put(YT, transcript({ text: 'full' }));
		await cache.put(YT, transcript({ text: 'clip', source: 'local-extraction' }), range);

		expect((await cache.get(YT))?.text).toBe('full');
		expect((await cache.get(YT, range))?.text).toBe('clip');
		expect(await cache.get(YT, { startSeconds: 1, endSeconds: 2 })).toBeNull();
	});

	it('clear() empties the store and removes the file', async () => {
		const cache = new TranscriptCache(mockApp);
		await cache.put(YT, transcript());

		await cache.clear();

		expect(await cache.get(YT)).toBeNull();
		expect(mockAdapter.remove).toHaveBeenCalledWith('.synapse/transcript-cache.json');
		expect(await cache.size()).toBe(0);
	});

	it('evicts the least recently used entries past the entry cap', async () => {
		const cache = new TranscriptCache(mockApp, { maxEntries: 2 });
		await cache.put('https://youtu.be/aaaaaaaaaaa', transcript({ text: 'a' }));
		await cache.put('https://youtu.be/bbbbbbbbbbb', transcript({ text: 'b' }));
		await cache.get('https://youtu.be/aaaaaaaaaaa');
		await cache.put('https://youtu.be/ccccccccccc', transcript({ text: 'c' }));

		expect(await cache.get('https://youtu.be/bbbbbbbbbbb')).toBeNull();
		expect((await cache.get('https://youtu.be/aaaaaaaaaaa'))?.text).toBe('a');
		expect((await cache.get('https://youtu.be/ccccccccccc'))?.text).toBe('c');
		expect(await cache.size()).toBe(2);
	});

	it('evicts oldest entries until the total text size fits the byte cap', async () => {
		const cache = new TranscriptCache(mockApp, { maxChars: 10 });
		await cache.put('https://youtu.be/aaaaaaaaaaa', transcript({ text: '12345', raw: '' }));
		await cache.put('https://youtu.be/bbbbbbbbbbb', transcript({ text: '123456', raw: '' }));

		expect(await cache.get('https://youtu.be/aaaaaaaaaaa')).toBeNull();
		expect((await cache.get('https://youtu.be/bbbbbbbbbbb'))?.text).toBe('123456');
	});

	it('ignores a corrupt cache file instead of throwing', async () => {
		mockFiles.set('.synapse/transcript-cache.json', '{not json');
		const cache = new TranscriptCache(mockApp);

		expect(await cache.get(YT)).toBeNull();
		await cache.put(YT, transcript());
		expect((await cache.get(YT))?.text).toBe('processed');
	});

	it('never throws when the adapter write fails', async () => {
		mockAdapter.write.mockRejectedValueOnce(new Error('disk full'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const cache = new TranscriptCache(mockApp);

		await expect(cache.put(YT, transcript())).resolves.toBeUndefined();
		expect((await cache.get(YT))?.text).toBe('processed');
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
