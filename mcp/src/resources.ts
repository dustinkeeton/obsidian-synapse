import type { Resource } from '@modelcontextprotocol/sdk/types.js';
import type { CallVerb } from './jobs.js';

interface ResourceDef extends Resource {
	read: (call: CallVerb) => Promise<unknown>;
}

const RESOURCES: ResourceDef[] = [
	{
		uri: 'synapse://status',
		name: 'status',
		title: 'Synapse status',
		description: 'Plugin version, enabled features, per-feature model and billing, running operations, interrupted checkpoints, capped deep dives',
		mimeType: 'application/json',
		read: (call) => call('status', []),
	},
	{
		uri: 'synapse://proposals',
		name: 'proposals',
		title: 'Pending proposals',
		description: 'Every pending proposal, of every kind',
		mimeType: 'application/json',
		read: (call) => call('proposals.list', []),
	},
	{
		uri: 'synapse://jobs',
		name: 'jobs',
		title: 'Jobs',
		description: 'Running and recently finished jobs (the last 50, for up to an hour)',
		mimeType: 'application/json',
		read: async (call) => ({ jobs: await call('jobs.list', []) }),
	},
	{
		uri: 'synapse://deep-dives/continuable',
		name: 'continuable-deep-dives',
		title: 'Capped deep dives',
		description: 'Deep dive runs stopped at their note cap with topics left, for deepDive_continue',
		mimeType: 'application/json',
		read: async (call) => ({ runs: ((await call('status', [])) as { continuableDeepDives?: unknown }).continuableDeepDives ?? null }),
	},
];

export function listResources(): Resource[] {
	return RESOURCES.map(({ read: _read, ...resource }) => resource);
}

export async function readResource(call: CallVerb, uri: string): Promise<{ uri: string; mimeType: string; text: string } | null> {
	const resource = RESOURCES.find((entry) => entry.uri === uri);
	if (!resource) return null;
	return { uri, mimeType: 'application/json', text: JSON.stringify(await resource.read(call), null, 2) };
}
