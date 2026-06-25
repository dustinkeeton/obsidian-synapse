import { Plugin, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { CommandRegistrar } from '../commands';
import {
	FolderPickerModal, getMarkdownFiles, NotificationManager, buildCallout,
	CALLOUT_TYPES, CheckpointManager, generateId, fireAndForget,
	isPathExcluded, matchesExcludeTag, detectSchemaFor,
} from '../shared';
import type { Checkpoint, CheckpointWorkItem, DeferredTask } from '../shared';
import { OperationHandle } from '../shared';
import { isSupportedUrl, detectPlatform } from '../shared';
import { findAudioEmbeds } from '../audio';
import { fetchPageContent, fetchTweetContent, isRedditUrl, fetchRedditContent, linkLoadError } from '../shared';
import { findSummarizeTargets, extractNoteProse } from './note-scanner';
import { hasSummaryBelow } from './note-scanner';
import { SummarizeSelectionModal } from './summarize-modal';
import { Summarizer } from './summarizer';
import { SummarizeTarget } from './types';

export type { SummarizeTarget } from './types';

/**
 * Function that transcribes a video URL and returns the transcript text.
 * Injected by main.ts from the VideoModule.
 */
export type TranscribeUrlFn = (
	url: string,
	parentOp?: { update: (msg: string) => void }
) => Promise<string>;

/**
 * Function that transcribes an audio file and returns the transcript text.
 * Injected by main.ts from the AudioModule.
 */
export type TranscribeAudioFn = (
	file: TFile
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

/** Human-readable label for a target in combined-summary output (#367). */
function labelForTarget(target: SummarizeTarget): string {
	switch (target.type) {
		case 'note-content': return `Note: ${target.source}`;
		case 'audio': return `Audio: ${target.source}`;
		case 'transcription': return `Transcription: ${target.source}`;
		default: return target.source;
	}
}

export class SummarizeModule {
	private summarizer: Summarizer;
	private transcribeUrl: TranscribeUrlFn | null;
	private transcribeAudio: TranscribeAudioFn | null;

	/** Optional callback invoked after summarization completes. Wired by main.ts for enrichment. */
	onSummaryComplete: ((filePath: string) => void) | null = null;

	/** Optional callback invoked after single-note summarize to organize the note. Wired by main.ts. */
	onOrganizeRequested: ((file: TFile) => void) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
		private checkpointManager: CheckpointManager,
		private registrar: CommandRegistrar,
		transcribeUrl?: TranscribeUrlFn,
		transcribeAudio?: TranscribeAudioFn
	) {
		this.summarizer = new Summarizer(getSettings);
		this.transcribeUrl = transcribeUrl ?? null;
		this.transcribeAudio = transcribeAudio ?? null;
	}

	async onload(): Promise<void> {
		this.registrar.register('summarize-current-note', this.getSettings().summarize.enabled, {
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.summarizeNote(ctx.file);
				}
			},
		});

		this.registrar.register('scan-vault-summarize', this.getSettings().summarize.enabled, {
			callback: () => {
				const defaultPath = this.plugin.app.workspace.getActiveFile()?.parent?.path || '';
				new FolderPickerModal(
					this.plugin.app,
					(folder) => {
						fireAndForget(
							this.scanVault(folder.isRoot() ? undefined : folder.path),
							'Scan folder for notes to summarize',
							{ notifications: this.notifications },
						);
					},
					defaultPath
				).open();
			},
		});
	}

	onunload(): void {}

	/**
	 * Resume summarization from a checkpoint (C1).
	 * Re-processes the remaining files from the checkpoint.
	 */
	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		const genOp = this.notifications.startOperation(
			'Resuming summarization',
			'summarize-vault-resume'
		);
		let totalInline = 0;
		let totalEnrichment = 0;
		let totalLinksUpdated = 0;

		try {
			for (let i = 0; i < checkpoint.remainingItems.length; i++) {
				if (genOp.cancelled) break;

				const item = checkpoint.remainingItems[i];
				const filePath = item.payload.filePath as string;

				genOp.progress(i + 1, checkpoint.remainingItems.length, 'Resuming summarization');

				const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
				if (!(file instanceof TFile)) continue;
				if (this.isExcluded(file)) continue;

				const content = await this.plugin.app.vault.read(file);
				const targets = this.collectTargets(content, file.path);
				if (targets.length === 0) continue;

				const result = await this.processTargetsForFile(
					file,
					targets,
					genOp,
					content,
					this.getSettings().summarize.combineSummaries
				);
				totalInline += result.inlineCompleted;
				totalEnrichment += result.enrichmentCompleted;
				totalLinksUpdated += result.linksUpdated;

				this.fireEnrichmentCallbacks(file.path, result);
				await this.checkpointManager.completeItem(checkpoint.id, item.id);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			genOp.error(`Resume failed -- ${msg}`);
			return;
		}

		if (genOp.cancelled) {
			await this.checkpointManager.discard(checkpoint.id);
			return;
		}

		const tasks = await this.checkpointManager.complete(checkpoint.id);
		this.dispatchDeferredTasks(tasks);

		const parts: string[] = [];
		if (totalInline > 0) parts.push(`${totalInline} inline summaries`);
		if (totalEnrichment > 0) parts.push(`${totalEnrichment} notes created`);
		if (totalLinksUpdated > 0) parts.push(`${totalLinksUpdated} links updated`);
		genOp.finish(`Resumed -- ${parts.join(', ') || 'no changes'}`);
	}

	private async summarizeNote(file: TFile): Promise<void> {
		const content = await this.plugin.app.vault.read(file);
		const targets = this.collectTargets(content, file.path);

		if (targets.length === 0) {
			this.notifications.info('No note content, URLs, transcriptions, or audio to summarize in this note');
			return;
		}

		// A single item (e.g. a prose-only note) is processed directly with a
		// per-item callout -- no modal, and "combine" is meaningless for one item.
		if (targets.length === 1) {
			await this.processTargets(file, targets, content);
			return;
		}

		const settings = this.getSettings().summarize;
		new SummarizeSelectionModal(
			this.plugin.app,
			targets,
			async (selected, combine) => {
				if (combine) {
					await this.processTargetsCombined(file, selected, content);
				} else {
					await this.processTargets(file, selected, content);
				}
			},
			{
				includeNoteContent: settings.includeNoteContent,
				combineSummaries: settings.combineSummaries,
			}
		).open();
	}

	/**
	 * Combined-summary path (#367): produce ONE summary for all selected
	 * summarizable items. A thin wrapper around `processTargetsForFile` that
	 * owns the progress operation, enrichment callbacks, and organize trigger
	 * for the interactive single-note flow.
	 */
	private async processTargetsCombined(
		file: TFile,
		targets: SummarizeTarget[],
		content: string
	): Promise<void> {
		const op = this.notifications.startOperation(
			`Summarizing ${targets.length} item(s)`,
			`summarize-${file.path}`
		);

		const result = await this.processTargetsForFile(file, targets, op, content, true);
		this.fireEnrichmentCallbacks(file.path, result);

		if (!op.cancelled) {
			op.finish('Done -- combined summary added');
		}

		// Trigger single-note organize (never vault-wide scan)
		if (this.getSettings().summarize.autoOrganizeOnSummarize) {
			this.onOrganizeRequested?.(file);
		}
	}

	/**
	 * Route a file's targets through the combined or per-item path (#367).
	 * Enrichment targets (which create standalone notes and rewrite links)
	 * always go through the per-item path; the remaining summarizable items
	 * are folded into ONE combined summary when `combine` is set. Returns the
	 * merged counts so callers can report progress and fire callbacks. Shared
	 * by the interactive single-note flow and the vault/folder scan.
	 */
	private async processTargetsForFile(
		file: TFile,
		targets: SummarizeTarget[],
		op: OperationHandle,
		content: string,
		combine: boolean
	): Promise<ProcessResult> {
		if (!combine) {
			return this.processFileTargets(file, targets, op, content);
		}

		const enrichmentTargets = targets.filter(t => t.inEnrichmentSection && t.linkTitle);
		const summarizable = targets.filter(t => !(t.inEnrichmentSection && t.linkTitle));

		let result: ProcessResult = {
			inlineCompleted: 0,
			enrichmentCompleted: 0,
			linksUpdated: 0,
			newNotePaths: [],
		};

		// Enrichment refs first (per-item): create notes + rewrite links.
		if (enrichmentTargets.length > 0 && !op.cancelled) {
			result = await this.processFileTargets(file, enrichmentTargets, op, content);
		}

		// Then ONE combined summary for everything else. Re-read the note when
		// the enrichment pass rewrote links so the single-item fallback sees
		// current content.
		if (summarizable.length > 0 && !op.cancelled) {
			const fresh = enrichmentTargets.length > 0
				? await this.plugin.app.vault.read(file)
				: content;
			const combined = await this.combineSelectedTargets(file, summarizable, op, fresh);
			result = {
				inlineCompleted: result.inlineCompleted + combined.inlineCompleted,
				enrichmentCompleted: result.enrichmentCompleted + combined.enrichmentCompleted,
				linksUpdated: result.linksUpdated + combined.linksUpdated,
				newNotePaths: [...result.newNotePaths, ...combined.newNotePaths],
			};
		}

		return result;
	}

	/**
	 * Gather every selected item's content -- the note's own prose, fetched URL
	 * text, and existing or freshly-made transcripts (audio is transcribed at
	 * most once; existing transcripts are reused, never re-fetched) -- then
	 * concatenate it with source labels, run ONE summarize() call, and append
	 * ONE `Combined summary (N items)` callout at the end of the note (#367).
	 *
	 * A single item is delegated to the per-item path for a cleaner callout
	 * title. Does NOT fire enrichment callbacks -- the caller owns that.
	 */
	private async combineSelectedTargets(
		file: TFile,
		targets: SummarizeTarget[],
		op: OperationHandle,
		content: string
	): Promise<ProcessResult> {
		const empty: ProcessResult = {
			inlineCompleted: 0,
			enrichmentCompleted: 0,
			linksUpdated: 0,
			newNotePaths: [],
		};
		if (targets.length === 0) return empty;
		if (targets.length === 1) {
			return this.processFileTargets(file, targets, op, content);
		}

		const settings = this.getSettings().summarize;
		const sections: string[] = [];
		const labels: string[] = [];

		for (const target of targets) {
			if (op.cancelled) return empty;
			try {
				let text: string;
				if (target.type === 'note-content' || (target.type === 'transcription' && target.content)) {
					// Reuse already-extracted prose / transcripts -- no re-fetch, no re-transcribe.
					text = target.content ?? '';
				} else if (target.type === 'audio' && this.transcribeAudio) {
					op.update(`Transcribing audio ${target.source}`);
					text = await this.fetchContentForAudio(target.source, file, settings.maxContentLength);
				} else {
					op.update(`Fetching ${target.source}`);
					text = await this.fetchContentForUrl(target.source, settings.maxContentLength, op);
				}
				if (text.trim()) {
					const label = labelForTarget(target);
					sections.push(`## ${label}\n\n${text.trim()}`);
					labels.push(label);
				} else {
					// Parity with the per-item path: a successful-but-empty fetch is
					// surfaced with the same standardized notice, not silently dropped.
					this.notifications.error(
						linkLoadError(target.source, 'page returned no readable text')
					);
				}
			} catch (error) {
				// Standardized link-load failure notice -- identical format to the
				// per-item summarize path and Elaborate (was notifyError, which read
				// differently for the same underlying failure).
				const reason = error instanceof Error ? error.message : String(error);
				this.notifications.error(linkLoadError(target.source, reason));
			}
		}

		if (op.cancelled || sections.length === 0) return empty;

		const combinedText = sections.join('\n\n---\n\n').slice(0, settings.maxContentLength);

		op.update('Summarizing combined content');
		let effectivePrompt = settings.customPrompt || undefined;
		if (!effectivePrompt && settings.autoDetectTemplates) {
			const schema = detectSchemaFor('summary', combinedText);
			if (schema) effectivePrompt = schema.prompt;
		}

		const summary = await this.summarizer.summarize(
			combinedText,
			labels.join(', '),
			settings.summaryStyle,
			effectivePrompt || COMPREHENSIVE_SUMMARY_PROMPT
		);

		const callout = buildCallout(
			CALLOUT_TYPES.summary,
			`Combined summary (${labels.length} items)`,
			`Sources: ${labels.join(', ')}\n\n${summary}`
		);

		// Append at the end of the note's current content.
		await this.plugin.app.vault.process(file, (current) => {
			const lines = current.split('\n');
			lines.push(...callout.split('\n'));
			return lines.join('\n');
		});

		return { inlineCompleted: 1, enrichmentCompleted: 0, linksUpdated: 0, newNotePaths: [] };
	}

	/**
	 * Collect all summarization targets from a note: URLs, transcription
	 * blocks (from the pure string scanner), and audio embeds (requires
	 * MetadataCache). Results are merged and sorted by line number.
	 */
	private collectTargets(content: string, sourcePath: string): SummarizeTarget[] {
		const targets = findSummarizeTargets(content);

		if (this.transcribeAudio) {
			const lines = content.split('\n');
			const audioEmbeds = findAudioEmbeds(
				content,
				sourcePath,
				this.plugin.app.metadataCache
			);

			for (const embed of audioEmbeds) {
				// Skip audio embeds that already have a summary below
				if (hasSummaryBelow(lines, embed.line, embed.fileName)) continue;

				targets.push({
					type: 'audio',
					source: embed.fileName,
					line: embed.line,
					endLine: embed.line,
				});
			}

			// Re-sort by line number to maintain consistent ordering
			targets.sort((a, b) => a.line - b.line);
		}

		// The note's own prose as an additional item (#367). Appended last so
		// its summary callout lands at the end of the note. Stripped of
		// frontmatter and prior summary/transcription/lyrics blocks so the AI
		// never re-summarizes its own output or double-counts transcripts.
		if (this.getSettings().summarize.includeNoteContent) {
			const prose = extractNoteProse(content);
			if (prose.trim()) {
				const lastLine = Math.max(0, content.split('\n').length - 1);
				const basename = sourcePath.split('/').pop()?.replace(/\.md$/, '') || sourcePath;
				targets.push({
					type: 'note-content',
					source: basename,
					line: lastLine,
					endLine: lastLine,
					content: prose,
				});
			}
		}

		return targets;
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
			op.finish(`Done -- ${parts.join(', ') || `${totalDone}/${total} processed`}`);
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
	 * modified -- otherwise the applier would strip and rebuild them.
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
	 * IMPORTANT: new notes are created AFTER vault.process() on the source
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
					// -- Enrichment target: create standalone note --
					const title = target.linkTitle;
					const notePath = this.buildNotePath(title, sourceFolder);

					// If the note already exists, just replace the link -- skip fetch/summarize
					const noteAlreadyExists = !!this.plugin.app.vault.getAbstractFileByPath(notePath);

					if (!noteAlreadyExists) {
						op.update(`Fetching ${title}`);

						const pageContent = await this.fetchUrlContentOrNotify(
							target.source,
							settings.maxContentLength,
							op
						);

						if (pageContent === null) continue;

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
					// -- Inline target: insert summary blockquote --
					let textToSummarize: string;

					if (target.type === 'audio' && this.transcribeAudio) {
						op.update(`Transcribing audio ${target.source}`);
						textToSummarize = await this.fetchContentForAudio(
							target.source,
							file,
							settings.maxContentLength
						);
					} else if (target.type === 'transcription' && target.content) {
						textToSummarize = target.content;
					} else if (target.type === 'note-content') {
						// The note's own prose, pre-extracted in collectTargets.
						textToSummarize = (target.content ?? '').slice(0, settings.maxContentLength);
					} else {
						op.update(`Fetching ${target.source}`);
						const fetched = await this.fetchUrlContentOrNotify(
							target.source,
							settings.maxContentLength,
							op
						);
						if (fetched === null) continue;
						textToSummarize = fetched;
					}

					if (!textToSummarize.trim()) {
						this.notifications.error(
							linkLoadError(target.source, 'page returned no readable text')
						);
						continue;
					}

					op.update(`Summarizing ${target.source}`);

					// Priority chain: customPrompt > schema match > style default
					let effectivePrompt = settings.customPrompt || undefined;
					if (!effectivePrompt && settings.autoDetectTemplates) {
						const schema = detectSchemaFor('summary', textToSummarize);
						if (schema) {
							effectivePrompt = schema.prompt;
						}
					}

					const summary = await this.summarizer.summarize(
						textToSummarize,
						target.source,
						settings.summaryStyle,
						effectivePrompt
					);

					const callout = buildCallout(
						CALLOUT_TYPES.summary,
						`Summary of ${target.source}`,
						summary
					);

					lines.splice(target.endLine + 1, 0, ...callout.split('\n'));

					inlineCompleted++;
				}
			} catch (error) {
				this.notifications.notifyError(
					`Summarization failed for ${target.source}`,
					error
				);
			}
		}

		// Write source note FIRST -- before creating new notes.
		// vault.create() triggers Obsidian metadata resolution which can
		// cause the editor to flush its pre-modification buffer to disk,
		// overwriting our changes.
		// `lines` is the accumulation of many async-interleaved splices and
		// in-place edits computed across the loop above, so it can't be cleanly
		// re-derived from fresh content; wrap the computed result in process()
		// to keep the atomic write + the create()-ordering guarantee intact.
		if (inlineCompleted > 0 || enrichmentCompleted > 0 || linksUpdated > 0) {
			const finalContent = lines.join('\n');
			await this.plugin.app.vault.process(file, () => finalContent);
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

		if (detectPlatform(url)?.platform === 'twitter') {
			return fetchTweetContent(url, maxLength);
		}

		// Reddit is classified as a generic 'article' platform, so route it
		// explicitly (as Elaborate does) to the dedicated RSS fetcher; the
		// JS-rendered HTML page fetchPageContent would get has no readable text.
		if (isRedditUrl(url)) {
			return fetchRedditContent(url, maxLength);
		}

		return fetchPageContent(url, maxLength);
	}

	/**
	 * Fetch a URL's content, surfacing the standardized link-load error notice
	 * (the same wording Elaborate uses) when the fetch throws or yields no
	 * readable text. Returns null to signal the caller should skip this target.
	 */
	private async fetchUrlContentOrNotify(
		source: string,
		maxLength: number,
		op: OperationHandle
	): Promise<string | null> {
		let content: string;
		try {
			content = await this.fetchContentForUrl(source, maxLength, op);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.notifications.error(linkLoadError(source, reason));
			return null;
		}
		if (!content.trim()) {
			this.notifications.error(linkLoadError(source, 'page returned no readable text'));
			return null;
		}
		return content;
	}

	/**
	 * Transcribe an audio file embed and return its text content.
	 * Resolves the file via MetadataCache, reads the binary data,
	 * and calls the injected transcribeAudio callback.
	 */
	private async fetchContentForAudio(
		fileName: string,
		sourceFile: TFile,
		maxLength: number
	): Promise<string> {
		const audioFile = this.plugin.app.metadataCache.getFirstLinkpathDest(
			fileName,
			sourceFile.path
		);
		if (!audioFile || !(audioFile instanceof TFile)) {
			throw new Error(`Audio file not found in vault: ${fileName}`);
		}

		const transcript = await this.transcribeAudio!(audioFile);
		return transcript.slice(0, maxLength);
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

	async scanVault(folderPath?: string, skipConfirmation = false, onlyFile?: TFile): Promise<void> {
		// Phase 1: Scan for files with targets
		const scopeLabel = folderPath ? `Scanning ${folderPath}` : 'Scanning vault';
		const scanOp = this.notifications.startOperation(
			`${scopeLabel} for summarizable content`,
			'summarize-vault-scan'
		);

		let allFiles = getMarkdownFiles(this.plugin.app, folderPath);
		// Per-file scoping (#111): narrow to the single requested note.
		if (onlyFile) allFiles = allFiles.filter(f => f.path === onlyFile.path);
		const filesWithTargets: Array<{ file: TFile; targets: SummarizeTarget[] }> = [];

		try {
			for (let i = 0; i < allFiles.length; i++) {
				if (scanOp.cancelled) break;
				scanOp.progress(i + 1, allFiles.length, scopeLabel);

				const file = allFiles[i];
				if (this.isExcluded(file)) continue;

				const content = await this.plugin.app.vault.read(file);
				const targets = this.collectTargets(content, file.path);
				if (targets.length > 0) {
					filesWithTargets.push({ file, targets });
				}
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			scanOp.error(`Vault scan failed -- ${msg}`);
			return;
		}

		const totalTargets = filesWithTargets.reduce((sum, f) => sum + f.targets.length, 0);
		scanOp.finish(
			`Found ${totalTargets} item(s) across ${filesWithTargets.length} note(s)`
		);

		if (filesWithTargets.length === 0) {
			return;
		}

		// Phase 2: Confirm with user (skipped when called from Fire Synapse)
		if (!skipConfirmation) {
			const proceed = await this.notifications.confirm(
				`Found ${totalTargets} item(s) to summarize across ${filesWithTargets.length} note(s). Proceed?`,
				{ proceedLabel: 'Summarize', cancelLabel: 'Cancel' }
			);

			if (!proceed) {
				this.notifications.info('Vault summarization cancelled');
				return;
			}
		}

		// Phase 3: Process files (checkpointed)
		const genOp = this.notifications.startOperation(
			'Generating summaries',
			'summarize-vault-generate'
		);
		let totalInline = 0;
		let totalEnrichment = 0;
		let totalLinksUpdated = 0;

		// Create checkpoint for resumability
		const checkpointItems: CheckpointWorkItem[] = filesWithTargets.map((ft, i) => ({
			id: `sum-${i}-${ft.file.path}`,
			label: ft.file.path,
			payload: { filePath: ft.file.path },
		}));
		const checkpoint = await this.checkpointManager.create({
			module: 'summarize',
			operationLabel: `Summarize: vault scan${folderPath ? ` (${folderPath})` : ''}`,
			items: checkpointItems,
		});

		// Register deferred task for sidebar refresh (I1)
		await this.checkpointManager.addDeferredTask(checkpoint.id, {
			id: generateId(),
			type: 'refresh-sidebar-view',
			data: {},
		});

		for (let i = 0; i < filesWithTargets.length; i++) {
			if (genOp.cancelled) break;

			const { file } = filesWithTargets[i];
			genOp.progress(i + 1, filesWithTargets.length, 'Processing files');

			// Re-read content AND re-scan targets at processing time so
			// line numbers match the current file state (content may have
			// changed since the initial scan, e.g. a previous file's
			// enrichment callback modifying this file).
			const content = await this.plugin.app.vault.read(file);
			const targets = this.collectTargets(content, file.path);
			if (targets.length === 0) continue;
			const result = await this.processTargetsForFile(
				file,
				targets,
				genOp,
				content,
				this.getSettings().summarize.combineSummaries
			);
			totalInline += result.inlineCompleted;
			totalEnrichment += result.enrichmentCompleted;
			totalLinksUpdated += result.linksUpdated;

			this.fireEnrichmentCallbacks(file.path, result);

			// Save checkpoint progress
			await this.checkpointManager.completeItem(
				checkpoint.id,
				checkpointItems[i].id
			);
		}

		if (genOp.cancelled) {
			// Discard checkpoint on user cancellation (C3)
			await this.checkpointManager.discard(checkpoint.id);
		} else {
			// Mark checkpoint completed and dispatch deferred tasks (I1)
			const tasks = await this.checkpointManager.complete(checkpoint.id);
			this.dispatchDeferredTasks(tasks);
			const parts: string[] = [];
			if (totalInline > 0) parts.push(`${totalInline} inline summaries`);
			if (totalEnrichment > 0) parts.push(`${totalEnrichment} notes created`);
			if (totalLinksUpdated > 0) parts.push(`${totalLinksUpdated} links updated`);
			genOp.finish(`Done -- ${parts.join(', ')}`);
		}
	}

	private isExcluded(file: TFile): boolean {
		const settings = this.getSettings();
		return (
			isPathExcluded(file.path, 'summarize', settings) ||
			matchesExcludeTag(file, settings.summarize.excludeTags, this.plugin.app.metadataCache)
		);
	}

	/** Dispatch deferred tasks (I1). */
	private dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			switch (task.type) {
				case 'refresh-sidebar-view':
					// Summarize module doesn't have a direct view refresh callback
					break;
				default:
					console.warn(`[Synapse] Unknown deferred task type: ${task.type}`);
			}
		}
	}
}

// Settings section renderer (#243)
export { renderSummarizeSettings } from './settings-section';
