/**
 * Dispatch a Synapse actions-sidebar button to its registered command.
 *
 * Why this exists (issue #352): the sidebar's per-note buttons run
 * `context: 'note'` commands, which Obsidian registers as `editorCallback`s and
 * gates on an active markdown editor. Opening the sidebar (especially the mobile
 * drawer) makes the note's editor inactive, so routing these through
 * `executeCommandById` (the command-palette path) hits that gate and silently
 * no-ops. Re-activating the note's leaf first does NOT reliably restore the
 * editor within the click's lifetime (focus settles on a later tick), which is
 * why the buttons used to require a SECOND click.
 *
 * Instead we invoke the registered command's `editorCallback` DIRECTLY, passing
 * the note's own editor + view. Synapse's per-note handlers only read `ctx.file`
 * (they ignore the editor), and we resolve the view from the note's markdown
 * leaf — so the action runs on the FIRST click, deterministically, with no focus
 * theft and no panel re-render. Non-note commands (and anything we can't resolve)
 * fall back to Obsidian's normal gated dispatch.
 *
 * Extracted here (rather than inlined in main.ts) so it can be unit-tested
 * without standing up the whole plugin.
 */

import { REGISTRY_BY_ID } from './registry';

/** The slice of an Obsidian `Command` the sidebar may invoke directly. */
export interface InvokableCommand {
	/** Editor-gated handler — what Synapse's per-note actions register. */
	editorCallback?: (editor: unknown, ctx: unknown) => unknown;
}

/** The note's live editor context, resolved from its markdown leaf. */
export interface NoteEditorContext {
	/** The note's editor (`MarkdownView.editor`). */
	editor: unknown;
	/** The `MarkdownView` itself, passed as the `editorCallback` `ctx` (a `MarkdownFileInfo`). */
	view: unknown;
}

/** The minimal command surface dispatch needs (Obsidian's private `app.commands`). */
export interface CommandDispatchHost {
	/** Look up a registered command by fully-prefixed id (e.g. `synapse:enrich-current-note`). */
	getCommand(fullId: string): InvokableCommand | undefined;
	/** Obsidian's gated dispatch (the palette path) — the fallback for non-note commands. */
	executeCommandById(fullId: string): boolean;
}

/**
 * Run the command `fullId` for registry entry `id`.
 *
 * For a `context: 'note'` entry with a resolved `noteContext`, invoke the
 * command's `editorCallback` directly with the note's editor/view — bypassing
 * the active-editor gate so it runs on the FIRST click. Everything else (non-note
 * commands, or a note command we can't resolve a handler for) routes through
 * `executeCommandById`.
 *
 * @returns `true` once the command was invoked/dispatched.
 */
export async function dispatchSidebarCommand(
	host: CommandDispatchHost,
	id: string,
	fullId: string,
	noteContext: NoteEditorContext | null,
): Promise<boolean> {
	if (REGISTRY_BY_ID.get(id)?.context === 'note' && noteContext) {
		const command = host.getCommand(fullId);
		if (command?.editorCallback) {
			// Direct invocation with the note's own editor/view — deterministic,
			// no focus theft, no self-induced `active-leaf-change` re-render. Awaited
			// so the runner can surface a rejected handler (see file doc).
			await command.editorCallback(noteContext.editor, noteContext.view);
			return true;
		}
		// Unresolvable command shape — fall through to the gated path.
	}
	return host.executeCommandById(fullId);
}
