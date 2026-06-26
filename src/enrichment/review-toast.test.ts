import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EnrichmentModule } from './index';
import { EnrichmentStore } from './enrichment-store';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockApp, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';
import type { EnrichmentProposal } from './types';

function makeOp(cancelled = false) {
	return { progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled };
}

/** A pending proposal with an empty-but-valid result, for the auto-accept path. */
function pendingProposal(id: string): EnrichmentProposal {
	return {
		id,
		sourceNotePath: 'inbox/note.md',
		createdAt: '2026-06-26T00:00:00.000Z',
		triggerSource: 'manual',
		result: { tags: [], internalLinks: [], externalLinks: [], frontmatter: [] },
		status: 'pending',
	};
}

describe('EnrichmentModule Review toast action (#366)', () => {
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
		sourceFile = new TFile('inbox/note.md');
		app.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === 'inbox/note.md' ? sourceFile : null
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

		// enrichFile (heavy classifier pipeline) is stubbed to yield one proposal id.
		vi.spyOn(
			EnrichmentModule.prototype as unknown as { enrichFile: () => Promise<string | null> },
			'enrichFile'
		).mockResolvedValue('enrich-1');
		// Auto-accept re-loads the proposal then applies it; isolate the apply.
		vi.spyOn(EnrichmentStore.prototype, 'load').mockResolvedValue(pendingProposal('enrich-1'));
		vi.spyOn(EnrichmentModule.prototype, 'acceptSelectedFromView').mockResolvedValue(undefined);
	});

	afterEach(() => vi.restoreAllMocks());

	function build(shouldAutoAccept: () => boolean): EnrichmentModule {
		const registrar = { register: vi.fn() };
		return new EnrichmentModule(
			plugin,
			() => settings,
			notifications as never,
			createMockCheckpointManager() as never,
			registrar as never,
			shouldAutoAccept
		);
	}

	it('forwards a Review action to the enrich toast when auto-accept is off (manual command)', async () => {
		settings.autoAccept.enrichment = false;
		const mod = build(() => settings.autoAccept.enrichment);
		const openSpy = vi.fn();
		mod.onOpenProposalView = openSpy;

		await mod.enrich('inbox/note.md', 'manual');

		expect(op.finish).toHaveBeenCalledWith(
			'Enrichment proposal created',
			expect.objectContaining({ label: 'Review' })
		);
		op.finish.mock.calls.at(-1)![1].onClick();
		expect(openSpy).toHaveBeenCalledTimes(1);
	});

	it('omits the Review action when auto-accept is on', async () => {
		settings.autoAccept.enrichment = true;
		const mod = build(() => settings.autoAccept.enrichment);

		await mod.enrich('inbox/note.md', 'manual');

		expect(op.finish).toHaveBeenCalledWith('Enrichment proposal created', undefined);
	});

	it('suppresses the secondary Review toast for an automatic post-op enrich (#366)', async () => {
		// Auto-accept OFF, so a manual enrich WOULD surface Review — but a chained
		// post-op run (auto-enrich after a primary action) must not.
		settings.autoAccept.enrichment = false;
		const mod = build(() => settings.autoAccept.enrichment);
		const openSpy = vi.fn();
		mod.onOpenProposalView = openSpy;

		await mod.enrich('inbox/note.md', 'elaboration', { postOp: true });

		expect(op.finish).toHaveBeenCalledWith('Enrichment proposal created', undefined);
	});
});
