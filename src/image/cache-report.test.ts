import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImageModule } from './index';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin, TFile as ObsidianTFile } from 'obsidian';
import { AIClient, NoteOperationQueue } from '../shared';
import type { AIRequestOptions, ChatMessage } from '../shared';
import type { ImageEmbed } from './types';

const mockFile = (path: string): ObsidianTFile => rawFile(path) as unknown as ObsidianTFile;

describe('ImageModule cache reporting (#527)', () => {
	let settings: SynapseSettings;
	let finish: ReturnType<typeof vi.fn>;
	let mod: ImageModule;
	let replays: number;

	const embed = (fileName: string, line: number): ImageEmbed => ({
		fileName,
		file: mockFile(`images/${fileName}`),
		line,
	});

	beforeEach(() => {
		replays = 0;
		settings = structuredClone(DEFAULT_SETTINGS);
		const app = createMockApp();
		app.vault.read.mockResolvedValue('line0\nline1\nline2');
		const active = mockFile('notes/Active.md');
		(app.workspace as unknown as { getActiveFile: () => ObsidianTFile | null }).getActiveFile = () => active;

		finish = vi.fn();
		const notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish, error: vi.fn(), cancelled: false })),
		};

		// Replay the first `replays` OCR calls of the run; the rest dispatch fresh.
		let seen = 0;
		vi.spyOn(AIClient.prototype, 'chat').mockImplementation(
			async (_messages: ChatMessage[], aiOpts?: AIRequestOptions) => {
				if (seen++ < replays) aiOpts?.onCacheHit?.();
				return 'extracted text';
			}
		);

		mod = new ImageModule(
			makeModuleDeps({
				plugin: { app } as unknown as Plugin,
				getSettings: () => settings,
				notifications: notifications as never,
				checkpointManager: createMockCheckpointManager() as never,
				registrar: { register: vi.fn() } as never,
				noteQueue: new NoteOperationQueue(),
			})
		);
	});

	afterEach(() => vi.restoreAllMocks());

	const lastFinish = (): unknown => finish.mock.calls.at(-1)?.[0];

	it('says a single OCR extraction replayed a cached AI response', async () => {
		replays = 1;

		await mod.extractFromFile(mockFile('images/img.png'));

		expect(lastFinish()).toBe('OCR of img.png added to note — used a cached AI response');
	});

	it('keeps the plain message for a fresh OCR extraction', async () => {
		await mod.extractFromFile(mockFile('images/img.png'));

		expect(lastFinish()).toBe('OCR of img.png added to note');
	});

	it('aggregates a multi-image note into one line', async () => {
		replays = 2;

		await mod.extractAndInsert(mockFile('notes/Doc.md'), [embed('a.png', 0), embed('b.png', 1), embed('c.png', 2)]);

		expect(lastFinish()).toBe('Done -- 3/3 OCR extractions added — 2 of 3 served from cache');
	});

	it('keeps the multi-image message unchanged when nothing was replayed', async () => {
		await mod.extractAndInsert(mockFile('notes/Doc.md'), [embed('a.png', 0), embed('b.png', 1), embed('c.png', 2)]);

		expect(lastFinish()).toBe('Done -- 3/3 OCR extractions added');
	});
});
