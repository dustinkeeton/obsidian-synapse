import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema, ErrorCode, ListResourcesRequestSchema, ListToolsRequestSchema, McpError, ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Capabilities, VerbSpec } from './api-types.js';
import type { CallVerb } from './jobs.js';
import { DEFAULT_MAX_WAIT_MS, DEFAULT_POLL_MS, runJob } from './jobs.js';
import { listResources, readResource } from './resources.js';
import { positionalArgs, toolName, toolsFromCapabilities } from './tools.js';
import { VERSION } from './version.js';

export interface ServerOptions {
	call: CallVerb;
	/** How long a long tool follows its job before returning it still running. */
	maxWaitMs?: number;
	pollMs?: number;
	/** Off: never ask the client's model, even when it offers sampling. */
	sampling?: boolean;
}

const INSTRUCTIONS = 'Synapse is an Obsidian plugin that elaborates, enriches, organizes and deep-dives notes. Each tool is one verb of its public API, called inside the running Obsidian. Most changes arrive as proposals: list them with proposals_list, then proposals_accept or proposals_reject. Long verbs run as jobs. Read what happened, including work the user started, with events_since.';

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorResult(text: string): CallToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

/** A verb's resolved value as a tool result: `ok: false` is a tool error, and arrays travel as `{ value }`. */
function toolResult(value: unknown): CallToolResult {
	const structured = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { value };
	const failed = structured.ok === false;
	return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: structured, isError: failed || undefined };
}

export function createServer(options: ServerOptions): Server {
	const server = new Server({ name: 'synapse-mcp', title: 'Synapse', version: VERSION }, {
		capabilities: { tools: {}, resources: {} },
		instructions: INSTRUCTIONS,
	});
	let verbs: Map<string, VerbSpec> | null = null;

	/** Reads the plugin's verbs and remembers them, so a tool call skips the lookup until an unknown name arrives. */
	const loadCapabilities = async (): Promise<Capabilities> => {
		const capabilities = await options.call('capabilities', []) as Capabilities;
		verbs = new Map(capabilities.verbs.map((verb) => [toolName(verb.name), verb]));
		return capabilities;
	};

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return { tools: toolsFromCapabilities(await loadCapabilities()) };
	});

	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		try {
			if (!verbs?.has(request.params.name)) await loadCapabilities();
			const verb = verbs?.get(request.params.name);
			if (!verb) return errorResult(`Unknown tool: ${request.params.name}`);
			if (!verb.available) return errorResult(`${verb.name} is unavailable: the feature it needs is turned off in Synapse's settings`);
			const args = positionalArgs(verb, request.params.arguments);
			if (!verb.long) return toolResult(await options.call(verb.name, args));

			const progressToken = request.params._meta?.progressToken;
			const canSample = options.sampling !== false && Boolean(server.getClientCapabilities()?.sampling);
			return toolResult(await runJob(options.call, verb.name, args, {
				signal: extra.signal,
				maxWaitMs: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
				pollMs: options.pollMs ?? DEFAULT_POLL_MS,
				progress: progressToken === undefined ? undefined : (progress, line) => extra.sendNotification({
					method: 'notifications/progress',
					params: { progressToken, progress, message: line },
				}),
				sample: canSample ? (params) => server.createMessage(params, { signal: extra.signal }) : undefined,
			}));
		} catch (error) {
			return errorResult(message(error));
		}
	});

	server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: listResources() }));

	server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
		const contents = await readResource(options.call, request.params.uri);
		if (!contents) throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
		return { contents: [contents] };
	});

	return server;
}
