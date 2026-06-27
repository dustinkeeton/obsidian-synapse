import { Plugin, TFile, normalizePath } from 'obsidian';
import { SynapseSettings } from '../settings';
import {
	AIClient, NotificationManager, generateId, readNote, isPathExcluded, reviewAction,
	findAvailableVaultPath, parseFrontmatter, serializeFrontmatter, mergeTags, normalizeFrontmatterTags,
} from '../shared';
import { TitleProposalStore } from './title-store';
import { TitleSuggester } from './title-suggester';
import { isUntitled } from './title-detector';
import { titleContentKey } from './content-key';
import { TitleProposal, TitleDuplicateStrategy } from './types';

export type { TitleProposal, TitleProposalTrigger, TitleProposalStatus, TitleDuplicateStrategy } from './types';
export { isUntitled } from './title-detector';

/**
 * What {@link TitleModule.acceptProposal} did, so auto-accept can announce the
 * REAL outcome — the suffixed name for `iterate`, or "merged into …" for
 * `merge` — instead of always echoing the originally proposed title (#408).
 * `conflict` means a plain accept hit a live collision and surfaced the choice
 * without changing anything; `skipped` means nothing was eligible.
 */
export type TitleAcceptOutcome =
	| { status: 'renamed'; path: string }
	| { status: 'merged'; into: string }
	| { status: 'conflict'; target: string }
	| { status: 'skipped' };

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
	 * Returns `true` when auto-accept was applied. Review-toast suppression is no
	 * longer driven by this return — the centralized `reviewAction()` gate keys off
	 * the same `shouldAutoAccept()` signal, so an auto-accepted proposal yields no
	 * action and therefore no toast (#340, #366, #402).
	 */
	private async maybeAutoAccept(proposal: TitleProposal): Promise<boolean> {
		if (!this.shouldAutoAccept()) return false;
		// acceptProposal derives the resolution from the duplicateHandling setting
		// on a live collision, so a colliding title is resolved automatically. The
		// notice reflects the ACTUAL outcome (suffixed name / merge target), not
		// the originally proposed title (#408).
		const outcome = await this.acceptProposal(proposal.id, { silent: true });
		if (outcome.status === 'renamed') {
			this.notifications.info(`Auto-accepted title "${this.baseName(outcome.path)}"`);
		} else if (outcome.status === 'merged') {
			this.notifications.info(`Auto-merged into "${this.baseName(outcome.into)}"`);
		}
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

		// Read content BEFORE the guards: the dedup key is computed from it (#408).
		const content = await readNote(this.plugin.app, filePath);
		if (!content || content.trim().length === 0) return;

		const key = titleContentKey(filePath, content, file.basename, 'untitled', this.getSettings());
		const existing = await this.store.loadForNote(filePath);
		// Skip if there's already a pending title proposal for this note.
		if (existing.some(p => p.status === 'pending')) return;
		// Dedup (#408): don't re-propose the SAME title for UNCHANGED content after
		// a reject. The key is over inputs, so a content edit changes it and a new
		// proposal is allowed; an 'accepted' proposal never blocks (the file moved).
		if (existing.some(p => p.contentKey === key && p.status !== 'accepted')) return;

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
				contentKey: key,
			};

			// Flag a same-folder name collision at proposal time as a UI hint; it is
			// always re-validated live at accept time (#408).
			const targetPath = this.computeTargetPath(file, title);
			const existingAtTarget = this.plugin.app.vault.getAbstractFileByPath(targetPath);
			if (existingAtTarget && existingAtTarget.path !== file.path) {
				proposal.conflictsWith = targetPath;
			}

			await this.store.save(proposal);
			// maybeAutoAccept applies + announces the rename when auto-accept is on.
			await this.maybeAutoAccept(proposal);
			// Title's check is otherwise silent: the success toast exists ONLY to
			// carry the Review button. Gate it through the centralized helper (like
			// every other module) — it yields an action only when a proposal was
			// generated, auto-accept is off, and this isn't an automatic post-op
			// side effect (#366), so an auto-accepted proposal emits no toast.
			const action = reviewAction({
				generated: true,
				shouldAutoAccept: this.shouldAutoAccept,
				openProposalView: this.onOpenProposalView,
				postOp: options?.postOp,
			});
			if (action) {
				this.notifications.success('Title proposal ready', undefined, action);
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

		// Read content BEFORE the guards: the dedup key is computed from it (#408).
		const content = await readNote(this.plugin.app, filePath);
		if (!content || content.trim().length === 0) return;

		const key = titleContentKey(filePath, content, file.basename, 'content-mismatch', this.getSettings());
		const existing = await this.store.loadForNote(filePath);
		// Skip if there's already a pending title proposal for this note.
		if (existing.some(p => p.status === 'pending')) return;
		// Dedup (#408): a rejected colliding title is not re-proposed for unchanged
		// content; editing the note changes the key and re-enables proposals.
		if (existing.some(p => p.contentKey === key && p.status !== 'accepted')) return;

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
				contentKey: key,
			};

			// Flag a same-folder name collision at proposal time as a UI hint; it is
			// always re-validated live at accept time (#408).
			const targetPath = this.computeTargetPath(file, result.suggestedTitle);
			const existingAtTarget = this.plugin.app.vault.getAbstractFileByPath(targetPath);
			if (existingAtTarget && existingAtTarget.path !== file.path) {
				proposal.conflictsWith = targetPath;
			}

			await this.store.save(proposal);
			// maybeAutoAccept applies + announces the rename when auto-accept is on.
			await this.maybeAutoAccept(proposal);
			// As in checkUntitled: gate the Review toast through the centralized
			// helper — it yields an action only for a generated proposal when
			// auto-accept is off and this isn't an automatic post-op side effect (#366).
			const action = reviewAction({
				generated: true,
				shouldAutoAccept: this.shouldAutoAccept,
				openProposalView: this.onOpenProposalView,
				postOp: options?.postOp,
			});
			if (action) {
				this.notifications.success('Title proposal ready', undefined, action);
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
	 * The vault path a proposal would rename its note to: `<parent>/<title>.md`.
	 * Shared by proposal-time collision flagging and accept-time re-validation so
	 * both compute the target identically (#408).
	 */
	private computeTargetPath(file: TFile, proposedTitle: string): string {
		const parentPath = file.parent?.path || '';
		const fileName = `${proposedTitle}.md`;
		return parentPath
			? normalizePath(`${parentPath}/${fileName}`)
			: normalizePath(fileName);
	}

	/** Basename without the `.md` extension, for user-facing notices. */
	private baseName(path: string): string {
		return path.split('/').pop()?.replace(/\.md$/, '') ?? path;
	}

	/** Emit the success notice + refresh, unless the caller is silent (auto-accept). */
	private async announceAccept(silent: boolean | undefined, message: string): Promise<void> {
		if (silent) return;
		this.notifications.success(message);
		await this.refreshView();
	}

	/**
	 * Accept a title proposal, re-validating any name collision LIVE (a stale
	 * `conflictsWith` is ignored) (#408).
	 *
	 * - No collision → plain rename to the proposed path (happy path).
	 * - Collision + no resolution (a plain manual Accept) → NEVER overwrite:
	 *   persist the conflict hint and surface "Add suffix or Merge", leaving the
	 *   proposal pending.
	 * - Collision + `iterate` → rename to the next free `-1`/`-2` path.
	 * - Collision + `merge` → fold this note into the existing one and trash it.
	 *
	 * Auto-accept passes `silent: true` and lets the resolution default to
	 * `settings.title.duplicateHandling`. Returns a {@link TitleAcceptOutcome} so
	 * auto-accept can announce the real result.
	 */
	async acceptProposal(
		id: string,
		options?: { silent?: boolean; resolution?: TitleDuplicateStrategy }
	): Promise<TitleAcceptOutcome> {
		const proposal = await this.store.load(id);
		if (!proposal) return { status: 'skipped' };
		// Guard against double-acceptance (cascade safety): never rename twice.
		if (proposal.status !== 'pending') return { status: 'skipped' };

		const file = this.plugin.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!(file instanceof TFile)) {
			this.notifications.info('Source note no longer exists');
			await this.store.updateStatus(id, 'rejected');
			await this.refreshView();
			return { status: 'skipped' };
		}

		const targetPath = this.computeTargetPath(file, proposal.proposedTitle);
		const existing = this.plugin.app.vault.getAbstractFileByPath(targetPath);
		const collision = !!existing && existing.path !== file.path;

		try {
			if (!collision) {
				// Happy path: target is free (or the collision vanished since the
				// proposal was created) — plain rename, no suffix.
				await this.plugin.app.vault.rename(file, targetPath);
				await this.store.updateStatus(id, 'accepted');
				await this.announceAccept(options?.silent, `Renamed to "${this.baseName(targetPath)}"`);
				return { status: 'renamed', path: targetPath };
			}

			// Live collision. Manual plain Accept supplies no resolution and must
			// never overwrite; auto-accept derives one from the setting.
			const resolution = options?.resolution
				?? (this.shouldAutoAccept() ? this.getSettings().title.duplicateHandling : undefined);

			if (!resolution) {
				// Surface the choice; leave the proposal pending. Persist the live
				// target as the UI hint so the card shows the suffix/merge buttons.
				proposal.conflictsWith = targetPath;
				await this.store.save(proposal);
				this.notifications.info(
					`"${proposal.proposedTitle}" already exists — choose Add suffix or Merge`
				);
				await this.refreshView();
				return { status: 'conflict', target: targetPath };
			}

			if (resolution === 'merge') {
				if (existing instanceof TFile) {
					await this.mergeNotes(file, existing);
					await this.store.updateStatus(id, 'accepted');
					await this.announceAccept(options?.silent, `Merged into "${this.baseName(existing.path)}"`);
					return { status: 'merged', into: existing.path };
				}
				// Nothing mergeable at the target (e.g. a folder) — fall back to a
				// plain rename so the accept still resolves, with a heads-up.
				this.notifications.info('Nothing to merge into — renamed instead');
				await this.plugin.app.vault.rename(file, targetPath);
				await this.store.updateStatus(id, 'accepted');
				if (!options?.silent) await this.refreshView();
				return { status: 'renamed', path: targetPath };
			}

			// resolution === 'iterate': suffix before the extension so the existing
			// note is never clobbered.
			const freePath = findAvailableVaultPath(this.plugin.app, targetPath);
			await this.plugin.app.vault.rename(file, freePath);
			await this.store.updateStatus(id, 'accepted');
			await this.announceAccept(options?.silent, `Renamed to "${this.baseName(freePath)}"`);
			return { status: 'renamed', path: freePath };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.notifications.notifyError('Failed to rename note', error);
			throw new Error(`Rename failed: ${msg}`);
		}
	}

	/**
	 * Merge `source` into `target` (#408): full frontmatter union (target wins on
	 * scalar conflicts; tags/aliases unioned), bodies joined by a horizontal rule
	 * (`target` first), then trash the source (recoverable). The target is
	 * rewritten atomically via `vault.process`.
	 */
	private async mergeNotes(source: TFile, target: TFile): Promise<void> {
		const sourceContent = await this.plugin.app.vault.read(source);
		await this.plugin.app.vault.process(target, (current) => {
			const t = parseFrontmatter(current);
			const s = parseFrontmatter(sourceContent);
			// Target wins on scalar conflicts.
			const merged: Record<string, unknown> = { ...s.frontmatter, ...t.frontmatter };
			// Union tags (mergeTags reads merged.tags, then adds the source's).
			mergeTags(merged, normalizeFrontmatterTags(s.frontmatter.tags));
			// Union aliases, target order first; only set when non-empty.
			const aliases = [...new Set([
				...normalizeFrontmatterTags(t.frontmatter.aliases),
				...normalizeFrontmatterTags(s.frontmatter.aliases),
			])];
			if (aliases.length > 0) merged.aliases = aliases;
			const body = `${t.body.trimEnd()}\n\n---\n\n${s.body.trim()}\n`;
			return serializeFrontmatter(merged, body);
		});
		await this.plugin.app.fileManager.trashFile(source);
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

// Settings section renderer (#408)
export { renderTitleSettings } from './settings-section';
