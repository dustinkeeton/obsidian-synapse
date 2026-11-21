import { describe, it, expect, vi } from 'vitest';
import { chmod, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeError, INLINE_ARGS_MAX_CHARS, ObsidianBridge, buildExpression, defaultRunner, parseOutput, redactSecrets, SECRET_PATTERN } from './bridge.js';

const nodeRequire = createRequire(import.meta.url);

/** Runs an expression the way `obsidian eval` does, against a stand-in `app`, and formats it as the CLI prints. */
async function evaluate(expression: string, api: unknown): Promise<string> {
	const app = { plugins: { plugins: { synapse: api === undefined ? undefined : { api } } } };
	const value = await (new Function('app', 'require', `return ${expression}`) as (app: unknown, require: NodeRequire) => Promise<string>)(app, nodeRequire);
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

	it('redacts secrets in a thrown verb\'s error and in CLI output', async () => {
		const thrown = parseOutput.bind(null, 'status', '=> {"synapseMcp":"threw","error":"upstream said sk-ant-api03-abcdefghijklmnop"}');
		expect(thrown).toThrow('status threw inside Obsidian: upstream said [REDACTED]');
		expect(() => parseOutput('status', 'Error: Bearer abcdefghijklmnop rejected')).toThrow('Obsidian could not run status: Error: [REDACTED] rejected');
		const dir = await mkdtemp(join(tmpdir(), 'synapse-mcp-cli-'));
		const path = join(dir, 'leaky');
		await writeFile(path, '#!/bin/sh\necho "key AIzaSyAbcdefghijklmnop" >&2\nexit 1\n');
		await chmod(path, 0o755);
		const failing = defaultRunner(path)(['eval', 'code=1'], 5000);
		await expect(failing).rejects.toThrow('The Obsidian CLI failed: key [REDACTED]');
	});
});

describe('redactSecrets', () => {
	it('matches the plugin\'s shared/redact.ts on every key shape', async () => {
		const pluginRedact = fileURLToPath(new URL('../../src/shared/redact.ts', import.meta.url));
		const plugin = await import(/* @vite-ignore */ pluginRedact) as { redactSecrets: (text: string) => string; SECRET_PATTERN: RegExp };
		expect(SECRET_PATTERN.source).toBe(plugin.SECRET_PATTERN.source);
		expect(SECRET_PATTERN.flags).toBe(plugin.SECRET_PATTERN.flags);
		const samples = [
			'sk-abcdefghijklmnop', 'sk-ant-api03-abcdefghijklmnop', 'key-abcdefghijklmnop', 'dg-abcdefghijklmnop',
			'Bearer abcdefghijklmnop', 'Token abcdefghijklmnop', 'anthropic-abcdefghijklmnop', 'AIzaSyAbcdefghijklmnop',
			'no secret here', 'sk-short',
		];
		for (const sample of samples) expect(redactSecrets(`x ${sample} y`)).toBe(plugin.redactSecrets(`x ${sample} y`));
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

	it('stages long arguments in a temp file the expression reads and deletes, keeping the argv string small', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'synapse-mcp-test-'));
		const api = fakeApi();
		const runner = vi.fn(async (args: string[], _timeout: number) => evaluate(args[1]!.slice('code='.length), api));
		const bridge = new ObsidianBridge({ runner, tempDir });
		const reply = `${'é" \\ \n'.repeat(40_000)}end`;
		await expect(bridge.call('echo', ['j1', [{ requestId: 'r1', text: reply }], 0])).resolves.toEqual({ args: ['j1', [{ requestId: 'r1', text: reply }], 0], count: 3 });
		expect(runner.mock.calls[0]![0][1]!.length).toBeLessThan(INLINE_ARGS_MAX_CHARS);
		expect(await readdir(tempDir)).toEqual([]);

		runner.mockRejectedValueOnce(new BridgeError('The Obsidian CLI failed'));
		await expect(bridge.call('echo', [reply])).rejects.toThrow('The Obsidian CLI failed');
		expect(await readdir(tempDir)).toEqual([]);

		runner.mockResolvedValueOnce('=> {"synapseMcp":"threw","error":"ENOENT: no such file or directory"}');
		await expect(bridge.call('echo', [reply])).rejects.toThrow('set SYNAPSE_MCP_TEMP_DIR');

		await bridge.call('echo', ['short']);
		expect(runner.mock.calls.at(-1)![0][1]).not.toContain('readFileSync');
	});

	it('reports a CLI timeout as one that may still finish, and never echoes the command line', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'synapse-mcp-cli-'));
		const script = async (name: string, body: string) => {
			const path = join(dir, name);
			await writeFile(path, `#!/bin/sh\n${body}\n`);
			await chmod(path, 0o755);
			return path;
		};
		const code = `code=${buildExpression('status', ['secret-looking argument'])}`;
		const slow = defaultRunner(await script('slow', 'sleep 5'))(['eval', code], 100);
		await expect(slow).rejects.toThrow('did not answer within 1 s. The call may still finish inside Obsidian');
		await expect(slow).rejects.not.toThrow('secret-looking');
		const failing = defaultRunner(await script('failing', 'exit 3'))(['eval', code], 5000);
		await expect(failing).rejects.toThrow('The Obsidian CLI failed: exit code 3');
		await expect(failing).rejects.not.toThrow('secret-looking');
	});

	it('names the missing CLI', async () => {
		const bridge = new ObsidianBridge({ cli: '/nonexistent/obsidian-cli' });
		await expect(bridge.call('status')).rejects.toThrow('The Obsidian CLI (/nonexistent/obsidian-cli) was not found');
	});
});
