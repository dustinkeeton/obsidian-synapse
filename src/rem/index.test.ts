import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RemModule } from './index';
import { RemStore } from './rem-store';
import { MentionScanner } from './mention-scanner';
import { SemanticMatcher } from './semantic-matcher';
import { RemProposal, RemLinkCandidate } from './types';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';

// Mock TFile vs the real obsidian TFile type differ structurally; tests only
// need the runtime instance, so widen to `any` at the boundary.
const mockFile = (path: string): any => rawFile(path);

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	mutate?.(s);
	return s;
}

function makeOp(cancelled = false) {
	return { progress: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled };
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
	let notifications: any;
	let checkpointManager: ReturnType<typeof createMockCheckpointManager>;
	let registrar: any;
	let settings: SynapseSettings;

	// Collaborator spies
	let initSpy: ReturnType<typeof vi.spyOn>;
	let saveSpy: ReturnType<typeof vi.spyOn>;
	let loadSpy: ReturnType<typeof vi.spyOn>;
	let updateStatusSpy: ReturnType<typeof vi.spyOn>;
	let scanSpy: ReturnType<typeof vi.spyOn>;
	let matchSpy: ReturnType<typeof vi.spyOn>;
	let loadPendingSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		app = createMockApp();
		(app.metadataCache as any).getFileCache = vi.fn().mockReturnValue(null);
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
			notifications,
			checkpointManager as any,
			registrar,
			shouldAutoAccept
		);
		await module.onload();
		return module;
	}

	describe('onload', () => {
		it('initializes the store and registers both REM commands', async () => {
			await loadedModule();
			expect(initSpy).toHaveBeenCalled();
			const ids = registrar.register.mock.calls.map((c: any[]) => c[0]);
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
			expect(notifications.success).toHaveBeenCalledWith(expect.stringContaining('2 linkable mentions'));
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
			settings.rem.semanticMatching = true;
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

	describe('getPendingProposals', () => {
		it('delegates to the store', async () => {
			const pending = [{ id: 'p1' }] as any;
			loadPendingSpy.mockResolvedValue(pending);
			const module = await loadedModule();

			expect(await module.getPendingProposals()).toBe(pending);
		});
	});

	describe('isExcluded via exclude tags', () => {
		it('excludes a note carrying an excluded frontmatter tag', async () => {
			settings.enrichment.excludeTags = ['#private'];
			app.vault.getAbstractFileByPath.mockReturnValue(mockFile('notes/Secret.md'));
			(app.metadataCache as any).getFileCache.mockReturnValue({
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
