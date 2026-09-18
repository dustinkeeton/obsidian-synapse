import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile } from '../__mocks__/obsidian';
import { AudioModule } from '../audio';
import { createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import { DEFAULT_SETTINGS } from '../settings';
import { AIClient, NoteOperationQueue } from '../shared';
import type { NotificationManager, TranscriptCacheEntry } from '../shared';
import { createUrlTranscriptionRouter } from './create-url-router';
import { insertUrlTranscript } from './insert-url-transcript';
import type { InsertUrlTranscriptDeps } from './insert-url-transcript';
import type { TranscriptStore } from './url-transcription';
import * as youtubeCaptions from './youtube-captions';

type Dispatcher = { dispatch: (messages: unknown) => Promise<string> };

const URL = 'https://www.youtube.com/watch?v=abc123xyz00';

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

describe('"Fetch a fresh transcript" bypasses the AI post-processing cache (#527)', () => {
	let audio: AudioModule;
	let finish: ReturnType<typeof vi.fn>;
	let content: string;
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.exclusions = [];
	settings.ai.temperature = 0;
	settings.audio.postProcessing.enabled = true;
	settings.audio.postProcessing.addStructure = true;

	function deps(store: TranscriptStore): InsertUrlTranscriptDeps {
		const op = { update: vi.fn(), finish, error: vi.fn() };
		return {
			app: {
				workspace: { getActiveFile: () => new TFile('notes/a.md') },
				vault: {
					process: vi.fn(async (_f: unknown, fn: (d: string) => string) => {
						content = fn(content);
						return content;
					}),
				},
			} as never,
			getSettings: () => settings,
			notifications: { info: vi.fn(), startOperation: vi.fn(() => op) } as unknown as NotificationManager,
			router: createUrlTranscriptionRouter({
				getSettings: () => settings,
				processTranscriptText: (raw, opts) => audio.processTranscriptText(raw, opts),
				store,
			}),
			noteQueue: new NoteOperationQueue(),
		};
	}

	beforeEach(() => {
		content = '# Note\n';
		finish = vi.fn();
		vi.spyOn(youtubeCaptions, 'fetchYouTubeTranscript').mockResolvedValue({
			text: 'plain caption words from a video', language: 'en', auto: true, structured: false,
		});
		audio = new AudioModule(
			makeModuleDeps({
				plugin: { app: {} } as never,
				getSettings: () => settings,
				notifications: { info: vi.fn() } as never,
				checkpointManager: createMockCheckpointManager() as never,
				noteQueue: new NoteOperationQueue(),
			}),
			undefined
		);
	});

	afterEach(() => vi.restoreAllMocks());

	it('replays the cleanup pass without the toggle and dispatches it with the toggle', async () => {
		const dispatch = vi
			.spyOn(AIClient.prototype as unknown as Dispatcher, 'dispatch')
			.mockResolvedValueOnce('Stale cleanup.')
			.mockResolvedValue('Fresh cleanup.');

		await insertUrlTranscript(deps(memoryStore()), URL);
		await insertUrlTranscript(deps(memoryStore()), URL);
		const store = memoryStore();
		await insertUrlTranscript(deps(store), URL, undefined, true);

		expect(finish.mock.calls.map((c) => c[0] as string)).toEqual([
			'Transcription added to note',
			'Transcription added to note — used a cached AI response',
			'Transcription added to note',
		]);
		expect(dispatch).toHaveBeenCalledTimes(2);
		expect((await store.get(URL))?.text).toBe('Fresh cleanup.');

		await insertUrlTranscript(deps(memoryStore()), URL);

		expect(dispatch).toHaveBeenCalledTimes(2);
		expect(content.match(/Fresh cleanup\./g)).toHaveLength(2);
		expect(finish).toHaveBeenLastCalledWith('Transcription added to note — used a cached AI response');
	});
});
