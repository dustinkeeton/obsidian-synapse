import { describe, it, expect } from 'vitest';
import { normalizeLicense, isLicenseAllowed, DEFAULT_LICENSE_FILTER } from './license';

describe('normalizeLicense', () => {
	it('maps Wikimedia Commons short names', () => {
		expect(normalizeLicense('CC BY-SA 4.0')).toBe('CC BY-SA');
		expect(normalizeLicense('CC BY 2.0')).toBe('CC BY');
		expect(normalizeLicense('CC0')).toBe('CC0');
		expect(normalizeLicense('Public domain')).toBe('Public domain');
		expect(normalizeLicense('CC BY-NC-ND 3.0')).toBe('CC BY-NC-ND');
	});

	it('maps Openverse license codes', () => {
		expect(normalizeLicense('by')).toBe('CC BY');
		expect(normalizeLicense('by-sa')).toBe('CC BY-SA');
		expect(normalizeLicense('cc0')).toBe('CC0');
		expect(normalizeLicense('pdm')).toBe('Public domain');
		expect(normalizeLicense('by-nc-sa')).toBe('CC BY-NC-SA');
	});

	it('returns null for unknown or empty strings', () => {
		expect(normalizeLicense('')).toBeNull();
		expect(normalizeLicense('All rights reserved')).toBeNull();
		expect(normalizeLicense('GFDL')).toBeNull();
	});
});

describe('isLicenseAllowed', () => {
	it('accepts permissive licenses under the default filter', () => {
		expect(isLicenseAllowed('CC BY-SA 4.0', DEFAULT_LICENSE_FILTER)).toBe(true);
		expect(isLicenseAllowed('cc0', DEFAULT_LICENSE_FILTER)).toBe(true);
	});

	it('rejects non-commercial and unknown licenses under the default filter', () => {
		expect(isLicenseAllowed('by-nc', DEFAULT_LICENSE_FILTER)).toBe(false);
		expect(isLicenseAllowed('GFDL', DEFAULT_LICENSE_FILTER)).toBe(false);
	});

	it('honors a user-widened allow-list written in either spelling', () => {
		expect(isLicenseAllowed('by-nc', ['cc by-nc'])).toBe(true);
		expect(isLicenseAllowed('CC BY-NC 2.0', ['BY-NC'])).toBe(true);
	});
});
