import { describe, it, expect, vi } from 'vitest';
import type { DataAdapter } from 'obsidian';
import { parseJson, isRecord, asStringArray, readJsonFile } from './json-utils';

describe('parseJson', () => {
	it('parses valid JSON and returns the value', () => {
		expect(parseJson('{"a":1}')).toEqual({ a: 1 });
		expect(parseJson('[1,2,3]')).toEqual([1, 2, 3]);
		expect(parseJson('"hello"')).toBe('hello');
		expect(parseJson('true')).toBe(true);
	});

	it('throws SyntaxError on malformed JSON', () => {
		expect(() => parseJson('not valid {{{')).toThrow(SyntaxError);
		expect(() => parseJson('')).toThrow();
	});
});

describe('isRecord', () => {
	it('returns true for plain objects', () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord({ a: 1 })).toBe(true);
	});

	it('returns false for null, arrays, and primitives', () => {
		expect(isRecord(null)).toBe(false);
		expect(isRecord(undefined)).toBe(false);
		expect(isRecord([1, 2])).toBe(false);
		expect(isRecord('str')).toBe(false);
		expect(isRecord(42)).toBe(false);
		expect(isRecord(true)).toBe(false);
	});
});

describe('asStringArray', () => {
	it('maps array elements to strings', () => {
		expect(asStringArray(['a', 'b'])).toEqual(['a', 'b']);
		expect(asStringArray([1, 2])).toEqual(['1', '2']);
	});

	it('returns empty array for non-array input', () => {
		expect(asStringArray('a,b')).toEqual([]);
		expect(asStringArray(undefined)).toEqual([]);
		expect(asStringArray(null)).toEqual([]);
		expect(asStringArray({ tags: 'x' })).toEqual([]);
	});
});

describe('readJsonFile', () => {
	interface Sample {
		id: string;
	}
	const isSample = (v: unknown): v is Sample =>
		typeof v === 'object' &&
		v !== null &&
		typeof (v as Record<string, unknown>).id === 'string';

	function makeAdapter(read: () => Promise<string>): DataAdapter {
		return { read: vi.fn(read) } as unknown as DataAdapter;
	}

	it('returns the typed value when JSON is valid and passes the guard', async () => {
		const adapter = makeAdapter(() => Promise.resolve('{"id":"abc"}'));
		const result = await readJsonFile(adapter, 'file.json', isSample);
		expect(result).toEqual({ id: 'abc' });
	});

	it('returns null when the file is missing (read rejects)', async () => {
		const adapter = makeAdapter(() => Promise.reject(new Error('ENOENT')));
		const result = await readJsonFile(adapter, 'missing.json', isSample);
		expect(result).toBeNull();
	});

	it('returns null when the content is not valid JSON', async () => {
		const adapter = makeAdapter(() => Promise.resolve('not json {{{'));
		const result = await readJsonFile(adapter, 'bad.json', isSample);
		expect(result).toBeNull();
	});

	it('returns null when the parsed value fails the guard', async () => {
		const adapter = makeAdapter(() => Promise.resolve('{"name":"no-id"}'));
		const result = await readJsonFile(adapter, 'wrong-shape.json', isSample);
		expect(result).toBeNull();
	});
});
