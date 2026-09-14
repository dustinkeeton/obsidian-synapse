import { MarkdownView } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { REGISTRY_BY_ID } from '../commands';
import type { NotificationManager } from '../shared';

/** The most recently active markdown note (survives the actions sidebar stealing focus), or null. */
export function activeMarkdownFile(app: App): TFile | null {
	const file = app.workspace.getActiveFile();
	return file && file.extension === 'md' ? file : null;
}

/**
 * Run a registry command through Obsidian's own dispatch so palette gating is
 * honored. `context: 'note'` commands re-activate the note's markdown leaf
 * first, restoring the editor context the actions sidebar took away.
 */
export function runRegisteredCommand(
	app: App,
	pluginId: string,
	id: string,
	notifications: NotificationManager
): void {
	const commands = (app as unknown as {
		commands: { executeCommandById(id: string): boolean };
	}).commands;

	if (REGISTRY_BY_ID.get(id)?.context === 'note') {
		const file = activeMarkdownFile(app);
		if (!file) {
			notifications.info('Open a note first to use this action.');
			return;
		}
		const mdLeaf = app.workspace
			.getLeavesOfType('markdown')
			.find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file === file);
		if (mdLeaf) app.workspace.setActiveLeaf(mdLeaf, { focus: true });
	}

	commands.executeCommandById(`${pluginId}:${id}`);
}
