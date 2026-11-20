#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ObsidianBridge } from './bridge.js';
import { createServer } from './server.js';

function positiveInt(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined || raw === '') return undefined;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer of milliseconds`);
	return value;
}

const bridge = new ObsidianBridge({
	cli: process.env.OBSIDIAN_CLI || undefined,
	vault: process.env.SYNAPSE_VAULT || undefined,
	tempDir: process.env.SYNAPSE_MCP_TEMP_DIR || undefined,
});
const server = createServer({
	call: (verb, args) => bridge.call(verb, args),
	maxWaitMs: positiveInt('SYNAPSE_MCP_MAX_WAIT_MS'),
	sampling: process.env.SYNAPSE_MCP_SAMPLING !== 'off',
	samplingTimeoutMs: positiveInt('SYNAPSE_MCP_SAMPLING_TIMEOUT_MS'),
});
await server.connect(new StdioServerTransport());
