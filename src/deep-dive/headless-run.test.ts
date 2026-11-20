import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepDiveModule } from './index';
import { DeepDiveStore } from './deep-dive-store';
import { selectDepth } from './depth-selector-modal';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin, TFile } from 'obsidian';
import { AIClient, ENRICHMENT_END, ENRICHMENT_START, NoteOperationQueue, JobCallRefusedError } from '../shared';
import type { DeepDiveProposal, DeepDiveRun } from './types';
import { syllabusPath } from './syllabus-navigator';

vi.mock('./depth-selector-modal', () => ({
	selectDepth: vi.fn(async () => 1),
	MIN_DEPTH: 1,
	MAX_DEPTH: 6,
}));

const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

const TOPIC_TITLES = ['Backpropagation', 'Gradient Descent', 'Overfitting'];
const TOPICS = JSON.stringify(TOPIC_TITLES.map((title) => ({ title, description: `About ${title}`, relevance: 0.9 })));

function proposal(overrides: Partial<DeepDiveProposal>): DeepDiveProposal {
	return {
		id: 'p1',
		runId: 'run1',
		sourceNotePath: 'notes/Root.md',
		topic: { title: 'Backpropagation', description: 'About Backpropagation', relevance: 0.9, existsInVault: false, relatedUrls: [] },
		proposedPath: 'Deep Dives/Root/Backpropagation.md',
		proposedContent: 'old content',
		depth: 0,
		qualityScore: { score: 0.9, topicCount: 0, wordCount: 10, isTooGeneric: false, hasHighOverlap: false, reasoning: '' },
		childProposalIds: [],
		createdAt: '2026-11-01T00:00:00.000Z',
		status: 'pending',
		...overrides,
	};
}

describe('DeepDiveModule headless verbs', () => {
	let settings: SynapseSettings;
	let app: ReturnType<typeof createMockApp>;
	let mod: DeepDiveModule;
	let proposals: Map<string, DeepDiveProposal>;
	let savedRun: DeepDiveRun | null;
	let generated: string[];
	let confirm: ReturnType<typeof vi.fn>;
	let files: Map<string, string>;
	let failOn: string | null;
	let onGenerate: ((topic: string) => void) | null;
	let register: ReturnType<typeof vi.fn>;
	let checkpoints: ReturnType<typeof createMockCheckpointManager>;
	let startOperation: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		settings = structuredClone(DEFAULT_SETTINGS);
		proposals = new Map();
		savedRun = null;
		generated = [];
		failOn = null;
		onGenerate = null;
		vi.mocked(selectDepth).mockClear();
		files = new Map([['notes/Root.md', '# Root\n\nA note about neural network training.']]);

		app = createMockApp();
		app.vault.getAbstractFileByPath.mockImplementation((p: string) => (files.has(p) ? mockFile(p) : null));
		app.vault.read.mockImplementation(async (file: { path: string }) => files.get(file.path) ?? '');
		app.vault.process.mockImplementation(async (file: { path: string }, fn: (data: string) => string) => {
			const next = fn(files.get(file.path) ?? '');
			files.set(file.path, next);
			return next;
		});

		confirm = vi.fn().mockResolvedValue(true);
		const notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			confirm,
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: false })),
		};
		startOperation = notifications.startOperation;

		vi.spyOn(DeepDiveStore.prototype, 'init').mockResolvedValue(undefined);
		vi.spyOn(DeepDiveStore.prototype, 'saveProposal').mockImplementation(async (p) => { proposals.set(p.id, structuredClone(p)); });
		vi.spyOn(DeepDiveStore.prototype, 'loadProposal').mockImplementation(async (id) => structuredClone(proposals.get(id) ?? null));
		vi.spyOn(DeepDiveStore.prototype, 'loadAllProposals').mockImplementation(async () => [...proposals.values()]);
		vi.spyOn(DeepDiveStore.prototype, 'loadProposalsByRunId').mockImplementation(async (runId) => [...proposals.values()].filter((p) => p.runId === runId));
		vi.spyOn(DeepDiveStore.prototype, 'saveRun').mockImplementation(async (run) => { savedRun = structuredClone(run); });
		vi.spyOn(DeepDiveStore.prototype, 'loadRun').mockImplementation(async () => structuredClone(savedRun));
		vi.spyOn(DeepDiveStore.prototype, 'loadAllRuns').mockImplementation(async () => (savedRun ? [structuredClone(savedRun)] : []));

		vi.spyOn(AIClient.prototype, 'complete').mockImplementation(async (userPrompt: string, systemPrompt?: string) => {
			if (systemPrompt?.includes('knowledge graph analyst')) return TOPICS;
			const topic = TOPIC_TITLES.find((t) => userPrompt.includes(t)) ?? '';
			if (topic === failOn) throw new Error('The network connection was lost.');
			onGenerate?.(topic);
			generated.push(topic);
			return `## About\n\nFresh body about ${topic}.`;
		});

		register = vi.fn();
		checkpoints = createMockCheckpointManager();
		mod = new DeepDiveModule(
			makeModuleDeps({
				plugin: { app, registerEvent: vi.fn() } as unknown as Plugin,
				getSettings: () => settings,
				notifications: notifications as never,
				checkpointManager: checkpoints as never,
				registrar: { register } as never,
				noteQueue: new NoteOperationQueue(),
			}),
			() => false
		);
		await mod.onload();
	});

	afterEach(() => vi.restoreAllMocks());

	describe('run', () => {
		it('opens neither the depth picker nor the confirm prompt', async () => {
			const outcome = await mod.run('notes/Root.md', { depth: 1 });

			expect(selectDepth).not.toHaveBeenCalled();
			expect(confirm).not.toHaveBeenCalled();
			expect(outcome.status).toBe('completed');
			expect(outcome.runId).toBe(savedRun?.id);
			expect(outcome.proposalIds).toHaveLength(3);
			expect(outcome.writtenPaths).toEqual([]);
		});

		it('stops at the per-run note cap and records it on the run', async () => {
			const outcome = await mod.run('notes/Root.md', { depth: 1, maxNotes: 1 });

			expect(generated).toEqual(['Backpropagation']);
			expect(outcome.proposalIds).toHaveLength(1);
			expect(savedRun?.maxNotes).toBe(1);
		});

		it('keeps the remaining topics when it stops at the cap, and says so (#625)', async () => {
			const outcome = await mod.run('notes/Root.md', { depth: 1, maxNotes: 1 });

			expect(outcome).toMatchObject({ status: 'completed', endReason: 'cap', remainingTopics: 2 });
			expect(savedRun).toMatchObject({ status: 'completed', endReason: 'cap' });
			expect(savedRun?.pending?.tasks.map((t) => t.topic.title)).toEqual(['Gradient Descent', 'Overfitting']);
		});

		it('drops the queue and records exhausted when every topic was generated (#625)', async () => {
			const outcome = await mod.run('notes/Root.md', { depth: 1 });

			expect(outcome.endReason).toBe('exhausted');
			expect(outcome).not.toHaveProperty('remainingTopics');
			expect(savedRun?.endReason).toBe('exhausted');
			expect(savedRun?.pending).toBeUndefined();
		});

		it('records error on an interrupted run and clears it when the run resumes (#625)', async () => {
			failOn = 'Gradient Descent';
			await mod.run('notes/Root.md', { depth: 1 });
			expect(savedRun).toMatchObject({ status: 'in-progress', endReason: 'error' });
			failOn = null;

			await mod.resumeFromCheckpoint({ id: 'mockcheckpoint', metadata: { runId: savedRun?.id }, remainingItems: [] } as never);

			expect(savedRun).toMatchObject({ status: 'completed', endReason: 'exhausted' });
		});

		it('records the stop reason, model and usage of each generated note (#625)', async () => {
			const complete = vi.mocked(AIClient.prototype.complete);
			const base = complete.getMockImplementation()!;
			complete.mockImplementation(async (user, system, opts) => {
				const text = await base(user, system, opts);
				opts?.onResponse?.({ provider: 'anthropic', model: 'claude-opus-5-5', stopReason: 'end_turn', usage: { outputTokens: 321 } });
				return text;
			});

			const outcome = await mod.run('notes/Root.md', { depth: 1, maxNotes: 1 });

			expect(proposals.get(outcome.proposalIds[0])?.generation).toEqual({
				provider: 'anthropic', model: 'claude-opus-5-5', stopReason: 'end_turn', usage: { outputTokens: 321 },
			});
		});

		it('joins the job\'s AI options into every model call, keeping the proposal\'s own generation record (#626)', async () => {
			const complete = vi.mocked(AIClient.prototype.complete);
			const base = complete.getMockImplementation()!;
			complete.mockImplementation(async (user, system, opts) => {
				opts?.beforeCall?.();
				const text = await base(user, system, opts);
				opts?.onResponse?.({ provider: 'external', model: 'agent' });
				return text;
			});
			const ai = { beforeCall: vi.fn(), onResponse: vi.fn() };

			const outcome = await mod.run('notes/Root.md', { depth: 1, ai });

			expect(ai.beforeCall).toHaveBeenCalledTimes(4);
			expect(ai.onResponse).toHaveBeenCalledTimes(4);
			expect(proposals.get(outcome.proposalIds[0])?.generation).toEqual({ provider: 'external', model: 'agent' });
		});

		it('ends as cancelled when a cancel rejects the model call in flight (#626)', async () => {
			const genOp = { progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: false };
			startOperation.mockImplementation((label: string) => label === 'Generating deep dive'
				? genOp
				: { progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: false });
			onGenerate = () => {
				genOp.cancelled = true;
				throw new Error('Job cancelled');
			};

			const outcome = await mod.run('notes/Root.md', { depth: 1 });

			expect(outcome).toMatchObject({ status: 'cancelled', endReason: 'cancelled', proposalIds: [] });
			expect(savedRun).toMatchObject({ status: 'cancelled', endReason: 'cancelled' });
			expect(savedRun?.pending).toBeUndefined();
			expect(checkpoints.discard).toHaveBeenCalled();
			expect(genOp.error).not.toHaveBeenCalled();
		});

		it('stops with a resumable error when the job refuses a child-topic extraction, instead of dropping the subtree (#626)', async () => {
			const complete = vi.mocked(AIClient.prototype.complete);
			const base = complete.getMockImplementation()!;
			complete.mockImplementation(async (user, system, opts) => {
				opts?.beforeCall?.();
				return base(user, system, opts);
			});
			let calls = 0;
			const ai = { beforeCall: () => { if (++calls > 2) throw new JobCallRefusedError('This job reached its limit of 2 model calls'); } };

			const outcome = await mod.run('notes/Root.md', { depth: 2, ai });

			expect(outcome).toMatchObject({ status: 'failed', endReason: 'error' });
			expect(outcome.message).toContain('limit of 2 model calls');
			expect(outcome.proposalIds).toEqual([]);
			expect(savedRun).toMatchObject({ status: 'in-progress', endReason: 'error' });
			expect(checkpoints.discard).not.toHaveBeenCalled();
		});

		it('ends as cancelled when a cancel rejects topic extraction (#626)', async () => {
			const scanOp = { progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: false };
			startOperation.mockImplementation(() => scanOp);
			vi.mocked(AIClient.prototype.complete).mockImplementation(async () => {
				scanOp.cancelled = true;
				throw new Error('Job cancelled');
			});

			const outcome = await mod.run('notes/Root.md', { depth: 1 });

			expect(outcome).toMatchObject({ status: 'cancelled', message: 'Deep dive cancelled' });
			expect(savedRun).toBeNull();
		});

		it('clamps depth to the picker range', async () => {
			await mod.run('notes/Root.md', { depth: 99, maxNotes: 1 });
			expect(savedRun?.maxDepth).toBe(6);
		});

		it('accepts every generated note when autoAccept is true, regardless of the setting', async () => {
			const accept = vi.spyOn(mod, 'acceptProposal').mockResolvedValue(true);

			const outcome = await mod.run('notes/Root.md', { depth: 1, autoAccept: true });

			expect(accept).toHaveBeenCalledTimes(3);
			expect(outcome.writtenPaths).toHaveLength(3);
		});

		it('keeps the per-run cap when an interrupted run resumes', async () => {
			failOn = 'Gradient Descent';
			await mod.run('notes/Root.md', { depth: 1, maxNotes: 2 });
			failOn = null;

			await mod.resumeFromCheckpoint({ id: 'mockcheckpoint', metadata: { runId: savedRun?.id }, remainingItems: [] } as never);

			expect(generated).toEqual(['Backpropagation', 'Gradient Descent']);
			expect(savedRun?.status).toBe('completed');
		});

		it('gives each run its own in-progress op id', async () => {
			await mod.run('notes/Root.md', { depth: 1, maxNotes: 1 });
			const startOperation = (mod as unknown as { notifications: { startOperation: { mock: { calls: unknown[][] } } } }).notifications.startOperation;
			expect(startOperation.mock.calls.map((c) => String(c[1]))).toContain(`deep-dive-generate-${savedRun?.id}`);
		});

		it('tags both of its operations with the job id when a public-API job runs it (#624)', async () => {
			await mod.run('notes/Root.md', { depth: 1, maxNotes: 1, jobId: 'j3' });
			const startOperation = (mod as unknown as { notifications: { startOperation: { mock: { calls: unknown[][] } } } }).notifications.startOperation;
			expect(startOperation.mock.calls.map((c) => String(c[1]))).toEqual([
				'deep-dive-scan-notes/Root.md@job:j3',
				`deep-dive-generate-${savedRun?.id}@job:j3`,
			]);
			expect(savedRun).not.toHaveProperty('jobId');
		});

		it('the palette command asks for depth before confirming', async () => {
			const spec = register.mock.calls.find((c) => c[0] === 'deep-dive')?.[2] as {
				editorCallback: (editor: unknown, ctx: { file: TFile }) => Promise<void>;
			};
			await spec.editorCallback({}, { file: mockFile('notes/Root.md') });

			expect(vi.mocked(selectDepth).mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]);
			expect(confirm.mock.calls[0][0]).toContain('(depth 1)');
		});

		it('stops before creating a run when cancelled during topic extraction', async () => {
			const startOperation = (mod as unknown as { notifications: { startOperation: ReturnType<typeof vi.fn> } }).notifications.startOperation;
			startOperation.mockImplementationOnce(() => ({ progress: vi.fn(), update: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: true }));

			const outcome = await mod.run('notes/Root.md', { depth: 1 });

			expect(outcome).toMatchObject({ status: 'cancelled', message: 'Deep dive cancelled' });
			expect(savedRun).toBeNull();
			expect(checkpoints.create).not.toHaveBeenCalled();
		});

		it('reports a missing note without starting a run', async () => {
			const outcome = await mod.run('notes/Missing.md');

			expect(outcome.status).toBe('failed');
			expect(outcome.message).toContain('Note not found');
			expect(savedRun).toBeNull();
		});
	});

	describe('continueRun (#625)', () => {
		it('generates the remaining topics under a fresh cap, in the same run', async () => {
			const first = await mod.run('notes/Root.md', { depth: 1, maxNotes: 1 });

			const outcome = await mod.continueRun(first.runId!);

			expect(generated).toEqual(['Backpropagation', 'Gradient Descent']);
			expect(outcome).toMatchObject({ status: 'completed', runId: first.runId, endReason: 'cap', remainingTopics: 1 });
			expect(outcome.proposalIds).toHaveLength(1);
			expect(savedRun?.proposalIds).toHaveLength(2);
			expect(checkpoints.create).toHaveBeenCalledTimes(2);
		});

		it('takes a new cap and finishes the run', async () => {
			const first = await mod.run('notes/Root.md', { depth: 1, maxNotes: 1 });

			const outcome = await mod.continueRun(first.runId!, { maxNotes: 10 });

			expect(generated).toEqual(TOPIC_TITLES);
			expect(outcome.endReason).toBe('exhausted');
			expect(savedRun?.pending).toBeUndefined();
			expect(await mod.listContinuableRuns()).toEqual([]);
		});

		it('lists a capped run until it is continued or discarded', async () => {
			const first = await mod.run('notes/Root.md', { depth: 1, maxNotes: 1 });

			expect(await mod.listContinuableRuns()).toEqual([
				expect.objectContaining({ runId: first.runId, rootNotePath: 'notes/Root.md', remainingTopics: 2, totalProposals: 1 }),
			]);
			expect(await mod.discardContinuation(first.runId!)).toBe(true);
			expect(await mod.listContinuableRuns()).toEqual([]);
			expect(savedRun?.endReason).toBe('cap');
		});

		it('auto-accepts only the proposals this pass generates', async () => {
			const first = await mod.run('notes/Root.md', { depth: 1, maxNotes: 1, autoAccept: false });
			const accept = vi.spyOn(mod, 'acceptProposal').mockResolvedValue(true);

			const outcome = await mod.continueRun(first.runId!, { autoAccept: true });

			expect(accept.mock.calls.map((c) => c[0])).toEqual(outcome.proposalIds);
			expect(accept.mock.calls.map((c) => c[0])).not.toContain(first.proposalIds[0]);
		});

		it('toasts each refusal, since the toast and sidebar callers ignore the outcome', async () => {
			const info = (mod as unknown as { notifications: { info: ReturnType<typeof vi.fn> } }).notifications.info;

			await mod.continueRun('nope');

			expect(info).toHaveBeenCalledWith('No deep dive run with id nope');
		});

		it('refuses a run that did not stop at its cap', async () => {
			const first = await mod.run('notes/Root.md', { depth: 1 });

			const outcome = await mod.continueRun(first.runId!);

			expect(outcome).toMatchObject({ status: 'failed', message: 'This deep dive has no remaining topics to continue' });
		});

		it('refuses an unknown run and a missing root note', async () => {
			expect((await mod.continueRun('nope')).status).toBe('failed');
			savedRun = null;
			const first = await mod.run('notes/Root.md', { depth: 1, maxNotes: 1 });
			files.delete('notes/Root.md');

			expect((await mod.continueRun(first.runId!)).message).toContain('Source note not found');
		});

		it('offers Continue on the finish toast when the run is capped', async () => {
			await mod.run('notes/Root.md', { depth: 1, maxNotes: 1 });
			const startOperation = (mod as unknown as { notifications: { startOperation: { mock: { results: Array<{ value: { finish: { mock: { calls: unknown[][] } } } }> } } } }).notifications.startOperation;
			const genFinish = startOperation.mock.results[1].value.finish.mock.calls[0];

			expect(String(genFinish[0])).toContain('stopped at the 1-note cap with 2 topics left');
			expect(genFinish[1]).toMatchObject({ label: 'Continue' });
		});
	});

	describe('following renamed notes (#632)', () => {
		const oldPath = 'Deep Dives/Root/Backpropagation.md';
		const run = (overrides: Partial<DeepDiveRun> = {}): DeepDiveRun => ({
			id: 'run1', rootNotePath: 'notes/Root.md', maxDepth: 1, qualityThreshold: 0.4, proposalIds: ['p1'],
			stats: { totalProposals: 1, byDepth: { 0: 1 }, earlyTerminations: 0 }, createdAt: '2026-11-01T00:00:00.000Z', status: 'completed', ...overrides,
		});

		it('listens to vault renames and follows them', async () => {
			proposals.set('p1', proposal({ status: 'accepted' }));
			const [event, handler] = app.vault.on.mock.calls.find(([name]) => name === 'rename') as unknown as [string, (file: TFile, old: string) => void];
			expect(event).toBe('rename');
			handler(mockFile('Notes/Backprop.md'), oldPath);
			await vi.waitFor(() => expect(proposals.get('p1')?.proposedPath).toBe('Notes/Backprop.md'));
		});

		it('regenerates an accepted note by its new path after a rename', async () => {
			proposals.set('p1', proposal({ status: 'accepted' }));
			const newPath = 'Notes/Backprop.md';
			files.set(newPath, '---\nparent: "[[Root]]"\n---\nOld body\n');

			await mod.followRename(oldPath, newPath);
			const outcome = await mod.regenerate({ notePath: newPath });

			expect(outcome.status).toBe('completed');
			expect(outcome.writtenPaths).toEqual([newPath]);
			expect(files.get(newPath)).toContain('Fresh body about Backpropagation.');
		});

		it('follows a moved folder for accepted notes, child sources and pending planned paths', async () => {
			proposals.set('p1', proposal({ status: 'accepted' }));
			proposals.set('child', proposal({ id: 'child', sourceNotePath: oldPath, proposedPath: 'Deep Dives/Root/Backpropagation/Chain Rule.md' }));

			await mod.followRename('Deep Dives/Root', 'Archive/Root');

			expect(proposals.get('p1')?.proposedPath).toBe('Archive/Root/Backpropagation.md');
			expect(proposals.get('child')).toMatchObject({ sourceNotePath: 'Archive/Root/Backpropagation.md', proposedPath: 'Archive/Root/Backpropagation/Chain Rule.md' });
		});

		it('leaves a pending planned path alone when another file is renamed onto or away from that exact name', async () => {
			proposals.set('p1', proposal({}));
			await mod.followRename(oldPath, 'Notes/Other.md');
			expect(proposals.get('p1')?.proposedPath).toBe(oldPath);
		});

		it('keeps an accept that lands between the scan and the save', async () => {
			proposals.set('p1', proposal({ status: 'accepted' }));
			proposals.set('child', proposal({ id: 'child', sourceNotePath: oldPath, proposedPath: 'Deep Dives/Root/Backpropagation/Chain Rule.md' }));
			vi.mocked(DeepDiveStore.prototype.loadAllProposals).mockImplementationOnce(async () => {
				const scanned = [...proposals.values()].map((p) => structuredClone(p));
				proposals.set('child', { ...proposals.get('child')!, status: 'accepted' });
				return scanned;
			});

			await mod.followRename(oldPath, 'Notes/Backprop.md');

			expect(proposals.get('child')).toMatchObject({ status: 'accepted', sourceNotePath: 'Notes/Backprop.md' });
		});

		it('derives the syllabus from a renamed root while none has been written', async () => {
			savedRun = run();
			await mod.followRename('notes/Root.md', 'notes/Base.md');
			expect(savedRun?.rootNotePath).toBe('notes/Base.md');
			expect(savedRun?.syllabusPath).toBeUndefined();
		});

		it('follows a renamed root note, keeping the written syllabus where it is, then a renamed syllabus', async () => {
			savedRun = run();
			proposals.set('p1', proposal({ status: 'accepted' }));
			const syllabus = syllabusPath('notes/Root.md', settings.deepDive.noteOutputFolder);
			files.set(syllabus, '# Syllabus');

			await mod.followRename('notes/Root.md', 'notes/Base.md');
			expect(savedRun).toMatchObject({ rootNotePath: 'notes/Base.md', syllabusPath: syllabus });
			expect(proposals.get('p1')?.sourceNotePath).toBe('notes/Base.md');

			await mod.followRename(syllabus, 'notes/Base syllabus.md');
			expect(savedRun?.syllabusPath).toBe('notes/Base syllabus.md');
		});

		it('writes an accepted note where a folder move followed during the accept put it', async () => {
			savedRun = run();
			proposals.set('p1', proposal({}));
			vi.mocked(DeepDiveStore.prototype.loadProposal).mockImplementationOnce(async (id) => {
				const loaded = structuredClone(proposals.get(id)!);
				proposals.set(id, { ...proposals.get(id)!, proposedPath: 'Archive/Root/Backpropagation.md' });
				return loaded;
			});

			await mod.acceptProposal('p1', { silent: true });

			const created = app.vault.create.mock.calls.map(([path]) => path as string);
			expect(created).toContain('Archive/Root/Backpropagation.md');
			expect(created).not.toContain(oldPath);
		});

		it('reads no records for the rest of a folder move once its folder event is followed', async () => {
			proposals.set('p1', proposal({ status: 'accepted' }));
			const loadAll = vi.mocked(DeepDiveStore.prototype.loadAllProposals);
			loadAll.mockClear();

			await mod.followRename('Deep Dives/Root', 'Archive/Root');
			await mod.followRename(oldPath, 'Archive/Root/Backpropagation.md');

			expect(loadAll).toHaveBeenCalledTimes(2);
			expect(proposals.get('p1')?.proposedPath).toBe('Archive/Root/Backpropagation.md');
		});

		it('leaves unrelated proposals and runs untouched', async () => {
			savedRun = run();
			proposals.set('p1', proposal({ status: 'accepted' }));
			const saveProposal = vi.mocked(DeepDiveStore.prototype.saveProposal);
			const saveRun = vi.mocked(DeepDiveStore.prototype.saveRun);
			saveProposal.mockClear();
			saveRun.mockClear();

			await mod.followRename('Other/Note.md', 'Other/Renamed.md');
			await mod.followRename('Deep Dives/Root/Backprop', 'Deep Dives/Root/X');

			expect(saveProposal).not.toHaveBeenCalled();
			expect(saveRun).not.toHaveBeenCalled();
		});
	});

	describe('regenerate', () => {
		it('replaces the recorded generation with the new call\'s (#625)', async () => {
			proposals.set('p1', proposal({ generation: { provider: 'openai', model: 'gpt-6-luna', stopReason: 'stop' } }));
			const complete = vi.mocked(AIClient.prototype.complete);
			const base = complete.getMockImplementation()!;
			complete.mockImplementation(async (user, system, opts) => {
				const text = await base(user, system, opts);
				opts?.onResponse?.({ provider: 'anthropic', model: 'claude-opus-5-5', stopReason: 'end_turn' });
				return text;
			});

			await mod.regenerate({ proposalId: 'p1' });

			expect(proposals.get('p1')?.generation).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5', stopReason: 'end_turn' });
		});

		it('tags its op with the job and joins the job\'s AI options, still bypassing the cache (#626)', async () => {
			proposals.set('p1', proposal({}));
			const ai = { beforeCall: vi.fn() };

			await mod.regenerate({ proposalId: 'p1' }, { jobId: 'j1', ai });

			expect(startOperation).toHaveBeenCalledWith(expect.any(String) as unknown, 'deep-dive-regenerate-p1@job:j1', expect.any(Object) as unknown);
			const opts = vi.mocked(AIClient.prototype.complete).mock.calls[0][2];
			expect(opts).toMatchObject({ bypassCache: true, beforeCall: expect.any(Function) as unknown });
			opts?.beforeCall?.();
			expect(ai.beforeCall).toHaveBeenCalledTimes(1);
		});

		it('rewrites a pending proposal in the store without touching the vault', async () => {
			proposals.set('p1', proposal({}));

			const outcome = await mod.regenerate({ proposalId: 'p1' });

			expect(outcome.status).toBe('completed');
			expect(outcome.writtenPaths).toEqual([]);
			expect(proposals.get('p1')?.proposedContent).toContain('Fresh body about Backpropagation.');
			expect(app.vault.process).not.toHaveBeenCalled();
		});

		it('rewrites an accepted note body, keeping frontmatter, nav and enrichment', async () => {
			const path = 'Deep Dives/Root/Backpropagation.md';
			proposals.set('p1', proposal({ status: 'accepted' }));
			const nav = '> [!note|synapse-nav] Navigation\n> Up: [[Root]]';
			const enrichment = `${ENRICHMENT_START}\n## Related Notes\n- [[Root]]\n${ENRICHMENT_END}`;
			files.set(path, `---\nparent: "[[Root]]"\n---\n${nav}\n\nTruncated mid-sen\n\n${enrichment}\n`);

			const outcome = await mod.regenerate({ notePath: path });

			expect(outcome.status).toBe('completed');
			expect(outcome.writtenPaths).toEqual([path]);
			expect(files.get(path)).toBe(`---\nparent: "[[Root]]"\n---\n${nav}\n\n## About\n\nFresh body about Backpropagation.\n\n${enrichment}\n`);
		});

		it('always makes a fresh model call', async () => {
			proposals.set('p1', proposal({}));
			await mod.regenerate({ proposalId: 'p1' });
			expect(vi.mocked(AIClient.prototype.complete).mock.calls.at(-1)?.[2]).toMatchObject({ bypassCache: true });
		});

		it('refuses an accepted proposal whose note is gone, before any model call', async () => {
			proposals.set('p1', proposal({ status: 'accepted' }));

			const outcome = await mod.regenerate({ proposalId: 'p1' });

			expect(outcome.status).toBe('failed');
			expect(outcome.message).toContain('deleted, or moved while deep dive was turned off');
			expect(generated).toEqual([]);
		});

		it('writes the note when the proposal is accepted while generating', async () => {
			const path = 'Deep Dives/Root/Backpropagation.md';
			proposals.set('p1', proposal({}));
			onGenerate = () => {
				proposals.set('p1', { ...proposals.get('p1')!, status: 'accepted' });
				files.set(path, '---\nparent: "[[Root]]"\n---\nOld body\n');
			};

			const outcome = await mod.regenerate({ proposalId: 'p1' });

			expect(outcome.writtenPaths).toEqual([path]);
			expect(files.get(path)).toContain('Fresh body about Backpropagation.');
		});

		it('refuses a rejected proposal', async () => {
			proposals.set('p1', proposal({ status: 'rejected' }));

			const outcome = await mod.regenerate({ proposalId: 'p1' });

			expect(outcome.status).toBe('failed');
			expect(generated).toEqual([]);
		});

		it('falls back to the parent proposal when the source note is not in the vault', async () => {
			proposals.set('parent', proposal({ id: 'parent', topic: { ...proposal({}).topic, title: 'Gradient Descent' }, proposedPath: 'Deep Dives/Root/Gradient Descent.md', proposedContent: 'parent body' }));
			proposals.set('child', proposal({ id: 'child', sourceNotePath: 'Deep Dives/Root/Gradient Descent.md' }));

			const outcome = await mod.regenerate({ proposalId: 'child' });

			expect(outcome.status).toBe('completed');
			const prompt = vi.mocked(AIClient.prototype.complete).mock.calls.at(-1)?.[0] ?? '';
			expect(prompt).toContain('parent body');
		});
	});
});
