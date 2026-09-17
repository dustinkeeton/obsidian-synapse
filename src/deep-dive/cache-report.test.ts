import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepDiveModule } from './index';
import { DeepDiveStore } from './deep-dive-store';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin, TFile } from 'obsidian';
import { AIClient, NoteOperationQueue } from '../shared';
import type { AIRequestOptions } from '../shared';

vi.mock('./depth-selector-modal', () => ({
	// Depth 1 keeps the run flat: one proposal (and one AI call) per root topic.
	selectDepth: vi.fn(async () => 1),
	MIN_DEPTH: 1,
	MAX_DEPTH: 6,
}));

const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

const TOPIC_TITLES = ['Backpropagation', 'Gradient Descent', 'Overfitting'];
const TOPICS = JSON.stringify(
	TOPIC_TITLES.map((title) => ({ title, description: `About ${title}`, relevance: 0.9 }))
);

describe('DeepDiveModule cache reporting (#527)', () => {
	let settings: SynapseSettings;
	let finish: ReturnType<typeof vi.fn>;
	let deepDive: (file: TFile) => Promise<void>;
	let replayedTopics: Set<string>;
	let scanReplayed: boolean;
	let topicsResponse: string;

	beforeEach(async () => {
		replayedTopics = new Set();
		scanReplayed = false;
		topicsResponse = TOPICS;
		settings = structuredClone(DEFAULT_SETTINGS);

		const root = mockFile('notes/Root.md');
		const app = createMockApp();
		app.metadataCache.getFileCache = vi.fn().mockReturnValue(null);
		app.vault.getMarkdownFiles.mockReturnValue([root]);
		app.vault.getAbstractFileByPath.mockImplementation((p: string) => (p === root.path ? root : null));
		app.vault.read.mockResolvedValue('# Root\n\nA note about neural network training.');

		finish = vi.fn();
		const notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			confirm: vi.fn().mockResolvedValue(true),
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish, error: vi.fn(), cancelled: false })),
		};

		vi.spyOn(DeepDiveStore.prototype, 'init').mockResolvedValue(undefined);
		vi.spyOn(DeepDiveStore.prototype, 'saveProposal').mockResolvedValue(undefined);
		vi.spyOn(DeepDiveStore.prototype, 'saveRun').mockResolvedValue(undefined);
		vi.spyOn(DeepDiveStore.prototype, 'loadProposal').mockResolvedValue(null);

		vi.spyOn(AIClient.prototype, 'complete').mockImplementation(
			async (userPrompt: string, systemPrompt?: string, aiOpts?: AIRequestOptions) => {
				if (systemPrompt?.includes('knowledge graph analyst')) {
					if (scanReplayed) aiOpts?.onCacheHit?.();
					return topicsResponse;
				}
				const topic = TOPIC_TITLES.find((t) => userPrompt.includes(t));
				if (topic && replayedTopics.has(topic)) aiOpts?.onCacheHit?.();
				return `# ${topic}\n\nGenerated body about ${topic}.`;
			}
		);

		const register = vi.fn();
		const mod = new DeepDiveModule(
			makeModuleDeps({
				plugin: { app } as unknown as Plugin,
				getSettings: () => settings,
				notifications: notifications as never,
				checkpointManager: createMockCheckpointManager() as never,
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

	afterEach(() => vi.restoreAllMocks());

	it('says the topic scan replayed a cached AI response', async () => {
		scanReplayed = true;

		await deepDive(mockFile('notes/Root.md'));

		expect(finish.mock.calls[0][0]).toBe('Found 3 topics (3 new, 0 existing) — used a cached AI response');
	});

	it('keeps the plain message for a fresh topic scan', async () => {
		await deepDive(mockFile('notes/Root.md'));

		expect(finish.mock.calls[0][0]).toBe('Found 3 topics (3 new, 0 existing)');
	});

	it('reports a replay that found no topics', async () => {
		topicsResponse = '[]';
		scanReplayed = true;

		await deepDive(mockFile('notes/Root.md'));

		expect(finish.mock.calls[0][0]).toBe('No topics found — used a cached AI response');
	});

	it('aggregates a generation run into one line', async () => {
		replayedTopics.add('Gradient Descent');

		await deepDive(mockFile('notes/Root.md'));

		expect(finish.mock.calls.at(-1)?.[0]).toBe('Generated 3 proposals (depth 0: 3) — 1 of 3 served from cache');
	});

	it('keeps the generation message unchanged when nothing was replayed', async () => {
		await deepDive(mockFile('notes/Root.md'));

		expect(finish.mock.calls.at(-1)?.[0]).toBe('Generated 3 proposals (depth 0: 3)');
	});
});
