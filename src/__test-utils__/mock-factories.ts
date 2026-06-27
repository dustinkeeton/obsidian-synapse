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
 * Shape returned by {@link createMockApp}. Naming it (rather than leaning on
 * inference alone) pins the factory's public contract and gives consumers a
 * stable, non-`any` type to reference. The members are the spy-backed mock
 * sub-objects; see the factory body for the concrete spy set.
 */
export interface MockApp {
	vault: MockVault;
	metadataCache: MockMetadataCache;
	workspace: MockWorkspace;
}

type MockVault = ReturnType<typeof buildMockVault>;
type MockMetadataCache = ReturnType<typeof buildMockMetadataCache>;
type MockWorkspace = ReturnType<typeof buildMockWorkspace>;

function buildMockVault() {
	const adapter = {
		read: vi.fn().mockResolvedValue(''),
		write: vi.fn().mockResolvedValue(undefined),
		exists: vi.fn().mockResolvedValue(false),
		remove: vi.fn().mockResolvedValue(undefined),
		list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
	};

	// Hoist `read` so `process` can call it WITHOUT referencing the vault object
	// inside its own initializer. That self-reference made the vault const infer
	// as implicit `any` (its type depended on itself); reading through the
	// hoisted spy breaks the cycle so the vault infers a concrete type.
	const read = vi.fn<(file: TFile) => Promise<string>>().mockResolvedValue('');

	return {
		read,
		// Cached read of a vault note (the path proposer/elaboration uses). A
		// distinct spy from `read` so call-count assertions on either stay
		// independent.
		cachedRead: vi.fn<(file: TFile) => Promise<string>>().mockResolvedValue(''),
		modify: vi.fn().mockResolvedValue(undefined),
		// Mimics Obsidian's atomic read -> transform -> write. The callback is
		// synchronous and receives the file's fresh content; its return value is
		// the new content. Returns the new content like the real API.
		process: vi.fn(async (file: TFile, fn: (data: string) => string) => {
			const data = await read(file);
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
}

function buildMockMetadataCache() {
	return {
		getFileCache: vi.fn().mockReturnValue(null),
		getCache: vi.fn().mockReturnValue(null),
		getFirstLinkpathDest: vi.fn().mockReturnValue(null),
	};
}

function buildMockWorkspace() {
	return {
		getLeavesOfType: vi.fn().mockReturnValue([]),
		getRightLeaf: vi.fn().mockReturnValue(null),
		revealLeaf: vi.fn(),
	};
}

/**
 * Create a mock Obsidian App with spy functions on vault, metadataCache, workspace.
 */
export function createMockApp(): MockApp {
	return {
		vault: buildMockVault(),
		metadataCache: buildMockMetadataCache(),
		workspace: buildMockWorkspace(),
	};
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
