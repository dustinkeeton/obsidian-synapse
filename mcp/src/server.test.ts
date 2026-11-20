import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from './server.js';
import type { CallVerb } from './jobs.js';
import { pluginCapabilities } from './__fixtures__/plugin.js';
import { VERSION } from './version.js';

const T = '2026-11-19T00:00:00.000Z';
const job = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'j1', verb: 'elaborate', status, startedAt: T, progress: null, ...extra });

/** A plugin stand-in whose values follow the API's shapes; elaborate pauses once for external output. */
async function fakePlugin() {
	const capabilities = await pluginCapabilities();
	let committed = false;
	const call = vi.fn<CallVerb>(async (verb, args) => {
		switch (verb) {
			case 'capabilities': return capabilities;
			case 'status': return { apiVersion: 1, pluginVersion: 'test', settingsVersion: 8, features: {}, ai: {}, continuableDeepDives: [{ runId: 'run1' }] };
			case 'jobs.list': return [job('completed', { finishedAt: T })];
			case 'proposals.list': return { ok: true, items: [{ kind: 'elaboration', id: 'e1', notePath: 'A.md', createdAt: T, summary: 's' }] };
			case 'proposals.reject': return { ok: false, error: 'No pending proposal e9', written: [], proposals: [], cacheUse: null };
			case 'elaborate': return { ok: true, jobId: 'j1' };
			case 'jobs.wait': return committed
				? { ok: true, timedOut: false, job: job('completed', { finishedAt: T, progress: { message: 'Proposal generated' }, result: { ok: true, message: 'Proposal generated', written: [], proposals: ['e2'], cacheUse: null } }) }
				: { ok: true, timedOut: false, job: job('awaiting-output', { progress: { message: 'Elaborating A' }, requests: [{ id: 'r1', feature: 'elaboration', messages: [{ role: 'system', content: 'Policy' }, { role: 'user', content: 'Expand A' }], createdAt: T, expiresAt: T }] }) };
			case 'jobs.commit': committed = true; return { ok: true, timedOut: false, job: job('running') };
			default: throw new Error(`unexpected ${verb} ${JSON.stringify(args)}`);
		}
	});
	return call;
}

async function connect(call: CallVerb, sampling: boolean) {
	const server = createServer({ call, pollMs: 10 });
	const client = new Client({ name: 'test', version: '1' }, { capabilities: sampling ? { sampling: {} } : {} });
	const sample = vi.fn(async (_request: { params: unknown }) => ({ role: 'assistant' as const, model: 'client-model', stopReason: 'endTurn', content: { type: 'text' as const, text: 'Expanded body' } }));
	if (sampling) client.setRequestHandler(CreateMessageRequestSchema, sample);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return { client, sample };
}

describe('synapse-mcp server (#628)', () => {
	it('lists a tool per verb and returns results the client validates against each output schema', async () => {
		const { client } = await connect(await fakePlugin(), false);
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name)).toContain('deepDive_run');

		const status = await client.callTool({ name: 'status', arguments: {} });
		expect(status.isError).toBeFalsy();
		expect(status.structuredContent).toMatchObject({ pluginVersion: 'test' });
		expect((await client.callTool({ name: 'jobs_list', arguments: {} })).structuredContent).toMatchObject({ value: [{ id: 'j1' }] });

		const rejected = await client.callTool({ name: 'proposals_reject', arguments: { kind: 'elaboration', id: 'e9' } });
		expect(rejected.isError).toBe(true);
		expect(rejected.structuredContent).toMatchObject({ ok: false, error: 'No pending proposal e9' });
	});

	it('runs a long verb to its end, answering its model request through the client\'s sampling and reporting progress', async () => {
		const call = await fakePlugin();
		const { client, sample } = await connect(call, true);
		await client.listTools();
		const onprogress = vi.fn();
		const result = await client.callTool({ name: 'elaborate', arguments: { notePath: 'A.md', options: { billing: 'external' } } }, undefined, { onprogress });

		expect(result.structuredContent).toMatchObject({ ok: true, job: { status: 'completed', result: { proposals: ['e2'] } } });
		expect(sample).toHaveBeenCalledTimes(1);
		expect(sample.mock.calls[0]![0].params).toMatchObject({ systemPrompt: 'Policy', messages: [{ role: 'user', content: { type: 'text', text: 'Expand A' } }] });
		expect(call).toHaveBeenCalledWith('jobs.commit', ['j1', [{ requestId: 'r1', text: 'Expanded body', model: 'client-model', stopReason: 'endTurn' }], 0]);
		expect(onprogress.mock.calls.map(([p]) => p.message)).toEqual(['Elaborating A', 'Proposal generated']);
	});

	it('hands the requests back when the client cannot sample', async () => {
		const { client } = await connect(await fakePlugin(), false);
		const result = await client.callTool({ name: 'elaborate', arguments: { notePath: 'A.md' } });
		expect(result.structuredContent).toMatchObject({ ok: true, job: { status: 'awaiting-output', requests: [{ id: 'r1' }] } });
	});

	it('reports bridge failures and bad arguments as tool errors', async () => {
		const call = await fakePlugin();
		const { client } = await connect(call, false);
		await client.listTools();
		call.mockRejectedValueOnce(new Error('The Obsidian CLI failed: no vault open'));
		expect(await client.callTool({ name: 'status', arguments: {} })).toMatchObject({ isError: true, content: [{ text: 'The Obsidian CLI failed: no vault open' }] });
		expect(await client.callTool({ name: 'status', arguments: { extra: 1 } })).toMatchObject({ isError: true, content: [{ text: 'Unknown argument for status: extra' }] });
		expect(await client.callTool({ name: 'nope', arguments: {} })).toMatchObject({ isError: true, content: [{ text: 'Unknown tool: nope' }] });
	});

	it('serves status, proposals, jobs and capped deep dives as resources', async () => {
		const { client } = await connect(await fakePlugin(), false);
		const { resources } = await client.listResources();
		expect(resources.map((resource) => resource.uri)).toEqual(['synapse://status', 'synapse://proposals', 'synapse://jobs', 'synapse://deep-dives/continuable']);
		const read = async (uri: string) => JSON.parse(((await client.readResource({ uri })).contents[0] as { text: string }).text) as unknown;
		expect(await read('synapse://deep-dives/continuable')).toEqual({ runs: [{ runId: 'run1' }] });
		expect(await read('synapse://jobs')).toMatchObject({ jobs: [{ id: 'j1' }] });
		await expect(client.readResource({ uri: 'synapse://nope' })).rejects.toThrow('Unknown resource');
	});

	it('keeps VERSION equal to package.json', () => {
		expect(VERSION).toBe((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version);
	});
});
