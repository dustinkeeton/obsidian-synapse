import { describe, it, expect, vi } from 'vitest';
import { activeMarkdownFile, runRegisteredCommand } from './command-runner';
import { MarkdownView, TFile } from '../__mocks__/obsidian';
import type { App } from 'obsidian';
import type { NotificationManager } from '../shared';

type EditorCallback = (editor: unknown, ctx: unknown) => unknown;
interface FakeCommand {
	callback?: () => unknown;
	editorCallback?: EditorCallback;
}

function makeNoteView(file: TFile | null): MarkdownView & { editor: unknown } {
	const view = new MarkdownView() as MarkdownView & { editor: unknown };
	view.file = file;
	view.editor = { owner: file?.path ?? null };
	return view;
}

/** Models Obsidian's gate: with the sidebar focused there is no active editor, so editorCallback commands no-op. */
function makeApp(
	activeFile: TFile | null,
	views: MarkdownView[] = [],
	registered: Record<string, FakeCommand> = {},
) {
	const executeCommandById = vi.fn((fullId: string): boolean => {
		const command = registered[fullId];
		if (!command?.callback) return false;
		command.callback();
		return true;
	});
	return {
		workspace: {
			activeEditor: null,
			getActiveFile: vi.fn().mockReturnValue(activeFile),
			getLeavesOfType: vi.fn().mockReturnValue(views.map((view) => ({ view }))),
			setActiveLeaf: vi.fn(),
		},
		commands: { commands: registered, executeCommandById },
	};
}

function makeNotifications() {
	return { info: vi.fn(), notifyError: vi.fn() } as unknown as NotificationManager & {
		info: ReturnType<typeof vi.fn>;
		notifyError: ReturnType<typeof vi.fn>;
	};
}

const run = (app: ReturnType<typeof makeApp>, id: string, notifications = makeNotifications()) =>
	runRegisteredCommand(app as unknown as App, 'synapse', id, notifications);

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
		const callback = vi.fn();
		const app = makeApp(null, [], { 'synapse:review-proposals': { callback } });

		run(app, 'review-proposals');

		expect(app.commands.executeCommandById).toHaveBeenCalledWith('synapse:review-proposals');
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it('refuses a note command with no active note', () => {
		const editorCallback = vi.fn();
		const app = makeApp(null, [], { 'synapse:enrich-current-note': { editorCallback } });
		const notifications = makeNotifications();

		run(app, 'enrich-current-note', notifications);

		expect(notifications.info).toHaveBeenCalledWith('Open a note first to use this action.');
		expect(editorCallback).not.toHaveBeenCalled();
		expect(app.commands.executeCommandById).not.toHaveBeenCalled();
	});

	it('runs a note command on the first call while no editor is active (#352)', () => {
		const file = new TFile('a.md');
		const view = makeNoteView(file);
		const editorCallback = vi.fn();
		const app = makeApp(file, [view], { 'synapse:enrich-current-note': { editorCallback } });

		run(app, 'enrich-current-note');

		expect(editorCallback).toHaveBeenCalledTimes(1);
		expect(editorCallback).toHaveBeenCalledWith(view.editor, view);
		expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();
	});

	it("uses the view showing the active file when several markdown leaves are open", () => {
		const file = new TFile('b.md');
		const other = makeNoteView(new TFile('a.md'));
		const target = makeNoteView(file);
		const editorCallback = vi.fn();
		const app = makeApp(file, [other, target], { 'synapse:deep-dive': { editorCallback } });

		run(app, 'deep-dive');

		expect(editorCallback).toHaveBeenCalledTimes(1);
		expect(editorCallback).toHaveBeenCalledWith(target.editor, target);
	});

	it('falls back to gated dispatch when the note command has no editorCallback', () => {
		const file = new TFile('a.md');
		const app = makeApp(file, [makeNoteView(file)], {});

		run(app, 'enrich-current-note');

		expect(app.commands.executeCommandById).toHaveBeenCalledWith('synapse:enrich-current-note');
		expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();
	});

	it('falls back to gated dispatch when no markdown view shows the active file', () => {
		const file = new TFile('a.md');
		const editorCallback = vi.fn();
		const app = makeApp(file, [makeNoteView(new TFile('other.md'))], {
			'synapse:enrich-current-note': { editorCallback },
		});

		run(app, 'enrich-current-note');

		expect(editorCallback).not.toHaveBeenCalled();
		expect(app.commands.executeCommandById).toHaveBeenCalledWith('synapse:enrich-current-note');
	});

	it('surfaces a rejected note handler through notifications', async () => {
		const file = new TFile('a.md');
		const error = new Error('boom');
		const editorCallback = vi.fn().mockRejectedValue(error);
		const app = makeApp(file, [makeNoteView(file)], { 'synapse:enrich-current-note': { editorCallback } });
		const notifications = makeNotifications();

		run(app, 'enrich-current-note', notifications);
		await vi.waitFor(() => expect(notifications.notifyError).toHaveBeenCalledTimes(1));

		expect(notifications.notifyError).toHaveBeenCalledWith('Enrich current note', error);
	});

	it('surfaces a synchronously throwing note handler through notifications', async () => {
		const file = new TFile('a.md');
		const error = new Error('sync boom');
		const editorCallback = vi.fn(() => {
			throw error;
		});
		const app = makeApp(file, [makeNoteView(file)], { 'synapse:enrich-current-note': { editorCallback } });
		const notifications = makeNotifications();

		expect(() => run(app, 'enrich-current-note', notifications)).not.toThrow();
		await vi.waitFor(() => expect(notifications.notifyError).toHaveBeenCalledWith('Enrich current note', error));
	});
});
