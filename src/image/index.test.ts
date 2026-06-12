import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ImageModule } from './index';
import { ImageExtractor } from './extractor';
import { ImageEmbed } from './types';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';

// Mock TFile vs the real obsidian TFile type differ structurally; tests only
// need the runtime instance, so widen to `any` at the boundary.
const mockFile = (path: string): any => rawFile(path);

function makeSettings(): SynapseSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

/** A stub OperationHandle. `cancelled` is mutable so cancellation can be simulated. */
function makeOp(cancelled = false) {
	return {
		progress: vi.fn(),
		finish: vi.fn(),
		error: vi.fn(),
		cancelled,
	};
}

describe('ImageModule', () => {
	let app: ReturnType<typeof createMockApp>;
	let plugin: Plugin;
	let notifications: any;
	let checkpointManager: ReturnType<typeof createMockCheckpointManager>;
	let op: ReturnType<typeof makeOp>;
	let extractSpy: ReturnType<typeof vi.spyOn>;
	let module: ImageModule;

	beforeEach(() => {
		app = createMockApp();
		(app.workspace as any).getActiveFile = vi.fn().mockReturnValue(null);
		plugin = { app } as unknown as Plugin;
		op = makeOp();
		notifications = {
			info: vi.fn(),
			notifyError: vi.fn(),
			startOperation: vi.fn().mockReturnValue(op),
		};
		checkpointManager = createMockCheckpointManager();
		extractSpy = vi.spyOn(ImageExtractor.prototype, 'extract').mockResolvedValue({
			text: 'extracted text',
			fileName: 'img.png',
		} as any);
		module = new ImageModule(plugin, () => makeSettings(), notifications, checkpointManager as any);
	});

	afterEach(() => vi.restoreAllMocks());

	describe('extractFromFile', () => {
		it('shows an info notice and does nothing when no note is active', async () => {
			(app.workspace as any).getActiveFile.mockReturnValue(null);

			await module.extractFromFile(mockFile('images/img.png'));

			expect(notifications.info).toHaveBeenCalledWith(
				expect.stringContaining('Open a note first')
			);
			expect(app.vault.process).not.toHaveBeenCalled();
		});

		it('extracts OCR text and appends an OCR callout to the active note', async () => {
			const active = mockFile('notes/Active.md');
			(app.workspace as any).getActiveFile.mockReturnValue(active);
			app.vault.read.mockResolvedValue('existing body');
			const onComplete = vi.fn();
			module.onExtractionComplete = onComplete;

			await module.extractFromFile(mockFile('images/img.png'));

			expect(app.vault.readBinary).toHaveBeenCalled();
			expect(extractSpy).toHaveBeenCalled();
			const written = (await app.vault.process.mock.results[0].value) as unknown as string;
			expect(written).toContain('existing body');
			expect(written).toContain('[!synapse-ocr]');
			expect(written).toContain('extracted text');
			expect(onComplete).toHaveBeenCalledWith('notes/Active.md');
			expect(op.finish).toHaveBeenCalled();
		});

		it('reports an error notice when extraction throws', async () => {
			const active = mockFile('notes/Active.md');
			(app.workspace as any).getActiveFile.mockReturnValue(active);
			app.vault.read.mockResolvedValue('body');
			extractSpy.mockRejectedValue(new Error('vision API down'));

			await module.extractFromFile(mockFile('images/img.png'));

			expect(op.error).toHaveBeenCalledWith(expect.stringContaining('vision API down'));
		});
	});

	describe('extractAndInsert', () => {
		const embed = (fileName: string, line: number): ImageEmbed => ({
			fileName,
			file: mockFile(`images/${fileName}`),
			line,
		});

		it('creates a checkpoint, inserts OCR blocks, and completes the checkpoint', async () => {
			const note = mockFile('notes/Doc.md');
			app.vault.read.mockResolvedValue('line0\nline1\nline2');
			const onComplete = vi.fn();
			module.onExtractionComplete = onComplete;

			await module.extractAndInsert(note, [embed('a.png', 0)]);

			expect(checkpointManager.create).toHaveBeenCalledWith(
				expect.objectContaining({ module: 'image' })
			);
			expect(checkpointManager.addDeferredTask).toHaveBeenCalled();
			expect(checkpointManager.completeItem).toHaveBeenCalled();
			const written = (await app.vault.process.mock.results[0].value) as unknown as string;
			expect(written).toContain('[!synapse-ocr]');
			expect(written).toContain('extracted text');
			expect(checkpointManager.complete).toHaveBeenCalledWith('mockcheckpoint');
			expect(onComplete).toHaveBeenCalledWith('notes/Doc.md');
			expect(op.finish).toHaveBeenCalled();
		});

		it('continues the batch and reports per-image errors without aborting', async () => {
			const note = mockFile('notes/Doc.md');
			app.vault.read.mockResolvedValue('a\nb');
			extractSpy.mockRejectedValueOnce(new Error('one failed'));

			await module.extractAndInsert(note, [embed('bad.png', 0)]);

			expect(notifications.notifyError).toHaveBeenCalledWith(
				expect.stringContaining('bad.png'),
				expect.any(Error)
			);
			// Nothing completed → no write, checkpoint still completed (not cancelled)
			expect(app.vault.process).not.toHaveBeenCalled();
			expect(checkpointManager.complete).toHaveBeenCalled();
		});

		it('discards the checkpoint when the operation is cancelled before any work', async () => {
			op = makeOp(true);
			notifications.startOperation.mockReturnValue(op);
			const note = mockFile('notes/Doc.md');

			await module.extractAndInsert(note, [embed('a.png', 0)]);

			expect(checkpointManager.discard).toHaveBeenCalledWith('mockcheckpoint');
			expect(checkpointManager.complete).not.toHaveBeenCalled();
		});
	});

	describe('resumeFromCheckpoint', () => {
		it('informs the user and discards the checkpoint', async () => {
			const checkpoint = { id: 'cp-1', remainingItems: [{ id: 'x' }, { id: 'y' }] } as any;

			await module.resumeFromCheckpoint(checkpoint);

			expect(notifications.info).toHaveBeenCalledWith(expect.stringContaining('2 remaining'));
			expect(checkpointManager.discard).toHaveBeenCalledWith('cp-1');
		});
	});

	it('onload and onunload are no-ops that do not throw', async () => {
		await expect(module.onload()).resolves.toBeUndefined();
		expect(() => module.onunload()).not.toThrow();
	});
});
