import { normalizePath, TFile, TFolder } from 'obsidian';
import { redactSecrets } from '../shared';
import type { FeatureSettingsKey, OperationOutcome } from '../shared';
import { PROPOSAL_KINDS } from '../views';
import type { ProposalKind } from '../views';
import { buildCapabilities } from './capabilities';
import { buildProposalAdapters } from './proposals';
import { buildStatus, defaultBilling, featureCapabilities } from './status';
import { JobGeneration } from './external';
import { validateArgs } from './validate';
import { JobRegistry } from './jobs';
import type {
	ApiDeepDiveEndReason, ApiGenerationOptions, ApiJobStart, ApiProposal, ApiRegenerateTarget, ApiResult, ApiScanFeature, DeepDiveRunResult, ScanFolderResult, SynapseApi, SynapseApiDeps,
} from './types';
import { API_VERSION } from './types';

export { API_VERSION } from './types';
export { VERB_DEFINITIONS } from './capabilities';
export type {
	SynapseApi, SynapseApiDeps, ApiResult, DeepDiveRunResult, ScanFolderResult, ApiScanFeature, ApiScanOptions,
	ApiDeepDiveRunOptions, ApiRegenerateTarget, ApiProposal, ApiProposalList, ApiAcceptOptions, ApiKeySource, ApiFeatureCapability,
	ApiParamSpec, ApiVerbSpec, ApiCapabilities, ApiAIStatus, ApiCheckpointStatus, ApiStatus,
	ApiJob, ApiJobCancel, ApiJobLookup, ApiJobStart, ApiJobStatus, ApiJobWait,
	ApiBilling, ApiGenerationOptions, ApiGenerationRequest, ApiGenerationOutput, ApiJobUsage, ApiContinuableDeepDive, ApiDeepDiveEndReason, ApiDeepDiveContinueOptions,
} from './types';
export { JobRegistry, MAX_FINISHED_JOBS, FINISHED_JOB_TTL_MS, DEFAULT_WAIT_MS, MAX_WAIT_MS } from './jobs';
export { ExternalRequests, JobGeneration, EXTERNAL_REPLY_TIMEOUT_MS } from './external';

/** Scan features whose output is proposals, so `scanFolder` can report the new ids. */
const SCAN_PROPOSAL_KIND: Partial<Record<ApiScanFeature, ProposalKind>> = {
	elaboration: 'elaboration',
	enrichment: 'enrichment',
	rem: 'rem',
	illustrate: 'illustrate',
	organize: 'organize',
};

const FEATURE_LABEL: Record<ApiScanFeature | 'deepDive', string> = {
	elaboration: 'Elaboration',
	summarize: 'Summarize',
	enrichment: 'Enrichment',
	rem: 'REM',
	illustrate: 'Illustrate',
	tidy: 'Tidy',
	organize: 'Organize',
	deepDive: 'Deep dive',
};

function failure(error: string): ApiResult {
	return { ok: false, error: redactSecrets(error), written: [], proposals: [], cacheUse: null };
}

/** Whether a note lies in a scan's folder ('' = vault root), at any depth or only its top level. */
function isInScanScope(notePath: string, folder: string, recursive: boolean): boolean {
	const parent = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
	if (!recursive) return parent === folder;
	return folder === '' || notePath.startsWith(`${folder}/`);
}

function jobRefused(error: string): ApiJobStart {
	return { ok: false, error: redactSecrets(error) };
}

/** A module outcome as an ApiResult; anything but `completed` is `ok: false` with the outcome's message as the error. */
function fromOutcome(outcome: OperationOutcome): ApiResult {
	const result = { written: outcome.writtenPaths, proposals: outcome.proposalIds, cacheUse: outcome.cacheUse };
	return outcome.status === 'completed'
		? { ok: true, message: outcome.message, ...result }
		: { ok: false, error: redactSecrets(outcome.message), ...result };
}

/** A deep-dive `run` / `continueRun` outcome, with its run id and why generation ended. */
function fromRunOutcome(outcome: OperationOutcome & { runId?: string; endReason?: ApiDeepDiveEndReason; remainingTopics?: number }): DeepDiveRunResult {
	const result: DeepDiveRunResult = { ...fromOutcome(outcome), runId: outcome.runId };
	if (outcome.endReason) result.endReason = outcome.endReason;
	if (outcome.remainingTopics !== undefined) result.remainingTopics = outcome.remainingTopics;
	return result;
}

const asIs = (failed: ApiResult): ApiResult => failed;

/** Run a verb body; any throw becomes `{ ok: false, error }` so callers never see a rejection. */
async function settle<T extends ApiResult>(fn: () => Promise<T>, onError: (failed: ApiResult) => T): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		return onError(failure(error instanceof Error ? error.message : String(error)));
	}
}

function isProposalKind(kind: unknown): kind is ProposalKind {
	return typeof kind === 'string' && (PROPOSAL_KINDS as readonly string[]).includes(kind);
}

/** Split a generating verb's options into its billing and call cap and the rest, which go to the module. */
function splitGeneration<T extends ApiGenerationOptions>(options: T | undefined): [ApiGenerationOptions, Omit<T, keyof ApiGenerationOptions>] {
	const { billing, maxCalls, ...rest } = options ?? ({} as T);
	return [{ billing, maxCalls }, rest];
}

function toRegenerateTarget(target: ApiRegenerateTarget): { proposalId: string } | { notePath: string } {
	if (typeof target !== 'string') return target;
	return target.endsWith('.md') ? { notePath: target } : { proposalId: target };
}

/** Build the versioned public API (#623). Verbs reach modules only through `deps`, take every answer a modal would ask for, and resolve to a structured result. */
export function createSynapseApi(deps: SynapseApiDeps): SynapseApi {
	const { app, modules } = deps;
	const adapters = buildProposalAdapters(app, modules);
	const jobs = new JobRegistry(deps.notifications);

	const disabled = (feature: FeatureSettingsKey, label: string): string | null =>
		deps.getSettings()[feature].enabled ? null : `${label} is disabled in Synapse settings`;

	const noteFile = (notePath: string): TFile | null => {
		const file = app.vault.getAbstractFileByPath(normalizePath(notePath));
		return file instanceof TFile && file.extension === 'md' ? file : null;
	};

	const pending = async (kind: ProposalKind | undefined): Promise<ApiProposal[]> => (kind ? adapters[kind].list() : []);

	const generationFor = (feature: 'elaboration' | 'deep-dive', options: ApiGenerationOptions): JobGeneration =>
		new JobGeneration(options.billing ?? defaultBilling(deps.getSettings(), feature), options.maxCalls ?? null);

	/** Start a generating verb as a job (#626): its model calls carry the job's billing, cap and usage meter. */
	const startGeneration = <T extends ApiResult>(
		verb: string,
		feature: 'elaboration' | 'deep-dive',
		options: ApiGenerationOptions,
		run: (job: { jobId: string; ai: ReturnType<JobGeneration['aiOptions']> }) => Promise<T>,
	): ApiJobStart => {
		const generation = generationFor(feature, options);
		const jobId = jobs.start(verb, (id) => settle<T>(() => run({ jobId: id, ai: generation.aiOptions() }), (failed) => failed as T), generation);
		return { ok: true, jobId };
	};

	return {
		version: API_VERSION,

		capabilities: () => buildCapabilities(deps.pluginVersion, featureCapabilities(deps.getSettings(), modules)),

		status: () => buildStatus(deps),

		elaborate: async (notePath, options) => {
			const refused = validateArgs('elaborate', [notePath, options]) ?? disabled('elaboration', FEATURE_LABEL.elaboration);
			if (refused) return jobRefused(refused);
			const file = noteFile(notePath);
			if (!file) return jobRefused(`Note not found: ${notePath}`);
			return startGeneration('elaborate', 'elaboration', options ?? {}, async (job) =>
				fromOutcome(await modules.elaboration.scanNote(file, true, job)));
		},

		scanFolder: async (feature, folder, options) => {
			const refused = validateArgs('scanFolder', [feature, folder, options])
				?? disabled(feature, FEATURE_LABEL[feature])
				?? (feature === 'illustrate' ? modules.illustrate.scanBlocker() : null);
			if (refused) return jobRefused(refused);
			const path = normalizePath(folder || '/');
			const root = path === '/' || path === '';
			if (!root && !(app.vault.getAbstractFileByPath(path) instanceof TFolder)) return jobRefused(`Folder not found: ${folder}`);
			const scan = deps.scanFns[feature];
			const kind = SCAN_PROPOSAL_KIND[feature];
			const jobId = jobs.start('scanFolder', (id) => settle<ScanFolderResult>(async () => {
				const recursive = options?.recursive ?? true;
				const before = new Set((await pending(kind)).map((p) => p.id));
				const count = await scan({ folder: root ? undefined : path, recursive, jobId: id }, true);
				const inScope = (notePath: string) => isInScanScope(notePath, root ? '' : path, recursive);
				const created = (await pending(kind)).filter((p) => !before.has(p.id) && inScope(p.notePath));
				return {
					ok: true,
					message: `${FEATURE_LABEL[feature]} scan finished`,
					written: null,
					proposals: created.map((p) => p.id),
					cacheUse: null,
					count: typeof count === 'number' ? count : null,
				};
			}, (failed) => ({ ...failed, count: null })));
			return { ok: true, jobId };
		},

		deepDive: {
			run: async (notePath, options) => {
				const refused = validateArgs('deepDive.run', [notePath, options]) ?? disabled('deepDive', FEATURE_LABEL.deepDive);
				if (refused) return jobRefused(refused);
				if (!noteFile(notePath)) return jobRefused(`Note not found: ${notePath}`);
				const [generation, runOptions] = splitGeneration(options);
				return startGeneration('deepDive.run', 'deep-dive', generation, async (job) =>
					fromRunOutcome(await modules.deepDive.run(notePath, { ...runOptions, ...job })));
			},

			continue: async (runId, options) => {
				const refused = validateArgs('deepDive.continue', [runId, options]) ?? disabled('deepDive', FEATURE_LABEL.deepDive);
				if (refused) return jobRefused(refused);
				const continuable = await modules.deepDive.listContinuableRuns();
				if (!continuable.some((run) => run.runId === runId)) {
					return jobRefused(`No capped deep dive with id ${runId} has topics left (see status().continuableDeepDives)`);
				}
				const [generation, continueOptions] = splitGeneration(options);
				return startGeneration('deepDive.continue', 'deep-dive', generation, async (job) =>
					fromRunOutcome(await modules.deepDive.continueRun(runId, { ...continueOptions, ...job })));
			},

			regenerate: async (target, options) => {
				const refused = validateArgs('deepDive.regenerate', [target, options]) ?? disabled('deepDive', FEATURE_LABEL.deepDive);
				if (refused) return jobRefused(refused);
				return startGeneration<DeepDiveRunResult>('deepDive.regenerate', 'deep-dive', options ?? {}, async (job) => {
					const outcome = await modules.deepDive.regenerate(toRegenerateTarget(target), job);
					return { ...fromOutcome(outcome), runId: outcome.runId };
				});
			},
		},

		jobs: {
			get: (id) => {
				const invalid = validateArgs('jobs.get', [id]);
				return invalid ? { ok: false, job: null, error: invalid } : jobs.get(id);
			},
			wait: async (id, timeoutMs) => {
				const invalid = validateArgs('jobs.wait', [id, timeoutMs]);
				return invalid ? { ok: false, timedOut: false, job: null, error: invalid } : jobs.wait(id, timeoutMs);
			},
			cancel: (id) => {
				const invalid = validateArgs('jobs.cancel', [id]);
				return invalid ? { ok: false, stoppedOperations: 0, error: invalid } : jobs.cancel(id);
			},
			commit: async (id, outputs, timeoutMs) => {
				const invalid = validateArgs('jobs.commit', [id, outputs, timeoutMs]);
				return invalid ? { ok: false, timedOut: false, job: null, error: invalid } : jobs.commit(id, outputs, timeoutMs);
			},
			list: () => jobs.list(),
		},

		proposals: {
			list: async (kind) => {
				const invalid = validateArgs('proposals.list', [kind]);
				if (invalid) return { ok: false, error: invalid, items: [] };
				try {
					const kinds = kind ? [kind] : PROPOSAL_KINDS;
					const lists = await Promise.all(kinds.map((k) => adapters[k].list()));
					return { ok: true, items: lists.flat() };
				} catch (error) {
					return { ok: false, error: redactSecrets(error instanceof Error ? error.message : String(error)), items: [] };
				}
			},

			accept: (kind, id, options) => settle(async () => {
				const invalid = validateArgs('proposals.accept', [kind, id, options]);
				if (invalid || !isProposalKind(kind)) return failure(invalid ?? `Unknown proposal kind: ${String(kind)}`);
				if (!(await adapters[kind].list()).some((p) => p.id === id)) return failure(`No pending ${kind} proposal with id ${id}`);
				const outcome = await adapters[kind].accept(id, options ?? {});
				return outcome.applied
					? { ok: true, message: 'Proposal accepted', written: outcome.written, proposals: [id], cacheUse: null }
					: { ...failure(outcome.error ?? 'Proposal was not applied'), proposals: [id] };
			}, asIs),

			reject: (kind, id) => settle(async () => {
				const invalid = validateArgs('proposals.reject', [kind, id]);
				if (invalid || !isProposalKind(kind)) return failure(invalid ?? `Unknown proposal kind: ${String(kind)}`);
				if (!(await adapters[kind].list()).some((p) => p.id === id)) return failure(`No pending ${kind} proposal with id ${id}`);
				await adapters[kind].reject(id);
				return { ok: true, message: 'Proposal rejected', written: [], proposals: [id], cacheUse: null };
			}, asIs),
		},
	};
}
