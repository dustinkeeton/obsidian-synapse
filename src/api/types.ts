import type { App } from 'obsidian';
import type { AIFeatureId, AIProvider, EffortLevel, SynapseSettings, TranscriptionProvider } from '../settings';
import type { ActivityEntry, ActivityLog, AIResponseInfo, AIUsage, CacheUse, ChatMessage, CheckpointManager, FeatureSettingsKey, InProgressEntry, NotificationManager } from '../shared';
import type { FeatureModules } from '../modules';
import type { PipelineModuleKey, PipelineModuleMap } from '../pipeline';
import type { ProposalKind } from '../views';

/**
 * Bumped on any breaking change to the shapes below once a release ships them; additive changes keep it.
 * Unstable until epic #629 ships: #624 changes the long verbs to return jobs, #626 makes every generating verb one.
 */
export const API_VERSION = 1;

/** Every verb resolves to this; verbs never throw. */
export interface ApiResult {
	ok: boolean;
	/** Finish line on success (the operation toast's text). */
	message?: string;
	/** Why the verb stopped; secrets redacted. Set exactly when `ok` is false. */
	error?: string;
	/** Vault notes this call wrote; `null` when the verb does not itemize writes (folder scans). */
	written: string[] | null;
	/** Proposal ids this call created, rewrote, accepted or rejected. */
	proposals: string[];
	/** Caches that served this call; `null` when the verb does not track it. */
	cacheUse: CacheUse | null;
}

/** What a long verb returns at once (#624); `jobId` is set exactly when `ok` is true. */
export interface ApiJobStart {
	ok: boolean;
	jobId?: string;
	/** Why no job started (bad arguments, feature disabled, missing note or folder). */
	error?: string;
}

/** `awaiting-output`: an external-billing job is waiting for `jobs.commit` to answer its `requests` (#626). */
export type ApiJobStatus = 'running' | 'awaiting-output' | 'completed' | 'failed' | 'cancelled';

/** Who generates a verb's text (#626): Synapse with the key in its settings, or the caller through `jobs.commit`. */
export type ApiBilling = 'plugin-key' | 'external';

/** Options every generating verb takes (#626). */
export interface ApiGenerationOptions {
	/** Default: the feature's `agentBilling` setting. */
	billing?: ApiBilling;
	/** Refuse model calls past this many in the job; the call that would exceed it fails the job. Default: no cap. */
	maxCalls?: number;
}

/** A model request an external-billing job is waiting on (#626). `messages` are final: untrusted content is fenced and the first system message carries the untrusted-content policy. */
export interface ApiGenerationRequest {
	id: string;
	/** The AI feature id whose prompt this is, e.g. `deep-dive`. */
	feature: AIFeatureId | null;
	messages: ChatMessage[];
	createdAt: string;
	/** The request fails, and with it the job, if no output arrives by then. */
	expiresAt: string;
}

/** The caller's answer to one request. `truncated: true` discards it as a provider's output-limit stop would. */
export interface ApiGenerationOutput {
	requestId: string;
	text: string;
	/** Recorded as the proposal's `generation.model`; default `external`. */
	model?: string;
	stopReason?: string;
	truncated?: boolean;
	usage?: AIUsage;
}

/** A generating job's model calls (#626). Tokens count dispatched and external calls as reported; cache replays and joined calls add none. */
export interface ApiJobUsage {
	billing: ApiBilling;
	calls: number;
	maxCalls: number | null;
	inputTokens: number;
	outputTokens: number;
}

/** A job as `jobs.get` / `jobs.wait` report it. */
export interface ApiJob {
	id: string;
	/** The verb that started it, e.g. `deepDive.run`. */
	verb: string;
	/** `failed`: the verb failed, or one of its operations ended in an error. `cancelled`: one of its operations was stopped (`jobs.cancel`, or a toast / sidebar Cancel); a cancel that stopped nothing leaves the job to finish normally. */
	status: ApiJobStatus;
	startedAt: string;
	finishedAt?: string;
	/** The newest running operation's status line (the last one when finished); null before the first starts. */
	progress: { message: string; current?: number; total?: number } | null;
	/** Set once finished: the verb's result (a `DeepDiveRunResult` or `ScanFolderResult`). */
	result?: ApiResult;
	/** Why it failed; secrets redacted. */
	error?: string;
	/** While `awaiting-output`: the model requests to answer with `jobs.commit`. */
	requests?: ApiGenerationRequest[];
	/** Generating verbs only (#626). */
	usage?: ApiJobUsage;
	/** Every operation the job started, in start order; omitted by `jobs.list`. */
	operations?: { id: string; message: string; state: 'running' | 'done' | 'error' | 'cancelled'; current?: number; total?: number }[];
}

export interface ApiJobLookup {
	ok: boolean;
	job: ApiJob | null;
	/** Bad id, or a job that was never started or has been dropped. */
	error?: string;
}

export interface ApiJobCancel {
	ok: boolean;
	/** Operations stopped now; 0 means none was running, though any the job starts later are cancelled at once. */
	stoppedOperations: number;
	error?: string;
}

export interface ApiJobWait {
	ok: boolean;
	/** True when the timeout passed first; `job` then shows it still running. `wait` and `commit` also return when the job is `awaiting-output`. */
	timedOut: boolean;
	job: ApiJob | null;
	error?: string;
}

export interface DeepDiveRunResult extends ApiResult {
	runId?: string;
	/** `run` / `continue`: why generation ended (`cap`, `exhausted`, `cancelled`, `error`). */
	endReason?: ApiDeepDiveEndReason;
	/** Set when `endReason` is `cap`: topics left for `deepDive.continue`. */
	remainingTopics?: number;
}

export interface ScanFolderResult extends ApiResult {
	/** The module's own count (notes processed or proposals made); `null` when it reports none. */
	count: number | null;
}

/** Folder-scan features: the Fire Synapse phases. */
export type ApiScanFeature = PipelineModuleKey;

export interface ApiScanOptions {
	/** Default true; false scans only the folder's top level. */
	recursive?: boolean;
}

/** Why a deep dive's generation ended (#625). */
export type ApiDeepDiveEndReason = 'cap' | 'exhausted' | 'cancelled' | 'error';

/** A deep dive stopped at its note cap with topics left (#625). */
export interface ApiContinuableDeepDive {
	runId: string;
	rootNotePath: string;
	remainingTopics: number;
	totalProposals: number;
	createdAt: string;
}

export interface ApiDeepDiveContinueOptions extends ApiGenerationOptions {
	/** Cap for this pass; default the run's own cap. */
	maxNotes?: number;
	/** Default the run's own setting. */
	autoAccept?: boolean;
}

export interface ApiDeepDiveRunOptions extends ApiGenerationOptions {
	/** 1-6; default `deepDive.maxDepth`. */
	depth?: number;
	/** Default `deepDive.maxNotesPerRun`. */
	maxNotes?: number;
	/** Default `autoAccept['deep-dive']`. */
	autoAccept?: boolean;
}

/** A proposal id, a note path ending in `.md`, or the explicit object form. */
export type ApiRegenerateTarget = string | { proposalId: string } | { notePath: string };

export interface ApiProposal {
	kind: ProposalKind;
	id: string;
	/** The note the proposal changes; for deep dive, the note it would create. */
	notePath: string;
	/** Deep dive only: the note the topic came from. */
	sourceNotePath?: string;
	createdAt: string;
	summary: string;
	/** Selectable item ids for `accept(..., { items })`: REM matched texts, illustrate item ids. */
	items?: string[];
	/** Elaboration and deep dive: provider, model, stop reason and token usage of the generating call (#625). */
	generation?: AIResponseInfo;
}

/** `proposals.list` result; never rejects. */
export interface ApiProposalList {
	ok: boolean;
	error?: string;
	items: ApiProposal[];
}

export interface ApiAcceptOptions {
	/** Elaboration: replace a note edited since the proposal was generated (default: leave it pending). */
	force?: boolean;
	/** REM / illustrate: accept only these items (default: all). */
	items?: string[];
	/** Title: how to resolve a name collision (default: refuse and report the conflict). */
	resolution?: 'iterate' | 'merge';
	/** Elaboration: accept this body instead of the proposed one. */
	content?: string;
}

export type ApiKeySource = 'default-key' | 'provider-key' | 'local' | 'missing';

export interface ApiFeatureCapability {
	enabled: boolean;
	/** False when the module is not built on this platform (video on mobile). */
	available: boolean;
	/** Whether the feature's model calls have a key or local endpoint; `null` when it makes none of its own. */
	keyReady: boolean | null;
}

export interface ApiParamSpec {
	name: string;
	description: string;
	required: boolean;
	/** JSON Schema for the argument. */
	schema: Record<string, unknown>;
}

export interface ApiVerbSpec {
	/** Dotted path on the api object, e.g. `deepDive.run`. */
	name: string;
	description: string;
	/** Positional arguments, in order. */
	params: ApiParamSpec[];
	/** Returns `{ ok, jobId }` at once and runs as a job; follow it with `jobs.wait` / `jobs.get` (#624). */
	long: boolean;
	/** False when the feature it needs is disabled or unavailable. */
	available: boolean;
}

export interface ApiCapabilities {
	apiVersion: number;
	pluginVersion: string;
	verbs: ApiVerbSpec[];
	features: Record<FeatureSettingsKey, ApiFeatureCapability>;
}

export interface ApiAIStatus {
	provider: AIProvider;
	model: string;
	/** `null` = Default (no effort field sent). */
	effort: EffortLevel | null;
	keySource: ApiKeySource;
	/** Default billing of agent calls (#626): the feature's `agentBilling` setting for elaboration and deep dive, else `plugin-key`. */
	billing: ApiBilling;
}

export interface ApiCheckpointStatus {
	id: string;
	module: string;
	label: string;
	completed: number;
	remaining: number;
	updatedAt: string;
}

export interface ApiStatus {
	apiVersion: number;
	pluginVersion: string;
	settingsVersion: number;
	features: Record<FeatureSettingsKey, { enabled: boolean; available: boolean }>;
	ai: Record<AIFeatureId, ApiAIStatus>;
	transcription: { provider: TranscriptionProvider; model: string; keySource: ApiKeySource };
	systemOne: { enabled: boolean; model: string; keySource: ApiKeySource };
	inProgress: InProgressEntry[];
	/** `null` when the checkpoint folder could not be read. */
	checkpoints: ApiCheckpointStatus[] | null;
	/** Deep dives stopped at their note cap with topics left (`deepDive.continue`); `null` when deep dive is unavailable or the runs could not be read. */
	continuableDeepDives: ApiContinuableDeepDive[] | null;
}

/** `events.since` result (#627); never rejects. */
export interface ApiEventPage {
	ok: boolean;
	error?: string;
	/** Oldest first; text fields are redacted. */
	entries: ActivityEntry[];
	/** Pass to the next `since` call: the last returned `seq`, else the cursor given. */
	cursor: number;
	/** More entries follow this page. */
	more: boolean;
	/** Entries after the cursor were rotated out of the log before this read. */
	missed: boolean;
}

/** The object at `app.plugins.plugins.synapse.api`. */
export interface SynapseApi {
	readonly version: number;
	capabilities(): ApiCapabilities;
	status(): Promise<ApiStatus>;
	/** Starts a job whose result is an `ApiResult`. */
	elaborate(notePath: string, options?: ApiGenerationOptions): Promise<ApiJobStart>;
	/** Starts a job whose result is a `ScanFolderResult`. */
	scanFolder(feature: ApiScanFeature, folder: string, options?: ApiScanOptions): Promise<ApiJobStart>;
	deepDive: {
		/** Starts a job whose result is a `DeepDiveRunResult`. */
		run(notePath: string, options?: ApiDeepDiveRunOptions): Promise<ApiJobStart>;
		/** Starts a job generating a capped run's remaining topics; result is a `DeepDiveRunResult`. */
		continue(runId: string, options?: ApiDeepDiveContinueOptions): Promise<ApiJobStart>;
		/** Starts a job whose result is a `DeepDiveRunResult`. */
		regenerate(target: ApiRegenerateTarget, options?: ApiGenerationOptions): Promise<ApiJobStart>;
	};
	jobs: {
		get(id: string): ApiJobLookup;
		wait(id: string, timeoutMs?: number): Promise<ApiJobWait>;
		cancel(id: string): ApiJobCancel;
		/** Answer an `awaiting-output` job's requests, then wait as `wait` does (#626). Nothing is applied when any output is invalid. */
		commit(id: string, outputs: ApiGenerationOutput[], timeoutMs?: number): Promise<ApiJobWait>;
		/** Running and recently finished jobs, without their operations. */
		list(): ApiJob[];
	};
	events: {
		/** Activity after `cursor` (default 0: every kept entry), oldest first, at most `limit` (default 100, max 500). */
		since(cursor?: number, limit?: number): Promise<ApiEventPage>;
	};
	proposals: {
		list(kind?: ProposalKind): Promise<ApiProposalList>;
		accept(kind: ProposalKind, id: string, options?: ApiAcceptOptions): Promise<ApiResult>;
		reject(kind: ProposalKind, id: string): Promise<ApiResult>;
	};
}

export interface SynapseApiDeps {
	app: App;
	pluginVersion: string;
	getSettings: () => SynapseSettings;
	modules: FeatureModules;
	/** The Fire Synapse scan table; `scanFolder` calls these with `skipConfirmation = true`. */
	scanFns: PipelineModuleMap;
	notifications: NotificationManager;
	checkpointManager: CheckpointManager;
	/** The activity log `events.since` reads (#627). */
	activityLog: ActivityLog;
}
