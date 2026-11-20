import { execFile } from 'node:child_process';

/** The shim's own failure to reach the plugin (CLI missing, Obsidian closed, plugin off); never a verb's `ok: false`. */
export class BridgeError extends Error {
	override name = 'BridgeError';
}

/** Runs `obsidian <args>` and resolves with its stdout. */
export type CliRunner = (args: string[], timeoutMs: number) => Promise<string>;

export interface BridgeOptions {
	/** Path or name of the Obsidian CLI; default `obsidian`. */
	cli?: string;
	/** Vault name for the CLI's `vault=` option; default the CLI's own choice. */
	vault?: string;
	runner?: CliRunner;
}

const VERB_PATTERN = /^[A-Za-z]+(\.[A-Za-z]+)?$/;
const BASE_TIMEOUT_MS = 60_000;
const DEFAULT_API_WAIT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Verbs that wait inside Obsidian; their CLI call must outlive the wait. */
const WAIT_ARG_INDEX: Record<string, number> = { 'jobs.wait': 1, 'jobs.commit': 2 };

function defaultRunner(cli: string): CliRunner {
	return (args, timeoutMs) => new Promise((resolve, reject) => {
		execFile(cli, args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' }, (error, stdout, stderr) => {
			if (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') {
					reject(new BridgeError(`The Obsidian CLI (${cli}) was not found. Synapse MCP needs Obsidian 1.12 or later with its command line interface turned on, on desktop.`));
					return;
				}
				reject(new BridgeError(`The Obsidian CLI failed: ${(stderr || stdout || error.message).trim()}`));
				return;
			}
			resolve(stdout);
		});
	});
}

/**
 * The JavaScript `obsidian eval` runs: one call on `app.plugins.plugins.synapse.api`.
 * The verb path is checked against a fixed pattern and must name the api object's own members, and the arguments travel as a JSON string literal, so no input becomes code.
 * Missing positions are sent as null and restored to undefined; no API parameter accepts null.
 */
export function buildExpression(verb: string, args: readonly unknown[]): string {
	if (!VERB_PATTERN.test(verb)) throw new BridgeError(`Not a Synapse verb: ${verb}`);
	const path = JSON.stringify(verb.split('.'));
	const payload = JSON.stringify(JSON.stringify(args.map((arg) => (arg === undefined ? null : arg))));
	return `(async () => {
	try {
		const api = app.plugins.plugins.synapse?.api;
		if (!api) return JSON.stringify({ synapseMcp: 'no-api' });
		const path = ${path};
		const own = (object, key) => object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
		const owner = path.length > 1 ? (own(api, path[0]) ? api[path[0]] : null) : api;
		const fn = own(owner, path[path.length - 1]) ? owner[path[path.length - 1]] : null;
		if (typeof fn !== 'function') return JSON.stringify({ synapseMcp: 'no-verb' });
		const args = JSON.parse(${payload}).map((arg) => (arg === null ? undefined : arg));
		const value = await fn.apply(owner, args);
		return JSON.stringify({ synapseMcp: 'ok', value: value === undefined ? null : value });
	} catch (error) {
		return JSON.stringify({ synapseMcp: 'threw', error: String(error?.message ?? error) });
	}
})()`;
}

/** Reads the envelope `buildExpression` returns from the CLI's `=> <value>` output. */
export function parseOutput(verb: string, stdout: string): unknown {
	const text = stdout.trim();
	if (!text.startsWith('=> ')) {
		const detail = text.length > 500 ? `${text.slice(0, 500)}…` : text;
		throw new BridgeError(detail.startsWith('Error:') ? `Obsidian could not run ${verb}: ${detail}` : `Unexpected output from the Obsidian CLI: ${detail || '(none)'}`);
	}
	let envelope: { synapseMcp?: string; value?: unknown; error?: string };
	try {
		envelope = JSON.parse(text.slice(3)) as typeof envelope;
	} catch {
		throw new BridgeError('The Obsidian CLI returned output that is not JSON');
	}
	switch (envelope.synapseMcp) {
		case 'ok': return envelope.value;
		case 'no-api': throw new BridgeError('Synapse is not enabled in this vault, or its version has no public API. Enable the Synapse plugin, update it if needed, and try again.');
		case 'no-verb': throw new BridgeError(`This Synapse version has no ${verb}; update the plugin or reload the tool list.`);
		case 'threw': throw new BridgeError(`${verb} threw inside Obsidian: ${envelope.error ?? 'unknown error'}`);
		default: throw new BridgeError('The Obsidian CLI returned an unexpected result');
	}
}

/** Calls one verb of the plugin's public API through `obsidian eval`. */
export class ObsidianBridge {
	private readonly runner: CliRunner;

	constructor(private readonly options: BridgeOptions = {}) {
		this.runner = options.runner ?? defaultRunner(options.cli ?? 'obsidian');
	}

	async call(verb: string, args: readonly unknown[] = []): Promise<unknown> {
		const cliArgs = ['eval', `code=${buildExpression(verb, args)}`];
		if (this.options.vault) cliArgs.push(`vault=${this.options.vault}`);
		return parseOutput(verb, await this.runner(cliArgs, timeoutFor(verb, args)));
	}
}

function timeoutFor(verb: string, args: readonly unknown[]): number {
	const index = WAIT_ARG_INDEX[verb];
	if (index === undefined) return BASE_TIMEOUT_MS;
	const wait = args[index];
	return BASE_TIMEOUT_MS + (typeof wait === 'number' ? wait : DEFAULT_API_WAIT_MS);
}
