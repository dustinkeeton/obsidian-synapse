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

type Row = { id: string; status: string; sourceNotePath: string; createdAt: string; [key: string]: unknown };

/** A module's proposal store: pending list, lookup by id, and a status setter for its accept/reject. */
function store(items: Row[]) {
	return {
		items,
		pending: vi.fn(async () => items.filter((i) => i.status === 'pending')),
		get: vi.fn(async (id: string) => items.find((i) => i.id === id) ?? null),
		set: (id: string, status: string) => { const row = items.find((i) => i.id === id); if (row) row.status = status; },
	};
}

const row = (id: string, extra: Record<string, unknown> = {}): Row => ({ id, status: 'pending', sourceNotePath: NOTE, createdAt: 't', ...extra });

function fakeModules() {
	const elaboration = store([row('e1')]);
	const enrichment = store([row('n1', { result: { tags: [{ tag: 'a' }], internalLinks: [], externalLinks: [], frontmatter: [] } })]);
	const organize = store([row('o1', { proposedDirectory: 'Archive' })]);
	const deepDive = store([row('d1', { proposedPath: 'Deep Dives/A.md', topic: { title: 'A' }, depth: 0 })]);
	const title = store([row('t1', { proposedTitle: 'Better' })]);
	const rem = store([row('r1', { candidates: [{ matchedText: 'alpha' }, { matchedText: 'beta' }] })]);
	const illustrate = store([row('i1', { items: [{ id: 'x' }, { id: 'y' }] })]);
	const modules = {
		elaboration: {
			getPendingProposals: elaboration.pending,
			acceptProposal: vi.fn(async () => true),
			rejectProposal: vi.fn(async () => undefined),
			scanNote: vi.fn(async () => ({ ok: true, message: 'Proposal generated', proposalId: 'e2', writtenPaths: [], cacheUse: { ai: true } })),
		},
		enrichment: {
			getPendingProposals: enrichment.pending,
			getProposal: enrichment.get,
			acceptSelectedFromView: vi.fn(async (id: string) => enrichment.set(id, 'accepted')),
			rejectFromView: vi.fn(),
		},
		organize: {
			getPendingProposals: organize.pending,
			getProposal: organize.get,
			acceptProposal: vi.fn(async (id: string) => organize.set(id, 'accepted')),
			rejectProposal: vi.fn(),
		},
		deepDive: {
			getPendingProposals: deepDive.pending,
			acceptProposal: vi.fn(async () => true),
			rejectProposal: vi.fn(),
			run: vi.fn(async () => ({ ok: true, message: 'Generated 2 proposals', runId: 'run1', proposalIds: ['d1', 'd2'], writtenPaths: [], cacheUse: {} })),
			regenerate: vi.fn(async () => ({ ok: true, message: 'Regenerated', runId: 'run1', proposalIds: ['d1'], writtenPaths: ['Deep Dives/A.md'], cacheUse: {} })),
		},
		title: {
			getPendingProposals: title.pending,
			acceptProposal: vi.fn(async () => ({ status: 'conflict', target: 'notes/Better.md' })),
			rejectProposal: vi.fn(),
		},
		rem: {
			getPendingProposals: rem.pending,
			getProposal: rem.get,
			acceptProposal: vi.fn(async (id: string) => rem.set(id, 'partially-accepted')),
			rejectProposal: vi.fn(),
		},
		illustrate: {
			getPendingProposals: illustrate.pending,
			getProposal: illustrate.get,
			acceptProposal: vi.fn(async (id: string) => illustrate.set(id, 'accepted')),
			rejectProposal: vi.fn(),
		},
		audio: {}, video: null, image: {}, summarize: {}, tidy: {}, intake: {},
	};
	// Non-enumerable so the api, which keys features off Object.keys(modules), never sees it.
	return Object.defineProperty(modules, 'stores', { value: { elaboration, enrichment, organize, deepDive, title, rem, illustrate } }) as typeof modules & {
		stores: Record<'elaboration' | 'enrichment' | 'organize' | 'deepDive' | 'title' | 'rem' | 'illustrate', ReturnType<typeof store>>;
	};
}

describe('createSynapseApi (#623)', () => {
	let settings: SynapseSettings;
	let modules: ReturnType<typeof fakeModules>;
	let scanFns: PipelineModuleMap;
	let app: ReturnType<typeof createMockApp>;
	let api: SynapseApi;
	let listIncomplete: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.ai.provider = 'anthropic';
		settings.ai.apiKey = 'sk-ant-secret-key';
		modules = fakeModules();
		app = createMockApp();
		app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === NOTE || path === 'Archive/Root.md') return mockFile(path);
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
		listIncomplete = vi.fn(async () => []);
		api = createSynapseApi({
			app: app as never,
			pluginVersion: '9.9.9',
			getSettings: () => settings,
			modules: modules as unknown as FeatureModules,
			scanFns,
			notifications: { inProgress } as never,
			checkpointManager: { listIncomplete } as never,
		});
	});

	it('exposes its version', () => {
		expect(api.version).toBe(API_VERSION);
	});

	describe('capabilities', () => {
		it('lists every verb with a JSON schema per parameter', () => {
			const caps = api.capabilities();
			expect(caps.verbs.map((v) => v.name)).toEqual(VERB_DEFINITIONS.map((v) => v.name));
			for (const verb of caps.verbs) for (const param of verb.params) expect(param.schema.type ?? param.schema.oneOf).toBeDefined();
		});

		it('names only verbs that exist on the api object', () => {
			for (const { name } of VERB_DEFINITIONS) {
				const verb = name.split('.').reduce<unknown>((obj, key) => (obj as Record<string, unknown>)?.[key], api);
				expect(typeof verb, name).toBe('function');
			}
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

	it('status reports checkpoints as null when they cannot be read', async () => {
		listIncomplete.mockRejectedValueOnce(new Error('disk'));
		expect((await api.status()).checkpoints).toBeNull();
	});

	describe('argument validation', () => {
		it.each([
			[{ maxNotes: Number.NaN }, 'options.maxNotes must be an integer'],
			[{ depth: 0 }, 'options.depth must be at least 1'],
			[{ depth: 7 }, 'options.depth must be at most 6'],
			[{ autoAccept: 'yes' }, 'options.autoAccept must be true or false'],
			[{ maxNote: 3 }, 'unknown option "maxNote"'],
		])('refuses deepDive.run options %j', async (options, error) => {
			const result = await api.deepDive.run(NOTE, options as never);
			expect(result.ok).toBe(false);
			expect(result.error).toContain(error);
			expect(modules.deepDive.run).not.toHaveBeenCalled();
		});

		it('accepts both regenerate target forms and refuses others', async () => {
			expect((await api.deepDive.regenerate({ proposalId: 'd1' })).ok).toBe(true);
			expect((await api.deepDive.regenerate({ notePath: 'Deep Dives/A.md' })).ok).toBe(true);
			expect((await api.deepDive.regenerate({ id: 'd1' } as never)).ok).toBe(false);
			expect((await api.deepDive.regenerate(42 as never)).ok).toBe(false);
		});

		it('requires the note path', async () => {
			expect((await api.elaborate(undefined as never)).error).toBe('notePath is required');
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
			expect((await api.scanFolder('nope' as never, 'notes')).error).toContain('feature must be one of');
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
			expect(list.ok).toBe(true);
			expect(list.items.map((p) => `${p.kind}:${p.id}`)).toEqual([
				'elaboration:e1', 'enrichment:n1', 'organize:o1', 'deep-dive:d1', 'title:t1', 'rem:r1', 'illustrate:i1',
			]);
			expect(list.items.find((p) => p.kind === 'rem')?.items).toEqual(['alpha', 'beta']);
			expect(list.items.find((p) => p.kind === 'deep-dive')).toMatchObject({ notePath: 'Deep Dives/A.md', sourceNotePath: NOTE });
		});

		it('list reports a store failure instead of rejecting', async () => {
			modules.rem.getPendingProposals.mockRejectedValueOnce(new Error('bad json'));
			expect(await api.proposals.list()).toEqual({ ok: false, error: 'bad json', items: [] });
			expect((await api.proposals.list('nope' as never)).ok).toBe(false);
		});

		it('accepts elaboration without the modal, replacing only on force', async () => {
			await api.proposals.accept('elaboration', 'e1');
			await api.proposals.accept('elaboration', 'e1', { force: true });
			expect(modules.elaboration.acceptProposal).toHaveBeenNthCalledWith(1, 'e1', undefined, { onStale: 'skip' });
			expect(modules.elaboration.acceptProposal).toHaveBeenNthCalledWith(2, 'e1', undefined, { onStale: 'replace' });
		});

		it('says the elaboration note is gone rather than changed', async () => {
			modules.stores.elaboration.items[0].sourceNotePath = 'notes/Gone.md';
			const result = await api.proposals.accept('elaboration', 'e1');
			expect(result.error).toContain('no longer exists');
			expect(modules.elaboration.acceptProposal).not.toHaveBeenCalled();
		});

		it('accepts every REM link by default and counts partially-accepted as applied', async () => {
			const result = await api.proposals.accept('rem', 'r1');
			expect(modules.rem.acceptProposal).toHaveBeenCalledWith('r1', ['alpha', 'beta']);
			expect(result).toMatchObject({ ok: true, written: [NOTE], proposals: ['r1'] });
		});

		it.each([[[]], [['gamma']]])('refuses REM items %j without calling the module', async (items) => {
			const result = await api.proposals.accept('rem', 'r1', { items });
			expect(result.ok).toBe(false);
			expect(modules.rem.acceptProposal).not.toHaveBeenCalled();
		});

		it('passes an illustrate item subset through', async () => {
			const result = await api.proposals.accept('illustrate', 'i1', { items: ['y'] });
			expect(modules.illustrate.acceptProposal).toHaveBeenCalledWith('i1', ['y']);
			expect(result.ok).toBe(true);
		});

		it('reports a proposal the module rejected during accept as not applied', async () => {
			modules.enrichment.acceptSelectedFromView.mockImplementationOnce(async (id: string) => modules.stores.enrichment.set(id, 'rejected'));
			const result = await api.proposals.accept('enrichment', 'n1');
			expect(result).toMatchObject({ ok: false, error: 'Proposal was not applied (status: rejected)' });
		});

		it('accepts enrichment with every item and organize with the moved path', async () => {
			expect(await api.proposals.accept('enrichment', 'n1')).toMatchObject({ ok: true, written: [NOTE] });
			expect(modules.enrichment.acceptSelectedFromView).toHaveBeenCalledWith('n1');
			expect(await api.proposals.accept('organize', 'o1')).toMatchObject({ ok: true, written: ['Archive/Root.md'] });
		});

		it('maps the deep-dive accept boolean', async () => {
			expect(await api.proposals.accept('deep-dive', 'd1')).toMatchObject({ ok: true, written: ['Deep Dives/A.md'] });
			modules.deepDive.acceptProposal.mockResolvedValueOnce(false);
			expect((await api.proposals.accept('deep-dive', 'd1')).ok).toBe(false);
		});

		it('reports a title collision instead of resolving it', async () => {
			const result = await api.proposals.accept('title', 't1');
			expect(result.ok).toBe(false);
			expect(result.error).toContain('resolution');
		});

		it('refuses an unknown kind or a proposal that is not pending', async () => {
			expect((await api.proposals.accept('nope' as never, 'x')).error).toContain('kind must be one of');
			expect((await api.proposals.reject('rem', 'missing')).error).toContain('No pending rem proposal');
		});
	});
});
