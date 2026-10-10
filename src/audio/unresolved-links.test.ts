import { describe, it, expect, vi, afterEach } from 'vitest';

const { transcribeMock } = vi.hoisted(() => ({ transcribeMock: vi.fn() }));

vi.mock('./transcriber', () => ({
	Transcriber: class {
		transcribe = transcribeMock;
	},
	GEMINI_MAX_INLINE_AUDIO_BYTES: 15 * 1024 * 1024,
}));

import { AudioModule } from './index';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin, TFile as ObsidianTFile } from 'obsidian';
import { NoteOperationQueue } from '../shared';
import type { NotificationManager, CheckpointManager } from '../shared';
import { DEFAULT_SETTINGS } from '../settings';

const tfile = (p: string): ObsidianTFile => new TFile(p) as unknown as ObsidianTFile;

describe('AudioModule transcript links (#581)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('unlinks transcript wikilinks to notes that do not exist', async () => {
		transcribeMock.mockResolvedValue({ raw: 'We discussed [[Real]] and [[Ghost|the ghost]] today', sourceName: 'one.mp3' });
		let written = '';
		const plugin = {
			app: {
				vault: {
					process: vi.fn(async (_file: unknown, fn: (data: string) => string) => { written = fn('# Memo\n'); return written; }),
					readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(64)),
				},
				metadataCache: { getFirstLinkpathDest: vi.fn((lp: string) => (lp === 'Real' ? {} : null)) },
				workspace: { getActiveFile: vi.fn().mockReturnValue(tfile('notes/memo.md')) },
			},
		};
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.audio.postProcessing.enabled = false;
		const notifications = {
			startOperation: vi.fn(() => ({ update: vi.fn(), progress: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: false })),
			info: vi.fn(),
			notifyError: vi.fn(),
		};
		const module = new AudioModule(makeModuleDeps({
			plugin: plugin as unknown as Plugin,
			getSettings: () => settings,
			notifications: notifications as unknown as NotificationManager,
			checkpointManager: createMockCheckpointManager() as unknown as CheckpointManager,
			noteQueue: new NoteOperationQueue(),
		}), undefined);

		await module.transcribeFileToActiveNote(tfile('audio/one.mp3'));

		expect(written).toContain('We discussed [[Real]] and the ghost today');
	});
});
