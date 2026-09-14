import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEl, type StubEl } from '../__mocks__/obsidian';
import { SynapseActionsView, SynapseActionsCallbacks } from './synapse-actions-view';
import type { WorkspaceLeaf } from 'obsidian';
import type { CommandDefinition } from '../commands';
import { dispatchSidebarCommand, type CommandDispatchHost, type NoteEditorContext } from '../commands';

/** A `<button>` stub: the view stamps `.disabled` on real button elements. */
type StubButton = StubEl & { disabled?: boolean };

// --- Helpers ----------------------------------------------------------------

/** Stub WorkspaceLeaf that satisfies the ItemView constructor. */
function mockLeaf(): WorkspaceLeaf {
	return { view: {} } as unknown as WorkspaceLeaf;
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
		{ id: 'scan-vault-enrichment', name: 'Scan folder for enrichment', feature: 'enrichment', status: 'active', flows: ['palette', 'fire-synapse'], context: 'vault' },
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
	(view as unknown as { contentEl: StubEl }).contentEl = contentEl;
	return { view, callbacks, contentEl };
}

/** Recursively collect all <button> descendants of a stub element. */
function buttons(el: StubEl): StubButton[] {
	const out: StubButton[] = [];
	const walk = (node: StubEl) => {
		for (const child of node.children as unknown as StubEl[]) {
			if (child.tagName === 'BUTTON') out.push(child);
			walk(child);
		}
	};
	walk(el);
	return out;
}

/** Find the action <button> whose text reads `label`. */
function findButton(el: StubEl, label: string): StubButton | undefined {
	return buttons(el).find((b) => b.textContent === label);
}

/** Recursively collect text of all descendants carrying `cls`. */
function textsByClass(el: StubEl, cls: string): (string | null)[] {
	const out: (string | null)[] = [];
	const walk = (node: StubEl) => {
		for (const child of node.children as unknown as StubEl[]) {
			if (child.classList.contains(cls)) out.push(child.textContent);
			walk(child);
		}
	};
	walk(el);
	return out;
}

/** The resolved glyph names stamped on each group heading icon (`data-icon`), in order. */
function groupIcons(el: StubEl): (string | null)[] {
	const out: (string | null)[] = [];
	const walk = (node: StubEl) => {
		for (const child of node.children as unknown as StubEl[]) {
			if (child.classList.contains('synapse-actions-group-icon')) out.push(child.getAttribute('data-icon'));
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
			'Scan folder for enrichment',
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
		expect(noteButton!.disabled).toBe(true);
		// A disabled button has no handler, so dispatching a click is a no-op.
		noteButton!.dispatchEvent({ type: 'click' });
		expect(runAction).not.toHaveBeenCalled();
	});

	it('keeps vault/global buttons enabled even when no note is active', async () => {
		const runAction = vi.fn();
		const { view, contentEl } = makeView({ isNoteActive: () => false, runAction });
		await view.onOpen();

		const vaultButton = findButton(contentEl, 'Scan folder for enrichment');
		expect(vaultButton!.disabled).toBeFalsy();
		vaultButton!.dispatchEvent({ type: 'click' });
		expect(runAction).toHaveBeenCalledWith('scan-vault-enrichment');
	});

	it('invokes runAction with the command id when an enabled button is clicked', async () => {
		const runAction = vi.fn();
		const { view, contentEl } = makeView({ isNoteActive: () => true, runAction });
		await view.onOpen();

		findButton(contentEl, 'Enrich current note')!.dispatchEvent({ type: 'click' });
		expect(runAction).toHaveBeenCalledWith('enrich-current-note');
	});

	it('refresh() re-renders so per-note buttons enable when a note becomes active', async () => {
		let noteActive = false;
		const { view, contentEl } = makeView({ isNoteActive: () => noteActive });
		await view.onOpen();
		expect(findButton(contentEl, 'Enrich current note')!.disabled).toBe(true);

		noteActive = true;
		view.refresh();
		expect(findButton(contentEl, 'Enrich current note')!.disabled).toBeFalsy();
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
	// end-to-end sequence. The OLD code routed note actions through Obsidian's
	// editor-gated `executeCommandById`; with the sidebar focused there's no active
	// editor, so it no-op'd until a 2nd click. The fix invokes the command's
	// `editorCallback` directly with the note's editor/view — so one click runs it.
	describe('first-click dispatch (#352 regression)', () => {
		type Handler = (editor: unknown, ctx: unknown) => unknown;

		/** Spy dispatch host: a registered note command + a gated-dispatch fallback. */
		function makeDispatchHost(
			editorCallback: Handler,
		): CommandDispatchHost & { executeCommandById: ReturnType<typeof vi.fn> } {
			const commands: Record<string, { editorCallback?: Handler }> = {
				'synapse:enrich-current-note': { editorCallback },
			};
			return {
				getCommand: (fullId: string) => commands[fullId],
				executeCommandById: vi.fn((_fullId: string) => true),
			};
		}

		const noteContext: NoteEditorContext = { editor: { id: 'editor' }, view: { id: 'view' } };

		it('runs a per-note action on a single first click (direct editorCallback, no gated dispatch)', async () => {
			const editorCallback = vi.fn();
			const host = makeDispatchHost(editorCallback);
			// The view's runAction is the production dispatch, exactly as main.ts wires it.
			const runAction = vi.fn(async (id: string): Promise<void> => {
				await dispatchSidebarCommand(host, id, `synapse:${id}`, noteContext);
			});
			const { view, contentEl } = makeView({ isNoteActive: () => true, runAction });
			await view.onOpen();

			// ONE click on a `context: 'note'` action runs its handler immediately...
			findButton(contentEl, 'Enrich current note').dispatchEvent({ type: 'click' });
			expect(runAction).toHaveBeenCalledTimes(1);
			await Promise.resolve();

			expect(editorCallback).toHaveBeenCalledTimes(1);
			expect(editorCallback).toHaveBeenCalledWith(noteContext.editor, noteContext.view);
			// ...without the editor-gated palette path that caused the 2nd-click bug.
			expect(host.executeCommandById).not.toHaveBeenCalled();
		});

		it('does not re-render the panel as a side effect of a click', async () => {
			const host = makeDispatchHost(vi.fn());
			const runAction = async (id: string): Promise<void> => {
				await dispatchSidebarCommand(host, id, `synapse:${id}`, noteContext);
			};
			const { view, contentEl } = makeView({ isNoteActive: () => true, runAction });
			await view.onOpen();

			// A click must not trigger the panel's own re-render — there's no
			// setActiveLeaf now, so no self-induced active-leaf-change refresh.
			const refreshSpy = vi.spyOn(view, 'refresh');
			findButton(contentEl, 'Enrich current note').dispatchEvent({ type: 'click' });
			await Promise.resolve();

			expect(refreshSpy).not.toHaveBeenCalled();
		});

		it('routes a non-note action through executeCommandById (no direct handler)', async () => {
			const editorCallback = vi.fn();
			const host = makeDispatchHost(editorCallback);
			const runAction = async (id: string): Promise<void> => {
				await dispatchSidebarCommand(host, id, `synapse:${id}`, noteContext);
			};
			const { view, contentEl } = makeView({ isNoteActive: () => true, runAction });
			await view.onOpen();

			findButton(contentEl, 'Open proposal review sidebar').dispatchEvent({ type: 'click' });
			await Promise.resolve();

			expect(editorCallback).not.toHaveBeenCalled();
			expect(host.executeCommandById).toHaveBeenCalledWith('synapse:review-proposals');
		});
	});
});
