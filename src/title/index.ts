import { Plugin, TFile, normalizePath } from 'obsidian';
import { SynapseSettings } from '../settings';
import { AIClient, NotificationManager, generateId, readNote, isPathExcluded, reviewAction } from '../shared';
import { TitleProposalStore } from './title-store';
import { TitleSuggester } from './title-suggester';
import { isUntitled } from './title-detector';
import { TitleProposal } from './types';

export type { TitleProposal, TitleProposalTrigger, TitleProposalStatus } from './types';
export { isUntitled } from './title-detector';

export class TitleModule {
	private store: TitleProposalStore;
	private suggester: TitleSuggester;

	/** Optional callback to refresh the unified proposal view. Wired by main.ts. */
	onViewRefreshNeeded: (() => Promise<void>) | null = null;

	/** Optional callback to open the unified proposal view. Wired by main.ts (#340). */
	onOpenProposalView: (() => void) | null = null;

	/**
	 * Live accessor for the title auto-accept flag (#228). Wired by main.ts to
	 * `() => this.settings.autoAccept.title`. Defaults to "never auto-accept".
	 * NOTE: title auto-accept RENAMES the file on the filesystem.
	 */
	private shouldAutoAccept: () => boolean = () => false;

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
		shouldAutoAccept?: () => boolean
	) {
		const aiClient = new AIClient(getSettings);
		this.store = new TitleProposalStore(plugin.app, getSettings);
		this.suggester = new TitleSuggester(aiClient);
		if (shouldAutoAccept) this.shouldAutoAccept = shouldAutoAccept;
	}

	/**
	 * Auto-accept a freshly generated title proposal (#228), if the title
	 * auto-accept flag is on. This RENAMES the file. A single Notice fires
	 * (title proposals are generated one-at-a-time, never in a tight batch).
	 *
	 * Returns `true` when auto-accept was applied, so callers can suppress the
	 * "Title proposal ready" Review toast for proposals that were consumed (#340).
	 */
	private async maybeAutoAccept(proposal: TitleProposal): Promise<boolean> {
		if (!this.shouldAutoAccept()) return false;
		await this.acceptProposal(proposal.id, { silent: true });
		this.notifications.info(
			`Auto-accepted title "${proposal.proposedTitle}"`
		);
		return true;
	}

	async onload(): Promise<void> {
		await this.store.init();
	}

	onunload(): void {
		// No timers or resources to clean up
	}

	/** Get all pending title proposals (called by main.ts for the unified view). */
	async getPendingProposals(): Promise<TitleProposal[]> {
		return this.store.loadPending();
	}

	/**
	 * Check if a note has an "Untitled" name and generate a title proposal.
	 * Called after any Synapse operation completes on a note.
	 *
	 * `options.postOp` marks an automatic post-op invocation (the chained
	 * `checkTitle` after a primary action), which suppresses the secondary
	 * "Title proposal ready" Review toast entirely (#366). The proposal still
	 * lands in the unified view for review at the user's leisure.
	 */
	async checkUntitled(filePath: string, options?: { postOp?: boolean }): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		if (!isUntitled(file.basename)) return;

		// Skip if there's already a pending title proposal for this note
		const existing = await this.store.loadForNote(filePath);
		if (existing.some(p => p.status === 'pending')) return;

		const content = await readNote(this.plugin.app, filePath);
		if (!content || content.trim().length === 0) return;

		try {
			const { title, reasoning } = await this.suggester.suggestTitle(content, file.basename);
			if (!title || isUntitled(title)) return;

			const proposal: TitleProposal = {
				id: generateId(),
				sourceNotePath: filePath,
				currentTitle: file.basename,
				proposedTitle: title,
				trigger: 'untitled',
				reasoning,
				createdAt: new Date().toISOString(),
				status: 'pending',
			};

			await this.store.save(proposal);
			const autoAccepted = await this.maybeAutoAccept(proposal);
			// Title's check is otherwise silent: the success toast exists ONLY to
			// carry the Review button, so emit it only when the centralized gate
			// yields an action — never for an auto-accepted (already-applied)
			// proposal, and never as an automatic post-op side effect (#366).
			if (!autoAccepted) {
				const action = reviewAction({
					generated: true,
					shouldAutoAccept: this.shouldAutoAccept,
					openProposalView: this.onOpenProposalView,
					postOp: options?.postOp,
				});
				if (action) {
					this.notifications.success('Title proposal ready', undefined, action);
				}
			}
			await this.refreshView();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.warn(`[Synapse] Title suggestion failed for ${filePath}: ${msg}`);
		}
	}

	/**
	 * Check if a note's title still matches its content after modification.
	 * Called after content-modifying operations (elaboration accept, transcription, etc.)
	 *
	 * `options.postOp` (see {@link checkUntitled}) suppresses the secondary
	 * Review toast for automatic post-op invocations (#366).
	 */
	async checkMismatch(filePath: string, options?: { postOp?: boolean }): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		// Don't check mismatch if the note is already untitled (handled by checkUntitled)
		if (isUntitled(file.basename)) return;

		// Skip if there's already a pending title proposal for this note
		const existing = await this.store.loadForNote(filePath);
		if (existing.some(p => p.status === 'pending')) return;

		const content = await readNote(this.plugin.app, filePath);
		if (!content || content.trim().length === 0) return;

		try {
			const result = await this.suggester.checkTitleMismatch(content, file.basename);
			if (!result.isMismatch || !result.suggestedTitle) return;

			const proposal: TitleProposal = {
				id: generateId(),
				sourceNotePath: filePath,
				currentTitle: file.basename,
				proposedTitle: result.suggestedTitle,
				trigger: 'content-mismatch',
				reasoning: result.reasoning || 'Title does not reflect current content',
				createdAt: new Date().toISOString(),
				status: 'pending',
			};

			await this.store.save(proposal);
			const autoAccepted = await this.maybeAutoAccept(proposal);
			// As in checkUntitled: surface the Review toast only when the gate
			// yields an action — not for an auto-accepted proposal, and not as an
			// automatic post-op side effect (#366).
			if (!autoAccepted) {
				const action = reviewAction({
					generated: true,
					shouldAutoAccept: this.shouldAutoAccept,
					openProposalView: this.onOpenProposalView,
					postOp: options?.postOp,
				});
				if (action) {
					this.notifications.success('Title proposal ready', undefined, action);
				}
			}
			await this.refreshView();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.warn(`[Synapse] Title mismatch check failed for ${filePath}: ${msg}`);
		}
	}

	/**
	 * Run both untitled detection and mismatch detection on a note.
	 * Convenience method for post-operation hooks.
	 *
	 * In production this is ALWAYS a chained post-op side effect (main.ts wires
	 * it after primary actions; the title module registers no direct command),
	 * so callers pass `{ postOp: true }` to suppress the secondary Review toast
	 * (#366). The flag is threaded through to checkUntitled/checkMismatch.
	 */
	async checkTitle(filePath: string, options?: { postOp?: boolean }): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		// Path exclusion (#307). checkTitle is a silent post-op callback (no user
		// command), so skip quietly when the note is excluded from `title`.
		if (isPathExcluded(file.path, 'title', this.getSettings())) return;

		if (isUntitled(file.basename)) {
			await this.checkUntitled(filePath, options);
		} else {
			await this.checkMismatch(filePath, options);
		}
	}

	/**
	 * Accept a title proposal: rename the file via vault.rename().
	 *
	 * `options.silent` suppresses the success Notice and view refresh; used by
	 * auto-accept, which emits its own distinct Notice. Error and conflict
	 * Notices still fire.
	 */
	async acceptProposal(id: string, options?: { silent?: boolean }): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;
		// Guard against double-acceptance (cascade safety): never rename twice.
		if (proposal.status !== 'pending') return;

		const file = this.plugin.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!(file instanceof TFile)) {
			this.notifications.info('Source note no longer exists');
			await this.store.updateStatus(id, 'rejected');
			await this.refreshView();
			return;
		}

		const parentPath = file.parent?.path || '';
		const newFileName = `${proposal.proposedTitle}.md`;
		const newPath = parentPath
			? normalizePath(`${parentPath}/${newFileName}`)
			: normalizePath(newFileName);

		// Check if a file already exists at the target path
		const existingFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
		if (existingFile) {
			this.notifications.info(`Cannot rename -- a file already exists at ${newPath}`);
			return;
		}

		try {
			await this.plugin.app.vault.rename(file, newPath);
			await this.store.updateStatus(id, 'accepted');
			if (!options?.silent) {
				this.notifications.success(`Renamed to "${proposal.proposedTitle}"`);
				await this.refreshView();
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.notifications.notifyError('Failed to rename note', error);
			throw new Error(`Rename failed: ${msg}`);
		}
	}

	async rejectProposal(id: string): Promise<void> {
		await this.store.updateStatus(id, 'rejected');
		this.notifications.info('Title proposal rejected');
		await this.refreshView();
	}

	private async refreshView(): Promise<void> {
		await this.onViewRefreshNeeded?.();
	}
}
