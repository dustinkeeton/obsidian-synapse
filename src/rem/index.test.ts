import { describe, it, expect, beforeEach, afterEach, vi, type Mock, type MockInstance } from 'vitest';
import { RemModule } from './index';
import { RemStore } from './rem-store';
import { MentionScanner } from './mention-scanner';
import { SemanticMatcher } from './semantic-matcher';
import { RemProposal, RemLinkCandidate } from './types';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin, TFile } from 'obsidian';
import type { CheckpointManager, NotificationManager, NoticeAction, Checkpoint } from '../shared';
import type { CommandRegistrar } from '../commands';

// The mock TFile (from __test-utils__) and obsidian's real TFile differ
// structurally; tests only need the runtime instance, so cross the boundary
// once here with a typed cast.
const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	mutate?.(s);
	return s;
}

function makeOp(cancelled = false) {
	return {
		progress: vi.fn<(current: number, total: number, label?: string) => void>(),
		finish: vi.fn<(message?: string, action?: NoticeAction) => void>(),
		error: vi.fn<(message: string) => void>(),
		cancelled,
	};
}

/** Spy-backed stand-in for the NotificationManager surface the module calls. */
interface MockNotifications {
	info: Mock<(message: string, duration?: number, action?: NoticeAction) => void>;
	success: Mock<(message: string, duration?: number, action?: NoticeAction) => void>;
	notifyError: Mock<(context: string, error: unknown) => void>;
	startOperation: Mock<(label: string, id?: string) => ReturnType<typeof makeOp>>;
}

/** Spy-backed stand-in for the CommandRegistrar the module registers against. */
interface MockRegistrar {
	register: Mock<(id: string, userEnabled: boolean, spec: unknown) => void>;
}

function candidate(matchedText: string, line = 0): RemLinkCandidate {
	return {
		targetPath: `notes/${matchedText}.md`,
		targetDisplayName: matchedText,
		matchedText,
		matchType: 'title',
		occurrences: [{ lineNumber: line, lineText: matchedText, startOffset: 0, endOffset: matchedText.length }],
		confidence: 1,
	};
}

describe('RemModule', () => {
	let app: ReturnType<typeof createMockApp>;
	let plugin: Plugin;
	let notifications: MockNotifications;
	let checkpointManager: ReturnType<typeof createMockCheckpointManager>;
	let registrar: MockRegistrar;
	let settings: SynapseSettings;

	// Collaborator spies
	let initSpy: MockInstance<typeof RemStore.prototype.init>;
	let saveSpy: MockInstance<typeof RemStore.prototype.save>;
	let loadSpy: MockInstance<typeof RemStore.prototype.load>;
	let updateStatusSpy: MockInstance<typeof RemStore.prototype.updateStatus>;
	let scanSpy: MockInstance<typeof MentionScanner.prototype.scan>;
	let matchSpy: MockInstance<typeof SemanticMatcher.prototype.match>;
	let loadPendingSpy: MockInstance<typeof RemStore.prototype.loadPending>;

	beforeEach(() => {
		app = createMockApp();
		app.metadataCache.getFileCache = vi.fn().mockReturnValue(null);
		plugin = { app } as unknown as Plugin;
		settings = makeSettings();
		notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			startOperation: vi.fn().mockReturnValue(makeOp()),
		};
		checkpointManager = createMockCheckpointManager();
		registrar = { register: vi.fn() };

		initSpy = vi.spyOn(RemStore.prototype, 'init').mockResolvedValue(undefined);
		saveSpy = vi.spyOn(RemStore.prototype, 'save').mockResolvedValue(undefined);
		loadSpy = vi.spyOn(RemStore.prototype, 'load').mockResolvedValue(null);
		updateStatusSpy = vi.spyOn(RemStore.prototype, 'updateStatus').mockResolvedValue(undefined);
		scanSpy = vi.spyOn(MentionScanner.prototype, 'scan').mockReturnValue([]);
		matchSpy = vi.spyOn(SemanticMatcher.prototype, 'match').mockResolvedValue([]);
		loadPendingSpy = vi.spyOn(RemStore.prototype, 'loadPending').mockResolvedValue([]);
	});

	afterEach(() => vi.restoreAllMocks());

	async function loadedModule(shouldAutoAccept?: () => boolean): Promise<RemModule> {
		const module = new RemModule(
			plugin,
			() => settings,
			notifications as unknown as NotificationManager,
			checkpointManager as unknown as CheckpointManager,
			registrar as unknown as CommandRegistrar,
			shouldAutoAccept
		);
		await module.onload();
		return module;
	}

	describe('onload', () => {
		it('initializes the store and registers both REM commands', async () => {
			await loadedModule();
			expect(initSpy).toHaveBeenCalled();
			const ids = registrar.register.mock.calls.map((c) => c[0]);
			expect(ids).toContain('rem-current-note');
			expect(ids).toContain('rem-directory');
		});
	});

	describe('remScanNote', () => {
		it('returns null and notifies when the file does not exist', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(null);
			const module = await loadedModule();

			const result = await module.remScanNote('missing.md');
			expect(result).toBeNull();
			expect(notifications.info).toHaveBeenCalledWith('File not found');
		});

		it('returns null when the note is in an excluded folder', async () => {
			settings.exclusions = [{ pattern: 'Archive/**', features: ['rem'] }];
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('Archive/Old.md'));
			const module = await loadedModule();

			const result = await module.remScanNote('Archive/Old.md');
			expect(result).toBeNull();
			expect(notifications.info).toHaveBeenCalledWith(
				'Skipped — "Archive/Old.md" is excluded by rule "Archive/**"'
			);
		});

		it('saves a proposal built from literal mention candidates', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('mentions Foo and Bar');
			scanSpy.mockReturnValue([candidate('Foo'), candidate('Bar')]);
			const module = await loadedModule();

			const result = await module.remScanNote('notes/A.md');
			expect(result).not.toBeNull();
			expect(result!.candidates).toHaveLength(2);
			expect(result!.status).toBe('pending');
			expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ sourceNotePath: 'notes/A.md' }));
			expect(notifications.success).toHaveBeenCalledWith(
				expect.stringContaining('2 linkable mentions'),
				undefined,
				expect.objectContaining({ label: 'Review' })
			);
		});

		it('returns null when no linkable mentions are found', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('nothing here');
			scanSpy.mockReturnValue([]);
			const module = await loadedModule();

			const result = await module.remScanNote('notes/A.md');
			expect(result).toBeNull();
			expect(notifications.info).toHaveBeenCalledWith('No linkable mentions found');
			expect(saveSpy).not.toHaveBeenCalled();
		});

		it('augments literal candidates with semantic matches above the confidence threshold', async () => {
			settings.rem.confidenceThreshold = 0.5;
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('deep learning content');
			scanSpy.mockReturnValue([]);
			matchSpy.mockResolvedValue([
				{ ...candidate('ML'), matchType: 'semantic', confidence: 0.9 },
				{ ...candidate('Weak'), matchType: 'semantic', confidence: 0.2 },
			]);
			const module = await loadedModule();

			const result = await module.remScanNote('notes/A.md');
			expect(matchSpy).toHaveBeenCalled();
			expect(result!.candidates.map((c) => c.matchedText)).toEqual(['ML']);
		});

		it('re-ranks a down-weighted title match below a stronger semantic match (#380)', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('content discussing machine learning');
			// Literal title hit: scanner emits raw 1.0; gatherCandidates down-weights to 0.6.
			scanSpy.mockReturnValue([candidate('TitleHit')]);
			// Semantic hit is more content-relevant than the weighted title match.
			matchSpy.mockResolvedValue([
				{ ...candidate('Relevant'), matchType: 'semantic', confidence: 0.8 },
			]);
			const module = await loadedModule();

			const result = await module.remScanNote('notes/A.md');

			// 0.8 semantic outranks the 0.6 weighted title -> semantic sorts first.
			expect(result!.candidates.map((c) => c.matchedText)).toEqual(['Relevant', 'TitleHit']);
			const title = result!.candidates.find((c) => c.matchedText === 'TitleHit')!;
			expect(title.confidence).toBeCloseTo(0.6);
		});
	});

	describe('acceptProposal', () => {
		const pendingProposal = (): RemProposal => ({
			id: 'p1',
			sourceNotePath: 'notes/A.md',
			createdAt: '2026-06-11T00:00:00.000Z',
			candidates: [candidate('Foo', 0), candidate('Bar', 1)],
			status: 'pending',
		});

		it('applies accepted links to the note and marks the proposal accepted', async () => {
			loadSpy.mockResolvedValue(pendingProposal());
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('Foo line\nBar line');
			const module = await loadedModule();

			await module.acceptProposal('p1', ['Foo', 'Bar']);

			const written = (await app.vault.process.mock.results[0].value) as unknown as string;
			expect(written).toContain('[[Foo]]');
			expect(written).toContain('[[Bar]]');
			expect(updateStatusSpy).toHaveBeenCalledWith('p1', 'accepted', ['Foo', 'Bar'], 'Foo line\nBar line');
			expect(notifications.success).toHaveBeenCalled();
		});

		it('marks the proposal partially-accepted when only some links are accepted', async () => {
			loadSpy.mockResolvedValue(pendingProposal());
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('Foo line\nBar line');
			const module = await loadedModule();

			await module.acceptProposal('p1', ['Foo']);

			expect(updateStatusSpy).toHaveBeenCalledWith(
				'p1',
				'partially-accepted',
				['Foo'],
				expect.any(String)
			);
		});

		it('rejects the proposal when no candidate matches the accepted texts', async () => {
			loadSpy.mockResolvedValue(pendingProposal());
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			const module = await loadedModule();

			await module.acceptProposal('p1', ['Nonexistent']);

			expect(updateStatusSpy).toHaveBeenCalledWith('p1', 'rejected');
			expect(app.vault.process).not.toHaveBeenCalled();
		});

		it('does nothing for an already-accepted proposal (double-accept guard)', async () => {
			loadSpy.mockResolvedValue({ ...pendingProposal(), status: 'accepted' });
			const module = await loadedModule();

			await module.acceptProposal('p1', ['Foo']);
			expect(app.vault.process).not.toHaveBeenCalled();
			expect(updateStatusSpy).not.toHaveBeenCalled();
		});

		it('returns early when the proposal cannot be loaded', async () => {
			loadSpy.mockResolvedValue(null);
			const module = await loadedModule();

			await module.acceptProposal('missing', ['Foo']);
			expect(app.vault.process).not.toHaveBeenCalled();
		});
	});

	describe('auto-accept', () => {
		it('auto-accepts a freshly scanned proposal when the flag is on', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('Foo here');
			scanSpy.mockReturnValue([candidate('Foo')]);
			// load() is consulted by acceptProposal (invoked via maybeAutoAccept)
			loadSpy.mockImplementation(async () => ({
				id: 'x',
				sourceNotePath: 'notes/A.md',
				createdAt: '2026-06-11T00:00:00.000Z',
				candidates: [candidate('Foo')],
				status: 'pending',
			}));
			const module = await loadedModule(() => true);

			await module.remScanNote('notes/A.md');
			// acceptProposal path writes to the note and updates status
			expect(updateStatusSpy).toHaveBeenCalledWith(
				expect.any(String),
				'accepted',
				['Foo'],
				expect.any(String)
			);
		});
	});

	describe('Review toast action (#340)', () => {
		it('forwards a Review action that opens the proposal view to the success toast', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('mentions Foo');
			scanSpy.mockReturnValue([candidate('Foo')]);
			const module = await loadedModule(); // auto-accept off
			const openSpy = vi.fn();
			module.onOpenProposalView = openSpy;

			await module.remScanNote('notes/A.md');

			expect(notifications.success).toHaveBeenCalledWith(
				expect.stringContaining('linkable mention'),
				undefined,
				expect.objectContaining({ label: 'Review' })
			);
			// The action opens the unified proposal view.
			const action = notifications.success.mock.calls[0][2];
			action!.onClick();
			expect(openSpy).toHaveBeenCalledTimes(1);
		});

		it('forwards a Review action to the directory-scan completion toast', async () => {
			const op = makeOp();
			notifications.startOperation.mockReturnValue(op);
			app.vault.getMarkdownFiles.mockReturnValue([mockFile('notes/A.md')]);
			app.vault.read.mockResolvedValue('Foo content');
			scanSpy.mockReturnValue([candidate('Foo')]);
			const module = await loadedModule(); // auto-accept off
			const openSpy = vi.fn();
			module.onOpenProposalView = openSpy;

			await module.remScanDirectory();

			expect(op.finish).toHaveBeenCalledWith(
				expect.stringContaining('REM scan complete'),
				expect.objectContaining({ label: 'Review' })
			);
			op.finish.mock.calls.at(-1)![1]!.onClick();
			expect(openSpy).toHaveBeenCalledTimes(1);
		});

		it('omits the Review action when auto-accept is on (nothing left to review)', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('mentions Foo');
			scanSpy.mockReturnValue([candidate('Foo')]);
			loadSpy.mockImplementation(async () => ({
				id: 'x',
				sourceNotePath: 'notes/A.md',
				createdAt: '2026-06-11T00:00:00.000Z',
				candidates: [candidate('Foo')],
				status: 'pending',
			}));
			const module = await loadedModule(() => true);

			await module.remScanNote('notes/A.md');

			expect(notifications.success).toHaveBeenCalledWith(
				expect.stringContaining('linkable mention'),
				undefined,
				undefined
			);
		});
	});

	describe('rejectProposal / undoProposal', () => {
		it('rejectProposal sets the status to rejected', async () => {
			const module = await loadedModule();
			await module.rejectProposal('p1');
			expect(updateStatusSpy).toHaveBeenCalledWith('p1', 'rejected');
		});

		it('undoProposal restores the original content snapshot and resets to pending', async () => {
			loadSpy.mockResolvedValue({
				id: 'p1',
				sourceNotePath: 'notes/A.md',
				createdAt: '2026-06-11T00:00:00.000Z',
				candidates: [candidate('Foo')],
				status: 'accepted',
				originalContent: 'pristine content',
			});
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('linked [[Foo]] content');
			const module = await loadedModule();

			await module.undoProposal('p1');

			const written = (await app.vault.process.mock.results[0].value) as unknown as string;
			expect(written).toBe('pristine content');
			expect(updateStatusSpy).toHaveBeenCalledWith('p1', 'pending', undefined, undefined);
			expect(notifications.success).toHaveBeenCalled();
		});

		it('undoProposal bails out when there is no snapshot', async () => {
			loadSpy.mockResolvedValue({
				id: 'p1',
				sourceNotePath: 'notes/A.md',
				createdAt: '2026-06-11T00:00:00.000Z',
				candidates: [],
				status: 'accepted',
			});
			const module = await loadedModule();

			await module.undoProposal('p1');
			expect(notifications.info).toHaveBeenCalledWith(expect.stringContaining('Cannot undo'));
			expect(app.vault.process).not.toHaveBeenCalled();
		});
	});

	describe('remScanDirectory', () => {
		it('notifies and returns 0 when no eligible files are found', async () => {
			app.vault.getMarkdownFiles.mockReturnValue([]);
			const module = await loadedModule();

			const created = await module.remScanDirectory('notes');
			expect(created).toBe(0);
			expect(notifications.info).toHaveBeenCalledWith('No eligible files found');
		});

		it('scans each eligible note, saves proposals, and completes the checkpoint', async () => {
			app.vault.getMarkdownFiles.mockReturnValue([mockFile('notes/A.md'), mockFile('notes/B.md')]);
			app.vault.read.mockResolvedValue('Foo content');
			scanSpy.mockReturnValue([candidate('Foo')]);
			const module = await loadedModule();

			const created = await module.remScanDirectory();
			expect(created).toBe(2);
			expect(saveSpy).toHaveBeenCalledTimes(2);
			expect(checkpointManager.create).toHaveBeenCalledWith(
				expect.objectContaining({ module: 'rem' })
			);
			expect(checkpointManager.complete).toHaveBeenCalled();
		});

		it('discards the checkpoint and reverts when cancelled before any work', async () => {
			app.vault.getMarkdownFiles.mockReturnValue([mockFile('notes/A.md')]);
			notifications.startOperation.mockReturnValue(makeOp(true));
			const module = await loadedModule();

			const created = await module.remScanDirectory();
			expect(created).toBe(0);
			expect(checkpointManager.discard).toHaveBeenCalled();
			expect(checkpointManager.complete).not.toHaveBeenCalled();
		});

		it('narrows the scan to a single note when onlyFile is provided', async () => {
			app.vault.getMarkdownFiles.mockReturnValue([mockFile('notes/A.md'), mockFile('notes/B.md')]);
			app.vault.read.mockResolvedValue('Foo content');
			scanSpy.mockReturnValue([candidate('Foo')]);
			const module = await loadedModule();

			const created = await module.remScanDirectory(undefined, false, mockFile('notes/B.md'));
			expect(created).toBe(1);
			expect(saveSpy).toHaveBeenCalledWith(
				expect.objectContaining({ sourceNotePath: 'notes/B.md' })
			);
		});
	});

	describe('resumeFromCheckpoint', () => {
		const checkpointWith = (filePaths: string[]): Checkpoint => ({
			id: 'cp1',
			module: 'rem',
			operationLabel: 'REM scan',
			status: 'active',
			createdAt: '2026-06-11T00:00:00.000Z',
			updatedAt: '2026-06-11T00:00:00.000Z',
			completedItems: [],
			remainingItems: filePaths.map((path, i) => ({
				id: `item-${i}`,
				label: path,
				payload: { filePath: path },
			})),
			deferredTasks: [],
			metadata: {},
		});

		it('runs semantic matching on resumed scans, not just literal (#380)', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/A.md'));
			app.vault.read.mockResolvedValue('content about deep learning');
			scanSpy.mockReturnValue([]); // no literal matches at all
			matchSpy.mockResolvedValue([
				{ ...candidate('ML'), matchType: 'semantic', confidence: 0.9 },
			]);
			const module = await loadedModule();

			await module.resumeFromCheckpoint(checkpointWith(['notes/A.md']));

			// Resume previously scanned literally only -> a semantic-only note produced
			// no proposal. Now the semantic candidate is gathered and saved.
			expect(matchSpy).toHaveBeenCalled();
			expect(saveSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceNotePath: 'notes/A.md',
					candidates: [expect.objectContaining({ matchedText: 'ML', matchType: 'semantic' })],
				})
			);
		});
	});

	describe('getPendingProposals', () => {
		it('delegates to the store', async () => {
			const pending = [{ id: 'p1' }] as unknown as RemProposal[];
			loadPendingSpy.mockResolvedValue(pending);
			const module = await loadedModule();

			expect(await module.getPendingProposals()).toBe(pending);
		});
	});

	describe('isExcluded via exclude tags', () => {
		it('excludes a note carrying an excluded frontmatter tag', async () => {
			settings.enrichment.excludeTags = ['#private'];
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/Secret.md'));
			app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: ['private'] },
			});
			const module = await loadedModule();

			const result = await module.remScanNote('notes/Secret.md');
			expect(result).toBeNull();
			expect(notifications.info).toHaveBeenCalledWith(
				'Note is excluded from REM scanning (excluded tag)'
			);
		});
	});
});
