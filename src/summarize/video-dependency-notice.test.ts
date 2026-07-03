import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { SummarizeModule, TranscribeUrlFn } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile, createEl } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';
import type { NotificationManager, CheckpointManager } from '../shared';

/** The slice of an Obsidian Command the test reads back off addCommand. */
interface MockCommand {
	id: string;
	name: string;
	editorCallback?: (editor: unknown, ctx: unknown) => unknown;
}

/** Typed shape of the hand-built plugin stub the module + registrar consume. */
interface MockPlugin {
	app: {
		vault: {
			read: Mock<(file: unknown) => Promise<string>>;
			process: Mock<(file: unknown, fn: (data: string) => string) => Promise<string>>;
			create: ReturnType<typeof vi.fn>;
			getAbstractFileByPath: ReturnType<typeof vi.fn>;
		};
		metadataCache: { getFileCache: ReturnType<typeof vi.fn> };
		workspace: { getActiveFile: ReturnType<typeof vi.fn> };
		setting?: { open: ReturnType<typeof vi.fn>; openTabById: ReturnType<typeof vi.fn> };
	};
	saveSettings: ReturnType<typeof vi.fn>;
	addCommand: Mock<(cmd: MockCommand) => void>;
	registerEvent: ReturnType<typeof vi.fn>;
}

// Video-dependency onboarding (#382): a failed video-URL transcription whose
// cause is a missing yt-dlp/ffmpeg must surface an actionable "Open settings"
// notice; any other failure keeps the standard persistent error notice.

const VIDEO_URL = 'https://www.youtube.com/watch?v=abc123';

vi.mock('./summarizer', () => ({
	Summarizer: class MockSummarizer {
		summarize = vi.fn().mockResolvedValue('This is a test summary.');
	},
}));

// Single video-URL target; no audio embeds, no note prose. The URL literal is
// inlined (not VIDEO_URL) because vi.mock factories are hoisted above consts.
vi.mock('./note-scanner', () => ({
	findSummarizeTargets: vi.fn().mockReturnValue([
		{ type: 'url', source: 'https://www.youtube.com/watch?v=abc123', line: 2, endLine: 2 },
	]),
	extractNoteProse: vi.fn().mockReturnValue(''),
	hasSummaryBelow: vi.fn().mockReturnValue(false),
}));

vi.mock('../audio', () => ({
	findAudioEmbeds: vi.fn().mockReturnValue([]),
}));

vi.mock('../shared', async () => ({
	...(await vi.importActual<typeof import('../shared/content-schemas')>('../shared/content-schemas')),
	FolderPickerModal: vi.fn(),
	getMarkdownFiles: vi.fn().mockReturnValue([]),
	NotificationManager: vi.fn(),
	buildCallout: vi.fn((_t: string, _title: string, content: string) => `> ${content}`),
	CALLOUT_TYPES: { transcription: 'synapse-transcription', summary: 'synapse-summary' },
	ENRICHMENT_START: '%% synapse-enrichment-start %%',
	ENRICHMENT_END: '%% synapse-enrichment-end %%',
	generateId: vi.fn().mockReturnValue('id-mock'),
	fireAndForget: vi.fn(),
	isPathExcluded: vi.fn().mockReturnValue(false),
	matchesExcludeTag: vi.fn().mockReturnValue(false),
	detectSchemaFor: vi.fn().mockReturnValue(null),
	// The URL is a recognized video platform -> the transcribeUrl path is taken.
	isSupportedUrl: vi.fn().mockReturnValue(true),
	detectPlatform: vi.fn().mockReturnValue({ platform: 'youtube' }),
	fetchPageContent: vi.fn().mockResolvedValue(''),
	fetchTweetContent: vi.fn().mockResolvedValue(''),
	isRedditUrl: vi.fn().mockReturnValue(false),
	fetchRedditContent: vi.fn().mockResolvedValue(''),
	linkLoadError: (source: string, reason: string) => `Could not load content from ${source}: ${reason}`,
	CheckpointManager: class {
		create = vi.fn().mockResolvedValue({ id: 'cp-mock' });
		completeItem = vi.fn().mockResolvedValue(null);
		complete = vi.fn().mockResolvedValue([]);
		discard = vi.fn().mockResolvedValue(undefined);
		listIncomplete = vi.fn().mockResolvedValue([]);
	},
}));

interface NoticeAction { label: string; onClick: () => void }

function createMockNotifications() {
	const handle = {
		update: vi.fn(),
		progress: vi.fn(),
		finish: vi.fn(),
		error: vi.fn(),
		cancelled: false,
	};
	return {
		startOperation: vi.fn().mockReturnValue(handle),
		info: vi.fn<(message: string, duration?: number, action?: NoticeAction) => void>(),
		success: vi.fn(),
		error: vi.fn(),
		notifyError: vi.fn(),
		confirm: vi.fn().mockResolvedValue(true),
	};
}

/** A typed dependency-missing error as it arrives at the summarize layer: a
 *  top-level Error whose discriminant `name` is 'DependencyMissingError'. Built
 *  structurally (not by importing the class) to mirror the real cross-module
 *  contract — detection is by `name`, never `instanceof`. */
function depError(tool: 'yt-dlp' | 'ffmpeg', message: string): Error {
	return Object.assign(new Error(message), { name: 'DependencyMissingError', tool });
}

describe('SummarizeModule video-dependency onboarding (#382)', () => {
	let module: SummarizeModule;
	let mockPlugin: MockPlugin;
	let notifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;
	let settingOpen: ReturnType<typeof vi.fn>;
	let openTabById: ReturnType<typeof vi.fn>;
	let saveSettings: ReturnType<typeof vi.fn>;

	function build(transcribeUrl: TranscribeUrlFn): SummarizeModule {
		return new SummarizeModule(
			mockPlugin as unknown as Plugin,
			() => settings,
			notifications as unknown as NotificationManager,
			createMockCheckpointManager() as unknown as CheckpointManager,
			new CommandRegistrar(
				mockPlugin as unknown as ConstructorParameters<typeof CommandRegistrar>[0],
			),
			transcribeUrl,
		);
	}

	async function runSummarize(file = new TFile('notes/video.md')): Promise<void> {
		await module.onload();
		const cmd = mockPlugin.addCommand.mock.calls.find(
			(c) => c[0].id === 'summarize-current-note',
		)![0];
		await cmd.editorCallback?.({}, { file });
	}

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		settingOpen = vi.fn();
		openTabById = vi.fn().mockReturnValue({ containerEl: {} });
		saveSettings = vi.fn().mockResolvedValue(undefined);

		mockPlugin = {
			app: {
				vault: {
					read: vi
						.fn<(file: unknown) => Promise<string>>()
						.mockResolvedValue(`# Note\n\n${VIDEO_URL}\n`),
					process: vi.fn(async (file: unknown, fn: (data: string) => string) =>
						fn(await mockPlugin.app.vault.read(file))
					),
					create: vi.fn().mockResolvedValue(new TFile()),
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
				},
				metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
				workspace: { getActiveFile: vi.fn().mockReturnValue(null) },
				setting: { open: settingOpen, openTabById },
			},
			saveSettings,
			addCommand: vi.fn<(cmd: MockCommand) => void>(),
			registerEvent: vi.fn(),
		};

		notifications = createMockNotifications();
	});

	it('shows an "Open settings" action notice when the cause is a missing dependency', async () => {
		module = build(vi.fn().mockRejectedValue(
			depError('yt-dlp', 'yt-dlp not found — install it or set the full path in settings')
		));

		await runSummarize();

		// Routed to the actionable info notice, NOT the plain persistent error.
		const actionCall = notifications.info.mock.calls.find((c) => c[2] !== undefined);
		expect(actionCall).toBeDefined();
		const [message, , action] = actionCall!;
		expect(message).toMatch(/yt-dlp not found/);
		expect(action!.label).toBe('Open settings');
		expect(notifications.error).not.toHaveBeenCalled();
		expect(notifications.notifyError).not.toHaveBeenCalled();
	});

	it('surfaces a missing-ffmpeg dependency through the same action notice', async () => {
		module = build(vi.fn().mockRejectedValue(
			depError('ffmpeg', 'ffmpeg/ffprobe not found — set the ffmpeg path in Synapse settings (Video).')
		));

		await runSummarize();

		const actionCall = notifications.info.mock.calls.find((c) => c[2] !== undefined);
		expect(actionCall).toBeDefined();
		expect(actionCall![0]).toMatch(/ffmpeg\/ffprobe not found/);
		expect(actionCall![2]!.label).toBe('Open settings');
	});

	it('keeps the plain link-load error notice for a non-dependency failure', async () => {
		module = build(vi.fn().mockRejectedValue(new Error('network unreachable')));

		await runSummarize();

		expect(notifications.error).toHaveBeenCalledTimes(1);
		expect(notifications.error.mock.calls[0][0]).toMatch(/Could not load content from/);
		// No action notice for an ordinary failure.
		expect(notifications.info.mock.calls.some((c) => c[2] !== undefined)).toBe(false);
	});

	it('the action opens Synapse settings and reveals the expanded Video section', async () => {
		settings.ui.collapsedSections['video'] = true; // start collapsed
		module = build(vi.fn().mockRejectedValue(
			depError('yt-dlp', 'yt-dlp not found — install it or set the full path in settings')
		));

		await runSummarize();

		const action = notifications.info.mock.calls.find((c) => c[2] !== undefined)![2] as NoticeAction;
		action.onClick();

		expect(settingOpen).toHaveBeenCalledTimes(1);
		expect(openTabById).toHaveBeenCalledWith('synapse');
		// Video accordion expanded + persisted so the tab renders it open.
		expect(settings.ui.collapsedSections['video']).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('scrolls the expanded Video section into view once the settings tab paints', async () => {
		// Build a stub settings-tab container holding the Video accordion so the
		// reveal path's `containerEl.findAll('.synapse-accordion-title')` resolves
		// to it. `findAll` is an Obsidian HTMLElement augmentation supplied only by
		// the obsidian mock — this is the test that exercises that changed path.
		const scrollIntoView = vi.fn();
		const container = createEl('div');
		const accordion = container.createDiv({ cls: 'synapse-accordion' });
		const title = accordion.createEl('div', {
			cls: 'synapse-accordion-title',
			text: 'Video transcription',
		});
		accordion.scrollIntoView = scrollIntoView;
		(title.closest as unknown as Mock).mockReturnValue(accordion);
		openTabById.mockReturnValue({ containerEl: container });

		module = build(vi.fn().mockRejectedValue(
			depError('yt-dlp', 'yt-dlp not found — install it or set the full path in settings')
		));

		await runSummarize();

		const action = notifications.info.mock.calls.find((c) => c[2] !== undefined)![2] as NoticeAction;
		action.onClick();
		// The scroll is deferred to a macrotask (window.setTimeout(…, 0)); flush it.
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
	});

	it('the action degrades to a no-op when the undocumented app.setting API is absent', async () => {
		delete mockPlugin.app.setting;
		module = build(vi.fn().mockRejectedValue(
			depError('yt-dlp', 'yt-dlp not found — install it or set the full path in settings')
		));

		await runSummarize();

		const action = notifications.info.mock.calls.find((c) => c[2] !== undefined)![2] as NoticeAction;
		expect(() => action.onClick()).not.toThrow();
		expect(settingOpen).not.toHaveBeenCalled();
	});
});
