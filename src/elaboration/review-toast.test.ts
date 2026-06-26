import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElaborationModule } from './index';
import { ProposalStore } from './proposal-store';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockApp, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';
import type { DetectionResult, Proposal } from './types';

// Detector flags the note as a stub; proposer returns a concrete proposal — the
// path that creates a reviewable elaboration item.
vi.mock('./detector', () => ({
	PlaceholderDetector: class MockPlaceholderDetector {
		constructor(_app: unknown, _getSettings: unknown) {}
		detect = vi.fn(
			async (file: TFile): Promise<DetectionResult> => ({
				notePath: file.path,
				reasons: [{ type: 'short-note', wordCount: 3 }],
			})
		);
	},
}));

vi.mock('./proposer', () => ({
	ProposalGenerator: class MockProposalGenerator {
		constructor(_app: unknown, _getSettings: unknown, _notifications: unknown) {}
		generate = vi.fn(
			async (result: DetectionResult): Promise<Proposal> => ({
				id: 'prop-1',
				sourceNotePath: result.notePath,
				createdAt: '2026-06-26T00:00:00.000Z',
				detectionReasons: result.reasons,
				originalContent: 'stub',
				proposedAdditions: 'Generated elaboration body.',
				insertionPoint: 'append',
				status: 'pending',
			})
		);
	},
}));

function makeOp(cancelled = false) {
	return { progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled };
}

describe('ElaborationModule Review toast action (#366)', () => {
	let app: ReturnType<typeof createMockApp>;
	let plugin: Plugin;
	let settings: SynapseSettings;
	let op: ReturnType<typeof makeOp>;
	let notifications: {
		info: ReturnType<typeof vi.fn>;
		success: ReturnType<typeof vi.fn>;
		notifyError: ReturnType<typeof vi.fn>;
		startOperation: ReturnType<typeof vi.fn>;
	};
	let sourceFile: TFile;

	beforeEach(() => {
		app = createMockApp();
		sourceFile = new TFile('inbox/stub.md');
		app.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === 'inbox/stub.md' ? sourceFile : null
		);
		plugin = { app } as unknown as Plugin;
		settings = structuredClone(DEFAULT_SETTINGS);

		op = makeOp();
		notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			startOperation: vi.fn(() => op),
		};

		vi.spyOn(ProposalStore.prototype, 'init').mockResolvedValue(undefined);
		vi.spyOn(ProposalStore.prototype, 'save').mockResolvedValue(undefined);
		// Auto-accept applies the proposal; stub the apply so the toast gating is
		// isolated from vault mutation.
		vi.spyOn(ElaborationModule.prototype, 'acceptProposal').mockResolvedValue(undefined);
	});

	afterEach(() => vi.restoreAllMocks());

	function build(shouldAutoAccept: () => boolean): ElaborationModule {
		const registrar = { register: vi.fn() };
		return new ElaborationModule(
			plugin,
			() => settings,
			notifications as never,
			createMockCheckpointManager() as never,
			registrar as never,
			shouldAutoAccept
		);
	}

	it('forwards a Review action to the scan-note toast when auto-accept is off', async () => {
		settings.autoAccept.elaboration = false;
		const mod = build(() => settings.autoAccept.elaboration);
		const openSpy = vi.fn();
		mod.onOpenProposalView = openSpy;

		await mod.scanNote(sourceFile as never);

		expect(op.finish).toHaveBeenCalledWith(
			'Proposal generated',
			expect.objectContaining({ label: 'Review' })
		);
		op.finish.mock.calls.at(-1)![1].onClick();
		expect(openSpy).toHaveBeenCalledTimes(1);
	});

	it('omits the Review action when auto-accept is on (nothing left to review)', async () => {
		settings.autoAccept.elaboration = true;
		const mod = build(() => settings.autoAccept.elaboration);

		await mod.scanNote(sourceFile as never);

		expect(op.finish).toHaveBeenCalledWith('Proposal generated', undefined);
	});
});
