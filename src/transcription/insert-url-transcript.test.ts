import { describe, it, expect, vi } from 'vitest';
import { TFile } from '../__mocks__/obsidian';
import { insertUrlTranscript } from './insert-url-transcript';
import { UrlTranscriptionRouter } from './url-transcription';
import type { UrlTranscript, UrlTranscriptionStrategy, TranscriptStore } from './url-transcription';
import { DEFAULT_SETTINGS } from '../settings';
import { NoteOperationQueue } from '../shared';
import type { NotificationManager, TranscriptCacheEntry } from '../shared';

const URL = 'https://www.youtube.com/watch?v=abc123xyz00';

function tier(result: UrlTranscript): UrlTranscriptionStrategy & { transcribe: ReturnType<typeof vi.fn> } {
	return { id: 'captions', canHandle: () => true, transcribe: vi.fn(() => Promise.resolve(result)) };
}

function memoryStore(): TranscriptStore {
	const entries = new Map<string, TranscriptCacheEntry>();
	return {
		get: (url) => Promise.resolve(entries.get(url) ?? null),
		put: (url, t) => {
			entries.set(url, { ...t, url, fetchedAt: 1, lastUsedAt: 1 });
			return Promise.resolve();
		},
	};
}

function makeDeps(router: UrlTranscriptionRouter) {
	let content = '# Note\n';
	const activeFile = new TFile('notes/a.md');
	const op = { update: vi.fn(), finish: vi.fn(), error: vi.fn() };
	const app = {
		workspace: { getActiveFile: () => activeFile },
		vault: {
			process: vi.fn(async (_f: unknown, fn: (d: string) => string) => {
				content = fn(content);
				return content;
			}),
		},
	};
	const notifications = { info: vi.fn(), startOperation: vi.fn(() => op) };
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.exclusions = [];
	return {
		deps: {
			app: app as never,
			getSettings: () => settings,
			notifications: notifications as unknown as NotificationManager,
			router,
			noteQueue: new NoteOperationQueue(),
		},
		op,
		content: () => content,
	};
}

describe('insertUrlTranscript transcript reuse (#488)', () => {
	it('inserts a stored transcript without re-running any tier', async () => {
		const store = memoryStore();
		const captions = tier({ text: 'hello world', raw: 'hello world', source: 'captions' });
		await new UrlTranscriptionRouter([captions], store).transcribe(URL);
		const { deps, op, content } = makeDeps(new UrlTranscriptionRouter([captions], store));

		await insertUrlTranscript(deps, URL);

		expect(captions.transcribe).toHaveBeenCalledOnce();
		expect(content()).toContain(`Transcription of ${URL}`);
		expect(content()).toContain('> hello world');
		expect(op.finish).toHaveBeenCalledWith('Cached transcription added to note');
	});

	it('forceRefresh re-runs the tiers and replaces the stored transcript', async () => {
		const store = memoryStore();
		await new UrlTranscriptionRouter([tier({ text: 'old', raw: 'old', source: 'captions' })], store).transcribe(URL);
		const fresh = tier({ text: 'new', raw: 'new', source: 'captions' });
		const { deps, op, content } = makeDeps(new UrlTranscriptionRouter([fresh], store));

		await insertUrlTranscript(deps, URL, undefined, true);

		expect(fresh.transcribe).toHaveBeenCalledOnce();
		expect(content()).toContain('> new');
		expect(op.finish).toHaveBeenCalledWith('Transcription added to note');
		expect((await store.get(URL))?.text).toBe('new');
	});
});
