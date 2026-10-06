import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { Plugin, TFile } from 'obsidian';
import { IllustrateModule } from './index';
import { IllustrateStore } from './proposal-store';
import { NoteAnalyzer } from './note-analyzer';
import { AssetWriter } from './asset-writer';
import { WikimediaProvider } from './providers/wikimedia';
import { OpenverseProvider } from './providers/openverse';
import { DEFAULT_SETTINGS, type SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { CheckpointManager, NotificationManager, NoticeAction } from '../shared';
import type { CommandRegistrar } from '../commands';
import type { IllustrateProposal, MediaCandidate } from './types';

const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

const candidate: MediaCandidate = {
	provider: 'wikimedia', title: 'Red panda.jpg', fileUrl: 'https://upload.wikimedia.org/rp.jpg', thumbnailUrl: 'https://t/rp.jpg',
	pageUrl: 'https://commons.wikimedia.org/wiki/File:Red_panda.jpg', license: 'CC BY-SA', licenseUrl: 'https://cc/by-sa', attribution: 'Jane',
};

function proposal(): IllustrateProposal {
	return {
		id: 'prop1', sourceNotePath: 'notes/a.md', createdAt: '2026-01-01T00:00:00Z', status: 'pending',
		items: [
			{ id: 'i-photo', kind: 'photo', anchor: '## Habitat', caption: 'A red panda', rationale: '', candidate },
			{ id: 'i-diagram', kind: 'diagram', anchor: '## Lifecycle', caption: 'Lifecycle', rationale: '', mermaid: 'flowchart TD\nA --> B' },
		],
	};
}

const NOTE = ['# Red panda', '', '## Habitat', 'Forests.', '', '## Lifecycle', 'Birth to death.'].join('\n');

function makeOp(cancelled = false) {
	return { update: vi.fn(), progress: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled };
}

interface MockNotifications {
	info: Mock; success: Mock; notifyError: Mock; confirm: Mock;
	startOperation: Mock<(label: string, id?: string) => ReturnType<typeof makeOp>>;
}

describe('IllustrateModule', () => {
	let app: ReturnType<typeof createMockApp>;
	let settings: SynapseSettings;
	let notifications: MockNotifications;
	let checkpointManager: ReturnType<typeof createMockCheckpointManager>;
	let registrar: { register: Mock };
	let module: IllustrateModule;
	let autoAccept: boolean;
	let op: ReturnType<typeof makeOp>;

	beforeEach(() => {
		app = createMockApp();
		app.vault.read.mockResolvedValue(NOTE);
		app.vault.cachedRead.mockResolvedValue('word '.repeat(100));
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.illustrate.enabled = true;
		op = makeOp();
		notifications = {
			info: vi.fn(), success: vi.fn(), notifyError: vi.fn(), confirm: vi.fn().mockResolvedValue(true),
			startOperation: vi.fn().mockReturnValue(op),
		};
		checkpointManager = createMockCheckpointManager();
		registrar = { register: vi.fn() };
		autoAccept = false;
		vi.spyOn(IllustrateStore.prototype, 'init').mockResolvedValue(undefined);
		vi.spyOn(IllustrateStore.prototype, 'save').mockResolvedValue(undefined);
		vi.spyOn(IllustrateStore.prototype, 'updateStatus').mockResolvedValue(undefined);
		vi.spyOn(IllustrateStore.prototype, 'load').mockResolvedValue(proposal());
		vi.spyOn(OpenverseProvider.prototype, 'search').mockResolvedValue([]);
		module = new IllustrateModule(makeModuleDeps({
			plugin: { app } as unknown as Plugin,
			getSettings: () => settings,
			notifications: notifications as unknown as NotificationManager,
			checkpointManager: checkpointManager as unknown as CheckpointManager,
			registrar: registrar as unknown as CommandRegistrar,
		}), () => autoAccept);
	});

	afterEach(() => vi.restoreAllMocks());

	it('registers both commands gated on the enabled flag', async () => {
		await module.onload();
		const ids = registrar.register.mock.calls.map((call) => call[0] as string);
		expect(ids).toEqual(['illustrate-current-note', 'illustrate-folder']);
		expect(registrar.register.mock.calls.every((call) => call[1] === true)).toBe(true);
	});

	describe('acceptProposal', () => {
		it('downloads the photo, inserts both blocks at their anchors, and marks the proposal accepted', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/a.md'));
			vi.spyOn(AssetWriter.prototype, 'download').mockResolvedValue(mockFile('attachments/red-panda.jpg'));
			await module.acceptProposal('prop1', ['i-photo', 'i-diagram']);
			const written = (await app.vault.process.mock.results[0].value) as string;
			expect(written).toContain('## Habitat\n\n![[attachments/red-panda.jpg]]\n\n> [!synapse-illustrate] A red panda\n> Source: [Red panda.jpg](https://commons.wikimedia.org/wiki/File:Red_panda.jpg) · License: [CC BY-SA](https://cc/by-sa) · Jane\n\nForests.');
			expect(written).toContain('## Lifecycle\n\n```mermaid\nflowchart TD\nA --> B\n```');
			expect(IllustrateStore.prototype.updateStatus).toHaveBeenCalledWith('prop1', 'accepted', ['i-photo', 'i-diagram']);
			expect(notifications.success).toHaveBeenCalledWith('Inserted 2 visuals');
		});

		it('falls back to a remote embed when the download fails and reports partial acceptance', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/a.md'));
			vi.spyOn(AssetWriter.prototype, 'download').mockRejectedValue(new Error('offline'));
			await module.acceptProposal('prop1', ['i-photo']);
			const written = (await app.vault.process.mock.results[0].value) as string;
			expect(written).toContain('![A red panda](https://upload.wikimedia.org/rp.jpg)');
			expect(notifications.info.mock.calls[0][0]).toContain('offline');
			expect(IllustrateStore.prototype.updateStatus).toHaveBeenCalledWith('prop1', 'partially-accepted', ['i-photo']);
		});

		it('embeds the remote URL without downloading when preferDownload is off', async () => {
			settings.illustrate.preferDownload = false;
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/a.md'));
			const download = vi.spyOn(AssetWriter.prototype, 'download');
			await module.acceptProposal('prop1', ['i-photo']);
			expect(download).not.toHaveBeenCalled();
		});

		it('rejects when nothing is selected and refuses non-pending proposals', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/a.md'));
			await module.acceptProposal('prop1', []);
			expect(IllustrateStore.prototype.updateStatus).toHaveBeenCalledWith('prop1', 'rejected');
			vi.mocked(IllustrateStore.prototype.load).mockResolvedValue({ ...proposal(), status: 'accepted' });
			await module.acceptProposal('prop1', ['i-photo']);
			expect(app.vault.process).not.toHaveBeenCalled();
		});
	});

	describe('illustrateNote', () => {
		it('analyzes the note, sources a licensed photo, and stores a proposal', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/a.md'));
			vi.spyOn(NoteAnalyzer.prototype, 'analyze').mockResolvedValue([
				{ kind: 'photo', anchor: '## Habitat', caption: 'c', rationale: '', query: 'red panda' },
				{ kind: 'chart', anchor: '## Lifecycle', caption: 'n', rationale: '', chart: { title: 'T', xLabels: ['a'], series: [{ values: [1] }] } },
			]);
			vi.spyOn(WikimediaProvider.prototype, 'search').mockResolvedValue([{ ...candidate, license: 'CC BY-NC' }, candidate]);
			await module.illustrateNote('notes/a.md');
			const saved = vi.mocked(IllustrateStore.prototype.save).mock.calls[0][0];
			expect(saved.items.map((i) => i.kind)).toEqual(['photo', 'chart']);
			expect(saved.items[0]).toMatchObject({ candidate: { license: 'CC BY-SA' } });
			expect(op.finish).toHaveBeenCalledWith('Illustration proposal created', expect.objectContaining({ label: 'Review' }) as NoticeAction);
		});

		it('drops a photo spot when no provider returns an allowed license', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/a.md'));
			vi.spyOn(NoteAnalyzer.prototype, 'analyze').mockResolvedValue([
				{ kind: 'photo', anchor: '## Habitat', caption: 'c', rationale: '', query: 'red panda' },
			]);
			vi.spyOn(WikimediaProvider.prototype, 'search').mockRejectedValue(new Error('down'));
			await module.illustrateNote('notes/a.md');
			expect(IllustrateStore.prototype.save).not.toHaveBeenCalled();
			expect(op.finish).toHaveBeenCalledWith('No visuals proposed for this note');
		});

		it('skips excluded paths with a notice naming the rule', async () => {
			settings.exclusions.push({ pattern: 'notes/**', features: ['illustrate'] });
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/a.md'));
			const analyze = vi.spyOn(NoteAnalyzer.prototype, 'analyze');
			await module.illustrateNote('notes/a.md');
			expect(analyze).not.toHaveBeenCalled();
			expect(notifications.info.mock.calls[0][0]).toContain('notes/**');
		});
	});

	describe('scanVault', () => {
		it('checkpoints eligible notes, builds proposals, and auto-accepts when enabled', async () => {
			autoAccept = true;
			const files = [mockFile('notes/a.md'), mockFile('notes/short.md')];
			app.vault.getMarkdownFiles.mockReturnValue(files);
			app.vault.cachedRead.mockImplementation((file: { path: string }) => Promise.resolve(file.path === 'notes/short.md' ? 'tiny' : 'word '.repeat(100)));
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => files.find((f) => f.path === path) ?? null);
			vi.spyOn(NoteAnalyzer.prototype, 'analyze').mockResolvedValue([
				{ kind: 'diagram', anchor: '## Lifecycle', caption: 'L', rationale: '', mermaid: 'flowchart TD\nA' },
			]);
			const count = await module.scanVault('notes', true);
			expect(count).toBe(1);
			expect(checkpointManager.create).toHaveBeenCalledWith(expect.objectContaining({ module: 'illustrate', items: [expect.objectContaining({ label: 'notes/a.md' })] }));
			expect(checkpointManager.completeItem).toHaveBeenCalledTimes(1);
			expect(checkpointManager.complete).toHaveBeenCalled();
			expect(app.vault.process).toHaveBeenCalledTimes(1);
			expect(notifications.info).toHaveBeenCalledWith('Auto-accepted 1 illustration proposal');
		});

		it('honors a declined confirmation', async () => {
			app.vault.getMarkdownFiles.mockReturnValue([mockFile('notes/a.md')]);
			notifications.confirm.mockResolvedValue(false);
			expect(await module.scanVault()).toBe(0);
			expect(checkpointManager.create).not.toHaveBeenCalled();
		});

		it('narrows to onlyFile', async () => {
			const files = [mockFile('notes/a.md'), mockFile('notes/b.md')];
			app.vault.getMarkdownFiles.mockReturnValue(files);
			app.vault.getAbstractFileByPath.mockImplementation((path: string) => files.find((f) => f.path === path) ?? null);
			vi.spyOn(NoteAnalyzer.prototype, 'analyze').mockResolvedValue([]);
			await module.scanVault('notes', true, files[1]);
			expect(checkpointManager.create).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ label: 'notes/b.md' })] }));
		});
	});

	it('resumes remaining checkpoint items and completes the checkpoint', async () => {
		app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/a.md'));
		vi.spyOn(NoteAnalyzer.prototype, 'analyze').mockResolvedValue([]);
		await module.resumeFromCheckpoint({
			id: 'cp1', module: 'illustrate', operationLabel: 'x', status: 'active', createdAt: '', updatedAt: '',
			completedItems: [], deferredTasks: [], metadata: {},
			remainingItems: [{ id: 'w1', label: 'notes/a.md', payload: { filePath: 'notes/a.md' } }],
		});
		expect(checkpointManager.completeItem).toHaveBeenCalledWith('cp1', 'w1');
		expect(checkpointManager.complete).toHaveBeenCalledWith('cp1');
	});
});
