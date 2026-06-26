import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepDiveModule } from './index';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockApp, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';

// One new root topic → exactly one generated proposal (a reviewable item).
vi.mock('./topic-analyzer', () => ({
	TopicAnalyzer: class MockTopicAnalyzer {
		constructor(_app: unknown, _getSettings: unknown) {}
		extractTopics = vi.fn(async () => [
			{ title: 'Topic A', description: 'About A', relevance: 0.9, existsInVault: false, relatedUrls: [] },
		]);
	},
}));

vi.mock('./note-generator', () => ({
	NoteGenerator: class MockNoteGenerator {
		constructor(_getSettings: unknown) {}
		generateContent = vi.fn(async () => 'Generated content about Topic A with a handful of words.');
	},
}));

// Depth 1 keeps the run to the root level (no recursive child extraction).
vi.mock('./depth-selector-modal', () => ({
	selectDepth: vi.fn(async () => 1),
}));

vi.mock('./deep-dive-store', () => ({
	DeepDiveStore: class MockDeepDiveStore {
		constructor(_app: unknown, _getSettings: unknown) {}
		init = vi.fn(async () => {});
		saveProposal = vi.fn(async () => {});
		saveRun = vi.fn(async () => {});
		loadProposal = vi.fn(async () => null);
		loadProposalsByRunId = vi.fn(async () => []);
		loadRun = vi.fn(async () => null);
		loadPendingProposals = vi.fn(async () => []);
		updateProposalStatus = vi.fn(async () => {});
	},
}));

function makeOp(cancelled = false) {
	return { progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled };
}

describe('DeepDiveModule Review toast action (#366)', () => {
	let app: ReturnType<typeof createMockApp>;
	let plugin: Plugin;
	let settings: SynapseSettings;
	let scanOp: ReturnType<typeof makeOp>;
	let genOp: ReturnType<typeof makeOp>;
	let notifications: {
		info: ReturnType<typeof vi.fn>;
		success: ReturnType<typeof vi.fn>;
		confirm: ReturnType<typeof vi.fn>;
		notifyError: ReturnType<typeof vi.fn>;
		startOperation: ReturnType<typeof vi.fn>;
	};
	let sourceFile: TFile;

	beforeEach(() => {
		app = createMockApp();
		sourceFile = new TFile('Source.md');
		app.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === 'Source.md' ? sourceFile : null
		);
		app.vault.read.mockResolvedValue('# Source\n\nText with several distinct topics worth exploring.');
		plugin = { app } as unknown as Plugin;
		settings = structuredClone(DEFAULT_SETTINGS);

		scanOp = makeOp();
		genOp = makeOp();
		notifications = {
			info: vi.fn(),
			success: vi.fn(),
			confirm: vi.fn().mockResolvedValue(true),
			notifyError: vi.fn(),
			startOperation: vi.fn((_label: string, id?: string) =>
				id === 'deep-dive-generate' ? genOp : scanOp
			),
		};

		// Auto-accept walks the generated tree and creates notes; isolate the apply.
		vi.spyOn(DeepDiveModule.prototype, 'acceptProposal').mockResolvedValue(undefined);
	});

	afterEach(() => vi.restoreAllMocks());

	function build(shouldAutoAccept: () => boolean): DeepDiveModule {
		const registrar = { register: vi.fn() };
		return new DeepDiveModule(
			plugin,
			() => settings,
			notifications as never,
			createMockCheckpointManager() as never,
			registrar as never,
			shouldAutoAccept
		);
	}

	/** Drive the private deepDive flow the way the editor command would. */
	function runDeepDive(mod: DeepDiveModule): Promise<void> {
		return (mod as unknown as { deepDive: (f: TFile) => Promise<void> }).deepDive(sourceFile);
	}

	it('forwards a Review action to the generation toast when auto-accept is off', async () => {
		settings.autoAccept['deep-dive'] = false;
		const mod = build(() => settings.autoAccept['deep-dive']);
		const openSpy = vi.fn();
		mod.onOpenProposalView = openSpy;

		await runDeepDive(mod);

		expect(genOp.finish).toHaveBeenCalledWith(
			expect.stringContaining('Generated 1 proposals'),
			expect.objectContaining({ label: 'Review' })
		);
		genOp.finish.mock.calls.at(-1)![1].onClick();
		expect(openSpy).toHaveBeenCalledTimes(1);
	});

	it('omits the Review action when auto-accept is on (every node created, nothing to review)', async () => {
		settings.autoAccept['deep-dive'] = true;
		const mod = build(() => settings.autoAccept['deep-dive']);

		await runDeepDive(mod);

		expect(genOp.finish).toHaveBeenCalledWith(
			expect.stringContaining('Generated 1 proposals'),
			undefined
		);
	});
});
