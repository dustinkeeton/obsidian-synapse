import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchSidebarCommand, type CommandDispatchHost, type NoteEditorContext } from './dispatch';

type Handler = (editor: unknown, ctx: unknown) => unknown;

/**
 * A spy host over Obsidian's private command surface. `getCommand` returns a
 * registered command (with an `editorCallback`) when one is configured; the gated
 * `executeCommandById` is the fallback. Tests assert which path dispatch takes.
 */
function makeHost(
	commands: Record<string, { editorCallback?: Handler }> = {},
): CommandDispatchHost & { getCommand: ReturnType<typeof vi.fn>; executeCommandById: ReturnType<typeof vi.fn> } {
	return {
		getCommand: vi.fn((fullId: string) => commands[fullId]),
		executeCommandById: vi.fn((_fullId: string) => true),
	};
}

const noteContext: NoteEditorContext = { editor: { id: 'editor' }, view: { id: 'view' } };

describe('dispatchSidebarCommand', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => vi.restoreAllMocks());

	// Regression for #352: a `context: 'note'` action must run on the FIRST click.
	// The fix invokes the registered command's editorCallback DIRECTLY with the
	// note's editor/view, bypassing the active-editor gate that executeCommandById
	// can't satisfy from the sidebar (which is why it used to need a 2nd click).
	it('invokes a note command editorCallback directly with the note editor + view', async () => {
		const editorCallback = vi.fn();
		const host = makeHost({ 'synapse:enrich-current-note': { editorCallback } });

		const ran = await dispatchSidebarCommand(host, 'enrich-current-note', 'synapse:enrich-current-note', noteContext);

		expect(editorCallback).toHaveBeenCalledTimes(1);
		expect(editorCallback).toHaveBeenCalledWith(noteContext.editor, noteContext.view);
		// It must NOT take the gated palette path — the source of the bug.
		expect(host.executeCommandById).not.toHaveBeenCalled();
		expect(ran).toBe(true);
	});

	it('awaits the editorCallback so the runner can surface its result/errors', async () => {
		const order: string[] = [];
		const editorCallback = vi.fn(async () => {
			await Promise.resolve();
			order.push('handler-done');
		});
		const host = makeHost({ 'synapse:enrich-current-note': { editorCallback } });

		await dispatchSidebarCommand(host, 'enrich-current-note', 'synapse:enrich-current-note', noteContext);
		order.push('dispatch-returned');

		expect(order).toEqual(['handler-done', 'dispatch-returned']);
	});

	it('falls back to executeCommandById for a note command with no resolvable editorCallback', async () => {
		const host = makeHost(); // getCommand returns undefined

		await dispatchSidebarCommand(host, 'enrich-current-note', 'synapse:enrich-current-note', noteContext);

		expect(host.executeCommandById).toHaveBeenCalledWith('synapse:enrich-current-note');
	});

	it('falls back to executeCommandById for a note command with no note context', async () => {
		const editorCallback = vi.fn();
		const host = makeHost({ 'synapse:enrich-current-note': { editorCallback } });

		await dispatchSidebarCommand(host, 'enrich-current-note', 'synapse:enrich-current-note', null);

		expect(editorCallback).not.toHaveBeenCalled();
		expect(host.executeCommandById).toHaveBeenCalledWith('synapse:enrich-current-note');
	});

	it('dispatches a non-note command through executeCommandById, never invoking a handler directly', async () => {
		const editorCallback = vi.fn();
		// `review-proposals` is a `context: 'global'` command in the registry.
		const host = makeHost({ 'synapse:review-proposals': { editorCallback } });

		await dispatchSidebarCommand(host, 'review-proposals', 'synapse:review-proposals', noteContext);

		expect(editorCallback).not.toHaveBeenCalled();
		expect(host.executeCommandById).toHaveBeenCalledWith('synapse:review-proposals');
	});
});
