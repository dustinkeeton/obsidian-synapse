import { Plugin, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import {
	NotificationManager, buildCallout, CALLOUT_TYPES, sanitizeAIResponse,
	CheckpointManager, generateId,
} from '../shared';
import type { Checkpoint, CheckpointWorkItem, DeferredTask } from '../shared';
import { ImageEmbed } from './types';
import { ImageExtractor } from './extractor';

export { findImageEmbeds, IMAGE_EXTENSIONS, IMAGE_EMBED_REGEX } from './note-scanner';
export { arrayBufferToBase64, preprocessImage } from './preprocess';
export type { ImageEmbed, OCRResult } from './types';

export class ImageModule {
	private extractor: ImageExtractor;

	/** Optional callback invoked after OCR extraction completes. Wired by main.ts for enrichment. */
	onExtractionComplete: ((filePath: string) => void) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
		private checkpointManager: CheckpointManager
	) {
		this.extractor = new ImageExtractor(getSettings);
	}

	async onload(): Promise<void> {}
	onunload(): void {}

	async extractFromFile(file: TFile): Promise<void> {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) {
			this.notifications.info('Open a note first to insert the OCR result');
			return;
		}

		const op = this.notifications.startOperation(
			`Extracting text from ${file.name}...`,
			`image-${file.path}`
		);
		try {
			const data = await this.plugin.app.vault.readBinary(file);
			const result = await this.extractor.extract(data, file.name);
			const text = sanitizeAIResponse(result.text);

			const ocrBlock = buildCallout(
				CALLOUT_TYPES.ocr,
				`OCR of ${file.name}`,
				text,
				true
			);

			await this.plugin.app.vault.process(activeFile, (data) => data + ocrBlock);
			this.onExtractionComplete?.(activeFile.path);
			op.finish(`OCR of ${file.name} added to note`);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`OCR extraction failed -- ${msg}`);
		}
	}

	/**
	 * Resume image OCR from a checkpoint (C1).
	 */
	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		this.notifications.info(
			`Image OCR checkpoint has ${checkpoint.remainingItems.length} remaining items. ` +
			`Completed items are already saved. Please re-run OCR on the source note to continue.`
		);
		await this.checkpointManager.discard(checkpoint.id);
	}

	async extractAndInsert(
		noteFile: TFile,
		embeds: ImageEmbed[]
	): Promise<void> {
		const total = embeds.length;
		let completed = 0;

		const op = this.notifications.startOperation(
			`Extracting text from ${total} image(s)...`,
			`image-batch-${noteFile.path}`
		);

		// Create checkpoint for batch OCR
		const checkpointItems: CheckpointWorkItem[] = embeds.map((e, i) => ({
			id: `image-${i}-${e.fileName}`,
			label: e.fileName,
			payload: { fileName: e.fileName, line: e.line } as Record<string, unknown>,
		}));
		const checkpoint = await this.checkpointManager.create({
			module: 'image',
			operationLabel: `Image OCR: ${noteFile.basename} (${total} files)`,
			items: checkpointItems,
		});

		// Register deferred task for sidebar refresh (I1)
		await this.checkpointManager.addDeferredTask(checkpoint.id, {
			id: generateId(),
			type: 'refresh-sidebar-view',
			data: {},
		});

		// Process in reverse line order so insertions don't shift line numbers
		const sorted = [...embeds].sort((a, b) => b.line - a.line);

		// Queue insertions (keyed by original line) and apply them atomically
		// against fresh content after all OCR completes.
		const inserts: Array<{ line: number; block: string }> = [];

		for (let i = 0; i < sorted.length; i++) {
			if (op.cancelled) break;
			const embed = sorted[i];
			// Delay between requests to avoid API rate limits
			if (i > 0) {
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
			try {
				op.progress(completed + 1, total, 'Extracting text from image');
				const data = await this.plugin.app.vault.readBinary(embed.file);
				const result = await this.extractor.extract(data, embed.fileName);
				const text = sanitizeAIResponse(result.text);

				const ocrBlock = buildCallout(
					CALLOUT_TYPES.ocr,
					`OCR of ${embed.fileName}`,
					text,
					true
				);

				// Insert after the embed line
				inserts.push({ line: embed.line, block: ocrBlock });

				completed++;

				// Save checkpoint progress
				const cpItemId = checkpointItems.find(
					(ci) => ci.payload.fileName === embed.fileName
				)?.id;
				if (cpItemId) {
					await this.checkpointManager.completeItem(checkpoint.id, cpItemId);
				}
			} catch (error) {
				this.notifications.notifyError(`OCR extraction failed for ${embed.fileName}`, error);
			}
		}

		// Write whatever we completed, even if cancelled partway. Apply all
		// inserts atomically against fresh content; reverse-line ordering means
		// later splices are unaffected by earlier ones.
		if (completed > 0) {
			await this.plugin.app.vault.process(noteFile, (data) => {
				const lines = data.split('\n');
				for (const ins of inserts) {
					lines.splice(ins.line + 1, 0, ins.block);
				}
				return lines.join('\n');
			});
			this.onExtractionComplete?.(noteFile.path);
		}
		if (op.cancelled) {
			// Discard checkpoint on user cancellation (C3)
			await this.checkpointManager.discard(checkpoint.id);
		} else {
			// Mark checkpoint completed and dispatch deferred tasks (I1)
			const tasks = await this.checkpointManager.complete(checkpoint.id);
			this.dispatchDeferredTasks(tasks);
			op.finish(`Done -- ${completed}/${total} OCR extractions added`);
		}
	}

	/** Dispatch deferred tasks (I1). */
	private dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			switch (task.type) {
				case 'refresh-sidebar-view':
					// Image module doesn't have a direct view refresh callback,
					// but the deferred task system ensures it runs via main.ts dispatch
					break;
				default:
					console.warn(`[Synapse] Unknown deferred task type: ${task.type}`);
			}
		}
	}
}

// Settings section renderer (#243)
export { renderImageSettings } from './settings-section';
