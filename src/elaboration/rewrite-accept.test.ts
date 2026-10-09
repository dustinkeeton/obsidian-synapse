import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TFile } from 'obsidian';
import { ElaborationModule } from './index';
import { ProposalStore } from './proposal-store';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager, NoteOperationQueue } from '../shared';
import { mockFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Proposal } from './types';

const REWRITE = '# Topic\n\nA fuller treatment of the topic, keeping the original sentence.';

const completeMock = vi
	.fn<(...args: unknown[]) => Promise<string>>()
	.mockResolvedValue(REWRITE);
vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		constructor(_getSettings: unknown) {}
		complete(...args: unknown[]) {
			return completeMock(...args);
		}
	},
}));

const { confirmResult } = vi.hoisted(() => ({ confirmResult: vi.fn<() => Promise<boolean>>() }));
vi.mock('../shared/confirm-modal', () => ({
	ConfirmModal: vi.fn(function (this: { openAndConfirm: () => Promise<boolean> }) {
		this.openAndConfirm = confirmResult;
	}),
}));

import { ConfirmModal } from '../shared/confirm-modal';
const confirmModalCtor = vi.mocked(ConfirmModal);

const NOTE_PATH = 'notes/topic.md';

/** Mutable note + in-memory proposal store; `cachedRead` can lag `read` to model a stale metadata cache. */
function createHarness(initial: string) {
	const noteFile = mockFile(NOTE_PATH);
	let content = initial;
	let cached: string | null = null;
	const dataFiles = new Map<string, string>();

	const adapter = {
		read: vi.fn(async (path: string) => {
			const value = dataFiles.get(path);
			if (value === undefined) throw new Error(`ENOENT: ${path}`);
			return value;
		}),
		write: vi.fn(async (path: string, data: string) => { dataFiles.set(path, data); }),
		exists: vi.fn(async (path: string) => {
			if (dataFiles.has(path)) return true;
			for (const key of dataFiles.keys()) if (key.startsWith(path + '/')) return true;
			return false;
		}),
		remove: vi.fn(async (path: string) => { dataFiles.delete(path); }),
		list: vi.fn(async (folder: string) => ({
			files: [...dataFiles.keys()].filter(f => f.startsWith(folder + '/')),
			folders: [],
		})),
		mkdir: vi.fn(async () => undefined),
	};

	const vault = {
		read: vi.fn(async () => content),
		cachedRead: vi.fn(async () => cached ?? content),
		process: vi.fn(async (_file: TFile, fn: (data: string) => string) => {
			content = fn(content);
			return content;
		}),
		modify: vi.fn(async () => undefined),
		create: vi.fn(),
		createFolder: vi.fn(async () => undefined),
		getAbstractFileByPath: vi.fn((path: string) => (path === NOTE_PATH ? noteFile : null)),
		getMarkdownFiles: vi.fn(() => [noteFile]),
		readBinary: vi.fn(async () => new ArrayBuffer(8)),
		adapter,
	};

	const plugin = {
		app: {
			vault,
			metadataCache: {
				getFileCache: vi.fn(() => null),
				getCache: vi.fn(() => null),
				getFirstLinkpathDest: vi.fn(() => null),
			},
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				getRightLeaf: vi.fn(() => null),
				revealLeaf: vi.fn(),
				getActiveFile: vi.fn(() => noteFile),
			},
		},
		addCommand: vi.fn(),
		registerEvent: vi.fn(),
		loadData: vi.fn(async () => null),
		saveData: vi.fn(async () => undefined),
	};

	return {
		noteFile,
		plugin,
		vault,
		content: () => content,
		setContent: (next: string) => { content = next; },
		setCached: (snapshot: string | null) => { cached = snapshot; },
	};
}

function legacyProposal(overrides: Partial<Proposal> = {}): Proposal {
	return {
		id: 'legacy-0001',
		sourceNotePath: NOTE_PATH,
		createdAt: '2026-01-01T00:00:00.000Z',
		detectionReasons: [{ type: 'user-requested' }],
		originalContent: 'Stub.',
		proposedAdditions: 'Legacy additions.',
		insertionPoint: 'append',
		status: 'pending',
		...overrides,
	};
}

describe('ElaborationModule accept rewrites the note body (#552)', () => {
	let harness: ReturnType<typeof createHarness>;
	let settings: SynapseSettings;
	let notifications: NotificationManager;

	function build(initial: string): ElaborationModule {
		harness = createHarness(initial);
		return new ElaborationModule(
			makeModuleDeps({
				plugin: harness.plugin as never,
				getSettings: () => settings,
				notifications,
				checkpointManager: createMockCheckpointManager() as never,
				registrar: new CommandRegistrar(harness.plugin),
				noteQueue: new NoteOperationQueue(),
			}),
			() => settings.autoAccept.elaboration
		);
	}

	async function generatePending(mod: ElaborationModule): Promise<Proposal> {
		await mod.scanNote(harness.noteFile as never);
		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(1);
		return pending[0];
	}

	beforeEach(() => {
		completeMock.mockClear();
		completeMock.mockResolvedValue(REWRITE);
		confirmResult.mockReset();
		confirmModalCtor.mockClear();
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.autoAccept.elaboration = false;
		notifications = new NotificationManager();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('body rewrite', () => {
		it('replaces the body and keeps the frontmatter block byte-for-byte', async () => {
			const frontmatter = '---\ntitle:   "Odd   spacing"\ntags: [b, a]\nz_last: 1\n---\n';
			const mod = build(frontmatter + '\nStub.\n');
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id);

			expect(harness.content()).toBe(frontmatter + REWRITE + '\n');
		});

		it('adds no frontmatter block to a note that had none', async () => {
			const mod = build('Stub.\n');
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id);

			expect(harness.content()).toBe(REWRITE + '\n');
			expect(harness.content().startsWith('---')).toBe(false);
		});

		it('writes no callout and no HTML-comment marker', async () => {
			const mod = build('Stub.\n');
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id);

			expect(harness.content()).not.toContain('[!synapse-elaboration]');
			expect(harness.content()).not.toContain('<!-- synapse');
			expect(harness.content()).not.toContain('Stub.');
		});

		it('ends the file with exactly one trailing newline', async () => {
			completeMock.mockResolvedValue(REWRITE + '\n\n\n');
			const mod = build('Stub.');
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id);

			expect(harness.content()).toBe(REWRITE + '\n');
		});

		it('drops a frontmatter block the model echoed, keeping the note\'s own', async () => {
			const frontmatter = '---\ntitle: Real\n---\n';
			const mod = build(frontmatter + 'Stub.');
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id, '---\ntitle: Invented\n---\n' + REWRITE);

			expect(harness.content()).toBe(frontmatter + REWRITE + '\n');
		});

		it('uses edited content from the review panel over the stored rewrite', async () => {
			const mod = build('Stub.');
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id, 'Edited rewrite.');

			expect(harness.content()).toBe('Edited rewrite.\n');
		});

		it('marks the proposal accepted and fires the whole-note post-op hook', async () => {
			const mod = build('Stub. https://example.com/source');
			const hook = vi.fn();
			mod.onProposalAccepted = hook;
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id);

			expect(await mod.getPendingProposals()).toHaveLength(0);
			expect(hook).toHaveBeenCalledWith(NOTE_PATH, {
				sourceUrls: ['https://example.com/source'],
				producedRegion: { kind: 'whole-note' },
			});
		});

		it('is a no-op on a second accept of the same proposal', async () => {
			const mod = build('Stub.');
			const proposal = await generatePending(mod);
			await mod.acceptProposal(proposal.id);
			harness.setContent('User edited after accept.');

			await mod.acceptProposal(proposal.id);

			expect(harness.content()).toBe('User edited after accept.');
			expect(confirmModalCtor).not.toHaveBeenCalled();
		});
	});

	describe('stale-body guard', () => {
		it('does not open the modal when the note is unchanged', async () => {
			const mod = build('Stub.');
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id);

			expect(confirmModalCtor).not.toHaveBeenCalled();
		});

		it('rewrites a changed note only after an explicit confirm', async () => {
			confirmResult.mockResolvedValue(true);
			const mod = build('Stub.');
			const proposal = await generatePending(mod);
			harness.setContent('Stub. Plus an edit made after the proposal.');

			await mod.acceptProposal(proposal.id);

			expect(confirmModalCtor).toHaveBeenCalledTimes(1);
			expect(confirmModalCtor.mock.calls[0][1]).toMatchObject({ confirmLabel: 'Replace' });
			expect(harness.content()).toBe(REWRITE + '\n');
			expect(await mod.getPendingProposals()).toHaveLength(0);
		});

		it('leaves a changed note and the proposal untouched when the modal is cancelled', async () => {
			confirmResult.mockResolvedValue(false);
			const mod = build('Stub.');
			const proposal = await generatePending(mod);
			const edited = 'Stub. Plus an edit made after the proposal.';
			harness.setContent(edited);

			await mod.acceptProposal(proposal.id);

			expect(confirmModalCtor).toHaveBeenCalledTimes(1);
			expect(harness.content()).toBe(edited);
			expect(harness.vault.process).not.toHaveBeenCalled();
			const pending = await mod.getPendingProposals();
			expect(pending).toHaveLength(1);
			expect(pending[0].id).toBe(proposal.id);
		});

		it('skips a changed note on a silent accept without opening the modal', async () => {
			const mod = build('Stub.');
			const proposal = await generatePending(mod);
			const edited = 'Stub. Plus an edit made after the proposal.';
			harness.setContent(edited);

			await mod.acceptProposal(proposal.id, undefined, { silent: true });

			expect(confirmModalCtor).not.toHaveBeenCalled();
			expect(harness.content()).toBe(edited);
			expect((await mod.getPendingProposals())[0]?.status).toBe('pending');
		});

		it('batch auto-accept skips a stale note and does not count it as accepted', async () => {
			settings.autoAccept.elaboration = true;
			const mod = build('Stub.');
			harness.setCached('Stale cached snapshot.');
			const info = vi.spyOn(notifications, 'info');

			const generated = await mod.scanVault(undefined, true);

			expect(generated).toBe(1);
			expect(confirmModalCtor).not.toHaveBeenCalled();
			expect(harness.content()).toBe('Stub.');
			expect(await mod.getPendingProposals()).toHaveLength(1);
			expect(info.mock.calls.map(c => c[0]).some(m => m.startsWith('Auto-accepted'))).toBe(false);
		});

		it('batch auto-accept rewrites a fresh note and reports it', async () => {
			settings.autoAccept.elaboration = true;
			const mod = build('Stub.');
			const info = vi.spyOn(notifications, 'info');

			await mod.scanVault(undefined, true);

			expect(harness.content()).toBe(REWRITE + '\n');
			expect(await mod.getPendingProposals()).toHaveLength(0);
			expect(info).toHaveBeenCalledWith('Auto-accepted 1 elaboration proposal');
		});
	});

	describe('idempotency after a rewrite', () => {
		it('re-scanning the rewritten note computes a new key and proposes again', async () => {
			const mod = build('Stub.');
			const first = await generatePending(mod);
			await mod.acceptProposal(first.id);
			expect(completeMock).toHaveBeenCalledTimes(1);

			await mod.scanNote(harness.noteFile as never);

			expect(completeMock).toHaveBeenCalledTimes(2);
			const pending = await mod.getPendingProposals();
			expect(pending).toHaveLength(1);
			expect(pending[0].id).not.toBe(first.id);
			expect(pending[0].originalContent).toBe(REWRITE + '\n');
		});

		it('re-scanning an unchanged note with an accepted proposal still skips', async () => {
			const mod = build('Stub.');
			const first = await generatePending(mod);
			await mod.acceptProposal(first.id);
			harness.setContent('Stub.');

			await mod.scanNote(harness.noteFile as never);

			expect(completeMock).toHaveBeenCalledTimes(1);
			expect(await mod.getPendingProposals()).toHaveLength(0);
		});
	});

	describe('legacy proposal files', () => {
		it('still loads a proposal persisted with insertionPoint append and rewrites on accept', async () => {
			const mod = build('Stub.');
			const store = new ProposalStore(harness.plugin.app as never, () => settings);
			await store.save(legacyProposal());

			const pending = await mod.getPendingProposals();
			expect(pending).toHaveLength(1);
			expect(pending[0].insertionPoint).toBe('append');

			await mod.acceptProposal('legacy-0001');

			expect(harness.content()).toBe('Legacy additions.\n');
			expect(harness.content()).not.toContain('[!synapse-elaboration]');
		});

		it('new proposals are stored with insertionPoint replace', async () => {
			const mod = build('Stub.');
			const proposal = await generatePending(mod);

			expect(proposal.insertionPoint).toBe('replace');
		});
	});

	describe('unresolved links (#581)', () => {
		function resolveOnly(...names: string[]) {
			harness.plugin.app.metadataCache.getFirstLinkpathDest.mockImplementation(
				((lp: string) => (names.includes(lp) ? {} : null)) as never
			);
		}

		it('unlinks model-written links to missing notes but keeps the note\'s own links', async () => {
			completeMock.mockResolvedValue('See [[Real]], [[Ghost|a ghost]] and [[Someday]].');
			const mod = build('Stub about [[Someday]].\n');
			resolveOnly('Real');
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id);

			expect(harness.content()).toBe('See [[Real]], a ghost and [[Someday]].\n');
		});

		it('keeps links the user typed into the review edit', async () => {
			completeMock.mockResolvedValue('See [[Ghost]].');
			const mod = build('Stub.\n');
			resolveOnly();
			const proposal = await generatePending(mod);

			await mod.acceptProposal(proposal.id, 'See [[Ghost]] and [[My Plan]].');

			expect(harness.content()).toBe('See Ghost and [[My Plan]].\n');
		});
	});
});
