import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { TFile } from '../__mocks__/obsidian';
import { VideoModule } from './index';
import type { VideoUrlEmbed } from './types';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';

/**
 * Batch note-media transcription goes through the injected tier-routed
 * transcriber (#184) — captioned YouTube must never be forced through the
 * download/extract pipeline (the pre-#184 behavior that hit provider size
 * limits on long videos).
 */

const URL = 'https://www.youtube.com/watch?v=abc123xyz00';

function makeOperation() {
	return {
		update: vi.fn(),
		progress: vi.fn(),
		finish: vi.fn(),
		error: vi.fn(),
		cancelled: false,
	};
}

function makeModule() {
	const store = new Map<string, string>();
	const noteFile = new TFile('Notes/video-note.md');
	store.set(noteFile.path, 'line0\nhttps://www.youtube.com/watch?v=abc123xyz00\nline2');

	const vault = {
		process: vi.fn(async (file: TFile, fn: (data: string) => string) => {
			const result = fn(store.get(file.path) ?? '');
			store.set(file.path, result);
			return result;
		}),
	};
	const notifications = {
		startOperation: vi.fn().mockReturnValue(makeOperation()),
		info: vi.fn(),
		notifyError: vi.fn(),
	};
	const getSettings = () =>
		({
			video: { enabled: true, embedInNote: true, downloadFolder: 'Media' },
			exclusions: [],
		}) as never;
	const plugin = { app: { vault } } as never;

	const mod = new VideoModule(
		plugin,
		getSettings,
		{} as never,
		notifications as never,
		createMockCheckpointManager() as never,
		{} as never
	);
	const processUrl = vi.spyOn(mod, 'processUrl');
	return { mod, store, noteFile, notifications, processUrl };
}

function embed(line: number): VideoUrlEmbed {
	return { url: URL, platform: 'youtube', line };
}

beforeEach(() => {
	vi.stubGlobal('window', globalThis);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('VideoModule.transcribeAndInsert tier routing (#184)', () => {
	it('uses the injected tier-routed transcriber, never direct extraction', async () => {
		const { mod, store, noteFile, processUrl } = makeModule();
		mod.urlTranscriber = vi.fn().mockResolvedValue({ text: 'caption transcript' });

		await mod.transcribeAndInsert(noteFile as never, [embed(1)]);

		expect(mod.urlTranscriber).toHaveBeenCalledWith(URL, expect.anything());
		expect(processUrl).not.toHaveBeenCalled();
		const content = store.get(noteFile.path)!;
		expect(content).toContain('> [!synapse-transcription]- Transcription of');
		expect(content).toContain('> caption transcript');
	});

	it('embeds the downloaded video when the routed result carries a vault path', async () => {
		const { mod, store, noteFile } = makeModule();
		mod.urlTranscriber = vi.fn().mockResolvedValue({
			text: 'extracted transcript',
			videoVaultPath: 'Media/2026-07-15-video.mp4',
		});

		await mod.transcribeAndInsert(noteFile as never, [embed(1)]);

		expect(store.get(noteFile.path)).toContain('![[2026-07-15-video.mp4]]');
	});

	it('surfaces a routed failure per embed without inserting anything', async () => {
		const { mod, store, noteFile, notifications } = makeModule();
		const before = store.get(noteFile.path);
		mod.urlTranscriber = vi.fn().mockRejectedValue(new Error('no transcription path'));

		await mod.transcribeAndInsert(noteFile as never, [embed(1)]);

		expect(notifications.notifyError).toHaveBeenCalled();
		expect(store.get(noteFile.path)).toBe(before);
	});

	it('falls back to direct extraction when no transcriber is wired', async () => {
		const { mod, store, noteFile, processUrl } = makeModule();
		(processUrl as Mock).mockResolvedValue({
			raw: 'raw',
			processed: 'extracted transcript',
			sourceName: 'v',
		});

		await mod.transcribeAndInsert(noteFile as never, [embed(1)]);

		expect(processUrl).toHaveBeenCalledWith(URL, { insertMode: true }, expect.anything());
		expect(store.get(noteFile.path)).toContain('> extracted transcript');
	});
});
