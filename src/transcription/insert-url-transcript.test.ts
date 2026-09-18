import { describe, it, expect, vi } from 'vitest';
import { TFile } from '../__mocks__/obsidian';
import { appendUrlTranscript, insertUrlTranscript } from './insert-url-transcript';
import { UrlTranscriptionRouter } from './url-transcription';
import type { UrlTranscript, UrlTranscriptionStrategy, TranscriptStore } from './url-transcription';
import { DEFAULT_SETTINGS } from '../settings';
import { NoSpeechDetectedError, NoteOperationQueue } from '../shared';
import type { NotificationManager, TranscriptCacheEntry } from '../shared';

const URL = 'https://www.youtube.com/watch?v=abc123xyz00';
const CACHED_TRANSCRIPT_NOTE = 'used a cached transcript ("Fetch a fresh transcript" in Transcribe media replaces it)';

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
		expect(op.finish).toHaveBeenCalledWith(`Transcription added to note — ${CACHED_TRANSCRIPT_NOTE}`);
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

describe('cache reporting (#527)', () => {
	it('appendUrlTranscript reports a stored transcript the same way the modal insert does', async () => {
		const store = memoryStore();
		const captions = tier({ text: 'hello world', raw: 'hello world', source: 'captions' });
		await new UrlTranscriptionRouter([captions], store).transcribe(URL);
		const { deps, op } = makeDeps(new UrlTranscriptionRouter([captions], store));

		await appendUrlTranscript(deps, URL, new TFile('Intake/a.md') as never);

		expect(captions.transcribe).toHaveBeenCalledOnce();
		expect(op.finish).toHaveBeenCalledWith(`Transcript added — ${CACHED_TRANSCRIPT_NOTE}`);
	});

	it('appendUrlTranscript keeps the plain message for a fresh transcript', async () => {
		const fresh = tier({ text: 'hello world', raw: 'hello world', source: 'captions' });
		const { deps, op } = makeDeps(new UrlTranscriptionRouter([fresh], memoryStore()));

		await appendUrlTranscript(deps, URL, new TFile('Intake/a.md') as never);

		expect(op.finish).toHaveBeenCalledWith('Transcript added');
	});

	it('reports a fresh transcript whose AI post-processing was replayed', async () => {
		const replayed = tier({ text: 'hello world', raw: 'hello world', source: 'captions', aiCached: true });
		const store = memoryStore();
		const { deps, op } = makeDeps(new UrlTranscriptionRouter([replayed], store));

		await insertUrlTranscript(deps, URL);

		expect(op.finish).toHaveBeenCalledWith('Transcription added to note — used a cached AI response');
		expect(await store.get(URL)).not.toHaveProperty('aiCached');
	});
});

describe('no-speech outcome (#524)', () => {
	function silentTier(): UrlTranscriptionStrategy {
		return { id: 'local-extraction', canHandle: () => true, transcribe: () => Promise.reject(new NoSpeechDetectedError()) };
	}

	it('insertUrlTranscript leaves the note untouched, stores nothing, and shows a notice', async () => {
		const store = memoryStore();
		const { deps, op, content } = makeDeps(new UrlTranscriptionRouter([silentTier()], store));
		const onComplete = vi.fn();

		await insertUrlTranscript({ ...deps, onComplete }, URL);

		expect(content()).toBe('# Note\n');
		expect(onComplete).not.toHaveBeenCalled();
		expect(await store.get(URL)).toBeNull();
		expect(op.error).not.toHaveBeenCalled();
		expect(op.finish).toHaveBeenCalledWith('No speech detected in this video — nothing to transcribe');
	});

	it('appendUrlTranscript resolves without writing so intake does not retry a silent video', async () => {
		const { deps, op, content } = makeDeps(new UrlTranscriptionRouter([silentTier()], memoryStore()));

		await expect(appendUrlTranscript(deps, URL, new TFile('Intake/a.md') as never)).resolves.toBeUndefined();

		expect(content()).toBe('# Note\n');
		expect(op.error).not.toHaveBeenCalled();
		expect(op.finish).toHaveBeenCalledWith('No speech detected in this video — nothing to transcribe');
	});

	it('appendUrlTranscript still rethrows any other failure', async () => {
		const failing: UrlTranscriptionStrategy = {
			id: 'local-extraction', canHandle: () => true, transcribe: () => Promise.reject(new Error('status 500')),
		};
		const { deps, op } = makeDeps(new UrlTranscriptionRouter([failing], memoryStore()));

		await expect(appendUrlTranscript(deps, URL, new TFile('Intake/a.md') as never)).rejects.toThrow('status 500');
		expect(op.error).toHaveBeenCalled();
	});
});
