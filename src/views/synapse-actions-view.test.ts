import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEl } from '../__mocks__/obsidian';
import { SynapseActionsView, SynapseActionsCallbacks } from './synapse-actions-view';
import type { CommandDefinition } from '../commands';

// --- Helpers ----------------------------------------------------------------

/** Stub WorkspaceLeaf that satisfies the ItemView constructor. */
function mockLeaf(): any {
	return { view: {} };
}

/**
 * A small, representative action set spanning two features and all contexts.
 * `review-proposals` carries the same explicit `icon` override the real registry
 * gives it; the enrichment actions inherit their feature-default glyph.
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

/** The text of a button's label span (label now lives in a child span, not the button's own text). */
function labelOf(button: any): string | undefined {
	return (button.children ?? [])
		.find((c: any) => c.classList?.contains?.('synapse-actions-button-label'))
		?.textContent;
}

/** The resolved icon name stamped on a button's icon span via `data-icon`. */
function iconOf(button: any): string | null {
	const iconEl = (button.children ?? [])
		.find((c: any) => c.classList?.contains?.('synapse-actions-button-icon'));
	return iconEl ? iconEl.getAttribute('data-icon') : null;
}

/** Find the action <button> whose label span reads `label`. */
function findButton(el: any, label: string): any {
	return buttons(el).find((b) => labelOf(b) === label);
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

// --- Tests ------------------------------------------------------------------

describe('SynapseActionsView', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders one button per action with its registry name', async () => {
		const { view, contentEl } = makeView();
		await view.onOpen();
		const labels = buttons(contentEl).map(labelOf);
		expect(labels).toEqual([
			'Open proposal review sidebar',
			'Enrich current note',
			'Scan vault for enrichment',
		]);
	});

	it('renders each button with its resolved glyph (per-action override, else feature default)', async () => {
		const { view, contentEl } = makeView();
		await view.onOpen();
		// review-proposals carries an explicit override; enrichment actions inherit
		// the feature-default glyph (FEATURE_ICONS.enrichment).
		expect(iconOf(findButton(contentEl, 'Open proposal review sidebar'))).toBe('synapse');
		expect(iconOf(findButton(contentEl, 'Enrich current note'))).toBe('synapse-enrichment');
		expect(iconOf(findButton(contentEl, 'Scan vault for enrichment'))).toBe('synapse-enrichment');
	});

	it('groups actions under sentence-case feature headings in registry order', async () => {
		const { view, contentEl } = makeView();
		await view.onOpen();
		expect(textsByClass(contentEl, 'synapse-actions-group-heading')).toEqual([
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
});
