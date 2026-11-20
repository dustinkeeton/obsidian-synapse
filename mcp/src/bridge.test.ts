import { describe, it, expect, vi } from 'vitest';
import { BridgeError, ObsidianBridge, buildExpression, parseOutput } from './bridge.js';

/** Runs an expression the way `obsidian eval` does, against a stand-in `app`, and formats it as the CLI prints. */
async function evaluate(expression: string, api: unknown): Promise<string> {
	const app = { plugins: { plugins: { synapse: api === undefined ? undefined : { api } } } };
	const value = await (new Function('app', `return ${expression}`) as (app: unknown) => Promise<string>)(app);
	return `=> ${value}\n`;
}

const fakeApi = () => ({
	status: vi.fn(async () => ({ pluginVersion: '1' })),
	nothing: vi.fn(() => undefined),
	fails: vi.fn(() => { throw new Error('inside'); }),
	jobs: {
		prefix: 'job:',
		get(this: { prefix: string }, id: string) { return { ok: true, id: this.prefix + id }; },
	},
	echo: vi.fn((...args: unknown[]) => ({ args, count: args.length })),
});

describe('buildExpression + parseOutput (#628)', () => {
	it('calls the verb with its arguments intact, nested verbs bound to their object', async () => {
		const api = fakeApi();
		const tricky = 'quote " backslash \\ newline \n tab \t `${x}` </script>   é 💥';
		expect(parseOutput('echo', await evaluate(buildExpression('echo', [tricky, { a: [1, true] }]), api))).toEqual({ args: [tricky, { a: [1, true] }], count: 2 });
		expect(parseOutput('jobs.get', await evaluate(buildExpression('jobs.get', ['7']), api))).toEqual({ ok: true, id: 'job:7' });
	});

	it('passes a skipped middle argument as undefined and an undefined result as null', async () => {
		const api = fakeApi();
		await evaluate(buildExpression('echo', ['a', undefined, 3]), api);
		expect(api.echo).toHaveBeenCalledWith('a', undefined, 3);
		expect(parseOutput('nothing', await evaluate(buildExpression('nothing', []), api))).toBeNull();
	});

	it('refuses a verb path that is not a plain member name', () => {
		for (const verb of ['status()', 'a.b.c', 'jobs[0]', '', 'x;y']) expect(() => buildExpression(verb, [])).toThrow(BridgeError);
	});

	it('reports a missing plugin, a missing or inherited verb, and a throwing verb as bridge errors', async () => {
		await expect(evaluate(buildExpression('status', []), undefined).then((out) => parseOutput('status', out))).rejects.toThrow('Synapse is not enabled');
		for (const verb of ['gone', 'constructor', 'toString', 'jobs.constructor']) {
			await expect(evaluate(buildExpression(verb, []), fakeApi()).then((out) => parseOutput(verb, out))).rejects.toThrow(`has no ${verb}`);
		}
		await expect(evaluate(buildExpression('fails', []), fakeApi()).then((out) => parseOutput('fails', out))).rejects.toThrow('fails threw inside Obsidian: inside');
	});

	it('reports CLI errors and unexpected output', () => {
		expect(() => parseOutput('status', 'Error: Vault not found\n')).toThrow('Obsidian could not run status: Error: Vault not found');
		expect(() => parseOutput('status', '')).toThrow('Unexpected output from the Obsidian CLI: (none)');
		expect(() => parseOutput('status', '=> not json')).toThrow('not JSON');
		expect(() => parseOutput('status', '=> {"other":1}')).toThrow('unexpected result');
	});
});

describe('ObsidianBridge (#628)', () => {
	it('runs obsidian eval with the vault option and a timeout that outlives an in-Obsidian wait', async () => {
		const runner = vi.fn(async (_args: string[], _timeout: number) => '=> {"synapseMcp":"ok","value":{"ok":true}}');
		const bridge = new ObsidianBridge({ vault: 'My Vault', runner });
		await expect(bridge.call('status')).resolves.toEqual({ ok: true });
		const [args, timeout] = runner.mock.calls[0]!;
		expect(args[0]).toBe('eval');
		expect(args[1]).toMatch(/^code=\(async \(\) => \{/);
		expect(args[2]).toBe('vault=My Vault');
		expect(timeout).toBe(60_000);

		await bridge.call('jobs.wait', ['j', 600_000]);
		expect(runner.mock.calls[1]![1]).toBe(660_000);
		await bridge.call('jobs.commit', ['j', []]);
		expect(runner.mock.calls[2]![1]).toBe(90_000);
	});

	it('names the missing CLI', async () => {
		const bridge = new ObsidianBridge({ cli: '/nonexistent/obsidian-cli' });
		await expect(bridge.call('status')).rejects.toThrow('The Obsidian CLI (/nonexistent/obsidian-cli) was not found');
	});
});
