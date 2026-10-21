import { describe, it, expect } from 'vitest';
import { toScanScope, scanScopeLabel } from './scan-scope';

describe('toScanScope', () => {
	it('defaults to a recursive whole-vault scope', () => {
		expect(toScanScope()).toEqual({ recursive: true });
	});

	it('treats a bare folder path as recursive', () => {
		expect(toScanScope('Inbox')).toEqual({ folder: 'Inbox', recursive: true });
	});

	it('passes an explicit scope through', () => {
		expect(toScanScope({ folder: 'Inbox', recursive: false })).toEqual({ folder: 'Inbox', recursive: false });
	});
});

describe('scanScopeLabel', () => {
	it('is undefined for a recursive whole-vault scan', () => {
		expect(scanScopeLabel()).toBeUndefined();
		expect(scanScopeLabel({ recursive: true })).toBeUndefined();
	});

	it('is the bare folder for a recursive folder scan', () => {
		expect(scanScopeLabel('Inbox')).toBe('Inbox');
	});

	it('names the top-level scope at root and in a folder', () => {
		expect(scanScopeLabel({ recursive: false })).toBe('vault root (top level)');
		expect(scanScopeLabel({ folder: 'Inbox', recursive: false })).toBe('Inbox (top level)');
	});
});
