import { describe, it, expect, vi, afterEach } from 'vitest';
import { ImageModule } from './index';
import { DEFAULT_SETTINGS } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin, TFile as ObsidianTFile } from 'obsidian';
import { AIClient, NoteOperationQueue } from '../shared';

const mockFile = (path: string): ObsidianTFile => rawFile(path) as unknown as ObsidianTFile;

describe('ImageModule OCR output links (#581)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('unlinks OCR wikilinks to notes that do not exist', async () => {
		const app = createMockApp();
		app.vault.read.mockResolvedValue('# Active\n');
		app.metadataCache.getFirstLinkpathDest.mockImplementation((lp: string) => (lp === 'Real' ? mockFile('Real.md') : null));
		const active = mockFile('notes/Active.md');
		(app.workspace as unknown as { getActiveFile: () => ObsidianTFile }).getActiveFile = () => active;
		vi.spyOn(AIClient.prototype, 'chat').mockResolvedValue('Mentions [[Real]] and [[Ghost]]');
		const op = { progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: false };
		const mod = new ImageModule(makeModuleDeps({
			plugin: { app } as unknown as Plugin,
			getSettings: () => structuredClone(DEFAULT_SETTINGS),
			notifications: { info: vi.fn(), success: vi.fn(), notifyError: vi.fn(), startOperation: vi.fn(() => op) } as never,
			checkpointManager: createMockCheckpointManager() as never,
			registrar: { register: vi.fn() } as never,
			noteQueue: new NoteOperationQueue(),
		}));

		await mod.extractFromFile(mockFile('images/img.png'));

		const written = (await app.vault.process.mock.results[0].value) as string;
		expect(written).toContain('Mentions [[Real]] and Ghost');
	});
});
