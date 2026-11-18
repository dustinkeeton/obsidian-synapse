import type { App } from 'obsidian';
import type { AIFeatureId, AIProvider, EffortLevel, SynapseSettings, TranscriptionProvider } from '../settings';
import type { CacheUse, CheckpointManager, FeatureSettingsKey, InProgressEntry, NotificationManager } from '../shared';
import type { FeatureModules } from '../modules';
import type { PipelineModuleKey, PipelineModuleMap } from '../pipeline';
import type { ProposalKind } from '../views';

/** Bumped on any breaking change to the shapes below; additive changes keep it. */
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

export interface DeepDiveRunResult extends ApiResult {
	runId?: string;
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

export interface ApiDeepDiveRunOptions {
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
	/** Runs for minutes on large inputs (#624 turns these into jobs). */
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
	checkpoints: ApiCheckpointStatus[];
}

/** The object at `app.plugins.plugins.synapse.api`. */
export interface SynapseApi {
	readonly version: number;
	capabilities(): ApiCapabilities;
	status(): Promise<ApiStatus>;
	elaborate(notePath: string): Promise<ApiResult>;
	scanFolder(feature: ApiScanFeature, folder: string, options?: ApiScanOptions): Promise<ScanFolderResult>;
	deepDive: {
		run(notePath: string, options?: ApiDeepDiveRunOptions): Promise<DeepDiveRunResult>;
		regenerate(target: ApiRegenerateTarget): Promise<DeepDiveRunResult>;
	};
	proposals: {
		list(kind?: ProposalKind): Promise<ApiProposal[]>;
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
}
