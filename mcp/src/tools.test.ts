import { describe, it, expect } from 'vitest';
import { positionalArgs, toolName, toolsFromCapabilities } from './tools.js';
import { pluginCapabilities } from './__fixtures__/plugin.js';

describe('toolsFromCapabilities (#628)', () => {
	it('makes one tool per available verb, with client-safe names, the verb\'s arguments and an object output schema', async () => {
		const capabilities = await pluginCapabilities();
		capabilities.verbs.find((verb) => verb.name === 'scanFolder')!.available = false;
		const tools = toolsFromCapabilities(capabilities);

		expect(tools.map((tool) => tool.title)).toEqual(capabilities.verbs.filter((verb) => verb.available).map((verb) => verb.name));
		for (const tool of tools) {
			expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
			expect(tool.outputSchema?.type).toBe('object');
			expect(tool.inputSchema.additionalProperties).toBe(false);
		}
		const run = tools.find((tool) => tool.name === 'deepDive_run')!;
		expect(Object.keys(run.inputSchema.properties ?? {})).toEqual(['notePath', 'options']);
		expect(run.inputSchema.required).toEqual(['notePath']);
		expect(run.description).toContain('Cancelling the tool call cancels the job');
		expect(run.outputSchema).toEqual(capabilities.verbs.find((verb) => verb.name === 'jobs.wait')!.result);
		expect(tools.find((tool) => tool.name === 'jobs_list')!.outputSchema).toMatchObject({ properties: { value: { type: 'array' } }, required: ['value'] });
		expect(tools.find((tool) => tool.name === 'status')!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
		for (const name of ['proposals_accept', 'elaborate', 'deepDive_run', 'deepDive_continue', 'jobs_commit']) expect(tools.find((tool) => tool.name === name)!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
	});
});

describe('positionalArgs (#628)', () => {
	it('orders named arguments by the verb\'s parameters and drops trailing gaps', async () => {
		const verb = (await pluginCapabilities()).verbs.find((v) => v.name === 'jobs.commit')!;
		expect(positionalArgs(verb, { timeoutMs: 5, id: 'j' })).toEqual(['j', undefined, 5]);
		expect(positionalArgs(verb, { id: 'j' })).toEqual(['j']);
		expect(positionalArgs(verb, undefined)).toEqual([]);
		expect(() => positionalArgs(verb, { id: 'j', extra: 1, more: 2 })).toThrow('Unknown arguments for jobs_commit: extra, more');
	});

	it('maps dotted verbs to underscore tool names', () => {
		expect(toolName('deepDive.continue')).toBe('deepDive_continue');
	});
});
