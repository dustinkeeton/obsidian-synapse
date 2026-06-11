import { vi } from 'vitest';
import { TFile, TFolder } from '../__mocks__/obsidian';

/**
 * Create a TFile instance for testing.
 * Uses the real TFile class so instanceof checks work.
 */
export function mockFile(path: string): TFile {
	return new TFile(path);
}

/**
 * Create a mock Obsidian App with spy functions on vault, metadataCache, workspace.
 */
export function createMockApp() {
	const adapter = {
		read: vi.fn().mockResolvedValue(''),
		write: vi.fn().mockResolvedValue(undefined),
		exists: vi.fn().mockResolvedValue(false),
		remove: vi.fn().mockResolvedValue(undefined),
		list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
	};

	const vault = {
		read: vi.fn().mockResolvedValue(''),
		modify: vi.fn().mockResolvedValue(undefined),
		// Mimics Obsidian's atomic read -> transform -> write. The callback is
		// synchronous and receives the file's fresh content; its return value is
		// the new content. Returns the new content like the real API.
		process: vi.fn(async (file: TFile, fn: (data: string) => string) => {
			const data = await vault.read(file);
			return fn(data);
		}),
		create: vi.fn().mockResolvedValue(new TFile()),
		createFolder: vi.fn().mockResolvedValue(new TFolder()),
		getAbstractFileByPath: vi.fn().mockReturnValue(null),
		getMarkdownFiles: vi.fn().mockReturnValue([]),
		getFiles: vi.fn().mockReturnValue([]),
		readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
		adapter,
	};

	const metadataCache = {
		getFileCache: vi.fn().mockReturnValue(null),
		getCache: vi.fn().mockReturnValue(null),
		getFirstLinkpathDest: vi.fn().mockReturnValue(null),
	};

	const workspace = {
		getLeavesOfType: vi.fn().mockReturnValue([]),
		getRightLeaf: vi.fn().mockReturnValue(null),
		revealLeaf: vi.fn(),
	};

	return { vault, metadataCache, workspace };
}

/**
 * Create a mock Plugin with a settings getter.
 */
export function createMockPlugin(settingsOverrides?: Record<string, unknown>) {
	const app = createMockApp();

	return {
		app,
		addCommand: vi.fn(),
		addRibbonIcon: vi.fn(),
		addSettingTab: vi.fn(),
		registerView: vi.fn(),
		registerEvent: vi.fn(),
		loadData: vi.fn().mockResolvedValue(settingsOverrides ?? null),
		saveData: vi.fn().mockResolvedValue(undefined),
	};
}

/**
 * Create settings with overrides merged over defaults.
 * Import DEFAULT_SETTINGS from settings.ts to use this.
 */
export function makeSettings<T>(defaults: T, overrides?: Partial<T>): T {
	return { ...structuredClone(defaults), ...overrides } as T;
}

/**
 * Create a mock CheckpointManager with all methods stubbed.
 * Useful for passing to module constructors in tests.
 */
export function createMockCheckpointManager() {
	return {
		create: vi.fn().mockResolvedValue({
			id: 'mockcheckpoint',
			module: 'test',
			operationLabel: 'test',
			status: 'active',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			completedItems: [],
			remainingItems: [],
			deferredTasks: [],
			metadata: {},
		}),
		completeItem: vi.fn().mockResolvedValue(null),
		addDeferredTask: vi.fn().mockResolvedValue(null),
		complete: vi.fn().mockResolvedValue([]),
		discard: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		load: vi.fn().mockResolvedValue(null),
		resume: vi.fn().mockResolvedValue(null),
		listIncomplete: vi.fn().mockResolvedValue([]),
		listByStatus: vi.fn().mockResolvedValue([]),
		listAll: vi.fn().mockResolvedValue([]),
		cleanup: vi.fn().mockResolvedValue(0),
	};
}
