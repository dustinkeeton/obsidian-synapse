import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepDiveModule } from './index';
import { DeepDiveStore } from './deep-dive-store';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import { Platform, type Plugin, type TFile } from 'obsidian';
import { AIClient, NoteOperationQueue } from '../shared';
import type { Checkpoint } from '../shared';
import type { DeepDiveRun } from './types';

vi.mock('./depth-selector-modal', () => ({
	selectDepth: vi.fn(async () => 1),
	MIN_DEPTH: 1,
	MAX_DEPTH: 6,
}));

const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

const TOPIC_TITLES = ['Backpropagation', 'Gradient Descent', 'Overfitting'];
const TOPICS = JSON.stringify(
	TOPIC_TITLES.map((title) => ({ title, description: `About ${title}`, relevance: 0.9 }))
);

describe('DeepDiveModule interrupted runs', () => {
	let settings: SynapseSettings;
	let mod: DeepDiveModule;
	let checkpoints: ReturnType<typeof createMockCheckpointManager>;
	let opError: ReturnType<typeof vi.fn>;
	let savedRun: DeepDiveRun | null;
	let generated: string[];
	let failOn: string | null;
	let deepDive: (file: TFile) => Promise<void>;
	let info: ReturnType<typeof vi.fn>;
	let onGenerate: (() => void) | null;

	beforeEach(async () => {
		settings = structuredClone(DEFAULT_SETTINGS);
		savedRun = null;
		generated = [];
		failOn = 'Gradient Descent';
		onGenerate = null;

		const root = mockFile('notes/Root.md');
		const app = createMockApp();
		app.metadataCache.getFileCache = vi.fn().mockReturnValue(null);
		app.vault.getMarkdownFiles.mockReturnValue([root]);
		app.vault.getAbstractFileByPath.mockImplementation((p: string) => (p === root.path ? root : null));
		app.vault.read.mockResolvedValue('# Root\n\nA note about neural network training.');

		opError = vi.fn();
		info = vi.fn();
		const notifications = {
			info,
			success: vi.fn(),
			notifyError: vi.fn(),
			confirm: vi.fn().mockResolvedValue(true),
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: opError, cancelled: false })),
		};

		vi.spyOn(DeepDiveStore.prototype, 'init').mockResolvedValue(undefined);
		vi.spyOn(DeepDiveStore.prototype, 'saveProposal').mockResolvedValue(undefined);
		vi.spyOn(DeepDiveStore.prototype, 'loadProposal').mockResolvedValue(null);
		vi.spyOn(DeepDiveStore.prototype, 'saveRun').mockImplementation(async (run) => {
			savedRun = structuredClone(run);
		});
		vi.spyOn(DeepDiveStore.prototype, 'loadRun').mockImplementation(async () => structuredClone(savedRun));

		vi.spyOn(AIClient.prototype, 'complete').mockImplementation(async (userPrompt: string, systemPrompt?: string) => {
			if (systemPrompt?.includes('knowledge graph analyst')) return TOPICS;
			const topic = TOPIC_TITLES.find((t) => userPrompt.includes(t)) ?? '';
			onGenerate?.();
			if (topic === failOn) throw new Error('The network connection was lost.');
			generated.push(topic);
			return `# ${topic}\n\nGenerated body about ${topic}.`;
		});

		checkpoints = createMockCheckpointManager();
		const register = vi.fn();
		mod = new DeepDiveModule(
			makeModuleDeps({
				plugin: { app } as unknown as Plugin,
				getSettings: () => settings,
				notifications: notifications as never,
				checkpointManager: checkpoints as never,
				registrar: { register } as never,
				noteQueue: new NoteOperationQueue(),
			}),
			() => false
		);
		await mod.onload();

		const spec = register.mock.calls.find((c) => c[0] === 'deep-dive')?.[2] as {
			editorCallback: (editor: unknown, ctx: { file: TFile }) => Promise<void>;
		};
		deepDive = (file: TFile) => spec.editorCallback({}, { file });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		Platform.isMobile = false;
	});

	it('keeps the checkpoint and the remaining queue when generation fails', async () => {
		await deepDive(mockFile('notes/Root.md'));

		expect(checkpoints.discard).not.toHaveBeenCalled();
		expect(checkpoints.complete).not.toHaveBeenCalled();
		expect(opError.mock.calls[0][0]).toContain('Deep dive interrupted');
		expect(savedRun?.status).toBe('in-progress');
		expect(savedRun?.proposalIds).toHaveLength(1);
		expect(savedRun?.pending?.processedCount).toBe(1);
		expect(savedRun?.pending?.tasks.map((t) => t.topic.title)).toEqual(['Gradient Descent', 'Overfitting']);
	});

	it('resumes the remaining topics from the checkpoint', async () => {
		await deepDive(mockFile('notes/Root.md'));
		failOn = null;

		const checkpoint = { id: 'mockcheckpoint', metadata: { runId: savedRun?.id }, remainingItems: [] } as unknown as Checkpoint;
		await mod.resumeFromCheckpoint(checkpoint);

		expect(generated).toEqual(['Backpropagation', 'Gradient Descent', 'Overfitting']);
		expect(checkpoints.complete).toHaveBeenCalledWith('mockcheckpoint');
		expect(savedRun?.status).toBe('completed');
		expect(savedRun?.pending).toBeUndefined();
		expect(savedRun?.proposalIds).toHaveLength(3);
	});

	it('discards a checkpoint whose run has no saved queue', async () => {
		const checkpoint = { id: 'mockcheckpoint', metadata: { runId: 'missing' }, remainingItems: [] } as unknown as Checkpoint;

		await mod.resumeFromCheckpoint(checkpoint);

		expect(checkpoints.discard).toHaveBeenCalledWith('mockcheckpoint');
		expect(generated).toEqual([]);
	});

	describe('returning from the background', () => {
		const PAUSE_MESSAGE = 'Deep dive paused while Obsidian was in the background — resuming';

		function backgroundOnce(): void {
			const doc = new (class extends EventTarget { visibilityState = 'visible'; })();
			vi.stubGlobal('document', doc);
			let done = false;
			onGenerate = () => {
				if (done) return;
				done = true;
				for (const state of ['hidden', 'visible']) {
					doc.visibilityState = state;
					doc.dispatchEvent(new Event('visibilitychange'));
				}
			};
		}

		beforeEach(() => {
			failOn = null;
		});

		it('tells a mobile user the run is resuming', async () => {
			Platform.isMobile = true;
			backgroundOnce();

			await deepDive(mockFile('notes/Root.md'));

			expect(info.mock.calls.filter((c) => c[0] === PAUSE_MESSAGE)).toHaveLength(1);
		});

		it('stays quiet on desktop, where requests keep running', async () => {
			backgroundOnce();

			await deepDive(mockFile('notes/Root.md'));

			expect(info).not.toHaveBeenCalledWith(PAUSE_MESSAGE);
		});
	});
});
