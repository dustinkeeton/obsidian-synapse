import { MarkdownView } from 'obsidian';
import type { App, Command, TFile } from 'obsidian';
import { REGISTRY_BY_ID } from '../commands';
import { fireAndForget } from '../shared';
import type { NotificationManager } from '../shared';

/** The most recently active markdown note (survives the actions sidebar stealing focus), or null. */
export function activeMarkdownFile(app: App): TFile | null {
	const file = app.workspace.getActiveFile();
	return file && file.extension === 'md' ? file : null;
}

function markdownViewFor(app: App, file: TFile): MarkdownView | null {
	const view = app.workspace
		.getLeavesOfType('markdown')
		.map((leaf) => leaf.view)
		.find((v): v is MarkdownView => v instanceof MarkdownView && v.file === file);
	return view ?? null;
}

/**
 * Run a registry command from the actions sidebar. `context: 'note'` commands
 * get their `editorCallback` invoked directly with the note's own view;
 * everything else goes through Obsidian's gated dispatch.
 */
export function runRegisteredCommand(
	app: App,
	pluginId: string,
	id: string,
	notifications: NotificationManager
): void {
	const commands = (app as unknown as {
		commands: {
			commands: Record<string, Command | undefined>;
			executeCommandById(id: string): boolean;
		};
	}).commands;
	const fullId = `${pluginId}:${id}`;
	const entry = REGISTRY_BY_ID.get(id);

	if (entry?.context === 'note') {
		const file = activeMarkdownFile(app);
		if (!file) {
			notifications.info('Open a note first to use this action.');
			return;
		}
		const view = markdownViewFor(app, file);
		const handler = commands.commands[fullId]?.editorCallback;
		if (view && handler) {
			// executeCommandById no-ops editorCallback commands while the sidebar holds focus (#352).
			fireAndForget((async () => { await handler(view.editor, view); })(), entry.name, { notifications });
			return;
		}
	}

	commands.executeCommandById(fullId);
}
