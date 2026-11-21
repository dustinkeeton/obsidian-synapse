import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Capabilities, VerbSpec } from './api-types.js';

/** Verbs that only read; the rest change notes, proposals or jobs. */
const READ_ONLY = new Set(['capabilities', 'status', 'jobs.get', 'jobs.wait', 'jobs.list', 'events.since', 'proposals.list']);
/** Verbs that can rewrite or move an existing note; the long verbs and jobs.commit can when auto-accept is on (deep dives rewrite nav blocks and may organize). */
const DESTRUCTIVE = new Set(['proposals.accept', 'proposals.reject', 'deepDive.regenerate', 'deepDive.run', 'deepDive.continue', 'elaborate', 'scanFolder', 'jobs.commit']);
/** Verbs that can call an AI provider or fetch from the web: the long verbs, an accept's post-op hooks, and a committed job resuming. */
const OPEN_WORLD = new Set(['proposals.accept', 'jobs.commit']);

const LONG_TOOL_NOTE = ' Through MCP this tool waits for the job, reporting progress, and returns it as jobs.wait does: { ok, timedOut, job } with the result on job.result. A job still running after the shim\'s wait limit comes back with timedOut: true; follow it with jobs_wait. Cancelling the tool call cancels the job. A job awaiting-output (external billing) is answered through MCP sampling when the client supports it; otherwise it comes back with job.requests to answer with jobs_commit.';

/** MCP tool names allow no dots in some clients: `deepDive.run` becomes `deepDive_run`. */
export function toolName(verb: string): string {
	return verb.replace(/\./g, '_');
}

/** A tool's MCP output schema: the verb's result schema, wrapped as `{ value }` when it is not an object. */
export function outputSchemaFor(verb: VerbSpec, jobWait: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	const schema = verb.long ? jobWait : verb.result;
	if (!schema) return undefined;
	return schema.type === 'object' ? schema : { type: 'object', properties: { value: schema }, required: ['value'] };
}

/** One tool per available verb, its arguments named after the verb's parameters. */
export function toolsFromCapabilities(capabilities: Capabilities): Tool[] {
	const jobWait = capabilities.verbs.find((verb) => verb.name === 'jobs.wait')?.result;
	return capabilities.verbs.filter((verb) => verb.available).map((verb) => {
		const properties: Record<string, object> = {};
		for (const param of verb.params) properties[param.name] = { ...param.schema, description: param.description };
		const tool: Tool = {
			name: toolName(verb.name),
			title: verb.name,
			description: verb.long ? `${verb.description}.${LONG_TOOL_NOTE}` : verb.description,
			inputSchema: {
				type: 'object',
				properties,
				required: verb.params.filter((param) => param.required).map((param) => param.name),
				additionalProperties: false,
			},
			annotations: {
				readOnlyHint: READ_ONLY.has(verb.name),
				destructiveHint: DESTRUCTIVE.has(verb.name),
				openWorldHint: verb.long || OPEN_WORLD.has(verb.name),
			},
		};
		const output = outputSchemaFor(verb, jobWait);
		if (output) tool.outputSchema = output as Tool['outputSchema'];
		return tool;
	});
}

/** The verb's positional arguments from a tool call's named ones; an unknown name is an error, not dropped. */
export function positionalArgs(verb: VerbSpec, input: Record<string, unknown> | undefined): unknown[] {
	const named = input ?? {};
	const known = new Set(verb.params.map((param) => param.name));
	const unknown = Object.keys(named).filter((key) => !known.has(key));
	if (unknown.length > 0) throw new Error(`Unknown argument${unknown.length > 1 ? 's' : ''} for ${toolName(verb.name)}: ${unknown.join(', ')}`);
	const args = verb.params.map((param) => named[param.name]);
	while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
	return args;
}
