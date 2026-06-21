import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEl } from '../__mocks__/obsidian';
import { SynapseActionsView, SynapseActionsCallbacks } from './synapse-actions-view';
import type { CommandDefinition } from '../commands';
import { dispatchSidebarCommand, type CommandDispatchHost, type ActivatableLeaf } from '../commands';

// --- Helpers ----------------------------------------------------------------

/** Stub WorkspaceLeaf that satisfies the ItemView constructor. */
function mockLeaf(): any {
	return { view: {} };
}

/**
 * A small, representative action set spanning two features and all contexts.
 * `review-proposals` carries the same explicit `icon` override the real registry
 * gives it (used for the command palette; the sidebar shows the per-feature glyph
 * on the group heading, not per action).
 */
function sampleActions(): CommandDefinition[] {
	return [
		{ id: 'review-proposals', name: 'Open proposal review sidebar', feature: 'main', status: 'active', flows: ['palette'], context: 'global', icon: 'synapse' },
		{ id: 'enrich-current-note', name: 'Enrich current note', feature: 'enrichment', status: 'active', flows: ['palette'], context: 'note' },
		{ id: 'scan-vault-enrichment', name: 'Scan vault for enrichment', feature: 'enrichment', status: 'active', flows: ['palette', 'fire-synapse'], context: 'vault' },
	];
}

function makeView(overrides: Partial<SynapseActionsCallbacks> = {}) {
	const callbacks: SynapseActionsCallbacks = {
		getActions: () => sampleActions(),
		runAction: vi.fn(),
		isNoteActive: () => true,
		...overrides,
	};
	const view = new SynapseActionsView(mockLeaf(), callbacks);
	// Mock ItemView.contentEl is a bare no-op stub; swap in the tracking stub el.
	const contentEl = createEl();
	(view as unknown as { contentEl: any }).contentEl = contentEl;
	return { view, callbacks, contentEl };
}

/** Recursively collect all <button> descendants of a stub element. */
function buttons(el: any): any[] {
	const out: any[] = [];
	const walk = (node: any) => {
		for (const child of node.children ?? []) {
			if (child.tagName === 'BUTTON') out.push(child);
			walk(child);
		}
	};
	walk(el);
	return out;
}

/** Find the action <button> whose text reads `label`. */
function findButton(el: any, label: string): any {
	return buttons(el).find((b) => b.textContent === label);
}

/** Recursively collect text of all descendants carrying `cls`. */
function textsByClass(el: any, cls: string): string[] {
	const out: string[] = [];
	const walk = (node: any) => {
		for (const child of node.children ?? []) {
			if (child.classList?.contains?.(cls)) out.push(child.textContent);
			walk(child);
		}
	};
	walk(el);
	return out;
}

/** The resolved glyph names stamped on each group heading icon (`data-icon`), in order. */
function groupIcons(el: any): (string | null)[] {
	const out: (string | null)[] = [];
	const walk = (node: any) => {
		for (const child of node.children ?? []) {
			if (child.classList?.contains?.('synapse-actions-group-icon')) out.push(child.getAttribute('data-icon'));
			walk(child);
		}
	};
	walk(el);
	return out;
}

// --- Tests ------------------------------------------------------------------

describe('SynapseActionsView', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders one button per action with its registry name', async () => {
		const { view, contentEl } = makeView();
		await view.onOpen();
		const labels = buttons(contentEl).map((b) => b.textContent);
		expect(labels).toEqual([
			'Open proposal review sidebar',
			'Enrich current note',
			'Scan vault for enrichment',
		]);
	});

	it('prefixes each group heading with its per-feature glyph (one per type, not per action)', async () => {
		const { view, contentEl } = makeView();
		await view.onOpen();
		// Headings carry the feature default glyph (FEATURE_ICONS[feature]); the
		// per-action `icon` override is for the palette, not the sidebar.
		expect(groupIcons(contentEl)).toEqual(['synapse-main', 'synapse-enrichment']);
	});

	it('groups actions under sentence-case feature headings in registry order', async () => {
		const { view, contentEl } = makeView();
		await view.onOpen();
		expect(textsByClass(contentEl, 'synapse-actions-group-label')).toEqual([
			'General',
			'Enrichment',
		]);
	});

	it('disables note-context buttons when no note is active and never wires their click', async () => {
		const runAction = vi.fn();
		const { view, contentEl } = makeView({ isNoteActive: () => false, runAction });
		await view.onOpen();

		const noteButton = findButton(contentEl, 'Enrich current note');
		expect(noteButton.disabled).toBe(true);
		// A disabled button has no handler, so dispatching a click is a no-op.
		noteButton.dispatchEvent({ type: 'click' });
		expect(runAction).not.toHaveBeenCalled();
	});

	it('keeps vault/global buttons enabled even when no note is active', async () => {
		const runAction = vi.fn();
		const { view, contentEl } = makeView({ isNoteActive: () => false, runAction });
		await view.onOpen();

		const vaultButton = findButton(contentEl, 'Scan vault for enrichment');
		expect(vaultButton.disabled).toBeFalsy();
		vaultButton.dispatchEvent({ type: 'click' });
		expect(runAction).toHaveBeenCalledWith('scan-vault-enrichment');
	});

	it('invokes runAction with the command id when an enabled button is clicked', async () => {
		const runAction = vi.fn();
		const { view, contentEl } = makeView({ isNoteActive: () => true, runAction });
		await view.onOpen();

		findButton(contentEl, 'Enrich current note').dispatchEvent({ type: 'click' });
		expect(runAction).toHaveBeenCalledWith('enrich-current-note');
	});

	it('refresh() re-renders so per-note buttons enable when a note becomes active', async () => {
		let noteActive = false;
		const { view, contentEl } = makeView({ isNoteActive: () => noteActive });
		await view.onOpen();
		expect(findButton(contentEl, 'Enrich current note').disabled).toBe(true);

		noteActive = true;
		view.refresh();
		expect(findButton(contentEl, 'Enrich current note').disabled).toBeFalsy();
	});

	it('shows an empty-state message and no buttons when nothing is registered', async () => {
		const { view, contentEl } = makeView({ getActions: () => [] });
		await view.onOpen();
		expect(buttons(contentEl)).toHaveLength(0);
		expect(textsByClass(contentEl, 'synapse-actions-empty')).toEqual([
			'No actions available — enable features in settings.',
		]);
	});

	// --- #352 regression: per-note actions must run on the FIRST click ----------
	//
	// Wires the REAL command-dispatch (`dispatchSidebarCommand`, the same path
	// main.ts uses) as the button's `runAction`, so a single click exercises the
	// exact end-to-end sequence. Against the OLD synchronous code, the command
	// dispatched in the same tick as the leaf re-activation — before the editor
	// became active — so it no-op'd until a 2nd click. This asserts the fixed
	// ordering: re-activate the editor, let a macrotask elapse, THEN dispatch.
	describe('first-click dispatch (#352 regression)', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		/** Spy dispatch host that records call order, mirroring main.ts's host. */
		function makeDispatchHost(): CommandDispatchHost & { calls: string[] } {
			const calls: string[] = [];
			return {
				calls,
				setActiveLeaf: vi.fn((_leaf: ActivatableLeaf, _o: { focus: boolean }) => {
					calls.push('setActiveLeaf');
				}),
				executeCommandById: vi.fn((_fullId: string) => {
					calls.push('executeCommandById');
					return true;
				}),
			};
		}

		it('re-establishes editor context before dispatching on a single first click', async () => {
			const host = makeDispatchHost();
			const noteLeaf: ActivatableLeaf = { view: {} };
			// The view's runAction is the production dispatch, exactly as main.ts wires it.
			const runAction = vi.fn(async (id: string): Promise<void> => {
				await dispatchSidebarCommand(host, id, `synapse:${id}`, noteLeaf);
			});
			const { view, contentEl } = makeView({ isNoteActive: () => true, runAction });
			await view.onOpen();

			// ONE click on a `context: 'note'` action.
			findButton(contentEl, 'Enrich current note').dispatchEvent({ type: 'click' });
			expect(runAction).toHaveBeenCalledTimes(1);

			// Synchronously: the editor was re-activated, but the command has NOT yet
			// dispatched — it's deferred a macrotask so the editor is active first.
			// (The old code dispatched here, in the same tick, hence the 2nd-click bug.)
			expect(host.setActiveLeaf).toHaveBeenCalledWith(noteLeaf, { focus: true });
			expect(host.executeCommandById).not.toHaveBeenCalled();

			// Let the macrotask elapse — the command now dispatches, on the FIRST click.
			await vi.runAllTimersAsync();
			expect(host.executeCommandById).toHaveBeenCalledTimes(1);
			expect(host.executeCommandById).toHaveBeenCalledWith('synapse:enrich-current-note');
			expect(host.calls).toEqual(['setActiveLeaf', 'executeCommandById']);
		});

		it('does not re-render the panel as a side effect of a click', async () => {
			const host = makeDispatchHost();
			const noteLeaf: ActivatableLeaf = { view: {} };
			const runAction = async (id: string): Promise<void> => {
				await dispatchSidebarCommand(host, id, `synapse:${id}`, noteLeaf);
			};
			const { view, contentEl } = makeView({ isNoteActive: () => true, runAction });
			await view.onOpen();

			// Spy on the panel's own re-render. A click must not trigger it (the
			// self-induced active-leaf-change refresh is suppressed during dispatch).
			const refreshSpy = vi.spyOn(view, 'refresh');
			findButton(contentEl, 'Enrich current note').dispatchEvent({ type: 'click' });
			await vi.runAllTimersAsync();

			expect(refreshSpy).not.toHaveBeenCalled();
		});

		it('runs a non-note action on the first click without re-activating any leaf', async () => {
			const host = makeDispatchHost();
			const noteLeaf: ActivatableLeaf = { view: {} };
			const runAction = async (id: string): Promise<void> => {
				await dispatchSidebarCommand(host, id, `synapse:${id}`, noteLeaf);
			};
			const { view, contentEl } = makeView({ isNoteActive: () => true, runAction });
			await view.onOpen();

			findButton(contentEl, 'Open proposal review sidebar').dispatchEvent({ type: 'click' });
			await vi.runAllTimersAsync();

			expect(host.setActiveLeaf).not.toHaveBeenCalled();
			expect(host.executeCommandById).toHaveBeenCalledWith('synapse:review-proposals');
		});
	});
});
