import type { FeatureSettingsKey } from '../shared';
import { SYNAPSE_PIPELINE } from '../pipeline';
import { PROPOSAL_KINDS } from '../views';
import type { ApiCapabilities, ApiFeatureCapability, ApiParamSpec, ApiVerbSpec } from './types';
import { API_VERSION } from './types';

type VerbDefinition = Omit<ApiVerbSpec, 'available'> & {
	/** The verb is available while this feature is enabled and built; omitted = always. */
	feature?: FeatureSettingsKey;
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
		description: 'Run one feature\'s folder scan without the confirmation prompt',
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
	},
	{
		name: 'deepDive.run',
		description: 'Deep dive a note: extract topics and generate child-note proposals, with no depth picker or confirmation',
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
			description: 'A proposal id, or the path (ending in .md) of the note a deep-dive proposal created',
			required: true,
			schema: { type: 'string' },
		}],
		long: false,
		feature: 'deepDive',
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
	const verbs = VERB_DEFINITIONS.map(({ feature, ...verb }) => ({
		...verb,
		available: feature === undefined || (features[feature].enabled && features[feature].available),
	}));
	return { apiVersion: API_VERSION, pluginVersion, verbs, features };
}
