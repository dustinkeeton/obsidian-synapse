import { describe, it, expect } from 'vitest';
import {
	BUILD_INFO,
	PRODUCTION_BUILD,
	parseBuildInfo,
	formatBuiltAt,
	describeDevBuild,
} from './build-info';

describe('parseBuildInfo', () => {
	it('parses the production shape', () => {
		expect(parseBuildInfo('{"dev":false}')).toEqual({ dev: false });
	});

	it('parses the full dev shape', () => {
		const raw = JSON.stringify({
			dev: true,
			sha: '22933ef',
			branch: 'main',
			dirty: true,
			builtAt: '2026-10-06T14:02:00.000Z',
		});

		expect(parseBuildInfo(raw)).toEqual({
			dev: true,
			sha: '22933ef',
			branch: 'main',
			dirty: true,
			builtAt: '2026-10-06T14:02:00.000Z',
		});
	});

	it('keeps a bare dev build (git unavailable) as dev with no detail', () => {
		expect(parseBuildInfo('{"dev":true}')).toEqual({ dev: true });
	});

	it('drops dev fields of the wrong type', () => {
		const raw = JSON.stringify({ dev: true, sha: 7, branch: '', dirty: 'yes', builtAt: null });

		expect(parseBuildInfo(raw)).toEqual({ dev: true });
	});

	it.each([
		['undefined', undefined],
		['a non-string', { dev: true }],
		['invalid JSON', '{dev:true'],
		['a JSON scalar', '"dev"'],
		['null', 'null'],
		['a non-boolean dev flag', '{"dev":"true"}'],
	])('falls back to production for %s', (_label, raw) => {
		expect(parseBuildInfo(raw)).toEqual({ dev: false });
	});

	it('returns a fresh object rather than the frozen constant', () => {
		const info = parseBuildInfo(undefined);

		expect(info).not.toBe(PRODUCTION_BUILD);
		expect(Object.isFrozen(PRODUCTION_BUILD)).toBe(true);
	});
});

describe('BUILD_INFO under the test runner', () => {
	it('is the production shape from the vitest define', () => {
		expect(BUILD_INFO).toEqual({ dev: false });
	});
});

describe('formatBuiltAt', () => {
	it('renders local YYYY-MM-DD HH:mm', () => {
		const d = new Date(2026, 9, 6, 14, 2, 33);

		expect(formatBuiltAt(d.toISOString())).toBe('2026-10-06 14:02');
	});

	it('zero-pads single-digit fields', () => {
		const d = new Date(2026, 0, 3, 7, 5);

		expect(formatBuiltAt(d.toISOString())).toBe('2026-01-03 07:05');
	});

	it('returns the raw value when it does not parse', () => {
		expect(formatBuiltAt('not-a-date')).toBe('not-a-date');
	});
});

describe('describeDevBuild', () => {
	const builtAt = new Date(2026, 9, 6, 14, 2).toISOString();

	it('joins branch, sha, dirty flag, build time, and base version', () => {
		const info = { dev: true, sha: '22933ef', branch: 'main', dirty: true, builtAt };

		expect(describeDevBuild(info, '1.2.0')).toBe(
			'main @ 22933ef (dirty) · built 2026-10-06 14:02 · based on v1.2.0',
		);
	});

	it('omits the dirty marker on a clean tree', () => {
		const info = { dev: true, sha: '22933ef', branch: 'main', dirty: false, builtAt };

		expect(describeDevBuild(info, '1.2.0')).toBe(
			'main @ 22933ef · built 2026-10-06 14:02 · based on v1.2.0',
		);
	});

	it('degrades to the base version alone when git was unavailable', () => {
		expect(describeDevBuild({ dev: true }, '1.2.0')).toBe('based on v1.2.0');
	});

	it('renders a lone sha or branch without the separator', () => {
		expect(describeDevBuild({ dev: true, sha: 'abc1234' }, '1.2.0')).toBe(
			'abc1234 · based on v1.2.0',
		);
		expect(describeDevBuild({ dev: true, branch: 'feat/x', dirty: true }, '1.2.0')).toBe(
			'feat/x (dirty) · based on v1.2.0',
		);
	});

	it('still reports a dirty tree when no ref is known', () => {
		expect(describeDevBuild({ dev: true, dirty: true }, '1.2.0')).toBe('dirty · based on v1.2.0');
	});

	it('is empty for a production build', () => {
		expect(describeDevBuild({ dev: false }, '1.2.0')).toBe('');
	});
});
