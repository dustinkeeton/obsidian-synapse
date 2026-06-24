import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElaborationModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager } from '../shared';
import { mockFile, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import { DetectionResult } from './types';

// Shared mock function that all MockAIClient instances delegate to.
// Tests can swap this to capture prompts or change responses.
const sharedCompleteMock = vi.fn().mockResolvedValue('AI-generated elaboration content');

// Mock the shared module's AIClient (used by ProposalGenerator).
// Must be a real class so that `new AIClient(...)` works in ProposalGenerator.
vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		constructor(_getSettings: any) {}
		complete(...args: any[]) {
			return sharedCompleteMock(...args);
		}
	},
}));

/**
 * Build a minimal mock plugin with the given app overrides.
 * Returns a Plugin-shaped object that ElaborationModule accepts.
 */
function createMockPluginForElaboration(appOverrides: Record<string, unknown> = {}) {
	const adapter = {
		read: vi.fn().mockResolvedValue('# My Note\n\nThis is a fully fleshed-out note with enough content to avoid stub detection.'),
		write: vi.fn().mockResolvedValue(undefined),
		exists: vi.fn().mockResolvedValue(true),
		remove: vi.fn().mockResolvedValue(undefined),
		list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
	};

	const vault = {
		read: vi.fn().mockResolvedValue('# My Note\n\nThis is a fully fleshed-out note with enough content to avoid stub detection.'),
		cachedRead: vi.fn().mockResolvedValue('# My Note\n\nThis is a fully fleshed-out note with enough content to avoid stub detection.'),
		modify: vi.fn().mockResolvedValue(undefined),
		create: vi.fn(),
		createFolder: vi.fn().mockResolvedValue(undefined),
		// Markdown notes resolve to a TFile (the proposer looks them up before
		// cachedRead); non-note paths (e.g. the .synapse data folder) stay null.
		getAbstractFileByPath: vi.fn((path: string) => (path.endsWith('.md') ? mockFile(path) : null)),
		getMarkdownFiles: vi.fn().mockReturnValue([]),
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
		getActiveFile: vi.fn().mockReturnValue(null),
	};

	const app = { vault, metadataCache, workspace, ...appOverrides };

	return {
		app,
		addCommand: vi.fn(),
		addRibbonIcon: vi.fn(),
		addSettingTab: vi.fn(),
		registerView: vi.fn(),
		registerEvent: vi.fn(),
		loadData: vi.fn().mockResolvedValue(null),
		saveData: vi.fn().mockResolvedValue(undefined),
	};
}

describe('ElaborationModule.scanNote — user-invoked elaboration', () => {
	let module: ElaborationModule;
	let mockPlugin: ReturnType<typeof createMockPluginForElaboration>;
	let settings: SynapseSettings;
	let notifications: NotificationManager;

	beforeEach(async () => {
		sharedCompleteMock.mockClear();
		settings = structuredClone(DEFAULT_SETTINGS);
		mockPlugin = createMockPluginForElaboration();
		notifications = new NotificationManager();

		module = new ElaborationModule(
			mockPlugin as any,
			() => settings,
			notifications,
			createMockCheckpointManager() as any,
			new CommandRegistrar(mockPlugin as any)
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('proceeds with elaboration when user-invoked even if detector finds no stubs', async () => {
		// The note has 50+ words so the detector will NOT flag it as a stub.
		const longContent = '# Architecture\n\n' + 'This is a detailed note about software architecture. '.repeat(20);
		mockPlugin.app.vault.read.mockResolvedValue(longContent);
		mockPlugin.app.vault.cachedRead.mockResolvedValue(longContent);

		const file = mockFile('notes/architecture.md');
		await module.scanNote(file as any);

		// The proposer should have been called (cachedRead is called by proposer.generate)
		expect(mockPlugin.app.vault.cachedRead).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'notes/architecture.md' })
		);
	});

	it('creates a synthetic detection result with user-requested reason', async () => {
		// Spy on the proposal store to capture what gets saved
		const savedProposals: any[] = [];
		mockPlugin.app.vault.adapter.write.mockImplementation(async (_path: string, content: string) => {
			try { savedProposals.push(JSON.parse(content)); } catch { /* not JSON */ }
		});

		const longContent = '# Well-Written Note\n\n' + 'Comprehensive content here. '.repeat(20);
		mockPlugin.app.vault.read.mockResolvedValue(longContent);
		mockPlugin.app.vault.cachedRead.mockResolvedValue(longContent);

		const file = mockFile('notes/complete.md');
		await module.scanNote(file as any);

		// A proposal should have been saved
		expect(savedProposals.length).toBe(1);
		// The detection reasons should include user-requested
		expect(savedProposals[0].detectionReasons).toEqual([{ type: 'user-requested' }]);
	});

	it('uses detector results when note IS a stub, even if user-invoked', async () => {
		// Short note — detector will flag it
		const shortContent = '# Stub\n\nTODO';
		mockPlugin.app.vault.read.mockResolvedValue(shortContent);
		mockPlugin.app.vault.cachedRead.mockResolvedValue(shortContent);

		const savedProposals: any[] = [];
		mockPlugin.app.vault.adapter.write.mockImplementation(async (_path: string, content: string) => {
			try { savedProposals.push(JSON.parse(content)); } catch { /* not JSON */ }
		});

		const file = mockFile('notes/stub.md');
		await module.scanNote(file as any);

		expect(savedProposals.length).toBe(1);
		// Should contain the actual detector reasons, not user-requested
		const reasons = savedProposals[0].detectionReasons;
		const reasonTypes = reasons.map((r: any) => r.type);
		expect(reasonTypes).not.toContain('user-requested');
		// Should have real detection reasons like short-note or todo-marker
		expect(reasonTypes.length).toBeGreaterThan(0);
	});

	it('does NOT proceed when userInvoked is false and no stubs found', async () => {
		const longContent = '# Complete Note\n\n' + 'This note has plenty of content and no stubs. '.repeat(20);
		mockPlugin.app.vault.read.mockResolvedValue(longContent);
		mockPlugin.app.vault.cachedRead.mockResolvedValue(longContent);

		const file = mockFile('notes/complete.md');
		// Explicitly pass userInvoked = false (simulating auto-scan behavior)
		await module.scanNote(file as any, false);

		// The proposer should NOT have been called since detector found nothing
		// and userInvoked is false
		expect(mockPlugin.app.vault.cachedRead).not.toHaveBeenCalled();
	});

	it('defaults userInvoked to true when not specified', async () => {
		const longContent = '# Full Note\n\n' + 'Enough content to pass detection. '.repeat(20);
		mockPlugin.app.vault.read.mockResolvedValue(longContent);
		mockPlugin.app.vault.cachedRead.mockResolvedValue(longContent);

		const file = mockFile('notes/full.md');
		// Call without second argument — should default to userInvoked=true
		await module.scanNote(file as any);

		// Should still generate because userInvoked defaults to true
		expect(mockPlugin.app.vault.cachedRead).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'notes/full.md' })
		);
	});
});

describe('ProposalGenerator — user-requested reason handling', () => {
	let ProposalGenerator: typeof import('./proposer').ProposalGenerator;

	beforeEach(async () => {
		sharedCompleteMock.mockClear();
		const mod = await import('./proposer');
		ProposalGenerator = mod.ProposalGenerator;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('generates a proposal for user-requested detection result', async () => {
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => mockFile(path)),
				cachedRead: vi.fn().mockResolvedValue('# My Note\n\nDetailed content about a topic.'),
				read: vi.fn(),
			},
			metadataCache: {
				getCache: vi.fn().mockReturnValue(null),
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
		};

		const settings = structuredClone(DEFAULT_SETTINGS);
		const generator = new ProposalGenerator(mockApp as any, () => settings, { info: vi.fn() } as unknown as NotificationManager);

		const detection: DetectionResult = {
			notePath: 'notes/test.md',
			reasons: [{ type: 'user-requested' }],
		};

		const proposal = await generator.generate(detection);

		expect(proposal.sourceNotePath).toBe('notes/test.md');
		expect(proposal.detectionReasons).toEqual([{ type: 'user-requested' }]);
		expect(proposal.status).toBe('pending');
		expect(proposal.proposedAdditions).toBeTruthy();
	});

	it('builds a user-requested prompt that differs from stub prompt', async () => {
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => mockFile(path)),
				cachedRead: vi.fn().mockResolvedValue('# Test Note\n\nSome content.'),
				read: vi.fn(),
			},
			metadataCache: {
				getCache: vi.fn().mockReturnValue(null),
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
		};

		const settings = structuredClone(DEFAULT_SETTINGS);
		// Disable context gathering to simplify the test
		settings.elaboration.proposal.includeSourceContext = false;

		const generator = new ProposalGenerator(mockApp as any, () => settings, { info: vi.fn() } as unknown as NotificationManager);

		const userDetection: DetectionResult = {
			notePath: 'notes/user.md',
			reasons: [{ type: 'user-requested' }],
		};
		await generator.generate(userDetection);

		const userPrompt = sharedCompleteMock.mock.calls[0][0] as string;
		// User-requested prompt should NOT contain "placeholder or stub"
		expect(userPrompt).not.toContain('placeholder or stub');
		// Should contain user-oriented language
		expect(userPrompt).toContain('user has requested elaboration');

		// Now generate with a stub detection for comparison
		const stubDetection: DetectionResult = {
			notePath: 'notes/stub.md',
			reasons: [{ type: 'short-note', wordCount: 5 }],
		};
		await generator.generate(stubDetection);

		const stubPrompt = sharedCompleteMock.mock.calls[1][0] as string;
		// Stub prompt should contain "placeholder or stub"
		expect(stubPrompt).toContain('placeholder or stub');
		expect(stubPrompt).toContain('Short note (5 words)');
	});
});
