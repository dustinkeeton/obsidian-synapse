import { Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { FolderPickerModal, getMarkdownFiles, NotificationManager } from '../shared';
import { OperationHandle } from '../shared';
import { isSupportedUrl } from '../video/url-detector';
import { fetchPageContent } from './content-fetcher';
import { findSummarizeTargets } from './note-scanner';
import { SummarizeSelectionModal } from './summarize-modal';
import { Summarizer } from './summarizer';
import { SummarizeTarget } from './types';

export type { SummarizeTarget } from './types';
export type { SummarizeSettings } from '../settings';

/**
 * Function that transcribes a video URL and returns the transcript text.
 * Injected by main.ts from the VideoModule.
 */
export type TranscribeUrlFn = (
	url: string,
	parentOp?: { update: (msg: string) => void }
) => Promise<string>;

const COMPREHENSIVE_SUMMARY_PROMPT =
	'Provide a comprehensive summary of the following content. This summary will be a standalone reference note. ' +
	'Cover all major points, key arguments, and important details. ' +
	'Use clear markdown structure with headings (##) where appropriate. Be thorough but concise.';

interface PendingNote {
	path: string;
	content: string;
}

interface ProcessResult {
	/** Number of inline summary blockquotes inserted */
	inlineCompleted: number;
	/** Number of enrichment-ref notes created (new notes) */
	enrichmentCompleted: number;
	/** Number of links updated to internal links (note already existed, no fetch/summarize) */
	linksUpdated: number;
	/** Vault paths of newly created summary notes */
	newNotePaths: string[];
}

export class SummarizeModule {
	private summarizer: Summarizer;
	private transcribeUrl: TranscribeUrlFn | null;

	/** Optional callback invoked after summarization completes. Wired by main.ts for enrichment. */
	onSummaryComplete: ((filePath: string) => void) | null = null;

	/** Optional callback invoked after single-note summarize to organize the note. Wired by main.ts. */
	onOrganizeRequested: ((file: TFile) => void) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings,
		private notifications: NotificationManager,
		transcribeUrl?: TranscribeUrlFn
	) {
		this.summarizer = new Summarizer(getSettings);
		this.transcribeUrl = transcribeUrl ?? null;
	}

	async onload(): Promise<void> {
		this.plugin.addCommand({
			id: 'auto-notes:summarize-current-note',
			name: 'Summarize current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.summarizeNote(ctx.file);
				}
			},
		});

		this.plugin.addCommand({
			id: 'auto-notes:scan-vault-summarize',
			name: 'Scan vault for notes to summarize',
			callback: () => {
				const defaultPath = this.plugin.app.workspace.getActiveFile()?.parent?.path || '';
				new FolderPickerModal(
					this.plugin.app,
					(folder) => this.scanVault(folder.isRoot() ? undefined : folder.path),
					defaultPath
				).open();
			},
		});
	}

	onunload(): void {}

	private async summarizeNote(file: TFile): Promise<void> {
		const content = await this.plugin.app.vault.read(file);
		const targets = findSummarizeTargets(content);

		if (targets.length === 0) {
			this.notifications.info('No URLs or transcriptions to summarize in this note');
			return;
		}

		if (targets.length === 1) {
			await this.processTargets(file, targets, content);
		} else {
			new SummarizeSelectionModal(
				this.plugin.app,
				targets,
				async (selected) => {
					await this.processTargets(file, selected, content);
				}
			).open();
		}
	}

	private async processTargets(
		file: TFile,
		targets: SummarizeTarget[],
		content: string
	): Promise<void> {
		const total = targets.length;
		const op = this.notifications.startOperation(
			`Summarizing ${total} item(s)`,
			`summarize-${file.path}`
		);

		const result = await this.processFileTargets(file, targets, op, content);

		if (!op.cancelled) {
			const totalDone = result.inlineCompleted + result.enrichmentCompleted + result.linksUpdated;
			const parts: string[] = [];
			if (result.inlineCompleted > 0) {
				parts.push(`${result.inlineCompleted} inline`);
			}
			if (result.enrichmentCompleted > 0) {
				parts.push(`${result.enrichmentCompleted} note(s) created`);
			}
			if (result.linksUpdated > 0) {
				parts.push(`${result.linksUpdated} link(s) updated`);
			}
			op.finish(`Done \u2014 ${parts.join(', ') || `${totalDone}/${total} processed`}`);
		}

		this.fireEnrichmentCallbacks(file.path, result);

		// Trigger single-note organize (never vault-wide scan)
		if (this.getSettings().summarize.autoOrganizeOnSummarize) {
			this.onOrganizeRequested?.(file);
		}
	}

	/**
	 * Fire enrichment callbacks for processed results.
	 * Only triggers on the source note when no enrichment sections were
	 * modified \u2014 otherwise the applier would strip and rebuild them.
	 */
	private fireEnrichmentCallbacks(sourceFilePath: string, result: ProcessResult): void {
		if (result.inlineCompleted > 0 && result.enrichmentCompleted === 0) {
			this.onSummaryComplete?.(sourceFilePath);
		}
		for (const notePath of result.newNotePaths) {
			this.onSummaryComplete?.(notePath);
		}
	}

	/**
	 * Core per-file processing shared by single-note and vault-scan flows.
	 * Handles both inline summaries and enrichment-ref note creation.
	 *
	 * IMPORTANT: new notes are created AFTER vault.modify() on the source
	 * file to avoid Obsidian metadata-resolution events flushing the
	 * editor's stale buffer back to disk over our changes.
	 */
	private async processFileTargets(
		file: TFile,
		targets: SummarizeTarget[],
		op: OperationHandle,
		initialContent?: string
	): Promise<ProcessResult> {
		const settings = this.getSettings().summarize;
		const total = targets.length;
		const sourceFolder = file.parent?.path || '';

		// Process in reverse line order so insertions/replacements don't shift line numbers
		const sorted = [...targets].sort((a, b) => b.line - a.line);

		const rawContent = initialContent ?? await this.plugin.app.vault.read(file);
		let lines = rawContent.split('\n');
		let inlineCompleted = 0;
		let enrichmentCompleted = 0;
		let linksUpdated = 0;
		const newNotePaths: string[] = [];
		const pendingNotes: PendingNote[] = [];
		let processed = 0;

		for (const target of sorted) {
			if (op.cancelled) break;

			try {
				processed++;
				op.progress(processed, total, 'Summarizing');

				if (target.inEnrichmentSection && target.linkTitle) {
					// \u2500\u2500 Enrichment target: create standalone note \u2500\u2500
					const title = target.linkTitle;
					const notePath = this.buildNotePath(title, sourceFolder);

					// If the note already exists, just replace the link \u2014 skip fetch/summarize
					const noteAlreadyExists = !!this.plugin.app.vault.getAbstractFileByPath(notePath);

					if (!noteAlreadyExists) {
						op.update(`Fetching ${title}`);

						const pageContent = await this.fetchContentForUrl(
							target.source,
							settings.maxContentLength,
							op
						);

						if (!pageContent.trim()) {
							this.notifications.notifyError(
								`No content extracted from ${target.source}`,
								new Error('Empty content')
							);
							continue;
						}

						op.update(`Summarizing ${title}`);
						const summary = await this.summarizer.summarize(
							pageContent,
							target.source,
							settings.summaryStyle,
							COMPREHENSIVE_SUMMARY_PROMPT
						);

						pendingNotes.push({
							path: notePath,
							content: [
								`[Original source](${target.source})`,
								'',
								summary,
								'',
							].join('\n'),
						});
						newNotePaths.push(notePath);
					}

					// Replace external link with internal link in source note
					lines[target.line] = lines[target.line].replace(
						/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/,
						() => `[[${title}]]`
					);

					if (noteAlreadyExists) {
						linksUpdated++;
					} else {
						enrichmentCompleted++;
					}
				} else {
					// \u2500\u2500 Inline target: insert summary blockquote \u2500\u2500
					let textToSummarize: string;

					if (target.type === 'transcription' && target.content) {
						textToSummarize = target.content;
					} else {
						op.update(`Fetching ${target.source}`);
						textToSummarize = await this.fetchContentForUrl(
							target.source,
							settings.maxContentLength,
							op
						);
					}

					if (!textToSummarize.trim()) {
						this.notifications.notifyError(
							`No content extracted from ${target.source}`,
							new Error('Empty content')
						);
						continue;
					}

					op.update(`Summarizing ${target.source}`);
					const summary = await this.summarizer.summarize(
						textToSummarize,
						target.source,
						settings.summaryStyle,
						settings.customPrompt || undefined
					);

					const blockLines = [
						'',
						`> **Summary of ${target.source}**`,
						'>',
						...summary.split('\n').map(line => `> ${line}`),
						'',
					];

					lines.splice(target.endLine + 1, 0, ...blockLines);

					inlineCompleted++;
				}
			} catch (error) {
				this.notifications.notifyError(
					`Summarization failed for ${target.source}`,
					error
				);
			}
		}

		// Write source note FIRST \u2014 before creating new notes.
		// vault.create() triggers Obsidian metadata resolution which can
		// cause the editor to flush its pre-modification buffer to disk,
		// overwriting our changes.
		if (inlineCompleted > 0 || enrichmentCompleted > 0 || linksUpdated > 0) {
			await this.plugin.app.vault.modify(file, lines.join('\n'));
		}

		// NOW create the new summary notes
		for (const pending of pendingNotes) {
			await this.plugin.app.vault.create(pending.path, pending.content);
		}

		return { inlineCompleted, enrichmentCompleted, linksUpdated, newNotePaths };
	}

	/**
	 * Fetch content for a URL. If the URL is a recognized video platform
	 * and a transcription function is available, transcribe the video
	 * instead of fetching the page HTML (which yields little useful text
	 * from JS-rendered video pages).
	 */
	private async fetchContentForUrl(
		url: string,
		maxLength: number,
		op: OperationHandle
	): Promise<string> {
		if (this.transcribeUrl && isSupportedUrl(url)) {
			try {
				op.update(`Transcribing video ${url}`);
				const transcript = await this.transcribeUrl(url, op);
				return transcript.slice(0, maxLength);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				throw new Error(`Video transcription failed for ${url}: ${msg}`);
			}
		}

		return fetchPageContent(url, maxLength);
	}

	/**
	 * Build the vault path for a summary note without creating it.
	 */
	private buildNotePath(title: string, sourceFolder: string): string {
		const safeName = title
			.replace(/[\\/:*?"<>|#^[\]]/g, '-')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 100);
		const folderPrefix = sourceFolder ? sourceFolder + '/' : '';
		return `${folderPrefix}${safeName}.md`;
	}

	private async scanVault(folderPath?: string): Promise<void> {
		const settings = this.getSettings().summarize;

		// Phase 1: Scan for files with targets
		const scopeLabel = folderPath ? `Scanning ${folderPath}` : 'Scanning vault';
		const scanOp = this.notifications.startOperation(
			`${scopeLabel} for summarizable content`,
			'summarize-vault-scan'
		);

		const allFiles = getMarkdownFiles(this.plugin.app, folderPath);
		const filesWithTargets: Array<{ file: TFile; targets: SummarizeTarget[] }> = [];

		try {
			for (let i = 0; i < allFiles.length; i++) {
				if (scanOp.cancelled) break;
				scanOp.progress(i + 1, allFiles.length, scopeLabel);

				const file = allFiles[i];
				if (this.isExcluded(file)) continue;

				const content = await this.plugin.app.vault.read(file);
				const targets = findSummarizeTargets(content);
				if (targets.length > 0) {
					filesWithTargets.push({ file, targets });
				}
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			scanOp.error(`Vault scan failed \u2014 ${msg}`);
			return;
		}

		const totalTargets = filesWithTargets.reduce((sum, f) => sum + f.targets.length, 0);
		scanOp.finish(
			`Found ${totalTargets} item(s) across ${filesWithTargets.length} note(s)`
		);

		if (filesWithTargets.length === 0) {
			return;
		}

		// Phase 2: Confirm with user
		const proceed = await this.notifications.confirm(
			`Found ${totalTargets} item(s) to summarize across ${filesWithTargets.length} note(s). Proceed?`,
			{ proceedLabel: 'Summarize', cancelLabel: 'Cancel' }
		);

		if (!proceed) {
			this.notifications.info('Vault summarization cancelled');
			return;
		}

		// Phase 3: Process files
		const genOp = this.notifications.startOperation(
			'Generating summaries',
			'summarize-vault-generate'
		);
		let totalInline = 0;
		let totalEnrichment = 0;
		let totalLinksUpdated = 0;

		for (let i = 0; i < filesWithTargets.length; i++) {
			if (genOp.cancelled) break;

			const { file } = filesWithTargets[i];
			genOp.progress(i + 1, filesWithTargets.length, 'Processing files');

			// Re-read content AND re-scan targets at processing time so
			// line numbers match the current file state (content may have
			// changed since the initial scan, e.g. a previous file's
			// enrichment callback modifying this file).
			const content = await this.plugin.app.vault.read(file);
			const targets = findSummarizeTargets(content);
			if (targets.length === 0) continue;
			const result = await this.processFileTargets(file, targets, genOp, content);
			totalInline += result.inlineCompleted;
			totalEnrichment += result.enrichmentCompleted;
			totalLinksUpdated += result.linksUpdated;

			this.fireEnrichmentCallbacks(file.path, result);
		}

		if (!genOp.cancelled) {
			const parts: string[] = [];
			if (totalInline > 0) parts.push(`${totalInline} inline summaries`);
			if (totalEnrichment > 0) parts.push(`${totalEnrichment} notes created`);
			if (totalLinksUpdated > 0) parts.push(`${totalLinksUpdated} links updated`);
			genOp.finish(`Done \u2014 ${parts.join(', ')}`);
		}
	}

	private isExcluded(file: TFile): boolean {
		const settings = this.getSettings().summarize;

		for (const folder of settings.excludeFolders) {
			if (file.path.startsWith(folder + '/')) return true;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.tags) {
			const fileTags: string[] = Array.isArray(cache.frontmatter.tags)
				? cache.frontmatter.tags
				: [cache.frontmatter.tags];
			for (const excludeTag of settings.excludeTags) {
				const normalized = excludeTag.startsWith('#')
					? excludeTag.slice(1)
					: excludeTag;
				if (fileTags.includes(normalized)) return true;
			}
		}

		return false;
	}
}
