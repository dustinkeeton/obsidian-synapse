import { describe, it, expect, vi } from 'vitest';
import { activeMarkdownFile, runRegisteredCommand } from './command-runner';
import { MarkdownView, TFile } from '../__mocks__/obsidian';
import type { App } from 'obsidian';
import type { NotificationManager } from '../shared';

function makeApp(activeFile: TFile | null, mdLeaves: Array<{ view: unknown }> = []) {
	return {
		workspace: {
			getActiveFile: vi.fn().mockReturnValue(activeFile),
			getLeavesOfType: vi.fn().mockReturnValue(mdLeaves),
			setActiveLeaf: vi.fn(),
		},
		commands: { executeCommandById: vi.fn().mockReturnValue(true) },
	};
}

const notifications = { info: vi.fn() } as unknown as NotificationManager & { info: ReturnType<typeof vi.fn> };

describe('activeMarkdownFile', () => {
	it('returns the active markdown note', () => {
		const file = new TFile('a.md');
		expect(activeMarkdownFile(makeApp(file) as unknown as App)).toBe(file);
	});

	it('returns null for a non-markdown file or no file', () => {
		expect(activeMarkdownFile(makeApp(new TFile('a.png')) as unknown as App)).toBeNull();
		expect(activeMarkdownFile(makeApp(null) as unknown as App)).toBeNull();
	});
});

describe('runRegisteredCommand', () => {
	it('dispatches a global command through app.commands with the plugin prefix', () => {
		const app = makeApp(null);
		runRegisteredCommand(app as unknown as App, 'synapse', 'review-proposals', notifications);
		expect(app.commands.executeCommandById).toHaveBeenCalledWith('synapse:review-proposals');
	});

	it('refuses a note command with no active note', () => {
		const app = makeApp(null);
		runRegisteredCommand(app as unknown as App, 'synapse', 'transcribe-note-media', notifications);
		expect(notifications.info).toHaveBeenCalledWith('Open a note first to use this action.');
		expect(app.commands.executeCommandById).not.toHaveBeenCalled();
	});

	it("re-activates the note's markdown leaf before dispatching a note command", () => {
		const file = new TFile('a.md');
		const view = new MarkdownView();
		view.file = file;
		const leaf = { view };
		const app = makeApp(file, [{ view: new MarkdownView() }, leaf]);
		runRegisteredCommand(app as unknown as App, 'synapse', 'transcribe-note-media', notifications);
		expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
		expect(app.commands.executeCommandById).toHaveBeenCalledWith('synapse:transcribe-note-media');
	});
});
