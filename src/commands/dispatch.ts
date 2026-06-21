/**
 * Dispatch a registry command through Obsidian's own command system, with the
 * focus/timing handling the Synapse actions sidebar needs.
 *
 * Why this exists (issue #352): the actions sidebar's per-note buttons run
 * `context: 'note'` commands, which Obsidian registers as `editorCallback`s and
 * gates on an active markdown editor. Opening the sidebar (especially the mobile
 * drawer) steals focus from the editor, so we re-activate the note's markdown
 * leaf before dispatching. Crucially, `setActiveLeaf` does NOT make the editor
 * active within the same synchronous tick — so dispatching immediately would see
 * no active editor and silently no-op, which is why the buttons used to require a
 * SECOND click. Yielding a macrotask between re-activation and dispatch lets the
 * workspace settle so the command runs on the FIRST click.
 *
 * (A microtask is not enough — the active-editor change is applied on a later
 * task, mirroring the #335 freeze fix. Hence `setTimeout(0)`, not a resolved
 * Promise.)
 *
 * This sequence is extracted here (rather than inlined in main.ts) so it can be
 * unit-tested for ordering without standing up the whole plugin.
 */

import { REGISTRY_BY_ID } from './registry';

/** A workspace leaf we can re-activate (structural subset of Obsidian's WorkspaceLeaf). */
export interface ActivatableLeaf {
	view: unknown;
}

/** The minimal workspace + command surface command dispatch needs. */
export interface CommandDispatchHost {
	/** Re-activate (and focus) a leaf — restores the editor context for note commands. */
	setActiveLeaf(leaf: ActivatableLeaf, options: { focus: boolean }): void;
	/** Run a fully-prefixed command id via Obsidian's gated dispatch (the palette path). */
	executeCommandById(fullId: string): boolean;
}

/** Yield a macrotask so Obsidian's active-leaf/editor change is applied before we read it. */
function nextMacrotask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Dispatch the command `fullId` (already prefixed, e.g. `synapse:enrich-current-note`)
 * for the registry entry `id`.
 *
 * For `context: 'note'` entries, when `noteLeaf` is provided, the note's markdown
 * leaf is re-activated and a macrotask is awaited BEFORE dispatch so the
 * editor-gated command runs on the first attempt. Non-note commands (and note
 * commands without a resolvable leaf) dispatch immediately.
 *
 * @returns `true` once the command was dispatched.
 */
export async function dispatchSidebarCommand(
	host: CommandDispatchHost,
	id: string,
	fullId: string,
	noteLeaf: ActivatableLeaf | null,
): Promise<boolean> {
	if (REGISTRY_BY_ID.get(id)?.context === 'note' && noteLeaf) {
		host.setActiveLeaf(noteLeaf, { focus: true });
		// Let the focus/active-editor change land before dispatching (see file doc).
		await nextMacrotask();
	}
	return host.executeCommandById(fullId);
}
