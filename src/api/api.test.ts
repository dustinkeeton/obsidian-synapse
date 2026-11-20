import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFolder } from 'obsidian';
import { createSynapseApi, API_VERSION, VERB_DEFINITIONS } from './index';
import type { SynapseApi } from './index';
import { checkSchema } from './validate';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { AIClient, ActivityLog, NotificationManager, UNTRUSTED_CONTENT_POLICY, jobOpId } from '../shared';
import type { AIRequestOptions } from '../shared';
import { createMockApp, memoryAdapter, mockFile } from '../__test-utils__/mock-factories';
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
	const deepDive = store([row('d1', { proposedPath: 'Deep Dives/A.md', topic: { title: 'A' }, depth: 0, generation: { provider: 'anthropic', model: 'claude-opus-5-5', stopReason: 'end_turn' } })]);
	const title = store([row('t1', { proposedTitle: 'Better' })]);
	const rem = store([row('r1', { candidates: [{ matchedText: 'alpha' }, { matchedText: 'beta' }] })]);
	const illustrate = store([row('i1', { items: [{ id: 'x' }, { id: 'y' }] })]);
	const modules = {
		elaboration: {
			getPendingProposals: elaboration.pending,
			acceptProposal: vi.fn(async () => true),
			rejectProposal: vi.fn(async () => undefined),
			scanNote: vi.fn(async () => ({ status: 'completed', message: 'Proposal generated', proposalIds: ['e2'], writtenPaths: [], cacheUse: { ai: true } })),
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
			run: vi.fn(async (_path: string, _options: unknown) => ({ status: 'completed', message: 'Generated 2 proposals', runId: 'run1', proposalIds: ['d1', 'd2'], writtenPaths: [], cacheUse: {} })),
			regenerate: vi.fn(async (_target: unknown) => ({ status: 'completed', message: 'Regenerated', runId: 'run1', proposalIds: ['d1'], writtenPaths: ['Deep Dives/A.md'], cacheUse: {} })),
			listContinuableRuns: vi.fn(async () => [{ runId: 'run1', rootNotePath: NOTE, remainingTopics: 4, totalProposals: 2, createdAt: '2026-11-01T00:00:00.000Z' }]),
			continueRun: vi.fn(async (_runId: string, _options: unknown) => ({
				status: 'completed', message: 'Generated 4 proposals', runId: 'run1', proposalIds: ['d3'], writtenPaths: [], cacheUse: {}, endReason: 'exhausted',
			})),
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
			scanBlocker: (): string | null => null,
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
	let notifications: NotificationManager;
	let activityLog: ActivityLog;

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
		notifications = new NotificationManager();
		activityLog = new ActivityLog(memoryAdapter());
		notifications.setActivitySink((entry) => activityLog.record(entry));
		listIncomplete = vi.fn(async () => []);
		api = createSynapseApi({
			app: app as never,
			pluginVersion: '9.9.9',
			getSettings: () => settings,
			modules: modules as unknown as FeatureModules,
			scanFns,
			notifications,
			checkpointManager: { listIncomplete } as never,
			activityLog,
		});
	});

	it('exposes its version', () => {
		expect(api.version).toBe(API_VERSION);
	});

	it('every verb result matches the result schema its definition declares (#628)', async () => {
		const results: Record<string, unknown[]> = {};
		const add = (verb: string, value: unknown) => { (results[verb] ??= []).push(value); };
		add('capabilities', api.capabilities());
		add('status', await api.status());
		const started = await api.deepDive.run(NOTE);
		add('deepDive.run', started);
		add('deepDive.run', await api.deepDive.run('missing.md'));
		add('elaborate', await api.elaborate(NOTE));
		add('scanFolder', await api.scanFolder('elaboration', 'notes'));
		add('deepDive.continue', await api.deepDive.continue('run1'));
		add('deepDive.regenerate', await api.deepDive.regenerate('d1'));
		add('jobs.wait', await api.jobs.wait(started.jobId ?? ''));
		add('jobs.wait', await api.jobs.wait('nope'));
		add('jobs.get', api.jobs.get(started.jobId ?? ''));
		add('jobs.get', api.jobs.get('nope'));
		add('jobs.cancel', api.jobs.cancel(started.jobId ?? ''));
		add('jobs.commit', await api.jobs.commit(started.jobId ?? '', [{ requestId: 'r', text: 't' }]));
		add('jobs.list', api.jobs.list());
		add('events.since', await api.events.since());
		add('proposals.list', await api.proposals.list());
		add('proposals.accept', await api.proposals.accept('organize', 'o1'));
		add('proposals.reject', await api.proposals.reject('title', 't1'));
		add('proposals.accept', await api.proposals.accept('title', 'nope'));

		expect(Object.keys(results).sort()).toEqual(VERB_DEFINITIONS.map((v) => v.name).sort());
		for (const { name, result } of VERB_DEFINITIONS) {
			for (const value of results[name]) expect(checkSchema(value, result, name)).toBeNull();
		}
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

	it('status lists capped deep dives that can continue, and null when deep dive is off (#625)', async () => {
		expect((await api.status()).continuableDeepDives).toEqual([expect.objectContaining({ runId: 'run1', remainingTopics: 4 })]);
		settings.deepDive.enabled = false;
		expect((await api.status()).continuableDeepDives).toBeNull();
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

		it('refuses option names inherited from Object.prototype', async () => {
			const result = await api.deepDive.run(NOTE, JSON.parse('{"constructor": 1}') as never);
			expect(result.error).toContain('unknown option "constructor"');
		});

		it('names the bad field of an object-form regenerate target', async () => {
			expect((await api.deepDive.regenerate({ proposalId: 1 } as never)).error).toBe('target.proposalId must be a string');
			expect((await api.deepDive.regenerate(42 as never)).error).toBe('target must be a string');
		});

		it('checks jobs verb arguments', async () => {
			expect(api.jobs.get(42 as never)).toEqual({ ok: false, job: null, error: 'id must be a string' });
			expect((await api.jobs.wait('job1', -5)).error).toBe('timeoutMs must be at least 0');
			expect(api.jobs.cancel(undefined as never).error).toBe('id is required');
		});

		it('requires the note path', async () => {
			expect((await api.elaborate(undefined as never)).error).toBe('notePath is required');
		});
	});

	/** Start a long verb and wait for its job; fails the test when no job started. */
	async function runJob(start: Promise<{ ok: boolean; jobId?: string; error?: string }>) {
		const started = await start;
		expect(started).toMatchObject({ ok: true });
		const waited = await api.jobs.wait(started.jobId!);
		expect(waited.timedOut).toBe(false);
		return waited.job!;
	}

	describe('elaborate', () => {
		it('runs as a job and reports the proposal id and cache use', async () => {
			const job = await runJob(api.elaborate(NOTE));
			expect(modules.elaboration.scanNote).toHaveBeenCalledWith(expect.objectContaining({ path: NOTE }) as unknown, true, { jobId: job.id, ai: expect.any(Object) as unknown });
			expect(job).toMatchObject({ verb: 'elaborate', status: 'completed', usage: { billing: 'plugin-key', calls: 0, maxCalls: null } });
			expect(job.result).toEqual({ ok: true, message: 'Proposal generated', written: [], proposals: ['e2'], cacheUse: { ai: true } });
		});

		it('refuses a missing note, a disabled feature and bad options without starting a job', async () => {
			expect((await api.elaborate('notes/Nope.md')).error).toContain('Note not found');
			expect((await api.elaborate(NOTE, { billing: 'free' } as never)).ok).toBe(false);
			expect((await api.elaborate(NOTE, { maxCalls: 0 })).ok).toBe(false);
			settings.elaboration.enabled = false;
			expect((await api.elaborate(NOTE)).error).toContain('disabled');
			expect(modules.elaboration.scanNote).not.toHaveBeenCalled();
		});

		it('never rejects; a thrown error fails the job, redacted', async () => {
			modules.elaboration.scanNote.mockRejectedValueOnce(new Error('upstream said sk-ant-api03-abcdefghijklmnop'));
			const job = await runJob(api.elaborate(NOTE));
			expect(job.status).toBe('failed');
			expect(job.error).not.toContain('abcdefghijklmnop');
		});
	});

	describe('scanFolder', () => {
		it('runs the scan as a job without confirmation and reports new proposal ids', async () => {
			vi.mocked(scanFns.elaboration).mockImplementationOnce(async () => {
				modules.elaboration.getPendingProposals.mockResolvedValue([
					{ id: 'e1', sourceNotePath: NOTE, createdAt: 't', status: 'pending' },
					{ id: 'e9', sourceNotePath: NOTE, createdAt: 't', status: 'pending' },
				]);
				return 2;
			});

			const job = await runJob(api.scanFolder('elaboration', 'notes', { recursive: false }));

			expect(scanFns.elaboration).toHaveBeenCalledWith({ folder: 'notes', recursive: false, jobId: job.id }, true);
			expect(job).toMatchObject({ verb: 'scanFolder', status: 'completed', result: { ok: true, proposals: ['e9'], count: 2, written: null } });
		});

		it('treats "" as the vault root and reports a void count as null', async () => {
			const job = await runJob(api.scanFolder('summarize', ''));
			expect(scanFns.summarize).toHaveBeenCalledWith({ folder: undefined, recursive: true, jobId: job.id }, true);
			expect(job.result).toMatchObject({ count: null });
		});

		it('ends failed when the scan\'s own operation errors, though the scan returned', async () => {
			vi.mocked(scanFns.tidy).mockImplementationOnce(async (target) => {
				notifications.startOperation('Tidying', jobOpId('tidy-vault', target)).error('Tidy failed -- quota');
				return 0;
			});
			const job = await runJob(api.scanFolder('tidy', 'notes'));
			expect(job).toMatchObject({ status: 'failed', error: 'Tidy failed -- quota' });
		});

		it('is cancelled through jobs.cancel', async () => {
			let release!: () => void;
			let signalStarted!: () => void;
			const scanStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
			vi.mocked(scanFns.rem).mockImplementationOnce(async (target) => {
				notifications.startOperation('REM scanning', jobOpId('rem-directory-scan', target));
				signalStarted();
				await new Promise<void>((resolve) => { release = resolve; });
				return 0;
			});
			const started = await api.scanFolder('rem', 'notes');
			await scanStarted;
			expect(api.jobs.get(started.jobId!).job?.progress?.message).toBe('REM scanning');
			expect(api.jobs.cancel(started.jobId!)).toEqual({ ok: true, stoppedOperations: 1 });
			release();
			expect((await api.jobs.wait(started.jobId!)).job?.status).toBe('cancelled');
		});

		it('refuses an unknown feature, a missing folder or a disabled feature without starting a job', async () => {
			expect((await api.scanFolder('nope' as never, 'notes')).error).toContain('feature must be one of');
			expect((await api.scanFolder('tidy', 'missing')).error).toContain('Folder not found');
			settings.tidy.enabled = false;
			expect((await api.scanFolder('tidy', 'notes')).error).toContain('disabled');
			expect(api.jobs.list()).toEqual([]);
			expect(scanFns.tidy).not.toHaveBeenCalled();
		});

		it('counts only new proposals for notes inside the scanned folder', async () => {
			vi.mocked(scanFns.elaboration).mockImplementationOnce(async () => {
				modules.elaboration.getPendingProposals.mockResolvedValue([
					{ id: 'e1', sourceNotePath: NOTE, createdAt: 't', status: 'pending' },
					{ id: 'mine', sourceNotePath: 'notes/sub/x.md', createdAt: 't', status: 'pending' },
					{ id: 'other-job', sourceNotePath: 'elsewhere/y.md', createdAt: 't', status: 'pending' },
				]);
				return 1;
			});
			const job = await runJob(api.scanFolder('elaboration', 'notes'));
			expect(job.result?.proposals).toEqual(['mine']);
		});

		it('refuses an illustrate scan that has nothing enabled to propose', async () => {
			settings.illustrate.enabled = true;
			modules.illustrate.scanBlocker = () => 'Illustrate has nothing to propose';
			expect(await api.scanFolder('illustrate', 'notes')).toEqual({ ok: false, error: 'Illustrate has nothing to propose' });
			expect(scanFns.illustrate).not.toHaveBeenCalled();
		});

		it('is available while any scan feature is on', () => {
			for (const key of ['elaboration', 'summarize', 'enrichment', 'rem', 'illustrate', 'tidy'] as const) settings[key].enabled = false;
			expect(api.capabilities().verbs.find((v) => v.name === 'scanFolder')?.available).toBe(true);
			settings.organize.enabled = false;
			expect(api.capabilities().verbs.find((v) => v.name === 'scanFolder')?.available).toBe(false);
		});
	});

	describe('deepDive', () => {
		it('runs as a job, passing options and the job id through', async () => {
			const job = await runJob(api.deepDive.run(NOTE, { depth: 2, maxNotes: 5 }));
			expect(modules.deepDive.run).toHaveBeenCalledWith(NOTE, { depth: 2, maxNotes: 5, jobId: job.id, ai: expect.any(Object) as unknown });
			expect(job).toMatchObject({ verb: 'deepDive.run', status: 'completed', result: { ok: true, runId: 'run1', proposals: ['d1', 'd2'] } });
		});

		it('refuses a missing note without starting a job', async () => {
			expect(await api.deepDive.run('notes/Nope.md')).toEqual({ ok: false, error: 'Note not found: notes/Nope.md' });
			expect(modules.deepDive.run).not.toHaveBeenCalled();
		});

		it('maps a failed outcome to a failed job', async () => {
			modules.deepDive.run.mockResolvedValueOnce({ status: 'failed', message: 'No topics found', proposalIds: [], writtenPaths: [], cacheUse: {} } as never);
			const job = await runJob(api.deepDive.run(NOTE));
			expect(job).toMatchObject({ status: 'failed', error: 'No topics found', result: { ok: false } });
		});

		it('returns why a run ended and how many topics are left (#625)', async () => {
			modules.deepDive.run.mockResolvedValueOnce({
				status: 'completed', message: 'Generated 2 proposals', runId: 'run1', proposalIds: ['d1', 'd2'], writtenPaths: [], cacheUse: {}, endReason: 'cap', remainingTopics: 4,
			} as never);
			const job = await runJob(api.deepDive.run(NOTE));
			expect(job.result).toMatchObject({ ok: true, endReason: 'cap', remainingTopics: 4 });
		});

		it('continues a capped run as a job (#625)', async () => {
			const job = await runJob(api.deepDive.continue('run1', { maxNotes: 10 }));
			expect(modules.deepDive.continueRun).toHaveBeenCalledWith('run1', { maxNotes: 10, jobId: job.id, ai: expect.any(Object) as unknown });
			expect(job).toMatchObject({ verb: 'deepDive.continue', status: 'completed', result: { ok: true, runId: 'run1', proposals: ['d3'], endReason: 'exhausted' } });
		});

		it('refuses to continue a run with nothing left, or bad options, without starting a job (#625)', async () => {
			expect((await api.deepDive.continue('run9')).error).toContain('No capped deep dive with id run9');
			expect((await api.deepDive.continue('run1', { depth: 2 } as never)).ok).toBe(false);
			expect(modules.deepDive.continueRun).not.toHaveBeenCalled();
		});

		it('reads a .md string as a note path and anything else as a proposal id', async () => {
			const first = await runJob(api.deepDive.regenerate('Deep Dives/A.md'));
			await runJob(api.deepDive.regenerate('abc123'));
			expect(first.verb).toBe('deepDive.regenerate');
			expect(modules.deepDive.regenerate).toHaveBeenNthCalledWith(1, { notePath: 'Deep Dives/A.md' }, { jobId: first.id, ai: expect.any(Object) as unknown });
			expect(modules.deepDive.regenerate).toHaveBeenNthCalledWith(2, { proposalId: 'abc123' }, expect.any(Object) as unknown);
		});
	});

	describe('external generation (#626)', () => {
		type Job = { jobId?: string; ai?: AIRequestOptions };
		const failed = (message: string) => ({ status: 'failed', message, proposalIds: [], writtenPaths: [], cacheUse: {} });

		/** scanNote as the module runs it: a job-tagged op around one real AIClient call per prompt. */
		function elaborateWith(prompts: string[]) {
			modules.elaboration.scanNote.mockImplementation((async (_file: unknown, _userInvoked: unknown, job: Job) => {
				const op = notifications.startOperation('Scanning', jobOpId(`scan-${NOTE}`, job));
				try {
					const client = new AIClient(() => settings, 'elaboration');
					const texts: string[] = [];
					for (const prompt of prompts) texts.push(await client.complete(prompt, 'You rewrite notes.', job.ai));
					op.finish('Proposal generated');
					return { status: 'completed', message: texts.join(' | '), proposalIds: ['e3'], writtenPaths: [], cacheUse: {} };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					op.error(message);
					return failed(message);
				}
			}) as never);
		}

		async function awaitingJob(options: Parameters<SynapseApi['elaborate']>[1] = { billing: 'external' }) {
			const started = await api.elaborate(NOTE, options);
			const waited = await api.jobs.wait(started.jobId!);
			expect(waited).toMatchObject({ ok: true, timedOut: false, job: { status: 'awaiting-output' } });
			return waited.job!;
		}

		it('hands the exact request to the caller and applies its output', async () => {
			elaborateWith(['Rewrite this stub']);
			const job = await awaitingJob();
			expect(job.requests).toHaveLength(1);
			const [request] = job.requests!;
			expect(request.feature).toBe('elaboration');
			expect(request.messages[0]).toMatchObject({ role: 'system' });
			expect(request.messages[0].content).toContain(UNTRUSTED_CONTENT_POLICY);
			expect(request.messages[1]).toEqual({ role: 'user', content: 'Rewrite this stub' });

			const committed = await api.jobs.commit(job.id, [{ requestId: request.id, text: 'A fuller note', model: 'claude-opus-5-5', usage: { inputTokens: 10, outputTokens: 5 } }]);
			expect(committed.job).toMatchObject({
				status: 'completed',
				result: { ok: true, message: 'A fuller note' },
				usage: { billing: 'external', calls: 1, maxCalls: null, inputTokens: 10, outputTokens: 5 },
			});
			expect(committed.job).not.toHaveProperty('requests');
		});

		it('returns from commit at the next request of a multi-call job', async () => {
			elaborateWith(['first', 'second']);
			const job = await awaitingJob();
			const next = await api.jobs.commit(job.id, [{ requestId: job.requests![0].id, text: 'one' }]);
			expect(next.job).toMatchObject({ status: 'awaiting-output' });
			expect(next.job!.requests![0].messages[1].content).toBe('second');
			const done = await api.jobs.commit(job.id, [{ requestId: next.job!.requests![0].id, text: 'two' }]);
			expect(done.job).toMatchObject({ status: 'completed', result: { message: 'one | two' }, usage: { calls: 2 } });
		});

		it('defaults to the feature setting, and a per-call billing overrides it', async () => {
			settings.elaboration.agentBilling = 'external';
			elaborateWith(['stub']);
			const job = await awaitingJob({});
			expect(job.usage?.billing).toBe('external');
			api.jobs.cancel(job.id);

			const keyed = await runJob(api.elaborate(NOTE, { billing: 'plugin-key', maxCalls: 1 }));
			expect(keyed.usage).toMatchObject({ billing: 'plugin-key', maxCalls: 1 });
		});

		it('refuses invalid outputs without applying any', async () => {
			elaborateWith(['stub']);
			const job = await awaitingJob();
			const requestId = job.requests![0].id;
			const unknown = await api.jobs.commit(job.id, [{ requestId, text: 'ok' }, { requestId: 'req-nope', text: 'x' }]);
			expect(unknown).toMatchObject({ ok: false, error: 'No pending request with id req-nope', job: { status: 'awaiting-output' } });
			expect((await api.jobs.commit(job.id, [{ requestId, text: 'a' }, { requestId, text: 'b' }])).error).toContain('answered twice');
			expect((await api.jobs.commit(job.id, [])).error).toBe('No outputs given');
			expect((await api.jobs.commit(job.id, [{ requestId } as never])).ok).toBe(false);
			expect((await api.jobs.commit(job.id, [{ requestId, text: 'done' }])).job?.status).toBe('completed');
			expect((await api.jobs.commit(job.id, [{ requestId, text: 'again' }])).error).toBe(`Job ${job.id} already completed`);
		});

		it('refuses commit on a job that bills the plugin key', async () => {
			let release!: () => void;
			modules.elaboration.scanNote.mockImplementationOnce(() => new Promise((resolve) => {
				release = () => resolve({ status: 'completed', message: 'Proposal generated', proposalIds: [], writtenPaths: [], cacheUse: { ai: false } });
			}));
			const started = await api.elaborate(NOTE, { billing: 'plugin-key' });
			expect((await api.jobs.commit(started.jobId!, [{ requestId: 'r', text: 't' }])).error).toBe(`Job ${started.jobId} does not use external billing`);
			release();
			expect((await api.jobs.wait(started.jobId!)).job?.status).toBe('completed');
		});

		it('discards a truncated output, failing the job', async () => {
			elaborateWith(['stub']);
			const job = await awaitingJob();
			const done = await api.jobs.commit(job.id, [{ requestId: job.requests![0].id, text: 'cut', truncated: true }]);
			expect(done.job).toMatchObject({ status: 'failed', error: expect.stringContaining('output limit') as unknown });
		});

		it('jobs.cancel fails the request the job waits on', async () => {
			elaborateWith(['stub']);
			const job = await awaitingJob();
			expect(api.jobs.cancel(job.id)).toEqual({ ok: true, stoppedOperations: 1 });
			const done = await api.jobs.wait(job.id);
			expect(done.job).toMatchObject({ status: 'cancelled', result: { ok: false, error: 'Job cancelled' } });
		});

		it('a toast Cancel fails the request the job waits on', async () => {
			elaborateWith(['stub']);
			const job = await awaitingJob();
			notifications.cancelOperation(jobOpId(`scan-${NOTE}`, { jobId: job.id }));
			expect((await api.jobs.wait(job.id)).job).toMatchObject({ status: 'cancelled' });
		});

		it('stops at maxCalls', async () => {
			elaborateWith(['first', 'second']);
			const job = await awaitingJob({ billing: 'external', maxCalls: 1 });
			const done = await api.jobs.commit(job.id, [{ requestId: job.requests![0].id, text: 'one' }]);
			expect(done.job).toMatchObject({ status: 'failed', error: 'This job reached its limit of 1 model call', usage: { calls: 1, maxCalls: 1 } });
		});

		it('passes billing to deep dive verbs, not as module options', async () => {
			await runJob(api.deepDive.run(NOTE, { depth: 2, billing: 'plugin-key', maxCalls: 3 }));
			expect(modules.deepDive.run).toHaveBeenCalledWith(NOTE, { depth: 2, jobId: expect.any(String) as unknown, ai: expect.any(Object) as unknown });
		});

		it('status reports each feature\'s default billing', async () => {
			settings.deepDive.agentBilling = 'external';
			const status = await api.status();
			expect(status.ai['deep-dive'].billing).toBe('external');
			expect(status.ai.elaboration.billing).toBe('plugin-key');
			expect(status.ai.tidy.billing).toBe('plugin-key');
		});
	});

	describe('events (#627)', () => {
		it('reads a job\'s operation ends from the activity log after a cursor', async () => {
			const job = await runJob(api.elaborate(NOTE, { billing: 'external' }).then(async (started) => {
				notifications.startOperation('Scanning', jobOpId(`scan-${NOTE}`, { jobId: started.jobId })).finish('Proposal generated');
				return started;
			}));
			notifications.info('Something else');

			const first = await api.events.since(0, 1);
			expect(first).toMatchObject({ ok: true, entries: [{ seq: 1, level: 'finish', message: 'Proposal generated', jobId: job.id, label: 'Scanning' }], cursor: 1, more: true, missed: false });
			const rest = await api.events.since(first.cursor);
			expect(rest).toMatchObject({ ok: true, entries: [{ seq: 2, level: 'info', message: 'Something else' }], cursor: 2, more: false });
		});

		it('refuses bad arguments and reports a read failure instead of rejecting', async () => {
			expect(await api.events.since(-1)).toMatchObject({ ok: false, entries: [], cursor: -1 });
			expect((await api.events.since(0, 501)).ok).toBe(false);
			vi.spyOn(activityLog, 'since').mockRejectedValueOnce(new Error('read failed'));
			expect(await api.events.since(4)).toEqual({ ok: false, error: 'read failed', entries: [], cursor: 4, more: false, missed: false });
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
			expect(list.items.find((p) => p.kind === 'deep-dive')).toMatchObject({
				notePath: 'Deep Dives/A.md', sourceNotePath: NOTE, generation: { provider: 'anthropic', stopReason: 'end_turn' },
			});
			expect(list.items.find((p) => p.kind === 'elaboration')).not.toHaveProperty('generation');
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
