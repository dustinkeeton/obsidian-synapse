import { Plugin, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { CommandRegistrar } from '../commands';
import { AIClient, NotificationManager, NoteOperationQueue, getMarkdownFiles, parseFrontmatter, sanitizeAIResponse, stripCodeFences, serializeFrontmatter, withRetry, generateId, isPathExcluded, findMatchingRule, trackAiCache, withCacheReport } from '../shared';
import type { CacheUse, OperationHandle, ModuleDeps, FeatureModule } from '../shared';
import { TidyStore } from './tidy-store';
import { TidySnapshot } from './types';

export type { TidySnapshot } from './types';

const SYSTEM_PROMPT = `You are a note tidying assistant. You receive a markdown note and return it tidied.

Your job has exactly two parts:

1. **Spelling correction** — Fix misspelled words. Do NOT change grammar, sentence structure, word choice, or meaning. Only fix actual spelling errors.

2. **Markdown formatting** — Organize the content into logical markdown elements where appropriate:
   - Bullet points and numbered lists
   - Block quotes
   - Headers and subheaders
   - Code blocks (if code is present)
   - Emphasis and bold where the content calls for it

Rules you MUST follow:
- Do NOT add, remove, or rephrase any content. The words and ideas must remain the same (except spelling fixes).
- Do NOT correct grammar. If a sentence is grammatically awkward, leave it that way.
- Do NOT add commentary, explanations, or notes of your own.
- Do NOT wrap the output in a code fence. Return raw markdown only.
- Preserve all frontmatter exactly as-is (if present).
- Preserve all existing links, tags, embeds, and Obsidian syntax exactly.
- Return ONLY the tidied note content — nothing else.`;

export class TidyModule implements FeatureModule {
	private plugin: Plugin;
	private getSettings: () => SynapseSettings;
	private notifications: NotificationManager;
	private registrar: CommandRegistrar;
	private noteQueue: NoteOperationQueue;
	private aiClient: AIClient;
	private store: TidyStore;

	constructor(deps: ModuleDeps) {
		this.plugin = deps.plugin;
		this.getSettings = deps.getSettings;
		this.notifications = deps.notifications;
		this.registrar = deps.registrar;
		this.noteQueue = deps.noteQueue;
		this.aiClient = new AIClient(deps.getSettings);
		this.store = new TidyStore(deps.plugin.app, deps.getSettings);
	}

	async onload(): Promise<void> {
		await this.store.init();

		this.registrar.register('tidy-current-note', this.getSettings().tidy.enabled, {
			editorCallback: async (_editor, ctx) => {
				if (!ctx.file) return;
				// Path exclusion (#307): explicit single-note command → Notice
				// naming the rule. The batch loop in scanVault skips silently.
				const rule = findMatchingRule(ctx.file.path, 'tidy', this.getSettings());
				if (rule) {
					this.notifications.info(
						`Skipped — "${ctx.file.path}" is excluded by rule "${rule.pattern}"`
					);
					return;
				}
				await this.tidy(ctx.file);
			},
		});

		this.registrar.register('undo-tidy', this.getSettings().tidy.enabled, {
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.undoTidy(ctx.file);
				}
			},
		});
	}

	onunload(): void {}

	async scanVault(folderPath?: string, skipConfirmation = false, onlyFile?: TFile): Promise<number> {
		let allFiles = getMarkdownFiles(this.plugin.app, folderPath);
		// Per-file scoping (#111): narrow to the single requested note.
		if (onlyFile) allFiles = allFiles.filter(f => f.path === onlyFile.path);

		if (allFiles.length === 0) {
			return 0;
		}

		if (!skipConfirmation) {
			const proceed = await this.notifications.confirm(
				`Found ${allFiles.length} note${allFiles.length === 1 ? '' : 's'} to tidy. Proceed?`,
				{ proceedLabel: 'Tidy', cancelLabel: 'Cancel' }
			);
			if (!proceed) {
				this.notifications.info('Tidy scan skipped');
				return 0;
			}
		}

		const op = this.notifications.startOperation(
			'Tidying notes',
			'tidy-vault'
		);

		let tidied = 0;
		const cacheUses: CacheUse[] = [];
		for (let i = 0; i < allFiles.length; i++) {
			if (op.cancelled) break;
			op.progress(i + 1, allFiles.length, 'Tidying notes');

			// Path exclusion (#307): batch scan → silently skip excluded notes.
			if (isPathExcluded(allFiles[i].path, 'tidy', this.getSettings())) continue;

			try {
				await this.tidy(allFiles[i], cacheUses);
				tidied++;
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				console.warn(`[Synapse] Failed to tidy ${allFiles[i].path}: ${msg}`);
			}
		}

		if (!op.cancelled) {
			op.finish(withCacheReport(`Tidied ${tidied} note${tidied === 1 ? '' : 's'}`, cacheUses));
		}

		return tidied;
	}

	/** A `batchUses` collector moves cache reporting to the caller's aggregated finish line (#527). */
	async tidy(file: TFile, batchUses?: CacheUse[]): Promise<void> {
		const op = this.notifications.startOperation(
			`Tidying ${file.basename}`,
			`tidy-${file.path}`
		);
		await this.noteQueue.run(file.path, () => this.runTidy(file, op, batchUses), {
			onWait: () => op.update(`Waiting for another Synapse operation on ${file.basename}`),
		});
	}

	/** One note's tidy cycle, already holding that note's queue slot (#483). */
	private async runTidy(file: TFile, op: OperationHandle, batchUses?: CacheUse[]): Promise<void> {
		const use: CacheUse = {};
		try {
			const content = await this.plugin.app.vault.read(file);

			// Store snapshot for undo before any changes
			const snapshot: TidySnapshot = {
				id: generateId(),
				filePath: file.path,
				originalContent: content,
				createdAt: new Date().toISOString(),
			};
			await this.store.save(snapshot);

			// Separate frontmatter from body so the AI only sees the body
			const parsed = parseFrontmatter(content);

			if (!parsed.body.trim()) {
				op.finish('Nothing to tidy — note is empty');
				return;
			}

			op.update('Correcting spelling and formatting');
			const tidiedBody = await withRetry(
				() => this.aiClient.complete(parsed.body, SYSTEM_PROMPT, trackAiCache(use)),
				3,
				2000
			);

			// Sanitize AI output then strip any code fences the AI may have wrapped it in
			const sanitized = sanitizeAIResponse(tidiedBody);
			const cleaned = stripCodeFences(sanitized);

			// Reassemble with the note's current frontmatter, re-parsed from the
			// fresh content inside the atomic callback (the AI-cleaned body can't
			// be re-derived, but the frontmatter reattachment can).
			await this.plugin.app.vault.process(file, (data) => {
				const fm = parseFrontmatter(data).frontmatter;
				return fm ? serializeFrontmatter(fm, cleaned) : cleaned;
			});
			batchUses?.push(use);
			op.finish(batchUses ? 'Note tidied' : withCacheReport('Note tidied', [use]));
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Tidy failed — ${msg}`);
		}
	}

	private async undoTidy(file: TFile): Promise<void> {
		const snapshot = await this.store.load(file.path);

		if (!snapshot) {
			this.notifications.info('No tidy to undo for this note');
			return;
		}

		await this.noteQueue.run(file.path, async () => {
			await this.plugin.app.vault.process(file, () => snapshot.originalContent);
			await this.store.remove(file.path);
			this.notifications.success('Tidy undone');
		});
	}

}

// Settings section renderer (#243)
export { renderTidySettings } from './settings-section';
