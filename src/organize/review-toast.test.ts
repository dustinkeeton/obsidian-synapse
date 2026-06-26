import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrganizeModule } from './index';
import { OrganizeStore } from './organize-store';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockApp, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';
import type { OrganizeProposal } from './types';

// Analyzer finds a topic; matcher proposes a NEW directory — the only path that
// creates an organize proposal (a reviewable item).
vi.mock('./content-analyzer', () => ({
	ContentAnalyzer: class MockContentAnalyzer {
		constructor(_app: unknown, _getSettings: unknown) {}
		analyze = vi.fn().mockResolvedValue({
			notePath: 'inbox/note.md',
			topics: [{ label: 'machine learning', confidence: 0.95 }],
			tags: [],
			links: [],
		});
	},
}));

vi.mock('./directory-matcher', () => ({
	DirectoryMatcher: class MockDirectoryMatcher {
		constructor(_app: unknown) {}
		scoreDirectories = vi.fn().mockReturnValue([]);
		determineAction = vi.fn().mockReturnValue({
			type: 'propose-new-directory',
			targetDirectory: 'Machine Learning',
			reasoning: 'Note is about machine learning',
		});
	},
}));

function makeOp(cancelled = false) {
	return { progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled };
}

describe('OrganizeModule Review toast action (#340)', () => {
	let app: ReturnType<typeof createMockApp>;
	let plugin: Plugin;
	let notifications: {
		info: ReturnType<typeof vi.fn>;
		success: ReturnType<typeof vi.fn>;
		notifyError: ReturnType<typeof vi.fn>;
		startOperation: ReturnType<typeof vi.fn>;
	};
	let settings: SynapseSettings;
	let scanOp: ReturnType<typeof makeOp>;
	let genOp: ReturnType<typeof makeOp>;
	let sourceFile: TFile;

	beforeEach(() => {
		app = createMockApp();
		sourceFile = new TFile('inbox/note.md');
		app.vault.getMarkdownFiles.mockReturnValue([sourceFile]);
		// Source note resolves; every other path (new folder, move destination)
		// is absent, so the new-directory proposal path runs and the move is free.
		app.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === 'inbox/note.md' ? sourceFile : null
		);
		(app.vault as unknown as { rename: ReturnType<typeof vi.fn> }).rename = vi
			.fn()
			.mockResolvedValue(undefined);
		plugin = { app } as unknown as Plugin;
		settings = structuredClone(DEFAULT_SETTINGS);

		// Distinct ops per phase so we can assert on the generation toast only.
		scanOp = makeOp();
		genOp = makeOp();
		notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			startOperation: vi.fn((_label: string, id?: string) =>
				id === 'organize-generate' ? genOp : scanOp
			),
		};

		vi.spyOn(OrganizeStore.prototype, 'init').mockResolvedValue(undefined);
		vi.spyOn(OrganizeStore.prototype, 'saveProposal').mockResolvedValue(undefined);
		vi.spyOn(OrganizeStore.prototype, 'saveSnapshot').mockResolvedValue(undefined);
		vi.spyOn(OrganizeStore.prototype, 'updateProposalStatus').mockResolvedValue(undefined);
		vi.spyOn(OrganizeStore.prototype, 'loadPendingProposals').mockResolvedValue([]);
		// acceptProposal (the auto-accept path) re-loads the proposal; return a
		// still-pending one so the accept (note move) succeeds.
		vi.spyOn(OrganizeStore.prototype, 'loadProposal').mockImplementation(
			async (id: string) =>
				({
					id,
					sourceNotePath: 'inbox/note.md',
					proposedDirectory: 'Machine Learning',
					reasoning: 'Note is about machine learning',
					createdAt: '2026-06-11T00:00:00.000Z',
					status: 'pending',
				}) as OrganizeProposal
		);
	});

	afterEach(() => vi.restoreAllMocks());

	function build(shouldAutoAccept: () => boolean): OrganizeModule {
		const registrar = { register: vi.fn() };
		return new OrganizeModule(
			plugin,
			() => settings,
			notifications as never,
			createMockCheckpointManager() as never,
			registrar as never,
			shouldAutoAccept
		);
	}

	it('forwards a Review action to the directory-scan completion toast when proposals remain', async () => {
		settings.autoAccept.organize = false;
		const mod = build(() => settings.autoAccept.organize);
		await mod.onload();
		const openSpy = vi.fn();
		mod.onOpenProposalView = openSpy;

		await mod.scanDirectory(undefined, true); // skipConfirmation

		expect(genOp.finish).toHaveBeenCalledWith(
			expect.stringContaining('proposal'),
			expect.objectContaining({ label: 'Review' })
		);
		// The action opens the unified proposal view.
		genOp.finish.mock.calls.at(-1)![1].onClick();
		expect(openSpy).toHaveBeenCalledTimes(1);
	});

	it('omits the Review action when everything was auto-accepted (nothing left to review)', async () => {
		settings.autoAccept.organize = true;
		const mod = build(() => settings.autoAccept.organize);
		await mod.onload();

		await mod.scanDirectory(undefined, true);

		// generated > 0 but auto-accept is on, so the gate yields no action.
		expect(genOp.finish).toHaveBeenCalledWith(
			expect.stringContaining('proposal'),
			undefined
		);
		// And the note was actually moved by auto-accept.
		expect((app.vault as unknown as { rename: ReturnType<typeof vi.fn> }).rename).toHaveBeenCalledTimes(1);
	});

	it('forwards a Review action to the single-note organize toast when the proposal stays pending', async () => {
		settings.autoAccept.organize = false;
		const mod = build(() => settings.autoAccept.organize);
		await mod.onload();
		const openSpy = vi.fn();
		mod.onOpenProposalView = openSpy;

		await mod.organizeNote(sourceFile as never);

		// organizeNote uses the per-file op (id `organize-<path>`), routed to scanOp.
		expect(scanOp.finish).toHaveBeenCalledWith(
			'Proposal created for new directory',
			expect.objectContaining({ label: 'Review' })
		);
		scanOp.finish.mock.calls.at(-1)![1].onClick();
		expect(openSpy).toHaveBeenCalledTimes(1);
		// Nothing moved — the proposal is left pending for review.
		expect((app.vault as unknown as { rename: ReturnType<typeof vi.fn> }).rename).not.toHaveBeenCalled();
	});

	it('omits the Review action on the single-note organize toast when auto-accept moved the note', async () => {
		settings.autoAccept.organize = true;
		const mod = build(() => settings.autoAccept.organize);
		await mod.onload();

		await mod.organizeNote(sourceFile as never);

		expect(scanOp.finish).toHaveBeenCalledWith(
			'Proposal created for new directory',
			undefined
		);
		// The note was moved by auto-accept.
		expect((app.vault as unknown as { rename: ReturnType<typeof vi.fn> }).rename).toHaveBeenCalledTimes(1);
	});
});
