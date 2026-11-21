import type { FeatureSettingsKey } from '../shared';
import { SYNAPSE_PIPELINE } from '../pipeline';
import { PROPOSAL_KINDS } from '../views';
import type { ApiCapabilities, ApiFeatureCapability, ApiParamSpec, ApiVerbSpec, VerbDefinition } from './types';
import { API_VERSION } from './types';

/** The settings slider's ceiling for deep dive notes per run; an agent's run is held to the same (cost bound). */
const MAX_NOTES_PER_RUN = 100;

const jobId: ApiParamSpec = {
	name: 'id',
	description: 'Job id from a long verb (scanFolder, elaborate, deepDive.*)',
	required: true,
	schema: { type: 'string' },
};

const notePath: ApiParamSpec = {
	name: 'notePath',
	description: 'Vault-relative path of a markdown note, e.g. "Topics/Rust.md"',
	required: true,
	schema: { type: 'string' },
};

/** Billing and call cap, taken by every generating verb (#626). */
const generationProperties = {
	billing: { type: 'string', enum: ['plugin-key', 'external'] },
	maxCalls: { type: 'integer', minimum: 1 },
};
const generationHelp = 'billing (plugin-key: Synapse calls the model with its key; external: the job waits at each model call with status awaiting-output and its requests, answered with jobs.commit; default: the feature\'s "Agents generate the text" setting), maxCalls (fail the job past this many model calls)';

const generationOptions: ApiParamSpec = {
	name: 'options',
	description: generationHelp,
	required: false,
	schema: { type: 'object', properties: generationProperties, additionalProperties: false },
};

const proposalKind: ApiParamSpec = {
	name: 'kind',
	description: 'Proposal kind',
	required: true,
	schema: { type: 'string', enum: [...PROPOSAL_KINDS] },
};

const proposalId: ApiParamSpec = {
	name: 'id',
	description: 'Proposal id from proposals.list',
	required: true,
	schema: { type: 'string' },
};

const str = { type: 'string' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const strings = { type: 'array', items: str };
const okSchema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
	type: 'object',
	properties: { ok: bool, error: str, ...properties },
	required: ['ok', ...required],
});

/** `ApiResult`: what a finished job's verb produced, and what proposals.accept / reject return. */
const apiResultSchema = okSchema({
	message: str,
	written: { type: ['array', 'null'], items: str },
	proposals: strings,
	cacheUse: { type: ['object', 'null'] },
	runId: str,
	endReason: { type: 'string', enum: ['cap', 'exhausted', 'cancelled', 'error'] },
	remainingTopics: int,
	count: { type: ['integer', 'null'] },
	acceptStatus: { type: 'string', enum: ['applied', 'partial', 'skipped', 'conflict', 'failed'] },
});

const jobStartSchema = okSchema({ jobId: str });

const jobSchema = {
	type: 'object',
	properties: {
		id: str,
		verb: str,
		status: { type: 'string', enum: ['running', 'awaiting-output', 'completed', 'failed', 'cancelled'] },
		startedAt: str,
		finishedAt: str,
		progress: { type: ['object', 'null'], properties: { message: str, current: { type: 'number' }, total: { type: 'number' } } },
		result: apiResultSchema,
		error: str,
		requests: {
			type: 'array',
			items: {
				type: 'object',
				properties: { id: str, feature: { type: ['string', 'null'] }, messages: { type: 'array' }, createdAt: str, expiresAt: str },
				required: ['id', 'messages'],
			},
		},
		usage: { type: 'object', properties: { billing: str, calls: int, maxCalls: { type: ['integer', 'null'] }, inputTokens: int, outputTokens: int } },
		operations: { type: 'array', items: { type: 'object', properties: { id: str, message: str, state: str } } },
	},
	required: ['id', 'verb', 'status', 'startedAt'],
};

const jobOrNull = { oneOf: [jobSchema, { type: 'null' }] };
const jobWaitSchema = okSchema({ timedOut: bool, job: jobOrNull }, ['timedOut']);

/** Every verb on the api object; the MCP shim (#628) generates its tools from this list. */
export const VERB_DEFINITIONS: readonly VerbDefinition[] = [
	{
		name: 'capabilities',
		description: 'List verbs, enabled features, and which features have a usable key',
		params: [],
		result: { type: 'object', properties: { apiVersion: int, pluginVersion: str, verbs: { type: 'array' }, features: { type: 'object' } }, required: ['apiVersion', 'pluginVersion', 'verbs', 'features'] },
		long: false,
	},
	{
		name: 'status',
		description: 'Plugin and settings versions, per-feature provider/model/effort, key source and default billing, running operations, interrupted checkpoints, capped deep dives',
		params: [],
		result: {
			type: 'object',
			properties: {
				apiVersion: int, pluginVersion: str, settingsVersion: int, features: { type: 'object' }, ai: { type: 'object' }, transcription: { type: 'object' }, systemOne: { type: 'object' },
				inProgress: { type: 'array' }, checkpoints: { type: ['array', 'null'] }, continuableDeepDives: { type: ['array', 'null'] },
			},
			required: ['apiVersion', 'pluginVersion', 'features', 'ai'],
		},
		long: false,
	},
	{
		name: 'elaborate',
		description: 'Generate an elaboration proposal for one note as a job (auto-accepted when that setting is on); returns { ok, jobId }. Job result: { ok, message, error, written (the note, when auto-accepted), proposals, cacheUse }',
		params: [notePath, generationOptions],
		result: jobStartSchema,
		long: true,
		feature: 'elaboration',
	},
	{
		name: 'scanFolder',
		description: 'Start one feature\'s folder scan as a job, without the confirmation prompt; returns { ok, jobId }. Job result: { ok, message, error, written: null, proposals (new ids for notes in the folder), cacheUse: null, count }',
		params: [
			{
				name: 'feature',
				description: 'Feature to run',
				required: true,
				schema: { type: 'string', enum: SYNAPSE_PIPELINE.map((phase) => phase.key) },
			},
			{
				name: 'folder',
				description: 'Vault-relative folder; "" is the vault root',
				required: true,
				schema: { type: 'string' },
			},
			{
				name: 'options',
				description: 'recursive: false scans only the folder\'s top level',
				required: false,
				schema: { type: 'object', properties: { recursive: { type: 'boolean', default: true } }, additionalProperties: false },
			},
		],
		result: jobStartSchema,
		long: true,
		feature: SYNAPSE_PIPELINE.map((phase) => phase.key),
	},
	{
		name: 'deepDive.run',
		description: 'Start a deep dive on a note as a job: extract topics and generate child-note proposals, with no depth picker or confirmation; returns { ok, jobId }. Job result: { ok, message, error, written (notes created under auto-accept), proposals, cacheUse, runId, endReason (cap | exhausted | cancelled | error), remainingTopics (when capped; continue with deepDive.continue) }',
		params: [
			notePath,
			{
				name: 'options',
				description: `depth (1-6), maxNotes (1-100), autoAccept; each defaults to its setting. ${generationHelp}`,
				required: false,
				schema: {
					type: 'object',
					properties: {
						depth: { type: 'integer', minimum: 1, maximum: 6 },
						maxNotes: { type: 'integer', minimum: 1, maximum: MAX_NOTES_PER_RUN },
						autoAccept: { type: 'boolean' },
						...generationProperties,
					},
					additionalProperties: false,
				},
			},
		],
		result: jobStartSchema,
		long: true,
		feature: 'deepDive',
	},
	{
		name: 'deepDive.continue',
		description: 'Generate the topics a deep dive left when it stopped at its note cap, as a job under a fresh cap; returns { ok, jobId }. status().continuableDeepDives lists such runs. Job result: same shape as deepDive.run',
		params: [
			{ name: 'runId', description: 'The capped run (deepDive.run result runId, or status().continuableDeepDives)', required: true, schema: { type: 'string' } },
			{
				name: 'options',
				description: `maxNotes (cap for this pass, 1-100), autoAccept; each defaults to the run's own. ${generationHelp}`,
				required: false,
				schema: {
					type: 'object',
					properties: {
						maxNotes: { type: 'integer', minimum: 1, maximum: MAX_NOTES_PER_RUN },
						autoAccept: { type: 'boolean' },
						...generationProperties,
					},
					additionalProperties: false,
				},
			},
		],
		result: jobStartSchema,
		long: true,
		feature: 'deepDive',
	},
	{
		name: 'deepDive.regenerate',
		description: 'Rewrite one deep-dive note from its topic as a job, keeping its frontmatter, nav block and enrichment sections; a pending proposal gets new content instead. Returns { ok, jobId }. Job result: { ok, message, error, written (the note, when accepted), proposals, cacheUse, runId }',
		params: [{
			name: 'target',
			description: 'A proposal id, or the path (ending in .md) of the note a deep-dive proposal created; or { proposalId } / { notePath }',
			required: true,
			schema: {
				oneOf: [
					{ type: 'string' },
					{ type: 'object', properties: { proposalId: { type: 'string' } }, required: ['proposalId'], additionalProperties: false },
					{ type: 'object', properties: { notePath: { type: 'string' } }, required: ['notePath'], additionalProperties: false },
				],
			},
		}, generationOptions],
		result: jobStartSchema,
		long: true,
		feature: 'deepDive',
	},
	{
		name: 'jobs.get',
		description: 'A job\'s status, progress, operations, and its result once finished; returns { ok, job, error } (ok: false for a bad, unknown or expired id)',
		params: [jobId],
		result: okSchema({ job: jobOrNull }),
		long: false,
	},
	{
		name: 'jobs.wait',
		description: 'Wait until a job finishes, is awaiting-output, or the timeout passes; returns { ok, timedOut, job }',
		params: [
			jobId,
			{
				name: 'timeoutMs',
				description: 'Milliseconds to wait; default 30000, at most 600000',
				required: false,
				schema: { type: 'integer', minimum: 0, maximum: 600000 },
			},
		],
		result: jobWaitSchema,
		long: false,
	},
	{
		name: 'jobs.cancel',
		description: 'Cancel a running job, the same as pressing Cancel on its toast; returns { ok, stoppedOperations }. Work outside its operations (deep dive auto-accept) still finishes',
		params: [jobId],
		result: okSchema({ stoppedOperations: int }),
		long: false,
	},
	{
		name: 'jobs.commit',
		description: 'Answer the requests of a job that is awaiting-output (external billing): Synapse post-processes each text exactly as a reply from its own key, then the job goes on; returns as jobs.wait does. Nothing is applied when any output is invalid',
		params: [
			jobId,
			{
				name: 'outputs',
				description: 'One { requestId, text } per answered request; optional model (recorded on the proposal), stopReason, truncated (true discards the reply as cut off), usage { inputTokens, outputTokens }',
				required: true,
				schema: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							requestId: { type: 'string' },
							text: { type: 'string' },
							model: { type: 'string' },
							stopReason: { type: 'string' },
							truncated: { type: 'boolean' },
							usage: {
								type: 'object',
								properties: { inputTokens: { type: 'integer', minimum: 0 }, outputTokens: { type: 'integer', minimum: 0 } },
								additionalProperties: false,
							},
						},
						required: ['requestId', 'text'],
						additionalProperties: false,
					},
				},
			},
			{
				name: 'timeoutMs',
				description: 'Milliseconds to wait after committing; default 30000, at most 600000',
				required: false,
				schema: { type: 'integer', minimum: 0, maximum: 600000 },
			},
		],
		result: jobWaitSchema,
		long: false,
	},
	{
		name: 'jobs.list',
		description: 'Running and recently finished jobs (the last 50, for up to an hour), without their operations',
		params: [],
		result: { type: 'array', items: jobSchema },
		long: false,
	},
	{
		name: 'events.since',
		description: 'Activity log entries (operation finish lines, errors, cancels, toasts; redacted) after a cursor, oldest first; returns { ok, entries: [{ seq, at, level, message, opId?, label?, jobId? }], cursor, more, missed }. Pass the returned cursor to read on; missed means entries were rotated out of the log, or the log was deleted and reading restarted from its oldest entry. The log syncs with the vault; two devices writing at once can repeat a seq',
		params: [
			{ name: 'cursor', description: 'The last seq already read; default 0 (every kept entry)', required: false, schema: { type: 'integer', minimum: 0 } },
			{ name: 'limit', description: 'At most this many entries; default 100, at most 500', required: false, schema: { type: 'integer', minimum: 1, maximum: 500 } },
		],
		result: okSchema({
			entries: { type: 'array', items: { type: 'object', properties: { seq: int, at: str, level: str, message: str, opId: str, label: str, jobId: str }, required: ['seq', 'at', 'level', 'message'] } },
			cursor: int,
			more: bool,
			missed: bool,
		}, ['entries', 'cursor', 'more', 'missed']),
		long: false,
	},
	{
		name: 'proposals.list',
		description: 'List pending proposals, optionally of one kind',
		params: [{ ...proposalKind, required: false }],
		result: okSchema({
			items: { type: 'array', items: { type: 'object', properties: { kind: str, id: str, notePath: str, sourceNotePath: str, createdAt: str, summary: str, items: strings, generation: { type: 'object' } }, required: ['kind', 'id', 'notePath'] } },
		}, ['items']),
		long: false,
	},
	{
		name: 'proposals.accept',
		description: 'Accept a pending proposal',
		params: [
			proposalKind,
			proposalId,
			{
				name: 'options',
				description: 'force (elaboration: replace a note edited since generation), items (rem/illustrate subset), resolution (title collision), content (elaboration body)',
				required: false,
				schema: {
					type: 'object',
					properties: {
						force: { type: 'boolean' },
						items: { type: 'array', items: { type: 'string' } },
						resolution: { type: 'string', enum: ['iterate', 'merge'] },
						content: { type: 'string' },
					},
					additionalProperties: false,
				},
			},
		],
		result: apiResultSchema,
		long: false,
	},
	{
		name: 'proposals.reject',
		description: 'Reject a pending proposal (deep dive also rejects its children)',
		params: [proposalKind, proposalId],
		result: apiResultSchema,
		long: false,
	},
];

export function buildCapabilities(
	pluginVersion: string,
	features: Record<FeatureSettingsKey, ApiFeatureCapability>
): ApiCapabilities {
	const usable = (key: FeatureSettingsKey) => features[key].enabled && features[key].available;
	const verbs = VERB_DEFINITIONS.map(({ feature, ...verb }) => ({
		...verb,
		available: feature === undefined || (typeof feature === 'string' ? usable(feature) : feature.some(usable)),
	}));
	return { apiVersion: API_VERSION, pluginVersion, verbs, features };
}
