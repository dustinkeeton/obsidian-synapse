import { describe, it, expect } from 'vitest';
import { deepMergeSettings } from './settings-merge';

describe('deepMergeSettings', () => {
	it('recurses into nested records and keeps untouched defaults', () => {
		const out = deepMergeSettings({ a: { x: 1, y: 2 }, b: 3 }, { a: { y: 5 } });
		expect(out).toEqual({ a: { x: 1, y: 5 }, b: 3 });
	});

	it('treats arrays as leaf values', () => {
		const out = deepMergeSettings({ list: [1, 2, 3] }, { list: [9] });
		expect(out.list).toEqual([9]);
	});

	it('overwrites a record default with a primitive source value', () => {
		const out = deepMergeSettings<{ a: unknown }>({ a: { x: 1 } }, { a: null });
		expect(out.a).toBeNull();
	});

	it('drops prototype-polluting keys', () => {
		const source = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "prototype": 1, "ok": 2}') as Record<string, unknown>;
		const out = deepMergeSettings({ ok: 0 }, source);
		expect(out).toEqual({ ok: 2 });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it('does not mutate its inputs', () => {
		const target = { a: { x: 1 } };
		const source = { a: { y: 2 } };
		deepMergeSettings(target, source);
		expect(target).toEqual({ a: { x: 1 } });
		expect(source).toEqual({ a: { y: 2 } });
	});
});
