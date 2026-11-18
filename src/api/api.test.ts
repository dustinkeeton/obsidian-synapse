import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFolder } from 'obsidian';
import { createSynapseApi, API_VERSION, VERB_DEFINITIONS } from './index';
import type { SynapseApi } from './index';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { InProgressRegistry } from '../shared';
import { createMockApp, mockFile } from '../__test-utils__/mock-factories';
import type { FeatureModules } from '../modules';
import type { PipelineModuleMap } from '../pipeline';

const NOTE = 'notes/Root.md';

function pendingList<T extends { id: string }>(items: T[]) {
	return vi.fn(async () => items.filter((item) => (item as { status?: string }).status !== 'done'));
}

function fakeModules() {
	const elaborationProposals = [{ id: 'e1', sourceNotePath: NOTE, createdAt: 't', status: 'pending' }];
	const remProposals = [{ id: 'r1', sourceNotePath: NOTE, createdAt: 't', status: 'pending', candidates: [{ matchedText: 'alpha' }, { matchedText: 'beta' }] }];
	const titleProposals = [{ id: 't1', sourceNotePath: NOTE, createdAt: 't', proposedTitle: 'Better', status: 'pending' }];
	const empty = () => ({ getPendingProposals: vi.fn(async () => []), acceptProposal: vi.fn(), rejectProposal: vi.fn() });
	return {
		elaboration: {
			getPendingProposals: pendingList(elaborationProposals),
			acceptProposal: vi.fn(async () => true),
			rejectProposal: vi.fn(async () => undefined),
			scanNote: vi.fn(async () => ({ ok: true, message: 'Proposal generated', proposalId: 'e2', writtenPaths: [], cacheUse: { ai: true } })),
		},
		enrichment: { getPendingProposals: vi.fn(async () => []), acceptSelectedFromView: vi.fn(), rejectFromView: vi.fn() },
		organize: empty(),
		deepDive: {
			...empty(),
			run: vi.fn(async () => ({ ok: true, message: 'Generated 2 proposals', runId: 'run1', proposalIds: ['d1', 'd2'], writtenPaths: [], cacheUse: {} })),
			regenerate: vi.fn(async () => ({ ok: true, message: 'Regenerated', runId: 'run1', proposalIds: ['d1'], writtenPaths: ['Deep Dives/A.md'], cacheUse: {} })),
		},
		title: {
			getPendingProposals: pendingList(titleProposals),
			acceptProposal: vi.fn(async () => ({ status: 'conflict', target: 'notes/Better.md' })),
			rejectProposal: vi.fn(),
		},
		rem: {
			getPendingProposals: pendingList(remProposals),
			acceptProposal: vi.fn(async () => { (remProposals[0] as { status: string }).status = 'done'; }),
			rejectProposal: vi.fn(),
		},
		illustrate: empty(),
		audio: {}, video: null, image: {}, summarize: {}, tidy: {}, intake: {},
	};
}

describe('createSynapseApi (#623)', () => {
	let settings: SynapseSettings;
	let modules: ReturnType<typeof fakeModules>;
	let scanFns: PipelineModuleMap;
	let app: ReturnType<typeof createMockApp>;
	let api: SynapseApi;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.ai.provider = 'anthropic';
		settings.ai.apiKey = 'sk-ant-secret-key';
		modules = fakeModules();
		app = createMockApp();
		app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === NOTE) return mockFile(NOTE);
			if (path === 'notes') return Object.assign(Object.create(TFolder.prototype) as TFolder, { path: 'notes' });
			return null;
		});
		scanFns = {
			elaboration: vi.fn(async () => 3),
			summarize: vi.fn(async () => undefined),
			enrichment: vi.fn(async () => 0),
			rem: vi.fn(async () => 0),
			illustrate: vi.fn(async () => 0),
			tidy: vi.fn(async () => 0),
			organize: vi.fn(async () => 0),
		};
		const inProgress = new InProgressRegistry();
		api = createSynapseApi({
			app: app as never,
			pluginVersion: '9.9.9',
			getSettings: () => settings,
			modules: modules as unknown as FeatureModules,
			scanFns,
			notifications: { inProgress } as never,
			checkpointManager: { listIncomplete: vi.fn(async () => []) } as never,
		});
	});

	it('exposes its version', () => {
		expect(api.version).toBe(API_VERSION);
	});

	describe('capabilities', () => {
		it('lists every verb with a JSON schema per parameter', () => {
			const caps = api.capabilities();
			expect(caps.verbs.map((v) => v.name)).toEqual(VERB_DEFINITIONS.map((v) => v.name));
			for (const verb of caps.verbs) for (const param of verb.params) expect(param.schema.type).toBeDefined();
		});

		it('marks a disabled feature\'s verbs unavailable', () => {
			settings.deepDive.enabled = false;
			const caps = api.capabilities();
			expect(caps.verbs.find((v) => v.name === 'deepDive.run')?.available).toBe(false);
			expect(caps.features.deepDive.enabled).toBe(false);
			expect(caps.verbs.find((v) => v.name === 'elaborate')?.available).toBe(true);
		});

		it('reports a missing key and an unbuilt module', () => {
			settings.ai.apiKey = '';
			const caps = api.capabilities();
			expect(caps.features.elaboration.keyReady).toBe(false);
			expect(caps.features.intake.keyReady).toBeNull();
			expect(caps.features.video.available).toBe(false);
		});
	});

	describe('status', () => {
		it('reports provider, model, effort and key source per feature, never a key', async () => {
			settings.ai.overrides = { tidy: { provider: 'openai', model: 'gpt-6-luna' } };
			const status = await api.status();

			expect(status.pluginVersion).toBe('9.9.9');
			expect(status.ai.elaboration).toMatchObject({ provider: 'anthropic', model: 'opus', keySource: 'default-key' });
			expect(status.ai.tidy).toMatchObject({ provider: 'openai', keySource: 'missing' });
			expect(JSON.stringify(status)).not.toContain('sk-ant-secret-key');
		});
	});

	describe('elaborate', () => {
		it('returns the proposal id and cache use', async () => {
			const result = await api.elaborate(NOTE);
			expect(result).toEqual({ ok: true, message: 'Proposal generated', written: [], proposals: ['e2'], cacheUse: { ai: true } });
		});

		it('refuses a missing note and a disabled feature', async () => {
			expect((await api.elaborate('notes/Nope.md')).error).toContain('Note not found');
			settings.elaboration.enabled = false;
			expect((await api.elaborate(NOTE)).error).toContain('disabled');
			expect(modules.elaboration.scanNote).not.toHaveBeenCalled();
		});

		it('never rejects; a thrown error comes back redacted', async () => {
			modules.elaboration.scanNote.mockRejectedValueOnce(new Error('upstream said sk-ant-api03-abcdefghijklmnop'));
			const result = await api.elaborate(NOTE);
			expect(result.ok).toBe(false);
			expect(result.error).not.toContain('abcdefghijklmnop');
		});
	});

	describe('scanFolder', () => {
		it('runs the scan without confirmation and reports new proposal ids', async () => {
			vi.mocked(scanFns.elaboration).mockImplementationOnce(async () => {
				modules.elaboration.getPendingProposals.mockResolvedValue([
					{ id: 'e1', sourceNotePath: NOTE, createdAt: 't', status: 'pending' },
					{ id: 'e9', sourceNotePath: NOTE, createdAt: 't', status: 'pending' },
				]);
				return 2;
			});

			const result = await api.scanFolder('elaboration', 'notes', { recursive: false });

			expect(scanFns.elaboration).toHaveBeenCalledWith({ folder: 'notes', recursive: false }, true);
			expect(result).toMatchObject({ ok: true, proposals: ['e9'], count: 2, written: null });
		});

		it('treats "" as the vault root and reports a void count as null', async () => {
			const result = await api.scanFolder('summarize', '');
			expect(scanFns.summarize).toHaveBeenCalledWith({ folder: undefined, recursive: true }, true);
			expect(result.count).toBeNull();
		});

		it('refuses an unknown feature or folder', async () => {
			expect((await api.scanFolder('nope' as never, 'notes')).error).toContain('Unknown scan feature');
			expect((await api.scanFolder('tidy', 'missing')).error).toContain('Folder not found');
		});
	});

	describe('deepDive', () => {
		it('passes run options through and maps the outcome', async () => {
			const result = await api.deepDive.run(NOTE, { depth: 2, maxNotes: 5 });
			expect(modules.deepDive.run).toHaveBeenCalledWith(NOTE, { depth: 2, maxNotes: 5 });
			expect(result).toMatchObject({ ok: true, runId: 'run1', proposals: ['d1', 'd2'] });
		});

		it('reads a .md string as a note path and anything else as a proposal id', async () => {
			await api.deepDive.regenerate('Deep Dives/A.md');
			await api.deepDive.regenerate('abc123');
			expect(modules.deepDive.regenerate).toHaveBeenNthCalledWith(1, { notePath: 'Deep Dives/A.md' });
			expect(modules.deepDive.regenerate).toHaveBeenNthCalledWith(2, { proposalId: 'abc123' });
		});
	});

	describe('proposals', () => {
		it('lists every kind with selectable items', async () => {
			const list = await api.proposals.list();
			expect(list.map((p) => `${p.kind}:${p.id}`)).toEqual(['elaboration:e1', 'title:t1', 'rem:r1']);
			expect(list.find((p) => p.kind === 'rem')?.items).toEqual(['alpha', 'beta']);
		});

		it('accepts elaboration without the modal, replacing only on force', async () => {
			await api.proposals.accept('elaboration', 'e1');
			await api.proposals.accept('elaboration', 'e1', { force: true });
			expect(modules.elaboration.acceptProposal).toHaveBeenNthCalledWith(1, 'e1', undefined, { onStale: 'skip' });
			expect(modules.elaboration.acceptProposal).toHaveBeenNthCalledWith(2, 'e1', undefined, { onStale: 'replace' });
		});

		it('accepts every REM link by default and confirms it left the pending list', async () => {
			const result = await api.proposals.accept('rem', 'r1');
			expect(modules.rem.acceptProposal).toHaveBeenCalledWith('r1', ['alpha', 'beta']);
			expect(result).toMatchObject({ ok: true, written: [NOTE], proposals: ['r1'] });
		});

		it('reports a title collision instead of resolving it', async () => {
			const result = await api.proposals.accept('title', 't1');
			expect(result.ok).toBe(false);
			expect(result.error).toContain('resolution');
		});

		it('refuses an unknown kind or a proposal that is not pending', async () => {
			expect((await api.proposals.accept('nope' as never, 'x')).error).toContain('Unknown proposal kind');
			expect((await api.proposals.reject('rem', 'missing')).error).toContain('No pending rem proposal');
		});
	});
});
