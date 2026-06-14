import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import {
	loadNodeModules,
	assertDesktop,
	shellEnv,
	DesktopOnlyError,
} from './node-loader';

// The centralized mock's Platform.isDesktop is mutable; restore it after each
// test so a forced-mobile case never leaks into the rest of the suite.
describe('node-loader desktop guard', () => {
	afterEach(() => {
		Platform.isDesktop = true;
	});

	describe('loadNodeModules', () => {
		it('returns typed Node builtin handles on desktop', () => {
			Platform.isDesktop = true;
			const { os, path, fs, execFile } = loadNodeModules();

			// Spot-check a member of each handle to prove it is the real builtin.
			expect(typeof os.tmpdir).toBe('function');
			expect(typeof path.join).toBe('function');
			expect(typeof fs.promises.writeFile).toBe('function');
			expect(typeof execFile).toBe('function');
		});

		it('throws DesktopOnlyError when Platform.isDesktop is false', () => {
			Platform.isDesktop = false;
			expect(() => loadNodeModules()).toThrow(DesktopOnlyError);
		});

		it('does not require Node builtins before the desktop check fails', () => {
			// On real mobile the require itself would throw "Cannot find module";
			// our guard must fail FIRST with the descriptive DesktopOnlyError.
			Platform.isDesktop = false;
			expect(() => loadNodeModules()).toThrow(/only available on desktop/i);
		});
	});

	describe('assertDesktop', () => {
		it('does not throw on desktop', () => {
			Platform.isDesktop = true;
			expect(() => assertDesktop()).not.toThrow();
		});

		it('throws DesktopOnlyError off-desktop', () => {
			Platform.isDesktop = false;
			expect(() => assertDesktop()).toThrow(DesktopOnlyError);
		});

		it('includes the supplied context in the off-desktop error message', () => {
			Platform.isDesktop = false;
			expect(() => assertDesktop('Video transcription')).toThrow(/Video transcription requires desktop/i);
		});
	});
});

describe('shellEnv allowlist', () => {
	let saved: NodeJS.ProcessEnv;

	beforeEach(() => {
		// Snapshot and clear the vars shellEnv reads so each test controls them.
		saved = { ...process.env };
		for (const k of [
			'PATH', 'HOME', 'TMPDIR',
			'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
			'http_proxy', 'https_proxy', 'no_proxy',
		]) {
			delete process.env[k];
		}
	});

	afterEach(() => {
		process.env = saved;
	});

	it('augments PATH with the common install locations', () => {
		process.env.PATH = '/usr/bin';
		const env = shellEnv();
		expect(env.PATH).toContain('/usr/local/bin');
		expect(env.PATH).toContain('/opt/homebrew/bin');
		expect(env.PATH).toContain('/usr/bin');
	});

	it('prepends Homebrew ahead of ~/.local/bin and the existing PATH', () => {
		process.env.HOME = '/home/u';
		process.env.PATH = '/usr/bin';
		const env = shellEnv();
		const parts = (env.PATH ?? '').split(':');
		expect(parts.indexOf('/opt/homebrew/bin')).toBeLessThan(parts.indexOf('/home/u/.local/bin'));
		expect(parts.indexOf('/opt/homebrew/bin')).toBeLessThan(parts.indexOf('/usr/bin'));
	});

	it('does not duplicate an install location already present in PATH', () => {
		process.env.PATH = '/opt/homebrew/bin:/usr/bin';
		const env = shellEnv();
		const occurrences = (env.PATH ?? '').split(':').filter((p) => p === '/opt/homebrew/bin');
		expect(occurrences).toHaveLength(1);
	});

	it('passes HOME through when set', () => {
		process.env.HOME = '/home/u';
		expect(shellEnv().HOME).toBe('/home/u');
	});

	it('passes TMPDIR through when set', () => {
		process.env.TMPDIR = '/scratch';
		expect(shellEnv().TMPDIR).toBe('/scratch');
	});

	it('passes proxy vars (both casings) through only when present', () => {
		process.env.HTTPS_PROXY = 'http://proxy:8080';
		process.env.no_proxy = 'localhost';
		const env = shellEnv();
		expect(env.HTTPS_PROXY).toBe('http://proxy:8080');
		expect(env.no_proxy).toBe('localhost');
		// Unset proxy vars are absent (not undefined-valued keys).
		expect('HTTP_PROXY' in env).toBe(false);
	});

	it('does NOT spread arbitrary environment variables into the child env', () => {
		process.env.PATH = '/usr/bin';
		process.env.AWS_SECRET_ACCESS_KEY = 'super-secret';
		process.env.SOME_RANDOM_VAR = 'leak-me';
		const env = shellEnv();
		expect('AWS_SECRET_ACCESS_KEY' in env).toBe(false);
		expect('SOME_RANDOM_VAR' in env).toBe(false);
	});
});
