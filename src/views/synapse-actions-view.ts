import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { CommandDefinition, FeatureKey } from '../commands';
import { FEATURE_ICONS } from '../commands';
import { actionsGroupClass } from './proposal-styles';

export const SYNAPSE_ACTIONS_VIEW_TYPE = 'synapse-actions';

/**
 * Sentence-case section headings per feature (brand: sentence case; REM is an
 * initialism so it stays uppercase). `main` is surfaced as "General".
 */
const FEATURE_LABELS: Record<FeatureKey, string> = {
	main: 'General',
	elaboration: 'Elaboration',
	enrichment: 'Enrichment',
	organize: 'Organize',
	'deep-dive': 'Deep dive',
	summarize: 'Summarize',
	tidy: 'Tidy',
	rem: 'REM',
	video: 'Video',
};

/**
 * Host-provided behavior. The view never touches `app`/workspace directly (keeps
 * it a pure renderer, like UnifiedProposalView) — main.ts wires these in.
 */
export interface SynapseActionsCallbacks {
	/** The palette commands to show, in registry order (from `listPaletteActions`). */
	getActions: () => CommandDefinition[];
	/**
	 * Invoke a command by its registry id (main.ts runs it via `executeCommandById`).
	 * May be async: per-note dispatch re-activates the editor and awaits a macrotask
	 * before running the command so it works on the first click (#352).
	 */
	runAction: (id: string) => void | Promise<void>;
	/** Whether a markdown note is currently active (gates `context: 'note'` buttons). */
	isNoteActive: () => boolean;
}

/**
 * "Synapse actions" sidebar: a touch-friendly panel of buttons for the active
 * palette commands, grouped by feature and derived entirely from the command
 * registry (no hand-maintained list). Gives mobile users every key function in
 * ≤2 taps (ribbon → button) without the command palette.
 *
 * Per-note actions (`context: 'note'`) are disabled when no note is active;
 * main.ts calls `refresh()` on `active-leaf-change` so they enable/disable live.
 */
export class SynapseActionsView extends ItemView {
	private callbacks: SynapseActionsCallbacks;

	constructor(leaf: WorkspaceLeaf, callbacks: SynapseActionsCallbacks) {
		super(leaf);
		this.callbacks = callbacks;
	}

	getViewType(): string {
		return SYNAPSE_ACTIONS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Synapse actions';
	}

	getIcon(): string {
		// Bespoke launcher mark (registered via addIcon in src/brand-icons.ts),
		// matching the "Synapse actions" ribbon that opens this view (#349).
		// Distinct from the 'synapse' S-Signal used by the proposal view.
		return 'synapse-actions';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Re-render — called by main.ts when the active note changes. */
	refresh(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-actions-view-root');

		const actions = this.callbacks.getActions();
		if (actions.length === 0) {
			contentEl.createEl('p', {
				text: 'No actions available — enable features in settings.',
				cls: 'synapse-actions-empty',
			});
			return;
		}

		const noteActive = this.callbacks.isNoteActive();

		for (const { feature, actions: groupActions } of groupByFeature(actions)) {
			const group = contentEl.createDiv({
				cls: `synapse-actions-group ${actionsGroupClass(feature)}`,
			});
			// One feature glyph per group, prefixed to the type heading and tinted
			// per feature via CSS -- actions in a group share the feature glyph, so
			// it isn't repeated on every button (#349 review). data-icon mirrors the
			// name so it stays assertable in tests (setIcon's <svg> is a mock no-op).
			const heading = group.createEl('div', { cls: 'synapse-actions-group-heading' });
			const iconName = FEATURE_ICONS[feature];
			const iconEl = heading.createSpan({ cls: 'synapse-actions-group-icon' });
			iconEl.setAttribute('data-icon', iconName);
			setIcon(iconEl, iconName);
			heading.createSpan({ text: FEATURE_LABELS[feature], cls: 'synapse-actions-group-label' });

			for (const action of groupActions) {
				const disabled = action.context === 'note' && !noteActive;
				const button = group.createEl('button', {
					text: action.name,
					cls: 'synapse-actions-button',
				});
				if (disabled) {
					// Real <button disabled> can't be clicked and matches `:disabled`
					// styling; we also skip wiring the handler so it can never fire.
					button.disabled = true;
					button.setAttribute('aria-disabled', 'true');
				} else {
					// `runAction` may be async (per-note dispatch yields a macrotask so
					// editor-gated commands run on the first click, #352). main.ts wraps
					// it in fireAndForget for rejection handling, so the returned promise
					// is intentionally not awaited here.
					button.addEventListener('click', () => {
						void this.callbacks.runAction(action.id);
					});
				}
			}
		}
	}
}

/** Group actions by feature, preserving first-seen (registry) order. */
function groupByFeature(
	actions: CommandDefinition[],
): { feature: FeatureKey; actions: CommandDefinition[] }[] {
	const order: { feature: FeatureKey; actions: CommandDefinition[] }[] = [];
	const index = new Map<FeatureKey, CommandDefinition[]>();
	for (const action of actions) {
		let bucket = index.get(action.feature);
		if (!bucket) {
			bucket = [];
			index.set(action.feature, bucket);
			order.push({ feature: action.feature, actions: bucket });
		}
		bucket.push(action);
	}
	return order;
}
