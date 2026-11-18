import type { FeatureSettingsKey } from '../shared';
import { SYNAPSE_PIPELINE } from '../pipeline';
import { PROPOSAL_KINDS } from '../views';
import type { ApiCapabilities, ApiFeatureCapability, ApiParamSpec, ApiVerbSpec } from './types';
import { API_VERSION } from './types';

type VerbDefinition = Omit<ApiVerbSpec, 'available'> & {
	/** The verb is available while any of these features is enabled and built; omitted = always. */
	feature?: FeatureSettingsKey | readonly FeatureSettingsKey[];
};

const jobId: ApiParamSpec = {
	name: 'id',
	description: 'Job id from a long verb (scanFolder, deepDive.run)',
	required: true,
	schema: { type: 'string' },
};

const notePath: ApiParamSpec = {
	name: 'notePath',
	description: 'Vault-relative path of a markdown note, e.g. "Topics/Rust.md"',
	required: true,
	schema: { type: 'string' },
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

/** Every verb on the api object; the MCP shim (#628) generates its tools from this list. */
export const VERB_DEFINITIONS: readonly VerbDefinition[] = [
	{
		name: 'capabilities',
		description: 'List verbs, enabled features, and which features have a usable key',
		params: [],
		long: false,
	},
	{
		name: 'status',
		description: 'Plugin and settings versions, per-feature provider/model/effort and key source, running operations, interrupted checkpoints',
		params: [],
		long: false,
	},
	{
		name: 'elaborate',
		description: 'Generate an elaboration proposal for one note (auto-accepted when that setting is on)',
		params: [notePath],
		long: false,
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
		long: true,
		feature: SYNAPSE_PIPELINE.map((phase) => phase.key),
	},
	{
		name: 'deepDive.run',
		description: 'Start a deep dive on a note as a job: extract topics and generate child-note proposals, with no depth picker or confirmation; returns { ok, jobId }. Job result: { ok, message, error, written (notes created under auto-accept), proposals, cacheUse, runId }',
		params: [
			notePath,
			{
				name: 'options',
				description: 'depth (1-6), maxNotes, autoAccept; each defaults to its setting',
				required: false,
				schema: {
					type: 'object',
					properties: {
						depth: { type: 'integer', minimum: 1, maximum: 6 },
						maxNotes: { type: 'integer', minimum: 1 },
						autoAccept: { type: 'boolean' },
					},
					additionalProperties: false,
				},
			},
		],
		long: true,
		feature: 'deepDive',
	},
	{
		name: 'deepDive.regenerate',
		description: 'Rewrite one deep-dive note from its topic, keeping its frontmatter, nav block and enrichment sections; a pending proposal gets new content instead',
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
		}],
		long: false,
		feature: 'deepDive',
	},
	{
		name: 'jobs.get',
		description: 'A job\'s status, progress, operations, and its result once finished; returns { ok, job, error } (ok: false for a bad, unknown or expired id)',
		params: [jobId],
		long: false,
	},
	{
		name: 'jobs.wait',
		description: 'Wait until a job finishes or the timeout passes; returns { ok, timedOut, job }',
		params: [
			jobId,
			{
				name: 'timeoutMs',
				description: 'Milliseconds to wait; default 30000, at most 600000',
				required: false,
				schema: { type: 'integer', minimum: 0, maximum: 600000 },
			},
		],
		long: false,
	},
	{
		name: 'jobs.cancel',
		description: 'Cancel a running job, the same as pressing Cancel on its toast; returns { ok, stoppedOperations }. Work outside its operations (deep dive auto-accept) still finishes',
		params: [jobId],
		long: false,
	},
	{
		name: 'jobs.list',
		description: 'Running and recently finished jobs (the last 50, for up to an hour), without their operations',
		params: [],
		long: false,
	},
	{
		name: 'proposals.list',
		description: 'List pending proposals, optionally of one kind',
		params: [{ ...proposalKind, required: false }],
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
		long: false,
	},
	{
		name: 'proposals.reject',
		description: 'Reject a pending proposal (deep dive also rejects its children)',
		params: [proposalKind, proposalId],
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
