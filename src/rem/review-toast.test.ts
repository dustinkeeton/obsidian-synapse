import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { RemModule } from './index';
import { RemStore } from './rem-store';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockApp, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';
import type { NoticeAction } from '../shared';
import type { RemLinkCandidate } from './types';

function candidate(): RemLinkCandidate {
	return {
		targetPath: 'Concepts/Neural Networks.md',
		targetDisplayName: 'Neural Networks',
		matchedText: 'neural networks',
		matchType: 'semantic',
		occurrences: [{ lineNumber: 0, lineText: 'about neural networks', startOffset: 6, endOffset: 21 }],
		confidence: 0.9,
	};
}

describe('RemModule Review toast action (#366)', () => {
	let app: ReturnType<typeof createMockApp>;
	let plugin: Plugin;
	let settings: SynapseSettings;
	let notifications: {
		info: ReturnType<typeof vi.fn>;
		success: Mock<(message: string, duration?: number, action?: NoticeAction) => void>;
		notifyError: ReturnType<typeof vi.fn>;
		startOperation: ReturnType<typeof vi.fn>;
	};
	let sourceFile: TFile;

	beforeEach(() => {
		app = createMockApp();
		sourceFile = new TFile('inbox/note.md');
		app.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === 'inbox/note.md' ? sourceFile : null
		);
		plugin = { app } as unknown as Plugin;
		settings = structuredClone(DEFAULT_SETTINGS);

		notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: false })),
		};

		vi.spyOn(RemStore.prototype, 'init').mockResolvedValue(undefined);
		vi.spyOn(RemStore.prototype, 'save').mockResolvedValue(undefined);
		// Candidate discovery is the heavy scan pipeline; stub it to one candidate.
		vi.spyOn(
			RemModule.prototype as unknown as { gatherCandidates: () => Promise<RemLinkCandidate[]> },
			'gatherCandidates'
		).mockResolvedValue([candidate()]);
		// Auto-accept rewrites the note body; isolate the apply.
		vi.spyOn(RemModule.prototype, 'acceptProposal').mockResolvedValue(undefined);
	});

	afterEach(() => vi.restoreAllMocks());

	async function build(shouldAutoAccept: () => boolean): Promise<RemModule> {
		const registrar = { register: vi.fn() };
		const mod = new RemModule(
			plugin,
			() => settings,
			notifications as never,
			createMockCheckpointManager() as never,
			registrar as never,
			shouldAutoAccept
		);
		await mod.onload();
		return mod;
	}

	it('forwards a Review action to the scan-note toast when auto-accept is off', async () => {
		settings.autoAccept.rem = false;
		const mod = await build(() => settings.autoAccept.rem);
		const openSpy = vi.fn();
		mod.onOpenProposalView = openSpy;

		await mod.remScanNote('inbox/note.md');

		expect(notifications.success).toHaveBeenCalledWith(
			expect.stringContaining('linkable mention'),
			undefined,
			expect.objectContaining({ label: 'Review' })
		);
		notifications.success.mock.calls.at(-1)![2]!.onClick();
		expect(openSpy).toHaveBeenCalledTimes(1);
	});

	it('omits the Review action when auto-accept is on (links inserted, nothing to review)', async () => {
		settings.autoAccept.rem = true;
		const mod = await build(() => settings.autoAccept.rem);

		await mod.remScanNote('inbox/note.md');

		expect(notifications.success).toHaveBeenCalledWith(
			expect.stringContaining('linkable mention'),
			undefined,
			undefined
		);
	});
});
