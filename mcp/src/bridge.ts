import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
	/** Where long arguments are staged; default the OS temp folder, which Obsidian reads as the same user unless it runs sandboxed. */
	tempDir?: string;
}

const VERB_PATTERN = /^[A-Za-z]+(\.[A-Za-z]+)?$/;
const BASE_TIMEOUT_MS = 60_000;
const DEFAULT_API_WAIT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Arguments longer than this travel through a temp file: one argv string is capped at 32,767 characters on Windows and 128 KiB on Linux. */
export const INLINE_ARGS_MAX_CHARS = 8 * 1024;

/** Verbs that wait inside Obsidian; their CLI call must outlive the wait. */
const WAIT_ARG_INDEX: Record<string, number> = { 'jobs.wait': 1, 'jobs.commit': 2 };

export function defaultRunner(cli: string): CliRunner {
	return (args, timeoutMs) => new Promise((resolve, reject) => {
		execFile(cli, args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' }, (error, stdout, stderr) => {
			if (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') {
					reject(new BridgeError(`The Obsidian CLI (${cli}) was not found. Synapse MCP needs Obsidian 1.12 or later with its command line interface turned on, on desktop.`));
					return;
				}
				if ((error as { killed?: boolean }).killed) {
					reject(new BridgeError(`The Obsidian CLI did not answer within ${Math.ceil(timeoutMs / 1000)} s. The call may still finish inside Obsidian: check status, jobs_list or proposals_list before retrying.`));
					return;
				}
				// error.message repeats the whole command line, generated expression included, so it is never reported.
				const output = (stderr || stdout).trim();
				reject(new BridgeError(`The Obsidian CLI failed: ${output || `exit code ${String(error.code ?? 'unknown')}`}`));
				return;
			}
			resolve(stdout);
		});
	});
}

/** The arguments as JSON, with missing positions as null; no API parameter accepts null. */
export function encodeArgs(args: readonly unknown[]): string {
	return JSON.stringify(args.map((arg) => (arg === undefined ? null : arg)));
}

/**
 * The JavaScript `obsidian eval` runs: one call on `app.plugins.plugins.synapse.api`.
 * The verb path is checked against a fixed pattern and must name the api object's own members, and the arguments travel as JSON data, never as code:
 * inline as a string literal, or, with `argsFile`, read from that file, which the expression deletes.
 */
export function buildExpression(verb: string, args: readonly unknown[], argsFile?: string): string {
	if (!VERB_PATTERN.test(verb)) throw new BridgeError(`Not a Synapse verb: ${verb}`);
	const path = JSON.stringify(verb.split('.'));
	const source = argsFile === undefined
		? JSON.stringify(encodeArgs(args))
		: `(() => { const fs = require('fs'); try { return fs.readFileSync(${JSON.stringify(argsFile)}, 'utf8'); } finally { try { fs.unlinkSync(${JSON.stringify(argsFile)}); } catch {} } })()`;
	return `(async () => {
	try {
		const api = app.plugins.plugins.synapse?.api;
		if (!api) return JSON.stringify({ synapseMcp: 'no-api' });
		const path = ${path};
		const own = (object, key) => object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
		const owner = path.length > 1 ? (own(api, path[0]) ? api[path[0]] : null) : api;
		const fn = own(owner, path[path.length - 1]) ? owner[path[path.length - 1]] : null;
		if (typeof fn !== 'function') return JSON.stringify({ synapseMcp: 'no-verb' });
		const args = JSON.parse(${source}).map((arg) => (arg === null ? undefined : arg));
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
		const json = encodeArgs(args);
		const argsFile = json.length > INLINE_ARGS_MAX_CHARS ? join(this.options.tempDir ?? tmpdir(), `synapse-mcp-${randomBytes(12).toString('hex')}.json`) : undefined;
		const cliArgs = ['eval', `code=${buildExpression(verb, args, argsFile)}`];
		if (this.options.vault) cliArgs.push(`vault=${this.options.vault}`);
		try {
			if (argsFile) await writeFile(argsFile, json, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
			return parseOutput(verb, await this.runner(cliArgs, timeoutFor(verb, args)));
		} catch (error) {
			if (argsFile && error instanceof BridgeError && error.message.includes('ENOENT')) {
				throw new BridgeError(`${error.message}. Obsidian could not read the staged arguments at ${argsFile}; if it runs sandboxed (Flatpak, Snap), set SYNAPSE_MCP_TEMP_DIR to a folder both can reach.`);
			}
			throw error;
		} finally {
			if (argsFile) await rm(argsFile, { force: true });
		}
	}
}

function timeoutFor(verb: string, args: readonly unknown[]): number {
	const index = WAIT_ARG_INDEX[verb];
	if (index === undefined) return BASE_TIMEOUT_MS;
	const wait = args[index];
	return BASE_TIMEOUT_MS + (typeof wait === 'number' ? wait : DEFAULT_API_WAIT_MS);
}
