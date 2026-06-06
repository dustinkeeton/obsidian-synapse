import { Plugin, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { CommandRegistrar } from '../commands';
import { AIClient, NotificationManager, getMarkdownFiles, parseFrontmatter, sanitizeAIResponse, stripCodeFences, serializeFrontmatter, withRetry, generateId } from '../shared';
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

export class TidyModule {
	private aiClient: AIClient;
	private store: TidyStore;

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
		private registrar: CommandRegistrar
	) {
		this.aiClient = new AIClient(getSettings);
		this.store = new TidyStore(plugin.app, getSettings);
	}

	async onload(): Promise<void> {
		await this.store.init();

		this.registrar.register('synapse:tidy-current-note', this.getSettings().tidy.enabled, {
			name: 'Tidy current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.tidy(ctx.file);
				}
			},
		});

		this.registrar.register('synapse:undo-tidy', this.getSettings().tidy.enabled, {
			name: 'Undo last tidy on current note',
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
		for (let i = 0; i < allFiles.length; i++) {
			if (op.cancelled) break;
			op.progress(i + 1, allFiles.length, 'Tidying notes');

			try {
				await this.tidy(allFiles[i]);
				tidied++;
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				console.warn(`[Synapse] Failed to tidy ${allFiles[i].path}: ${msg}`);
			}
		}

		if (!op.cancelled) {
			op.finish(`Tidied ${tidied} note${tidied === 1 ? '' : 's'}`);
		}

		return tidied;
	}

	async tidy(file: TFile): Promise<void> {
		const op = this.notifications.startOperation(
			`Tidying ${file.basename}`,
			`tidy-${file.path}`
		);

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
				() => this.aiClient.complete(parsed.body, SYSTEM_PROMPT),
				3,
				2000
			);

			// Sanitize AI output then strip any code fences the AI may have wrapped it in
			const sanitized = sanitizeAIResponse(tidiedBody);
			const cleaned = stripCodeFences(sanitized);

			// Reassemble with original frontmatter
			const finalContent = parsed.frontmatter
				? serializeFrontmatter(parsed.frontmatter, cleaned)
				: cleaned;

			await this.plugin.app.vault.modify(file, finalContent);
			op.finish('Note tidied');
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

		await this.plugin.app.vault.modify(file, snapshot.originalContent);
		await this.store.remove(file.path);
		this.notifications.success('Tidy undone');
	}

}
